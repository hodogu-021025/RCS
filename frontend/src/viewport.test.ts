import { afterEach, describe, expect, it, vi } from "vitest";
import { followVisualViewport } from "./viewport";

// 휴대폰 브라우저의 visualViewport 를 흉내 낸다 (높이를 바꾸고 resize 를 보낸다)
function fakeViewport(height: number, width = 390) {
  const listeners: Record<string, (() => void)[]> = {};
  const vv = {
    height,
    width,
    scale: 1,
    offsetTop: 0,
    addEventListener: (type: string, fn: () => void) => void (listeners[type] ??= []).push(fn),
    removeEventListener: () => {},
    fire(next: Partial<{ height: number; width: number; scale: number; offsetTop: number }>) {
      Object.assign(vv, next);
      for (const fn of listeners.resize ?? []) fn();
    },
  };
  return vv;
}

function fakeWindow(vv: ReturnType<typeof fakeViewport>, withChat = true) {
  document.body.innerHTML = withChat ? '<div class="app"></div>' : "<form></form>";
  const scrollTo = vi.fn();
  return { win: { visualViewport: vv, document, scrollY: 120, scrollTo } as unknown as Window, scrollTo };
}

const root = document.documentElement;
afterEach(() => {
  root.style.removeProperty("--app-height");
  root.removeAttribute("data-keyboard");
  document.body.innerHTML = "";
});

describe("키보드가 올라오면 앱 높이를 보이는 영역에 맞춘다", () => {
  it("보이는 높이를 --app-height 로 두고, 크게 줄면 키보드가 뜬 것으로 표시해 채팅 화면을 맨 위로 되돌린다", () => {
    const vv = fakeViewport(800);
    const { win, scrollTo } = fakeWindow(vv);
    followVisualViewport(win);
    expect(root.style.getPropertyValue("--app-height")).toBe("800px");
    expect(root.hasAttribute("data-keyboard")).toBe(false);

    vv.fire({ height: 760 }); // 주소창이 접혔다 펴지는 정도
    expect(root.hasAttribute("data-keyboard")).toBe(false);

    vv.fire({ height: 430, offsetTop: 300 }); // 키보드
    expect(root.style.getPropertyValue("--app-height")).toBe("430px");
    expect(root.hasAttribute("data-keyboard")).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    vv.fire({ height: 800, offsetTop: 0 }); // 키보드 내림
    expect(root.hasAttribute("data-keyboard")).toBe(false);
  });

  it("회원가입처럼 채팅이 아닌 화면은 페이지 위치를 건드리지 않는다", () => {
    const vv = fakeViewport(800);
    const { win, scrollTo } = fakeWindow(vv, false);
    followVisualViewport(win);
    vv.fire({ height: 430, offsetTop: 300 });
    expect(root.hasAttribute("data-keyboard")).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("손가락으로 확대한 동안에는 앱을 줄이지 않고, 화면을 돌리면 기준 높이를 다시 잰다", () => {
    const vv = fakeViewport(800);
    const { win } = fakeWindow(vv);
    followVisualViewport(win);
    vv.fire({ height: 400, scale: 2 });
    expect(root.style.getPropertyValue("--app-height")).toBe("");
    expect(root.hasAttribute("data-keyboard")).toBe(false);

    vv.fire({ height: 360, width: 844, scale: 1 }); // 가로로 돌림: 키보드가 아니라 새 기준
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    expect(root.style.getPropertyValue("--app-height")).toBe("360px");
  });
});
