// 주문 챗봇의 문장 해석 규칙과 주문서 모델. 가게·메뉴 목록은 서버와 같이 쓰는 server/catalog.json 에서 읽는다
// (지금은 화면 확인용 가상 데이터이고, 실제 목록이 오면 그 파일만 바꾼다)
import catalog from "../../../server/catalog.json";
import { getPopularity, getStoreSettings } from "../data/db";

export interface Store {
  name: string;
  distance?: string;
}

export type Unit = string; // 마리·판·인분 등 (catalog.json 의 deliveryMenu[].unit)

// 결제까지 가는 배달 주문서 (확인 → 결제수단 → 결제 팝업)

export interface Order {
  store: Store; // 매장
  item: string; // 메뉴 이름
  qty: number;
  unit: string; // 마리·판·인분
  price: number; // 결제 금액
  address?: string; // 배달지
  storeId?: string; // 사장님 화면에서 내 매장 주문을 찾는 열쇠 (식당 id)
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
// 근처 식당 (catalog.json 의 restaurants). 지금은 화면 확인용 가상 식당이다.

export type FoodKey = string; // catalog.json 의 foods[].key

// 추천할 시간대: breakfast 6-10시, lunch 11-14시, afternoon 14-17시, dinner 17-21시, late 21시 이후
export type Meal = "breakfast" | "lunch" | "afternoon" | "dinner" | "late";

export interface FoodCategory {
  key: FoodKey;
  label: string;
  keywords: string[];
  meals?: Meal[];
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
export const FOODS: FoodCategory[] = catalog.foods as FoodCategory[];

export const RESTAURANTS: Restaurant[] = catalog.restaurants as Restaurant[];

export function matchFood(text: string): FoodCategory | undefined {
  const low = text.toLowerCase();
  return FOODS.find((f) => f.keywords.some((k) => low.includes(k)));
}

// 해당 음식을 다루는 식당을 가까운 순으로
export function nearbyRestaurants(food: FoodKey): Restaurant[] {
  return RESTAURANTS.filter((r) => r.food === food)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(withStoreSettings);
}

// 사장님이 사장님 화면에서 바꾼 값(영업시간)을 덮어쓴 식당
export function withStoreSettings(r: Restaurant): Restaurant {
  const hours = getStoreSettings(r.id).hours;
  return hours ? { ...r, hours } : r;
}

// 띄어쓰기·대소문자를 무시하고 비교할 때
export const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

// 목록 버튼을 누르거나 식당 이름을 입력하면 고른 것으로 본다 (띄어쓰기는 무시)
export function findRestaurant(text: string, list: Restaurant[]): Restaurant | undefined {
  const typed = squash(text);
  return list.find((r) => typed.includes(squash(r.name)));
}

export const restaurantById = (id: string) => withStoreSettings(RESTAURANTS.find((r) => r.id === id)!);

export const km = (distanceKm: number) => `${distanceKm.toFixed(1)}km`;

// 숫자·영문으로 끝나면 읽는 소리로 받침을 정한다: 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 / L 엘, M 엠, N 엔, R 알
const ENDS_WITH_BATCHIM = new Set(["0", "1", "3", "6", "7", "8", "L", "M", "N", "R"]);
const ENDS_WITHOUT_BATCHIM = new Set([..."2459", ..."ABCDEFGHIJKOPQSTUVWXYZ"]);

// 받침에 따라 조사를 고른다 (을/를, 은/는). 판단할 수 없는 글자로 끝나면 둘 다 적는다
function withParticle(word: string, afterConsonant: string, afterVowel: string): string {
  const last = word.trim().slice(-1).toUpperCase();
  const code = last.charCodeAt(0) - 0xac00;
  let batchim: boolean | undefined;
  if (code >= 0 && code <= 11171) batchim = code % 28 !== 0;
  else if (ENDS_WITH_BATCHIM.has(last)) batchim = true;
  else if (ENDS_WITHOUT_BATCHIM.has(last)) batchim = false;
  if (batchim === undefined) return `${word}${afterConsonant}(${afterVowel})`;
  return word + (batchim ? afterConsonant : afterVowel);
}
export const withObjectParticle = (word: string) => withParticle(word, "을", "를");
export const withTopicParticle = (word: string) => withParticle(word, "은", "는");
export const withSubjectParticle = (word: string) => withParticle(word, "이", "가");

// ---- 배달 ----
// 배달 메뉴 (catalog.json 의 deliveryMenu). 매장은 식당 찾기의 식당과 같은 곳이다 (restaurantId).
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

export const DELIVERY_MENU: DeliveryItem[] = catalog.deliveryMenu as DeliveryItem[];

export const MAX_QTY = 10;

// 메뉴 이름이 그대로 들어 있으면 그 메뉴 하나, 아니면 키워드에 걸리는 메뉴 전부
// 사장님이 바꾼 가격을 입히고, 품절 메뉴는 뺀 배달 메뉴
export function availableDeliveryMenu(): DeliveryItem[] {
  return DELIVERY_MENU.flatMap((d) => {
    const s = getStoreSettings(d.restaurantId).items?.[d.id];
    if (s?.soldOut) return [];
    return [s?.price ? { ...d, price: s.price } : d];
  });
}

export function findDeliveryItems(text: string): DeliveryItem[] {
  const typed = squash(text);
  const menu = availableDeliveryMenu();
  // 메뉴 이름을 그대로 말했는데 품절이면, 비슷한 다른 메뉴로 바꿔치기하지 않고 못 찾은 것으로 본다
  if (DELIVERY_MENU.some((d) => typed.includes(squash(d.name)))) return menu.filter((d) => typed.includes(squash(d.name)));
  return menu.filter((d) => d.keywords.some((k) => typed.includes(k)));
}

const deliveryChoices = (items: DeliveryItem[]): Choice[] => items.map((d) => ({ label: d.name, value: d.name }));

// "2", "2마리", "두 마리", "둘", "세 명" 같은 수량 표현. 없으면 undefined (범위 확인은 부르는 쪽에서)
const KOREAN_COUNTS: [string, number][] = [
  ["하나", 1], ["둘", 2], ["셋", 3], ["넷", 4], ["다섯", 5], ["여섯", 6], ["일곱", 7], ["여덟", 8], ["아홉", 9], ["열", 10],
  ["한", 1], ["두", 2], ["세", 3], ["네", 4],
];

// 숫자 뒤에 이런 단위가 붙으면 수량이 아니다 ("10월 3일", "7시", "331호")
const NOT_COUNT_UNIT = /^\s*(월|일|시|분|초|호|번|층|원|년|km|m|cm|kg|g|ml)/;

export function parseQuantity(text: string): number | undefined {
  for (const m of text.matchAll(/\d+/g)) {
    if (!NOT_COUNT_UNIT.test(text.slice(m.index + m[0].length))) return parseInt(m[0], 10);
  }
  for (const [word, count] of KOREAN_COUNTS) {
    // 한·두·세·네 는 다른 말("한식", "네 주세요")과 헷갈리지 않게 단위가 붙을 때만 수량으로 본다
    const needsUnit = word.length === 1 && "한두세네".includes(word);
    const pattern = needsUnit ? `${word}\\s*(마리|판|인분|개|명)` : `(^|\\s)${word}(\\s|마리|판|인분|개|명|$)`;
    if (new RegExp(pattern).test(text)) return count;
  }
  return undefined;
}

// 메뉴를 고른 뒤 수량 질문. 수량은 화면에서 −/+ 카운터 버튼으로 고른다 (1 ~ MAX_QTY)
export function quantityQuestion(item: DeliveryItem, lead?: string): string {
  const store = restaurantById(item.restaurantId);
  const info = `${withTopicParticle(item.name)} ${store.name}에서 1${item.unit} ${won(item.price)}이에요.`;
  return `${lead ?? info}\n몇 ${item.unit} 주문할까요?`;
}

export function makeOrder(item: DeliveryItem, qty: number): Order {
  const store = restaurantById(item.restaurantId);
  return {
    store: { name: store.name, distance: km(store.distanceKm) },
    storeId: store.id,
    item: item.name,
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

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
const pad2 = (n: number) => String(n).padStart(2, "0");
export const toMinutes = (hhmm: string) => {
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
// ("07:30" 처럼 0을 붙인 24시간제는 그대로 오전이다)
export function parseVisitTime(text: string): string | undefined {
  let h: number;
  let m: number;
  const colon = text.match(/(\d{1,2})\s*:\s*(\d{2})/);
  const korean = text.match(/(\d{1,2})\s*시(?:\s*(반|(\d{1,2})\s*분))?/);
  const zeroPadded = !!colon && colon[1].length === 2 && colon[1].startsWith("0");
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
  if ((pm && h < 12) || (!am && !zeroPadded && h >= 1 && h <= 9)) h += 12;
  if (am && h === 12) h = 0; // 오전 12시 = 자정
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

type TimeCheck = "ok" | "closed" | "past";
export function checkVisitTime(restaurant: Restaurant, date: Date, time: string, now: Date): TimeCheck {
  if (!isWithinHours(restaurant, time)) return "closed";
  if (isPastTime(date, time, now)) return "past";
  return "ok";
}

// 그날 예약할 수 있는 모든 시각 (10분 단위). 시간 고르기 화면과 "그날 남은 시간이 있는지" 판단에 쓴다
export const TIME_STEP_MINUTES = 10;
export function bookableTimes(restaurant: Restaurant, date: Date, now: Date): string[] {
  const times: string[] = [];
  for (let t = 0; t < 24 * 60; t += TIME_STEP_MINUTES) {
    const hhmm = `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
    if (checkVisitTime(restaurant, date, hhmm, now) === "ok") times.push(hhmm);
  }
  return times;
}

// 그날 예약할 수 있는 시각이 하나라도 있는지 (달력은 날마다 물어보므로 목록을 다 만들지 않고 찾는 대로 멈춘다)
export function hasBookableTime(restaurant: Restaurant, date: Date, now: Date): boolean {
  for (let t = 0; t < 24 * 60; t += TIME_STEP_MINUTES) {
    if (checkVisitTime(restaurant, date, `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`, now) === "ok") return true;
  }
  return false;
}

// 달력에서 고를 수 있는 날: 오늘부터 MAX_DAYS_AHEAD 일 안이면서 예약할 시간이 남은 날
export function isBookableDate(restaurant: Restaurant, date: Date, now: Date): boolean {
  const ahead = daysBetween(now, date);
  return ahead >= 0 && ahead <= MAX_DAYS_AHEAD && hasBookableTime(restaurant, date, now);
}

export const lastBookableDate = (now: Date) => addDays(startOfDay(now), MAX_DAYS_AHEAD);

export function datePrompt(restaurant: Restaurant, now: Date, lead?: string): BotPrompt {
  const today = startOfDay(now);
  const labels = ["오늘", "내일", "모레"];
  // 시간이 다 지난 오늘은 빼고 보여 준다
  const choices = labels.flatMap((label, i) => {
    const d = addDays(today, i);
    return isBookableDate(restaurant, d, now) ? [{ label: `${label} (${d.getMonth() + 1}/${d.getDate()})`, value: label }] : [];
  });
  const head = lead ?? `${restaurant.name} 예약을 도와드릴게요.`;
  return {
    text: `${head}\n언제 방문하실 건가요?`,
    say: `${head} 언제 방문하실 건가요?${choices[0] ? ` ${choices[0].value}도 예약할 수 있어요.` : ""} 편한 날짜를 말씀해 주세요.`,
    choices,
    picker: "date",
  };
}

// 고른 날짜에 바로 누를 수 있는 대표 시간 버튼. 다른 시각은 "직접 입력"의 시간 고르기 화면에서
export function timeChoices(restaurant: Restaurant, date: Date, now: Date): Choice[] {
  return TIME_SLOTS.filter((t) => checkVisitTime(restaurant, date, t, now) === "ok").map((t) => ({ label: t, value: t }));
}

export function timePrompt(restaurant: Restaurant, date: Date, now: Date, lead?: string): BotPrompt {
  const choices = timeChoices(restaurant, date, now);
  const head = lead ?? formatDate(date);
  const picks = choices.slice(0, 3).map((c) => spokenTime(c.value));
  return {
    text: `${head}\n몇 시에 방문하실 건가요?\n영업시간 ${restaurant.hours}`,
    say:
      `${head} 몇 시에 방문하실 건가요?` +
      (picks.length ? ` ${withObjectParticle(picks.join(", "))} 추천해요!` : "") +
      ` 영업시간 안이라면 다른 시간도 괜찮아요.`,
    choices,
    picker: "time",
  };
}

// 소리로 읽을 시각: "18:00" → "오후 6시", "11:30" → "오전 11시 30분"
export function spokenTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시${m ? ` ${m}분` : ""}`;
}

// 추천 목록을 말로: "옛날통닭, 간장치킨을 추천해요!"
export const recommend = (names: string[]) => `${withObjectParticle(names.join(", "))} 추천해요!`;

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
  // "직접 입력"을 눌렀을 때 글자 입력창 대신 펼칠 고르기 화면 (날짜는 달력, 시간은 시:분)
  picker?: "date" | "time";
  directLabel?: string; // "직접 입력" 대신 쓸 버튼 글자 (예: "다른 주소 입력")
  noDirect?: boolean; // 정해진 선택지 중에서만 고르는 질문 (사이즈, 상영 회차)
  // 소리로 읽고 채팅창을 끈 동안 자막으로 보여 줄 문장. 선택지를 "중에서 고르세요"가 아니라 추천하듯 말한다.
  // 없으면 text 와 선택지로 만든다
  say?: string;
}

export const FOOD_PROMPT: BotPrompt = {
  text: "오늘은 어떤 음식이 당기세요?\n말씀해 주시면 근처 맛집을 추천해 드릴게요.",
  say: `오늘은 어떤 음식이 당기세요? ${FOODS.map((f) => f.label).join(", ")} 뭐든 좋아요. 말씀해 주시면 근처 맛집을 추천해 드릴게요!`,
  choices: FOODS.map((f) => ({ label: f.label, value: f.label })),
  placeholder: "먹고 싶은 음식을 입력하세요",
};

// 최근 많이 주문된 메뉴부터 (같으면 목록 순서)
export function popularFirst(menu: DeliveryItem[]): DeliveryItem[] {
  const counts = getPopularity().items;
  return menu.map((d, i) => ({ d, i })).sort((a, b) => (counts[b.d.id] ?? 0) - (counts[a.d.id] ?? 0) || a.i - b.i).map((x) => x.d);
}

// 매번 계산한다: 사장님이 품절시킨 메뉴는 버튼에서도 빠져야 하고, 인기 순서도 바뀐다
export const deliveryPrompt = (): BotPrompt => {
  const menu = popularFirst(availableDeliveryMenu());
  return {
    text: "오늘은 이런 메뉴 어떠세요?\n드시고 싶은 다른 메뉴도 편하게 말씀해 주세요.",
    say: menu.length
      ? `오늘은 ${recommend(menu.map((d) => d.name))} 드시고 싶은 다른 메뉴도 편하게 말씀해 주세요.`
      : "어떤 음식을 배달해 드릴까요?",
    choices: deliveryChoices(menu),
    placeholder: "예) 간장치킨",
  };
};

// 여러 메뉴에 걸리는 말이면("치킨") 그 메뉴들을 추천한다
export const pickDeliveryPrompt = (items: DeliveryItem[]): BotPrompt => ({
  ...deliveryPrompt(),
  text: "이런 메뉴를 추천해요!\n마음에 드는 걸로 골라 주세요.",
  say: `${recommend(items.map((d) => d.name))} 마음에 드는 걸로 말씀해 주세요.`,
  choices: deliveryChoices(items),
});

// (빠른 메뉴 — 배달·식당 — 는 quickMenu.ts 에 있다)

const has = (text: string, words: string[]) => {
  const low = text.toLowerCase();
  return words.some((w) => low.includes(w));
};

// "네"·"예"는 한 글자라 다른 말("예약", "네 명")에도 들어가므로 혼자 쓰였을 때만 긍정으로 본다
export const isYes = (text: string) =>
  has(text, ["응", "좋아", "해줘", "ㅇㅇ", "그래", "주문해", "콜", "ok", "yes"]) || /(^|\s)(네|예)(요|\s|[,.!]|$)/.test(text.trim());

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
  const digits = String(now.getTime()).slice(-6);
  const eta = new Date(now.getTime() + 40 * 60_000);
  const hhmm = `${pad2(eta.getHours())}:${pad2(eta.getMinutes())}`;
  return (
    `${method.label}로 ${won(order.price)} 결제가 완료되었어요!\n\n` +
    `주문번호: ON${digits}\n` +
    `${order.store.name}에서 ${order.item} ${withObjectParticle(`${order.qty}${order.unit}`)} 준비 중이에요.\n` +
    `도착 예정: 약 40분 후 (${hhmm})`
  );
}

// 채팅의 주문서 카드에 들어갈 줄들. emphasis 는 파랗게 강조할 금액
export interface OrderRow {
  label: string;
  value: string;
  emphasis?: boolean;
}

export function orderCardRows(order: Order): OrderRow[] {
  return [
    { label: "매장", value: `${order.store.name}${order.store.distance ? ` · ${order.store.distance}` : ""}` },
    { label: "음식", value: `${order.item} ${order.qty}${order.unit}` },
    { label: "가격", value: won(order.price), emphasis: true },
    { label: "위치", value: order.address ?? "" },
  ];
}

// 결제 팝업 요약 칸
export function orderSummaryRows(order: Order): OrderRow[] {
  return [
    { label: "상품", value: `${order.item} ${order.qty}${order.unit}` },
    { label: "매장", value: order.store.name },
    { label: "배달지", value: order.address ?? "" },
  ];
}

// 주문서 카드 위아래 문구
export const ORDER_CARD_TITLE = "주문 내역을 확인해 주세요.";
export const ORDER_CARD_QUESTION = "주문할까요?";
