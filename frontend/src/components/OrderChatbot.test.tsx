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

function send(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "ON 전송" }));
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
    render(<OrderChatbot />);
    send("간장치킨 1마리 시켜줘");
    wait(1000);

    expect(screen.getByText("청전 치킨공방 · 1.8km")).toBeInTheDocument();
    expect(screen.getByText("간장치킨 1마리")).toBeInTheDocument();
    expect(screen.getByText("20,000원")).toBeInTheDocument();
    expect(screen.getByText("제천시 장락동 제천빌라 331호")).toBeInTheDocument();
    expect(screen.getByText("주문할까요?")).toBeInTheDocument();
  });

  it("배달: 메뉴 버튼을 고르면 단위에 맞춰 수량을 묻고, 수량을 고르면 주문서를 보여 준다", () => {
    render(<OrderChatbot />);
    send("배달");
    wait(700);
    expect(screen.getByText(/어떤 음식을 배달해 드릴까요\?/)).toBeInTheDocument();
    for (const name of ["옛날통닭", "간장치킨", "마르게리따 피자", "국물떡볶이"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.queryByText(/황금올리브/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "마르게리따 피자" }));
    wait(700);
    expect(screen.getByText(/마르게리따 피자는 장락 화덕피자에서 1판 19,000원이에요/)).toBeInTheDocument();
    expect(screen.getByText(/몇 판 주문할까요\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2판" }));
    wait(1000);
    expect(screen.getByText("마르게리따 피자 2판")).toBeInTheDocument();
    expect(screen.getByText("38,000원")).toBeInTheDocument();
  });

  it("배달: 수량은 직접 입력한 한글 수량도 알아듣는다", () => {
    render(<OrderChatbot />);
    send("옛날통닭 시켜줘");
    wait(700);
    expect(screen.getByText(/몇 마리 주문할까요\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    send("네 마리");
    wait(1000);
    expect(screen.getByText("옛날통닭 4마리")).toBeInTheDocument();
    expect(screen.getByText("72,000원")).toBeInTheDocument();
  });

  it("배달: 수량이 범위를 넘으면 다시 묻는다", () => {
    render(<OrderChatbot />);
    send("국물떡볶이");
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    send("20");
    wait(700);
    expect(screen.getByText(/1인분부터 10인분까지 주문할 수 있어요/)).toBeInTheDocument();
  });

  it("배달: 여러 메뉴에 걸리는 말이면 그 메뉴들 중에서 고르게 한다", () => {
    render(<OrderChatbot />);
    send("치킨 시켜줘");
    wait(700);
    expect(screen.getByText(/어떤 메뉴로 할까요\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "옛날통닭" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "간장치킨" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "국물떡볶이" })).not.toBeInTheDocument();
  });

  it("결제수단을 고르면 결제 팝업이 뜨고, 결제하면 완료 메시지를 보낸다", () => {
    render(<OrderChatbot />);
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
    render(<OrderChatbot />);
    orderAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: /신용카드/ }));
    wait(300);

    const dialog = screen.getByRole("dialog", { name: "신용카드" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByRole("button", { name: "20,000원 결제하기" })).toBeDisabled();
  });

  it("팝업을 닫으면 결제가 취소되고 다시 결제수단을 고를 수 있다", () => {
    render(<OrderChatbot />);
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

  it("link 를 누르면 빠른 메뉴가 열리고, 메뉴를 고르면 닫히면서 답한다", () => {
    render(<OrderChatbot />);
    const toggle = screen.getByRole("button", { name: "link 메뉴" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "쇼핑" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    wait(700);
    expect(screen.getByText(/쇼핑 서비스는 준비 중이에요/)).toBeInTheDocument();
  });

  it("식당: 음식 선택지를 버튼으로 보여 주고, 누르면 근처 식당 목록이 나온다", () => {
    render(<OrderChatbot />);
    fireEvent.click(screen.getByRole("button", { name: "link 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "식당" }));
    wait(700);
    expect(screen.getByText(/어떤 음식을 원하세요\?/)).toBeInTheDocument();

    const korean = screen.getByRole("button", { name: "한식" });
    fireEvent.click(korean);
    expect(korean).toHaveClass("selected");
    expect(screen.getByRole("button", { name: "중식" })).toBeDisabled();
    wait(900);
    expect(screen.getByText(/근처 한식 식당이에요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /장락 할매국밥/ })).toBeEnabled();
  });

  it("선택지가 떠 있으면 입력창이 접히고, 직접 입력을 누르면 열린다", () => {
    render(<OrderChatbot />);
    const form = screen.getByRole("button", { name: "ON 전송" }).closest("form")!;
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
    render(<OrderChatbot />);
    fireEvent.click(screen.getByRole("button", { name: "link 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "식당" }));
    wait(700);

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    send("짬뽕");
    wait(900);
    expect(screen.getByText(/근처 중식 식당이에요/)).toBeInTheDocument();
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
    render(<OrderChatbot />);
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
    const form = screen.getByRole("button", { name: "ON 전송" }).closest("form")!;
    expect(form).toHaveAttribute("inert");
    expect(screen.getByText("2명")).toBeInTheDocument();
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
    render(<OrderChatbot />);
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

  it("식당 예약: 영업시간 밖의 시간이면 이유와 함께 다시 묻고, 취소하면 그만둔다", () => {
    vi.setSystemTime(new Date(2026, 9, 1, 10, 0));
    render(<OrderChatbot />);
    send("식당");
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "중식" }));
    wait(900);
    fireEvent.click(screen.getByRole("button", { name: /장락반점/ }));
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "내일 (10/2)" }));
    wait(700);

    fireEvent.click(screen.getAllByRole("button", { name: "직접 입력" }).at(-1)!);
    send("밤 10시");
    wait(700);
    expect(screen.getByText(/22:00에는 예약할 수 없어요/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "직접 입력" }).at(-1)!);
    send("취소할게");
    wait(700);
    expect(screen.getByText(/예약을 취소했어요/)).toBeInTheDocument();
  });

  it("식당: 모르는 음식이면 다시 물어본다", () => {
    render(<OrderChatbot />);
    fireEvent.click(screen.getByRole("button", { name: "link 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "식당" }));
    wait(700);

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    send("아무거나");
    wait(700);
    expect(screen.getByText(/어떤 음식인지 잘 모르겠어요/)).toBeInTheDocument();
    // 다시 묻는 말풍선에도 음식 선택지가 붙는다
    expect(screen.getAllByRole("button", { name: "한식" }).at(-1)).toBeEnabled();
  });

  it("못 알아들으면 할 수 있는 서비스를 선택지로 보여 준다", () => {
    render(<OrderChatbot />);
    send("안녕");
    wait(700);
    expect(screen.getByText(/원하는 서비스를 골라 주세요/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "배달" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "직접 입력" })).toBeEnabled();
  });

  it("ON 전송 버튼은 입력이 비어 있으면 꺼져 있고, 글자를 쓰면 켜진다", () => {
    render(<OrderChatbot />);
    const sendButton = screen.getByRole("button", { name: "ON 전송" });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "배달" } });
    expect(sendButton).toBeEnabled();
  });

  it("빠른 메뉴는 바깥을 누르면 닫힌다", () => {
    render(<OrderChatbot />);
    const toggle = screen.getByRole("button", { name: "link 메뉴" });
    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("주문 확인에서 취소하면 주문을 접는다", () => {
    render(<OrderChatbot />);
    send("옛날통닭 2마리 시켜줘");
    wait(1000);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    wait(700);

    expect(screen.getByText(/주문을 취소했어요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "응 해줘" })).toBeDisabled();
  });
});
