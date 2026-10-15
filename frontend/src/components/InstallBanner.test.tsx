import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DISMISS_DAYS, decideInstallMode, resetInstall, setupInstall } from "../pwa";
import { InstallBanner } from "./InstallBanner";
import { AppDownloadPage } from "../pages/AppDownloadPage";

const DAY = 24 * 60 * 60_000;
const base = { standalone: false, installed: false, ios: false, android: false, hasPrompt: false, dismissedAt: null, now: 100 * DAY };
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1";

describe("앱으로 설치 띠를 띄울지 정하기", () => {
  it("설치 신호가 있으면 설치 띠, 아이폰이면 홈 화면 추가 안내, 둘 다 아니면 띄우지 않는다", () => {
    expect(decideInstallMode({ ...base, hasPrompt: true })).toBe("prompt");
    expect(decideInstallMode({ ...base, ios: true })).toBe("ios");
    expect(decideInstallMode(base)).toBeNull();
    // 안드로이드는 브라우저 설치 창이 있어도 앱 파일 받기로 안내한다 (크롬이 아닌 브라우저에서도 같게)
    expect(decideInstallMode({ ...base, android: true })).toBe("android");
    expect(decideInstallMode({ ...base, android: true, hasPrompt: true })).toBe("android");
    // 사장님 화면: 데스크톱 등에서도 앱 받기 링크를 띄우지만, 앱으로 열었거나 닫은 뒤에는 띄우지 않는다
    expect(decideInstallMode({ ...base, linkFallback: true })).toBe("android");
    expect(decideInstallMode({ ...base, linkFallback: true, standalone: true })).toBeNull();
    expect(decideInstallMode({ ...base, linkFallback: true, dismissedAt: base.now - DAY })).toBeNull();
  });

  it("이미 앱으로 열었거나 설치했거나, 닫기를 누르고 며칠이 안 지났으면 띄우지 않는다", () => {
    expect(decideInstallMode({ ...base, hasPrompt: true, standalone: true })).toBeNull();
    expect(decideInstallMode({ ...base, ios: true, installed: true })).toBeNull();
    expect(decideInstallMode({ ...base, hasPrompt: true, dismissedAt: base.now - (DISMISS_DAYS - 1) * DAY })).toBeNull();
    expect(decideInstallMode({ ...base, hasPrompt: true, dismissedAt: base.now - (DISMISS_DAYS + 1) * DAY })).toBe("prompt");
  });
});

// 브라우저가 주는 설치 신호를 흉내 낸다
function fireInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => void window.dispatchEvent(event));
  return { prompt, event };
}

describe("앱으로 설치 띠 (InstallBanner)", () => {
  beforeAll(() => setupInstall());
  beforeEach(() => act(() => resetInstall()));
  afterEach(() => vi.restoreAllMocks());

  it("처음에는 띄우지 않다가, 브라우저가 설치할 수 있다고 알려 주면 띄우고 '설치'로 설치 창을 연다", async () => {
    render(<InstallBanner />);
    expect(screen.queryByRole("region", { name: "앱으로 설치" })).not.toBeInTheDocument();

    const { prompt, event } = fireInstallPrompt("accepted");
    expect(event.defaultPrevented).toBe(true); // 브라우저 기본 안내 대신 우리 띠로 보여 준다
    expect(screen.getByText("Saylo를 앱으로 설치하면 홈 화면에서 바로 열 수 있어요.")).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "설치" })));
    expect(prompt).toHaveBeenCalledTimes(1);
    // 설치했으면 다시 띄우지 않는다
    expect(screen.queryByRole("region", { name: "앱으로 설치" })).not.toBeInTheDocument();
    expect(localStorage.getItem("saylo.installed")).toBe("1");
  });

  it("닫기를 누르면 사라지고, 다시 열어도 며칠 동안은 띄우지 않는다", () => {
    const { unmount } = render(<InstallBanner />);
    fireInstallPrompt();
    fireEvent.click(screen.getByRole("button", { name: "앱 설치 안내 닫기" }));
    expect(screen.queryByRole("region", { name: "앱으로 설치" })).not.toBeInTheDocument();
    expect(Number(localStorage.getItem("saylo.installDismissedAt"))).toBeGreaterThan(0);
    unmount();
    render(<InstallBanner />);
    expect(screen.queryByRole("region", { name: "앱으로 설치" })).not.toBeInTheDocument();
  });

  it("아이폰에서는 설치 버튼 없이 '공유 → 홈 화면에 추가' 순서를 알려 준다", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_UA);
    render(<InstallBanner />);
    expect(screen.getByRole("region", { name: "앱으로 설치" })).toHaveTextContent("공유 버튼을 누르고 홈 화면에 추가를 골라 주세요.");
    expect(screen.queryByRole("button", { name: "설치" })).not.toBeInTheDocument();
  });

  it("홈 화면의 앱으로 열었으면 띄우지 않는다", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    try {
      render(<InstallBanner />);
      fireInstallPrompt();
      expect(screen.queryByRole("region", { name: "앱으로 설치" })).not.toBeInTheDocument();
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});

describe("안드로이드 앱 받기", () => {
  beforeEach(() => act(() => resetInstall()));
  afterEach(() => vi.restoreAllMocks());

  it("안드로이드에서는 띠의 '앱 받기'가 앱 받기 화면(#/app)으로 간다 (설치 창 버튼은 없다)", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID_UA);
    render(<InstallBanner />);
    expect(screen.getByRole("region", { name: "앱으로 설치" })).toHaveTextContent("Saylo 앱을 받으면 홈 화면에서 바로 열 수 있어요.");
    expect(screen.getByRole("link", { name: "앱 받기" })).toHaveAttribute("href", "#/app");
    expect(screen.queryByRole("button", { name: "설치" })).not.toBeInTheDocument();
  });

  it("앱 받기 화면: 안드로이드는 앱 파일 다운로드를 먼저, 아이폰은 홈 화면 추가 안내를 먼저 보여 준다", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID_UA);
    const { unmount } = render(<AppDownloadPage />);
    const download = screen.getByRole("link", { name: "안드로이드 앱 다운로드" });
    expect(download).toHaveAttribute("href", "/download/saylo.apk");
    expect(download).toHaveAttribute("download", "saylo.apk");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["안드로이드", "아이폰"]);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    unmount();

    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_UA + " KAKAOTALK 10.8.0");
    render(<AppDownloadPage />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["아이폰", "안드로이드"]);
    // 카카오톡 안에서 열었으면 다른 브라우저로 열라고 먼저 알려 준다
    expect(screen.getByRole("note")).toHaveTextContent("다른 브라우저로 열기");
  });
});
