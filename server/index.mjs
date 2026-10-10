// Saylo API 서버 시작. 설정은 환경변수(저장소 루트 .env)에서 읽는다. 주소 목록은 app.mjs 맨 위에 있다.
//   PORT            기본 3001
//   DATA_DIR        SQLite 파일을 둘 폴더 (기본: 이 폴더의 data/, Docker 는 /data 볼륨)
//   RESEND_API_KEY  Resend 대시보드의 API 키 (re_…). 없으면 개발 중엔 콘솔에 번호를 찍고, 운영에선 발송 거절
//   MAIL_FROM       보내는 사람. Resend 에 인증한 도메인 주소여야 아무에게나 보낼 수 있다
//   ADMIN_USERNAME / ADMIN_PASSWORD   관리자 계정이 하나도 없을 때 처음 한 번 만든다
import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";
import { hashPassword, passwordError, usernameError } from "./auth.mjs";
import { openDb } from "./db.mjs";
import { createMailer } from "./mail.mjs";
import { createVerifier } from "./verification.mjs";

const PORT = Number(process.env.PORT ?? 3001);
const PRODUCTION = process.env.NODE_ENV === "production";
const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "data");

mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(join(DATA_DIR, "saylo.db"));
const mailer = createMailer({ apiKey: process.env.RESEND_API_KEY?.trim(), from: process.env.MAIL_FROM?.trim(), production: PRODUCTION });
const verifier = createVerifier({ sendMail: mailer.sendMail });

// 관리자 계정: 하나도 없으면 .env 의 ADMIN_USERNAME / ADMIN_PASSWORD 로 만든다.
// 개발 중에 그마저 없으면 adminuser / admin1234 를 만들고 알려 준다 (운영에서는 만들지 않는다)
function ensureAdmin() {
  if (db.countByRole("admin") > 0) return;
  let username = process.env.ADMIN_USERNAME?.trim() ?? "";
  let password = process.env.ADMIN_PASSWORD ?? "";
  if (!username || !password) {
    if (PRODUCTION) {
      console.warn("[admin] 관리자 계정이 없습니다. .env 에 ADMIN_USERNAME / ADMIN_PASSWORD 를 적고 다시 시작하세요.");
      return;
    }
    [username, password] = ["adminuser", "admin1234"];
    console.log("[admin] 개발용 관리자 계정을 만들었습니다: adminuser / admin1234 (.env 의 ADMIN_USERNAME / ADMIN_PASSWORD 로 바꿀 수 있어요)");
  }
  const error = usernameError(username) ?? passwordError(password);
  if (error) return console.warn(`[admin] 관리자 계정을 만들지 못했습니다: ${error}`);
  db.createUser({ username, passwordHash: hashPassword(password), name: "관리자", role: "admin" });
  console.log(`[admin] 관리자 계정 ${username} 을 만들었습니다`);
}
ensureAdmin();

setInterval(() => {
  verifier.sweep();
  db.sweepSessions();
}, 60_000).unref();

const server = http.createServer(createApp({ db, verifier, mailer }));
server.listen(PORT, () => {
  console.log(`Saylo API :${PORT} · DB ${join(DATA_DIR, "saylo.db")} · 메일 ${mailer.describe}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
