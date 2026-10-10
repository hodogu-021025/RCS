// 비밀번호 암호화(scrypt)와 세션 토큰. Node 내장 crypto 만 쓴다
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 로그인 유지 30일

export function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const newToken = () => randomBytes(32).toString("base64url");

// 회원가입·사장님 계정 만들기가 함께 쓰는 입력 규칙 (화면에도 같은 규칙이 있어 바로 안내하지만, 최종 판단은 여기서)
export const USERNAME_RE = /^[a-z0-9_]{8,20}$/i;
export const PASSWORD_MIN = 8;
export const usernameError = (username) => (USERNAME_RE.test(username) ? null : "아이디는 영문·숫자 8~20자로 적어 주세요.");
export const passwordError = (password) =>
  typeof password === "string" && password.length >= PASSWORD_MIN ? null : `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`;
