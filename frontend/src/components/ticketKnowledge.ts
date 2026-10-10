// 예매: 종류 → 작품 → 날짜 → 회차 → 매수 → 예매 확인 → 결제. 좌석은 자동 배정한다.
// 작품·공연장은 화면 확인용 가상 데이터다.
import {
  addDays,
  daysBetween,
  formatDate,
  squash,
  startOfDay,
  spokenTime,
  toMinutes,
  withSubjectParticle,
  won,
  type BotPrompt,
  type Choice,
  type Order,
} from "./orderChatKnowledge";

export type TicketCategoryKey = "movie" | "musical" | "concert" | "exhibition";

export interface TicketCategory {
  key: TicketCategoryKey;
  label: string;
  keywords: string[];
}

export interface Show {
  id: string;
  category: TicketCategoryKey;
  title: string;
  venue: string;
  info: string; // 등급·상영시간 또는 출연·관람 안내
  price: number; // 1매
  sessions: string[]; // 매일 같은 회차 "HH:MM"
  freeSeating?: boolean; // 전시처럼 좌석이 없는 곳
}

export const TICKET_CATEGORIES: TicketCategory[] = [
  { key: "movie", label: "영화", keywords: ["영화", "무비", "시네마", "극장"] },
  { key: "musical", label: "뮤지컬", keywords: ["뮤지컬"] },
  { key: "concert", label: "콘서트", keywords: ["콘서트", "공연", "라이브", "재즈", "밴드"] },
  { key: "exhibition", label: "전시", keywords: ["전시", "미술관", "박람회"] },
];

export const SHOWS: Show[] = [
  { id: "mv1", category: "movie", title: "별빛 정거장", venue: "제천 시네마 1관", info: "12세 · 118분", price: 14000, sessions: ["10:30", "13:20", "16:10", "19:00", "21:40"] },
  { id: "mv2", category: "movie", title: "한여름 탐정단", venue: "제천 시네마 2관", info: "전체 · 102분", price: 14000, sessions: ["11:00", "14:00", "17:00", "20:00"] },
  { id: "mv3", category: "movie", title: "마지막 항해", venue: "제천 시네마 3관", info: "15세 · 131분", price: 15000, sessions: ["12:10", "15:30", "18:50", "22:00"] },
  { id: "mu1", category: "musical", title: "빛의 정원", venue: "제천문화회관 대극장", info: "8세 이상 · 150분 · R석", price: 77000, sessions: ["14:00", "19:30"] },
  { id: "mu2", category: "musical", title: "시간을 파는 상점", venue: "의림 아트홀", info: "전체 · 120분 · S석", price: 66000, sessions: ["15:00", "19:00"] },
  { id: "co1", category: "concert", title: "가을밤 재즈 나이트", venue: "제천 아트센터", info: "전체 · 100분 · 지정석", price: 55000, sessions: ["19:30"] },
  { id: "co2", category: "concert", title: "청춘 밴드 라이브", venue: "의림 아트홀", info: "전체 · 120분 · 지정석", price: 44000, sessions: ["18:00"] },
  { id: "ex1", category: "exhibition", title: "빛과 색의 미술관", venue: "제천 시립미술관", info: "전체 · 자유 관람", price: 12000, sessions: ["10:00", "13:00", "16:00"], freeSeating: true },
  { id: "ex2", category: "exhibition", title: "공룡 대탐험전", venue: "제천 전시관", info: "전체 · 자유 관람", price: 15000, sessions: ["10:00", "12:00", "14:00", "16:00"], freeSeating: true },
];

export const MAX_TICKET_DAYS = 13; // 오늘부터 2주
export const MAX_TICKETS = 8;

export function matchTicketCategory(text: string): TicketCategory | undefined {
  const low = text.toLowerCase();
  return TICKET_CATEGORIES.find((c) => c.keywords.some((k) => low.includes(k)));
}

export const showsOf = (key: TicketCategoryKey) => SHOWS.filter((s) => s.category === key);

export function findShow(text: string, list: Show[]): Show | undefined {
  const typed = squash(text);
  return list.find((s) => typed.includes(squash(s.title)));
}

// 그날 남은 회차 (오늘이면 이미 시작한 회차는 뺀다)
export function sessionsOn(show: Show, date: Date, now: Date): string[] {
  if (daysBetween(now, date) !== 0) return show.sessions;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return show.sessions.filter((t) => toMinutes(t) > nowMinutes);
}

export function isShowDate(show: Show, date: Date, now: Date): boolean {
  const ahead = daysBetween(now, date);
  return ahead >= 0 && ahead <= MAX_TICKET_DAYS && sessionsOn(show, date, now).length > 0;
}

export const lastShowDate = (now: Date) => addDays(startOfDay(now), MAX_TICKET_DAYS);

export const TICKET_PROMPT: BotPrompt = {
  text: "어떤 공연을 보고 싶으세요?\n지금 볼 수 있는 작품을 추천해 드릴게요.",
  say: `${TICKET_CATEGORIES.map((c) => c.label).join(", ")} 모두 예매할 수 있어요. 보고 싶은 걸 말씀해 주시면 지금 볼 수 있는 작품을 추천해 드릴게요!`,
  choices: TICKET_CATEGORIES.map((c): Choice => ({ label: c.label, value: c.label })),
  placeholder: "예) 영화",
};

export function showDatePrompt(show: Show, now: Date, lead?: string): BotPrompt {
  const today = startOfDay(now);
  // 오늘 회차가 다 끝났으면 "오늘"은 뺀다
  const choices = ["오늘", "내일", "모레"].flatMap((label, i) => {
    const d = addDays(today, i);
    return isShowDate(show, d, now) ? [{ label: `${label} (${d.getMonth() + 1}/${d.getDate()})`, value: label }] : [];
  });
  const head = lead ?? `${show.title} 예매를 도와드릴게요.`;
  return {
    text: `${head}\n언제 보실 건가요?`,
    say: `${head} 언제 보실 건가요?${choices[0] ? ` ${choices[0].value}도 볼 수 있어요.` : ""} 편한 날짜를 말씀해 주세요.`,
    choices,
    picker: "date",
  };
}

export function sessionPrompt(show: Show, date: Date, now: Date, lead?: string): BotPrompt {
  const times = sessionsOn(show, date, now);
  const head = lead ?? formatDate(date);
  const what = show.category === "exhibition" ? "입장 시간" : "회차";
  return {
    text: `${head}\n${what === "회차" ? "회차를" : "입장 시간을"} 골라 주세요.`,
    say: `${head} ${withSubjectParticle(`${times.map(spokenTime).join(", ")} ${what}`)} 남아 있어요. 몇 시로 할까요?`,
    choices: times.map((t) => ({ label: t, value: t })),
    noDirect: true,
  };
}

export const ticketQuantityQuestion = (show: Show, date: Date, time: string) =>
  `${show.title} · ${formatDate(date)} ${time}\n1매 ${won(show.price)}이에요. 몇 매 예매할까요?`;

// 좌석 자동 배정: 같은 작품·일시·매수면 늘 같은 자리. 전시는 자유 관람이라 좌석이 없다
export function assignSeats(show: Show, date: Date, time: string, qty: number): string | undefined {
  if (show.freeSeating) return undefined;
  const key = `${show.id}${date.getMonth()}${date.getDate()}${time}`;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const row = "DEFGHJ"[hash % 6];
  const start = (hash % 9) + 3;
  return qty === 1 ? `${row}열 ${start}번` : `${row}열 ${start}~${start + qty - 1}번`;
}

export function makeTicketOrder(show: Show, date: Date, time: string, qty: number): Order {
  return {
    kind: "ticket",
    store: { name: show.venue },
    storeId: `venue:${show.venue}`,
    item: show.title,
    option: `${formatDate(date)} ${time}`,
    qty,
    unit: "매",
    price: show.price * qty,
    seats: assignSeats(show, date, time, qty),
  };
}
