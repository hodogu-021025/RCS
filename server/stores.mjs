// 가게·메뉴 목록 (catalog.json, 화면과 같이 쓰는 파일)과 상태 값. 실제 목록이 오면 catalog.json 만 바꾼다.
// 배달 메뉴는 서버가 켜질 때 DB(menu_items)로 옮겨 담고, 그 뒤로는 DB 가 기준이다 (사장님이 메뉴를 추가·판매 중지할 수 있게).
// DB 의 지금 목록을 catalog.json 으로 되돌려 쓰려면 export-catalog.mjs 를 쓴다
// 테스트는 SAYLO_CATALOG 로 예시 가게가 여러 곳 든 고정 목록(test/catalog.fixture.json)을 읽는다 (경로는 server/ 기준)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// (test.env 가 CRLF 로 받아져도 경로 끝에 \r 이 붙지 않게 앞뒤 공백을 지운다)
const catalogPath = resolve(dirname(fileURLToPath(import.meta.url)), process.env.SAYLO_CATALOG?.trim() || "catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

export const RESTAURANTS = catalog.restaurants;
export const DELIVERY_MENU = catalog.deliveryMenu; // 처음 목록 (DB 에 없는 것만 채워 넣는다)
// 사장님 계정·주문·예약에 쓸 수 있는 매장 id
export const STORE_IDS = new Set(RESTAURANTS.map((r) => r.id));
export const restaurantName = (id) => RESTAURANTS.find((r) => r.id === id)?.name;
export const FOOD_KEYS = new Set(catalog.foods.map((f) => f.key));
export const foodLabel = (food) => catalog.foods.find((f) => f.key === food)?.label;

// ---- 목록 파일의 매장 + 관리자가 직접 만든 매장(DB stores) ----
// 목록 파일에 같은 id 가 있으면 목록 파일 것을 쓴다 (내보낸 목록을 catalog.json 으로 다시 커밋해도 두 번 나오지 않게)
export const allStores = (db) => [...RESTAURANTS, ...db.listStores().filter((s) => !STORE_IDS.has(s.id))];
export const findStore = (db, id) => RESTAURANTS.find((r) => r.id === id) ?? db.storeById(String(id ?? "")) ?? undefined;
export const hasStore = (db, id) => findStore(db, id) !== undefined;

// 관리자가 새로 만드는 매장 { name, food, hours?, address? } 를 검사해 정리한 값을 돌려준다. 문제가 있으면 { error }
// 거리·평점은 받지 않는다 (모르는 값을 지어내지 않는다). 영업시간을 비우면 11:00 - 21:00 으로 시작하고, 사장님이 사장님 화면에서 바꾼다
export const STORE_NAME_MAX = 30;
export const STORE_ADDRESS_MAX = 100;
export const DEFAULT_HOURS = "11:00 - 21:00";
export function cleanNewStore(input) {
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > STORE_NAME_MAX) return { error: `매장 이름을 1~${STORE_NAME_MAX}자로 적어 주세요.` };
  const food = String(input?.food ?? "");
  if (!FOOD_KEYS.has(food)) return { error: "음식 종류를 골라 주세요." };
  const hours = String(input?.hours ?? "").trim() || DEFAULT_HOURS;
  const hoursProblem = hoursError(hours);
  if (hoursProblem) return { error: hoursProblem };
  const address = String(input?.address ?? "").trim().replace(/\s+/g, " ");
  if (address.length > STORE_ADDRESS_MAX) return { error: `주소는 ${STORE_ADDRESS_MAX}자까지 적을 수 있어요.` };
  return { name, food, hours, ...(address ? { address } : {}) };
}
// 이름 비교용 (띄어쓰기·대소문자 차이는 같은 이름으로 본다)
export const sameStoreName = (a, b) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

// 결제는 계좌이체 하나. 주문하면 "입금 대기"로 들어오고, 사장님이 통장을 보고 입금을 확인하면 "접수"가 돼 준비를 시작한다.
// 입금 기한(PAY_WINDOW_MS) 안에 확인되지 않으면 서버가 자동으로 취소한다
export const PAYMENT_METHOD = "계좌이체";
export const PAY_WINDOW_MS = 30 * 60_000;
// 모의 결제 (자체 테스트용): 실제로 돈이 오가지 않는다. 손님이 화면의 결제 창에서 결제를 마치면 바로 "접수"로 들어온다.
// 주문 기록의 결제수단은 "카카오페이 (모의 결제)"처럼 남겨 사장님·관리자가 진짜 결제와 헷갈리지 않게 한다
export const MOCK_PAYMENTS = ["신용카드", "카카오페이", "토스페이"];
export const mockPaymentName = (method) => `${method} (모의 결제)`;
export const isMockPayment = (payment) => String(payment ?? "").endsWith("(모의 결제)");
export const ORDER_STATUSES = new Set(["입금 대기", "접수", "준비 중", "완료", "취소"]);
export const RESERVATION_STATUSES = new Set(["예약 확정", "방문 완료", "취소"]);
// 사장님이 바꿀 수 있는 다음 상태 (끝난 주문·예약은 되돌리지 못한다)
export const ORDER_NEXT = { "입금 대기": ["접수", "취소"], 접수: ["준비 중", "취소"], "준비 중": ["완료", "취소"], 완료: [], 취소: [] };
// 고객님이 직접 취소할 수 있는 상태 (가게가 준비를 시작하기 전)
export const CUSTOMER_CANCELABLE = new Set(["입금 대기", "접수"]);

// 입금 계좌 { bank, account, holder } 를 검사해 정리한 값을 돌려준다. 문제가 있으면 { error }
// 계좌번호는 숫자와 '-'만, 숫자 8~16자리 (은행마다 자릿수가 달라 넉넉히 받는다)
export function cleanBankAccount(input) {
  const bank = String(input?.bank ?? "").trim();
  const account = String(input?.account ?? "").replace(/\s+/g, "");
  const holder = String(input?.holder ?? "").trim().replace(/\s+/g, " ");
  if (bank.length < 2 || bank.length > 20) return { error: "은행을 골라 주세요." };
  const digits = account.replace(/-/g, "");
  if (!/^[0-9-]+$/.test(account) || digits.length < 8 || digits.length > 16) return { error: "계좌번호는 숫자 8~16자리로 적어 주세요. ('-'는 넣어도 돼요)" };
  if (!holder || holder.length > 20) return { error: "예금주를 1~20자로 적어 주세요." };
  return { bank, account, holder };
}
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

// ---- 일시 중지: 사장님이 정한 시각까지 새 배달 주문과 오늘 예약을 받지 않는다. 그 시각이 지나면 저절로 다시 받는다 ----
export const PAUSE_MAX_MS = 24 * 60 * 60_000; // 한 번에 최대 24시간 뒤까지
// 지금 멈춘 중인지: 시작 시각(없으면 바로)이 지났고 끝나는 시각 전. 미리 정해 둔 일시 중지는 시작 전까지 주문을 받는다
export const isPaused = (settings, now = Date.now()) => (settings?.pausedFrom ?? 0) <= now && (settings?.pausedUntil ?? 0) > now;
// 한국 시각 "15:30"
export const timeKST = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
// 받침에 맞춘 은/는 ("장락 옛날통닭은", "장락 떡볶이는"). 한글로 끝나지 않으면 둘 다 적는다
export function withTopic(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}은(는)`;
  return word + (code % 28 ? "은" : "는");
}
// 받침에 맞춘 을/를 ("맛을", "토핑을", "소스를")
export function withObject(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}을(를)`;
  return word + (code % 28 ? "을" : "를");
}
// 일시 중지가 끝나는 때: 오늘이면 "15:30", 내일이면 "내일 09:00" (한국 날짜 기준)
export const pauseEndText = (until, now = Date.now()) => `${todayKST(new Date(until)) === todayKST(new Date(now)) ? "" : "내일 "}${timeKST(until)}`;

// 메뉴 입력 규칙 (화면 frontend/src/pages/OwnerPage.tsx 도 같은 범위로 미리 검사한다)
export const MENU_NAME_MAX = 30;
export const MENU_PRICE_MIN = 100;
export const MENU_PRICE_MAX = 1_000_000;
export const MENU_UNIT_MAX = 6;
export const MENU_KEYWORDS_MAX = 10;

// ---- 세트 메뉴의 맛 고르기 ----
// 메뉴의 choice { label: "맛", count: 2, options: [{ name: "간장 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }, ...] }:
// 1세트에 서로 다른 맛 count 가지를 options 중에서 하나씩 고르고, 고른 맛의 추가금(extra)을 세트 값에 더한다.
// 여러 세트를 주문하면 세트 수 × count 가지를 고른다 (같은 맛은 한 번만)
export const CHOICE_OPTIONS_MAX = 40;
export const CHOICE_COUNT_MAX = 10;
export const CHOICE_EXTRA_MAX = 100_000;
export const CHOICE_LABEL_MAX = 10;

// 메뉴 목록 파일이나 사장님 화면이 보낸 choice 를 검사해 정리한 값을 돌려준다. 문제가 있으면 { error } (사장님 화면에 그대로 보여 주는 문장)
// (화면 frontend/src/pages/menuChoice.ts 도 같은 규칙으로 미리 검사한다)
export function cleanChoice(input) {
  const label = String(input?.label ?? "맛").trim().replace(/\s+/g, " ") || "맛";
  const count = Number(input?.count);
  const raw = Array.isArray(input?.options) ? input.options : [];
  const options = raw.map((o) => ({ name: String(o?.name ?? "").trim().replace(/\s+/g, " "), extra: Number(o?.extra ?? 0) }));
  if (label.length > CHOICE_LABEL_MAX) return { error: `고르기 이름은 ${CHOICE_LABEL_MAX}자까지 적을 수 있어요.` };
  if (!Number.isInteger(count) || count < 1 || count > CHOICE_COUNT_MAX) return { error: `1세트에 고를 수는 1~${CHOICE_COUNT_MAX} 사이로 적어 주세요.` };
  if (options.length > CHOICE_OPTIONS_MAX) return { error: `${withTopic(label)} ${CHOICE_OPTIONS_MAX}가지까지 적을 수 있어요.` };
  if (options.length < count) return { error: `${withObject(label)} 고를 수(${count}가지)만큼은 적어 주세요.` };
  if (options.some((o) => !o.name || o.name.length > MENU_NAME_MAX)) return { error: `${label} 이름을 1~${MENU_NAME_MAX}자로 적어 주세요.` };
  if (new Set(options.map((o) => o.name)).size !== options.length) return { error: `같은 ${label} 이름이 두 번 있어요.` };
  if (options.some((o) => !Number.isInteger(o.extra) || o.extra < 0 || o.extra > CHOICE_EXTRA_MAX)) return { error: `추가금은 0~${CHOICE_EXTRA_MAX.toLocaleString("ko-KR")}원 사이 정수로 적어 주세요.` };
  return { label, count, options };
}

// 손님이 고른 맛(이름 배열)을 검사한다. 세트 수 × count 가지를, 메뉴의 options 안에서 서로 다르게.
// 돌려주는 값: { choices: [{ name, extra }], extra: 추가금 합계 }. 문제가 있으면 { error }
export function pickedChoices(choice, picked, qty) {
  const need = choice.count * qty;
  const names = Array.isArray(picked) ? picked.map((n) => String(typeof n === "object" && n ? n.name : n).trim()) : [];
  if (names.length !== need) return { error: `${choice.label}을(를) ${need}가지 골라 주세요.` };
  if (new Set(names).size !== names.length) return { error: `같은 ${choice.label}은(는) 한 번만 고를 수 있어요.` };
  const choices = [];
  for (const name of names) {
    const option = choice.options.find((o) => o.name === name);
    if (!option) return { error: `${name}은(는) 고를 수 없는 ${choice.label}이에요.` };
    choices.push({ name: option.name, extra: option.extra });
  }
  return { choices, extra: choices.reduce((sum, c) => sum + c.extra, 0) };
}

// DB 의 배달 메뉴 중 지금 있는 매장(목록 파일 + 관리자가 만든 매장)의 것만. 목록 파일에서 빠진 가게의 메뉴는 DB 에 남아 있어도 보이지 않는다
export const listedMenu = (db) => {
  const ids = new Set(allStores(db).map((s) => s.id));
  return db.listMenu().filter((d) => ids.has(d.restaurantId));
};

// DB 의 매장·메뉴 목록을 catalog.json 모양으로 (관리자가 만든 매장 포함, 사장님이 바꾼 가격은 그 가격으로, 판매 중지한 메뉴는 active: false, 세트 메뉴는 맛 고르기 choice 포함)
export function catalogWithMenu(db) {
  const restaurants = allStores(db).map(({ source: _source, ...s }) => s);
  const settings = db.allStoreSettings();
  const deliveryMenu = listedMenu(db).map((d) => ({
    id: d.id,
    name: d.name,
    restaurantId: d.restaurantId,
    price: settings[d.restaurantId]?.items?.[d.id]?.price ?? d.price,
    unit: d.unit,
    keywords: d.keywords,
    ...(d.choice ? { choice: d.choice } : {}), // 세트 메뉴의 맛 고르기 (사장님이 화면에서 넣은 것도)
    ...(d.active ? {} : { active: false }),
  }));
  return { ...catalog, restaurants, deliveryMenu };
}
