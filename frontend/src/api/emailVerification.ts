// 회원가입 이메일 인증 API (server/). 번호를 받고 확인하면 증표(proof)를 주고, 회원가입 때 같이 보낸다
import { ApiError, api } from "./client";

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; retryAfter?: number };

async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    return { ...(await api<T>("POST", path, body)), ok: true };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, error: err.message, retryAfter: typeof err.extra?.retryAfter === "number" ? err.extra.retryAfter : undefined };
  }
}

// 인증번호 메일 보내기. expiresIn: 번호 유효 시간(초), resendIn: 다시 받기까지(초)
export const sendVerificationCode = (email: string) => post<{ expiresIn: number; resendIn: number }>("/api/email/send-code", { email });

// 비밀번호 찾기: 가입된 이메일에만 보낸다 (확인은 회원가입과 같은 confirmVerificationCode)
export const sendResetCode = (email: string) => post<{ expiresIn: number; resendIn: number }>("/api/auth/reset/send-code", { email });

export const confirmVerificationCode = (email: string, code: string) =>
  post<{ verified: true; proof: string }>("/api/email/verify", { email, code });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isValidEmail = (email: string) => EMAIL_RE.test(normalizeEmail(email));
