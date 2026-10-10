// 이메일 인증번호: 6자리 번호를 만들어 메일로 보내고, 사용자가 적은 번호가 맞는지 확인한다.
// 번호는 이 서버 프로세스 메모리에만 둔다 (서버가 하나뿐이라 충분하다. 여러 대로 늘리면 Redis 같은 공용 저장소로 옮긴다).
import { randomInt, timingSafeEqual } from "node:crypto";

export const CODE_TTL_MS = 5 * 60_000; // 인증번호 유효 시간
export const RESEND_COOLDOWN_MS = 60_000; // 같은 주소로 다시 보내기까지
export const MAX_ATTEMPTS = 5; // 번호 하나로 틀릴 수 있는 횟수
export const IP_WINDOW_MS = 10 * 60_000; // 한 IP 가 이 시간 동안
export const IP_MAX_SENDS = 5; //            보낼 수 있는 메일 수 (아무 주소로나 메일을 뿌리는 걸 막는다)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();
export const isValidEmail = (email) => email.length <= 254 && EMAIL_RE.test(email);

const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

function sameCode(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// sendMail(email, code): 실제 발송 (Resend). 실패하면 throw
export function createVerifier({ sendMail, now = Date.now, generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0") }) {
  const codes = new Map(); // email → { code, expiresAt, sentAt, attempts }
  const sendsByIp = new Map(); // ip → [보낸 시각…]

  async function sendCode(rawEmail, ip = "unknown") {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) return fail(400, "이메일 주소를 다시 확인해 주세요.");
    const t = now();

    const prev = codes.get(email);
    if (prev && t - prev.sentAt < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (t - prev.sentAt)) / 1000);
      return fail(429, `${retryAfter}초 뒤에 다시 받을 수 있어요.`, { retryAfter });
    }
    const recent = (sendsByIp.get(ip) ?? []).filter((at) => t - at < IP_WINDOW_MS);
    if (recent.length >= IP_MAX_SENDS) return fail(429, "인증번호를 너무 많이 요청했어요. 잠시 후 다시 시도해 주세요.");

    const code = generateCode();
    try {
      await sendMail(email, code);
    } catch (err) {
      console.error(`[email] ${email} 로 보내지 못함:`, err instanceof Error ? err.message : err);
      return fail(502, "메일을 보내지 못했어요. 주소를 확인하고 잠시 후 다시 시도해 주세요.");
    }
    codes.set(email, { code, expiresAt: t + CODE_TTL_MS, sentAt: t, attempts: 0 });
    sendsByIp.set(ip, [...recent, t]);
    return { status: 200, body: { ok: true, expiresIn: CODE_TTL_MS / 1000, resendIn: RESEND_COOLDOWN_MS / 1000 } };
  }

  function verifyCode(rawEmail, rawCode) {
    const email = normalizeEmail(rawEmail);
    const code = String(rawCode ?? "").trim();
    const entry = codes.get(email);
    if (!entry) return fail(400, "인증번호를 먼저 받아 주세요.");
    if (now() > entry.expiresAt) {
      codes.delete(email);
      return fail(410, "인증번호가 만료됐어요. 다시 받아 주세요.");
    }
    entry.attempts += 1;
    if (!sameCode(code, entry.code)) {
      const left = MAX_ATTEMPTS - entry.attempts;
      if (left > 0) return fail(400, `인증번호가 맞지 않아요. (${left}번 더 시도할 수 있어요)`);
      codes.delete(email);
      return fail(429, "인증번호를 너무 많이 틀렸어요. 다시 받아 주세요.");
    }
    codes.delete(email); // 한 번 쓰면 끝
    return { status: 200, body: { ok: true, verified: true } };
  }

  // 오래된 기록 청소 (메모리가 계속 늘지 않게)
  function sweep() {
    const t = now();
    for (const [email, e] of codes) if (t > e.expiresAt) codes.delete(email);
    for (const [ip, list] of sendsByIp) {
      const recent = list.filter((at) => t - at < IP_WINDOW_MS);
      if (recent.length) sendsByIp.set(ip, recent);
      else sendsByIp.delete(ip);
    }
  }

  return { sendCode, verifyCode, sweep };
}
