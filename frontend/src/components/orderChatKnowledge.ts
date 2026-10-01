// 주문 챗봇의 데모 데이터와 문장 해석 규칙. 실제 매장 검색·결제 API를 붙일 때 이 파일만 바꾸면 된다.

export interface Store {
  name: string;
  distance: string;
}

export type Unit = "마리" | "판" | "인분";

export interface Order {
  store: Store;
  food: string;
  qty: number;
  unit: Unit;
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

export const ADDRESS = "제천시 장락동 제천빌라 331호";
export const PAYMENTS: PaymentMethod[] = [
  { id: "card", label: "신용카드", icon: "카드", theme: "#1f2937", themeText: "#fff" },
  { id: "kakao", label: "카카오페이", icon: "K", theme: "#fee500", themeText: "#3c1e1e" },
  { id: "toss", label: "토스페이", icon: "T", theme: "#0064ff", themeText: "#fff" },
];

// ---- 식당 찾기 ----
// 근처(장락동 기준) 식당 데모 데이터. 모두 화면 확인용 가상 식당이다.

export type FoodKey = "korean" | "chinese" | "japanese" | "chicken" | "pizza" | "meat" | "snack";

export interface FoodCategory {
  key: FoodKey;
  label: string;
  keywords: string[];
}

export interface Restaurant {
  id: string;
  name: string;
  food: FoodKey;
  distanceKm: number;
  rating: number;
  signature: string;
  hours: string;
  address: string;
}

// 카테고리 이름뿐 아니라 "짬뽕", "삼겹살" 같은 메뉴 이름으로 말해도 찾도록 키워드를 둔다
export const FOODS: FoodCategory[] = [
  { key: "korean", label: "한식", keywords: ["한식", "국밥", "백반", "찌개", "정식", "비빔밥", "칼국수"] },
  { key: "chinese", label: "중식", keywords: ["중식", "중국", "짜장", "짬뽕", "탕수육"] },
  { key: "japanese", label: "일식", keywords: ["일식", "초밥", "스시", "돈까스", "돈가스", "라멘", "우동"] },
  { key: "chicken", label: "치킨", keywords: ["치킨", "통닭", "닭강정"] },
  { key: "pizza", label: "피자", keywords: ["피자"] },
  { key: "meat", label: "고기", keywords: ["고기", "삼겹살", "갈비", "한우", "소고기", "돼지고기", "고깃집"] },
  { key: "snack", label: "분식", keywords: ["분식", "떡볶이", "김밥", "순대", "튀김"] },
];

export const RESTAURANTS: Restaurant[] = [
  { id: "k1", name: "장락 할매국밥", food: "korean", distanceKm: 0.3, rating: 4.5, signature: "순대국밥", hours: "07:00 - 21:00", address: "제천시 장락동 12-3" },
  { id: "k2", name: "하소 한상차림", food: "korean", distanceKm: 0.8, rating: 4.7, signature: "제육 정식", hours: "10:30 - 21:00", address: "제천시 하소동 45-1" },
  { id: "k3", name: "청전 된장마을", food: "korean", distanceKm: 1.6, rating: 4.3, signature: "된장찌개 정식", hours: "11:00 - 20:30", address: "제천시 청전동 88-2" },
  { id: "c1", name: "장락반점", food: "chinese", distanceKm: 0.5, rating: 4.4, signature: "삼선짬뽕", hours: "11:00 - 21:00", address: "제천시 장락동 30-7" },
  { id: "c2", name: "하소 만리향", food: "chinese", distanceKm: 1.1, rating: 4.6, signature: "찹쌀탕수육", hours: "11:00 - 21:30", address: "제천시 하소동 102-4" },
  { id: "c3", name: "중앙 차이나", food: "chinese", distanceKm: 2.0, rating: 4.2, signature: "간짜장", hours: "10:30 - 20:00", address: "제천시 중앙로2가 15" },
  { id: "j1", name: "장락 스시하루", food: "japanese", distanceKm: 0.7, rating: 4.6, signature: "모둠초밥", hours: "11:30 - 21:30", address: "제천시 장락동 51-9" },
  { id: "j2", name: "하소 카츠야", food: "japanese", distanceKm: 1.3, rating: 4.4, signature: "등심돈까스", hours: "11:00 - 20:30", address: "제천시 하소동 77-3" },
  { id: "j3", name: "제천 라멘공방", food: "japanese", distanceKm: 2.2, rating: 4.3, signature: "돈코츠라멘", hours: "11:30 - 21:00", address: "제천시 의림대로 210" },
  { id: "h1", name: "장락 옛날통닭", food: "chicken", distanceKm: 0.4, rating: 4.5, signature: "옛날통닭", hours: "15:00 - 24:00", address: "제천시 장락동 8-14" },
  { id: "h3", name: "청전 치킨공방", food: "chicken", distanceKm: 1.8, rating: 4.2, signature: "간장치킨", hours: "16:00 - 01:00", address: "제천시 청전동 23-5" },
  { id: "p1", name: "장락 화덕피자", food: "pizza", distanceKm: 0.6, rating: 4.6, signature: "마르게리따", hours: "11:30 - 21:00", address: "제천시 장락동 40-1" },
  { id: "p2", name: "하소 피자키친", food: "pizza", distanceKm: 1.5, rating: 4.3, signature: "고구마피자", hours: "11:00 - 22:00", address: "제천시 하소동 91-6" },
  { id: "m1", name: "장락 숯불갈비", food: "meat", distanceKm: 0.9, rating: 4.7, signature: "양념 돼지갈비", hours: "16:00 - 23:00", address: "제천시 장락동 66-2" },
  { id: "m2", name: "하소 한우마을", food: "meat", distanceKm: 1.4, rating: 4.5, signature: "한우 등심", hours: "11:30 - 22:00", address: "제천시 하소동 120-8" },
  { id: "m3", name: "청전 삼겹살집", food: "meat", distanceKm: 1.9, rating: 4.4, signature: "생삼겹살", hours: "16:00 - 24:00", address: "제천시 청전동 54-3" },
  { id: "s1", name: "장락 떡볶이", food: "snack", distanceKm: 0.2, rating: 4.4, signature: "국물떡볶이", hours: "10:00 - 21:00", address: "제천시 장락동 5-11" },
  { id: "s2", name: "하소 꼬마김밥", food: "snack", distanceKm: 0.9, rating: 4.3, signature: "참치김밥", hours: "07:30 - 20:00", address: "제천시 하소동 33-7" },
];

export function matchFood(text: string): FoodCategory | undefined {
  const low = text.toLowerCase();
  return FOODS.find((f) => f.keywords.some((k) => low.includes(k)));
}

// 해당 음식을 다루는 식당을 가까운 순으로
export function nearbyRestaurants(food: FoodKey): Restaurant[] {
  return RESTAURANTS.filter((r) => r.food === food).sort((a, b) => a.distanceKm - b.distanceKm);
}

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

// 목록 버튼을 누르거나 식당 이름을 입력하면 고른 것으로 본다 (띄어쓰기는 무시)
export function findRestaurant(text: string, list: Restaurant[]): Restaurant | undefined {
  const typed = squash(text);
  return list.find((r) => typed.includes(squash(r.name)));
}

const restaurantById = (id: string) => RESTAURANTS.find((r) => r.id === id)!;

export const km = (distanceKm: number) => `${distanceKm.toFixed(1)}km`;

// 받침에 따라 조사를 고른다 (을/를, 은/는). 마지막 글자가 한글이 아니면 둘 다 적는다
function withParticle(word: string, afterConsonant: string, afterVowel: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}${afterConsonant}(${afterVowel})`;
  return word + (code % 28 === 0 ? afterVowel : afterConsonant);
}
export const withObjectParticle = (word: string) => withParticle(word, "을", "를");
export const withTopicParticle = (word: string) => withParticle(word, "은", "는");

// ---- 배달 ----
// 배달 메뉴 데모 데이터. 매장은 식당 찾기의 가상 식당과 같은 곳이다 (restaurantId).
// 메뉴를 고르면 단위(마리·판·인분)에 맞춰 수량을 묻는다.

export interface DeliveryItem {
  id: string;
  name: string;
  restaurantId: string;
  price: number; // 1단위 가격
  unit: Unit;
  // 메뉴 이름 일부나 종류로 말해도 찾는다. 여러 메뉴에 걸리는 말(예: "치킨")이면 그중에서 고르게 한다
  keywords: string[];
}

export const DELIVERY_MENU: DeliveryItem[] = [
  { id: "d1", name: "옛날통닭", restaurantId: "h1", price: 18000, unit: "마리", keywords: ["통닭", "후라이드", "치킨"] },
  { id: "d2", name: "간장치킨", restaurantId: "h3", price: 20000, unit: "마리", keywords: ["간장", "치킨"] },
  { id: "d3", name: "마르게리따 피자", restaurantId: "p1", price: 19000, unit: "판", keywords: ["마르게리따", "피자"] },
  { id: "d4", name: "국물떡볶이", restaurantId: "s1", price: 6000, unit: "인분", keywords: ["떡볶이"] },
];

export const MAX_QTY = 10;

// 메뉴 이름이 그대로 들어 있으면 그 메뉴 하나, 아니면 키워드에 걸리는 메뉴 전부
export function findDeliveryItems(text: string): DeliveryItem[] {
  const typed = squash(text);
  const exact = DELIVERY_MENU.filter((d) => typed.includes(squash(d.name)));
  if (exact.length > 0) return exact;
  return DELIVERY_MENU.filter((d) => d.keywords.some((k) => typed.includes(k)));
}

const deliveryChoices = (items: DeliveryItem[]): Choice[] => items.map((d) => ({ label: d.name, value: d.name }));

// "2", "2마리", "두 마리", "둘", "세 명" 같은 수량 표현. 없으면 undefined (범위 확인은 부르는 쪽에서)
const KOREAN_COUNTS: [string, number][] = [
  ["하나", 1], ["둘", 2], ["셋", 3], ["넷", 4], ["다섯", 5], ["여섯", 6], ["일곱", 7], ["여덟", 8], ["아홉", 9], ["열", 10],
  ["한", 1], ["두", 2], ["세", 3], ["네", 4],
];

export function parseQuantity(text: string): number | undefined {
  const digits = text.match(/\d+/);
  if (digits) return parseInt(digits[0], 10);
  for (const [word, count] of KOREAN_COUNTS) {
    // 한·두·세·네 는 다른 말("한식", "네 주세요")과 헷갈리지 않게 단위가 붙을 때만 수량으로 본다
    const needsUnit = word.length === 1 && "한두세네".includes(word);
    const pattern = needsUnit ? `${word}\\s*(마리|판|인분|개|명)` : `(^|\\s)${word}(\\s|마리|판|인분|개|명|$)`;
    if (new RegExp(pattern).test(text)) return count;
  }
  return undefined;
}

// 메뉴를 고른 뒤 수량 질문. 1~3 단위를 버튼으로 주고, 그 밖은 직접 입력
export function quantityPrompt(item: DeliveryItem, lead?: string): BotPrompt {
  const store = restaurantById(item.restaurantId);
  const info = `${withTopicParticle(item.name)} ${store.name}에서 1${item.unit} ${won(item.price)}이에요.`;
  return {
    text: `${lead ?? info}\n몇 ${item.unit} 주문할까요?`,
    choices: [1, 2, 3].map((n) => ({ label: `${n}${item.unit}`, value: `${n}${item.unit}` })),
    placeholder: `예) 4${item.unit}`,
  };
}

export function makeOrder(item: DeliveryItem, qty: number): Order {
  const store = restaurantById(item.restaurantId);
  return {
    store: { name: store.name, distance: km(store.distanceKm) },
    food: item.name,
    qty,
    unit: item.unit,
    price: item.price * qty,
    address: ADDRESS,
  };
}

// ---- 식당 예약 ----
// 식당을 고르면 날짜 → 시간 → 인원 순으로 묻고, 확인 후 예약을 마친다.

export interface Reservation {
  restaurant: Restaurant;
  date: Date; // 방문일 0시
  time: string; // "HH:MM"
  people: number;
}

export const MAX_DAYS_AHEAD = 30;
export const MAX_PEOPLE = 20;
const TIME_SLOTS = ["12:00", "13:00", "18:00", "19:00", "20:00", "21:00"];
const WEEKDAYS = "일월화수목금토";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
const pad2 = (n: number) => String(n).padStart(2, "0");
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const formatDate = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;

// 오늘·내일·모레, "10월 3일", "10/3", "3일"(이번 달, 지났으면 다음 달). 지난 날이면 "past", 너무 먼 날이면 "far"
export function parseVisitDate(text: string, now: Date): Date | "past" | "far" | undefined {
  const today = startOfDay(now);
  const relative: [string, number][] = [["오늘", 0], ["내일", 1], ["모레", 2], ["글피", 3]];
  let date: Date | undefined;
  for (const [word, n] of relative) if (text.includes(word)) date = addDays(today, n);

  const monthDay = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/) ?? text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  const dayOnly = text.match(/(\d{1,2})\s*일/);
  if (!date && monthDay) {
    const [month, day] = [Number(monthDay[1]), Number(monthDay[2])];
    date = new Date(today.getFullYear(), month - 1, day);
    if (date.getMonth() !== month - 1) return undefined; // 2월 30일 같은 없는 날
    // 연말에 "1월 5일"이라고 하면 내년으로 본다
    const nextYear = new Date(today.getFullYear() + 1, month - 1, day);
    if (date < today && daysBetween(today, nextYear) <= MAX_DAYS_AHEAD) date = nextYear;
  } else if (!date && dayOnly) {
    const day = Number(dayOnly[1]);
    date = new Date(today.getFullYear(), today.getMonth(), day);
    if (date < today) date = new Date(today.getFullYear(), today.getMonth() + 1, day);
    if (date.getDate() !== day) return undefined;
  }
  if (!date) return undefined;
  const ahead = daysBetween(today, date);
  if (ahead < 0) return "past";
  if (ahead > MAX_DAYS_AHEAD) return "far";
  return date;
}

// "19:30", "7시", "7시 반", "저녁 7시 30분", "오전 11시". 오전이라고 하지 않은 1~9시는 오후로 본다
export function parseVisitTime(text: string): string | undefined {
  let h: number;
  let m: number;
  const colon = text.match(/(\d{1,2})\s*:\s*(\d{2})/);
  const korean = text.match(/(\d{1,2})\s*시(?:\s*(반|(\d{1,2})\s*분))?/);
  if (colon) {
    [h, m] = [Number(colon[1]), Number(colon[2])];
  } else if (korean) {
    h = Number(korean[1]);
    m = korean[2] === "반" ? 30 : korean[3] ? Number(korean[3]) : 0;
  } else {
    return undefined;
  }
  const am = /오전|아침/.test(text);
  const pm = /오후|저녁|밤/.test(text);
  if ((pm && h < 12) || (!am && h >= 1 && h <= 9)) h += 12;
  if (h > 23 || m > 59) return undefined;
  return `${pad2(h)}:${pad2(m)}`;
}

// 영업시간 안이면서 마감 1시간 전까지만 받는다. 자정을 넘겨 닫는 곳("16:00 - 01:00")도 처리한다
export function isWithinHours(restaurant: Restaurant, time: string): boolean {
  const [openText, closeText] = restaurant.hours.split("-").map((s) => s.trim());
  const open = toMinutes(openText);
  let close = toMinutes(closeText);
  if (close <= open) close += 24 * 60;
  let t = toMinutes(time);
  if (t < open) t += 24 * 60;
  return t >= open && t <= close - 60;
}

const isPastTime = (date: Date, time: string, now: Date) =>
  daysBetween(now, date) === 0 && toMinutes(time) <= now.getHours() * 60 + now.getMinutes();

export type TimeCheck = "ok" | "closed" | "past";
export function checkVisitTime(restaurant: Restaurant, date: Date, time: string, now: Date): TimeCheck {
  if (!isWithinHours(restaurant, time)) return "closed";
  if (isPastTime(date, time, now)) return "past";
  return "ok";
}

export function datePrompt(restaurant: Restaurant, now: Date, lead?: string): BotPrompt {
  const today = startOfDay(now);
  const labels = ["오늘", "내일", "모레"];
  return {
    text: `${lead ?? `${restaurant.name} 예약을 도와드릴게요.`}\n언제 방문하실 건가요?`,
    choices: labels.map((label, i) => {
      const d = addDays(today, i);
      return { label: `${label} (${d.getMonth() + 1}/${d.getDate()})`, value: label };
    }),
    placeholder: "예) 10월 3일",
  };
}

// 고른 날짜에 예약할 수 있는 시간 버튼. 하나도 없으면(오늘 영업이 끝나 감) 빈 배열
export function timeChoices(restaurant: Restaurant, date: Date, now: Date): Choice[] {
  return TIME_SLOTS.filter((t) => checkVisitTime(restaurant, date, t, now) === "ok").map((t) => ({ label: t, value: t }));
}

export function timePrompt(restaurant: Restaurant, date: Date, now: Date, lead?: string): BotPrompt {
  return {
    text: `${lead ?? formatDate(date)}\n몇 시에 방문하실 건가요?\n영업시간 ${restaurant.hours}`,
    choices: timeChoices(restaurant, date, now),
    placeholder: "예) 저녁 7시 30분",
  };
}

// 인원은 화면에서 −/+ 카운터 버튼으로 고른다 (1 ~ MAX_PEOPLE, 처음 값 DEFAULT_PEOPLE)
export const DEFAULT_PEOPLE = 2;
export const PEOPLE_QUESTION = "몇 명이 방문하시나요?";

export function reservationDoneText(r: Reservation, now = new Date()): string {
  const no = "R" + String(now.getTime()).slice(-6);
  return (
    `예약이 완료되었어요!\n\n` +
    `예약번호: ${no}\n` +
    `${r.restaurant.name} · ${formatDate(r.date)} ${r.time} · ${r.people}명\n` +
    `주소: ${r.restaurant.address}\n` +
    `방문 10분 전까지 도착해 주세요.`
  );
}

// ---- 선택지가 있는 질문 ----
// 예시를 글로 늘어놓는 대신 버튼으로 보여 준다. 화면에서는 선택지 끝에 "직접 입력"이 붙고,
// 선택지가 떠 있는 동안 입력창은 접혀 있다가 직접 입력을 누르면 열린다 (placeholder 는 그때의 안내 문구)
export interface Choice {
  label: string;
  value: string; // 눌렀을 때 사용자가 보낸 말로 처리할 문장
}

export interface BotPrompt {
  text: string;
  choices?: Choice[];
  placeholder?: string;
}

export const FOOD_PROMPT: BotPrompt = {
  text: "어떤 음식을 원하세요?",
  choices: FOODS.map((f) => ({ label: f.label, value: f.label })),
  placeholder: "먹고 싶은 음식을 입력하세요",
};

export const DELIVERY_PROMPT: BotPrompt = {
  text: "어떤 음식을 배달해 드릴까요?",
  choices: deliveryChoices(DELIVERY_MENU),
  placeholder: "예) 간장치킨",
};

// 여러 메뉴에 걸리는 말이면 그 메뉴들 중에서 고르게 한다
export const pickDeliveryPrompt = (items: DeliveryItem[]): BotPrompt => ({
  ...DELIVERY_PROMPT,
  text: "어떤 메뉴로 할까요?",
  choices: deliveryChoices(items),
});

// ---- 빠른 메뉴 ----
// 입력창의 link 버튼으로 여는 빠른 메뉴. 배달은 주문 흐름, 식당은 식당 찾기로 이어지고 나머지는 준비 중이다
export const QUICK_MENUS = ["배달", "식당", "쇼핑", "예매"] as const;
export type QuickMenu = (typeof QUICK_MENUS)[number];

export interface QuickMenuReply extends BotPrompt {
  // 다음 입력을 무엇으로 받을지: 배달은 메뉴 이름, 식당은 음식 종류
  next?: "menu" | "food";
}

export function quickMenuReply(text: string): QuickMenuReply | undefined {
  const menu = QUICK_MENUS.find((m) => m === text.trim());
  if (!menu) return undefined;
  if (menu === "배달") return { ...DELIVERY_PROMPT, next: "menu" };
  if (menu === "식당") return { ...FOOD_PROMPT, next: "food" };
  return { text: `${menu} 서비스는 준비 중이에요.\n지금은 배달 주문과 식당 찾기를 도와드릴 수 있어요.` };
}

// 무슨 말인지 모를 때: 할 수 있는 서비스를 선택지로 보여 준다
export const FALLBACK_PROMPT: BotPrompt = {
  text: "죄송해요, 잘 이해하지 못했어요.\n원하는 서비스를 골라 주세요.",
  choices: QUICK_MENUS.map((m) => ({ label: m, value: m })),
};

const has = (text: string, words: string[]) => {
  const low = text.toLowerCase();
  return words.some((w) => low.includes(w));
};

export const isYes = (text: string) =>
  has(text, ["응", "네", "예", "좋아", "해줘", "ㅇㅇ", "그래", "주문해", "콜", "ok", "yes"]);

export const isNo = (text: string) => has(text, ["아니", "취소", "싫어", "안 해", "안해", "no"]);

// "카카오로 할게", "카드로" 처럼 줄여 말해도 결제수단을 찾는다
export function findPayment(text: string): PaymentMethod | undefined {
  const low = text.toLowerCase();
  return (
    PAYMENTS.find((p) => low.includes(p.label) || low.includes(p.label.replace("페이", ""))) ??
    (low.includes("카드") ? PAYMENTS[0] : undefined)
  );
}

export const won = (n: number) => n.toLocaleString("ko-KR") + "원";

export function completionText(order: Order, method: PaymentMethod, now = new Date()): string {
  const orderNo = "ON" + String(now.getTime()).slice(-6);
  const eta = new Date(now.getTime() + 40 * 60_000);
  const hhmm = `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`;
  return (
    `${method.label}로 ${won(order.price)} 결제가 완료되었어요!\n\n` +
    `주문번호: ${orderNo}\n` +
    `${order.store.name}에서 ${order.food} ${withObjectParticle(`${order.qty}${order.unit}`)} 준비 중이에요.\n` +
    `도착 예정: 약 40분 후 (${hhmm})`
  );
}
