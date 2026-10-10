// 챗봇이 여러 가지로 말해도 우리 기능(배달·식당 예약·주문 조회)으로 이어 가는지 실제 대화로 확인한다.
// 시각은 2026-10-10(토) 18:30 저녁으로 고정한다
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderChatbot } from "./OrderChatbot";
import { server } from "../test/setup";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 10, 18, 30));
});
afterEach(() => {
  vi.useRealTimers();
});

const wait = (ms = 1200) => act(() => vi.advanceTimersByTimeAsync(ms));
const find = (re: RegExp) => screen.findAllByText(re, {}, { timeout: 3000 });

async function renderChat() {
  render(<OrderChatbot />);
  fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
  await wait(50); // 매장 설정·인기 통계를 받아 온다
}

async function say(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
  await wait();
}

// 선택 버튼이 떠 있으면 입력창이 접히므로 "직접 입력"을 눌러 연다
async function type(text: string) {
  const direct = screen.queryAllByRole("button", { name: "직접 입력" }).at(-1);
  if (direct && !direct.hasAttribute("disabled")) fireEvent.click(direct);
  await say(text);
}

async function click(name: string | RegExp) {
  fireEvent.click(screen.getAllByRole("button", { name }).at(-1)!);
  await wait();
}

// 테스트 서버 DB 에 바로 넣는 함수들 (testServer.d.mts 에 없는 것만 여기서 적는다)
type Db = typeof server.db & {
  addOrder(rec: object): { id: string };
  setOrderStatus(id: string, status: string): void;
};
const db = () => server.db as Db;

// 비회원 주문 하나를 영수증 번호와 함께 넣고, 이 브라우저가 그 번호를 가진 것처럼 해 둔다
function guestOrder() {
  const rec = db().addOrder({
    customer: "guest",
    customerName: "비회원",
    payment: "카카오페이",
    storeId: "h3",
    order: { store: { name: "청전 치킨공방" }, storeId: "h3", item: "간장치킨", qty: 2, unit: "마리", price: 40000 },
    receipt: "receipt-1",
  });
  localStorage.setItem("saylo.receipts", JSON.stringify(["receipt-1"]));
  return rec.id;
}

const buttonsIn = (re: RegExp) =>
  within(screen.getAllByText(re).at(-1)!.closest(".bubble")!)
    .getAllByRole("button")
    .map((b) => b.textContent);

// 처음 점검 때 쓴 20문장. 예전에는 7개만 기능으로 이어졌다
const BENCHMARK: [string, RegExp][] = [
  ["배고파", /저녁 메뉴로 이런 건 어떠세요/],
  ["뭐 먹지", /저녁 메뉴로 이런 건 어떠세요/],
  ["추천해줘", /저녁 메뉴로 이런 건 어떠세요/],
  ["메뉴 뭐 있어?", /저녁 메뉴로 이런 건 어떠세요/],
  ["안녕하세요", /오늘은 무엇을 도와드릴까요/],
  ["고마워", /천만에요/],
  ["영업시간 알려줘", /어느 가게가 궁금하세요/],
  ["내 주문 어디쯤 왔어", /최근 주문 내역이 없어요/],
  ["주문 취소할래", /취소할 주문이 없어요/],
  ["짜장면 배달해줘", /짜장면은 아직 배달이 안 돼요/],
  ["제일 가까운 식당", /가장 가까운 곳들이에요/],
  ["내일 저녁 7시 4명 중식당 예약", /근처 중식 맛집을 추천해요/],
  ["치킨 두마리", /이런 메뉴를 추천해요/],
  ["간장치킨 2마리 시켜줘", /^간장치킨 2마리$/],
  ["배달", /오늘은 이런 메뉴 어떠세요/],
  ["식당", /오늘은 어떤 음식이 당기세요/],
  ["한식 먹고 싶어", /근처 한식 맛집을 추천해요/],
  ["피자 주문할래", /몇 판 주문할까요/],
  ["떡볶이", /몇 인분 주문할까요/],
  ["근처 식당 예약할래", /오늘은 어떤 음식이 당기세요/],
];

describe("처음 점검한 20문장", () => {
  it.each(BENCHMARK)("%s", async (text, expected) => {
    await renderChat();
    await say(text);
    expect((await find(expected)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/잘 이해하지 못했어요/)).not.toBeInTheDocument();
  });
});

describe("1. 모르겠어요 대신 기능으로", () => {
  it("배고프다고 하면 지금 시간대 메뉴와 식당 찾기를 권한다", async () => {
    await renderChat();
    await say("배고파");
    // 저녁에는 치킨이 먼저, 마지막에 식당 찾기
    const buttons = buttonsIn(/저녁 메뉴로/);
    expect(buttons.slice(0, 2)).toEqual(["옛날통닭", "간장치킨"]);
    expect(buttons).toContain("식당 찾기");
    await click("간장치킨");
    expect(await find(/몇 마리 주문할까요/)).toBeTruthy();
  });

  it("메뉴 이름을 조금 틀려도 알아듣는다", async () => {
    await renderChat();
    await say("깐장치킨");
    expect(await find(/간장치킨은 청전 치킨공방에서/)).toBeTruthy();
  });

  it("비슷한 이름이 있으면 되묻고, 고르면 그 기능으로 간다", async () => {
    await renderChat();
    await say("마르게리타");
    expect(await find(/혹시 마르게리따 피자를 찾으세요/)).toBeTruthy();
    await click("마르게리따 피자 주문");
    expect(await find(/몇 판 주문할까요/)).toBeTruthy();
  });

  it("식당 이름을 비슷하게 말하면 그 식당 예약인지 되묻는다", async () => {
    await renderChat();
    await say("할머니국밥 예약");
    expect(await find(/혹시 장락 할매국밥을 찾으세요/)).toBeTruthy();
    await click("장락 할매국밥 예약");
    expect(await find(/장락 할매국밥 예약을 도와드릴게요/)).toBeTruthy();
  });
});

describe("2. 한 번에 말한 정보 기억하기", () => {
  it("날짜·시간·인원을 먼저 말하면 식당만 고르고 바로 예약 확인으로 간다", async () => {
    await renderChat();
    await say("내일 저녁 7시 4명 중식당 예약");
    await click(/장락반점/);
    expect(await find(/예약 내용을 확인해 주세요/)).toBeTruthy();
    expect(screen.getByText("10월 11일 (일)")).toBeInTheDocument();
    expect(screen.getByText("19:00")).toBeInTheDocument();
    expect(screen.getByText("4명")).toBeInTheDocument();
    expect(screen.queryByText(/언제 방문하실 건가요/)).not.toBeInTheDocument();
  });

  it("영업시간에 안 맞는 시간은 빼고 그 이유와 함께 다시 묻는다", async () => {
    await renderChat();
    await say("내일 밤 11시 2명 중식 예약");
    await click(/장락반점/);
    expect(await find(/23:00에는 예약할 수 없어요/)).toBeTruthy();
    expect(screen.getByText(/몇 시에 방문하실 건가요/)).toBeInTheDocument();
  });

  it("메뉴를 고르기 전에 말한 수량을 기억한다", async () => {
    await renderChat();
    await say("치킨 두마리");
    await click("간장치킨");
    expect(await find(/^간장치킨 2마리$/)).toBeTruthy();
  });

  it("결제수단까지 말하면 주문을 확인하자마자 그 결제 화면을 연다", async () => {
    await renderChat();
    await say("간장치킨 2마리 카카오페이로");
    await click("응 해줘");
    await wait(500);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /카카오페이/ })[0]).toHaveClass("selected");
  });
});

describe("3. 안 되는 것 대신 할 수 있는 것", () => {
  it("배달 메뉴에 없는 음식은 그 음식 식당을 대신 권한다", async () => {
    await renderChat();
    await say("짜장면 배달해줘");
    expect(await find(/짜장면은 아직 배달이 안 돼요/)).toBeTruthy();
    await click(/장락반점/);
    expect(await find(/장락반점 예약을 도와드릴게요/)).toBeTruthy();
  });

  it("품절 메뉴는 비슷한 메뉴를 권한다", async () => {
    server.db.updateStoreSettings("h3", { item: { id: "d2", patch: { soldOut: true } } });
    await renderChat();
    await say("간장치킨 시켜줘");
    expect(await find(/간장치킨은 지금 품절이에요/)).toBeTruthy();
    await click("옛날통닭");
    expect(await find(/몇 마리 주문할까요/)).toBeTruthy();
  });
});

describe("4. 똑똑한 추천", () => {
  it("배달 메뉴는 최근 많이 주문된 것부터 보여 준다", async () => {
    for (let i = 0; i < 2; i++) db().addOrder({ customer: "guest", customerName: "비회원", payment: "카드", storeId: "s1", order: { item: "국물떡볶이" } });
    await renderChat();
    await say("배달");
    expect(buttonsIn(/오늘은 이런 메뉴 어떠세요/)[0]).toBe("국물떡볶이");
  });

  it("식당 목록에 지금 영업 중인지 표시한다", async () => {
    await renderChat();
    await say("치킨집 예약");
    expect(await find(/장락 옛날통닭/)).toBeTruthy();
    // 18:30: 두 곳 다 영업 중
    expect(screen.getAllByText(/영업 중/).length).toBeGreaterThanOrEqual(2);
  });

  it("늘 먹던 거: 지난 주문을 같은 수량으로 주문서까지 만든다", async () => {
    guestOrder();
    await renderChat();
    await say("늘 먹던 거");
    expect(await find(/지난번에 드신 간장치킨 2마리로 주문서를 만들었어요/)).toBeTruthy();
    expect(screen.getByText("간장치킨 2마리")).toBeInTheDocument();
  });

  it("지난 주문이 있으면 추천에 '지난번 메뉴 다시'가 붙는다", async () => {
    guestOrder();
    await renderChat();
    await say("배고파");
    await click("지난번 메뉴 다시");
    expect(await find(/지난번에 드신 간장치킨/)).toBeTruthy();
  });
});

describe("5. 주문한 뒤의 질문", () => {
  it("내 주문 상태와 도착 예정 시각을 알려 준다", async () => {
    guestOrder();
    await renderChat();
    await say("내 주문 어디쯤 왔어");
    expect(await find(/간장치킨 2마리 주문이 접수됐어요/)).toBeTruthy();
    expect(screen.getByText(/도착 예정: 약 19:1\d/)).toBeInTheDocument();
  });

  it("접수 상태 주문은 확인을 받고 취소한다", async () => {
    const id = guestOrder();
    await renderChat();
    await say("주문 취소할래");
    expect(await find(/간장치킨 2마리 주문을 취소할까요/)).toBeTruthy();
    await click("취소할게요");
    expect(await find(/주문을 취소했어요/)).toBeTruthy();
    expect(server.db.orderById(id)?.status).toBe("취소");
  });

  it("가게가 준비를 시작한 주문은 취소할 수 없다고 알려 준다", async () => {
    const id = guestOrder();
    db().setOrderStatus(id, "준비 중");
    await renderChat();
    await say("주문 취소할래");
    expect(await find(/이미 준비를 시작해서 취소할 수 없어요/)).toBeTruthy();
  });

  it("가게 영업시간·주소를 알려 주고, 예약으로 이어 갈 수 있다", async () => {
    await renderChat();
    await say("장락반점 영업시간 알려줘");
    expect(await find(/영업시간 11:00 - 21:00 · 지금 영업 중이에요/)).toBeTruthy();
    await click("예약하기");
    expect(await find(/장락반점 예약을 도와드릴게요/)).toBeTruthy();
  });

  it("어느 가게인지 말하지 않으면 목록에서 고르게 한다", async () => {
    await renderChat();
    await say("영업시간 알려줘");
    await click(/장락 떡볶이/);
    expect(await find(/영업시간 10:00 - 21:00/)).toBeTruthy();
  });

  it("제일 가까운 식당은 음식 종류와 상관없이 가까운 순서로", async () => {
    await renderChat();
    await say("제일 가까운 식당");
    const places = within(screen.getByText(/가장 가까운 곳들이에요/).closest(".bubble")!)
      .getAllByRole("button")
      .map((b) => b.querySelector("b")?.textContent);
    expect(places).toEqual(["장락 떡볶이", "장락 할매국밥", "장락 옛날통닭"]);
  });
});

describe("6. 앞에서 한 말 기억하기·고치기", () => {
  it("'그 식당'은 방금 말한 식당", async () => {
    await renderChat();
    await say("장락반점 어디에 있어?");
    await find(/주소/);
    await type("그 식당 예약할래");
    expect(await find(/장락반점 예약을 도와드릴게요/)).toBeTruthy();
  });

  it("주문 확인에서 '3마리로 해줘'라고 하면 수량만 바꾼다", async () => {
    await renderChat();
    await say("간장치킨 2마리 시켜줘");
    await say("3마리로 해줘");
    expect(await find(/수량을 3마리로 바꿨어요/)).toBeTruthy();
    expect(screen.getByText("간장치킨 3마리")).toBeInTheDocument();
    expect(screen.getAllByText("60,000원").length).toBeGreaterThan(0);
  });

  it("예약 확인에서 '8시로 바꿔줘'라고 하면 시간만 바꾼다", async () => {
    await renderChat();
    await say("내일 7시 4명 중식 예약");
    await click(/장락반점/);
    await say("8시로 바꿔줘");
    expect(await find(/말씀하신 대로 바꿨어요/)).toBeTruthy();
    expect(screen.getAllByText("20:00").length).toBeGreaterThan(0);
  });

  it("'아까 그거'는 이번 대화에서 말한 메뉴", async () => {
    await renderChat();
    await say("옛날통닭 1마리");
    await say("취소");
    await say("아까 그거 2마리");
    expect(await find(/^옛날통닭 2마리$/)).toBeTruthy();
  });
});
