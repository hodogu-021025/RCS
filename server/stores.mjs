// 사장님 계정을 만들 수 있는 매장 id. 화면의 식당 목록(frontend/src/components/orderChatKnowledge.ts RESTAURANTS)과 같은 id 를 쓴다.
// 식당을 추가하면 양쪽에 같이 적는다
export const STORE_IDS = new Set([
  "k1", "k2", "k3", // 한식
  "c1", "c2", "c3", // 중식
  "j1", "j2", "j3", // 일식
  "h1", "h3", // 치킨
  "p1", "p2", // 피자
  "m1", "m2", "m3", // 고기
  "s1", "s2", // 분식
]);

export const ORDER_STATUSES = new Set(["접수", "준비 중", "완료", "취소"]);
export const RESERVATION_STATUSES = new Set(["예약 확정", "방문 완료", "취소"]);
export const MAX_PEOPLE = 20;
export const MAX_QTY = 10;
