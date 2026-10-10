// 화면 테스트용 API 서버: 테스트마다 메모리 DB 로 새로 띄운다. 인증번호는 늘 123456, 메일은 보내지 않는다
import http from "node:http";
import { createApp } from "../../../server/app.mjs";
import { hashPassword } from "../../../server/auth.mjs";
import { openDb } from "../../../server/db.mjs";
import { createVerifier } from "../../../server/verification.mjs";

export const TEST_CODE = "123456";

export async function startTestServer() {
  const db = openDb(":memory:");
  const sent = [];
  const verifier = createVerifier({ sendMail: async (email, code) => void sent.push({ email, code }), generateCode: () => TEST_CODE });
  const mailer = { mode: "dev-console", sendMail: verifier.sendMail, describe: "test" };
  const server = http.createServer(createApp({ db, verifier, mailer }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    db,
    sent,
    // 이메일 인증 없이 바로 계정을 만든다 (비밀번호 기본 password1)
    createAccount({ username, password = "password1", name = username, role = "user", storeId, email }) {
      return db.createUser({ username, passwordHash: hashPassword(password), name, email, role, storeId });
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
