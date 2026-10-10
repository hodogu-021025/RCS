import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderChatbot } from "./OrderChatbot";

// 봇 응답·결제 진행이 모두 setTimeout 기반이라 가짜 타이머로 시간을 넘기며 확인한다
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

// 채팅창은 기본으로 꺼져 있다. 말풍선·버튼으로 대화를 따라가는 테스트는 채팅창을 켜고 시작한다
function renderChat() {
  const result = render(<OrderChatbot />);
  fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
  return result;
}

function send(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Say 전송" }));
}

// 메뉴와 수량을 한 번에 말해 주문서까지 간 뒤 "응 해줘"
function orderAndConfirm() {
  send("간장치킨 1마리 시켜줘");
  wait(1000);
  fireEvent.click(screen.getByRole("button", { name: "응 해줘" }));
  wait(700);
}

describe("OrderChatbot", () => {
  it("메뉴와 수량을 한 번에 말하면 매장·음식·가격·위치를 보여 준다", () => {
    renderChat();
    send("간장치킨 1마리 시켜줘");
    wait(1000);

    expect(screen.getByText("청전 치킨공방 · 1.8km")).toBeInTheDocument();
    expect(screen.getByText("간장치킨 1마리")).toBeInTheDocument();
    expect(screen.getByText("20,000원")).toBeInTheDocument();
    expect(screen.getByText("제천시 장락동 제천빌라 331호")).toBeInTheDocument();
    expect(screen.getByText("주문할까요?")).toBeInTheDocument();
  });

  it("배달: 메뉴 버튼을 고르면 단위에 맞춰 수량을 묻고, 수량을 고르면 주문서를 보여 준다", () => {
    renderChat();
    send("배달");
    wait(700);
    expect(screen.getByText(/오늘은 이런 메뉴 어떠세요\?/)).toBeInTheDocument();
    for (const name of ["옛날통닭", "간장치킨", "마르게리따 피자", "국물떡볶이"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.queryByText(/황금올리브/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "마르게리따 피자" }));
    wait(700);
    expect(screen.getByText(/마르게리따 피자는 장락 화덕피자에서 1판 19,000원이에요/)).toBeInTheDocument();
    expect(screen.getByText(/몇 판 주문할까요\?/)).toBeInTheDocument();

    // 수량은 −/+ 카운터로 고르고, 선택 버튼에 합계 금액이 함께 보인다
    fireEvent.click(screen.getByRole("button", { name: "한 판 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "2판 · 38,000원 선택" }));
    wait(1000);
    expect(screen.getByText("마르게리따 피자 2판")).toBeInTheDocument();
    expect(screen.getByText("38,000원")).toBeInTheDocument();
  });

  it("배달: 수량 단계는 버튼으로만 고르고(직접 입력 없음) 입력창은 접혀 있다", () => {
    renderChat();
    send("옛날통닭 시켜줘");
    wait(700);
    expect(screen.getByText(/몇 마리 주문할까요\?/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "직접 입력" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Say 전송" }).closest("form")).toHaveAttribute("inert");

    const minus = screen.getByRole("button", { name: "한 마리 줄이기" });
    expect(minus).toBeDisabled(); // 1마리에서 시작
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "한 마리 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "4마리 · 72,000원 선택" }));
    wait(1000);
    expect(screen.getByText("옛날통닭 4마리")).toBeInTheDocument();
    expect(screen.getByText("72,000원")).toBeInTheDocument();
  });

  it("배달: 수량 카운터는 최대 10까지만 늘어난다", () => {
    renderChat();
    send("국물떡볶이");
    wait(700);
    const plus = screen.getByRole("button", { name: "1인분 늘리기" });
    for (let i = 0; i < 15; i++) fireEvent.click(plus);
    expect(plus).toBeDisabled();
    expect(screen.getByRole("button", { name: "10인분 · 60,000원 선택" })).toBeEnabled();
  });

  it("배달: 여러 메뉴에 걸리는 말이면 그 메뉴들 중에서 고르게 한다", () => {
    renderChat();
    send("치킨 시켜줘");
    wait(700);
    expect(screen.getByText(/이런 메뉴를 추천해요!/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "옛날통닭" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "간장치킨" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "국물떡볶이" })).not.toBeInTheDocument();
  });

  it("결제수단을 고르면 결제 팝업이 뜨고, 결제하면 완료 메시지를 보낸다", () => {
    renderChat();
    orderAndConfirm();

    fireEvent.click(screen.getByRole("button", { name: /토스페이/ }));
    wait(300);
    const dialog = screen.getByRole("dialog", { name: "토스페이" });
    expect(within(dialog).getByText("20,000원")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "20,000원 결제하기" }));
    expect(within(dialog).getByText("결제 진행 중…")).toBeInTheDocument();
    wait(1600);
    expect(within(dialog).getByText("결제 완료")).toBeInTheDocument();
    wait(1100 + 250);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    wait(500);
    expect(screen.getByText(/토스페이로 20,000원 결제가 완료되었어요/)).toBeInTheDocument();
    expect(screen.getByText(/청전 치킨공방에서 간장치킨 1마리를 준비 중이에요/)).toBeInTheDocument();
  });

  it("결제 동의를 끄면 결제 버튼이 비활성화된다", () => {
    renderChat();
    orderAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: /신용카드/ }));
    wait(300);

    const dialog = screen.getByRole("dialog", { name: "신용카드" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByRole("button", { name: "20,000원 결제하기" })).toBeDisabled();
  });

  it("결제 팝업의 카드 드롭다운: 목록을 펼쳐 고르고, Esc 는 목록만 닫는다", () => {
    renderChat();
    orderAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: /신용카드/ }));
    wait(300);
    const dialog = screen.getByRole("dialog", { name: "신용카드" });

    const cardButton = within(dialog).getByRole("button", { name: /카드 선택/ });
    expect(cardButton).toHaveTextContent("신한카드");
    fireEvent.click(cardButton);
    const list = within(dialog).getByRole("listbox", { name: "카드 선택" });
    expect(within(list).getByRole("option", { name: /신한카드/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(list).getByRole("option", { name: /KB국민카드/ }));
    expect(within(dialog).queryByRole("listbox")).not.toBeInTheDocument();
    expect(cardButton).toHaveTextContent("KB국민카드");

    // 키보드: 할부 목록을 열어 ↓ 두 번 → Enter
    const installment = within(dialog).getByRole("button", { name: /할부/ });
    fireEvent.keyDown(installment, { key: "ArrowDown" });
    const installmentList = within(dialog).getByRole("listbox", { name: "할부" });
    fireEvent.keyDown(installmentList, { key: "ArrowDown" });
    fireEvent.keyDown(installmentList, { key: "ArrowDown" });
    fireEvent.keyDown(installmentList, { key: "Enter" });
    expect(installment).toHaveTextContent("3개월");

    // Esc 는 열린 목록만 닫고 결제 팝업은 그대로
    fireEvent.click(cardButton);
    fireEvent.keyDown(within(dialog).getByRole("listbox"), { key: "Escape" });
    wait(300);
    expect(within(dialog).queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "신용카드" })).toBeInTheDocument();
  });

  it("팝업을 닫으면 결제가 취소되고 다시 결제수단을 고를 수 있다", () => {
    renderChat();
    orderAndConfirm();

    fireEvent.click(screen.getByRole("button", { name: /카카오페이/ }));
    wait(300);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));
    wait(250);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    wait(400);
    expect(screen.getByText(/결제를 취소했어요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /신용카드/ })).toBeEnabled();
  });

  it("+ 를 누르면 빠른 메뉴가 열리고, 메뉴를 고르면 닫히면서 답한다", () => {
    renderChat();
    const toggle = screen.getByRole("button", { name: "메뉴" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // 빠른 메뉴는 배달·식당 두 가지뿐이다
    const menu = toggle.parentElement!.querySelector(".quick-menu")!;
    expect([...menu.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["배달", "식당"]);

    fireEvent.click(within(menu as HTMLElement).getByRole("button", { name: "식당" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    wait(700);
    expect(screen.getByText(/오늘은 어떤 음식이 당기세요\?/)).toBeInTheDocument();
  });

  it("식당: 음식 선택지를 버튼으로 보여 주고, 누르면 근처 식당 목록이 나온다", () => {
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "식당" }));
    wait(700);
    expect(screen.getByText(/오늘은 어떤 음식이 당기세요\?/)).toBeInTheDocument();

    const korean = screen.getByRole("button", { name: "한식" });
    fireEvent.click(korean);
    expect(korean).toHaveClass("selected");
    expect(screen.getByRole("button", { name: "중식" })).toBeDisabled();
    wait(900);
    expect(screen.getByText(/근처 한식 맛집을 추천해요!/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /장락 할매국밥/ })).toBeEnabled();
  });

  it("선택지가 떠 있으면 입력창이 접히고, 직접 입력을 누르면 열린다", () => {
    renderChat();
    const form = screen.getByRole("button", { name: "Say 전송" }).closest("form")!;
    expect(form).not.toHaveAttribute("inert");

    send("식당");
    wait(700);
    expect(form).toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    expect(form).not.toHaveAttribute("inert");
    const input = screen.getByPlaceholderText("먹고 싶은 음식을 입력하세요");
    expect(input).toHaveFocus();
  });

  it("식당: 직접 입력한 메뉴 이름으로도 찾고, 목록에서 고르면 상세 정보를 보여 준다", () => {
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "식당" }));
    wait(700);

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    send("짬뽕");
    wait(900);
    expect(screen.getByText(/근처 중식 맛집을 추천해요!/)).toBeInTheDocument();
    const other = screen.getByRole("button", { name: /하소 만리향/ });
    expect(other).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /장락반점/ }));
    wait(700);
    expect(screen.getByText(/장락반점을 선택했어요./)).toBeInTheDocument();
    expect(screen.getByText("삼선짬뽕")).toBeInTheDocument();
    expect(screen.getByText("제천시 장락동 30-7")).toBeInTheDocument();
    expect(other).toBeDisabled();
  });

  it("식당: 식당을 고르면 날짜 → 시간 → 인원을 묻고 예약을 마친다", () => {
    vi.setSystemTime(new Date(2026, 9, 1, 10, 0)); // 10월 1일(목) 오전 10시
    renderChat();
    send("식당");
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "중식" }));
    wait(900);
    fireEvent.click(screen.getByRole("button", { name: /장락반점/ }));
    wait(700);

    // 날짜: 오늘·내일·모레 버튼
    expect(screen.getByText(/장락반점 예약을 도와드릴게요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "오늘 (10/1)" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "내일 (10/2)" }));
    wait(700);

    // 시간: 영업시간(11:00 - 21:00) 안의 시간만 버튼으로
    expect(screen.getByText(/몇 시에 방문하실 건가요\?\s+영업시간 11:00 - 21:00/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "21:00" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "19:00" }));
    wait(700);

    // 인원: −/+ 카운터 버튼으로 고르고 "N명 선택"으로 확정 (직접 입력 없음, 입력창도 접힌 채)
    expect(screen.getByText(/몇 명이 방문하시나요\?/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "직접 입력" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    const form = screen.getByRole("button", { name: "Say 전송" }).closest("form")!;
    expect(form).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "2명 선택" })).toBeEnabled(); // 2명에서 시작
    fireEvent.click(screen.getByRole("button", { name: "한 명 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "한 명 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "한 명 줄이기" }));
    fireEvent.click(screen.getByRole("button", { name: "3명 선택" }));
    wait(700);
    expect(screen.getByRole("button", { name: "한 명 늘리기" })).toBeDisabled();

    // 확인 카드 → 예약 완료
    expect(screen.getByText(/예약 내용을 확인해 주세요/)).toBeInTheDocument();
    expect(screen.getByText("10월 2일 (금)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "응 해줘" }));
    wait(900);
    expect(screen.getByText(/예약이 완료되었어요!/)).toBeInTheDocument();
    expect(screen.getByText(/장락반점 · 10월 2일 \(금\) 19:00 · 3명/)).toBeInTheDocument();
  });

  it("식당 예약: 인원 카운터는 1명 아래로 내려가지 않는다", () => {
    vi.setSystemTime(new Date(2026, 9, 1, 10, 0));
    renderChat();
    send("식당");
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "중식" }));
    wait(900);
    fireEvent.click(screen.getByRole("button", { name: /장락반점/ }));
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "내일 (10/2)" }));
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "19:00" }));
    wait(700);

    const minus = screen.getByRole("button", { name: "한 명 줄이기" });
    fireEvent.click(minus);
    expect(screen.getByRole("button", { name: "1명 선택" })).toBeEnabled();
    expect(minus).toBeDisabled();
  });

  // 장락반점(11:00 - 21:00)까지 고른 상태로
  function startReservation() {
    vi.setSystemTime(new Date(2026, 9, 1, 10, 0)); // 10월 1일(목) 오전 10시
    renderChat();
    send("식당");
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "중식" }));
    wait(900);
    fireEvent.click(screen.getByRole("button", { name: /장락반점/ }));
    wait(700);
  }
  const directInput = () => screen.getAllByRole("button", { name: "직접 입력" }).at(-1)!;

  it("식당 예약: 날짜의 직접 입력은 달력을 펼치고, 고를 수 있는 날만 누를 수 있다", () => {
    startReservation();
    const form = screen.getByRole("button", { name: "Say 전송" }).closest("form")!;

    fireEvent.click(directInput());
    expect(screen.getByText("2026년 10월")).toBeInTheDocument();
    // 글자 입력창은 계속 접혀 있다
    expect(form).toHaveAttribute("inert");
    // 오늘~30일 뒤(10/31)까지만, 다음 달로는 못 넘어간다
    expect(screen.getByRole("button", { name: "10월 1일 (목)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "10월 31일 (토)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "다음 달" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "10월 5일 (월)" }));
    wait(700);
    expect(screen.getByText(/10월 5일 \(월\)\s+몇 시에 방문하실 건가요\?/)).toBeInTheDocument();
  });

  it("식당 예약: 시간의 직접 입력은 오전/오후·시·분 휠을 펼치고, 영업시간 안의 시각만 담는다", () => {
    startReservation(); // 장락반점 11:00 - 21:00
    fireEvent.click(screen.getByRole("button", { name: "내일 (10/2)" }));
    wait(700);

    fireEvent.click(directInput());
    const period = screen.getByRole("listbox", { name: "오전/오후" });
    const hour = screen.getByRole("listbox", { name: "시" });
    const minute = screen.getByRole("listbox", { name: "분" });
    // 처음 값은 오후 6:00
    expect(within(period).getByRole("option", { name: "오후" })).toHaveAttribute("aria-selected", "true");
    expect(within(hour).getByRole("option", { name: "6시" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "오후 6:00 선택" })).toBeEnabled();

    // 오후 시 휠: 12시 ~ 8시(마감 1시간 전)까지만, 9시는 없다
    expect(within(hour).queryByRole("option", { name: "9시" })).not.toBeInTheDocument();
    fireEvent.click(within(hour).getByRole("option", { name: "8시" }));
    // 8시에는 00분만
    expect(within(minute).getAllByRole("option").map((o) => o.textContent)).toEqual(["00"]);

    // 오전으로 바꾸면 오전에 있는 11시대로
    fireEvent.click(within(period).getByRole("option", { name: "오전" }));
    expect(within(hour).getAllByRole("option").map((o) => o.textContent)).toEqual(["11"]);

    // 키보드: 오후로 ↓, 시 휠에서 ↑ 로 7시 → 30분 → 확정
    fireEvent.keyDown(period, { key: "ArrowDown" });
    fireEvent.click(within(hour).getByRole("option", { name: "7시" }));
    fireEvent.click(within(minute).getByRole("option", { name: "30분" }));
    fireEvent.click(screen.getByRole("button", { name: "오후 7:30 선택" }));
    wait(700);
    // 사용자가 보낸 말풍선도 "오후 7:30"
    expect(screen.getByText("오후 7:30")).toBeInTheDocument();
    expect(screen.getByText(/몇 명이 방문하시나요\?/)).toBeInTheDocument();
  });

  it("식당 예약: 직접 입력을 다시 누르면 고르기 화면이 접힌다", () => {
    startReservation();
    fireEvent.click(directInput());
    expect(screen.getByText("2026년 10월")).toBeInTheDocument();
    fireEvent.click(directInput());
    expect(screen.queryByText("2026년 10월")).not.toBeInTheDocument();
  });

  it("식당: 모르는 음식이면 다시 물어본다", () => {
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "식당" }));
    wait(700);

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    send("우주 음식");
    wait(700);
    expect(screen.getByText(/어떤 음식인지 잘 모르겠어요/)).toBeInTheDocument();
    // 다시 묻는 말풍선에도 음식 선택지가 붙는다
    expect(screen.getAllByRole("button", { name: "한식" }).at(-1)).toBeEnabled();
  });

  it("문장 속에 배달·식당 말이 있으면 그 기능으로 바로 간다", () => {
    renderChat();
    send("배달 주문하고 싶어");
    wait(700);
    expect(screen.getByText(/오늘은 이런 메뉴 어떠세요\?/)).toBeInTheDocument();

    send("근처 식당 예약할래"); // 배달 메뉴를 보는 중에도 식당으로 넘어간다
    wait(700);
    expect(screen.getByText(/오늘은 어떤 음식이 당기세요\?/)).toBeInTheDocument();

    send("배달로 할게"); // 식당 단계에서도 배달로 넘어간다
    wait(700);
    expect(screen.getAllByText(/오늘은 이런 메뉴 어떠세요\?/)).toHaveLength(2);
  });

  it("음식 종류까지 말하면 근처 식당 추천으로 바로 가고, 메뉴 이름이 있으면 배달 주문으로 간다", () => {
    renderChat();
    send("중식 식당 예약해줘");
    wait(900);
    expect(screen.getByText(/근처 중식 맛집을 추천해요!/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /장락반점/ })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "새 대화" })); // 채팅창은 켠 채로 남는다
    send("한식 먹고 싶어"); // 배달·식당 말이 없어도 음식 종류만으로 식당 추천
    wait(900);
    expect(screen.getByText(/근처 한식 맛집을 추천해요!/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
    send("간장치킨 배달해줘"); // 메뉴 이름이 있으면 배달 말과 상관없이 주문으로
    wait(700);
    expect(screen.getByText(/몇 마리 주문할까요\?/)).toBeInTheDocument();
  });

  it("못 알아들으면 할 수 있는 서비스를 선택지로 보여 준다", () => {
    renderChat();
    send("안녕");
    wait(700);
    expect(screen.getByText(/배달 주문과 식당 예약을 도와드릴 수 있어요/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "배달" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "직접 입력" })).toBeEnabled();
  });

  it("Say 전송 버튼은 입력이 비어 있으면 꺼져 있고, 글자를 쓰면 켜진다", () => {
    renderChat();
    const sendButton = screen.getByRole("button", { name: "Say 전송" });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "배달" } });
    expect(sendButton).toBeEnabled();
  });

  it("빠른 메뉴는 바깥을 누르면 닫힌다", () => {
    renderChat();
    const toggle = screen.getByRole("button", { name: "메뉴" });
    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("주문 확인에서 취소하면 주문을 접는다", () => {
    renderChat();
    send("옛날통닭 2마리 시켜줘");
    wait(1000);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    wait(700);

    expect(screen.getByText(/주문을 취소했어요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "응 해줘" })).toBeDisabled();
  });

  it("채팅창은 처음에 꺼져 있고, 켜면 말풍선이 보이며 다시 끌 수 있다 (꺼진 동안에도 입력창은 열려 있다)", () => {
    render(<OrderChatbot />);
    const chat = document.querySelector(".chat")!;
    expect(chat.closest(".chat-area")).toHaveClass("chat-hidden");
    expect(chat).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "채팅창 켜기" })).toBeInTheDocument();

    send("배달");
    wait(700);
    // 선택지 질문이어도 채팅창이 꺼져 있으면 버튼이 안 보이므로 입력창을 열어 둔다
    expect(screen.getByRole("button", { name: "Say 전송" }).closest("form")).not.toHaveAttribute("inert");
    send("간장치킨 1마리 시켜줘");
    wait(1000);

    fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
    expect(chat.closest(".chat-area")).not.toHaveClass("chat-hidden");
    expect(document.querySelector(".voice-caption")).not.toBeInTheDocument();
    expect(screen.getByText("간장치킨 1마리")).toBeInTheDocument(); // 꺼진 동안의 대화도 그대로 있다

    fireEvent.click(screen.getByRole("button", { name: "채팅창 끄기" }));
    expect(chat.closest(".chat-area")).toHaveClass("chat-hidden");
  });

  it("채팅창이 꺼져 있으면 봇이 소리로 하는 말만 가운데에 한 글자씩 적히고, 답을 준비하는 동안은 점이 깜빡인다", () => {
    render(<OrderChatbot />);
    const caption = () => document.querySelector(".caption-text")?.textContent ?? "";
    // "." 로 끝난 문장 뒤에서 줄을 바꾼다 ("!"·"?" 는 그대로)
    const full = "안녕하세요! Saylo예요.\n무엇을 주문해 드릴까요?";
    // 처음에는 비어 있다가 한 글자씩 늘어난다
    expect(caption()).toBe("");
    wait(45 * 5);
    expect(caption()).toBe(full.slice(0, 5));
    wait(10_000);
    expect(caption()).toBe(full);
    expect(document.querySelector(".caption-caret")).not.toBeInTheDocument(); // 깜빡이는 커서는 없다
    // 화면 읽기 프로그램에는 문장 전체가 한 번에 간다
    expect(document.querySelector(".voice-caption [aria-live]")).toHaveTextContent("안녕하세요! Saylo예요. 무엇을 주문해 드릴까요?");

    send("배달");
    expect(document.querySelector(".caption-dots")).toBeInTheDocument();
    expect(caption()).toBe("");
    wait(700);
    expect(document.querySelector(".caption-dots")).not.toBeInTheDocument();
    wait(10_000);
    // 선택지까지 읽어 주는 문장 그대로 (사용자가 한 말은 자막에 없다)
    expect(caption()).toBe("오늘은 옛날통닭, 간장치킨, 마르게리따 피자, 국물떡볶이를 추천해요! 드시고 싶은 다른 메뉴도 편하게 말씀해 주세요.");

    // 숫자 속 점(1.8km)에서는 줄을 바꾸지 않는다
    send("간장치킨 1마리 시켜줘");
    wait(1000);
    wait(10_000);
    expect(caption()).toContain("청전 치킨공방 · 1.8km");
    expect(caption()).toContain("근처 매장을 찾았어요 주문 내역을 확인해 주세요.\n");
  });

  it("주문 확인에서 다른 서비스(식당)를 말하면 결제로 넘어가지 않고 그 서비스로 넘어간다", () => {
    renderChat();
    send("옛날통닭 2마리 시켜줘");
    wait(1000);
    send("식당");
    wait(700);

    expect(screen.getByText(/오늘은 어떤 음식이 당기세요\?/)).toBeInTheDocument();
    expect(screen.queryByText(/어떤 걸로 결제하시겠어요/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "응 해줘" })).toBeDisabled();
  });

  it("배달 수량 단계에서 날짜 같은 숫자는 수량으로 보지 않는다", () => {
    renderChat();
    send("옛날통닭 시켜줘");
    wait(700);
    send("10월 3일에 받을게요");
    wait(700);

    expect(screen.getByText(/수량을 잘 모르겠어요/)).toBeInTheDocument();
    expect(screen.queryByText("옛날통닭 10마리")).not.toBeInTheDocument();
  });
});

// ---- 음성 입력·읽어 주기 ----
// 브라우저의 SpeechRecognition 대신 쓰는 가짜. say() 로 말을 넣어 준다
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  say(text: string, final = true) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: text } }] });
    if (final) this.onend?.();
  }
  static latest() {
    return FakeRecognition.instances[FakeRecognition.instances.length - 1];
  }
}

const speakSpy = vi.fn();
class FakeUtterance {
  lang = "";
  rate = 1;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

function installSpeech() {
  const w = window as unknown as Record<string, unknown>;
  w.SpeechRecognition = FakeRecognition;
  w.speechSynthesis = { cancel: vi.fn(), speak: speakSpy, getVoices: () => [{ name: "Microsoft Heami - Korean", lang: "ko-KR" }, { name: "Microsoft SunHi Online (Natural) - Korean (Korea)", lang: "ko-KR" }] };
  w.SpeechSynthesisUtterance = FakeUtterance;
}
function uninstallSpeech() {
  const w = window as unknown as Record<string, unknown>;
  delete w.SpeechRecognition;
  delete w.speechSynthesis;
  delete w.SpeechSynthesisUtterance;
  localStorage.removeItem("saylo.sound");
}

// 마이크를 누르고 한 문장을 말한다
function speakInto(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "음성 모드" }));
  act(() => FakeRecognition.latest().say(text));
}

describe("음성", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    speakSpy.mockClear();
    installSpeech();
  });
  afterEach(uninstallSpeech);

  it("마이크를 누르고 말하면 글자로 입력한 것과 똑같이 처리된다", () => {
    renderChat();
    const mic = screen.getByRole("button", { name: "음성 모드" });
    expect(mic).toBeEnabled();

    fireEvent.click(mic);
    expect(FakeRecognition.latest().lang).toBe("ko-KR");
    expect(screen.getByRole("status")).toHaveTextContent("듣고 있어요");
    expect(screen.getByRole("button", { name: "음성 모드 끄기" })).toHaveAttribute("aria-pressed", "true");
    // 듣는 동안은 배경 구체에 은은한 물결
    expect(document.querySelector(".chat-area")).toHaveAttribute("data-voice", "listening");

    // 중간 인식 결과가 띠에 보인다
    act(() => FakeRecognition.latest().say("간장치킨", false));
    expect(screen.getByRole("status")).toHaveTextContent("간장치킨");

    act(() => FakeRecognition.latest().say("간장치킨 2마리 시켜줘"));
    expect(document.querySelector(".voice-bar")).not.toHaveClass("show"); // 카드는 남아서 내려가는 중
    // 물결은 꺼지지만, 서서히 사라지는 동안 듣기 모양(옅고 느림)을 유지한다
    expect(document.querySelector(".chat-area")).not.toHaveAttribute("data-voice");
    expect(document.querySelector(".chat-area")).toHaveAttribute("data-wave", "listening");
    expect(screen.getByText("간장치킨 2마리 시켜줘")).toBeInTheDocument();
    wait(1000);
    expect(screen.getByText("간장치킨 2마리")).toBeInTheDocument();
    expect(screen.getByText("40,000원")).toBeInTheDocument();
  });

  it("선택지가 떠서 입력창이 접혀 있어도 말로 답할 수 있다", () => {
    renderChat();
    speakInto("식당이요");
    wait(700);
    expect(screen.getByText(/오늘은 어떤 음식이 당기세요\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Say 전송" }).closest("form")).toHaveAttribute("inert");

    speakInto("한식");
    wait(900);
    expect(screen.getByText(/근처 한식 맛집을 추천해요!/)).toBeInTheDocument();

    speakInto("장락 할매국밥");
    wait(700);
    expect(screen.getByText(/장락 할매국밥 예약을 도와드릴게요/)).toBeInTheDocument();
  });

  it("결제 화면이 떠 있을 때 '결제'라고 말하면 결제가 진행되고, '취소'는 닫는다", () => {
    renderChat();
    orderAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: /카카오페이/ }));
    wait(300);
    const dialog = screen.getByRole("dialog", { name: "카카오페이" });

    speakInto("아니 취소");
    wait(250 + 400);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/결제를 취소했어요/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /토스페이/ }));
    wait(300);
    speakInto("결제해줘");
    expect(within(screen.getByRole("dialog", { name: "토스페이" })).getByText("결제 진행 중…")).toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
  });

  it("봇이 답하는 중에 말하면 안내만 하고 버린다", () => {
    renderChat();
    send("배달");
    speakInto("옛날통닭");
    expect(screen.getByRole("status")).toHaveTextContent("답하는 중이에요");
    expect(screen.queryByText("옛날통닭")).not.toBeInTheDocument();
    wait(3500);
    expect(document.querySelector(".voice-bar")).not.toHaveClass("show"); // 카드는 남아서 내려가는 중
  });

  it("말소리를 못 들으면 안내가 잠시 보였다가 사라진다", () => {
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "음성 모드" }));
    act(() => {
      FakeRecognition.latest().onerror?.({ error: "no-speech" });
      FakeRecognition.latest().onend?.();
    });
    expect(screen.getByRole("status")).toHaveTextContent("말소리를 듣지 못했어요");
    wait(4000);
    expect(document.querySelector(".voice-bar")).not.toHaveClass("show"); // 카드는 남아서 내려가는 중
  });

  it("소리는 처음부터 켜져 있어 봇 답을 선택지까지 읽어 주고, 소리 끄기를 누르면 멈추며 그 선택을 기억한다", () => {
    const { unmount } = renderChat();
    const sound = screen.getByRole("button", { name: "소리 끄기" });
    expect(sound).toHaveAttribute("aria-pressed", "true");
    expect(speakSpy).toHaveBeenCalledTimes(1); // 첫 인사
    expect((speakSpy.mock.calls[0][0] as FakeUtterance).text).toContain("Saylo예요");

    send("배달");
    wait(700);
    expect(speakSpy).toHaveBeenCalledTimes(2);
    const utterance = speakSpy.mock.calls[1][0] as FakeUtterance;
    expect(utterance.lang).toBe("ko-KR");
    expect((utterance as unknown as { voice: { name: string } }).voice.name).toContain("SunHi"); // 자연 음성이 있으면 그걸 고른다
    expect((utterance as unknown as { pitch: number }).pitch).toBeGreaterThan(1);
    expect(utterance.text).toContain("오늘은 옛날통닭, 간장치킨, 마르게리따 피자, 국물떡볶이를 추천해요!");
    expect(utterance.text).toContain("드시고 싶은 다른 메뉴도 편하게 말씀해 주세요.");
    expect(utterance.text).not.toContain("중에서");

    fireEvent.click(sound);
    expect(screen.getByRole("button", { name: "소리 켜기" })).toHaveAttribute("aria-pressed", "false");
    send("옛날통닭");
    wait(700);
    expect(speakSpy).toHaveBeenCalledTimes(2);

    // 다시 열어도 꺼진 채로
    unmount();
    renderChat();
    expect(screen.getByRole("button", { name: "소리 켜기" })).toBeInTheDocument();
    expect(speakSpy).toHaveBeenCalledTimes(2);
  });
});

describe("읽어 주기 목소리", () => {
  const SUNHI = { name: "Microsoft SunHi Online (Natural) - Korean (Korea)", lang: "ko-KR" };
  let voices: { name: string; lang: string }[];
  let listeners: (() => void)[];
  let cancel: ReturnType<typeof vi.fn>;

  // 페이지를 막 열었을 때처럼 목소리 목록이 비어 있다가, voiceschanged 로 들어오는 브라우저
  beforeEach(() => {
    speakSpy.mockClear();
    voices = [];
    listeners = [];
    cancel = vi.fn();
    const w = window as unknown as Record<string, unknown>;
    w.speechSynthesis = {
      cancel,
      speak: speakSpy,
      getVoices: () => voices,
      addEventListener: (_: string, f: () => void) => listeners.push(f),
      removeEventListener: (_: string, f: () => void) => (listeners = listeners.filter((l) => l !== f)),
    };
    w.SpeechSynthesisUtterance = FakeUtterance;
  });
  afterEach(uninstallSpeech);

  const voiceOf = (call: number) => (speakSpy.mock.calls[call][0] as unknown as { voice?: { name: string } }).voice?.name;

  it("목소리 목록이 아직 없으면 기본 목소리로 먼저 읽지 않고, 목록이 오면 고른 목소리로 읽는다", () => {
    renderChat();
    expect(speakSpy).not.toHaveBeenCalled();
    voices = [SUNHI];
    act(() => listeners.forEach((f) => f()));
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(voiceOf(0)).toContain("SunHi");
    expect((speakSpy.mock.calls[0][0] as FakeUtterance).text).toContain("Saylo예요");
  });

  it("목록이 끝내 오지 않으면 1.5초 뒤에는 그대로 읽는다", () => {
    renderChat();
    wait(1400);
    expect(speakSpy).not.toHaveBeenCalled();
    wait(100);
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it("기다리는 동안 새 답이 오면 이전 말은 버리고 새 말만 읽는다", () => {
    renderChat();
    send("배달");
    wait(700);
    voices = [SUNHI];
    act(() => listeners.forEach((f) => f()));
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect((speakSpy.mock.calls[0][0] as FakeUtterance).text).toContain("오늘은 옛날통닭, 간장치킨");
  });

  it("봇이 소리로 말하는 동안 배경 구체에 말하는 효과가 켜지고, 끝나면 꺼진다", () => {
    voices = [SUNHI];
    renderChat();
    const area = document.querySelector(".chat-area")!;
    type Spoken = { onstart?: () => void; onend?: () => void; onerror?: () => void };
    const greeting = speakSpy.mock.calls[0][0] as unknown as Spoken;
    expect(area).not.toHaveAttribute("data-voice");

    act(() => greeting.onstart?.());
    expect(area).toHaveAttribute("data-voice", "talking");

    // 새 답이 이전 말을 끊으면, 늦게 온 이전 말의 끝 신호로 효과가 꺼지지 않는다
    send("배달");
    wait(700);
    const next = speakSpy.mock.calls[1][0] as unknown as Spoken;
    act(() => next.onstart?.());
    act(() => greeting.onerror?.());
    expect(area).toHaveAttribute("data-voice", "talking");

    act(() => next.onend?.());
    expect(area).not.toHaveAttribute("data-voice");
  });

  it("소리를 끄면 말하는 효과도 바로 꺼진다", () => {
    voices = [SUNHI];
    renderChat();
    const area = document.querySelector(".chat-area")!;
    act(() => (speakSpy.mock.calls[0][0] as unknown as { onstart: () => void }).onstart());
    expect(area).toHaveAttribute("data-voice", "talking");
    fireEvent.click(screen.getByRole("button", { name: "소리 끄기" }));
    expect(area).not.toHaveAttribute("data-voice");
  });

  it("새로고침·페이지 이동 때 읽던 말을 끊는다 (새 페이지에서 이전 말이 이어지지 않게)", () => {
    renderChat();
    cancel.mockClear();
    window.dispatchEvent(new Event("pagehide"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("개발 모드(StrictMode)에서 화면을 껐다 켜 봐도 첫 인사가 끊기지 않는다", () => {
    voices = [SUNHI];
    render(
      <StrictMode>
        <OrderChatbot />
      </StrictMode>,
    );
    wait(50);
    expect(speakSpy).toHaveBeenCalledTimes(1);
    // 말하기 직전의 정리(cancel)는 괜찮지만, 첫 인사를 말한 뒤에 끊는 일은 없어야 한다
    const spokeAt = speakSpy.mock.invocationCallOrder[0];
    expect(cancel.mock.invocationCallOrder.filter((at) => at > spokeAt)).toEqual([]);
  });

  it("챗봇 화면을 떠나면 읽던 말을 끊는다", () => {
    voices = [SUNHI];
    const { unmount } = renderChat();
    cancel.mockClear();
    unmount();
    wait(10);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("브라우저가 소리를 막으면(아직 화면을 안 누름) 첫 터치 때 그 말을 읽고, 물결도 켜진다", () => {
    voices = [SUNHI];
    renderChat();
    const blocked = speakSpy.mock.calls[0][0] as unknown as { onerror: (e: { error: string }) => void };
    act(() => blocked.onerror({ error: "not-allowed" }));
    expect(speakSpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.body);
    expect(speakSpy).toHaveBeenCalledTimes(2);
    const retried = speakSpy.mock.calls[1][0] as unknown as FakeUtterance & { onstart: () => void };
    expect(retried.text).toContain("Saylo예요");
    act(() => retried.onstart());
    expect(document.querySelector(".chat-area")).toHaveAttribute("data-voice", "talking");

    // 한 번만 다시 읽는다
    fireEvent.pointerDown(document.body);
    expect(speakSpy).toHaveBeenCalledTimes(2);
  });

  it("첫 터치를 기다리는 동안 새 답이 오면 예전 인사는 다시 읽지 않는다", () => {
    voices = [SUNHI];
    renderChat();
    act(() => (speakSpy.mock.calls[0][0] as unknown as { onerror: (e: { error: string }) => void }).onerror({ error: "not-allowed" }));
    send("배달"); // 보내기 버튼을 누른 것 자체가 첫 터치가 아니도록 fireEvent.click 만 쓴다
    wait(700);
    const texts = speakSpy.mock.calls.map((c) => (c[0] as FakeUtterance).text);
    expect(texts.filter((t) => t.includes("Saylo예요"))).toHaveLength(1);
    expect(texts.at(-1)).toContain("오늘은 옛날통닭, 간장치킨");
  });
});

describe("음성 미지원 브라우저", () => {
  it("마이크 버튼이 비활성화되고 이유를 알려 주며, 스피커 버튼은 없다", () => {
    renderChat();
    const mic = screen.getByRole("button", { name: "음성 모드" });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute("title", "이 브라우저는 음성 인식을 지원하지 않아요");
    expect(screen.queryByRole("button", { name: /소리/ })).not.toBeInTheDocument();
  });
});
