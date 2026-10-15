import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderChatbot } from "./OrderChatbot";
import { loginCustomer } from "../test/setup";

// 처음 챗봇을 연 고객님에게 뜨는 사용법 안내 (test/setup 은 기본으로 "이미 봤음"으로 두므로 여기서 지운다)
beforeEach(async () => {
  localStorage.removeItem("saylo.tutorialSeen");
  await loginCustomer();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const dialog = () => screen.queryByRole("dialog");

describe("사용법 안내", () => {
  it("처음 열면 뜨고, 다음·이전·화살표로 넘기다 시작하기를 누르면 닫히고 다음부터는 뜨지 않는다", () => {
    const { unmount } = render(<OrderChatbot />);
    expect(dialog()).toHaveAccessibleName("말로 주문하는 Saylo예요");
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이전" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(dialog()).toHaveAccessibleName("이렇게 말해 보세요");
    expect(screen.getByRole("button", { name: "다음" })).toHaveFocus(); // 넘길 때마다 주 버튼에 초점

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    expect(dialog()).toHaveAccessibleName("말로 주문하는 Saylo예요");

    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(dialog()).toHaveAccessibleName("배달 주문 전에 확인해 주세요");
    expect(screen.getByText("5 / 5")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" }); // 마지막 장에서 더 넘어가지 않는다
    expect(screen.getByText("5 / 5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    expect(dialog()).not.toBeInTheDocument();

    unmount();
    render(<OrderChatbot />);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("건너뛰기로 닫아도 다시 뜨지 않고, 헤더의 사용법 보기로 첫 장부터 다시 볼 수 있다", () => {
    render(<OrderChatbot />);
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(dialog()).not.toBeInTheDocument();
    expect(localStorage.getItem("saylo.tutorialSeen")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "사용법 보기" }));
    expect(dialog()).toHaveAccessibleName("말로 주문하는 Saylo예요");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dialog()).not.toBeInTheDocument();
  });

  it("예시 문장을 누르면 안내를 닫고 그 말을 보낸 것처럼 바로 진행한다", () => {
    render(<OrderChatbot />);
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "“치킨 두 마리 시켜줘”" }));
    expect(dialog()).not.toBeInTheDocument();
    wait(1000);

    fireEvent.click(screen.getByRole("button", { name: "채팅창 켜기" }));
    expect(screen.getByText("치킨 두 마리 시켜줘")).toBeInTheDocument();
    expect(screen.getByText(/이런 메뉴를 추천해요/)).toBeInTheDocument(); // 치킨 메뉴를 바로 권한다
  });
});
