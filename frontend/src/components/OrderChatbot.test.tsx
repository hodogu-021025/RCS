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

    // 수량은 −/+ 카운터로 고르고, 선택 버튼에 합계 금액이 함께 보인다
    fireEvent.click(screen.getByRole("button", { name: "한 판 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "2판 · 38,000원 선택" }));
    wait(1000);
    expect(screen.getByText("마르게리따 피자 2판")).toBeInTheDocument();
    expect(screen.getByText("38,000원")).toBeInTheDocument();
  });

  it("배달: 수량 단계는 버튼으로만 고르고(직접 입력 없음) 입력창은 접혀 있다", () => {
    render(<OrderChatbot />);
    send("옛날통닭 시켜줘");
    wait(700);
    expect(screen.getByText(/몇 마리 주문할까요\?/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "직접 입력" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ON 전송" }).closest("form")).toHaveAttribute("inert");

    const minus = screen.getByRole("button", { name: "한 마리 줄이기" });
    expect(minus).toBeDisabled(); // 1마리에서 시작
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "한 마리 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "4마리 · 72,000원 선택" }));
    wait(1000);
    expect(screen.getByText("옛날통닭 4마리")).toBeInTheDocument();
    expect(screen.getByText("72,000원")).toBeInTheDocument();
  });

  it("배달: 수량 카운터는 최대 10까지만 늘어난다", () => {
    render(<OrderChatbot />);
    send("국물떡볶이");
    wait(700);
    const plus = screen.getByRole("button", { name: "1인분 늘리기" });
    for (let i = 0; i < 15; i++) fireEvent.click(plus);
    expect(plus).toBeDisabled();
    expect(screen.getByRole("button", { name: "10인분 · 60,000원 선택" })).toBeEnabled();
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

  it("결제 팝업의 카드 드롭다운: 목록을 펼쳐 고르고, Esc 는 목록만 닫는다", () => {
    render(<OrderChatbot />);
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
    expect(screen.getByText(/어떤 상품을 찾으세요\?/)).toBeInTheDocument();
  });

  it("쇼핑: 종류 → 상품 → 사이즈 → 수량 → 배송지 확인 → 주문서 → 결제까지", () => {
    vi.setSystemTime(new Date(2026, 9, 1, 10, 0));
    render(<OrderChatbot />);
    send("쇼핑");
    wait(700);
    for (const name of ["옷", "신발", "장난감", "화장품", "책"]) expect(screen.getByRole("button", { name })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "신발" }));
    wait(900);
    expect(screen.getByText(/신발 상품이에요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /에어플로우 러닝화/ }));
    wait(700);

    // 사이즈는 정해진 버튼에서만 (직접 입력 없음)
    const sizeBubble = screen.getByText(/사이즈를 골라 주세요/).closest(".bubble") as HTMLElement;
    expect(within(sizeBubble).queryByRole("button", { name: "직접 입력" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "260" }));
    wait(700);

    expect(screen.getByText(/에어플로우 러닝화 260은 1켤레에 89,000원이에요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1켤레 · 89,000원 선택" }));
    wait(700);

    // 배송지: 이 주소로 받기
    expect(screen.getByText(/배송지를 확인해 주세요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다른 주소 입력" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "이 주소로 받기" }));
    wait(900);

    expect(screen.getByText("에어플로우 러닝화 (260) 1켤레")).toBeInTheDocument();
    expect(screen.getByText("무료")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "응 해줘" }));
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: /카카오페이/ }));
    wait(300);
    const dialog = screen.getByRole("dialog", { name: "카카오페이" });
    expect(within(dialog).getByText("판매처")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "89,000원 결제하기" }));
    wait(1600 + 1100 + 250 + 500);
    expect(screen.getByText(/스텝업 에어플로우 러닝화 \(260\) 1켤레/)).toBeInTheDocument();
    expect(screen.getByText(/도착 예정: 10월 3일 \(토\)/)).toBeInTheDocument();
  });

  it("쇼핑: 다른 주소 입력으로 새 배송지를 받고, 3만원 미만이면 배송비가 붙는다", () => {
    render(<OrderChatbot />);
    send("쇼핑");
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "화장품" }));
    wait(900);
    fireEvent.click(screen.getByRole("button", { name: /촉촉 립밤 3종 세트/ }));
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "1개 · 12,000원 선택" }));
    wait(700);

    fireEvent.click(screen.getByRole("button", { name: "다른 주소 입력" }));
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "새 배송지 주소를 입력하세요");
    send("집으로");
    wait(700);
    expect(screen.getByText(/주소를 잘 모르겠어요/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "다른 주소 입력" }).at(-1)!);
    send("서울시 마포구 연남동 12-3");
    wait(900);
    // 내 말풍선과 주문서의 배송지 칸
    expect(screen.getAllByText("서울시 마포구 연남동 12-3")).toHaveLength(2);
    expect(screen.getByText("3,000원")).toBeInTheDocument();
    expect(screen.getByText("15,000원")).toBeInTheDocument();
  });

  it("예매: 종류 → 작품 → 날짜 → 회차 → 매수 → 예매 확인 → 결제 → 예매번호·좌석", () => {
    vi.setSystemTime(new Date(2026, 9, 1, 15, 0)); // 10월 1일(목) 오후 3시
    render(<OrderChatbot />);
    send("예매");
    wait(700);
    for (const name of ["영화", "뮤지컬", "콘서트", "전시"]) expect(screen.getByRole("button", { name })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "영화" }));
    wait(900);
    fireEvent.click(screen.getByRole("button", { name: /별빛 정거장/ }));
    wait(700);

    // 날짜: 오늘 남은 회차가 있으니 오늘 버튼도 있다
    expect(screen.getByText(/별빛 정거장 예매를 도와드릴게요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "오늘 (10/1)" }));
    wait(700);

    // 회차: 이미 시작한 10:30·13:20 은 없다
    expect(screen.queryByRole("button", { name: "13:20" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "19:00" }));
    wait(700);

    fireEvent.click(screen.getByRole("button", { name: "한 매 늘리기" }));
    fireEvent.click(screen.getByRole("button", { name: "2매 · 28,000원 선택" }));
    wait(900);

    expect(screen.getByText(/예매 내역을 확인해 주세요/)).toBeInTheDocument();
    expect(screen.getByText("10월 1일 (목) 19:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "응 해줘" }));
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: /토스페이/ }));
    wait(300);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "28,000원 결제하기" }));
    wait(1600 + 1100 + 250 + 500);
    expect(screen.getByText(/예매번호: T\d{6}[\s\S]*2매 · [D-J]열 \d+~\d+번/)).toBeInTheDocument();
  });

  it("예매: 날짜의 직접 입력은 2주 범위의 달력을 펼친다", () => {
    vi.setSystemTime(new Date(2026, 9, 1, 15, 0));
    render(<OrderChatbot />);
    send("예매");
    wait(700);
    fireEvent.click(screen.getByRole("button", { name: "뮤지컬" }));
    wait(900);
    fireEvent.click(screen.getByRole("button", { name: /빛의 정원/ }));
    wait(700);

    fireEvent.click(screen.getAllByRole("button", { name: "직접 입력" }).at(-1)!);
    expect(screen.getByText("2026년 10월")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10월 14일 (수)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "10월 15일 (목)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "10월 10일 (토)" }));
    wait(700);
    expect(screen.getByRole("button", { name: "14:00" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "19:30" })).toBeEnabled();
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

  // 장락반점(11:00 - 21:00)까지 고른 상태로
  function startReservation() {
    vi.setSystemTime(new Date(2026, 9, 1, 10, 0)); // 10월 1일(목) 오전 10시
    render(<OrderChatbot />);
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
    const form = screen.getByRole("button", { name: "ON 전송" }).closest("form")!;

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
  w.speechSynthesis = { cancel: vi.fn(), speak: speakSpy };
  w.SpeechSynthesisUtterance = FakeUtterance;
}
function uninstallSpeech() {
  const w = window as unknown as Record<string, unknown>;
  delete w.SpeechRecognition;
  delete w.speechSynthesis;
  delete w.SpeechSynthesisUtterance;
}

// 마이크를 누르고 한 문장을 말한다
function speakInto(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "말로 입력" }));
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
    render(<OrderChatbot />);
    const mic = screen.getByRole("button", { name: "말로 입력" });
    expect(mic).toBeEnabled();

    fireEvent.click(mic);
    expect(FakeRecognition.latest().lang).toBe("ko-KR");
    expect(screen.getByRole("status")).toHaveTextContent("듣고 있어요");
    expect(screen.getByRole("button", { name: "듣기 멈추기" })).toHaveAttribute("aria-pressed", "true");

    // 중간 인식 결과가 띠에 보인다
    act(() => FakeRecognition.latest().say("간장치킨", false));
    expect(screen.getByRole("status")).toHaveTextContent("간장치킨");

    act(() => FakeRecognition.latest().say("간장치킨 2마리 시켜줘"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("간장치킨 2마리 시켜줘")).toBeInTheDocument();
    wait(1000);
    expect(screen.getByText("간장치킨 2마리")).toBeInTheDocument();
    expect(screen.getByText("40,000원")).toBeInTheDocument();
  });

  it("선택지가 떠서 입력창이 접혀 있어도 말로 답할 수 있다", () => {
    render(<OrderChatbot />);
    speakInto("식당이요");
    wait(700);
    expect(screen.getByText(/어떤 음식을 원하세요\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ON 전송" }).closest("form")).toHaveAttribute("inert");

    speakInto("한식");
    wait(900);
    expect(screen.getByText(/근처 한식 식당이에요/)).toBeInTheDocument();

    speakInto("장락 할매국밥");
    wait(700);
    expect(screen.getByText(/장락 할매국밥 예약을 도와드릴게요/)).toBeInTheDocument();
  });

  it("결제 화면이 떠 있을 때 '결제'라고 말하면 결제가 진행되고, '취소'는 닫는다", () => {
    render(<OrderChatbot />);
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
    render(<OrderChatbot />);
    send("배달");
    speakInto("옛날통닭");
    expect(screen.getByRole("status")).toHaveTextContent("답하는 중이에요");
    expect(screen.queryByText("옛날통닭")).not.toBeInTheDocument();
    wait(3500);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("말소리를 못 들으면 안내가 잠시 보였다가 사라진다", () => {
    render(<OrderChatbot />);
    fireEvent.click(screen.getByRole("button", { name: "말로 입력" }));
    act(() => {
      FakeRecognition.latest().onerror?.({ error: "no-speech" });
      FakeRecognition.latest().onend?.();
    });
    expect(screen.getByRole("status")).toHaveTextContent("말소리를 듣지 못했어요");
    wait(4000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("읽어 주기를 켜면 새 봇 답을 선택지까지 읽어 준다 (켜기 전 것은 안 읽는다)", () => {
    render(<OrderChatbot />);
    expect(speakSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "답 읽어 주기 켜기" }));
    expect(speakSpy).not.toHaveBeenCalled();

    send("배달");
    wait(700);
    expect(speakSpy).toHaveBeenCalledTimes(1);
    const utterance = speakSpy.mock.calls[0][0] as FakeUtterance;
    expect(utterance.lang).toBe("ko-KR");
    expect(utterance.text).toContain("어떤 음식을 배달해 드릴까요?");
    expect(utterance.text).toContain("옛날통닭, 간장치킨, 마르게리따 피자, 국물떡볶이 중에서 말씀해 주세요.");

    fireEvent.click(screen.getByRole("button", { name: "답 읽어 주기 끄기" }));
    send("옛날통닭");
    wait(700);
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });
});

describe("음성 미지원 브라우저", () => {
  it("마이크 버튼이 비활성화되고 이유를 알려 주며, 스피커 버튼은 없다", () => {
    render(<OrderChatbot />);
    const mic = screen.getByRole("button", { name: "말로 입력" });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute("title", "이 브라우저는 음성 인식을 지원하지 않아요");
    expect(screen.queryByRole("button", { name: /읽어 주기/ })).not.toBeInTheDocument();
  });
});
