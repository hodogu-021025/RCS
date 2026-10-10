// API 전체를 실제 http 로 돌려 보는 테스트 (메모리 DB, 가짜 메일)
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { LOGIN_MAX_PER_IP, LOGIN_MAX_PER_USER, LOGIN_WINDOW_MS, PRIVACY_VERSION, createApp } from "./app.mjs";
import { normalizePhone } from "./contact.mjs";
import { WITHDRAWN, openDb } from "./db.mjs";
import { hashPassword } from "./auth.mjs";
import { createVerifier } from "./verification.mjs";

let server;
let base;
let sent; // 가짜로 보낸 메일 [{ email, code }]
let db;
let clock = Date.now(); // 로그인 제한 시간을 넘길 때 앞으로 돌린다

before(async () => {
  db = openDb(":memory:");
  sent = [];
  const verifier = createVerifier({ sendMail: async (email, code) => void sent.push({ email, code }), generateCode: () => "123456" });
  const mailer = { mode: "dev-console", sendMail: verifier.sendMail, describe: "test" };
  server = http.createServer(createApp({ db, verifier, mailer, now: () => clock }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
});

// ip: 인증번호 발송 횟수 제한(한 IP 당 10분에 5통)에 걸리지 않게 가입마다 다른 IP 인 척한다
async function call(method, path, body, token, ip) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { "X-Forwarded-For": ip } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// 이메일 인증을 거쳐 가입하고 토큰을 돌려준다
let ipSeq = 0;
async function signup({ role = "user", username, email, storeId, name = "테스트" }) {
  await call("POST", "/api/email/send-code", { email }, undefined, `10.0.0.${++ipSeq}`);
  const v = await call("POST", "/api/email/verify", { email, code: "123456" });
  const r = await call("POST", "/api/auth/signup", { role, username, name, email, proof: v.body.proof, password: "password1", passwordConfirm: "password1", agreePrivacy: true, storeId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

const chicken = { store: { name: "청전 치킨공방", distance: "1.8km" }, storeId: "h3", item: "간장치킨", qty: 2, unit: "마리", price: 40000, address: "제천시 장락동", phone: "010-1234-5678" };

describe("회원가입·로그인", () => {
  it("인증번호를 받고 확인한 증표로만 가입되고, 가입하면 바로 로그인된다", async () => {
    await call("POST", "/api/email/send-code", { email: "Hong@Example.com" });
    assert.deepEqual(sent.at(-1), { email: "hong@example.com", code: "123456" });

    const noProof = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong", name: "홍길동", email: "hong@example.com", password: "password1", passwordConfirm: "password1", agreePrivacy: true });
    assert.equal(noProof.status, 400);
    assert.match(noProof.body.error, /이메일 인증/);

    const v = await call("POST", "/api/email/verify", { email: "hong@example.com", code: "123456" });
    assert.equal(v.body.verified, true);
    const r = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong", name: "홍길동", email: "hong@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", agreePrivacy: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.session, { username: "hongildong", role: "user", name: "홍길동" });

    const me = await call("GET", "/api/auth/me", undefined, r.body.token);
    assert.deepEqual(me.body.session, r.body.session);
    // 증표는 한 번만 쓴다
    const again = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong2", name: "홍", email: "hong@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", agreePrivacy: true });
    assert.equal(again.status, 400);
  });

  it("아이디·비밀번호 규칙, 중복 아이디·이메일, 비밀번호 확인을 서버가 검사한다", async () => {
    await call("POST", "/api/email/send-code", { email: "rule@example.com" });
    const v = await call("POST", "/api/email/verify", { email: "rule@example.com", code: "123456" });
    const base = { role: "user", name: "규칙", email: "rule@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", agreePrivacy: true };
    assert.match((await call("POST", "/api/auth/signup", { ...base, username: "short1" })).body.error, /8~20자/);
    assert.match((await call("POST", "/api/auth/signup", { ...base, username: "ruleuser1", password: "1234567", passwordConfirm: "1234567" })).body.error, /8자 이상/);
    assert.match((await call("POST", "/api/auth/signup", { ...base, username: "ruleuser1", passwordConfirm: "different1" })).body.error, /서로 달라요/);
    assert.match((await call("POST", "/api/auth/signup", { ...base, username: "hongildong" })).body.error, /이미 있는 아이디/);
    // 이미 가입된 이메일로는 인증번호부터 보내지 않는다
    const taken = await call("POST", "/api/email/send-code", { email: "hong@example.com" });
    assert.equal(taken.status, 400);
    assert.match(taken.body.error, /이미 가입된 이메일/);
  });

  it("로그인·로그아웃, 틀린 비밀번호, 모르는 토큰", async () => {
    const bad = await call("POST", "/api/auth/login", { username: "hongildong", password: "wrong1234" });
    assert.equal(bad.status, 401);
    const ok = await call("POST", "/api/auth/login", { username: "hongildong", password: "password1" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.session.role, "user");
    await call("POST", "/api/auth/logout", {}, ok.body.token);
    assert.equal((await call("GET", "/api/auth/me", undefined, ok.body.token)).body.session, null);
    assert.equal((await call("GET", "/api/auth/me", undefined, "nope")).body.session, null);
    assert.equal((await call("GET", "/api/orders", undefined, "nope")).status, 401);
  });

  it("사장님 가입은 매장이 있어야 하고, 세션에 매장 id 가 든다", async () => {
    await call("POST", "/api/email/send-code", { email: "owner@example.com" });
    const v = await call("POST", "/api/email/verify", { email: "owner@example.com", code: "123456" });
    const noStore = await call("POST", "/api/auth/signup", { role: "owner", username: "bossbanjeom", name: "김사장", email: "owner@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", agreePrivacy: true, storeId: "zz9" });
    assert.match(noStore.body.error, /매장을 골라/);
    // 증표는 실패한 시도에서도 쓰였으므로 다시 인증한다
    const token = await signup({ role: "owner", username: "bossbanjeom", email: "owner2@example.com", storeId: "c1", name: "김사장" });
    const me = await call("GET", "/api/auth/me", undefined, token);
    // 스스로 가입한 사장님은 관리자 승인 전이다
    assert.deepEqual(me.body.session, { username: "bossbanjeom", role: "owner", name: "김사장", storeId: "c1", approved: false });
  });
});

describe("주문·예약과 권한", () => {
  let admin;
  let ownerH3;
  let customer;
  before(async () => {
    db.createUser({ username: "adminuser", passwordHash: (await import("./auth.mjs")).hashPassword("password1"), name: "관리자", role: "admin" });
    admin = (await call("POST", "/api/auth/login", { username: "adminuser", password: "password1" })).body.token;
    ownerH3 = await signup({ role: "owner", username: "chickenboss", email: "h3@example.com", storeId: "h3", name: "치킨 사장" });
    db.approveOwner("chickenboss");
    customer = await signup({ username: "customer01", email: "c01@example.com", name: "김소비" });
  });

  it("비회원도 주문할 수 있고, 손님·사장님·관리자가 각자 범위만 본다", async () => {
    const guest = await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" });
    assert.equal(guest.status, 200);
    assert.equal(guest.body.customer, "guest");
    assert.equal(guest.body.status, "접수");
    const mine = await call("POST", "/api/orders", { order: { ...chicken, qty: 1, price: 20000 }, payment: "토스페이" }, customer);
    assert.equal(mine.body.customerName, "김소비");
    const other = await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1", store: { name: "장락 옛날통닭" }, item: "옛날통닭", qty: 1, price: 18000 }, payment: "신용카드" });
    assert.equal(other.status, 200);

    assert.deepEqual((await call("GET", "/api/orders", undefined, customer)).body.map((o) => o.id), [mine.body.id]);
    assert.deepEqual((await call("GET", "/api/orders", undefined, ownerH3)).body.map((o) => o.id).sort(), [guest.body.id, mine.body.id].sort());
    assert.equal((await call("GET", "/api/orders", undefined, admin)).body.length, 3);
    assert.equal((await call("GET", "/api/orders")).status, 401);
  });

  it("주문 상태는 그 매장 사장님과 관리자만 바꾼다", async () => {
    const o = (await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" })).body;
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "준비 중" }, customer)).status, 403);
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "엉뚱" }, ownerH3)).status, 400);
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "준비 중" }, ownerH3)).body.status, "준비 중");
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "완료" }, admin)).body.status, "완료");
    const otherStore = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1", item: "옛날통닭" }, payment: "카카오페이" })).body;
    assert.equal((await call("PATCH", `/api/orders/${otherStore.id}`, { status: "완료" }, ownerH3)).status, 403);
  });

  it("주문 내용은 서버가 검사한다", async () => {
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, qty: 99 }, payment: "카카오페이" })).status, 400);
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, storeId: "nope" }, payment: "카카오페이" })).status, 400);
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, item: "없는메뉴" }, payment: "카카오페이" })).status, 400);
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1" }, payment: "카카오페이" })).status, 400); // 그 매장 메뉴가 아님
  });

  it("금액·단위·매장 이름은 화면이 보낸 값 대신 목록과 사장님 설정으로 정한다", async () => {
    const cheat = await call("POST", "/api/orders", { order: { ...chicken, qty: 3, price: 1, unit: "개", store: { name: "가짜" } }, payment: "카카오페이" });
    assert.equal(cheat.status, 200);
    assert.deepEqual([cheat.body.order.price, cheat.body.order.unit, cheat.body.order.store.name], [60000, "마리", "청전 치킨공방"]);

    db.updateStoreSettings("h3", { item: { id: "d2", patch: { price: 25000 } } });
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, qty: 2 }, payment: "카카오페이" })).body.order.price, 50000);
    db.updateStoreSettings("h3", { item: { id: "d2", patch: { soldOut: true } } });
    const soldOut = await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" });
    assert.equal(soldOut.status, 400);
    assert.match(soldOut.body.error, /품절/);
    db.updateStoreSettings("h3", { item: { id: "d2", patch: { soldOut: false, price: 20000 } } });
  });

  it("예약도 같은 규칙이다", async () => {
    const r = await call("POST", "/api/reservations", { restaurantId: "h3", restaurantName: "청전 치킨공방", date: "2026-10-12", time: "19:00", people: 3 }, customer);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "예약 확정");
    assert.equal((await call("POST", "/api/reservations", { restaurantId: "h3", restaurantName: "x", date: "내일", time: "19:00", people: 3 })).status, 400);
    assert.equal((await call("POST", "/api/reservations", { restaurantId: "h3", restaurantName: "x", date: "2026-10-12", time: "19:00", people: 50 })).status, 400);
    assert.deepEqual((await call("GET", "/api/reservations", undefined, customer)).body.map((x) => x.id), [r.body.id]);
    assert.equal((await call("GET", "/api/reservations", undefined, ownerH3)).body.length, 1);
    assert.equal((await call("PATCH", `/api/reservations/${r.body.id}`, { status: "방문 완료" }, customer)).status, 403);
    assert.equal((await call("PATCH", `/api/reservations/${r.body.id}`, { status: "방문 완료" }, ownerH3)).body.status, "방문 완료");
  });

  it("매장 설정은 누구나 읽고, 그 매장 사장님만 바꾼다", async () => {
    assert.equal((await call("GET", "/api/stores/settings")).body.h3?.hours, undefined);
    assert.equal((await call("PATCH", "/api/stores/h3/settings", { hours: "16:00 - 23:00" }, customer)).status, 403);
    assert.equal((await call("PATCH", "/api/stores/h1/settings", { hours: "16:00 - 23:00" }, ownerH3)).status, 403);
    assert.equal((await call("PATCH", "/api/stores/h3/settings", { hours: "아무때나" }, ownerH3)).status, 400);
    await call("PATCH", "/api/stores/h3/settings", { hours: "16:00 - 23:00" }, ownerH3);
    await call("PATCH", "/api/stores/h3/settings", { item: { id: "d2", patch: { soldOut: true } } }, ownerH3);
    await call("PATCH", "/api/stores/h3/settings", { item: { id: "d2", patch: { price: 22000 } } }, ownerH3);
    assert.deepEqual((await call("GET", "/api/stores/settings")).body.h3, { hours: "16:00 - 23:00", items: { d2: { soldOut: true, price: 22000 } } });
  });

  it("관리자만 사장님 계정을 만들고 지우며, 지운 사장님의 로그인은 바로 끊긴다", async () => {
    assert.equal((await call("GET", "/api/owners", undefined, customer)).status, 403);
    assert.equal((await call("POST", "/api/owners", { username: "jangrakboss", password: "password1", storeId: "c1" }, ownerH3)).status, 403);
    const made = await call("POST", "/api/owners", { username: "jangrakboss", password: "password1", storeId: "c1" }, admin);
    assert.equal(made.status, 200);
    assert.equal(made.body.name, "사장님");
    const login = await call("POST", "/api/auth/login", { username: "jangrakboss", password: "password1" });
    assert.equal(login.body.session.storeId, "c1");

    const owners = (await call("GET", "/api/owners", undefined, admin)).body.map((o) => o.username).sort();
    assert.deepEqual(owners, ["bossbanjeom", "chickenboss", "jangrakboss"]);
    assert.equal((await call("DELETE", "/api/owners/jangrakboss", undefined, admin)).status, 200);
    assert.equal((await call("GET", "/api/auth/me", undefined, login.body.token)).body.session, null);
    assert.equal((await call("DELETE", "/api/owners/customer01", undefined, admin)).status, 404); // 고객님은 못 지운다

    const users = (await call("GET", "/api/users", undefined, admin)).body;
    assert.ok(users.some((u) => u.username === "customer01" && u.email === "c01@example.com"));
    assert.ok(users.every((u) => !("passwordHash" in u) && !("password_hash" in u)));
  });
});

describe("개인정보 수집·이용 동의", () => {
  it("동의하지 않으면 가입되지 않고 인증 증표도 그대로 남으며, 동의하면 방침 버전과 시각을 남긴다", async () => {
    await call("POST", "/api/email/send-code", { email: "consent@example.com" }, undefined, "10.9.9.9");
    const v = await call("POST", "/api/email/verify", { email: "consent@example.com", code: "123456" });
    const body = { role: "user", username: "consentuser", name: "동의", email: "consent@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1" };
    for (const agreePrivacy of [undefined, false, "true"]) {
      const r = await call("POST", "/api/auth/signup", { ...body, agreePrivacy });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /개인정보 수집·이용에 동의/);
    }
    const before = Date.now();
    assert.equal((await call("POST", "/api/auth/signup", { ...body, agreePrivacy: true })).status, 200);
    const consent = db.privacyConsent("consentuser");
    assert.equal(consent.version, PRIVACY_VERSION);
    assert.ok(consent.agreedAt >= before);
  });

  it("관리자가 만든 사장님 계정에는 동의 기록이 없다", () => {
    db.createUser({ username: "byadmin01", passwordHash: "x", name: "관리자가 만듦", role: "owner", storeId: "c2" });
    assert.deepEqual(db.privacyConsent("byadmin01"), { version: null, agreedAt: null });
  });
});

describe("사장님 승인", () => {
  it("스스로 가입한 사장님은 승인 전에 매장 주문·예약·설정에 접근할 수 없고, 관리자가 승인하면 열린다", async () => {
    db.createUser({ username: "approver01", passwordHash: hashPassword("password1"), name: "관리자", role: "admin" });
    const admin = (await call("POST", "/api/auth/login", { username: "approver01", password: "password1" })).body.token;
    const owner = await signup({ role: "owner", username: "pendingboss", email: "pending@example.com", storeId: "p2", name: "대기 사장" });

    for (const [method, path, body] of [
      ["GET", "/api/orders"],
      ["GET", "/api/reservations"],
      ["PATCH", "/api/stores/p2/settings", { hours: "10:00 - 22:00" }],
    ]) {
      const r = await call(method, path, body, owner);
      assert.equal(r.status, 403, path);
      assert.match(r.body.error, /관리자 승인을 기다리고 있어요/);
    }
    // 관리자 목록에 승인 대기로 보인다
    const listed = (await call("GET", "/api/owners", undefined, admin)).body.find((o) => o.username === "pendingboss");
    assert.equal(listed.approved, false);
    assert.equal((await call("POST", "/api/owners/pendingboss/approve", {}, owner)).status, 403);
    assert.equal((await call("POST", "/api/owners/nobody123/approve", {}, admin)).status, 404);

    assert.equal((await call("POST", "/api/owners/pendingboss/approve", {}, admin)).body.approved, true);
    assert.equal((await call("GET", "/api/orders", undefined, owner)).status, 200);
    assert.equal((await call("GET", "/api/auth/me", undefined, owner)).body.session.approved, true);
  });

  it("관리자가 만든 사장님 계정은 바로 승인된 상태다", async () => {
    const admin = (await call("POST", "/api/auth/login", { username: "approver01", password: "password1" })).body.token;
    const made = await call("POST", "/api/owners", { username: "madeboss01", password: "password1", name: "만든 사장", storeId: "m1" }, admin);
    assert.equal(made.body.approved, true);
  });
});

describe("로그인 시도 제한", () => {
  it("한 아이디로 5번 틀리면 맞는 비밀번호도 잠시 막고, 시간이 지나면 다시 된다", async () => {
    db.createUser({ username: "lockeduser", passwordHash: hashPassword("password1"), name: "잠김", role: "user" });
    for (let i = 0; i < LOGIN_MAX_PER_USER; i++) {
      assert.equal((await call("POST", "/api/auth/login", { username: "lockeduser", password: "wrongpass" + i }, undefined, `10.1.0.${i}`)).status, 401);
    }
    const locked = await call("POST", "/api/auth/login", { username: "lockeduser", password: "password1" }, undefined, "10.1.1.1");
    assert.equal(locked.status, 429);
    assert.match(locked.body.error, /15분 뒤에 다시 시도/);
    assert.ok(locked.body.retryAfter > 0);

    clock += LOGIN_WINDOW_MS;
    assert.equal((await call("POST", "/api/auth/login", { username: "lockeduser", password: "password1" }, undefined, "10.1.1.1")).status, 200);
  });

  it("한 IP 가 여러 아이디로 계속 틀리면 그 IP 를 잠시 막는다", async () => {
    for (let i = 0; i < LOGIN_MAX_PER_IP; i++) {
      await call("POST", "/api/auth/login", { username: `guessuser${i}`, password: "wrongpass" }, undefined, "10.2.2.2");
    }
    assert.equal((await call("POST", "/api/auth/login", { username: "lockeduser", password: "password1" }, undefined, "10.2.2.2")).status, 429);
    assert.equal((await call("POST", "/api/auth/login", { username: "lockeduser", password: "password1" }, undefined, "10.2.2.3")).status, 200);
    clock += LOGIN_WINDOW_MS;
  });
});

describe("비밀번호 찾기", () => {
  it("가입된 이메일로 인증하면 새 비밀번호로 바뀌고, 아이디를 알려 주며, 다른 기기 로그인은 끊긴다", async () => {
    const oldToken = await signup({ username: "forgetful1", email: "forget@example.com", name: "잊음" });
    assert.match((await call("POST", "/api/auth/reset/send-code", { email: "nobody@example.com" }, undefined, "10.3.0.1")).body.error, /가입된 이메일이 아니에요/);

    assert.equal((await call("POST", "/api/auth/reset/send-code", { email: "Forget@Example.com" }, undefined, "10.3.0.2")).status, 200);
    assert.deepEqual(sent.at(-1), { email: "forget@example.com", code: "123456" });
    const proof = (await call("POST", "/api/email/verify", { email: "forget@example.com", code: "123456" })).body.proof;

    const base = { email: "forget@example.com", proof, password: "newpass99", passwordConfirm: "newpass99" };
    assert.match((await call("POST", "/api/auth/reset", { ...base, passwordConfirm: "different" })).body.error, /서로 달라요/);
    assert.match((await call("POST", "/api/auth/reset", { ...base, proof: "fake" })).body.error, /이메일 인증/);
    const done = await call("POST", "/api/auth/reset", base); // 틀린 시도 뒤에도 증표는 남아 있다
    assert.deepEqual(done.body, { ok: true, username: "forgetful1" });

    assert.equal((await call("GET", "/api/auth/me", undefined, oldToken)).body.session, null);
    assert.equal((await call("POST", "/api/auth/login", { username: "forgetful1", password: "password1" })).status, 401);
    assert.equal((await call("POST", "/api/auth/login", { username: "forgetful1", password: "newpass99" })).status, 200);
    assert.equal((await call("POST", "/api/auth/reset", base)).status, 400); // 증표는 한 번만
  });
});

describe("배달 주소·연락처", () => {
  it("주소와 전화번호가 있어야 주문되고, 전화번호는 한 모양으로 맞춘다", async () => {
    // 앞 테스트가 간장치킨을 품절로 남겨 두므로 옛날통닭으로 주문한다
    const tongdak = { ...chicken, storeId: "h1", item: "옛날통닭" };
    const noAddress = await call("POST", "/api/orders", { order: { ...tongdak, address: "  " }, payment: "카드" });
    assert.match(noAddress.body.error, /배달 받을 주소/);
    const badPhone = await call("POST", "/api/orders", { order: { ...tongdak, phone: "12345" }, payment: "카드" });
    assert.match(badPhone.body.error, /전화번호/);
    const ok = await call("POST", "/api/orders", { order: { ...tongdak, phone: "01098765432" }, payment: "카드" });
    assert.equal(ok.body.order.phone, "010-9876-5432");
    assert.equal(ok.body.order.address, "제천시 장락동");
  });

  it("전화번호 모양 맞추기", () => {
    assert.equal(normalizePhone("010 1234 5678"), "010-1234-5678");
    assert.equal(normalizePhone("+82 10-1234-5678"), "010-1234-5678");
    assert.equal(normalizePhone("0431234567"), "043-123-4567");
    assert.equal(normalizePhone("021234567"), "02-123-4567");
    assert.equal(normalizePhone("0212345678"), "02-1234-5678");
    for (const bad of ["", "1234", "010-123", "abc", "0101234567890"]) assert.equal(normalizePhone(bad), null, bad);
  });
});

describe("회원 탈퇴", () => {
  it("비밀번호를 확인하고 계정·세션을 지우며, 주문·예약은 이름을 지운 채 남긴다", async () => {
    const token = await signup({ username: "leavinguser", email: "leaving@example.com", name: "떠날 사람" });
    const order = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1", item: "옛날통닭" }, payment: "카드" }, token)).body;
    const rsv = (await call("POST", "/api/reservations", { restaurantId: "c1", restaurantName: "장락반점", date: "2026-10-20", time: "19:00", people: 2 }, token)).body;

    assert.equal((await call("POST", "/api/auth/withdraw", { password: "wrongpass1" }, token)).status, 400);
    assert.ok(db.findUser("leavinguser"));
    assert.equal((await call("POST", "/api/auth/withdraw", { password: "password1" })).status, 401);

    assert.equal((await call("POST", "/api/auth/withdraw", { password: "password1" }, token)).status, 200);
    assert.equal(db.findUser("leavinguser"), null);
    assert.equal((await call("GET", "/api/auth/me", undefined, token)).body.session, null); // 세션도 없어졌다
    assert.deepEqual([db.orderById(order.id).customer, db.orderById(order.id).customerName], [WITHDRAWN.customer, "탈퇴한 회원"]);
    const r = db.listReservations({}).find((x) => x.id === rsv.id);
    assert.deepEqual([r.customer, r.customerName], [WITHDRAWN.customer, "탈퇴한 회원"]);
    // 같은 이메일로 다시 가입할 수 있고, 새 계정에는 옛 기록이 보이지 않는다
    const again = await signup({ username: "leavinguser", email: "leaving@example.com" });
    assert.deepEqual((await call("GET", "/api/orders", undefined, again)).body, []);
  });

  it("관리자는 탈퇴할 수 없다", async () => {
    db.createUser({ username: "adminleave", passwordHash: hashPassword("password1"), name: "관리자", role: "admin" });
    const token = (await call("POST", "/api/auth/login", { username: "adminleave", password: "password1" })).body.token;
    const r = await call("POST", "/api/auth/withdraw", { password: "password1" }, token);
    assert.equal(r.status, 403);
    assert.ok(db.findUser("adminleave"));
  });
});

describe("손님의 주문 조회·취소와 인기 통계", () => {
  // 앞 테스트가 간장치킨을 품절로 남겨 두므로 같은 매장의 옛날통닭으로 주문한다
  const tongdak = { ...chicken, storeId: "h1", item: "옛날통닭" };
  it("비회원은 영수증 번호로 자기 주문을 보고, 접수 상태일 때만 취소한다", async () => {
    const o = (await call("POST", "/api/orders", { order: tongdak, payment: "카카오페이" })).body;
    assert.match(o.receipt, /^[A-Za-z0-9_-]{20,}$/);
    const found = await call("POST", "/api/orders/lookup", { receipts: [o.receipt, "nope"] });
    assert.deepEqual(found.body.map((x) => x.id), [o.id]);
    assert.equal(found.body[0].receipt, o.receipt); // 화면이 주문과 번호를 짝지을 수 있게 보낸 번호를 붙여 준다

    assert.equal((await call("POST", `/api/orders/${o.id}/cancel`, { receipt: "wrong" })).status, 403);
    const cancelled = await call("POST", `/api/orders/${o.id}/cancel`, { receipt: o.receipt });
    assert.equal(cancelled.body.status, "취소");
    assert.equal((await call("POST", `/api/orders/${o.id}/cancel`, { receipt: o.receipt })).status, 409);

    const started = (await call("POST", "/api/orders", { order: tongdak, payment: "카카오페이" })).body;
    db.setOrderStatus(started.id, "준비 중");
    const late = await call("POST", `/api/orders/${started.id}/cancel`, { receipt: started.receipt });
    assert.equal(late.status, 409);
    assert.match(late.body.error, /준비를 시작/);
  });

  it("인기 통계는 취소를 빼고 메뉴 id·식당 id 로 센다", async () => {
    const before = (await call("GET", "/api/stats/popular")).body;
    await call("POST", "/api/orders", { order: { ...chicken, storeId: "p1", item: "마르게리따 피자" }, payment: "카카오페이" });
    await call("POST", "/api/orders", { order: { ...chicken, storeId: "p1", item: "마르게리따 피자" }, payment: "카카오페이" });
    const c = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "p1", item: "마르게리따 피자" }, payment: "카카오페이" })).body;
    await call("POST", `/api/orders/${c.id}/cancel`, { receipt: c.receipt });
    await call("POST", "/api/reservations", { restaurantId: "c2", restaurantName: "하소 만리향", date: "2026-10-12", time: "19:00", people: 2 });
    const after = (await call("GET", "/api/stats/popular")).body;
    assert.equal((after.items.d3 ?? 0) - (before.items.d3 ?? 0), 2);
    assert.equal((after.restaurants.c2 ?? 0) - (before.restaurants.c2 ?? 0), 1);
  });

  it("예전 DB(영수증 칸 없음)를 열어도 칸을 추가한다", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "saylo-"));
    const file = join(dir, "old.db");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE orders (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, status TEXT NOT NULL, customer TEXT NOT NULL, customer_name TEXT NOT NULL, payment TEXT NOT NULL, store_id TEXT NOT NULL, order_json TEXT NOT NULL)");
    old.close();
    const migrated = openDb(file);
    const rec = migrated.addOrder({ customer: "guest", customerName: "비회원", payment: "x", storeId: "h3", order: { item: "간장치킨" }, receipt: "r1" });
    assert.equal(migrated.orderByReceipt("r1").id, rec.id);
    migrated.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
