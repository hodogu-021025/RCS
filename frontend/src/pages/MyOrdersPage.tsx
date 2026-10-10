import { useSession } from "../auth/auth";
import { formatDate, orderCardRows, won } from "../components/orderChatKnowledge";
import { useDb } from "../data/db";
import { DashLayout } from "./DashLayout";
import { formatDateTime } from "./format";


// 로그인한 사람의 주문·예약 내역
export function MyOrdersPage() {
  const session = useSession()!;
  const db = useDb();
  const orders = db.orders.filter((o) => o.customer === session.username);
  const reservations = db.reservations.filter((r) => r.customer === session.username);

  return (
    <DashLayout title="내 주문">
      <section className="dash-section">
        <h2>주문 ({orders.length})</h2>
        {orders.length === 0 && <p className="empty">아직 주문이 없어요. 챗봇에서 주문하면 여기에 남아요.</p>}
        <ul className="record-list">
          {orders.map((o) => (
            <li key={o.id} className="record">
              <div className="record-head">
                <b>
                  {o.order.item} {o.order.qty}
                  {o.order.unit}
                </b>
                <span className={"status s-" + o.status}>{o.status}</span>
              </div>
              <dl>
                {orderCardRows(o.order).map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}</dt>
                    <dd className={r.emphasis ? "price" : undefined}>{r.value}</dd>
                  </div>
                ))}
                <div>
                  <dt>결제</dt>
                  <dd>
                    {o.payment} · {won(o.order.price)}
                  </dd>
                </div>
                <div>
                  <dt>주문 시각</dt>
                  <dd>{formatDateTime(o.createdAt)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section className="dash-section">
        <h2>식당 예약 ({reservations.length})</h2>
        {reservations.length === 0 && <p className="empty">예약이 없어요.</p>}
        <ul className="record-list">
          {reservations.map((r) => (
            <li key={r.id} className="record">
              <div className="record-head">
                <span className="chip kind-reservation">식당 예약</span>
                <b>{r.restaurantName}</b>
                <span className={"status s-" + r.status}>{r.status}</span>
              </div>
              <dl>
                <div>
                  <dt>일시</dt>
                  <dd>
                    {formatDate(new Date(r.date))} {r.time}
                  </dd>
                </div>
                <div>
                  <dt>인원</dt>
                  <dd>{r.people}명</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <a className="btn primary" href="#/chat">
        챗봇으로 돌아가기
      </a>
    </DashLayout>
  );
}
