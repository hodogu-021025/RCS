import { useState, type FormEvent } from "react";
import { allOwners, passwordError, usernameError } from "../auth/auth";
import { RESTAURANTS, formatDate, withStoreSettings, won } from "../components/orderChatKnowledge";
import { addOwner, removeOwner, useDb, type OrderRecord, type ReservationRecord } from "../data/db";
import { DashLayout, Tabs } from "./DashLayout";
import { formatDateTime } from "./format";
import { PasswordField } from "./PasswordField";

type Tab = "all" | "stores" | "stats" | "users";
type KindFilter = "all" | "delivery" | "reservation";

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
  amount?: number;
  status: string;
}

const toRow = (o: OrderRecord): Row => ({
  id: o.id,
  createdAt: o.createdAt,
  kind: "delivery",
  what: `${o.order.item} ${o.order.qty}${o.order.unit}`,
  where: o.order.store.name,
  who: o.customerName,
  amount: o.order.price,
  status: o.status,
});
const rsvToRow = (r: ReservationRecord): Row => ({
  id: r.id,
  createdAt: r.createdAt,
  kind: "reservation",
  what: `${formatDate(new Date(r.date))} ${r.time} · ${r.people}명`,
  where: r.restaurantName,
  who: r.customerName,
  status: r.status,
});

export function AdminPage() {
  const db = useDb();
  const [tab, setTab] = useState<Tab>("all");
  const rows = [...db.orders.map(toRow), ...db.reservations.map(rsvToRow)].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <DashLayout title="관리자">
      <Tabs
        tabs={[
          { key: "all", label: "전체 현황" },
          { key: "stores", label: "매장·사장님" },
          { key: "stats", label: "통계" },
          { key: "users", label: "사용자" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "all" && <AllTab rows={rows} />}
      {tab === "stores" && <StoresTab />}
      {tab === "stats" && <StatsTab rows={rows} />}
      {tab === "users" && <UsersTab rows={rows} />}
    </DashLayout>
  );
}

function AllTab({ rows }: { rows: Row[] }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (kind === "all" || r.kind === kind) && (!needle || [r.what, r.where, r.who, r.status].some((s) => s.toLowerCase().includes(needle))),
  );
  return (
    <section className="dash-section">
      <div className="section-head">
        <div className="chips">
          {(["all", "delivery", "reservation"] as KindFilter[]).map((k) => (
            <button key={k} type="button" className={kind === k ? "chip active" : "chip"} onClick={() => setKind(k)}>
              {k === "all" ? "전체" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
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
              {r.amount !== undefined && <span className="price">{won(r.amount)}</span>}
              <span className={"status s-" + r.status}>{r.status}</span>
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
  );
}

// 식당마다 사장님 계정을 보여 주고, 새 사장님 계정을 만든다 (데모 계정은 지울 수 없다)
function StoresTab() {
  useDb(); // 계정이나 매장 설정이 바뀌면 다시 그린다
  const owners = allOwners();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [storeId, setStoreId] = useState(RESTAURANTS[0].id);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const u = username.trim();
    const invalid = usernameError(u) ?? passwordError(password);
    if (invalid) return setError(invalid);
    addOwner({ username: u, password, name: name.trim() || `${RESTAURANTS.find((r) => r.id === storeId)!.name} 사장님`, storeId });
    setUsername("");
    setPassword("");
    setName("");
    setError(null);
  }

  return (
    <>
      <section className="dash-section">
        <h2>매장과 사장님 계정</h2>
        <ul className="record-list">
          {RESTAURANTS.map((r) => {
            const mine = owners.filter((o) => o.storeId === r.id);
            const removable = mine.filter((o) => !o.builtIn);
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
                    <dt>사장님</dt>
                    <dd>{mine.length ? mine.map((o) => `${o.username} (${o.name})`).join(", ") : <span className="muted">없음</span>}</dd>
                  </div>
                </dl>
                {removable.length > 0 && (
                  <div className="record-actions">
                    {removable.map((o) => (
                      <button key={o.username} type="button" className="btn small" onClick={() => removeOwner(o.username)}>
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

      <section className="dash-section">
        <h2>사장님 계정 만들기</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            <span>아이디</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </label>
          <PasswordField label="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <label>
            <span>이름 (비우면 "매장 사장님")</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>매장</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {RESTAURANTS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" type="submit">
            계정 만들기
          </button>
        </form>
      </section>
    </>
  );
}

// 숫자 타일 + 가로 막대 두 개. 막대는 한 가지 색(수량이 클수록 길다)이고 값은 글자로 바로 적는다
function StatsTab({ rows }: { rows: Row[] }) {
  const [now] = useState(() => Date.now()); // 렌더마다 바뀌지 않게 열 때의 시각으로 계산한다
  const valid = rows.filter((r) => r.status !== "취소");
  const sales = valid.reduce((a, r) => a + (r.amount ?? 0), 0);
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
  const byUser = new Map<string, { count: number; spent: number; last: number }>();
  for (const r of rows) {
    const cur = byUser.get(r.who) ?? { count: 0, spent: 0, last: 0 };
    byUser.set(r.who, { count: cur.count + 1, spent: cur.spent + (r.status !== "취소" ? (r.amount ?? 0) : 0), last: Math.max(cur.last, r.createdAt) });
  }
  const users = [...byUser.entries()].sort((a, b) => b[1].last - a[1].last);
  const members = [...useDb().users].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <>
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
      <section className="dash-section">
        <h2>이용 내역 ({users.length})</h2>
        <ul className="record-list">
          {users.map(([name, u]) => (
            <li key={name} className="record">
              <div className="record-head">
                <b>{name}</b>
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
    </>
  );
}
