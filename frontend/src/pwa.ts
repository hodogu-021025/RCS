// 앱으로 설치 (PWA). 서비스 워커를 등록하고, 브라우저의 설치 신호를 받아 두었다가 "앱으로 설치" 띠에서 쓴다.
// - 안드로이드·데스크톱 크롬 계열: 브라우저가 설치할 수 있다고 알려 주면(beforeinstallprompt) 띠를 띄우고, 누르면 설치 창을 연다
// - 아이폰·아이패드: 설치 창이 없으므로 "공유 → 홈 화면에 추가" 순서를 알려 주는 띠를 띄운다
// - 이미 앱으로 연 경우, 설치를 마친 경우, 닫기를 누르고 며칠이 지나지 않은 경우에는 띄우지 않는다

// 브라우저가 주는 설치 신호 (표준 타입에 아직 없어서 쓰는 만큼만 적는다)
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// prompt: 브라우저 설치 창 (데스크톱 크롬 등) / android: Saylo 앱 파일(APK) 받기 / ios: 홈 화면에 추가 안내
export type InstallMode = "prompt" | "android" | "ios" | null;

// 사이트에서 받는 안드로이드 앱 파일 (frontend/public/download/saylo.apk). 앱 받기 화면(#/app)에서 받는다
export const APK_URL = "/download/saylo.apk";

const DISMISSED_KEY = "saylo.installDismissedAt";
const INSTALLED_KEY = "saylo.installed";
export const DISMISS_DAYS = 7; // 닫기를 누르면 이 기간 동안 다시 띄우지 않는다

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const hasInstallPrompt = () => deferred !== null;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장이 막힌 브라우저면 다음에 또 띄울 뿐이다
  }
};

// 홈 화면의 앱으로 열었는지 (그때는 띄우지 않는다)
export function isStandalone(): boolean {
  const media = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return media || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// 아이폰·아이패드 (아이패드는 데스크톱 사파리처럼 보이므로 터치로도 본다)
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export const isAndroid = () => /android/i.test(navigator.userAgent);
// 카카오톡·네이버·인스타그램 같은 앱 안의 브라우저 (파일 받기·홈 화면 추가가 막혀 있는 경우가 많다)
export const isInAppBrowser = () => /kakaotalk|naver\(inapp|instagram|fban|fbav|line\//i.test(navigator.userAgent);

// 띠를 어떤 모양으로 띄울지 (null 이면 띄우지 않는다). 판단만 하는 함수라 테스트에서 상황을 바꿔 가며 부른다.
// 안드로이드는 브라우저(크롬·삼성 인터넷·카카오톡 안 등)와 상관없이 앱 파일 받기로 안내한다.
// linkFallback: 설치 창도 아이폰도 아닌 기기(데스크톱 등)에서도 앱 받기 화면 링크를 띄운다 (사장님 화면)
export function decideInstallMode(env: { standalone: boolean; installed: boolean; ios: boolean; android: boolean; hasPrompt: boolean; dismissedAt: number | null; now: number; linkFallback?: boolean }): InstallMode {
  if (env.standalone || env.installed) return null;
  if (env.dismissedAt !== null && env.now - env.dismissedAt < DISMISS_DAYS * 24 * 60 * 60_000) return null;
  if (env.android) return "android";
  if (env.hasPrompt) return "prompt";
  if (env.ios) return "ios";
  return env.linkFallback ? "android" : null;
}

export function installMode(now = Date.now(), linkFallback = false): InstallMode {
  const dismissed = Number(read(DISMISSED_KEY));
  return decideInstallMode({
    standalone: isStandalone(),
    installed: read(INSTALLED_KEY) === "1",
    ios: isIOS(),
    android: isAndroid(),
    hasPrompt: hasInstallPrompt(),
    dismissedAt: Number.isFinite(dismissed) && dismissed > 0 ? dismissed : null,
    now,
    linkFallback,
  });
}

export function dismissInstall(now = Date.now()) {
  write(DISMISSED_KEY, String(now));
  notify();
}

// 설치 창을 연다 (사용자가 버튼을 눌렀을 때만 열 수 있다). 설치했으면 true
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null; // 설치 신호는 한 번만 쓸 수 있다
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") write(INSTALLED_KEY, "1");
  notify();
  return outcome === "accepted";
}

// 테스트용: 받아 둔 설치 신호와 기억해 둔 닫기·설치 기록을 지운다
export function resetInstall() {
  deferred = null;
  try {
    localStorage.removeItem(DISMISSED_KEY);
    localStorage.removeItem(INSTALLED_KEY);
  } catch {
    // 위와 같다
  }
  notify();
}

// 앱 시작 때 한 번: 설치 신호를 받아 두고(브라우저 기본 안내 대신 우리 띠로 보여 준다), 서비스 워커를 등록한다
export function setupInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    write(INSTALLED_KEY, "1");
    notify();
  });
  // 개발 서버에서는 등록하지 않는다 (화면 고침이 서비스 워커와 엉키지 않게). 배포한 사이트(HTTPS)에서만
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 등록에 실패해도 사이트는 그대로 쓸 수 있다 (설치 띠만 안 뜰 수 있다)
      });
    });
  }
}
