import { choicesText, itemText, won, type OrderItem } from "../components/orderChatKnowledge";

// 주문 카드의 "메뉴" 줄 (사장님·관리자 화면): 담은 메뉴를 한 줄씩 금액과 함께, 세트의 고른 맛은 그 메뉴 바로 아래에
export function OrderLines({ items }: { items: OrderItem[] }) {
  return (
    <ul className="order-lines">
      {items.map((l, i) => (
        <li key={i}>
          <span className="order-line-name">{itemText(l)}</span>
          <span className="order-line-price">{won(l.price)}</span>
          {l.choices?.length ? (
            <span className="order-line-choices">
              {l.choiceLabel ?? "맛"}: {choicesText(l.choices)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
