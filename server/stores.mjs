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
export const MAX_PEOPLE = 20;
export const MAX_QTY = 10;

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
