import { useState } from "react";
import { useSession } from "../auth/auth";
import { CopyButton } from "../components/CopyButton";
import { TelLink } from "../components/TelLink";
import { accountDigits, formatDate, untilText, orderCardRows, orderPriceLabel } from "../components/orderChatKnowledge";
import { cancelMyOrder, useDb, type OrderRecord } from "../data/db";
import { DashLayout } from "./DashLayout";
import { formatDateTime, statusClass } from "./format";

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
            <OrderItem key={o.id} record={o} />
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
                <span className={statusClass(r.status)}>{r.status}</span>
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

      <a className="btn primary wide" href="#/chat">
        챗봇으로 돌아가기
      </a>
    </DashLayout>
  );
}

// 주문 한 건. 입금 대기면 입금 계좌(복사)·금액·기한을, 자동 취소됐으면 이유를 보여 주고, 준비 시작 전에는 취소할 수 있다
function OrderItem({ record: o }: { record: OrderRecord }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { bank, depositor, payBy, cancelNote } = o.order;
  // 주문서 줄 중 가격·결제 안내는 아래 "결제" 줄로 합친다
  const rows = orderCardRows(o.order).filter((r) => r.label !== "가격" && r.label !== "결제");

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelMyOrder(o.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={"record" + (o.status === "입금 대기" ? " pending" : "")}>
      <div className="record-head">
        <b>
          {o.order.item} {o.order.qty}
          {o.order.unit}
        </b>
        <span className={statusClass(o.status)}>{o.status}</span>
      </div>
      <dl>
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
        {o.order.storePhone && (
          <div>
            <dt>가게 전화</dt>
            <dd>
              <TelLink phone={o.order.storePhone} />
            </dd>
          </div>
        )}
        <div>
          <dt>결제</dt>
          <dd className="price">
            {o.payment} · {orderPriceLabel(o.order)}
          </dd>
        </div>
        {o.status === "입금 대기" && bank && (
          <>
            <div>
              <dt>입금 계좌</dt>
              <dd>
                {bank.bank} {bank.account}
                <CopyButton text={accountDigits(bank.account)} label="계좌번호 복사" />
              </dd>
            </div>
            <div>
              <dt>예금주</dt>
              <dd>{bank.holder}</dd>
            </div>
            {depositor && (
              <div>
                <dt>입금자명</dt>
                <dd>{depositor}</dd>
              </div>
            )}
            {payBy && (
              <div>
                <dt>입금 기한</dt>
                <dd>{untilText(payBy)}까지 (지나면 자동 취소)</dd>
              </div>
            )}
          </>
        )}
        {o.status === "취소" && cancelNote && (
          <div>
            <dt>취소 이유</dt>
            <dd>{cancelNote}</dd>
          </div>
        )}
        <div>
          <dt>주문 시각</dt>
          <dd>{formatDateTime(o.createdAt)}</dd>
        </div>
      </dl>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {o.status === "접수" && <p className="hint">입금이 확인된 주문이에요. 취소하면 가게에서 입금하신 금액을 돌려드려요.</p>}
      {(o.status === "입금 대기" || o.status === "접수") && (
        <div className="record-actions">
          <button type="button" className="btn small" disabled={busy} onClick={() => void cancel()}>
            주문 취소
          </button>
        </div>
      )}
    </li>
  );
}
