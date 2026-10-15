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
// 추천 카드의 이름 옆 태그(오늘의 메뉴), 설명 앞 할인 표시, 가격, 설명 줄: "간장치킨" → { badge: null, tags: ["20% 할인"], price: "16,000원", info }
const cardOf = (name: string) => {
  const card = screen.getAllByRole("button", { name }).at(-1)!;
  return {
    badge: card.querySelector(".place-badge")?.textContent ?? null,
    tags: [...card.querySelectorAll("em")].map((e) => e.textContent),
    price: card.querySelector(".place-distance")?.textContent,
    info: card.querySelector("small")?.textContent,
  };
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
  ["식당", /오늘은 이런 식당 어떠세요/],
  ["한식 먹고 싶어", /근처 한식 맛집을 추천해요/],
  ["피자 주문할래", /몇 판 주문할까요/],
  ["떡볶이", /몇 인분 주문할까요/],
  ["근처 식당 예약할래", /오늘은 이런 식당 어떠세요/],
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
    expect(await find(/장락 할매국밥을 선택했어요/)).toBeTruthy();
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

  it("카카오페이처럼 다른 결제수단을 말해도 계좌이체로 주문하고 입금 안내를 보여 준다", async () => {
    await renderChat();
    await say("간장치킨 2마리 카카오페이로");
    await click("이대로 주문");
    await click("응 해줘");
    expect(await find(/주문을 받았어요! 아래 계좌로 입금해 주세요/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("3. 안 되는 것 대신 할 수 있는 것", () => {
  it("이름에 숫자가 든 메뉴(\"2마리 치킨 세트\")를 말하면 그 숫자를 수량으로 쓰지 않고 몇 세트인지 묻는다", async () => {
    server.db.addMenuItem({ restaurantId: "h3", name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["세트"] });
    await renderChat();
    await refresh(["menu"]);
    await waitFor(() => expect(getMenu().some((d) => d.name === "2마리 치킨 세트")).toBe(true));
    await say("2마리 치킨 세트 시켜줘");
    expect(await find(/몇 세트 주문할까요/)).toBeTruthy();
  });

  it("배달 메뉴에 없는 음식은 그 음식 식당을 대신 권한다", async () => {
    await renderChat();
    await say("짜장면 배달해줘");
    expect(await find(/짜장면은 아직 배달이 안 돼요/)).toBeTruthy();
    await click(/장락반점/);
    expect(await find(/장락반점을 선택했어요/)).toBeTruthy();
  });

  // 테스트 목록의 디저트는 근처 가게가 없는 음식 종류다
  it("근처에 가게가 없는 음식은 없다고 알리고, 음식 고르는 버튼에서도 뺀다", async () => {
    await renderChat();
    await say("케이크 먹고 싶어");
    expect(await find(/아직 근처에 디저트 가게가 없어요/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "디저트" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "치킨" }).length).toBeGreaterThan(0);
  });

  it("관리자가 직접 만든 매장도 추천하고, 거리·평점을 모르면 그 칸을 빼고 보여 준다", async () => {
    server.db.addStore({ name: "하소 케이크하우스", food: "dessert", hours: "09:00 - 23:00" });
    await renderChat();
    await waitFor(() => expect(getDb().storesLoaded).toBe(true));
    await say("케이크 먹고 싶어");
    expect(await find(/근처 디저트 맛집을 추천해요/)).toBeTruthy();
    const card = screen.getAllByRole("button").find((b) => b.textContent?.includes("하소 케이크하우스"))!;
    expect(card.textContent).not.toMatch(/평점|km|undefined/);
    await click(/하소 케이크하우스/);
    expect(await find(/하소 케이크하우스를 선택했어요/)).toBeTruthy();
  });

  it("배달도 가게도 없는 음식은 '대신 맛집에서' 권하지 않는다", async () => {
    await renderChat();
    await say("케이크 배달해줘");
    expect(await find(/케이크는 아직 배달이 안 돼요/)).toBeTruthy();
    expect(await find(/아직 근처에 디저트 가게가 없어요/)).toBeTruthy();
    expect(screen.queryByText(/대신 근처 디저트 맛집/)).not.toBeInTheDocument();
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
    expect(await find(/장락반점을 선택했어요/)).toBeTruthy();
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
  it("로그인하지 않았으면 배달을 고를 때 로그인 화면으로 이동한다고 말하고 잠시 뒤 저절로 넘어간다", async () => {
    window.location.hash = "#/chat";
    await logout();
    await renderChat();
    await say("배달");
    expect(await find(/배달 주문은 로그인한 뒤에 할 수 있어요/)).toBeTruthy();
    expect(await find(/로그인 화면으로 이동시켜드릴게요/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "로그인하러 가기" })).not.toBeInTheDocument(); // 고를 것 없이 바로 간다
    expect(screen.queryByText(/오늘은 이런 메뉴 어떠세요/)).not.toBeInTheDocument();
    expect(screen.queryByText(ORDER_TITLE)).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#/chat"); // 안내를 읽을 틈을 둔다
    await wait(3200);
    expect(window.location.hash).toBe("#/login");
  });

  it("로그인 안내 뒤 넘어가기 전에 새 대화를 누르면 로그인 화면으로 가지 않는다", async () => {
    window.location.hash = "#/chat";
    await logout();
    await renderChat();
    await say("간장치킨 2마리 시켜줘");
    await find(/로그인 화면으로 이동시켜드릴게요/);
    fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
    await wait(3500);
    expect(window.location.hash).toBe("#/chat");
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
    expect(await find(/^간장치킨 2마리$/)).toBeTruthy(); // 담겨서 "더 담을까요?"
    await click("이대로 주문");
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
    // 오늘의 메뉴는 이름 옆 태그로, 할인은 설명 앞에. 영업 상태는 적지 않는다 (일시 중지한 가게는 아예 안 나온다)
    expect(cardOf("국물떡볶이")).toEqual({ badge: "오늘의 메뉴", tags: [], price: "6,000원", info: "장락 떡볶이" });
    expect(cardOf("간장치킨")).toEqual({ badge: null, tags: ["20% 할인"], price: "16,000원", info: "20% 할인 · 청전 치킨공방" });
    expect(cardOf("옛날통닭")).toMatchObject({ badge: null, tags: [], info: "장락 옛날통닭" });
  });

  it("채팅창을 끈 동안의 메뉴 표에도 오늘의 메뉴는 이름 옆 태그로 보인다", async () => {
    await setDeals();
    render(<OrderChatbot />); // 채팅창은 처음에 꺼져 있다
    await act(() => refresh(["settings", "popular", "menu"]));
    await say("배달");
    await wait(15_000); // 자막이 한 글자씩 다 적히고 표가 뜰 때까지
    const special = [...document.querySelectorAll(".caption-row")].find((r) => r.querySelector("dt")?.textContent?.startsWith("국물떡볶이"));
    expect(special?.querySelector(".place-badge")?.textContent).toBe("오늘의 메뉴");
    expect(special?.querySelector("dd")?.textContent).toBe("6,000원 · 장락 떡볶이");
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
    expect(cardOf("간장치킨")).toMatchObject({ tags: ["20% 할인"], price: "16,000원" });
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
    await click("이대로 주문");
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
    expect(await find(/장락 옛날통닭을 선택했어요/)).toBeTruthy();
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
    expect(await find(/장락반점을 선택했어요/)).toBeTruthy();
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

describe("일시 중지한 매장", () => {
  // 청전 치킨공방(간장치킨)을 지금(18:30)부터 한 시간(19:30까지) 일시 중지한다
  const pauseH3 = () => server.db.updateStoreSettings("h3", { pausedUntil: Date.now() + 60 * 60_000 } as never);

  it("배달 추천에서 빠지고, 메뉴 이름을 말하면 이유를 알려 주고 다른 메뉴를 권한다", async () => {
    pauseH3();
    await renderChat();
    await say("배달");
    const buttons = buttonsIn(/오늘은 이런 메뉴 어떠세요/);
    expect(buttons).not.toContain("간장치킨");
    expect(buttons).toContain("옛날통닭");
    await type("간장치킨 2마리");
    expect(await find(/청전 치킨공방은 지금 잠시 주문을 받지 않아요\. 19:30부터 다시 받아요\./)).toBeTruthy();
    expect(buttonsIn(/잠시 주문을 받지 않아요/)).toContain("옛날통닭");
    expect(screen.queryByText(/몇 마리 주문할까요/)).not.toBeInTheDocument();
  });

  it("식당 찾기를 고르면 바로 뜨는 추천 식당에서도 빠진다", async () => {
    pauseH3();
    await renderChat();
    await say("식당");
    const places = buttonsIn(/오늘은 이런 식당 어떠세요/).slice(0, 4);
    expect(places).toHaveLength(4);
    expect(places).not.toContain("청전 치킨공방");
    // 카드 아래에는 음식 종류 버튼이 붙는다
    expect(buttonsIn(/오늘은 이런 식당 어떠세요/)).toEqual(expect.arrayContaining(["한식", "중식", "직접 입력"]));
  });
  it("가게 이름으로 배달을 청해도 이유를 알려 주고, 가게 정보에는 쉬는 중으로 보인다", async () => {
    pauseH3();
    await renderChat();
    await say("청전 치킨공방 배달");
    expect(await find(/청전 치킨공방은 지금 잠시 주문을 받지 않아요/)).toBeTruthy();
    await type("청전 치킨공방 영업시간 알려줘");
    expect(await find(/청전 치킨공방 정보예요/)).toBeTruthy();
    expect(inCard("16:00 - 01:00 · 잠시 쉬는 중 (19:30까지)")).toBe(true);
  });

  it("식당 추천에서 빠지고, 이름으로 예약하면 오늘은 빼고 내일부터 고르게 한다", async () => {
    pauseH3();
    await renderChat();
    await say("치킨집 예약");
    await find(/근처 치킨 맛집을 추천해요/);
    expect(buttonsIn(/근처 치킨 맛집을 추천해요/)).toEqual(["장락 옛날통닭"]);
    fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
    await say("청전 치킨공방 예약");
    expect(await find(/청전 치킨공방은 오늘 예약을 잠시 받지 않아요/)).toBeTruthy();
    const dates = buttonsIn(/언제 방문하실 건가요/);
    expect(dates.some((d) => d?.startsWith("오늘"))).toBe(false);
    expect(dates.some((d) => d?.startsWith("내일"))).toBe(true);
  });

  it("주문서를 보는 사이에 가게가 일시 중지하면 '응'이라고 해도 결제로 가지 않는다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await find(/^간장치킨 2마리$/);
    pauseH3();
    await act(() => refresh(["settings"]));
    await say("응");
    expect(await find(/청전 치킨공방은 지금 잠시 주문을 받지 않아요/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /신용카드/ })).not.toBeInTheDocument();
  });
});

describe("일시 중지 검토에서 찾은 문제", () => {
  const pause = (storeId: string, until = Date.now() + 60 * 60_000) => server.db.updateStoreSettings(storeId, { pausedUntil: until } as never);

  it("'장락 옛날통닭 내일 7시 예약'은 가게 이름 속 메뉴 이름(옛날통닭)이 있어도 예약으로 간다 ('2마리'는 그대로 배달)", async () => {
    await renderChat();
    await say("장락 옛날통닭 내일 7시 예약");
    expect(await find(/몇 명이 방문하시나요/)).toBeTruthy();
    expect(screen.queryByText(/몇 마리 주문할까요/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
    await say("장락 옛날통닭 2마리");
    expect(await find(/^옛날통닭 2마리$/)).toBeTruthy();
  });

  it("일시 중지한 장락 옛날통닭도 이름으로 예약하면 배달 거절 대신 내일 예약으로 간다", async () => {
    pause("h1");
    await renderChat();
    await say("장락 옛날통닭 내일 7시 예약");
    expect(await find(/몇 명이 방문하시나요/)).toBeTruthy();
    expect(screen.queryByText(/잠시 주문을 받지 않아요/)).not.toBeInTheDocument();
  });

  it("그 음식의 가게가 모두 쉬면 빈 목록 대신 그렇다고 알리고 다른 음식을 권한다", async () => {
    pause("h1");
    pause("h3");
    await renderChat();
    await say("치킨집 예약");
    expect(await find(/지금 근처 치킨 가게가 모두 잠시 쉬고 있어요/)).toBeTruthy();
    const foods = buttonsIn(/모두 잠시 쉬고 있어요/);
    expect(foods).not.toContain("치킨");
    expect(foods).toContain("중식");
    expect(document.querySelectorAll(".places button")).toHaveLength(0);
  });

  it("확인하는 사이에 가게가 멈춰 서버가 예약을 거절하면 완료 대신 이유를 알린다", async () => {
    await renderChat();
    await say("장락 옛날통닭 오늘 저녁 7시 2명 예약");
    expect(await find(/예약 내용을 확인해 주세요/)).toBeTruthy();
    pause("h1"); // 화면은 아직 모른다 (서버만 멈춤)
    await say("응");
    expect(await find(/오늘 예약은 잠시 받지 않아요/)).toBeTruthy();
    expect(screen.queryByText(/예약이 완료되었어요/)).not.toBeInTheDocument();
  });

  it("주문서를 보는 사이에 가게가 멈춰 서버가 주문을 거절하면 입금 안내 대신 이유를 알린다", async () => {
    await renderChat();
    await say("간장치킨 1마리");
    await click("이대로 주문");
    await find(/주문할까요\?/);
    pause("h3"); // 화면은 아직 모른다 (서버만 멈춤)
    await say("응");
    expect(await find(/청전 치킨공방은 지금 잠시 주문을 받지 않아요/)).toBeTruthy();
    expect(await find(/주문이 접수되지 않았어요/)).toBeTruthy();
    expect(screen.queryByText(/아래 계좌로 입금해 주세요/)).not.toBeInTheDocument();
  });

  it("끝나는 때가 내일이면 '내일 09:00부터'라고 알린다", async () => {
    pause("h3", new Date(2026, 9, 11, 9, 0).getTime());
    await renderChat();
    await say("간장치킨 2마리");
    expect(await find(/청전 치킨공방은 지금 잠시 주문을 받지 않아요\. 내일 09:00부터 다시 받아요\./)).toBeTruthy();
  });

  it("'오늘'로 예약을 청하면 오늘은 쉰다는 안내가 한 번만 나온다", async () => {
    pause("h3");
    await renderChat();
    await say("청전 치킨공방 오늘 저녁 8시 예약");
    await find(/언제 방문하실 건가요/);
    expect(screen.getAllByText(/오늘 예약을 잠시 받지 않아요/)).toHaveLength(1);
  });

  it("로그인하고 돌아왔는데 고르던 메뉴의 가게가 멈췄으면 이유를 말하고 다른 메뉴를 권한다", async () => {
    await logout();
    const first = render(<OrderChatbot />);
    fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
    await say("간장치킨 2마리");
    await find(/로그인한 뒤에 할 수 있어요/);
    first.unmount();
    pause("h3");
    await loginCustomer2();
    await renderChat();
    // 이어 가기(한 박자 뒤) → 봇 답(0.7초)까지 넉넉히 넘긴 뒤 바로 확인한다
    await wait(2500);
    expect(screen.getAllByText(/청전 치킨공방은 지금 잠시 주문을 받지 않아요/).length).toBeGreaterThan(0);
    expect(buttonsIn(/잠시 주문을 받지 않아요/)).toContain("옛날통닭");
  });
});
describe("세트 메뉴 맛 고르기", () => {
  const FLAVORS = [
    { name: "간장 파닭", extra: 0 },
    { name: "핫간장 파닭", extra: 0 },
    { name: "양념 파닭", extra: 0 },
    { name: "블랙스완 파닭", extra: 1000 },
    { name: "굽는 불닭", extra: 2000 },
  ];
  beforeEach(() => {
    server.db.addMenuItem({ restaurantId: "h3", name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["세트"], choice: { label: "맛", count: 2, options: FLAVORS } });
    // 세트 메뉴가 여럿이면 "1세트"의 "세트"가 모든 세트 메뉴 키워드에 걸린다 (운영 가게와 같은 상태)
    server.db.addMenuItem({ restaurantId: "h3", name: "3마리 치킨 세트", price: 33000, unit: "세트", keywords: ["세트"], choice: { label: "맛", count: 3, options: FLAVORS } });
  });
  const cell = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;
  const doneButton = () => screen.getAllByRole("button", { name: /선택 완료/ }).at(-1)!;
  type SavedOrder = { order: { price: number; items: { item: string; qty: number; price: number; choices?: { name: string; extra: number }[] }[] } };
  const lastSaved = () => {
    const last = server.db.listOrders().at(-1)!;
    return server.db.orderById(last.id) as unknown as SavedOrder;
  };

  it("세트를 고르면 마리 수만큼 맛을 표에서 하나씩 고르고, 추가금을 더한 주문서로 주문된다", async () => {
    await renderChat();
    await say("2마리 치킨 세트 시켜줘");
    expect(await find(/몇 세트 주문할까요/)).toBeTruthy();
    await click(/1세트 · 26,000원 선택/);
    expect(await find(/맛을 2가지 골라 주세요/)).toBeTruthy();
    expect(doneButton()).toBeDisabled();

    fireEvent.click(cell("간장 파닭"));
    expect(cell("간장 파닭")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cell("블랙스완 파닭"));
    // 다 고르면 나머지 맛은 잠기고, 고른 맛을 다시 누르면 뺄 수 있다
    expect(cell("양념 파닭")).toBeDisabled();
    expect(screen.getByText(/2가지 중 2가지 · 27,000원/)).toBeInTheDocument();
    fireEvent.click(doneButton());
    await wait();
    await wait();

    expect(inCard("간장 파닭, 블랙스완 파닭(+1,000원)")).toBe(true);
    expect(inCard("27,000원")).toBe(true);
    await click("이대로 주문");
    await click("응 해줘");
    expect(await find(/주문을 받았어요/)).toBeTruthy();
    const saved = lastSaved();
    expect(saved.order.price).toBe(27000);
    expect(saved.order.items[0].choices).toEqual([{ name: "간장 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }]);
  });

  it("맛 이름을 말해도 고르고, '핫간장 파닭'을 '간장 파닭'으로 잘못 잡지 않으며, 수가 모자라면 다시 묻는다", async () => {
    await renderChat();
    await say("2마리 치킨 세트 1세트");
    expect(await find(/맛을 2가지 골라 주세요/)).toBeTruthy();
    await type("핫간장 파닭");
    expect(await find(/2가지를 골라 주세요\. 지금 1가지를 말씀하셨어요/)).toBeTruthy();
    await type("핫간장 파닭이랑 굽는 불닭");
    await wait();
    expect(inCard("핫간장 파닭, 굽는 불닭(+2,000원)")).toBe(true);
    expect(inCard("28,000원")).toBe(true);
  });

  it("1마리 치킨은 마리 수만큼 맛을 고르고, 이름 속 '1마리'를 수량으로 읽지 않는다", async () => {
    server.db.addMenuItem({ restaurantId: "h3", name: "1마리 치킨", price: 18000, unit: "마리", keywords: ["한마리", "치킨"], choice: { label: "맛", count: 1, options: FLAVORS } });
    await renderChat();
    await say("1마리 치킨 시켜줘");
    expect(await find(/몇 마리 주문할까요/)).toBeTruthy();
    await click(/1마리 · 18,000원 선택/);
    expect(await find(/맛을 1가지 골라 주세요/)).toBeTruthy();
    fireEvent.click(cell("블랙스완 파닭"));
    expect(cell("간장 파닭")).toBeDisabled();
    expect(screen.getByText(/1가지 중 1가지 · 19,000원/)).toBeInTheDocument();
    fireEvent.click(doneButton());
    await wait();
    await wait();
    expect(inCard("블랙스완 파닭(+1,000원)")).toBe(true);
    expect(inCard("19,000원")).toBe(true);

    await say("1마리 치킨 2마리");
    expect(await find(/맛을 2가지 골라 주세요/)).toBeTruthy();
  });

  it("맛을 짧게 말해도('간장') 그 맛으로 고르고, 다른 가게의 간장치킨으로 넘어가지 않는다", async () => {
    await renderChat();
    await say("2마리 치킨 세트 1세트");
    expect(await find(/맛을 2가지 골라 주세요/)).toBeTruthy();
    await type("간장");
    expect(await find(/2가지를 골라 주세요. 지금 1가지를 말씀하셨어요/)).toBeTruthy();
    await type("간장이랑 양념");
    await wait();
    expect(inCard("간장 파닭, 양념 파닭")).toBe(true);
    expect(inCard("26,000원")).toBe(true);
  });

  it("'간장'만 말하면 간장치킨과 간장 맛을 고를 수 있는 메뉴를 함께 보여 주고, 가게 이름을 줄여 말하면 그 가게 메뉴만 보여 준다", async () => {
    const store = server.db.addStore({ name: "못말리는파닭 세명대점", food: "chicken", hours: "00:00 - 24:00" });
    server.db.addMenuItem({ restaurantId: store.id, name: "1마리 치킨", price: 18000, unit: "마리", keywords: ["한마리", "치킨"], choice: { label: "맛", count: 1, options: FLAVORS } });
    await renderChat();
    await say("간장");
    expect(await find(/이런 메뉴를 추천해요/)).toBeTruthy();
    const listed = buttonsIn(/이런 메뉴를 추천해요/);
    expect(listed).toEqual(expect.arrayContaining(["간장치킨", "1마리 치킨", "2마리 치킨 세트"]));

    await say("못말리는 파닭에서 간장 치킨 시켜줘");
    expect(await find(/1마리 치킨은 못말리는파닭 세명대점에서 1마리 18,000원이에요/)).toBeTruthy();
  });

  it("채팅창을 끈 동안에도 맛을 채팅창과 같은 체크 표에서 고른다", async () => {
    render(<OrderChatbot />); // 채팅창은 처음에 꺼져 있다
    await act(() => refresh(["settings", "popular", "menu"]));
    await say("2마리 치킨 세트 1세트");
    await wait(15_000); // 자막이 한 글자씩 다 적히고 표가 뜰 때까지
    const caption = within(document.querySelector<HTMLElement>(".voice-caption")!);
    const cellIn = (name: string) => caption.getByRole("button", { name });
    fireEvent.click(cellIn("간장 파닭"));
    fireEvent.click(cellIn("굽는 불닭"));
    expect(cellIn("간장 파닭")).toHaveAttribute("aria-pressed", "true");
    expect(cellIn("양념 파닭")).toBeDisabled(); // 다 고르면 나머지는 잠긴다
    expect(caption.getByText(/2가지 중 2가지 · 28,000원/)).toBeInTheDocument();
    fireEvent.click(caption.getByRole("button", { name: "선택 완료" }));
    await wait(); // 봇이 주문서를 낸 뒤
    await wait(15_000); // 자막이 다 적히고 주문서 표가 뜰 때까지
    expect(document.querySelector(".voice-caption")?.textContent).toContain("간장 파닭, 굽는 불닭(+2,000원)");
  });

  it("주문서에서 세트 수를 바꾸면 맛을 다시 고른다", async () => {
    await renderChat();
    await say("2마리 치킨 세트 1세트");
    await type("간장 파닭, 양념 파닭");
    await wait();
    expect(inCard("간장 파닭, 양념 파닭")).toBe(true);
    await type("2세트로 해줘");
    expect(await find(/맛을 4가지 골라 주세요/)).toBeTruthy();
  });
});

describe("취소했던 주문서 다시", () => {
  const SET_FLAVORS = [
    { name: "간장 파닭", extra: 0 },
    { name: "양념 파닭", extra: 0 },
    { name: "블랙스완 파닭", extra: 1000 },
  ];

  it("취소한 뒤 '처음에 선택했던 메뉴로 주문할게'라고 하면 같은 메뉴·수량으로 주문서를 바로 다시 만든다", async () => {
    await renderChat();
    await say("간장치킨 3마리");
    expect(inCard("간장치킨 3마리")).toBe(true); // 담겨서 "더 담을까요?"
    await say("취소");
    expect(await find(/주문을 취소했어요/)).toBeTruthy();
    await say("다시 처음에 선택했던 메뉴로 주문할게");
    expect(await find(/처음에 고르신 간장치킨 3마리로 주문서를 다시 만들었어요/)).toBeTruthy();
    expect(inCard("60,000원")).toBe(true);
    await click("응 해줘");
    expect(await find(/주문을 받았어요/)).toBeTruthy();
  });

  it("여러 번 바꿨으면 '처음'은 맨 처음 주문서, '아까'는 바로 전 주문서로 되살리고, 새로 말한 수량은 그 수량으로 한다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await say("옛날통닭 1마리"); // 담은 것과 다른 가게 메뉴: 비우고 새로 시작할지 묻는다
    await click("새로 시작");
    expect(inCard("옛날통닭 1마리")).toBe(true);
    await say("처음 거로 할게");
    expect(await find(/처음에 고르신 간장치킨 2마리로 주문서를 다시 만들었어요/)).toBeTruthy();
    await say("아까 거 3마리로 해줘");
    expect(await find(/아까 고르신 옛날통닭 3마리로 주문서를 다시 만들었어요/)).toBeTruthy();
  });

  it("맛을 고른 세트는 고른 맛 그대로 되살리고, 세트 수가 바뀌면 맛만 다시 고른다", async () => {
    server.db.addMenuItem({ restaurantId: "h3", name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["두마리", "세트"], choice: { label: "맛", count: 2, options: SET_FLAVORS } });
    await renderChat();
    await say("2마리 치킨 세트 1세트");
    await type("간장 파닭이랑 블랙스완 파닭");
    await wait();
    await say("취소");
    await say("아까 취소한 거 다시 주문할게"); // "취소"가 들어 있어도 주문 취소로 보지 않는다
    expect(await find(/아까 고르신 2마리 치킨 세트 1세트 \(간장 파닭, 블랙스완 파닭\(\+1,000원\)\)로 주문서를 다시 만들었어요/)).toBeTruthy();
    expect(inCard("27,000원")).toBe(true);
    await click("취소");
    await say("처음 거 2세트로");
    expect(await find(/맛을 4가지 골라 주세요/)).toBeTruthy();
  });

  it("되살릴 주문서가 없거나 '처음부터 다시'처럼 고른 것을 가리키지 않는 말이면 되살리지 않는다", async () => {
    await renderChat();
    await say("처음에 선택했던 메뉴로 주문할게");
    expect(screen.queryByText(/주문서를 다시 만들었어요/)).not.toBeInTheDocument();
    await say("간장치킨 2마리");
    await say("취소");
    await say("처음부터 다시 할게");
    expect(screen.queryByText(/주문서를 다시 만들었어요/)).not.toBeInTheDocument();
  });

  it("'방금 거 취소해줘'·'아까 거 말고'처럼 물리는 말은 되살리지 않고 그대로 처리한다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await say("옛날통닭 1마리");
    await click("새로 시작");
    await say("방금 거 취소해줘");
    expect(await find(/주문을 취소했어요/)).toBeTruthy();
    expect(screen.queryByText(/주문서를 다시 만들었어요/)).not.toBeInTheDocument();
    await say("간장치킨 2마리");
    await say("아까 거 말고 떡볶이"); // 다른 가게 메뉴라 새로 시작할지 묻고, 새로 시작하면 그 메뉴부터
    await click("새로 시작");
    expect(await find(/국물떡볶이는 장락 떡볶이에서/)).toBeTruthy();
    expect(screen.queryByText(/주문서를 다시 만들었어요/)).not.toBeInTheDocument();
  });

  it("그사이 품절된 메뉴는 이유를 말하고 다른 메뉴를 권한다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await say("취소");
    server.db.updateStoreSettings("h3", { item: { id: "d2", patch: { soldOut: true } } });
    await act(() => refresh(["settings"]));
    await say("처음에 골랐던 걸로 주문해줘");
    expect(await find(/간장치킨은 지금 주문할 수 없어요/)).toBeTruthy();
    expect(screen.getAllByText(/대신 이런 메뉴는 어떠세요/).length).toBeGreaterThan(0);
  });
});

describe("손님 주문 시뮬레이션에서 찾은 것들", () => {
  const SET_FLAVORS = [
    { name: "간장 파닭", extra: 0 },
    { name: "양념 파닭", extra: 0 },
    { name: "뿌링클 치킨", extra: 1000 },
  ];

  it("메뉴를 고르는 중에 '응'이라고 하면 배달이 어렵다는 말 대신 메뉴부터 골라 달라고 한다", async () => {
    await renderChat();
    await say("치킨 시켜줘");
    await find(/이런 메뉴를 추천해요/);
    await type("응");
    expect(await find(/어떤 메뉴로 할지 골라 주세요/)).toBeTruthy();
    expect(screen.queryByText(/아직 배달이 어려워요/)).not.toBeInTheDocument();
    expect(buttonsIn(/어떤 메뉴로 할지 골라 주세요/)).toEqual(expect.arrayContaining(["옛날통닭", "간장치킨"]));
  });

  it("'소떡소떡'처럼 같은 말로 시작하는 메뉴가 여럿이면 하나를 멋대로 고르지 않고 그중에서 고르게 한다", async () => {
    for (const [name, price, unit] of [["소떡소떡 1개", 3000, "개"], ["소떡소떡 2개 묶음", 5000, "묶음"], ["소떡소떡 3개 묶음", 7000, "묶음"]] as const) {
      server.db.addMenuItem({ restaurantId: "h3", name, price, unit, keywords: ["소떡소떡", "소떡"] });
    }
    await renderChat();
    await say("소떡소떡 시켜줘");
    expect(await find(/이런 메뉴를 추천해요/)).toBeTruthy();
    expect(buttonsIn(/이런 메뉴를 추천해요/).filter((b) => b.startsWith("소떡"))).toEqual(["소떡소떡 1개", "소떡소떡 2개 묶음", "소떡소떡 3개 묶음"]);
    await click("소떡소떡 2개 묶음");
    expect(await find(/몇 묶음 주문할까요/)).toBeTruthy();
  });

  it("모르는 맛을 말하면 '어떤 맛을 드실지'라고 묻는다", async () => {
    server.db.addMenuItem({ restaurantId: "h3", name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["두마리", "세트"], choice: { label: "맛", count: 2, options: SET_FLAVORS } });
    await renderChat();
    await say("2마리 치킨 세트 1세트");
    await type("민트초코");
    expect(await find(/어떤 맛을 드실지 잘 모르겠어요/)).toBeTruthy();
  });

  it("'지난번 메뉴 다시'는 세트도 지난번에 고른 맛 그대로 주문서를 만든다", async () => {
    server.db.addMenuItem({ restaurantId: "h3", name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["두마리", "세트"], choice: { label: "맛", count: 2, options: SET_FLAVORS } });
    await renderChat();
    await say("2마리 치킨 세트 1세트");
    await type("간장이랑 뿌링클 치킨"); // 시험 메뉴에는 "치킨"으로 끝나는 맛이 하나뿐이라 짧은 이름 "뿌링클"은 없다
    await wait();
    await wait();
    await click("이대로 주문");
    await click("응 해줘");
    expect(await find(/주문을 받았어요/)).toBeTruthy();
    await say("지난번 메뉴 다시 주문해줘");
    expect(await find(/지난번에 드신 2마리 치킨 세트 1세트 \(간장 파닭, 뿌링클 치킨\(\+1,000원\)\)로 주문서를 만들었어요/)).toBeTruthy();
    expect(inCard("27,000원")).toBe(true);
  });
});

describe("장바구니: 한 주문에 메뉴 여러 개", () => {
  const FLAVORS = [
    { name: "간장 파닭", extra: 0 },
    { name: "양념 파닭", extra: 0 },
    { name: "블랙스완 파닭", extra: 1000 },
  ];
  type Saved = { order: { price: number; listPrice?: number; items: { item: string; qty: number; price: number; choices?: { name: string; extra: number }[] }[] } };
  const lastSaved = () => server.db.orderById(server.db.listOrders().at(-1)!.id) as unknown as Saved;
  const lastCartText = () => screen.getAllByText(/를 담았어요\.$/).at(-1)!;
  beforeEach(() => {
    // 시험 목록은 가게마다 메뉴가 하나라, 같은 가게(청전 치킨공방)에 메뉴를 더 둔다
    server.db.addMenuItem({ restaurantId: "h3", name: "양념치킨", price: 21000, unit: "마리", keywords: ["양념", "치킨"] });
  });

  it("메뉴를 다 고르면 담은 목록과 '더 담을까요?'를 보여 주고, 더 담기로 같은 가게 메뉴를 담은 뒤 이대로 주문하면 합계가 든 주문서로 주문된다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    expect(await find(/간장치킨 2마리를 담았어요/)).toBeTruthy();
    expect(screen.getAllByText("더 담을까요?").length).toBeGreaterThan(0);
    expect(inCard("간장치킨 2마리")).toBe(true);
    expect(inCard("40,000원")).toBe(true);
    expect(screen.queryByText("주문할까요?")).not.toBeInTheDocument();

    // 더 담기: 그 가게 메뉴만 보여 준다
    await click("더 담기");
    expect(await find(/어떤 메뉴를 더 담을까요/)).toBeTruthy();
    const names = buttonsIn(/어떤 메뉴를 더 담을까요/);
    expect(names).toContain("양념치킨");
    expect(names).not.toContain("옛날통닭");
    await click("양념치킨");
    expect(await find(/몇 마리 주문할까요/)).toBeTruthy();
    await click(/1마리 · 21,000원 선택/);
    expect(await find(/양념치킨 1마리를 담았어요/)).toBeTruthy();
    // 여러 메뉴면 줄마다 금액을 적고 합계를 둔다
    expect(inCard("간장치킨 2마리 · 40,000원")).toBe(true);
    expect(inCard("양념치킨 1마리 · 21,000원")).toBe(true);
    expect(inCard("61,000원")).toBe(true);

    await click("이대로 주문");
    expect(await find(/주문할까요\?/)).toBeTruthy();
    expect(inCard(CUSTOMER.address)).toBe(true);
    await click("응 해줘");
    expect(await find(/주문을 받았어요/)).toBeTruthy();
    // 입금 안내에도 담은 메뉴를 줄줄이, 입금 금액은 합계
    expect(inCard("청전 치킨공방 간장치킨 2마리, 양념치킨 1마리")).toBe(true);
    const saved = lastSaved();
    expect(saved.order.items.map((l) => [l.item, l.qty, l.price])).toEqual([["간장치킨", 2, 40000], ["양념치킨", 1, 21000]]);
    expect(saved.order.price).toBe(61000);
  });

  it("담는 중에 메뉴 이름만 말해도 더 담고, 같은 메뉴를 다시 담으면 합친다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await say("양념치킨 하나");
    expect(await find(/양념치킨 1마리를 담았어요/)).toBeTruthy();
    await say("간장치킨 하나 더");
    expect(await find(/간장치킨 1마리를 담았어요/)).toBeTruthy();
    expect(inCard("간장치킨 3마리 · 60,000원")).toBe(true);
    expect(inCard("81,000원")).toBe(true);
  });

  it("'빼줘'는 그 메뉴만 빼고, 마지막 메뉴를 빼면 주문을 접는다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await say("양념치킨 1마리");
    await say("양념치킨 빼줘");
    expect(await find(/양념치킨 1마리를 뺐어요/)).toBeTruthy();
    expect(inCard("간장치킨 2마리")).toBe(true);
    await say("간장치킨 취소");
    expect(await find(/담은 메뉴가 없어서 주문을 접었어요/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "이대로 주문" }).every((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("'3마리로 해줘'는 마지막에 담은 메뉴의 수량을, 이름을 말하면 그 메뉴의 수량을 바꾼다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await say("양념치킨 1마리");
    await say("3마리로 해줘");
    expect(await find(/양념치킨 수량을 3마리로 바꿨어요/)).toBeTruthy();
    expect(inCard("양념치킨 3마리 · 63,000원")).toBe(true);
    await say("간장치킨 1마리로");
    expect(await find(/간장치킨 수량을 1마리로 바꿨어요/)).toBeTruthy();
    expect(inCard("간장치킨 1마리 · 20,000원")).toBe(true);
    expect(inCard("83,000원")).toBe(true);
  });

  it("다른 가게 메뉴를 말하면 새로 시작할지 묻고, 그대로 두면 담은 것을 지키고, 새로 시작하면 비우고 그 메뉴부터 담는다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await say("옛날통닭");
    expect(await find(/지금 담은 건 청전 치킨공방 거예요/)).toBeTruthy();
    await click("담은 것 그대로");
    expect(await find(/담은 메뉴 그대로 둘게요/)).toBeTruthy();
    expect(inCard("간장치킨 2마리")).toBe(true);
    await say("옛날통닭 1마리");
    expect(await find(/지금 담은 건 청전 치킨공방 거예요/)).toBeTruthy();
    await click("새로 시작");
    expect(await find(/옛날통닭 1마리를 담았어요/)).toBeTruthy();
    await click("이대로 주문");
    await click("응 해줘");
    expect(await find(/주문을 받았어요/)).toBeTruthy();
    expect(lastSaved().order.items.map((l) => l.item)).toEqual(["옛날통닭"]);
  });

  it("세트의 맛은 메뉴마다 따로 보이고, 주문서·입금 안내에도 모든 메뉴와 합계가 적힌다", async () => {
    server.db.addMenuItem({ restaurantId: "h3", name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["세트"], choice: { label: "맛", count: 2, options: FLAVORS } });
    await renderChat();
    await say("2마리 치킨 세트 1세트");
    await type("간장 파닭이랑 블랙스완 파닭");
    await wait();
    expect(await find(/2마리 치킨 세트 1세트를 담았어요/)).toBeTruthy();
    await say("간장치킨 1마리");
    expect(await find(/간장치킨 1마리를 담았어요/)).toBeTruthy();
    expect(inCard("2마리 치킨 세트 1세트 · 27,000원")).toBe(true);
    expect(inCard("간장 파닭, 블랙스완 파닭(+1,000원)")).toBe(true);
    expect(inCard("47,000원")).toBe(true);
    await click("이대로 주문");
    await click("응 해줘");
    expect(await find(/주문을 받았어요/)).toBeTruthy();
    expect(inCard("청전 치킨공방 2마리 치킨 세트 1세트 (간장 파닭, 블랙스완 파닭(+1,000원)), 간장치킨 1마리")).toBe(true);
    const saved = lastSaved();
    expect(saved.order.price).toBe(47000);
    expect(saved.order.items[0].choices).toEqual([{ name: "간장 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }]);
    expect(saved.order.items[1]).toMatchObject({ item: "간장치킨", qty: 1, price: 20000 });
  });

  it("주문서를 보는 중에도 '○○도 추가'는 더 담고, 담은 뒤 '응'이면 주문서를 다시 보여 준다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await click("이대로 주문");
    expect(await find(/주문할까요\?/)).toBeTruthy();
    await say("양념치킨도 추가");
    expect(await find(/몇 마리 주문할까요/)).toBeTruthy();
    await click(/1마리 · 21,000원 선택/);
    expect(await find(/양념치킨 1마리를 담았어요/)).toBeTruthy();
    await say("응");
    expect(screen.getAllByText("주문할까요?").length).toBe(2);
    expect(inCard("61,000원")).toBe(true);
    await click("응 해줘");
    expect(await find(/주문을 받았어요/)).toBeTruthy();
    expect(lastSaved().order.price).toBe(61000);
  });

  it("더 담을 메뉴의 수량을 묻는 중에 '아니'라고 하면 그 메뉴만 접고 담은 것은 그대로 둔다", async () => {
    await renderChat();
    await say("간장치킨 2마리");
    await say("양념치킨");
    expect(await find(/몇 마리 주문할까요/)).toBeTruthy();
    await say("아니");
    expect(await find(/그 메뉴는 담지 않을게요/)).toBeTruthy();
    expect(lastCartText()).toBeInTheDocument();
    expect(inCard("간장치킨 2마리")).toBe(true);
    expect(inCard("40,000원")).toBe(true);
  });

  it("'내 주문 어디쯤 왔어'·'지난번 메뉴 다시'는 메뉴 여러 개 주문도 그대로 보여 주고 다시 담는다", async () => {
    db().addOrder({
      customer: CUSTOMER.username,
      customerName: CUSTOMER.name,
      payment: "계좌이체",
      storeId: "h3",
      status: "접수",
      order: {
        store: { name: "청전 치킨공방" },
        storeId: "h3",
        items: [{ item: "간장치킨", qty: 2, unit: "마리", price: 40000 }, { item: "양념치킨", qty: 1, unit: "마리", price: 21000 }],
        price: 61000,
        address: CUSTOMER.address,
        phone: CUSTOMER.phone,
      },
    });
    await renderChat();
    await say("내 주문 어디쯤 왔어");
    expect(await find(/주문이 접수됐어요/)).toBeTruthy();
    expect(inCard("청전 치킨공방 간장치킨 2마리, 양념치킨 1마리")).toBe(true);
    await say("지난번 메뉴 다시");
    expect(await find(/지난번에 드신 간장치킨 2마리, 양념치킨 1마리로 주문서를 만들었어요/)).toBeTruthy();
    expect(inCard("간장치킨 2마리 · 40,000원")).toBe(true);
    expect(inCard("61,000원")).toBe(true);
  });
});
