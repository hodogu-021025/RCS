// 회원가입 이메일 인증 API (server/). 개발 중에는 Vite 가, 배포에서는 nginx 가 /api 를 API 서버로 넘긴다.
export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; retryAfter?: number };

const OFFLINE = "인증 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";

async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : OFFLINE, retryAfter: data.retryAfter as number | undefined };
    return { ...(data as T), ok: true };
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

// 인증번호 메일 보내기. expiresIn: 번호 유효 시간(초), resendIn: 다시 받기까지(초)
export const sendVerificationCode = (email: string) =>
  post<{ expiresIn: number; resendIn: number }>("/api/email/send-code", { email });

export const confirmVerificationCode = (email: string, code: string) => post<{ verified: true }>("/api/email/verify", { email, code });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isValidEmail = (email: string) => EMAIL_RE.test(normalizeEmail(email));
