// API 서버(server/) 호출. 개발 중에는 Vite 가, 배포에서는 nginx 가 /api 를 API 서버로 넘긴다.
// 로그인 토큰은 브라우저(localStorage)에 두고 Authorization 헤더로 보낸다

const TOKEN_KEY = "saylo.token";
let apiBase = ""; // 테스트에서는 따로 띄운 서버 주소를 넣는다

export const setApiBase = (base: string) => {
  apiBase = base;
};

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 저장이 막힌 브라우저면 이번 화면 동안만 로그인 상태가 유지된다
  }
}

export class ApiError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const OFFLINE = "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";

// 토큰이 더 이상 유효하지 않을 때(만료·계정 삭제) 로그인 모듈이 알아차리도록 알린다
const unauthorizedListeners = new Set<() => void>();
export const onUnauthorized = (fn: () => void) => {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
};

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(apiBase + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && token) for (const fn of unauthorizedListeners) fn();
    const { error, ...extra } = data;
    throw new ApiError(res.status, typeof error === "string" ? error : OFFLINE, extra);
  }
  return data as T;
}
