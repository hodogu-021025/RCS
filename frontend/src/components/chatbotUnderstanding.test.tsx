// 챗봇이 여러 가지로 말해도 우리 기능(배달·식당 예약·주문 조회)으로 이어 가는지 실제 대화로 확인한다.
// 시각은 2026-10-10(토) 18:30 저녁으로 고정한다
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderChatbot } from "./OrderChatbot";
import { server } from "../test/setup";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 10, 18, 30));
  // 배달지를 이미 알려 준 손님으로 시작한다 (주소·연락처를 묻는 흐름은 아래 "배달지" 에서 따로 본다)
  localStorage.setItem("saylo.delivery", JSON.stringify({ address: "제천시 장락동 제천빌라 331호", phone: "010-1234-5678" }));
});
afterEach(() => {
  vi.useRealTimers();
});

const wait = (ms = 1200) => act(() => vi.advanceTimersByTimeAsync(ms));
const ORDER_TITLE = "주문 내역을 확인해 주세요.";
const inCard = (text: string) => screen.queryAllByText(text).some((el) => el.tagName === "DD");
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
    // 상태는 표로: 주문 내용·상태·도착 예정
    expect(await find(/주문이 접수됐어요/)).toBeTruthy();
    expect(inCard("청전 치킨공방 간장치킨 2마리")).toBe(true);
    expect(inCard("접수")).toBe(true);
    expect(screen.getByText(/^약 19:1\d$/)).toBeInTheDocument();
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
    expect(await find(/장락반점 정보예요/)).toBeTruthy();
    expect(inCard("11:00 - 21:00 · 영업 중")).toBe(true);
    expect(inCard("제천시 장락동 30-7")).toBe(true);
    await click("예약하기");
    expect(await find(/장락반점 예약을 도와드릴게요/)).toBeTruthy();
  });

  it("어느 가게인지 말하지 않으면 목록에서 고르게 한다", async () => {
    await renderChat();
    await say("영업시간 알려줘");
    await click(/장락 떡볶이/);
    expect(await find(/^10:00 - 21:00 · 영업 중$/)).toBeTruthy();
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

describe("배달지·연락처", () => {
  it("처음 주문하면 주소와 전화번호를 묻고, 받은 뒤 주문서를 보여 주며 다음 주문을 위해 기억한다", async () => {
    localStorage.removeItem("saylo.delivery");
    await renderChat();
    await say("간장치킨 2마리 시켜줘");
    expect(await find(/배달 받을 주소를 알려 주세요/)).toBeTruthy();
    expect(screen.queryByText(ORDER_TITLE)).not.toBeInTheDocument();

    await say("장락");
    expect(await find(/주소를 조금 더 자세히 알려 주세요/)).toBeTruthy();
    await say("제천시 하소동 행복아파트 101동 202호");
    expect(await find(/가게에서 연락드릴 전화번호를 알려 주세요/)).toBeTruthy();
    await say("12");
    expect(await find(/전화번호를 잘 모르겠어요/)).toBeTruthy();
    await say("010 9876 5432");

    expect(await find(/^간장치킨 2마리$/)).toBeTruthy();
    // 사용자가 보낸 말풍선에도 같은 글자가 있으므로 주문서 칸(dd)에서 찾는다
    expect(inCard("제천시 하소동 행복아파트 101동 202호")).toBe(true);
    expect(inCard("010-9876-5432")).toBe(true);
    expect(JSON.parse(localStorage.getItem("saylo.delivery")!)).toEqual({ address: "제천시 하소동 행복아파트 101동 202호", phone: "010-9876-5432" });
  });

  it("주문서에서 배달지 변경을 누르면 주소만 다시 받고 같은 메뉴로 주문서를 다시 만든다", async () => {
    await renderChat();
    await say("옛날통닭 1마리");
    await click("배달지 변경");
    expect(await find(/새 배달지로 다시 만들어 드릴게요/)).toBeTruthy();
    await say("제천시 청전동 새집 3층");
    expect(await find(/^옛날통닭 1마리$/)).toBeTruthy();
    expect(inCard("제천시 청전동 새집 3층")).toBe(true);
    expect(inCard("010-1234-5678")).toBe(true); // 연락처는 그대로
  });

  it("주소를 묻는 중에 취소하면 주문을 접는다", async () => {
    localStorage.removeItem("saylo.delivery");
    await renderChat();
    await say("떡볶이 2인분");
    await say("취소할래");
    expect(await find(/배달 주문을 그만할게요/)).toBeTruthy();
  });
});

describe("사장님이 추가한 메뉴", () => {
  type MenuDb = { addMenuItem(i: object): { id: string }; updateMenuItem(id: string, p: object): unknown };
  const menuDb = () => server.db as unknown as MenuDb;

  it("사장님이 추가한 메뉴를 챗봇이 바로 주문받고, '치킨'이라고만 해도 추천한다", async () => {
    menuDb().addMenuItem({ restaurantId: "h3", name: "양념치킨", price: 21000, unit: "마리", keywords: ["양념", "치킨"] });
    await renderChat();
    await say("양념치킨 1마리");
    expect(await find(/^양념치킨 1마리$/)).toBeTruthy();
    expect(inCard("21,000원")).toBe(true);
    await say("취소");
    await say("치킨 시켜줘");
    expect(buttonsIn(/이런 메뉴를 추천해요/)).toContain("양념치킨");
  });

  it("판매 중지한 메뉴는 챗봇 추천에서 빠진다", async () => {
    menuDb().updateMenuItem("d1", { active: false }); // 옛날통닭
    await renderChat();
    await say("배달");
    const buttons = buttonsIn(/오늘은 이런 메뉴 어떠세요/);
    expect(buttons).not.toContain("옛날통닭");
    expect(buttons).toContain("간장치킨");
  });
});

describe("점검에서 찾은 문제", () => {
  it("주문 확인에서 수량을 바꿔도 배달지·연락처는 그대로다", async () => {
    await renderChat();
    await say("간장치킨 2마리 시켜줘");
    await say("3마리로 해줘");
    expect(await find(/수량을 3마리로 바꿨어요/)).toBeTruthy();
    expect(inCard("제천시 장락동 제천빌라 331호")).toBe(true);
    expect(inCard("010-1234-5678")).toBe(true);
  });

  it("'101동 202호'의 101 은 수량이 아니다: 주소 바꾸기로 간다", async () => {
    await renderChat();
    await say("옛날통닭 1마리");
    await say("주소를 하소동 101동 202호로 바꿔줘");
    expect(await find(/새 배달지로 다시 만들어 드릴게요/)).toBeTruthy();
  });

  it("취소 확인에서 '취소 안 할래'는 그대로 둔다", async () => {
    const id = guestOrder();
    await renderChat();
    await say("주문 취소할래");
    await find(/주문을 취소할까요/);
    await say("취소 안 할래");
    expect(await find(/주문을 그대로 둘게요/)).toBeTruthy();
    expect(server.db.orderById(id)?.status).toBe("접수");
  });

  it("취소 확인에서 '그냥 취소해줘'는 취소한다", async () => {
    const id = guestOrder();
    await renderChat();
    await say("주문 취소할래");
    await find(/주문을 취소할까요/);
    await say("그냥 취소해줘");
    expect(await find(/주문을 취소했어요/)).toBeTruthy();
    expect(server.db.orderById(id)?.status).toBe("취소");
  });

  it("주소를 묻는 중에 다른 메뉴나 기능을 말하면 주소로 저장하지 않고 그 말로 넘어간다", async () => {
    localStorage.removeItem("saylo.delivery");
    await renderChat();
    await say("간장치킨 1마리");
    await find(/배달 받을 주소를 알려 주세요/);
    await say("옛날통닭 두 마리 시켜줘");
    // 새 메뉴로 다시 주문이 시작되고(주소는 아직 없으니 다시 묻는다), 주소로 저장되지 않았다
    expect(await find(/배달 받을 주소를 알려 주세요/)).toBeTruthy();
    expect(localStorage.getItem("saylo.delivery")).toBeNull();
    await say("제천시 청전동 새집 3층으로 배달해 주세요"); // 주소 뒤의 "배달"은 주소의 일부로 본다
    await say("010 2222 3333");
    expect(await find(/^옛날통닭 2마리$/)).toBeTruthy();
    expect(inCard("제천시 청전동 새집 3층으로 배달해 주세요")).toBe(true);
  });

  it("봇이 답하는 동안 보낸 글은 지워지지 않고 입력창에 남는다", async () => {
    await renderChat();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "배달" } });
    fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
    await wait(50); // 아직 답하는 중
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "간장치킨" } });
    fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
    expect(screen.getByRole("textbox")).toHaveValue("간장치킨");
    expect(await find(/답하는 중이에요/)).toBeTruthy();
  });

  it("서버에 물어보는 중에 새 대화를 시작하면 그 답은 새 대화에 끼어들지 않는다", async () => {
    guestOrder();
    await renderChat();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "주문 취소할래" } });
    fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
    await wait(30);
    fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
    await wait(2000);
    expect(screen.queryByText(/주문을 취소할까요/)).not.toBeInTheDocument();
    expect(screen.getByText(/무엇을 주문해 드릴까요/)).toBeInTheDocument();
  });

  it("예약 날짜·시간을 묻는 중에 '아니 8시로'는 취소가 아니라 고치기다", async () => {
    await renderChat();
    await say("내일 4명 중식 예약");
    await click(/장락반점/);
    expect(await find(/몇 시에 방문하실 건가요/)).toBeTruthy();
    await type("아니 8시로 해줘");
    expect(screen.queryByText(/예약을 취소했어요/)).not.toBeInTheDocument();
    expect(await find(/예약 내용을 확인해 주세요/)).toBeTruthy();
    expect(screen.getAllByText("20:00").length).toBeGreaterThan(0);
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
