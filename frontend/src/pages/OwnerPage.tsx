import { useEffect, useState, type FormEvent } from "react";
import { refreshSession, useSession } from "../auth/auth";
import { findRestaurantById, formatDate, won } from "../components/orderChatKnowledge";
import {
  addMenuItem,
  setMenuActive,
  setMenuItem,
  setOrderStatus,
  setReservationStatus,
  setStoreHours,
  useDb,
  type OrderRecord,
  type ReservationRecord,
} from "../data/db";
import { DashLayout, Tabs } from "./DashLayout";
import { formatDateTime } from "./format";

type Tab = "orders" | "store" | "sales";
type Filter = "all" | "접수" | "준비 중" | "완료";

const DAY = 86_400_000;

// 짧은 알림음 두 번 (파일 없이 브라우저가 소리를 만든다). 소리를 못 내는 환경이면 조용히 넘어간다
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.18].forEach((at) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.15);
    });
  } catch {
    // 소리는 부가 기능이다
  }
}

// 새 주문이 들어오면 잠깐 떠 있는 알림. key 로 주문 id 를 받아 새 주문마다 새로 마운트된다
function NewOrderToast({ record }: { record: OrderRecord }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    beep();
    const t = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div className="toast" role="status">
      새 주문: {record.order.item} {record.order.qty}
      {record.order.unit} · {won(record.order.price)}
    </div>
  );
}

// 스스로 가입한 사장님은 관리자가 승인하기 전까지 매장 정보를 볼 수 없다. 승인되면 자동으로 넘어간다 (20초마다 확인)
function PendingApproval({ storeName }: { storeName: string }) {
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => void refreshSession(), 20_000);
    return () => window.clearInterval(t);
  }, []);
  async function checkNow() {
    setChecking(true);
    await refreshSession();
    setChecking(false);
  }
  return (
    <DashLayout title={`${storeName} · 사장님`}>
      <section className="dash-section pending-approval">
        <h2>관리자 승인을 기다리고 있어요</h2>
        <p>
          {storeName}의 사장님이 맞는지 관리자가 확인하고 있어요. 승인되면 이 화면에서 바로 주문·예약을 받고 영업시간·메뉴를 관리할 수 있어요.
        </p>
        <button className="btn primary" type="button" onClick={checkNow} disabled={checking}>
          {checking ? "확인하는 중…" : "승인됐는지 확인"}
        </button>
      </section>
    </DashLayout>
  );
}

export function OwnerPage() {
  const session = useSession()!;
  const db = useDb();
  // 매장 목록이 바뀌어 내 매장이 사라졌으면 빈 매장 정보로 안내만 보여 준다 (아래에서 처리)
  const store = findRestaurantById(session.storeId) ?? { id: session.storeId ?? "", name: "알 수 없는 매장", hours: "", address: "", signature: "", food: "", distanceKm: 0, rating: 0 };
  const storeMissing = !findRestaurantById(session.storeId);
  const orders = db.orders.filter((o) => o.storeId === store.id);
  const reservations = db.reservations.filter((r) => r.restaurantId === store.id);
  const pending = orders.filter((o) => o.status === "접수").length;

  const [tab, setTab] = useState<Tab>("orders");
  const [filter, setFilter] = useState<Filter>("all");
  // 페이지를 열 때 이미 있던 주문에는 알리지 않는다: 서버에서 처음 받아 온 뒤의 맨 위 주문을 기억해 두고, 그 뒤에 생긴 것만 알린다
  // (렌더 중에 상태를 맞추는 React 의 파생 상태 방식)
  const [seenAtOpen, setSeenAtOpen] = useState<string | null | undefined>(undefined);
  if (db.recordsLoaded && seenAtOpen === undefined) setSeenAtOpen(orders[0]?.id ?? null);
  const latest = orders[0];
  const isNew = seenAtOpen !== undefined && latest && latest.id !== seenAtOpen && latest.status === "접수";

  const shownOrders = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  if (storeMissing) {
    return (
      <DashLayout title="사장님">
        <section className="dash-section pending-approval">
          <h2>매장 정보를 찾을 수 없어요</h2>
          <p>이 계정에 연결된 매장이 지금 매장 목록에 없어요. 관리자에게 문의해 주세요.</p>
        </section>
      </DashLayout>
    );
  }
  if (session.approved === false) return <PendingApproval storeName={store.name} />;

  return (
    <DashLayout title={`${store.name} · 사장님`}>
      {isNew && <NewOrderToast key={latest.id} record={latest} />}
      <Tabs
        tabs={[
          { key: "orders", label: "주문·예약", badge: pending },
          { key: "store", label: "매장·메뉴" },
          { key: "sales", label: "매출" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "orders" && (
        <>
          <section className="dash-section">
            <div className="section-head">
              <h2>배달 주문</h2>
              <div className="chips">
                {(["all", "접수", "준비 중", "완료"] as Filter[]).map((f) => (
                  <button key={f} type="button" className={filter === f ? "chip active" : "chip"} onClick={() => setFilter(f)}>
                    {f === "all" ? "전체" : f}
                  </button>
                ))}
              </div>
            </div>
            {shownOrders.length === 0 && <p className="empty">해당하는 주문이 없어요.</p>}
            <ul className="record-list">
              {shownOrders.map((o) => (
                <OrderRow key={o.id} record={o} />
              ))}
            </ul>
          </section>

          <section className="dash-section">
            <h2>식당 예약</h2>
            {reservations.length === 0 && <p className="empty">예약이 없어요.</p>}
            <ul className="record-list">
              {reservations.map((r) => (
                <ReservationRow key={r.id} record={r} />
              ))}
            </ul>
          </section>
        </>
      )}

      {tab === "store" && <StoreTab storeId={store.id} hours={store.hours} />}
      {tab === "sales" && <SalesTab orders={orders} />}
    </DashLayout>
  );
}

function OrderRow({ record: o }: { record: OrderRecord }) {
  return (
    <li className={"record" + (o.status === "접수" ? " pending" : "")}>
      <div className="record-head">
        <b>
          {o.order.item} {o.order.qty}
          {o.order.unit}
        </b>
        <span className="price">{won(o.order.price)}</span>
        <span className={"status s-" + o.status}>{o.status}</span>
      </div>
      <dl>
        {o.order.address && (
          <div>
            <dt>배달지</dt>
            <dd>{o.order.address}</dd>
          </div>
        )}
        <div>
          <dt>주문자</dt>
          <dd>{o.customerName}</dd>
        </div>
        {o.order.phone && (
          <div>
            <dt>연락처</dt>
            {/* 휴대폰에서 누르면 바로 전화를 건다 */}
            <dd>
              <a className="tel" href={`tel:${o.order.phone.replace(/-/g, "")}`}>
                {o.order.phone}
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt>결제</dt>
          <dd>{o.payment}</dd>
        </div>
        <div>
          <dt>시각</dt>
          <dd>{formatDateTime(o.createdAt)}</dd>
        </div>
      </dl>
      <div className="record-actions">
        {o.status === "접수" && (
          <>
            <button type="button" className="btn primary" onClick={() => setOrderStatus(o.id, "준비 중")}>
              준비 시작
            </button>
            <button type="button" className="btn" onClick={() => setOrderStatus(o.id, "취소")}>
              취소
            </button>
          </>
        )}
        {o.status === "준비 중" && (
          <button type="button" className="btn primary" onClick={() => setOrderStatus(o.id, "완료")}>
            배달 완료
          </button>
        )}
      </div>
    </li>
  );
}

function ReservationRow({ record: r }: { record: ReservationRecord }) {
  return (
    <li className="record">
      <div className="record-head">
        <b>
          {formatDate(new Date(r.date))} {r.time}
        </b>
        <span>{r.people}명</span>
        <span className={"status s-" + r.status}>{r.status}</span>
      </div>
      <dl>
        <div>
          <dt>예약자</dt>
          <dd>{r.customerName}</dd>
        </div>
        <div>
          <dt>예약 시각</dt>
          <dd>{formatDateTime(r.createdAt)}</dd>
        </div>
      </dl>
      {r.status === "예약 확정" && (
        <div className="record-actions">
          <button type="button" className="btn primary" onClick={() => setReservationStatus(r.id, "방문 완료")}>
            방문 완료
          </button>
          <button type="button" className="btn" onClick={() => setReservationStatus(r.id, "취소")}>
            취소
          </button>
        </div>
      )}
    </li>
  );
}

// 메뉴 추가 칸에서 고르는 수량 단위
const UNITS = ["마리", "판", "인분", "개", "그릇", "세트", "잔", "병"];
const PRICE_MIN = 100;
const PRICE_MAX = 1_000_000;

// 메뉴 추가: 이름·가격·단위·손님이 부를 다른 이름. 추가하면 바로 판매되고 소비자 챗봇에 나온다
function AddMenuForm({ storeId }: { storeId: string }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState(UNITS[0]);
  const [aliases, setAliases] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    const n = name.trim();
    const p = Number(price);
    const invalid = !n
      ? "메뉴 이름을 적어 주세요."
      : !Number.isInteger(p) || p < PRICE_MIN || p > PRICE_MAX
        ? `가격은 ${PRICE_MIN.toLocaleString("ko-KR")}원부터 ${PRICE_MAX.toLocaleString("ko-KR")}원까지 적어 주세요.`
        : null;
    if (invalid) return setError(invalid);
    setBusy(true);
    try {
      const keywords = aliases.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      await addMenuItem(storeId, { name: n, price: p, unit, keywords });
      setName("");
      setPrice("");
      setAliases("");
      setError(null);
      setDone(`${n} 메뉴를 추가했어요. 소비자 챗봇에 바로 보여요.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-section">
      <h2>메뉴 추가</h2>
      <form className="menu-form" onSubmit={onSubmit} noValidate>
        <label>
          <span>메뉴 이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="예) 양념치킨" />
        </label>
        <div className="menu-form-row">
          <label>
            <span>가격 (원)</span>
            <input type="number" inputMode="numeric" min={PRICE_MIN} step={500} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="예) 19000" />
          </label>
          <label>
            <span>단위</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>손님이 부를 다른 이름 (선택, 쉼표로 구분)</span>
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="예) 양념, 양념통닭" />
        </label>
        <p className="hint">매장 음식 종류 이름(예: 치킨)은 자동으로 들어가서, 손님이 "치킨"이라고만 말해도 이 메뉴를 추천해요.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="form-notice" role="status">
            {done}
          </p>
        )}
        <button className="btn primary wide" type="submit" disabled={busy}>
          {busy ? "추가하는 중…" : "메뉴 추가"}
        </button>
      </form>
    </section>
  );
}

// 영업시간과 배달 메뉴(가격·품절·판매 중지, 메뉴 추가). 바꾸면 소비자 챗봇에 바로 반영된다
function StoreTab({ storeId, hours }: { storeId: string; hours: string }) {
  const db = useDb(["settings", "menu"]);
  const [menuError, setMenuError] = useState<string | null>(null);
  // 판매 중지·다시 판매가 실패하면(연결 끊김 등) 이유를 보여 준다
  const toggle = (itemId: string, active: boolean) => {
    setMenuError(null);
    setMenuActive(storeId, itemId, active).catch((err: unknown) => setMenuError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요."));
  };
  // 자정 마감은 데이터에 "24:00"으로 적혀 있지만 시간 입력칸은 "00:00"까지만 받는다 (예약 시간 계산은 둘 다 자정으로 본다)
  const [open, close] = hours.split("-").map((s) => s.trim()).map((t) => (t === "24:00" ? "00:00" : t));
  const mine = db.menu.filter((d) => d.restaurantId === storeId);
  const items = mine.filter((d) => d.active !== false);
  const stopped = mine.filter((d) => d.active === false);
  const settings = db.storeSettings[storeId]?.items ?? {};

  return (
    <>
      <section className="dash-section">
        <h2>영업시간</h2>
        <div className="field-row">
          <label>
            <span>여는 시간</span>
            <input type="time" value={open} onChange={(e) => e.target.value && setStoreHours(storeId, `${e.target.value} - ${close}`)} />
          </label>
          <label>
            <span>닫는 시간</span>
            <input type="time" value={close} onChange={(e) => e.target.value && setStoreHours(storeId, `${open} - ${e.target.value}`)} />
          </label>
        </div>
        <p className="hint">예약은 마감 1시간 전까지 받아요. 바꾸면 소비자 화면에 바로 반영됩니다.</p>
      </section>

      <section className="dash-section">
        <h2>배달 메뉴</h2>
        {items.length === 0 && <p className="empty">이 매장에 등록된 배달 메뉴가 없어요.</p>}
        <ul className="menu-list">
          {items.map((d) => {
            const s = settings[d.id] ?? {};
            return (
              <li key={d.id} className={s.soldOut ? "sold-out" : undefined}>
                <b>{d.name}</b>
                <label className="price-field">
                  <input
                    type="number"
                    min={0}
                    step={500}
                    defaultValue={s.price ?? d.price}
                    aria-label={`${d.name} 가격`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v > 0 && v !== (s.price ?? d.price)) setMenuItem(storeId, d.id, { price: v });
                    }}
                  />
                  <span>원 / 1{d.unit}</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={!!s.soldOut} onChange={(e) => setMenuItem(storeId, d.id, { soldOut: e.target.checked })} />
                  품절
                </label>
                <button type="button" className="btn small" onClick={() => toggle(d.id, false)} aria-label={`${d.name} 판매 중지`}>
                  판매 중지
                </button>
              </li>
            );
          })}
        </ul>
        <p className="hint">품절은 오늘처럼 잠깐 못 파는 것, 판매 중지는 메뉴에서 내리는 것이에요. 판매 중지한 메뉴는 아래에서 다시 판매할 수 있어요.</p>
        {menuError && (
          <p className="form-error" role="alert">
            {menuError}
          </p>
        )}
      </section>

      <AddMenuForm storeId={storeId} />

      {stopped.length > 0 && (
        <section className="dash-section">
          <h2>판매 중지한 메뉴 ({stopped.length})</h2>
          <ul className="menu-list">
            {stopped.map((d) => (
              <li key={d.id} className="stopped">
                <b>{d.name}</b>
                <span className="muted">
                  {won(settings[d.id]?.price ?? d.price)} / 1{d.unit}
                </span>
                <button type="button" className="btn small" onClick={() => toggle(d.id, true)} aria-label={`${d.name} 다시 판매`}>
                  다시 판매
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// 취소되지 않은 주문 기준. 오늘 / 최근 7일 / 메뉴별
function SalesTab({ orders }: { orders: OrderRecord[] }) {
  const [now] = useState(() => Date.now()); // 렌더마다 바뀌지 않게 열 때의 시각으로 계산한다
  const todayStart = new Date(new Date().toDateString()).getTime();
  const valid = orders.filter((o) => o.status !== "취소");
  const today = valid.filter((o) => o.createdAt >= todayStart);
  const week = valid.filter((o) => o.createdAt >= now - 7 * DAY);
  const sum = (list: OrderRecord[]) => list.reduce((a, o) => a + o.order.price, 0);
  const byItem = new Map<string, { qty: number; sales: number }>();
  for (const o of week) {
    const cur = byItem.get(o.order.item) ?? { qty: 0, sales: 0 };
    byItem.set(o.order.item, { qty: cur.qty + o.order.qty, sales: cur.sales + o.order.price });
  }
  const top = [...byItem.entries()].sort((a, b) => b[1].sales - a[1].sales);

  return (
    <>
      <section className="dash-section">
        <div className="tiles">
          <div className="tile">
            <span>오늘 주문</span>
            <b>{today.length}건</b>
          </div>
          <div className="tile">
            <span>오늘 매출</span>
            <b>{won(sum(today))}</b>
          </div>
          <div className="tile">
            <span>최근 7일 주문</span>
            <b>{week.length}건</b>
          </div>
          <div className="tile">
            <span>최근 7일 매출</span>
            <b>{won(sum(week))}</b>
          </div>
        </div>
      </section>
      <section className="dash-section">
        <h2>최근 7일 인기 메뉴</h2>
        {top.length === 0 && <p className="empty">아직 주문이 없어요.</p>}
        <table className="dash-table">
          <thead>
            <tr>
              <th>메뉴</th>
              <th>수량</th>
              <th>매출</th>
            </tr>
          </thead>
          <tbody>
            {top.map(([name, v]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{v.qty}</td>
                <td>{won(v.sales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
