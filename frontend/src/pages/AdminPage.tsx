import { useEffect, useState, type FormEvent } from "react";
import { passwordError, usernameError } from "../auth/auth";
import { FOODS, RESTAURANTS, formatDate, untilText, orderPriceLabel, withStoreSettings, won, type BankAccount } from "../components/orderChatKnowledge";
import {
  addOwner,
  approveOwner,
  fetchAllBanks,
  removeOwner,
  storePause,
  useDb,
  type OrderRecord,
  type ReservationRecord,
} from "../data/db";
import { Select } from "../components/Select";
import { DashLayout, Tabs } from "./DashLayout";
import { formatDateTime, statusClass } from "./format";
import { PasswordField } from "./PasswordField";

type Tab = "all" | "stores" | "stats" | "users";
type KindFilter = "all" | "delivery" | "reservation";
type StoresView = "stores" | "approve" | "create";
type AllView = KindFilter | "transfers"; // 전체 현황의 세부 메뉴: 종류별 목록, 또는 계좌이체 거래 내역
type UsersView = "members" | "history";

const KIND_LABEL: Record<Exclude<KindFilter, "all">, string> = { delivery: "배달", reservation: "식당 예약" };
const DAY = 86_400_000;

// 주문과 예약을 한 표에 섞어 보여 주기 위한 공통 줄
interface Row {
  id: string;
  createdAt: number;
  kind: Exclude<KindFilter, "all">;
  what: string;
  where: string;
  who: string;
  customer: string; // 아이디 (비회원·탈퇴한 회원은 이름과 같다). 이용 내역은 이것으로 묶는다
  amount?: number;
  amountLabel?: string; // "32,000원 (20% 할인)"
  status: string;
}

const toRow = (o: OrderRecord): Row => ({
  id: o.id,
  createdAt: o.createdAt,
  kind: "delivery",
  what: `${o.order.item} ${o.order.qty}${o.order.unit}`,
  where: o.order.store.name,
  who: o.customerName,
  customer: o.customer,
  amount: o.order.price,
  amountLabel: orderPriceLabel(o.order),
  status: o.status,
});
const rsvToRow = (r: ReservationRecord): Row => ({
  id: r.id,
  createdAt: r.createdAt,
  kind: "reservation",
  what: `${formatDate(new Date(r.date))} ${r.time} · ${r.people}명`,
  where: r.restaurantName,
  who: r.customerName,
  customer: r.customer,
  status: r.status,
});

export function AdminPage() {
  const db = useDb(["settings", "records", "accounts"]);
  const waiting = db.owners.filter((o) => o.approved === false).length;
  const [tab, setTab] = useState<Tab>("all");
  const rows = [...db.orders.map(toRow), ...db.reservations.map(rsvToRow)].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <DashLayout title="관리자">
      <Tabs
        tabs={[
          { key: "all", label: "전체 현황" },
          { key: "stores", label: "매장·사장님", badge: waiting },
          { key: "stats", label: "통계" },
          { key: "users", label: "사용자" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "all" && <AllTab rows={rows} orders={db.orders} />}
      {tab === "stores" && <StoresTab />}
      {tab === "stats" && <StatsTab rows={rows} />}
      {tab === "users" && <UsersTab rows={rows} />}
    </DashLayout>
  );
}

function AllTab({ rows, orders }: { rows: Row[]; orders: OrderRecord[] }) {
  const [kind, setKind] = useState<AllView>("all");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (kind === "all" || r.kind === kind) && (!needle || [r.what, r.where, r.who, r.status].some((s) => s.toLowerCase().includes(needle))),
  );
  return (
    <>
      <Tabs
        sub
        tabs={[
          { key: "all", label: "전체" },
          { key: "delivery", label: KIND_LABEL.delivery },
          { key: "reservation", label: KIND_LABEL.reservation },
          { key: "transfers", label: "거래 내역" },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind === "transfers" ? (
        <TransfersView orders={orders} />
      ) : (
      <section className="dash-section">
        <div className="section-head">
          <input className="search" placeholder="메뉴·매장·이름 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="검색" />
        </div>
        <p className="hint">{shown.length}건</p>
        {/* 휴대폰 폭이라 표 대신 한 건에 카드 한 장 */}
        <ul className="record-list">
          {shown.map((r) => (
            <li key={r.id} className="record">
              <div className="record-head">
                <span className={"chip kind-" + r.kind}>{KIND_LABEL[r.kind]}</span>
                <b>{r.what}</b>
                {r.amount !== undefined && <span className="price">{r.amountLabel ?? won(r.amount)}</span>}
                <span className={statusClass(r.status)}>{r.status}</span>
              </div>
              <dl>
                <div>
                  <dt>매장</dt>
                  <dd>{r.where}</dd>
                </div>
                <div>
                  <dt>고객</dt>
                  <dd>{r.who}</dd>
                </div>
                <div>
                  <dt>시각</dt>
                  <dd>{formatDateTime(r.createdAt)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
      )}
    </>
  );
}

// 관리자 거래 내역: 계좌이체 주문마다 입금 계좌·입금자명·금액·입금 확인 시각·상태를 본다 (입금 확인은 사장님이 한다)
type PayFilter = "all" | "입금 대기" | "입금 확인" | "취소";
const payState = (o: OrderRecord): Exclude<PayFilter, "all"> => (o.status === "입금 대기" ? "입금 대기" : o.status === "취소" ? "취소" : "입금 확인");
function TransfersView({ orders }: { orders: OrderRecord[] }) {
  const [filter, setFilter] = useState<PayFilter>("all");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = orders.filter(
    (o) =>
      (filter === "all" || payState(o) === filter) &&
      (!needle || [o.order.store.name, o.order.depositor ?? "", o.customerName, o.order.bank?.holder ?? ""].some((v) => v.toLowerCase().includes(needle))),
  );
  const paid = orders.filter((o) => payState(o) === "입금 확인");
  return (
    <>
      <section className="dash-section">
        <div className="tiles">
          <div className="tile">
            <span>입금 대기</span>
            <b>{orders.filter((o) => o.status === "입금 대기").length}건</b>
          </div>
          <div className="tile">
            <span>입금 확인</span>
            <b>{paid.length}건</b>
          </div>
          <div className="tile">
            <span>확인된 입금액</span>
            <b>{won(paid.reduce((a, o) => a + o.order.price, 0))}</b>
          </div>
          <div className="tile">
            <span>취소</span>
            <b>{orders.filter((o) => o.status === "취소").length}건</b>
          </div>
        </div>
      </section>
      <section className="dash-section">
        <div className="section-head">
          <div className="chips">
            {(["all", "입금 대기", "입금 확인", "취소"] as PayFilter[]).map((f) => (
              <button key={f} type="button" className={filter === f ? "chip active" : "chip"} onClick={() => setFilter(f)}>
                {f === "all" ? "전체" : f}
              </button>
            ))}
          </div>
          <input className="search" placeholder="매장·입금자명 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="거래 검색" />
        </div>
        <p className="hint">{shown.length}건</p>
        {shown.length === 0 && <p className="empty">거래가 없어요.</p>}
        <ul className="record-list">
          {shown.map((o) => (
            <li key={o.id} className={"record" + (o.status === "입금 대기" ? " pending" : "")}>
              <div className="record-head">
                <b>
                  {o.order.item} {o.order.qty}
                  {o.order.unit}
                </b>
                <span className="price">{orderPriceLabel(o.order)}</span>
                <span className={statusClass(o.status)}>{o.status}</span>
              </div>
              <dl>
                <div>
                  <dt>매장</dt>
                  <dd>{o.order.store.name}</dd>
                </div>
                <div>
                  <dt>입금 계좌</dt>
                  <dd>{o.order.bank ? `${o.order.bank.bank} ${o.order.bank.account} · ${o.order.bank.holder}` : "-"}</dd>
                </div>
                <div>
                  <dt>입금자명</dt>
                  <dd>{o.order.depositor ?? o.customerName}</dd>
                </div>
                <div>
                  <dt>주문 시각</dt>
                  <dd>{formatDateTime(o.createdAt)}</dd>
                </div>
                {o.order.paidAt && (
                  <div>
                    <dt>입금 확인</dt>
                    <dd>{formatDateTime(o.order.paidAt)}</dd>
                  </div>
                )}
                {o.status === "입금 대기" && o.order.payBy && (
                  <div>
                    <dt>입금 기한</dt>
                    <dd>{untilText(o.order.payBy)}까지</dd>
                  </div>
                )}
                {o.status === "취소" && o.order.cancelNote && (
                  <div>
                    <dt>취소 이유</dt>
                    <dd>{o.order.cancelNote}</dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// 계정 만들기에서 "새 매장 직접 입력"을 고른 값 (매장 id 와 겹치지 않는 글자)
const EMPTY_STORE = { name: "", food: "", open: "11:00", close: "21:00", address: "" };

// 식당마다 사장님 계정을 보여 주고, 새 사장님 계정을 만든다.
// 계정을 만들 때 매장 정보(이름·음식 종류·영업시간·주소)를 입력하면 그 매장도 함께 만든다. 사장님 이름은 "매장 이름 사장님"
function StoresTab() {
  const owners = useDb(["settings", "accounts"]).owners;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [store, setStore] = useState(EMPTY_STORE);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null); // 방금 만든 계정 안내
  const setStoreField = (field: keyof typeof EMPTY_STORE) => (value: string) => setStore((s) => ({ ...s, [field]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setCreated(null);
    const u = username.trim();
    const invalid = usernameError(u) ?? passwordError(password);
    if (invalid) return setError(invalid);
    const storeName = store.name.trim().replace(/\s+/g, " ");
    if (!storeName) return setError("매장 이름을 적어 주세요.");
    if (!store.food) return setError("음식 종류를 골라 주세요.");
    try {
      const { open, close, ...rest } = store;
      await addOwner({ username: u, password, newStore: { ...rest, name: storeName, hours: `${open} - ${close}` } });
    } catch (err) {
      return setError((err as Error).message); // 이미 있는 아이디·같은 이름의 매장 등 서버가 거절한 이유
    }
    setUsername("");
    setPassword("");
    setStore(EMPTY_STORE);
    setError(null);
    setCreated(`${u} 계정과 ${storeName} 매장을 만들었어요. 사장님 이름은 "${storeName} 사장님"이에요.`);
  }

  const waiting = owners.filter((o) => o.approved === false);
  // 세부 메뉴: 직접 고르기 전에는 승인을 기다리는 사장님이 있으면 그것부터 보여 준다 (계정 목록이 늦게 와도 따라간다).
  // 회원가입으로는 사장님이 될 수 없어 "승인 대기"는 예전에 직접 가입한 사장님이 남아 있을 때만 있고, 다 처리하면 매장 목록으로 돌아간다
  const [picked, setView] = useState<StoresView | null>(null);
  const wanted = picked ?? "approve";
  const view: StoresView = wanted === "approve" && waiting.length === 0 ? "stores" : wanted;
  const orphans = owners.filter((o) => !RESTAURANTS.some((r) => r.id === o.storeId));
  const storeName = (id?: string) => RESTAURANTS.find((r) => r.id === id)?.name ?? id;
  // 매장별 입금 계좌 (사장님이 등록). 사장님 계정이 지워지면 계좌도 지워지므로 계정 수가 바뀔 때 다시 받는다
  const [banks, setBanks] = useState<Record<string, BankAccount>>({});
  const ownerCount = owners.length;
  useEffect(() => {
    let alive = true;
    fetchAllBanks()
      .then((b) => alive && setBanks(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ownerCount]);
  const [actionError, setActionError] = useState<string | null>(null);
  // 승인·삭제가 실패하면(서버 거절, 연결 끊김) 이유를 보여 준다
  const run = (work: Promise<unknown>) => {
    setActionError(null);
    work.catch((err: unknown) => setActionError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요."));
  };

  return (
    <>
      <Tabs
        sub
        tabs={[
          { key: "stores" as const, label: "매장 목록" },
          ...(waiting.length > 0 ? [{ key: "approve" as const, label: "승인 대기", badge: waiting.length }] : []),
          { key: "create" as const, label: "계정 만들기" },
        ]}
        value={view}
        onChange={setView}
      />
      {view === "approve" && (
        <section className="dash-section">
          <h2>승인 대기 ({waiting.length})</h2>
          <p className="hint">예전에 회원가입으로 직접 가입한 사장님이에요. 그 매장의 사장님이 맞는지 확인한 뒤 승인하세요. 승인 전에는 매장 주문·예약을 볼 수 없어요.</p>
          <ul className="record-list">
            {waiting.map((o) => (
              <li key={o.username} className="record pending">
                <div className="record-head">
                  <b>{storeName(o.storeId)}</b>
                  <span className="status s-접수">승인 대기</span>
                </div>
                <dl>
                  <div>
                    <dt>아이디</dt>
                    <dd>
                      {o.username} ({o.name})
                    </dd>
                  </div>
                  <div>
                    <dt>이메일</dt>
                    <dd>{o.email ?? "-"}</dd>
                  </div>
                </dl>
                <div className="record-actions">
                  <button type="button" className="btn primary small" onClick={() => run(approveOwner(o.username))}>
                    승인
                  </button>
                  <button type="button" className="btn small" onClick={() => run(removeOwner(o.username))}>
                    거절(삭제)
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {actionError && view !== "create" && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {view === "stores" && (
        <>
          <section className="dash-section">
            <h2>매장과 사장님 계정</h2>
            <ul className="record-list">
              {RESTAURANTS.map((r) => {
                const mine = owners.filter((o) => o.storeId === r.id);
                const pause = storePause(r.id);
                const removable = mine;
                return (
                  <li key={r.id} className="record">
                    <div className="record-head">
                      <b>{r.name}</b>
                    </div>
                    <dl>
                      <div>
                        <dt>영업시간</dt>
                        <dd>{withStoreSettings(r).hours}</dd>
                      </div>
                      <div>
                        <dt>영업 상태</dt>
                        <dd>
                          {!pause ? (
                            "주문 받는 중"
                          ) : pause.active ? (
                            <span className="status-pill paused">일시 중지 · {untilText(pause.until)}까지</span>
                          ) : (
                            <span className="status-pill paused">
                              일시 중지 예정 · {untilText(pause.from)}~{untilText(pause.until)}
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>사장님</dt>
                        <dd>
                          {mine.length ? (
                            mine.map((o) => `${o.username} (${o.name})${o.approved === false ? " · 승인 대기" : ""}`).join(", ")
                          ) : (
                            <span className="muted">없음</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>입금 계좌</dt>
                        <dd>
                          {banks[r.id] ? (
                            `${banks[r.id].bank} ${banks[r.id].account} · ${banks[r.id].holder}`
                          ) : (
                            <span className="status s-입금-대기">없음 · 배달 주문 못 받음</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    {removable.length > 0 && (
                      <div className="record-actions">
                        {removable.map((o) => (
                          <button key={o.username} type="button" className="btn small" onClick={() => run(removeOwner(o.username))}>
                            {o.username} 삭제
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 매장 목록(catalog.json)이 바뀌어 지금은 없는 매장에 묶인 사장님: 그대로 두면 보이지도 지워지지도 않으므로 따로 보여 준다 */}
          {orphans.length > 0 && (
            <section className="dash-section">
              <h2>매장을 찾을 수 없는 사장님 ({orphans.length})</h2>
              <p className="hint">이 계정들이 가리키는 매장이 지금 매장 목록에 없어요. 매장 목록을 다시 확인하거나 계정을 지워 주세요.</p>
              <ul className="record-list">
                {orphans.map((o) => (
                  <li key={o.username} className="record">
                    <div className="record-head">
                      <b>
                        {o.username} ({o.name})
                      </b>
                      <span className="muted">매장 id {o.storeId ?? "-"}</span>
                    </div>
                    <div className="record-actions">
                      <button type="button" className="btn small" onClick={() => run(removeOwner(o.username))}>
                        {o.username} 삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {view === "create" && (
        <section className="dash-section">
          <h2>사장님 계정 만들기</h2>
          <form className="form-grid" onSubmit={onSubmit}>
            <label>
              <span>아이디</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </label>
            <PasswordField label="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <p className="form-hint muted">매장 정보를 입력하면 새 매장과 그 매장 사장님 계정을 함께 만들어요. 사장님 이름은 "매장 이름 사장님"으로 정해지고, 메뉴와 입금 계좌는 사장님이 사장님 화면에서 등록해요.</p>
            <label>
              <span>매장 이름</span>
              <input value={store.name} onChange={(e) => setStoreField("name")(e.target.value)} maxLength={30} placeholder="예) 하소 닭강정" />
            </label>
            <Select
              label="음식 종류"
              options={FOODS.map((f) => ({ value: f.key, label: f.label }))}
              value={store.food}
              onChange={setStoreField("food")}
              placeholder="골라 주세요"
            />
            <div className="hours-row">
              <label>
                <span>여는 시간</span>
                <input type="time" value={store.open} onChange={(e) => e.target.value && setStoreField("open")(e.target.value)} />
              </label>
              <label>
                <span>닫는 시간</span>
                <input type="time" value={store.close} onChange={(e) => e.target.value && setStoreField("close")(e.target.value)} />
              </label>
            </div>
            <label>
              <span>주소 (선택)</span>
              <input value={store.address} onChange={(e) => setStoreField("address")(e.target.value)} maxLength={100} />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {created && (
              <p className="form-notice" role="status">
                {created}
              </p>
            )}
            <button className="btn primary" type="submit">
              계정 만들기
            </button>
          </form>
        </section>
      )}
    </>
  );
}

// 숫자 타일 + 가로 막대 두 개. 막대는 한 가지 색(수량이 클수록 길다)이고 값은 글자로 바로 적는다
function StatsTab({ rows }: { rows: Row[] }) {
  const [now] = useState(() => Date.now()); // 렌더마다 바뀌지 않게 열 때의 시각으로 계산한다
  const valid = rows.filter((r) => r.status !== "취소");
  // 매출은 입금이 확인된 주문만 (입금 대기는 뺀다)
  const sales = valid.filter((r) => r.status !== "입금 대기").reduce((a, r) => a + (r.amount ?? 0), 0);
  const cancelRate = rows.length ? Math.round(((rows.length - valid.length) / rows.length) * 100) : 0;

  const byKind = (["delivery", "reservation"] as const).map((k) => ({
    label: KIND_LABEL[k],
    value: valid.filter((r) => r.kind === k).length,
  }));
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(new Date(now - (6 - i) * DAY).toDateString()).getTime();
    const d = new Date(start);
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, value: valid.filter((r) => r.createdAt >= start && r.createdAt < start + DAY).length };
  });

  return (
    <>
      <section className="dash-section">
        <div className="tiles">
          <div className="tile">
            <span>전체 주문·예약</span>
            <b>{rows.length}건</b>
          </div>
          <div className="tile">
            <span>누적 매출</span>
            <b>{won(sales)}</b>
          </div>
          <div className="tile">
            <span>식당 예약</span>
            <b>{rows.filter((r) => r.kind === "reservation").length}건</b>
          </div>
          <div className="tile">
            <span>취소율</span>
            <b>{cancelRate}%</b>
          </div>
        </div>
      </section>
      <section className="dash-section">
        <h2>서비스별 건수</h2>
        <Bars data={byKind} />
      </section>
      <section className="dash-section">
        <h2>최근 7일 건수</h2>
        <Bars data={days} />
      </section>
    </>
  );
}

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="bars" aria-label="막대 그래프">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${d.value}건`}>
          <span className="bar-label">{d.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{d.value}건</span>
        </li>
      ))}
    </ul>
  );
}

function UsersTab({ rows }: { rows: Row[] }) {
  // 아이디로 묶는다 (이름이 같은 다른 손님이 한 줄로 합쳐지지 않게). 비회원·탈퇴한 회원은 아이디가 곧 이름이다
  const byUser = new Map<string, { name: string; count: number; spent: number; last: number }>();
  for (const r of rows) {
    const cur = byUser.get(r.customer) ?? { name: r.who, count: 0, spent: 0, last: 0 };
    byUser.set(r.customer, { name: r.who, count: cur.count + 1, spent: cur.spent + (r.status !== "취소" && r.status !== "입금 대기" ? (r.amount ?? 0) : 0), last: Math.max(cur.last, r.createdAt) });
  }
  const users = [...byUser.entries()].sort((a, b) => b[1].last - a[1].last);
  const members = [...useDb(["accounts"]).users].sort((a, b) => b.createdAt - a.createdAt);
  const [view, setView] = useState<UsersView>("members");
  return (
    <>
      <Tabs
        sub
        tabs={[
          { key: "members", label: "가입 회원" },
          { key: "history", label: "이용 내역" },
        ]}
        value={view}
        onChange={setView}
      />
      {view === "members" && (
        <section className="dash-section">
          <h2>가입한 고객님 ({members.length})</h2>
          {members.length === 0 && <p className="empty">아직 회원가입한 고객님이 없어요.</p>}
          <ul className="record-list">
            {members.map((m) => (
              <li key={m.username} className="record">
                <div className="record-head">
                  <b>{m.name}</b>
                  <span className="muted">{m.username}</span>
                </div>
                <dl>
                  <div>
                    <dt>이메일</dt>
                    <dd>{m.email ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>가입</dt>
                    <dd>{formatDateTime(m.createdAt)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view === "history" && (
        <section className="dash-section">
          <h2>이용 내역 ({users.length})</h2>
          {users.length === 0 && <p className="empty">아직 주문·예약한 고객님이 없어요.</p>}
          <ul className="record-list">
            {users.map(([customer, u]) => (
              <li key={customer} className="record">
                <div className="record-head">
                  <b>{u.name}</b>
                  {customer !== u.name && <span className="muted">{customer}</span>}
                  <span className="price">{won(u.spent)}</span>
                </div>
                <dl>
                  <div>
                    <dt>주문·예약</dt>
                    <dd>{u.count}건</dd>
                  </div>
                  <div>
                    <dt>마지막 이용</dt>
                    <dd>{formatDateTime(u.last)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
