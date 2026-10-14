// 챗봇이 여러 가지로 말해도 우리 기능(배달·식당 예약·주문 조회)으로 이어 가는지 실제 대화로 확인한다.
// 시각은 2026-10-10(토) 18:30 저녁으로 고정한다
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getDb, getMenu, refresh } from "../data/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderChatbot } from "./OrderChatbot";
import { CUSTOMER, loginCustomer, server } from "../test/setup";
import { logout } from "../auth/auth";

beforeEach(async () => {
  // 계정에 배달지가 있는 고객님으로 시작한다 (로그인·배달지가 없을 때는 아래 "로그인과 배달지" 에서 따로 본다)
  await loginCustomer();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 10, 18, 30));
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
  // 매장 설정·인기 통계·메뉴를 다 받아 온 뒤에 말한다 (시간만 기다리면 컴퓨터가 느릴 때 받기 전에 말해 버린다)
  await act(() => refresh(["settings", "popular", "menu"]));
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

// 로그인한 고객님의 지난 주문 하나를 넣어 둔다
function myOrder() {
  const rec = db().addOrder({
    customer: CUSTOMER.username,
    customerName: CUSTOMER.name,
    payment: "카카오페이",
    storeId: "h3",
    order: { store: { name: "청전 치킨공방" }, storeId: "h3", item: "간장치킨", qty: 2, unit: "마리", price: 40000, address: CUSTOMER.address, phone: CUSTOMER.phone },
  });
  return rec.id;
}

// 말풍선 안 버튼들의 이름. 추천 카드(메뉴·식당)는 굵은 이름만, 나머지 버튼은 글자 그대로 (카드가 먼저, 작은 버튼이 그 아래)
const buttonsIn = (re: RegExp) =>
  within(screen.getAllByText(re).at(-1)!.closest(".bubble")!)
    .getAllByRole("button")
    .map((b) => b.querySelector("b")?.textContent ?? b.textContent);
// 추천 카드 설명에 붙은 오늘의 메뉴·할인 표시와 가격: "간장치킨" → { tags: ["20% 할인"], price: "16,000원" }
const cardOf = (name: string) => {
  const card = screen.getAllByRole("button", { name }).at(-1)!;
  return { tags: [...card.querySelectorAll("em")].map((e) => e.textContent), price: card.querySelector(".place-distance")?.textContent };
};

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
    // 저녁에는 치킨 카드가 먼저, 그 아래 지난번 메뉴 다시(로그인한 고객님)·식당 찾기 버튼
    const buttons = buttonsIn(/저녁 메뉴로/);
    expect(buttons.slice(0, 2)).toEqual(["옛날통닭", "간장치킨"]);
    expect(buttons).toContain("지난번 메뉴 다시");
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
    await waitFor(() => expect(getDb().storeSettings.h3?.items?.d2?.soldOut).toBe(true));
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
    myOrder();
    await renderChat();
    await say("늘 먹던 거");
    expect(await find(/지난번에 드신 간장치킨 2마리로 주문서를 만들었어요/)).toBeTruthy();
    expect(screen.getByText("간장치킨 2마리")).toBeInTheDocument();
  });

  it("지난 주문이 있으면 추천에 '지난번 메뉴 다시'가 붙는다", async () => {
    myOrder();
    await renderChat();
    await say("배고파");
    await click("지난번 메뉴 다시");
    expect(await find(/지난번에 드신 간장치킨/)).toBeTruthy();
  });
});

describe("5. 주문한 뒤의 질문", () => {
  it("내 주문 상태와 도착 예정 시각을 알려 준다", async () => {
    myOrder();
    await renderChat();
    await say("내 주문 어디쯤 왔어");
    // 상태는 표로: 주문 내용·상태·도착 예정
    expect(await find(/주문이 접수됐어요/)).toBeTruthy();
    expect(inCard("청전 치킨공방 간장치킨 2마리")).toBe(true);
    expect(inCard("접수")).toBe(true);
    expect(screen.getByText(/^약 19:1\d$/)).toBeInTheDocument();
  });

  it("접수 상태 주문은 확인을 받고 취소한다", async () => {
    const id = myOrder();
    await renderChat();
    await say("주문 취소할래");
    expect(await find(/간장치킨 2마리 주문을 취소할까요/)).toBeTruthy();
    await click("취소할게요");
    expect(await find(/주문을 취소했어요/)).toBeTruthy();
    expect(server.db.orderById(id)?.status).toBe("취소");
  });

  it("가게가 준비를 시작한 주문은 취소할 수 없다고 알려 준다", async () => {
    const id = myOrder();
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

describe("로그인과 배달지", () => {
  it("로그인하지 않았으면 배달을 고를 때 로그인하러 가자고 하고, 주소를 챗봇에서 묻지 않는다", async () => {
    await logout();
    await renderChat();
    await say("배달");
    expect(await find(/배달 주문은 로그인한 뒤에 할 수 있어요/)).toBeTruthy();
    expect(screen.queryByText(/오늘은 이런 메뉴 어떠세요/)).not.toBeInTheDocument();
    await say("간장치킨 2마리 시켜줘");
    expect((await find(/배달 주문은 로그인한 뒤에 할 수 있어요/)).length).toBe(2);
    expect(screen.queryByText(ORDER_TITLE)).not.toBeInTheDocument();
    await click("로그인하러 가기");
    expect(window.location.hash).toBe("#/login");
  });

  it("로그인하지 않아도 식당 예약은 된다", async () => {
    await logout();
    await renderChat();
    await say("치킨집 예약");
    expect(await find(/장락 옛날통닭/)).toBeTruthy();
    expect(screen.queryByText(/로그인한 뒤에/)).not.toBeInTheDocument();
  });

  it("로그인 전에 고른 메뉴·수량은 로그인하고 돌아오면 그대로 주문서로 이어진다", async () => {
    await logout();
    const first = render(<OrderChatbot />);
    fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
    await say("간장치킨 2마리");
    await find(/로그인한 뒤에 할 수 있어요/);
    first.unmount();

    await loginCustomer2();
    await renderChat();
    await wait();
    expect(await find(/고르시던 배달 주문을 이어서 도와드릴게요/)).toBeTruthy();
    expect(await find(/^간장치킨 2마리$/)).toBeTruthy();
    expect(inCard(CUSTOMER.address)).toBe(true);
  });

  it("주문서에서 '연락처 바꿀래'는 계정 관리로 가자고 한다", async () => {
    await renderChat();
    await say("옛날통닭 1마리");
    await say("연락처 바꿀래");
    expect(await find(/연락처는 계정 관리에서 바꿀 수 있어요/)).toBeTruthy();
    await click("계정 관리로 가기");
    expect(window.location.hash).toBe("#/account");
  });
});

// 로그아웃한 뒤 같은 고객님으로 다시 로그인한다 (계정은 이미 있다)
async function loginCustomer2() {
  const { login } = await import("../auth/auth");
  const r = await login(CUSTOMER.username, "password1");
  if ("error" in r) throw new Error(r.error);
}
describe("할인과 오늘의 메뉴", () => {
  const setDeals = async () => {
    const { todayKST } = await import("./deals");
    server.db.updateStoreSettings("h3", { item: { id: "d2", patch: { discountPct: 20 } } });
    server.db.updateStoreSettings("s1", { special: { itemId: "d4", date: todayKST() } } as never);
  };

  it("배달 추천에서 오늘의 메뉴가 맨 앞, 할인 메뉴가 그다음이고 버튼에 표시된다", async () => {
    await setDeals();
    await renderChat();
    await say("배달");
    // 오늘의 메뉴·할인은 식당 추천과 같은 메뉴 카드에 표시하고, 가격은 할인한 값
    await find(/오늘은 이런 메뉴 어떠세요/);
    expect(buttonsIn(/오늘은 이런 메뉴 어떠세요/).slice(0, 2)).toEqual(["국물떡볶이", "간장치킨"]);
    expect(cardOf("국물떡볶이")).toEqual({ tags: ["오늘의 메뉴"], price: "6,000원" });
    expect(cardOf("간장치킨")).toEqual({ tags: ["20% 할인"], price: "16,000원" });
    expect(cardOf("옛날통닭").tags).toEqual([]);
  });

  it("할인 메뉴를 주문하면 할인 가격으로 주문서를 만든다", async () => {
    await setDeals();
    await renderChat();
    await say("간장치킨 2마리");
    expect(await find(/^간장치킨 2마리$/)).toBeTruthy();
    expect(inCard("32,000원 (20% 할인)")).toBe(true);
  });

  it("'할인하는 거 있어?'라고 물으면 오늘의 메뉴와 할인 메뉴를 알려 준다", async () => {
    await setDeals();
    await renderChat();
    await say("할인하는 거 있어?");
    expect(await find(/오늘의 메뉴와 할인 중인 메뉴예요/)).toBeTruthy();
    expect(buttonsIn(/오늘의 메뉴와 할인 중인 메뉴예요/)).toEqual(["국물떡볶이", "간장치킨", "직접 입력"]);
    expect(cardOf("간장치킨")).toEqual({ tags: ["20% 할인"], price: "16,000원" });
  });

  it("할인이나 오늘의 메뉴가 없으면 그렇다고 하고 다른 메뉴를 권한다", async () => {
    await renderChat();
    await say("오늘의 메뉴 뭐야?");
    expect(await find(/지금 진행 중인 할인이나 오늘의 메뉴는 없어요/)).toBeTruthy();
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
    // 챗봇이 서버의 메뉴 목록을 받아 온 뒤에 말한다 (처음에는 목록 파일의 메뉴로 시작한다)
    await waitFor(() => expect(getMenu().find((d) => d.id === "d1")?.active).toBe(false));
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

  it("'101동 202호'의 101 은 수량이 아니다: 주소 바꾸기(계정 관리)로 간다", async () => {
    await renderChat();
    await say("옛날통닭 1마리");
    await say("주소를 하소동 101동 202호로 바꿔줘");
    expect(await find(/배달지는 계정 관리에서 바꿀 수 있어요/)).toBeTruthy();
    expect(screen.queryByText(/수량을 101마리로/)).not.toBeInTheDocument();
  });

  it("메뉴 추천을 받은 뒤 '치킨집 예약'이라고 하면 치킨 배달이 아니라 근처 치킨집 예약으로 간다", async () => {
    await renderChat();
    await say("배고파");
    await find(/저녁 메뉴로/);
    await type("치킨집 예약");
    expect(await find(/근처 치킨 맛집을 추천해요/)).toBeTruthy();
    expect(screen.queryByText(/몇 마리 주문할까요/)).not.toBeInTheDocument();
    await click(/장락 옛날통닭/);
    expect(await find(/장락 옛날통닭 예약을 도와드릴게요/)).toBeTruthy();
  });

  it("로그인하지 않은 손님도 메뉴 추천 뒤 '치킨집 예약'은 로그인 안내 없이 식당 예약으로 간다", async () => {
    await logout();
    await renderChat();
    await say("배고파");
    await find(/저녁 메뉴로/);
    await type("치킨집 예약");
    expect(await find(/근처 치킨 맛집을 추천해요/)).toBeTruthy();
    expect(screen.queryByText(/로그인한 뒤에/)).not.toBeInTheDocument();
  });

  it("주문 확인 중에 '치킨집 예약할래'라고 하면 주문을 접고 식당 예약으로 간다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await find(/^간장치킨 2마리$/);
    await say("치킨집 예약할래");
    expect(await find(/근처 치킨 맛집을 추천해요/)).toBeTruthy();
    // 주문은 접혀서 '응'이라고 해도 결제로 가지 않는다
    expect(screen.queryByText(/답해 주세요/)).not.toBeInTheDocument();
  });

  it("취소 확인에서 '취소 안 할래'는 그대로 둔다", async () => {
    const id = myOrder();
    await renderChat();
    await say("주문 취소할래");
    await find(/주문을 취소할까요/);
    await say("취소 안 할래");
    expect(await find(/주문을 그대로 둘게요/)).toBeTruthy();
    expect(server.db.orderById(id)?.status).toBe("접수");
  });

  it("취소 확인에서 '그냥 취소해줘'는 취소한다", async () => {
    const id = myOrder();
    await renderChat();
    await say("주문 취소할래");
    await find(/주문을 취소할까요/);
    await say("그냥 취소해줘");
    expect(await find(/주문을 취소했어요/)).toBeTruthy();
    expect(server.db.orderById(id)?.status).toBe("취소");
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
    myOrder();
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
