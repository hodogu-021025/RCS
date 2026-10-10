// 가게·메뉴 목록 (catalog.json, 화면과 같이 쓰는 파일)과 상태 값. 실제 목록이 오면 catalog.json 만 바꾼다
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));

export const RESTAURANTS = catalog.restaurants;
export const DELIVERY_MENU = catalog.deliveryMenu;
// 사장님 계정·주문·예약에 쓸 수 있는 매장 id
export const STORE_IDS = new Set(RESTAURANTS.map((r) => r.id));
export const restaurantName = (id) => RESTAURANTS.find((r) => r.id === id)?.name;

// 주문한 메뉴: 그 매장의 그 이름 메뉴
export const findMenuItem = (storeId, name) => DELIVERY_MENU.find((d) => d.restaurantId === storeId && d.name === name);

export const ORDER_STATUSES = new Set(["접수", "준비 중", "완료", "취소"]);
export const RESERVATION_STATUSES = new Set(["예약 확정", "방문 완료", "취소"]);
export const MAX_PEOPLE = 20;
export const MAX_QTY = 10;
