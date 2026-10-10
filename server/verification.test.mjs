import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CODE_TTL_MS, IP_MAX_SENDS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS, createVerifier } from "./verification.mjs";

let clock;
let sent;
let verifier;
beforeEach(() => {
  clock = 1_000_000;
  sent = [];
  verifier = createVerifier({
    now: () => clock,
    generateCode: () => "123456",
    sendMail: async (email, code) => void sent.push({ email, code }),
  });
});

describe("인증번호 보내기", () => {
  it("주소를 다듬어 보내고, 유효 시간·재발송 대기 시간을 알려 준다", async () => {
    const r = await verifier.sendCode("  Hong@Example.COM ", "1.1.1.1");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, expiresIn: 300, resendIn: 60 });
    assert.deepEqual(sent, [{ email: "hong@example.com", code: "123456" }]);
  });

  it("이메일 형식이 아니면 보내지 않는다", async () => {
    for (const bad of ["", "hong", "hong@", "@example.com", "hong@example", "a b@example.com"]) {
      assert.equal((await verifier.sendCode(bad)).status, 400, bad);
    }
    assert.equal(sent.length, 0);
  });

  it("같은 주소는 1분이 지나야 다시 보낸다", async () => {
    await verifier.sendCode("hong@example.com");
    clock += 20_000;
    const again = await verifier.sendCode("hong@example.com");
    assert.equal(again.status, 429);
    assert.equal(again.body.retryAfter, 40);
    clock += RESEND_COOLDOWN_MS;
    assert.equal((await verifier.sendCode("hong@example.com")).status, 200);
    assert.equal(sent.length, 2);
  });

  it("한 IP 가 10분에 보낼 수 있는 메일 수를 넘으면 막는다", async () => {
    for (let i = 0; i < IP_MAX_SENDS; i++) assert.equal((await verifier.sendCode(`u${i}@example.com`, "9.9.9.9")).status, 200);
    assert.equal((await verifier.sendCode("another@example.com", "9.9.9.9")).status, 429);
    assert.equal((await verifier.sendCode("another@example.com", "8.8.8.8")).status, 200); // 다른 IP 는 괜찮다
  });

  it("메일 발송이 실패하면 502 를 돌려주고 번호를 남기지 않는다", async () => {
    const failing = createVerifier({ now: () => clock, sendMail: async () => { throw new Error("boom"); } });
    const r = await failing.sendCode("hong@example.com");
    assert.equal(r.status, 502);
    assert.equal(failing.verifyCode("hong@example.com", "123456").status, 400);
  });
});

describe("인증번호 확인", () => {
  it("맞으면 인증되고, 같은 번호는 두 번 쓸 수 없다", async () => {
    await verifier.sendCode("hong@example.com");
    assert.deepEqual(verifier.verifyCode("HONG@example.com", " 123456 ").body, { ok: true, verified: true });
    assert.equal(verifier.verifyCode("hong@example.com", "123456").status, 400);
  });

  it("틀리면 남은 횟수를 알려 주고, 다 틀리면 번호가 없어진다", async () => {
    await verifier.sendCode("hong@example.com");
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const r = verifier.verifyCode("hong@example.com", "000000");
      assert.equal(r.status, 400);
      assert.match(r.body.error, new RegExp(`${MAX_ATTEMPTS - i}번 더`));
    }
    assert.equal(verifier.verifyCode("hong@example.com", "000000").status, 429);
    assert.equal(verifier.verifyCode("hong@example.com", "123456").status, 400); // 맞는 번호여도 이미 없어졌다
  });

  it("5분이 지나면 만료된다", async () => {
    await verifier.sendCode("hong@example.com");
    clock += CODE_TTL_MS + 1;
    assert.equal(verifier.verifyCode("hong@example.com", "123456").status, 410);
  });

  it("받은 적 없는 주소는 먼저 받으라고 한다", () => {
    assert.match(verifier.verifyCode("nobody@example.com", "123456").body.error, /먼저 받아/);
  });
});
