import { useEffect, useState } from "react";
import { useSession } from "../auth/auth";
import { DELIVERY_MENU, formatDate, restaurantById, won } from "../components/orderChatKnowledge";
import {
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

export function OwnerPage() {
  const session = useSession()!;
  const db = useDb();
  const store = restaurantById(session.storeId!);
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

// 영업시간과 배달 메뉴(가격·품절). 바꾸면 소비자 챗봇에 바로 반영된다
function StoreTab({ storeId, hours }: { storeId: string; hours: string }) {
  const db = useDb();
  // 자정 마감은 데이터에 "24:00"으로 적혀 있지만 시간 입력칸은 "00:00"까지만 받는다 (예약 시간 계산은 둘 다 자정으로 본다)
  const [open, close] = hours.split("-").map((s) => s.trim()).map((t) => (t === "24:00" ? "00:00" : t));
  const items = DELIVERY_MENU.filter((d) => d.restaurantId === storeId);
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
              </li>
            );
          })}
        </ul>
      </section>
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
