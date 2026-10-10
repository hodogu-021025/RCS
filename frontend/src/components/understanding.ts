// 챗봇이 "모르겠어요" 대신 우리 기능(배달·식당 예약·주문 조회)으로 이어 가게 돕는 말 해석 모음.
// 외부 AI 없이 규칙과 가게·메뉴 목록(catalog.json)만 쓴다. 가게·메뉴 이름을 코드에 직접 적지 않는다
import {
  DELIVERY_MENU,
  FOODS,
  MAX_PEOPLE,
  RESTAURANTS,
  availableDeliveryMenu,
  bookableTimes,
  checkVisitTime,
  formatDate,
  km,
  withTopicParticle,
  type InfoCard,
  parseVisitDate,
  parseVisitTime,
  popularFirst,
  squash,
  toMinutes,
  withStoreSettings,
  type DeliveryItem,
  type FoodCategory,
  type Meal,
  type Restaurant,
} from "./orderChatKnowledge";
import type { OrderRecord } from "../data/db";

// ---- 무엇을 하려는 말인지 ----
export type Intent =
  | "greeting" // 안녕하세요
  | "thanks" // 고마워
  | "hungry" // 배고파, 뭐 먹지, 추천해줘, 메뉴 뭐 있어
  | "orderStatus" // 내 주문 어디쯤 왔어
  | "orderCancel" // 주문 취소할래
  | "storeInfo" // 영업시간, 주소, 어디에 있어
  | "nearest" // 제일 가까운 식당
  | "reorder"; // 늘 먹던 거, 지난번 거 다시

// 앞에 있을수록 먼저 본다 (주문 조회·취소는 "주문"이 들어가 배달로 오해하기 쉬워서 맨 앞)
const INTENT_RULES: [Intent, RegExp][] = [
  ["orderCancel", /(주문|배달).*(취소|안\s?받을|물러)|취소.*(주문|배달)/],
  ["orderStatus", /(주문|배달|음식|치킨|피자).*(어디|언제|상태|확인|왔|오나|와요|오는|도착|됐|되었)|내\s?주문|주문\s?(내역|조회)|언제\s?(와|오)/],
  ["reorder", /늘\s?먹던|자주\s?먹던|지난\s?번|저번(에|\s?거|\s?메뉴)|다시\s?주문|재주문|먹던\s?거|시켰던/],
  ["storeInfo", /영업\s?시간|몇\s?시(까지|부터|에\s?(열|문|닫))|문\s?(열|닫)|여는\s?시간|닫는\s?시간|주소|위치|어디(에|에\s?있|야|예요|에요|인가)|가는\s?길/],
  ["nearest", /(제일|가장|젤)\s?가까운|가까운\s?(곳|데|식당|가게|맛집)|근처에\s?(뭐|뭣|어떤)/],
  ["hungry", /배\s?고파|배고프|출출|허기|뭐\s?먹|뭘\s?먹|먹을\s?(거|게|만한)|추천|메뉴\s?(뭐|뭣|좀|알려|보여|있)|뭐\s?(있|파)|아무거나|입이\s?심심|야식|간식/],
  ["thanks", /고마|감사|땡큐|thank|수고/i],
  ["greeting", /^(안녕|하이|hi|hello|헬로|반가|좋은\s?(아침|저녁))/i],
];

export function detectIntent(text: string): Intent | undefined {
  const t = text.trim();
  return INTENT_RULES.find(([, re]) => re.test(t))?.[0];
}

// "그 식당", "거기", "아까 그 가게": 앞에서 말한 식당을 가리키는 말
export const refersToPlace = (text: string) => /(그|저|아까\s?그)\s?(식당|가게|집|곳|매장)|거기/.test(text);
// "아까 그거", "같은 걸로", "방금 그 메뉴": 앞에서 말한 메뉴를 가리키는 말
export const refersToItem = (text: string) => /아까\s?(그거|그\s?메뉴|거)|같은\s?(걸|거|메뉴)|방금\s?(그거|그\s?메뉴)|그\s?메뉴|그거\s?(로|하나|두|세|\d)/.test(text);

// ---- 시간대 추천 ----
export function mealOf(now: Date): Meal {
  const h = now.getHours();
  if (h >= 6 && h < 11) return "breakfast";
  if (h >= 11 && h < 14) return "lunch";
  if (h >= 14 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "dinner";
  return "late";
}
export const MEAL_WORD: Record<Meal, string> = { breakfast: "아침", lunch: "점심", afternoon: "오후 간식", dinner: "저녁", late: "야식" };

// 지금 시간대에 어울리는 음식 종류 (catalog.json 의 foods[].meals)
export const foodsForMeal = (meal: Meal): FoodCategory[] => FOODS.filter((f) => f.meals?.includes(meal));

const foodOfItem = (d: DeliveryItem) => RESTAURANTS.find((r) => r.id === d.restaurantId)?.food;

// 지금 시간대에 어울리는 메뉴를 앞으로, 그 안에서는 최근 많이 주문된 순으로 n 개
export function recommendItems(now: Date, n = 3): DeliveryItem[] {
  const fits = new Set(foodsForMeal(mealOf(now)).map((f) => f.key));
  const ranked = popularFirst(availableDeliveryMenu());
  return [...ranked.filter((d) => fits.has(foodOfItem(d) ?? "")), ...ranked.filter((d) => !fits.has(foodOfItem(d) ?? ""))].slice(0, n);
}

// ---- 영업 중인지 ----
export function isOpenNow(r: Restaurant, now: Date): boolean {
  const [openText, closeText] = r.hours.split("-").map((s) => s.trim());
  const open = toMinutes(openText);
  let close = toMinutes(closeText);
  if (close <= open) close += 24 * 60;
  let t = now.getHours() * 60 + now.getMinutes();
  if (t < open) t += 24 * 60;
  return t >= open && t < close;
}

// ---- 가게 찾기 ----
export const allRestaurants = () => RESTAURANTS.map(withStoreSettings);
export const nearestRestaurants = (n = 3) => allRestaurants().sort((a, b) => a.distanceKm - b.distanceKm).slice(0, n);

// 문장에 들어 있는 식당 이름 (띄어쓰기 무시)
export function restaurantNamed(text: string): Restaurant | undefined {
  const typed = squash(text);
  return allRestaurants().find((r) => typed.includes(squash(r.name)));
}

// ---- 예약 정보 한 번에 받기 ----
// "내일 저녁 7시 4명": 날짜·시간·인원을 미리 뽑아 둔다. 식당을 고르면 이미 말한 것은 다시 묻지 않는다
export interface ReservationSlots {
  date?: Date;
  time?: string;
  people?: number;
}

const PEOPLE_WORDS: [RegExp, number][] = [
  [/혼자|혼밥|1인/, 1],
  [/둘이|두\s?(명|사람|분)/, 2],
  [/셋이|세\s?(명|사람|분)/, 3],
  [/넷이|네\s?(명|사람|분)/, 4],
  [/다섯\s?(명|사람|분)/, 5],
  [/여섯\s?(명|사람|분)/, 6],
];

// 인원은 "명·사람" 이 붙을 때만 본다 ("2마리", "7시" 와 헷갈리지 않게). 한 명 = 1
export function parsePeople(text: string): number | undefined {
  const m = text.match(/(\d{1,2})\s*(명|사람|인(?!분))/);
  if (m) return Number(m[1]);
  if (/한\s?(명|사람|분)/.test(text)) return 1;
  return PEOPLE_WORDS.find(([re]) => re.test(text))?.[1];
}

export function parseReservationSlots(text: string, now: Date): ReservationSlots {
  const slots: ReservationSlots = {};
  const date = parseVisitDate(text, now);
  if (date instanceof Date) slots.date = date;
  const time = parseVisitTime(text);
  if (time) slots.time = time;
  const people = parsePeople(text);
  if (people !== undefined && people >= 1 && people <= MAX_PEOPLE) slots.people = people;
  return slots;
}

export const hasSlots = (s: ReservationSlots) => s.date !== undefined || s.time !== undefined || s.people !== undefined;

// 미리 받아 둔 값 중 이 식당에서 쓸 수 있는 것만 남긴다. 버린 값이 있으면 그 이유를 같이 돌려준다
export function usableSlots(r: Restaurant, s: ReservationSlots, now: Date): { slots: ReservationSlots; issue?: string } {
  const slots: ReservationSlots = {};
  let issue: string | undefined;
  if (s.date) {
    if (bookableTimes(r, s.date, now).length > 0) slots.date = s.date;
    else issue = `${formatDate(s.date)}은 예약할 수 있는 시간이 지났어요.`;
  }
  if (s.time) {
    const check = checkVisitTime(r, slots.date ?? now, s.time, now);
    // 날짜를 아직 모르면 영업시간만 본다 (지난 시간인지는 날짜를 정한 뒤에)
    if (check === "ok" || (check === "past" && !slots.date)) slots.time = s.time;
    else issue ??= check === "past" ? "이미 지난 시간이에요." : `${s.time}에는 예약할 수 없어요. 마감 1시간 전까지 예약할 수 있어요.`;
  }
  if (s.people !== undefined) slots.people = s.people;
  return { slots, issue };
}

// 바뀐 예약 값을 말로 ("10월 11일 (토) · 20:00 · 5명")
export const slotsText = (s: ReservationSlots) =>
  [s.date && formatDate(s.date), s.time, s.people !== undefined && `${s.people}명`].filter(Boolean).join(" · ");

// ---- 조금 틀리게 말해도 찾기 ("깐장치킨" → 간장치킨, "할머니국밥" → 장락 할매국밥) ----
// 한글을 자모로 풀어 편집 거리를 잰다. 글자 하나가 받침·모음만 달라도 거리 1~2 로 가깝게 본다
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
export function jamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) {
      out += ch;
      continue;
    }
    out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + (c % 28 ? JONG[c % 28] : "");
  }
  return out;
}

export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

export type FuzzyHit = { kind: "menu"; item: DeliveryItem; name: string } | { kind: "restaurant"; restaurant: Restaurant; name: string };

// 비교할 이름: 메뉴·식당 이름 전체와 띄어 쓴 낱말(3글자 이상). 짧은 말은 엉뚱한 데 걸리기 쉬워 뺀다
function fuzzyTargets(): { hit: FuzzyHit; word: string }[] {
  const targets: { hit: FuzzyHit; word: string }[] = [];
  const add = (hit: FuzzyHit, name: string) => {
    for (const w of new Set([squash(name), ...name.split(/\s+/).map(squash)])) if ([...w].length >= 3) targets.push({ hit, word: w });
  };
  for (const item of DELIVERY_MENU) add({ kind: "menu", item, name: item.name }, item.name);
  for (const restaurant of allRestaurants()) add({ kind: "restaurant", restaurant, name: restaurant.name }, restaurant.name);
  return targets;
}

// 말 속 어느 부분이 메뉴·식당 이름과 비슷하면 그것. 이미 정확히 들어 있으면 부르는 쪽이 먼저 처리하므로 여기선 비슷한 것만
export function fuzzyFind(text: string): FuzzyHit | undefined {
  const typed = [...squash(text)];
  let best: { hit: FuzzyHit; score: number } | undefined;
  for (const { hit, word } of fuzzyTargets()) {
    const len = [...word].length;
    const target = jamo(word);
    const limit = Math.max(1, Math.ceil(target.length * 0.25));
    for (let size = len - 1; size <= len + 1; size++) {
      for (let start = 0; start + size <= typed.length; start++) {
        const d = editDistance(jamo(typed.slice(start, start + size).join("")), target);
        if (d > limit) continue;
        const score = d / target.length;
        if (!best || score < best.score) best = { hit, score };
      }
    }
  }
  return best?.hit;
}

// ---- 품절·대체 ----
// 메뉴 이름을 그대로 말했는데 지금 품절인 메뉴
export function soldOutItemNamed(text: string): DeliveryItem | undefined {
  const typed = squash(text);
  const available = new Set(availableDeliveryMenu().map((d) => d.id));
  return DELIVERY_MENU.find((d) => typed.includes(squash(d.name)) && !available.has(d.id));
}

// 품절 메뉴 대신 권할 메뉴: 키워드가 겹치거나 같은 음식 종류인 것 먼저, 없으면 주문할 수 있는 메뉴 전부
export function alternativesFor(item: DeliveryItem): DeliveryItem[] {
  const menu = availableDeliveryMenu().filter((d) => d.id !== item.id);
  const close = menu.filter((d) => d.keywords.some((k) => item.keywords.includes(k)) || foodOfItem(d) === foodOfItem(item));
  return close.length ? close : menu;
}

// 이 음식 종류를 배달할 수 있는 메뉴가 있는지 (짜장면 같은 중식은 지금 배달 메뉴에 없다)
export const deliversFood = (food: FoodCategory) => availableDeliveryMenu().some((d) => foodOfItem(d) === food.key);

// 문장에서 음식 종류 키워드가 들어간 낱말 그대로 ("짜장면 배달해줘" → "짜장면"). 조사는 뗀다
export function foodWord(text: string, food: FoodCategory): string {
  const word = text.split(/\s+/).find((w) => food.keywords.some((k) => w.toLowerCase().includes(k)));
  return word ? word.replace(/(을|를|이|가|은|는|도|만|으로|로|이랑|랑)$/, "") || food.label : food.label;
}

// ---- 주문 상태 ----
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const ETA_MINUTES = 40;
export const orderLabel = (o: OrderRecord) => `${o.order.store.name} ${o.order.item} ${o.order.qty}${o.order.unit}`;

const STATUS_TITLE: Record<OrderRecord["status"], string> = {
  접수: "주문이 접수됐어요.",
  "준비 중": "가게에서 준비 중이에요.",
  완료: "배달이 완료됐어요.",
  취소: "취소된 주문이에요.",
};
const STATUS_NOTE: Partial<Record<OrderRecord["status"], string>> = {
  접수: "가게에서 곧 준비를 시작해요.",
  완료: "맛있게 드세요!",
};

// 내 주문 상태를 표로: 주문 내용, 상태, (아직 오는 중이면) 도착 예정
export function orderStatusCard(o: OrderRecord): InfoCard {
  const coming = o.status === "접수" || o.status === "준비 중";
  return {
    title: STATUS_TITLE[o.status],
    rows: [
      { label: "주문", value: orderLabel(o) },
      { label: "상태", value: o.status },
      ...(coming ? [{ label: "도착 예정", value: `약 ${hhmm(o.createdAt + ETA_MINUTES * 60_000)}`, emphasis: true }] : []),
    ],
    note: STATUS_NOTE[o.status],
  };
}

// 가게 정보를 표로: 영업시간(지금 영업 중인지)·주소·대표 메뉴·거리
export function storeInfoCard(r: Restaurant, now: Date): InfoCard {
  const state = isOpenNow(r, now) ? "지금 영업 중이에요." : "지금은 영업시간이 아니에요.";
  return {
    title: `${r.name} 정보예요.`,
    rows: [
      { label: "영업시간", value: `${r.hours} · ${isOpenNow(r, now) ? "영업 중" : "영업 전·후"}`, emphasis: true },
      { label: "주소", value: r.address },
      { label: "대표 메뉴", value: r.signature },
      { label: "거리", value: km(r.distanceKm) },
    ],
    say: `${withTopicParticle(r.name)} ${r.hours.replace("-", "부터")}까지 영업해요. ${state} 주소는 ${r.address}예요.`,
  };
}
