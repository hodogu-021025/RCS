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
  fireEvent.change(screen.getByPlaceholderText("메시지를 입력하세요"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "전송" }));
}

function orderAndConfirm() {
  send("근처 BBQ 매장에서 황금올리브 시켜줘");
  wait(1000);
  fireEvent.click(screen.getByRole("button", { name: "응 해줘" }));
  wait(700);
}

describe("OrderChatbot", () => {
  it("주문 요청에 매장·음식·가격·위치를 보여 준다", () => {
    render(<OrderChatbot />);
    send("근처 BBQ 매장에서 황금올리브 시켜줘");
    wait(1000);

    expect(screen.getByText("하소동 BBQ · 1.2km")).toBeInTheDocument();
    expect(screen.getByText("황금올리브 1마리")).toBeInTheDocument();
    expect(screen.getByText("21,000원")).toBeInTheDocument();
    expect(screen.getByText("제천시 장락동 제천빌라 331호")).toBeInTheDocument();
    expect(screen.getByText("주문할까요?")).toBeInTheDocument();
  });

  it("결제수단을 고르면 결제 팝업이 뜨고, 결제하면 완료 메시지를 보낸다", () => {
    render(<OrderChatbot />);
    orderAndConfirm();

    fireEvent.click(screen.getByRole("button", { name: /토스페이/ }));
    wait(300);
    const dialog = screen.getByRole("dialog", { name: "토스페이" });
    expect(within(dialog).getByText("21,000원")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "21,000원 결제하기" }));
    expect(within(dialog).getByText("결제 진행 중…")).toBeInTheDocument();
    wait(1600);
    expect(within(dialog).getByText("결제 완료")).toBeInTheDocument();
    wait(1100 + 250);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    wait(500);
    expect(screen.getByText(/토스페이로 21,000원 결제가 완료되었어요/)).toBeInTheDocument();
  });

  it("결제 동의를 끄면 결제 버튼이 비활성화된다", () => {
    render(<OrderChatbot />);
    orderAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: /신용카드/ }));
    wait(300);

    const dialog = screen.getByRole("dialog", { name: "신용카드" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByRole("button", { name: "21,000원 결제하기" })).toBeDisabled();
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

  it("주문 확인에서 취소하면 주문을 접는다", () => {
    render(<OrderChatbot />);
    send("황금올리브 시켜줘");
    wait(1000);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    wait(700);

    expect(screen.getByText(/주문을 취소했어요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "응 해줘" })).toBeDisabled();
  });
});
