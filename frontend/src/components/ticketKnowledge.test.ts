import { describe, expect, it } from "vitest";
import { completionText, findPayment, orderCardRows } from "./orderChatKnowledge";
import {
  SHOWS,
  TICKET_PROMPT,
  assignSeats,
  findShow,
  isShowDate,
  makeTicketOrder,
  matchTicketCategory,
  sessionPrompt,
  sessionsOn,
  showDatePrompt,
  showsOf,
} from "./ticketKnowledge";

// 2026-10-01(목) 오후 3시 기준
const now = new Date(2026, 9, 1, 15, 0);
const show = (title: string) => SHOWS.find((s) => s.title === title)!;

describe("예매", () => {
  it("종류 선택지는 영화·뮤지컬·콘서트·전시이고, 말로도 종류를 찾는다", () => {
    expect(TICKET_PROMPT.choices?.map((c) => c.label)).toEqual(["영화", "뮤지컬", "콘서트", "전시"]);
    expect(matchTicketCategory("영화 보고 싶어")?.key).toBe("movie");
    expect(matchTicketCategory("재즈 공연")?.key).toBe("concert");
    expect(showsOf("musical").every((s) => s.category === "musical")).toBe(true);
    expect(findShow("별빛정거장", showsOf("movie"))?.id).toBe("mv1");
  });

  it("오늘은 이미 시작한 회차를 빼고, 남은 회차가 없는 날은 고를 수 없다", () => {
    const movie = show("별빛 정거장"); // 10:30, 13:20, 16:10, 19:00, 21:40
    const today = new Date(2026, 9, 1);
    expect(sessionsOn(movie, today, now)).toEqual(["16:10", "19:00", "21:40"]);
    expect(sessionsOn(movie, new Date(2026, 9, 2), now)).toHaveLength(5);
    // 콘서트는 19:30 한 회차 — 밤 9시면 오늘은 끝
    expect(isShowDate(show("가을밤 재즈 나이트"), today, new Date(2026, 9, 1, 21, 0))).toBe(false);
    expect(isShowDate(movie, new Date(2026, 9, 14), now)).toBe(true);
    expect(isShowDate(movie, new Date(2026, 9, 15), now)).toBe(false);
  });

  it("날짜 질문은 달력을 펼칠 수 있고, 회차 질문은 정해진 회차만 버튼으로 준다", () => {
    expect(showDatePrompt(show("빛의 정원"), now).picker).toBe("date");
    const sessions = sessionPrompt(show("빛의 정원"), new Date(2026, 9, 2), now);
    expect(sessions.noDirect).toBe(true);
    expect(sessions.choices?.map((c) => c.value)).toEqual(["14:00", "19:30"]);
    expect(sessionPrompt(show("빛과 색의 미술관"), new Date(2026, 9, 2), now).text).toContain("입장 시간을 골라 주세요");
  });

  it("좌석은 같은 조건이면 늘 같게 배정하고, 전시는 좌석이 없다", () => {
    const date = new Date(2026, 9, 2);
    const seats = assignSeats(show("빛의 정원"), date, "19:30", 2);
    expect(seats).toMatch(/^[D-J]열 \d+~\d+번$/);
    expect(assignSeats(show("빛의 정원"), date, "19:30", 2)).toBe(seats);
    expect(assignSeats(show("빛의 정원"), date, "19:30", 1)).toMatch(/^[D-J]열 \d+번$/);
    expect(assignSeats(show("공룡 대탐험전"), date, "10:00", 2)).toBeUndefined();
  });

  it("예매 주문서와 완료 문구에 작품·일시·장소·매수·좌석이 들어간다", () => {
    const order = makeTicketOrder(show("한여름 탐정단"), new Date(2026, 9, 2), "17:00", 3);
    expect(order).toMatchObject({ kind: "ticket", item: "한여름 탐정단", option: "10월 2일 (금) 17:00", qty: 3, unit: "매", price: 42000 });
    expect(orderCardRows(order).map((r) => r.label)).toEqual(["작품", "장소", "일시", "매수", "결제 금액"]);
    const done = completionText(order, findPayment("토스페이")!, now);
    expect(done).toMatch(/예매번호: T\d{6}/);
    expect(done).toContain("10월 2일 (금) 17:00 · 제천 시네마 2관");
    expect(done).toContain(`3매 · ${order.seats}`);
  });
});
