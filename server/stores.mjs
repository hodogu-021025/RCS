// 가게·메뉴 목록 (catalog.json, 화면과 같이 쓰는 파일)과 상태 값. 실제 목록이 오면 catalog.json 만 바꾼다.
// 배달 메뉴는 서버가 켜질 때 DB(menu_items)로 옮겨 담고, 그 뒤로는 DB 가 기준이다 (사장님이 메뉴를 추가·판매 중지할 수 있게).
// DB 의 지금 목록을 catalog.json 으로 되돌려 쓰려면 export-catalog.mjs 를 쓴다
import catalog from "./catalog.json" with { type: "json" };

export const RESTAURANTS = catalog.restaurants;
export const DELIVERY_MENU = catalog.deliveryMenu; // 처음 목록 (DB 에 없는 것만 채워 넣는다)
// 사장님 계정·주문·예약에 쓸 수 있는 매장 id
export const STORE_IDS = new Set(RESTAURANTS.map((r) => r.id));
export const restaurantName = (id) => RESTAURANTS.find((r) => r.id === id)?.name;
// 매장의 음식 종류 이름 ("치킨", "피자"). 사장님이 추가한 메뉴도 이 말로 찾을 수 있게 키워드에 넣는다
export const foodLabelOf = (storeId) => {
  const food = RESTAURANTS.find((r) => r.id === storeId)?.food;
  return catalog.foods.find((f) => f.key === food)?.label;
};

export const ORDER_STATUSES = new Set(["접수", "준비 중", "완료", "취소"]);
export const RESERVATION_STATUSES = new Set(["예약 확정", "방문 완료", "취소"]);
// 사장님이 바꿀 수 있는 다음 상태 (끝난 주문·예약은 되돌리지 못한다)
export const ORDER_NEXT = { 접수: ["준비 중", "취소"], "준비 중": ["완료", "취소"], 완료: [], 취소: [] };
export const RESERVATION_NEXT = { "예약 확정": ["방문 완료", "취소"], "방문 완료": [], 취소: [] };

// 영업시간 "HH:MM - HH:MM": 시는 00~23 (닫는 시간은 24:00 가능), 분은 00~59, 여는 시간과 닫는 시간이 같으면 안 된다
export function hoursError(hours) {
  const m = /^(\d{2}):(\d{2}) - (\d{2}):(\d{2})$/.exec(String(hours ?? ""));
  if (!m) return "영업시간 형식이 맞지 않아요.";
  const [oh, om, ch, cm] = m.slice(1).map(Number);
  if (oh > 23 || om > 59 || cm > 59 || ch > 24 || (ch === 24 && cm > 0)) return "영업시간은 00:00부터 24:00 사이로 적어 주세요.";
  if (oh * 60 + om === (ch % 24) * 60 + cm) return "여는 시간과 닫는 시간이 같을 수 없어요.";
  return null;
}
export const MAX_PEOPLE = 20;
export const MAX_QTY = 10;

// ---- 할인·오늘의 메뉴 (화면 frontend/src/components/deals.ts 도 같은 규칙) ----
export const DISCOUNT_MAX = 90; // 할인율 상한 (%)
// 할인한 1단위 가격. 10원 단위로 반올림한다
export const discountedPrice = (price, pct) => (pct > 0 ? Math.round((price * (100 - pct)) / 100 / 10) * 10 : price);
// 한국 날짜 "YYYY-MM-DD" (오늘의 메뉴는 그날 자정까지만)
export const todayKST = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);

// 메뉴 입력 규칙 (화면 frontend/src/pages/OwnerPage.tsx 도 같은 범위로 미리 검사한다)
export const MENU_NAME_MAX = 30;
export const MENU_PRICE_MIN = 100;
export const MENU_PRICE_MAX = 1_000_000;
export const MENU_UNIT_MAX = 6;
export const MENU_KEYWORDS_MAX = 10;

// DB 의 메뉴 목록을 catalog.json 모양으로 (사장님이 바꾼 가격은 그 가격으로, 판매 중지한 메뉴는 active: false)
export function catalogWithMenu(db) {
  const settings = db.allStoreSettings();
  const deliveryMenu = db.listMenu().map((d) => ({
    id: d.id,
    name: d.name,
    restaurantId: d.restaurantId,
    price: settings[d.restaurantId]?.items?.[d.id]?.price ?? d.price,
    unit: d.unit,
    keywords: d.keywords,
    ...(d.active ? {} : { active: false }),
  }));
  return { ...catalog, deliveryMenu };
}
