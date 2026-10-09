// 처음 열었을 때 사장님·관리자 화면이 비어 보이지 않게 넣는 보기용 기록. 모두 가상 데이터다
import { DELIVERY_MENU, makeOrder } from "../components/orderChatKnowledge";
import { PRODUCTS, makeShopOrder } from "../components/shoppingKnowledge";
import { SHOWS, makeTicketOrder } from "../components/ticketKnowledge";
import { toDateKey, type OrderRecord, type ReservationRecord } from "./db";

const HOUR = 3_600_000;
const item = (name: string) => DELIVERY_MENU.find((d) => d.name === name)!;

export function makeDemoRecords(now = Date.now()): { orders: OrderRecord[]; reservations: ReservationRecord[] } {
  const ago = (hours: number) => now - hours * HOUR;
  const orders: OrderRecord[] = [
    { id: "seed-o1", createdAt: ago(0.3), status: "접수", customer: "guest", customerName: "비회원", payment: "카카오페이", storeId: "h3", order: makeOrder(item("간장치킨"), 2) },
    { id: "seed-o2", createdAt: ago(2), status: "준비 중", customer: "user", customerName: "김소비", payment: "신용카드", storeId: "h3", order: makeOrder(item("간장치킨"), 1) },
    { id: "seed-o3", createdAt: ago(26), status: "완료", customer: "user", customerName: "김소비", payment: "토스페이", storeId: "h3", order: makeOrder(item("간장치킨"), 3) },
    { id: "seed-o4", createdAt: ago(5), status: "완료", customer: "guest", customerName: "비회원", payment: "카카오페이", storeId: "h1", order: makeOrder(item("옛날통닭"), 1) },
    { id: "seed-o5", createdAt: ago(30), status: "취소", customer: "guest", customerName: "비회원", payment: "신용카드", storeId: "s1", order: makeOrder(item("국물떡볶이"), 2) },
    { id: "seed-o6", createdAt: ago(50), status: "완료", customer: "user", customerName: "김소비", payment: "토스페이", storeId: "brand:스텝업", order: makeShopOrder(PRODUCTS.find((p) => p.id === "s2")!, "260", 1) },
    { id: "seed-o7", createdAt: ago(74), status: "완료", customer: "guest", customerName: "비회원", payment: "카카오페이", storeId: "venue:제천 시네마 1관", order: makeTicketOrder(SHOWS[0], new Date(now + 24 * HOUR), "19:00", 2) },
  ];
  const tomorrow = new Date(now + 24 * HOUR);
  const reservations: ReservationRecord[] = [
    { id: "seed-r1", createdAt: ago(1), status: "예약 확정", customer: "user", customerName: "김소비", restaurantId: "h3", restaurantName: "청전 치킨공방", date: toDateKey(tomorrow), time: "19:00", people: 4 },
    { id: "seed-r2", createdAt: ago(28), status: "방문 완료", customer: "guest", customerName: "비회원", restaurantId: "c1", restaurantName: "장락반점", date: toDateKey(new Date(now - 24 * HOUR)), time: "12:30", people: 2 },
  ];
  return { orders, reservations };
}
