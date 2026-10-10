// Saylo API 서버: 지금은 회원가입 이메일 인증만 맡는다. 외부 패키지 없이 Node 내장 기능만 쓴다.
//   POST /api/email/send-code  { email }        → 인증번호 메일 발송 (Resend)
//   POST /api/email/verify     { email, code }  → 번호 확인
//   GET  /api/health
// Resend API 키는 이 서버에만 둔다 (브라우저에 넣으면 누구나 키를 볼 수 있다).
//   RESEND_API_KEY  Resend 대시보드의 API 키 (re_…)
//   MAIL_FROM       보내는 사람. Resend 에 인증한 도메인 주소여야 아무에게나 보낼 수 있다
//                   (기본값 onboarding@resend.dev 는 Resend 계정 주인 메일로만 간다)
// 키가 없으면: 개발 중에는 메일 대신 이 서버 콘솔에 번호를 찍고, 운영(NODE_ENV=production)에서는 발송을 거절한다.
import http from "node:http";
import { createVerifier } from "./verification.mjs";

const PORT = Number(process.env.PORT ?? 3001);
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim() ?? "";
const MAIL_FROM = process.env.MAIL_FROM?.trim() || "Saylo <onboarding@resend.dev>";
const PRODUCTION = process.env.NODE_ENV === "production";
const MAIL_MODE = RESEND_API_KEY ? "resend" : PRODUCTION ? "off" : "dev-console";
const MAX_BODY = 4 * 1024;

function emailHtml(code) {
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f3f6fb;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:20px;padding:32px 28px">
  <div style="font-size:24px;font-weight:900;color:#007cfc;letter-spacing:-0.03em">Saylo</div>
  <p style="margin:20px 0 8px;font-size:16px;font-weight:700">이메일 인증번호</p>
  <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6">회원가입 화면에 아래 번호를 입력해 주세요. 번호는 5분 동안 쓸 수 있어요.</p>
  <div style="padding:18px 0;border-radius:14px;background:#f3f6fb;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#007cfc">${code}</div>
  <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.6">직접 요청하지 않았다면 이 메일은 무시하셔도 됩니다.</p>
</div></body></html>`;
}

async function sendWithResend(email, code) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [email],
      subject: "[Saylo] 이메일 인증번호",
      html: emailHtml(code),
      text: `Saylo 이메일 인증번호: ${code}\n회원가입 화면에 입력해 주세요. 5분 동안 쓸 수 있어요.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function sendMail(email, code) {
  if (MAIL_MODE === "resend") return sendWithResend(email, code);
  if (MAIL_MODE === "off") throw new Error("RESEND_API_KEY 가 설정되지 않았습니다");
  console.log(`[email:dev] ${email} 인증번호 ${code} (RESEND_API_KEY 가 없어 메일 대신 콘솔에 찍음)`);
}

const verifier = createVerifier({ sendMail });
setInterval(verifier.sweep, 60_000).unref();

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("bad json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

// nginx·Vite 프록시 뒤에서 돌므로 실제 접속 IP 는 X-Forwarded-For 첫 값이다
const clientIp = (req) => String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true, mail: MAIL_MODE });
    if (req.method === "POST" && path === "/api/email/send-code") {
      if (MAIL_MODE === "off") return send(res, 503, { error: "이메일 인증이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요." });
      const { email } = await readJson(req);
      const r = await verifier.sendCode(email, clientIp(req));
      return send(res, r.status, r.body);
    }
    if (req.method === "POST" && path === "/api/email/verify") {
      const { email, code } = await readJson(req);
      const r = verifier.verifyCode(email, code);
      return send(res, r.status, r.body);
    }
    send(res, 404, { error: "없는 주소예요." });
  } catch (err) {
    const status = err?.status ?? 500;
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? "서버에 문제가 생겼어요." : "요청 형식이 맞지 않아요." });
  }
});

server.listen(PORT, () => {
  const mode = { resend: `Resend (보내는 사람 ${MAIL_FROM})`, off: "꺼짐 — .env 에 RESEND_API_KEY 필요", "dev-console": "개발용(콘솔 출력)" };
  console.log(`Saylo API :${PORT} · 메일 ${mode[MAIL_MODE]}`);
});
