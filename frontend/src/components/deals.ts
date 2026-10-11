// 할인과 오늘의 메뉴. 사장님이 사장님 화면에서 정하고(매장 설정), 챗봇은 추천 순서와 가격에 반영한다.
// 계산 규칙은 서버(server/stores.mjs)와 같다: 실제 결제 금액은 서버가 다시 계산한다
import { getStoreSettings } from "../data/db";

export const DISCOUNT_MAX = 90; // 할인율 상한 (%)

// 할인한 1단위 가격. 10원 단위로 반올림한다
export const discountedPrice = (price: number, pct: number) => (pct > 0 ? Math.round((price * (100 - pct)) / 100 / 10) * 10 : price);

// 한국 날짜 "YYYY-MM-DD" (오늘의 메뉴는 그날 자정까지만)
export const todayKST = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);

// 그 매장의 오늘의 메뉴 id (오늘 날짜로 정한 것만. 지난 날짜면 없다)
export function specialItemId(storeId: string, now = new Date()): string | undefined {
  const special = getStoreSettings(storeId).special;
  return special && special.date === todayKST(now) ? special.itemId : undefined;
}
