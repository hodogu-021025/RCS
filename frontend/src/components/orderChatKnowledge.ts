// 주문 챗봇의 데모 데이터와 문장 해석 규칙. 실제 매장 검색·결제 API를 붙일 때 이 파일만 바꾸면 된다.

export interface Store {
  name: string;
  distance: string;
}

export interface Order {
  store: Store;
  food: string;
  qty: number;
  price: number;
  address: string;
}

export type PaymentId = "card" | "kakao" | "toss";

export interface PaymentMethod {
  id: PaymentId;
  label: string;
  icon: string;
  theme: string;
  themeText: string;
}

export const STORES: Store[] = [{ name: "하소동 BBQ", distance: "1.2km" }];
export const MENU: Record<string, number> = { 황금올리브: 21000 };
export const ADDRESS = "제천시 장락동 제천빌라 331호";
export const PAYMENTS: PaymentMethod[] = [
  { id: "card", label: "신용카드", icon: "💳", theme: "#1f2937", themeText: "#fff" },
  { id: "kakao", label: "카카오페이", icon: "K", theme: "#fee500", themeText: "#3c1e1e" },
  { id: "toss", label: "토스페이", icon: "T", theme: "#0064ff", themeText: "#fff" },
];

export const SUGGESTIONS = ["근처 BBQ 매장에서 황금올리브 시켜줘", "황금올리브 2마리 주문해줘"];

const MAX_QTY = 10;
const KOREAN_COUNTS: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5 };

const has = (text: string, words: string[]) => {
  const low = text.toLowerCase();
  return words.some((w) => low.includes(w));
};

export const isOrderRequest = (text: string) =>
  has(text, ["시켜", "주문", "배달", "먹고 싶", "먹고싶"]) && has(text, ["황금올리브", "치킨", "bbq", "비비큐"]);

export const isYes = (text: string) =>
  has(text, ["응", "네", "예", "좋아", "해줘", "ㅇㅇ", "그래", "주문해", "콜", "ok", "yes"]);

export const isNo = (text: string) => has(text, ["아니", "취소", "싫어", "안 해", "안해", "no"]);

// "2마리", "두 마리" 같은 수량 표현. 없으면 1마리, 너무 크면 MAX_QTY로 자른다
export function parseQty(text: string): number {
  const digits = text.match(/(\d+)\s*마리/);
  if (digits) return Math.max(1, Math.min(MAX_QTY, parseInt(digits[1], 10)));
  for (const [word, count] of Object.entries(KOREAN_COUNTS)) {
    if (new RegExp(`${word}\\s*마리`).test(text)) return count;
  }
  return 1;
}

// "카카오로 할게", "카드로" 처럼 줄여 말해도 결제수단을 찾는다
export function findPayment(text: string): PaymentMethod | undefined {
  const low = text.toLowerCase();
  return (
    PAYMENTS.find((p) => low.includes(p.label) || low.includes(p.label.replace("페이", ""))) ??
    (low.includes("카드") ? PAYMENTS[0] : undefined)
  );
}

export function makeOrder(qty: number): Order {
  const food = "황금올리브";
  return { store: STORES[0], food, qty, price: MENU[food] * qty, address: ADDRESS };
}

export const won = (n: number) => n.toLocaleString("ko-KR") + "원";

export function completionText(order: Order, method: PaymentMethod, now = new Date()): string {
  const orderNo = "BBQ" + String(now.getTime()).slice(-6);
  const eta = new Date(now.getTime() + 40 * 60_000);
  const hhmm = `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`;
  return (
    `${method.label}로 ${won(order.price)} 결제가 완료되었어요! 🎉\n\n` +
    `주문번호: ${orderNo}\n` +
    `${order.store.name}에서 ${order.food} ${order.qty}마리를 준비 중이에요.\n` +
    `도착 예정: 약 40분 후 (${hhmm})`
  );
}
