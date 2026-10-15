// 챗봇이 "모르겠어요" 대신 우리 기능(배달·식당 예약·주문 조회)으로 이어 가게 돕는 말 해석 모음.
// 외부 AI 없이 규칙과 가게·메뉴 목록(catalog.json)만 쓴다. 가게·메뉴 이름을 코드에 직접 적지 않는다
import {
  deliveryMenu,
  findRestaurant,
  foodsOnOffer,
  filledRows,
  orderItemText,
  byDistance,
  MAX_PEOPLE,
  RESTAURANTS,
  availableDeliveryMenu,
  bookableTimes,
  checkVisitTime,
  untilText,
  formatDate,
  pausedToday,
  km,
  withTopicParticle,
  type InfoCard,
  parseVisitDate,
  parseVisitTime,
  popularFirst,
  squash,
  toMinutes,
  withStoreSettings,
  accountDigits,
  won,
  type DeliveryItem,
  type Order,
  type FoodCategory,
  type Meal,
  type Restaurant,
} from "./orderChatKnowledge";
import { getPopularity, storePausedUntil, type OrderRecord } from "../data/db";

// ---- 무엇을 하려는 말인지 ----
export type Intent =
  | "greeting" // 안녕하세요
  | "thanks" // 고마워
  | "hungry" // 배고파, 뭐 먹지, 추천해줘, 메뉴 뭐 있어
  | "orderStatus" // 내 주문 어디쯤 왔어
  | "orderCancel" // 주문 취소할래
  | "storeInfo" // 영업시간, 주소, 어디에 있어
  | "nearest" // 제일 가까운 식당
  | "reorder" // 늘 먹던 거, 지난번 거 다시
  | "deals"; // 할인하는 거 있어, 오늘의 메뉴 뭐야

// 앞에 있을수록 먼저 본다 (주문 조회·취소는 "주문"이 들어가 배달로 오해하기 쉬워서 맨 앞)
const INTENT_RULES: [Intent, RegExp][] = [
  ["orderCancel", /(주문|배달).*(취소|안\s?받을|물러)|취소.*(주문|배달)/],
  ["orderStatus", /(주문|배달)(한|했던|이|은)?\s?(거|것|음식|치킨|피자)?.*(어디|언제|상태|확인|왔|오나|와요|오는|도착|됐|되었)|내\s?주문|주문\s?(내역|조회)|(음식|치킨|피자|배달)\s?(언제\s?(와|오)|어디쯤)/],
  ["reorder", /늘\s?먹던|자주\s?먹던|지난\s?번|저번(에|\s?거|\s?메뉴)|다시\s?주문|재주문|먹던\s?거|시켰던/],
  ["storeInfo", /영업\s?시간|몇\s?시(까지|부터|에\s?(열|문|닫))|문\s?(열|닫)|여는\s?시간|닫는\s?시간|주소|위치|어디(에|에\s?있|야|예요|에요|인가)|가는\s?길/],
  ["nearest", /(제일|가장|젤)\s?가까운|가까운\s?(곳|데|식당|가게|맛집)|근처에\s?(뭐|뭣|어떤)/],
  ["deals", /할인|세일|특가|이벤트|오늘의\s?메뉴|쿠폰/],
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
// "처음에 선택했던 메뉴로 주문할게", "아까 취소한 거 다시", "처음 거로 할게": 이번 대화에서 보여 드린 주문서를 다시 쓰자는 말.
// first: 맨 처음 주문서를 가리킨다 (아니면 바로 전 주문서). "처음부터 다시"처럼 고른 것을 가리키지 않는 말은 아니다
const EARLIER = /(처음|첫\s?번째|아까|방금|원래)/;
export function refersToEarlierOrder(text: string): { first: boolean } | undefined {
  const picked = new RegExp(`${EARLIER.source}(에|엔)?\\s?(제가\\s?|내가\\s?)?(선택|골랐|고른|시키려|주문하려|담았|취소)`).test(text);
  const thing = new RegExp(`${EARLIER.source}\\s?(거|걸|것|메뉴|주문서)`).test(text);
  const cancelled = /취소(한|했던)\s?(거|걸|것|메뉴|주문)/.test(text);
  if (!picked && !thing && !cancelled) return undefined;
  return { first: /처음|첫\s?번째/.test(text) };
}

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

// 지금 시간대에 어울리는 음식 종류 (catalog.json 의 foods[].meals). 근처에 가게가 있는 종류만
export const foodsForMeal = (meal: Meal): FoodCategory[] => foodsOnOffer().filter((f) => f.meals?.includes(meal));

const foodOfItem = (d: DeliveryItem) => RESTAURANTS.find((r) => r.id === d.restaurantId)?.food;

// 지금 시간대에 어울리는 메뉴를 앞으로, 그 안에서는 최근 많이 주문된 순으로 n 개
export function recommendItems(now: Date, n = 3): DeliveryItem[] {
  const fits = new Set(foodsForMeal(mealOf(now)).map((f) => f.key));
  const ranked = popularFirst(availableDeliveryMenu());
  return [...ranked.filter((d) => fits.has(foodOfItem(d) ?? "")), ...ranked.filter((d) => !fits.has(foodOfItem(d) ?? ""))].slice(0, n);
}

// 식당 찾기를 고르면 바로 보여 줄 추천 식당 n 곳 (배달 메뉴 추천과 같은 방식): 지금 시간대에 어울리는 음식의 식당이 먼저,
// 그 안에서는 최근 예약이 많은 순, 같으면 가까운 순. 일시 중지 중인 곳은 뺀다
export function recommendRestaurants(now: Date, n = 4): Restaurant[] {
  const fits = new Set(foodsForMeal(mealOf(now)).map((f) => f.key));
  const booked = getPopularity().restaurants;
  return allRestaurants()
    .filter((r) => !storePausedUntil(r.id, now.getTime()))
    .sort(
      (a, b) =>
        Number(fits.has(b.food)) - Number(fits.has(a.food)) || (booked[b.id] ?? 0) - (booked[a.id] ?? 0) || byDistance(a, b),
    )
    .slice(0, n);
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

// 카드·표에 적는 영업 상태: "영업 중", 열기 전이면 "11:00 오픈", 닫은 뒤면 "영업 종료"
export function openStateText(r: Restaurant, now: Date): string {
  if (isOpenNow(r, now)) return "영업 중";
  const [openText] = r.hours.split("-").map((s) => s.trim());
  const t = now.getHours() * 60 + now.getMinutes();
  return t < toMinutes(openText) ? `${openText} 오픈` : "영업 종료";
}

// ---- 가게 찾기 ----
export const allRestaurants = () => RESTAURANTS.map(withStoreSettings);
// 가까운 곳 추천 (일시 중지 중인 곳은 추천하지 않는다)
export const nearestRestaurants = (n = 3) =>
  allRestaurants()
    .filter((r) => !storePausedUntil(r.id))
    .sort(byDistance)
    .slice(0, n);

// 문장에 들어 있는 식당 이름 (띄어쓰기 무시)
export function restaurantNamed(text: string): Restaurant | undefined {
  return findRestaurant(text, allRestaurants());
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
    else if (pausedToday(r, s.date, now)) issue = `${withTopicParticle(r.name)} 오늘 예약을 잠시 받지 않아요. 내일 이후 날짜로 골라 주세요.`;
    else issue = `${formatDate(s.date)}은 예약할 수 있는 시간이 지났어요.`;
  }
  if (s.time) {
    const check = checkVisitTime(r, slots.date ?? now, s.time, now);
    // 날짜를 아직 모르면 영업시간만 본다 (지난 시간인지, 오늘 일시 중지인지는 날짜를 정한 뒤에)
    if (check === "ok" || ((check === "past" || check === "paused") && !slots.date)) slots.time = s.time;
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

// 비교할 이름: 메뉴·식당 이름 전체와 띄어 쓴 낱말(3글자 이상). 짧은 말은 엉뚱한 데 걸리기 쉬워 뺀다.
// 숫자가 든 말("2마리", "치즈볼20개")도 뺀다: 손님이 말한 수량("한 마리", "치킨 2마리")이 세트 메뉴 이름과 비슷하다고 잘못 잡힌다
function fuzzyTargets(): { hit: FuzzyHit; word: string }[] {
  const targets: { hit: FuzzyHit; word: string }[] = [];
  const add = (hit: FuzzyHit, name: string) => {
    for (const w of new Set([squash(name), ...name.split(/\s+/).map(squash)])) if ([...w].length >= 3 && !/\d/.test(w)) targets.push({ hit, word: w });
  };
  for (const item of deliveryMenu()) add({ kind: "menu", item, name: item.name }, item.name);
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
  return deliveryMenu().find((d) => typed.includes(squash(d.name)) && !available.has(d.id));
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
// 주문을 한 줄로 (세트 메뉴면 고른 맛까지): "못말리는파닭 2마리 치킨 세트 1세트 (간장 파닭, 블랙스완 파닭(+1,000원))"
export const orderLabel = (o: OrderRecord) => `${o.order.store.name} ${orderItemText(o.order)}`;

const STATUS_TITLE: Record<OrderRecord["status"], string> = {
  "입금 대기": "입금을 기다리고 있어요.",
  접수: "입금이 확인돼 주문이 접수됐어요.",
  "준비 중": "가게에서 준비 중이에요.",
  완료: "배달이 완료됐어요.",
  취소: "취소된 주문이에요.",
};
const STATUS_NOTE: Partial<Record<OrderRecord["status"], string>> = {
  "입금 대기": "사장님이 입금을 확인하면 준비를 시작해요.",
  접수: "가게에서 곧 준비를 시작해요.",
  완료: "맛있게 드세요!",
};

// 계좌이체 안내 줄: 은행·계좌번호(복사)·예금주·금액·입금자명·기한
function transferRows(order: Order) {
  if (!order.bank) return [];
  return [
    { label: "입금 계좌", value: `${order.bank.bank} ${order.bank.account}`, copy: accountDigits(order.bank.account) },
    { label: "예금주", value: order.bank.holder },
    { label: "입금 금액", value: won(order.price), emphasis: true },
    ...(order.depositor ? [{ label: "입금자명", value: order.depositor }] : []),
    ...(order.payBy ? [{ label: "입금 기한", value: `${untilText(order.payBy)}까지` }] : []),
  ];
}

// 가게 전화번호 줄 (사장님이 번호를 등록했으면). 누르면 전화를 건다
const storePhoneRows = (order: Order) => (order.storePhone ? [{ label: "가게 전화", value: order.storePhone, tel: true }] : []);

// 주문을 넣은 직후: 어디로 얼마를 언제까지 보내면 되는지
export function transferCard(o: OrderRecord): InfoCard {
  const { order } = o;
  return {
    title: `주문을 받았어요! 아래 계좌로 입금해 주세요.`,
    rows: [{ label: "주문", value: orderLabel(o) }, ...transferRows(order), ...storePhoneRows(order)],
    note: "사장님이 입금을 확인하면 준비를 시작해요. 기한까지 입금이 확인되지 않으면 주문이 자동으로 취소돼요.",
    say: order.bank
      ? `주문을 받았어요. ${order.bank.bank} ${order.bank.account}, 예금주 ${order.bank.holder}에게 ${won(order.price)}을 ${order.payBy ? `${untilText(order.payBy)}까지 ` : ""}입금해 주세요. 사장님이 입금을 확인하면 준비를 시작해요.`
      : undefined,
  };
}

// 내 주문 상태를 표로: 주문 내용, 상태, (입금 전이면) 입금 안내, (오는 중이면) 도착 예정
export function orderStatusCard(o: OrderRecord): InfoCard {
  const coming = o.status === "접수" || o.status === "준비 중";
  return {
    title: STATUS_TITLE[o.status],
    rows: [
      { label: "주문", value: orderLabel(o) },
      { label: "상태", value: o.status },
      ...(o.status === "입금 대기" ? transferRows(o.order) : []),
      ...(coming ? [{ label: "도착 예정", value: `약 ${hhmm(o.createdAt + ETA_MINUTES * 60_000)}`, emphasis: true }] : []),
      ...storePhoneRows(o.order),
    ],
    note: (o.status === "취소" && o.order.cancelNote) || STATUS_NOTE[o.status],
  };
}

// 가게 정보를 표로: 영업시간(지금 영업 중인지)·주소·대표 메뉴·거리
export function storeInfoCard(r: Restaurant, now: Date): InfoCard {
  // 일시 중지 중이면 영업 중이어도 "잠시 쉬는 중"으로 알린다
  const paused = storePausedUntil(r.id, now.getTime());
  const state = paused
    ? `지금 잠시 주문을 받지 않아요. ${untilText(paused, now.getTime())}부터 다시 받아요.`
    : isOpenNow(r, now)
      ? "지금 영업 중이에요."
      : "지금은 영업시간이 아니에요.";
  const tag = paused ? `잠시 쉬는 중 (${untilText(paused, now.getTime())}까지)` : openStateText(r, now);
  return {
    title: `${r.name} 정보예요.`,
    rows: filledRows([
      { label: "영업시간", value: `${r.hours} · ${tag}`, emphasis: true },
      { label: "주소", value: r.address },
      { label: "대표 메뉴", value: r.signature },
      { label: "거리", value: km(r.distanceKm) },
    ]),
    say: `${withTopicParticle(r.name)} ${r.hours.replace("-", "부터")}까지 영업해요. ${state}${r.address ? ` 주소는 ${r.address}예요.` : ""}`,
  };
}
