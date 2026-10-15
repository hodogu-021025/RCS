// API 전체를 실제 http 로 돌려 보는 테스트 (메모리 DB, 가짜 메일)
import assert from "node:assert/strict";
import http from "node:http";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { PRIVACY_VERSION, createApp } from "./app.mjs";
import { normalizePhone } from "./contact.mjs";
import { ORDER_KEEP_YEARS, WITHDRAWN, openDb } from "./db.mjs";
import { STORE_IDS } from "./stores.mjs";
import { catalogWithMenu, pauseEndText, todayKST, withTopic } from "./stores.mjs";
import { hashPassword } from "./auth.mjs";
import { createVerifier } from "./verification.mjs";

let server;
let base;
let sent; // 가짜로 보낸 메일 [{ email, code }]
let notices; // 가짜로 보낸 알림 메일 [{ email, subject, text }]
let db;
let clock = Date.now(); // 로그인 제한 시간을 넘길 때 앞으로 돌린다
let buyer; // 주문할 때 쓰는 고객님 토큰
const DEFAULT_ACCOUNT = { bank: "시범은행", account: "000-0000-0000", holder: "세일로" };

before(async () => {
  db = openDb(":memory:");
  sent = [];
  const verifier = createVerifier({ sendMail: async (email, code) => void sent.push({ email, code }), generateCode: () => "123456" });
  notices = [];
  const mailer = { mode: "dev-console", sendMail: verifier.sendMail, sendNotice: async (email, subject, text) => void notices.push({ email, subject, text }), describe: "test" };
  server = http.createServer(createApp({ db, verifier, mailer, adminEmail: "operator@example.com", now: () => clock }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  // 배달 주문은 로그인한 고객님만 한다. 주문이 필요한 테스트는 이 계정으로 주문한다
  db.createUser({ username: "buyer0001", passwordHash: hashPassword("password1"), name: "주문자", role: "user", phone: "010-1234-5678" });
  buyer = (await call("POST", "/api/auth/login", { username: "buyer0001", password: "password1" })).body.token;
  // 결제는 계좌이체라 매장 계좌가 있어야 주문을 받는다. 모든 매장에 같은 시범 계좌를 넣어 둔다
  for (const id of STORE_IDS) db.setBankAccount(id, DEFAULT_ACCOUNT);
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

// 이메일 인증을 거쳐 가입하고 토큰을 돌려준다.
// 사장님은 회원가입이 막혀 있어, 예전에 스스로 가입해 승인을 기다리는 사장님과 같은 계정을 DB에 바로 만들고 로그인한다
let ipSeq = 0;
async function signup({ role = "user", username, email, storeId, name = "테스트" }) {
  if (role === "owner") {
    db.createUser({ username, passwordHash: hashPassword("password1"), name, email, role, storeId, phone: "010-1234-5678", approved: false });
    const r = await call("POST", "/api/auth/login", { username, password: "password1" }, undefined, `10.0.0.${++ipSeq}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.token;
  }
  await call("POST", "/api/email/send-code", { email }, undefined, `10.0.0.${++ipSeq}`);
  const v = await call("POST", "/api/email/verify", { email, code: "123456" });
  const r = await call("POST", "/api/auth/signup", { role, username, name, email, proof: v.body.proof, password: "password1", passwordConfirm: "password1", phone: "01012345678", agreePrivacy: true, storeId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

const chicken = { store: { name: "청전 치킨공방", distance: "1.8km" }, storeId: "h3", item: "간장치킨", qty: 2, unit: "마리", price: 40000, address: "제천시 장락동", phone: "010-1234-5678" };

describe("회원가입·로그인", () => {
  it("인증번호를 받고 확인한 증표로만 가입되고, 가입하면 바로 로그인된다", async () => {
    await call("POST", "/api/email/send-code", { email: "Hong@Example.com" });
    assert.deepEqual(sent.at(-1), { email: "hong@example.com", code: "123456" });

    const noProof = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong", name: "홍길동", email: "hong@example.com", password: "password1", passwordConfirm: "password1", phone: "01012345678", agreePrivacy: true });
    assert.equal(noProof.status, 400);
    assert.match(noProof.body.error, /이메일 인증/);

    const v = await call("POST", "/api/email/verify", { email: "hong@example.com", code: "123456" });
    assert.equal(v.body.verified, true);
    const r = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong", name: "홍길동", email: "hong@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", phone: "01012345678", agreePrivacy: true });
    assert.equal(r.status, 200);
    // 전화번호는 하이픈 없이 보내도 010-1234-5678 모양으로 저장된다
    assert.deepEqual(r.body.session, { username: "hongildong", role: "user", name: "홍길동", phone: "010-1234-5678" });

    const me = await call("GET", "/api/auth/me", undefined, r.body.token);
    assert.deepEqual(me.body.session, r.body.session);
    // 증표는 한 번만 쓴다
    const again = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong2", name: "홍", email: "hong@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", phone: "01012345678", agreePrivacy: true });
    assert.equal(again.status, 400);
  });

  it("아이디·비밀번호 규칙, 중복 아이디·이메일, 비밀번호 확인을 서버가 검사한다", async () => {
    await call("POST", "/api/email/send-code", { email: "rule@example.com" });
    const v = await call("POST", "/api/email/verify", { email: "rule@example.com", code: "123456" });
    const base = { role: "user", name: "규칙", email: "rule@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", phone: "01012345678", agreePrivacy: true };
    assert.match((await call("POST", "/api/auth/signup", { ...base, username: "short" })).body.error, /6~20자/);
    assert.match((await call("POST", "/api/auth/signup", { ...base, username: "ruleuser1", password: "12345", passwordConfirm: "12345" })).body.error, /6자 이상/);
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

  it("회원가입으로는 사장님 계정을 만들 수 없다 (관리자가 만든다)", async () => {
    await call("POST", "/api/email/send-code", { email: "owner@example.com" });
    const v = await call("POST", "/api/email/verify", { email: "owner@example.com", code: "123456" });
    const r = await call("POST", "/api/auth/signup", { role: "owner", username: "bossbanjeom", name: "김사장", email: "owner@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", phone: "01012345678", agreePrivacy: true, storeId: "c1" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /관리자/);
    assert.equal(db.findUser("bossbanjeom"), null);
  });

  it("예전에 스스로 가입한 사장님은 세션에 매장 id 와 승인 대기 상태가 든다", async () => {
    const token = await signup({ role: "owner", username: "bossbanjeom", email: "owner2@example.com", storeId: "c1", name: "김사장" });
    const me = await call("GET", "/api/auth/me", undefined, token);
    assert.deepEqual(me.body.session, { username: "bossbanjeom", role: "owner", name: "김사장", storeId: "c1", approved: false, phone: "010-1234-5678" });
  });

  it("가입할 때 전화번호를 꼭 받고, 전화번호 모양이 아니면 거절한다 (증표는 그대로 남는다)", async () => {
    await call("POST", "/api/email/send-code", { email: "phone@example.com" }, undefined, "10.8.8.8");
    const v = await call("POST", "/api/email/verify", { email: "phone@example.com", code: "123456" });
    const body = { role: "user", username: "phoneuser1", name: "전화", email: "phone@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", agreePrivacy: true };
    for (const phone of [undefined, "", "1234", "010-12-34", "abc"]) {
      const r = await call("POST", "/api/auth/signup", { ...body, phone });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /전화번호/);
    }
    const ok = await call("POST", "/api/auth/signup", { ...body, phone: "02 123 4567" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.session.phone, "02-123-4567");
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

  it("배달 주문은 로그인한 고객님만 하고, 손님·사장님·관리자가 각자 범위만 본다", async () => {
    const noLogin = await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" });
    assert.equal(noLogin.status, 401);
    assert.match(noLogin.body.error, /로그인/);
    assert.equal((await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" }, ownerH3)).status, 403);
    assert.equal((await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" }, admin)).status, 403);

    const guest = await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" }, buyer);
    assert.equal(guest.status, 200);
    assert.equal(guest.body.customer, "buyer0001");
    // 계좌이체: 입금 대기로 들어오고, 입금할 계좌·입금자명·입금 기한이 주문에 적힌다 (화면이 보낸 결제수단은 무시)
    assert.equal(guest.body.status, "입금 대기");
    assert.equal(guest.body.payment, "계좌이체");
    assert.deepEqual(guest.body.order.bank, DEFAULT_ACCOUNT);
    assert.equal(guest.body.order.depositor, "주문자");
    assert.ok(Math.abs(guest.body.order.payBy - (guest.body.createdAt + 30 * 60_000)) < 1000);
    const mine = await call("POST", "/api/orders", { order: { ...chicken, qty: 1, price: 20000 }, payment: "토스페이" }, customer);
    assert.equal(mine.body.customerName, "김소비");
    const other = await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1", store: { name: "장락 옛날통닭" }, item: "옛날통닭", qty: 1, price: 18000 }, payment: "신용카드" }, buyer);
    assert.equal(other.status, 200);

    assert.deepEqual((await call("GET", "/api/orders", undefined, customer)).body.map((o) => o.id), [mine.body.id]);
    assert.deepEqual((await call("GET", "/api/orders", undefined, ownerH3)).body.map((o) => o.id).sort(), [guest.body.id, mine.body.id].sort());
    assert.equal((await call("GET", "/api/orders", undefined, admin)).body.length, 3);
    assert.equal((await call("GET", "/api/orders")).status, 401);
  });

  it("주문 상태는 그 매장 사장님과 관리자만 바꾼다", async () => {
    const o = (await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" }, buyer)).body;
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "접수" }, customer)).status, 403);
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "엉뚱" }, ownerH3)).status, 400);
    // 입금을 확인하기 전에는 준비를 시작할 수 없다
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "준비 중" }, ownerH3)).status, 409);
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "접수" }, ownerH3)).body.status, "접수");
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "준비 중" }, ownerH3)).body.status, "준비 중");
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "완료" }, admin)).body.status, "완료");
    const otherStore = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1", item: "옛날통닭" }, payment: "카카오페이" }, buyer)).body;
    assert.equal((await call("PATCH", `/api/orders/${otherStore.id}`, { status: "완료" }, ownerH3)).status, 403);
  });

  it("주문 내용은 서버가 검사한다", async () => {
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, qty: 99 }, payment: "카카오페이" }, buyer)).status, 400);
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, storeId: "nope" }, payment: "카카오페이" }, buyer)).status, 400);
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, item: "없는메뉴" }, payment: "카카오페이" }, buyer)).status, 400);
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1" }, payment: "카카오페이" }, buyer)).status, 400); // 그 매장 메뉴가 아님
  });

  it("금액·단위·매장 이름은 화면이 보낸 값 대신 목록과 사장님 설정으로 정한다", async () => {
    const cheat = await call("POST", "/api/orders", { order: { ...chicken, qty: 3, price: 1, unit: "개", store: { name: "가짜" } }, payment: "카카오페이" }, buyer);
    assert.equal(cheat.status, 200);
    assert.deepEqual([cheat.body.order.price, cheat.body.order.items[0].unit, cheat.body.order.store.name], [60000, "마리", "청전 치킨공방"]);

    db.updateStoreSettings("h3", { item: { id: "d2", patch: { price: 25000 } } });
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, qty: 2 }, payment: "카카오페이" }, buyer)).body.order.price, 50000);
    db.updateStoreSettings("h3", { item: { id: "d2", patch: { soldOut: true } } });
    const soldOut = await call("POST", "/api/orders", { order: chicken, payment: "카카오페이" }, buyer);
    assert.equal(soldOut.status, 400);
    assert.match(soldOut.body.error, /품절/);
    db.updateStoreSettings("h3", { item: { id: "d2", patch: { soldOut: false, price: 20000 } } });
  });

  it("예약도 같은 규칙이다", async () => {
    // 방문 완료는 방문일부터 할 수 있으므로 이미 지난 날짜로 만든다
    const r = await call("POST", "/api/reservations", { restaurantId: "h3", restaurantName: "청전 치킨공방", date: "2026-10-01", time: "19:00", people: 3 }, customer);
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
    assert.equal(made.body.name, "장락반점 사장님"); // 사장님 이름은 "매장 이름 사장님"
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
    const body = { role: "user", username: "consentuser", name: "동의", email: "consent@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", phone: "010-1234-5678" };
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

describe("로그인 잠금 없음", () => {
  it("여러 번 틀려도 막지 않고, 맞는 비밀번호를 넣으면 바로 로그인된다", async () => {
    db.createUser({ username: "lockeduser", passwordHash: hashPassword("password1"), name: "잠김", role: "user" });
    for (let i = 0; i < 25; i++) {
      assert.equal((await call("POST", "/api/auth/login", { username: "lockeduser", password: "wrongpass" + i }, undefined, "10.1.0.1")).status, 401);
    }
    assert.equal((await call("POST", "/api/auth/login", { username: "lockeduser", password: "password1" }, undefined, "10.1.0.1")).status, 200);
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
    const noAddress = await call("POST", "/api/orders", { order: { ...tongdak, address: "  " }, payment: "카드" }, buyer);
    assert.match(noAddress.body.error, /배달 받을 주소/);
    const badPhone = await call("POST", "/api/orders", { order: { ...tongdak, phone: "12345" }, payment: "카드" }, buyer);
    assert.match(badPhone.body.error, /전화번호/);
    const ok = await call("POST", "/api/orders", { order: { ...tongdak, phone: "01098765432" }, payment: "카드" }, buyer);
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
  it("주문한 고객님만 접수 상태일 때 취소하고, 비회원 영수증 번호 조회는 없다", async () => {
    const o = (await call("POST", "/api/orders", { order: tongdak, payment: "카카오페이" }, buyer)).body;
    assert.equal(o.receipt, undefined);
    assert.equal((await call("POST", "/api/orders/lookup", { receipts: ["anything"] })).status, 404);

    assert.equal((await call("POST", `/api/orders/${o.id}/cancel`, {})).status, 401);
    const other = await signup({ username: "otherbuyer1", email: "otherbuyer@example.com" });
    assert.equal((await call("POST", `/api/orders/${o.id}/cancel`, {}, other)).status, 403);
    const cancelled = await call("POST", `/api/orders/${o.id}/cancel`, {}, buyer);
    assert.equal(cancelled.body.status, "취소");
    assert.equal((await call("POST", `/api/orders/${o.id}/cancel`, {}, buyer)).status, 409);

    const started = (await call("POST", "/api/orders", { order: tongdak, payment: "카카오페이" }, buyer)).body;
    db.setOrderStatus(started.id, "준비 중");
    const late = await call("POST", `/api/orders/${started.id}/cancel`, {}, buyer);
    assert.equal(late.status, 409);
    assert.match(late.body.error, /준비를 시작/);
  });

  it("인기 통계는 취소를 빼고 메뉴 id·식당 id 로 센다", async () => {
    const before = (await call("GET", "/api/stats/popular")).body;
    await call("POST", "/api/orders", { order: { ...chicken, storeId: "p1", item: "마르게리따 피자" }, payment: "카카오페이" }, buyer);
    await call("POST", "/api/orders", { order: { ...chicken, storeId: "p1", item: "마르게리따 피자" }, payment: "카카오페이" }, buyer);
    const c = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "p1", item: "마르게리따 피자" }, payment: "카카오페이" }, buyer)).body;
    await call("POST", `/api/orders/${c.id}/cancel`, {}, buyer);
    await call("POST", "/api/reservations", { restaurantId: "c2", restaurantName: "하소 만리향", date: "2026-10-12", time: "19:00", people: 2 });
    const after = (await call("GET", "/api/stats/popular")).body;
    assert.equal((after.items.d3 ?? 0) - (before.items.d3 ?? 0), 2);
    assert.equal((after.restaurants.c2 ?? 0) - (before.restaurants.c2 ?? 0), 1);
  });

  it("예전 DB(영수증 칸 없음)를 열어도 주문을 넣을 수 있고, 남아 있던 영수증 번호는 비운다", async () => {
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
    const rec = migrated.addOrder({ customer: "guest", customerName: "비회원", payment: "x", storeId: "h3", order: { item: "간장치킨" } });
    assert.equal(migrated.orderById(rec.id).order.items[0].item, "간장치킨");
    migrated.close();
    // 예전에 비회원 주문으로 받은 영수증 번호가 남아 있으면 다시 열 때 비운다
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE orders SET receipt = 'old-receipt' WHERE id = ?").run(rec.id);
    raw.close();
    openDb(file).close();
    const check = new DatabaseSync(file);
    assert.equal(check.prepare("SELECT receipt FROM orders WHERE id = ?").get(rec.id).receipt, null);
    check.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("계좌이체 (입금 계좌·입금 기한)", () => {
  let admin;
  let boss;
  before(async () => {
    db.createUser({ username: "bankadmin1", passwordHash: hashPassword("password1"), name: "관리자", role: "admin" });
    admin = (await call("POST", "/api/auth/login", { username: "bankadmin1", password: "password1" })).body.token;
    db.createUser({ username: "bankboss01", passwordHash: hashPassword("password1"), name: "피자 사장", role: "owner", storeId: "p1" });
    boss = (await call("POST", "/api/auth/login", { username: "bankboss01", password: "password1" })).body.token;
  });
  const pizza = { ...chicken, storeId: "p1", item: "마르게리따 피자", qty: 1 };
  // 테스트가 중간에 실패해도 다른 테스트가 주문할 수 있게 p1 계좌를 되돌린다
  afterEach(() => db.setBankAccount("p1", DEFAULT_ACCOUNT));

  it("사장님은 자기 매장 계좌를 보고 바꾸고 지우며, 계좌를 지우면 그 매장은 주문을 받지 않는다", async () => {
    assert.deepEqual((await call("GET", "/api/stores/p1/bank", undefined, boss)).body, { account: DEFAULT_ACCOUNT });
    assert.equal((await call("GET", "/api/stores/h3/bank", undefined, boss)).status, 403); // 남의 매장
    assert.equal((await call("GET", "/api/stores/p1/bank", undefined, buyer)).status, 403);

    const bad = await call("PUT", "/api/stores/p1/bank", { bank: "국민은행", account: "12-34", holder: "김사장" }, boss);
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /계좌번호/);
    assert.equal((await call("PUT", "/api/stores/p1/bank", { bank: "국민은행", account: "123456-01-234567", holder: "" }, boss)).status, 400);
    const mine = { bank: "국민은행", account: "123456-01-234567", holder: "김사장" };
    const put = await call("PUT", "/api/stores/p1/bank", { ...mine, account: " 123456-01-234567 " }, boss);
    assert.deepEqual(put.body, { account: mine }, JSON.stringify(put));

    const order = (await call("POST", "/api/orders", { order: pizza }, buyer)).body;
    assert.deepEqual(order.order.bank, mine);
    // 주문에 적힌 계좌는 그때 것 그대로 (나중에 계좌를 바꿔도 이미 한 주문의 안내는 바뀌지 않는다)
    await call("PUT", "/api/stores/p1/bank", { bank: "신한은행", account: "110-123-456789", holder: "김사장" }, boss);
    assert.deepEqual(db.orderById(order.id).order.bank, mine);

    assert.deepEqual((await call("DELETE", "/api/stores/p1/bank", undefined, boss)).body, { account: null });
    const none = await call("POST", "/api/orders", { order: pizza }, buyer);
    assert.equal(none.status, 400);
    assert.match(none.body.error, /입금 계좌/);
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1", item: "옛날통닭" } }, buyer)).status, 200); // 계좌 있는 매장은 그대로
  });

  it("관리자는 매장 계좌 전체를 보고 대신 등록할 수 있다 (기본 계좌는 없다)", async () => {
    assert.equal((await call("GET", "/api/bank", undefined, boss)).status, 403);
    await call("PUT", "/api/stores/p1/bank", { bank: "우리은행", account: "1002-123-456789", holder: "김사장" }, admin);
    const all = (await call("GET", "/api/bank", undefined, admin)).body;
    assert.equal(all.p1.bank, "우리은행");
    assert.deepEqual(all.h3, DEFAULT_ACCOUNT);
    assert.equal(all.default, undefined);
    assert.equal((await call("PUT", "/api/bank/default", DEFAULT_ACCOUNT, admin)).status, 404);
  });

  it("사장님이 입금을 확인하면 확인 시각이 주문에 남는다", async () => {
    const o = (await call("POST", "/api/orders", { order: pizza }, buyer)).body;
    assert.equal(o.order.paidAt, undefined);
    const paid = (await call("PATCH", `/api/orders/${o.id}`, { status: "접수" }, boss)).body;
    assert.equal(paid.status, "접수");
    assert.ok(paid.order.paidAt >= o.createdAt);
    // 그다음 상태 변경은 확인 시각을 건드리지 않는다
    await call("PATCH", `/api/orders/${o.id}`, { status: "준비 중" }, boss);
    assert.equal(db.orderById(o.id).order.paidAt, paid.order.paidAt);
  });

  it("입금 기한이 지난 입금 대기 주문은 자동으로 취소되고, 그 뒤로는 입금 확인할 수 없다", async () => {
    const o = (await call("POST", "/api/orders", { order: pizza }, buyer)).body;
    const paid = (await call("POST", "/api/orders", { order: pizza }, buyer)).body;
    await call("PATCH", `/api/orders/${paid.id}`, { status: "접수" }, boss);
    db.expireUnpaidOrders(o.createdAt); // 이 주문은 아직 기한 전 (앞 테스트의 더 오래된 주문만 정리된다)
    assert.equal(db.orderById(o.id).status, "입금 대기");
    assert.ok(db.expireUnpaidOrders(o.createdAt + 1) >= 1);
    const expired = db.orderById(o.id);
    assert.equal(expired.status, "취소");
    assert.match(expired.order.cancelNote, /입금 기한/);
    assert.equal(db.orderById(paid.id).status, "접수"); // 입금 확인된 주문은 그대로
    assert.equal((await call("PATCH", `/api/orders/${o.id}`, { status: "접수" }, boss)).status, 409);
  });

  it("탈퇴하면 주문의 입금자명도 지우고, 사장님 계정이 없어지면 그 매장 입금 계좌도 지운다", async () => {
    const leaver = await signup({ username: "payleaver1", email: "payleaver@example.com", name: "떠날손님" });
    const o = (await call("POST", "/api/orders", { order: pizza }, leaver)).body;
    assert.equal(o.order.depositor, "떠날손님");
    await call("POST", "/api/auth/withdraw", { password: "password1" }, leaver);
    assert.equal(db.orderById(o.id).order.depositor, undefined);

    assert.ok(db.bankAccount("p1"));
    assert.equal((await call("DELETE", "/api/owners/bankboss01", undefined, admin)).status, 200);
    assert.equal(db.bankAccount("p1"), null);
  });

  it("고객님은 입금 대기·접수 주문을 취소할 수 있다", async () => {
    const o = (await call("POST", "/api/orders", { order: pizza }, buyer)).body;
    assert.equal((await call("POST", `/api/orders/${o.id}/cancel`, {}, buyer)).body.status, "취소");
  });
});

describe("점검에서 찾은 서버 문제", () => {
  it("풀 수 없는 글자가 든 주소(%FF)는 400 으로 답하고 서버가 죽지 않는다", async () => {
    const res = await fetch(`${base}/api/orders/%FF/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 400);
    assert.equal((await call("GET", "/api/health")).status, 200);
  });

  it("탈퇴하면 주문 기록의 배달지·연락처도 지워진다", async () => {
    const token = await signup({ username: "leaver00002", email: "leaver2@example.com", name: "떠남" });
    const order = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1", item: "옛날통닭" }, payment: "카드" }, token)).body;
    assert.equal((await call("POST", "/api/auth/withdraw", { password: "password1" }, token)).status, 200);
    const kept = db.orderById(order.id);
    assert.equal(kept.order.address, undefined);
    assert.equal(kept.order.phone, undefined);
    assert.equal(kept.order.items[0].item, "옛날통닭");
    assert.equal(kept.customerName, WITHDRAWN.name);
  });

  it("보관 기간(5년)이 지난 주문은 지우고, 그 안의 주문은 남긴다", () => {
    const rec = db.addOrder({ customer: "buyer0001", customerName: "주문자", payment: "카드", storeId: "h1", order: { item: "옛날통닭" } });
    const keepUntil = new Date(rec.createdAt);
    keepUntil.setFullYear(keepUntil.getFullYear() + ORDER_KEEP_YEARS);
    db.purgeExpiredOrders(keepUntil.getTime()); // 딱 5년째까지는 남는다
    assert.ok(db.orderById(rec.id));
    assert.ok(db.purgeExpiredOrders(keepUntil.getTime() + 1) >= 1);
    assert.equal(db.orderById(rec.id), null);
  });

  it("관리자 비밀번호는 이메일로 바꿀 수 없다", async () => {
    db.createUser({ username: "adminmail01", passwordHash: hashPassword("password1"), name: "관리자", role: "admin", email: "adminmail@example.com" });
    const r = await call("POST", "/api/auth/reset/send-code", { email: "adminmail@example.com" }, undefined, "10.7.0.1");
    assert.equal(r.status, 400);
    assert.match(r.body.error, /가입된 이메일이 아니에요/);
  });

  it("가입 여부를 묻는 답도 IP 별 발송 횟수에 세어, 주소를 하나씩 넣어 보며 캐낼 수 없다", async () => {
    const ip = "10.8.0.1";
    let last;
    for (let i = 0; i <= 5; i++) last = await call("POST", "/api/auth/reset/send-code", { email: `probe${i}@example.com` }, undefined, ip);
    assert.equal(last.status, 429);
    assert.match(last.body.error, /너무 많이 요청/);
  });

  it("프록시 헤더(X-Forwarded-For)는 로컬·사설망에서 온 요청만 믿는다", async () => {
    const { isPrivateAddress } = await import("./app.mjs");
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.2.3.4", "172.18.0.2", "192.168.0.10"]) assert.equal(isPrivateAddress(a), true, a);
    for (const a of ["8.8.8.8", "172.32.0.1", "::ffff:203.0.113.5", "2001:db8::1", ""]) assert.equal(isPrivateAddress(a), false, a);
  });
});

describe("사장님 배달 메뉴 관리", () => {
  let owner;
  let otherOwner;
  let pending;
  before(async () => {
    owner = await signup({ role: "owner", username: "menuboss01", email: "menuboss@example.com", storeId: "p2", name: "피자 사장" });
    db.approveOwner("menuboss01");
    otherOwner = await signup({ role: "owner", username: "menuboss02", email: "menuboss2@example.com", storeId: "m1", name: "고기 사장" });
    db.approveOwner("menuboss02");
    pending = await signup({ role: "owner", username: "menuwait01", email: "menuwait@example.com", storeId: "p2", name: "대기" });
  });

  it("목록 파일의 메뉴가 DB 에 들어가 메뉴 목록으로 나온다", async () => {
    const menu = (await call("GET", "/api/menu")).body;
    assert.ok(menu.find((d) => d.id === "d1" && d.name === "옛날통닭" && d.active === true && d.source === "catalog"));
  });

  it("목록 파일에서 빠진 가게의 메뉴는 DB 에 남아 있어도 메뉴 목록과 내보내기에 나오지 않는다", async () => {
    const gone = db.addMenuItem({ restaurantId: "zz9", name: "사라진 메뉴", price: 10000, unit: "개", keywords: [] });
    assert.ok(!(await call("GET", "/api/menu")).body.some((d) => d.id === gone.id));
    assert.ok(!catalogWithMenu(db).deliveryMenu.some((d) => d.id === gone.id));
  });

  it("사장님이 메뉴를 추가하면 바로 판매되고, 매장 음식 종류가 키워드에 들어가며, 주문 금액도 그 가격으로 정해진다", async () => {
    const added = await call("POST", "/api/stores/p2/menu", { name: "불고기 피자", price: 21000, unit: "판", keywords: ["불고기", "Bulgogi Pizza"] }, owner);
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.deepEqual(added.body.keywords, ["불고기", "bulgogipizza", "피자"]);
    assert.equal(added.body.source, "owner");
    assert.ok((await call("GET", "/api/menu")).body.some((d) => d.id === added.body.id && d.active));

    const order = await call("POST", "/api/orders", { order: { ...chicken, storeId: "p2", item: "불고기 피자", qty: 2, price: 1 }, payment: "카드" }, buyer);
    assert.equal(order.status, 200, JSON.stringify(order.body));
    assert.equal(order.body.order.price, 42000);
    assert.equal(order.body.order.items[0].unit, "판");
  });

  it("입력 규칙과 권한을 서버가 검사한다", async () => {
    const add = (body, token = owner) => call("POST", "/api/stores/p2/menu", body, token);
    assert.match((await add({ name: "", price: 10000, unit: "판" })).body.error, /메뉴 이름/);
    assert.match((await add({ name: "치즈 피자", price: 50, unit: "판" })).body.error, /가격은/);
    assert.match((await add({ name: "치즈 피자", price: 10000, unit: "" })).body.error, /단위/);
    assert.match((await add({ name: "불고기 피자", price: 10000, unit: "판" })).body.error, /이미 판매 중/);
    assert.equal((await add({ name: "치즈 피자", price: 10000, unit: "판" }, otherOwner)).status, 403); // 다른 매장 사장님
    assert.match((await add({ name: "치즈 피자", price: 10000, unit: "판" }, pending)).body.error, /관리자 승인/); // 승인 전
    assert.equal((await add({ name: "치즈 피자", price: 10000, unit: "판" }, null)).status, 401);
  });

  it("판매 중지하면 주문을 받지 않고 목록에 active: false 로 남으며, 다시 판매할 수 있다", async () => {
    const item = (await call("GET", "/api/menu")).body.find((d) => d.name === "불고기 피자");
    const stop = await call("PATCH", `/api/stores/p2/menu/${item.id}`, { active: false }, owner);
    assert.equal(stop.body.active, false);
    const refused = await call("POST", "/api/orders", { order: { ...chicken, storeId: "p2", item: "불고기 피자", qty: 1 }, payment: "카드" }, buyer);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /지금 판매하지 않아요/);
    assert.equal((await call("GET", "/api/menu")).body.find((d) => d.id === item.id).active, false);

    assert.equal((await call("PATCH", `/api/stores/m1/menu/${item.id}`, { active: true }, otherOwner)).status, 404); // 다른 매장 메뉴
    assert.equal((await call("PATCH", `/api/stores/p2/menu/${item.id}`, { active: true }, owner)).body.active, true);
  });

  it("목록 파일의 메뉴도 판매 중지할 수 있고, 서버를 다시 켜도(목록 다시 채우기) 그대로 유지된다", async () => {
    assert.equal((await call("PATCH", "/api/stores/h1/menu/d1", { active: false }, null)).status, 401);
    db.seedMenu([{ id: "d1", restaurantId: "h1", name: "옛날통닭", price: 18000, unit: "마리", keywords: [] }]);
    db.updateMenuItem("d1", { active: false });
    db.seedMenu([{ id: "d1", restaurantId: "h1", name: "옛날통닭", price: 18000, unit: "마리", keywords: [] }]); // 이미 있으면 건드리지 않는다
    assert.equal(db.menuItem("d1").active, false);
    db.updateMenuItem("d1", { active: true });
  });

  it("DB 의 지금 목록을 catalog.json 모양으로 내보낸다 (바꾼 가격·추가 메뉴·판매 중지 포함)", async () => {
    const { catalogWithMenu } = await import("./stores.mjs");
    db.updateStoreSettings("p2", { item: { id: (await call("GET", "/api/menu")).body.find((d) => d.name === "불고기 피자").id, patch: { price: 23000 } } });
    const exported = catalogWithMenu(db);
    assert.ok(exported.restaurants.length > 0 && exported.foods.length > 0);
    const bulgogi = exported.deliveryMenu.find((d) => d.name === "불고기 피자");
    assert.equal(bulgogi.price, 23000);
    assert.equal(bulgogi.active, undefined); // 판매 중이면 적지 않는다
    assert.equal(bulgogi.source, undefined); // 파일에는 출처를 남기지 않는다
  });
});

describe("할인과 오늘의 메뉴", () => {
  let owner;
  before(async () => {
    owner = await signup({ role: "owner", username: "dealboss01", email: "dealboss@example.com", storeId: "s1", name: "떡볶이 사장" });
    db.approveOwner("dealboss01");
  });
  const order = (qty = 2) => call("POST", "/api/orders", { order: { ...chicken, storeId: "s1", item: "국물떡볶이", qty, price: 1 }, payment: "카드" }, buyer);

  it("할인율을 넣으면 주문 금액을 서버가 할인 가격으로 다시 계산한다 (10원 단위 반올림)", async () => {
    const set = await call("PATCH", "/api/stores/s1/settings", { item: { id: "d4", patch: { discountPct: 15 } } }, owner);
    assert.equal(set.body.items.d4.discountPct, 15);
    const o = (await order(2)).body; // 6000원 × 0.85 = 5100원
    assert.equal(o.order.price, 10200);
    assert.equal(o.order.items[0].discountPct, 15);
    assert.equal(o.order.listPrice, 12000);

    // 사장님이 바꾼 가격에 할인을 적용한다: 6,500원 × 0.85 = 5,525 → 5,530원
    await call("PATCH", "/api/stores/s1/settings", { item: { id: "d4", patch: { price: 6500 } } }, owner);
    assert.equal((await order(1)).body.order.price, 5530);

    // 0% 는 할인 끔: 기록에서도 빠진다
    const off = await call("PATCH", "/api/stores/s1/settings", { item: { id: "d4", patch: { discountPct: 0 } } }, owner);
    assert.equal(off.body.items.d4.discountPct, undefined);
    const plain = (await order(1)).body.order;
    assert.equal(plain.price, 6500);
    assert.equal(plain.items[0].discountPct, undefined);
    assert.equal(plain.listPrice, undefined);
  });

  it("할인율은 0~90% 정수만 받는다", async () => {
    for (const bad of [-5, 91, 12.5, "abc"]) {
      const r = await call("PATCH", "/api/stores/s1/settings", { item: { id: "d4", patch: { discountPct: bad } } }, owner);
      assert.equal(r.status, 400, String(bad));
      assert.match(r.body.error, /할인율은/);
    }
  });

  it("오늘의 메뉴는 이 매장에서 판매 중인 메뉴로만 고르고, 서버가 한국 날짜를 붙이며, null 로 해제한다", async () => {
    const { todayKST } = await import("./stores.mjs");
    const set = await call("PATCH", "/api/stores/s1/settings", { special: { itemId: "d4" } }, owner);
    assert.deepEqual(set.body.special, { itemId: "d4", date: todayKST() });
    assert.deepEqual((await call("GET", "/api/stores/settings")).body.s1.special, { itemId: "d4", date: todayKST() });

    assert.match((await call("PATCH", "/api/stores/s1/settings", { special: { itemId: "d1" } }, owner)).body.error, /이 매장에서 판매 중인/); // 다른 매장 메뉴
    db.updateMenuItem("d4", { active: false });
    assert.equal((await call("PATCH", "/api/stores/s1/settings", { special: { itemId: "d4" } }, owner)).status, 400); // 판매 중지한 메뉴
    db.updateMenuItem("d4", { active: true });

    // 다른 설정을 바꿔도 오늘의 메뉴는 그대로
    await call("PATCH", "/api/stores/s1/settings", { hours: "10:00 - 21:00" }, owner);
    assert.equal((await call("GET", "/api/stores/settings")).body.s1.special.itemId, "d4");

    const cleared = await call("PATCH", "/api/stores/s1/settings", { special: null }, owner);
    assert.equal(cleared.body.special, undefined);
  });

  it("한국 날짜는 시간대와 상관없이 서울 기준이다", async () => {
    const { todayKST, discountedPrice } = await import("./stores.mjs");
    assert.equal(todayKST(new Date("2026-10-11T15:30:00Z")), "2026-10-12"); // 서울은 이미 다음 날 00:30
    assert.equal(todayKST(new Date("2026-10-11T14:59:00Z")), "2026-10-11");
    assert.equal(discountedPrice(19000, 0), 19000);
    assert.equal(discountedPrice(19000, 10), 17100);
    assert.equal(discountedPrice(18000, 33), 12060);
  });
});

describe("점검에서 찾은 사장님·관리자 화면 문제", () => {
  let owner;
  before(async () => {
    owner = await signup({ role: "owner", username: "checkboss01", email: "checkboss@example.com", storeId: "m2", name: "한우 사장" });
    db.approveOwner("checkboss01");
  });

  it("사장님이 추가한 메뉴(긴 id)의 품절·가격·할인 설정이 저장되고 주문 금액에 쓰인다", async () => {
    const added = (await call("POST", "/api/stores/m2/menu", { name: "한우 불고기", price: 30000, unit: "인분" }, owner)).body;
    assert.ok(added.id.length > 10);
    const set = await call("PATCH", "/api/stores/m2/settings", { item: { id: added.id, patch: { price: 28000, discountPct: 10 } } }, owner);
    assert.deepEqual(set.body.items[added.id], { price: 28000, discountPct: 10 });
    const o = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "m2", item: "한우 불고기", qty: 1 }, payment: "카드" }, buyer)).body;
    assert.equal(o.order.price, 25200);
    await call("PATCH", "/api/stores/m2/settings", { item: { id: added.id, patch: { soldOut: true } } }, owner);
    assert.match((await call("POST", "/api/orders", { order: { ...chicken, storeId: "m2", item: "한우 불고기", qty: 1 }, payment: "카드" }, buyer)).body.error, /품절/);
    // 다른 매장의 메뉴 id 로는 설정할 수 없다
    assert.match((await call("PATCH", "/api/stores/m2/settings", { item: { id: "d2", patch: { soldOut: true } } }, owner)).body.error, /메뉴를 알 수 없어요/);
  });

  it("주문·예약 상태는 정해진 순서로만 바뀌고, 방문 완료는 방문일부터 할 수 있다", async () => {
    const o = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "m2", item: "한우 불고기", qty: 1 }, payment: "카드" }, buyer)).body;
    await call("PATCH", "/api/stores/m2/settings", { item: { id: (await call("GET", "/api/menu")).body.find((d) => d.name === "한우 불고기").id, patch: { soldOut: false } } }, owner);
    const o2 = (await call("POST", "/api/orders", { order: { ...chicken, storeId: "m2", item: "한우 불고기", qty: 1 }, payment: "카드" }, buyer)).body;
    assert.equal((await call("PATCH", `/api/orders/${o2.id}`, { status: "완료" }, owner)).status, 409); // 입금 대기 → 완료 건너뛰기
    assert.equal((await call("PATCH", `/api/orders/${o2.id}`, { status: "접수" }, owner)).status, 200); // 입금 확인
    assert.equal((await call("PATCH", `/api/orders/${o2.id}`, { status: "입금 대기" }, owner)).status, 409); // 되돌리기
    assert.equal((await call("PATCH", `/api/orders/${o2.id}`, { status: "준비 중" }, owner)).status, 200);
    assert.equal((await call("PATCH", `/api/orders/${o2.id}`, { status: "접수" }, owner)).status, 409); // 되돌리기
    assert.equal((await call("PATCH", `/api/orders/${o2.id}`, { status: "완료" }, owner)).status, 200);
    assert.equal((await call("PATCH", `/api/orders/${o2.id}`, { status: "취소" }, owner)).status, 409); // 끝난 주문
    void o;

    const future = (await call("POST", "/api/reservations", { restaurantId: "m2", restaurantName: "하소 한우마을", date: "2099-01-01", time: "19:00", people: 2 })).body;
    const r = await call("PATCH", `/api/reservations/${future.id}`, { status: "방문 완료" }, owner);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /방문일이 되기 전/);
    assert.equal((await call("PATCH", `/api/reservations/${future.id}`, { status: "취소" }, owner)).status, 200);
    assert.equal((await call("PATCH", `/api/reservations/${future.id}`, { status: "예약 확정" }, owner)).status, 409);
  });

  it("영업시간은 00:00~24:00 안이어야 하고 여는 시간과 닫는 시간이 같을 수 없다", async () => {
    for (const bad of ["25:00 - 99:99", "11:60 - 20:00", "24:30 - 01:00", "11:00 - 11:00", "11:00-20:00"]) {
      assert.equal((await call("PATCH", "/api/stores/m2/settings", { hours: bad }, owner)).status, 400, bad);
    }
    for (const ok of ["11:00 - 24:00", "16:00 - 01:00", "00:00 - 23:59"]) {
      assert.equal((await call("PATCH", "/api/stores/m2/settings", { hours: ok }, owner)).status, 200, ok);
    }
  });

  it("오늘의 메뉴를 판매 중지하면 오늘의 메뉴도 풀린다", async () => {
    const item = (await call("GET", "/api/menu")).body.find((d) => d.name === "한우 불고기");
    await call("PATCH", "/api/stores/m2/settings", { special: { itemId: item.id } }, owner);
    assert.equal((await call("GET", "/api/stores/settings")).body.m2.special.itemId, item.id);
    await call("PATCH", `/api/stores/m2/menu/${item.id}`, { active: false }, owner);
    assert.equal((await call("GET", "/api/stores/settings")).body.m2.special, undefined);
  });
});

describe("계정 관리: 연락처·배달지", () => {
  it("고객님은 연락처와 배달지를 바꾸고, 세션에 바로 반영된다", async () => {
    const token = await signup({ username: "contact001", email: "contact1@example.com" });
    assert.equal((await call("GET", "/api/auth/me", undefined, token)).body.session.address, undefined);

    const r = await call("PATCH", "/api/auth/contact", { address: "  제천시   장락동 제천빌라 331호 " }, token);
    assert.equal(r.status, 200);
    assert.equal(r.body.session.address, "제천시 장락동 제천빌라 331호");
    assert.equal(r.body.session.phone, "010-1234-5678"); // 넘기지 않은 칸은 그대로

    const p = await call("PATCH", "/api/auth/contact", { phone: "01098765432" }, token);
    assert.equal(p.body.session.phone, "010-9876-5432");
    assert.equal(p.body.session.address, "제천시 장락동 제천빌라 331호");
    assert.deepEqual((await call("GET", "/api/auth/me", undefined, token)).body.session, p.body.session);

    assert.match((await call("PATCH", "/api/auth/contact", { address: "제천" }, token)).body.error, /자세히/);
    assert.match((await call("PATCH", "/api/auth/contact", { phone: "12345" }, token)).body.error, /전화번호/);
  });

  it("사장님은 연락처만, 관리자와 비로그인은 바꿀 수 없다", async () => {
    const owner = await signup({ role: "owner", username: "contactboss", email: "contactboss@example.com", storeId: "k1" });
    assert.equal((await call("PATCH", "/api/auth/contact", { phone: "010-5555-6666" }, owner)).body.session.phone, "010-5555-6666");
    assert.equal((await call("PATCH", "/api/auth/contact", { address: "제천시 장락동 1번지" }, owner)).status, 403);
    assert.equal((await call("PATCH", "/api/auth/contact", { phone: "010-5555-6666" })).status, 401);
    db.createUser({ username: "contactadmin", passwordHash: hashPassword("password1"), name: "관리자", role: "admin" });
    const admin = (await call("POST", "/api/auth/login", { username: "contactadmin", password: "password1" })).body.token;
    assert.equal((await call("PATCH", "/api/auth/contact", { phone: "010-5555-6666" }, admin)).status, 403);
    // 관리자 고객 목록에는 배달지를 싣지 않는다
    const users = (await call("GET", "/api/users", undefined, admin)).body;
    const c = users.find((u) => u.username === "contact001");
    assert.equal(c.phone, "010-9876-5432");
    assert.equal("address" in c, false);
  });
});

describe("매장 일시 중지", () => {
  it("사장님이 고른 시각까지 새 배달 주문과 오늘 예약을 받지 않고, 그 시각이 지나면 저절로 다시 받는다", async () => {
    const owner = await signup({ role: "owner", username: "pauseboss1", email: "pauseboss@example.com", storeId: "h1", name: "통닭 사장" });
    db.approveOwner("pauseboss1");
    const tongdak = { ...chicken, storeId: "h1", store: { name: "장락 옛날통닭" }, item: "옛날통닭", qty: 1 };
    const until = clock + 30 * 60_000;

    const r = await call("PATCH", "/api/stores/h1/settings", { pause: { until } }, owner);
    assert.equal(r.status, 200);
    assert.equal(r.body.pausedUntil, until);
    assert.equal((await call("GET", "/api/stores/settings")).body.h1.pausedUntil, until);

    const refused = await call("POST", "/api/orders", { order: tongdak, payment: "카드" }, buyer);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /^장락 옛날통닭은 지금 잠시 주문을 받지 않아요\. (내일 )?\d{2}:\d{2}부터 다시 받아요\.$/);
    // 다른 매장은 그대로 받는다
    assert.equal((await call("POST", "/api/orders", { order: { ...chicken, storeId: "s1", item: "국물떡볶이", qty: 1 }, payment: "카드" }, buyer)).status, 200);

    // 오늘 예약만 막고, 내일 예약은 받는다
    const rsv = { restaurantId: "h1", restaurantName: "장락 옛날통닭", time: "19:00", people: 2 };
    const today = await call("POST", "/api/reservations", { ...rsv, date: todayKST(new Date(clock)) });
    assert.equal(today.status, 400);
    assert.match(today.body.error, /오늘 예약은 잠시 받지 않아요/);
    assert.equal((await call("POST", "/api/reservations", { ...rsv, date: todayKST(new Date(clock + 24 * 60 * 60_000)) })).status, 200);

    // 정한 시각이 지나면 화면에도 안 보내고 주문도 받는다
    // 끝나는 때가 내일이면 "내일 09:00"처럼 알린다 (한국 날짜 기준)
    assert.equal(pauseEndText(Date.parse("2026-10-13T00:00:00Z"), Date.parse("2026-10-12T14:00:00Z")), "내일 09:00");
    assert.equal(pauseEndText(Date.parse("2026-10-12T14:30:00Z"), Date.parse("2026-10-12T14:00:00Z")), "23:30"); // 같은 한국 날짜(10/12 23:30)
    assert.equal(withTopic("장락 떡볶이"), "장락 떡볶이는");
    clock = until + 1;
    assert.equal("pausedUntil" in (await call("GET", "/api/stores/settings")).body.h1, false);
    assert.equal((await call("POST", "/api/orders", { order: tongdak, payment: "카드" }, buyer)).status, 200);
  });

  it("바로 다시 받기(null), 시각 검사, 권한", async () => {
    const owner = (await call("POST", "/api/auth/login", { username: "pauseboss1", password: "password1" })).body.token;
    await call("PATCH", "/api/stores/h1/settings", { pause: { until: clock + 60 * 60_000 } }, owner);
    const resumed = await call("PATCH", "/api/stores/h1/settings", { pause: null }, owner);
    assert.equal(resumed.status, 200);
    assert.equal("pausedUntil" in resumed.body, false);

    for (const [until, why] of [[clock - 1, /시작 시간보다 뒤/], [clock + 25 * 60 * 60_000, /24시간 안/], ["내일", /24시간 안/], [null, /시작 시간보다 뒤/]]) {
      const r = await call("PATCH", "/api/stores/h1/settings", { pause: { until } }, owner);
      assert.equal(r.status, 400, String(until));
      assert.match(r.body.error, why);
    }
    // 시작이 끝보다 늦으면 거절
    const backwards = await call("PATCH", "/api/stores/h1/settings", { pause: { from: clock + 60 * 60_000, until: clock + 30 * 60_000 } }, owner);
    assert.equal(backwards.status, 400);
    assert.match(backwards.body.error, /종료 시간은 시작 시간보다 뒤여야 해요/);
    // 다른 매장 사장님·비로그인은 바꿀 수 없다
    assert.equal((await call("PATCH", "/api/stores/s1/settings", { pause: { until: clock + 60_000 } }, owner)).status, 403);
    assert.equal((await call("PATCH", "/api/stores/h1/settings", { pause: { until: clock + 60_000 } })).status, 401);
  });
});

describe("매장 일시 중지: 미리 정해 두기", () => {
  it("시작 시각을 정하면 그 전까지는 받고, 그 사이에는 막고, 끝나면 다시 받는다", async () => {
    const owner = (await call("POST", "/api/auth/login", { username: "pauseboss1", password: "password1" })).body.token;
    const tongdak = { ...chicken, storeId: "h1", store: { name: "장락 옛날통닭" }, item: "옛날통닭", qty: 1 };
    const from = clock + 10 * 60_000;
    const until = clock + 40 * 60_000;
    const r = await call("PATCH", "/api/stores/h1/settings", { pause: { from, until } }, owner);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.pausedFrom, r.body.pausedUntil], [from, until]);
    // 시작 전: 화면에는 예정으로 보이고, 주문은 받는다
    assert.equal((await call("GET", "/api/stores/settings")).body.h1.pausedFrom, from);
    assert.equal((await call("POST", "/api/orders", { order: tongdak, payment: "카드" }, buyer)).status, 200);
    // 시작한 뒤: 막는다
    clock = from + 1;
    const refused = await call("POST", "/api/orders", { order: tongdak, payment: "카드" }, buyer);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /잠시 주문을 받지 않아요/);
    // 끝난 뒤: 다시 받고, 화면에도 안 보낸다
    clock = until + 1;
    assert.equal((await call("POST", "/api/orders", { order: tongdak, payment: "카드" }, buyer)).status, 200);
    const s = (await call("GET", "/api/stores/settings")).body.h1;
    assert.equal("pausedFrom" in s || "pausedUntil" in s, false);
  });

  it("시작 시각이 이미 지났으면 지금부터 멈춘다", async () => {
    const owner = (await call("POST", "/api/auth/login", { username: "pauseboss1", password: "password1" })).body.token;
    const r = await call("PATCH", "/api/stores/h1/settings", { pause: { from: clock - 60 * 60_000, until: clock + 60 * 60_000 } }, owner);
    assert.equal(r.status, 200);
    assert.equal(r.body.pausedFrom, clock); // 지난 시작 시각은 지금으로 맞춘다
    await call("PATCH", "/api/stores/h1/settings", { pause: null }, owner);
  });
});
describe("관리자가 새 매장을 직접 입력해 사장님 계정 만들기", () => {
  let admin;
  before(async () => {
    db.createUser({ username: "storeadmin1", passwordHash: hashPassword("password1"), name: "관리자", role: "admin" });
    admin = (await call("POST", "/api/auth/login", { username: "storeadmin1", password: "password1" })).body.token;
  });
  const newOwner = (username, newStore, extra = {}) => call("POST", "/api/owners", { username, password: "password1", phone: "043-123-4567", newStore, ...extra }, admin);

  it("새 매장을 만들고 그 매장 사장님 계정을 만든다. 매장 목록과 메뉴·주문·계좌에 그대로 쓰인다", async () => {
    // 보낸 사장님 이름과 대표 메뉴는 쓰지 않는다 (이름은 매장 이름으로 정하고, 대표 메뉴는 받지 않는다)
    const made = await newOwner("newstore01", { name: "  하소   닭강정  ", food: "chicken", address: "제천시 하소동 1-2", signature: "순살" }, { name: "다른 이름" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal(made.body.name, "하소 닭강정 사장님"); // 사장님 이름은 "매장 이름 사장님" (보낸 이름은 쓰지 않는다)
    const storeId = made.body.storeId;
    assert.match(storeId, /^s/);

    const store = (await call("GET", "/api/stores")).body.find((s) => s.id === storeId);
    assert.deepEqual(store, { id: storeId, name: "하소 닭강정", food: "chicken", hours: "11:00 - 21:00", address: "제천시 하소동 1-2", source: "admin" });
    // 목록 파일의 매장도 그대로 나온다
    assert.ok((await call("GET", "/api/stores")).body.some((s) => s.id === "h3" && !s.source));

    const owner = (await call("POST", "/api/auth/login", { username: "newstore01", password: "password1" })).body.token;
    const item = await call("POST", `/api/stores/${storeId}/menu`, { name: "순살 닭강정", price: 18000, unit: "마리" }, owner);
    assert.equal(item.status, 200, JSON.stringify(item.body));
    assert.ok(item.body.keywords.includes("치킨")); // 음식 종류 이름이 키워드로 들어간다
    assert.ok((await call("GET", "/api/menu")).body.some((d) => d.id === item.body.id));
    assert.equal((await call("PUT", `/api/stores/${storeId}/bank`, { bank: "국민은행", account: "123456-01-234567", holder: "김사장" }, owner)).status, 200);
    const order = await call("POST", "/api/orders", { order: { ...chicken, storeId, item: "순살 닭강정", qty: 1 } }, buyer);
    assert.equal(order.status, 200, JSON.stringify(order.body));
    assert.equal(order.body.order.store.name, "하소 닭강정");
    // 계정을 만들 때 넣은 전화번호가 매장 전화번호로 주문에 실린다 (손님이 가게에 전화할 수 있게)
    assert.equal(order.body.order.storePhone, "043-123-4567");
    assert.equal((await call("GET", "/api/owners", undefined, admin)).body.find((o) => o.username === "newstore01").phone, "043-123-4567");
    // 사장님이 계정 관리에서 번호를 바꾸면 다음 주문부터 바뀐 번호가 실린다 (이미 받은 주문은 그대로)
    assert.equal((await call("PATCH", "/api/auth/contact", { phone: "01098765432" }, owner)).status, 200);
    const next = await call("POST", "/api/orders", { order: { ...chicken, storeId, item: "순살 닭강정", qty: 1 } }, buyer);
    assert.equal(next.body.order.storePhone, "010-9876-5432");
    assert.equal((await call("GET", "/api/orders", undefined, buyer)).body.find((r) => r.id === order.body.id).order.storePhone, "043-123-4567");
    const rsv = await call("POST", "/api/reservations", { restaurantId: storeId, restaurantName: "가짜 이름", date: "2026-12-01", time: "18:00", people: 2 });
    assert.equal(rsv.body.restaurantName, "하소 닭강정"); // 매장 이름은 서버가 정한다
    // 내보낸 목록에도 관리자가 만든 매장이 들어간다 (source 는 빼고)
    assert.deepEqual(catalogWithMenu(db).restaurants.find((r) => r.id === storeId), { id: storeId, name: "하소 닭강정", food: "chicken", hours: "11:00 - 21:00", address: "제천시 하소동 1-2" });
  });

  it("매장 입력이 맞지 않으면 거절하고, 매장도 계정도 만들지 않는다", async () => {
    const before = (await call("GET", "/api/stores")).body.length;
    assert.match((await newOwner("newstore02", { name: "", food: "chicken" })).body.error, /매장 이름/);
    assert.match((await newOwner("newstore02", { name: "새 가게", food: "nope" })).body.error, /음식 종류/);
    assert.match((await newOwner("newstore02", { name: "새 가게", food: "korean", hours: "10:00 - 10:00" })).body.error, /같을 수 없어요/);
    // 이미 있는 이름 (띄어쓰기·대소문자 차이도 같은 이름)
    assert.match((await newOwner("newstore02", { name: "청전치킨공방", food: "chicken" })).body.error, /같은 이름의 매장/);
    // 아이디가 이미 있으면 매장을 만들지 않는다
    assert.match((await newOwner("newstore01", { name: "새 가게", food: "korean" })).body.error, /이미 있는 아이디/);
    assert.match((await newOwner("bad", { name: "새 가게", food: "korean" })).body.error, /6~20자/);
    // 매장 전화번호는 꼭 받고, 번호 모양이 아니면 거절한다
    assert.match((await newOwner("newstore02", { name: "새 가게", food: "korean" }, { phone: undefined })).body.error, /매장 전화번호/);
    assert.match((await newOwner("newstore02", { name: "새 가게", food: "korean" }, { phone: "12345" })).body.error, /010-1234-5678/);
    assert.equal((await call("GET", "/api/stores")).body.length, before);
    assert.equal(db.findUser("newstore02"), null);
  });

  it("관리자만 새 매장을 만들 수 있다", async () => {
    const owner = (await call("POST", "/api/auth/login", { username: "newstore01", password: "password1" })).body.token;
    assert.equal((await call("POST", "/api/owners", { username: "newstore03", password: "password1", newStore: { name: "몰래 가게", food: "korean" } }, owner)).status, 403);
    assert.equal((await call("POST", "/api/owners", { username: "newstore03", password: "password1", newStore: { name: "몰래 가게", food: "korean" } })).status, 401);
    assert.ok(!(await call("GET", "/api/stores")).body.some((s) => s.name === "몰래 가게"));
  });
});

describe("아이디·비밀번호 최소 길이 6자", () => {
  it("6자 아이디·6자 비밀번호로 계정을 만들고 로그인할 수 있고, 5자는 거절한다", async () => {
    db.createUser({ username: "sixadmin1", passwordHash: hashPassword("password1"), name: "관리자", role: "admin" });
    const admin = (await call("POST", "/api/auth/login", { username: "sixadmin1", password: "password1" })).body.token;
    const make = (username, password, name) => call("POST", "/api/owners", { username, password, phone: "010-1111-2222", newStore: { name, food: "korean" } }, admin);
    assert.match((await make("abc12", "pass12", "다섯자 가게")).body.error, /6~20자/);
    assert.match((await make("abc123", "pass1", "다섯자 가게")).body.error, /6자 이상/);
    const ok = await make("abc123", "pass12", "여섯자 가게");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const login = await call("POST", "/api/auth/login", { username: "abc123", password: "pass12" });
    assert.equal(login.status, 200);
    assert.equal(login.body.session.name, "여섯자 가게 사장님");
  });
});

describe("세트 메뉴 맛 고르기 주문", () => {
  let storeId;
  before(() => {
    storeId = db.addStore({ name: "맛 고르기 파닭", food: "chicken", hours: "00:00 - 24:00" }).id;
    db.setBankAccount(storeId, { bank: "국민은행", account: "123456-01-234567", holder: "김사장" });
    db.addMenuItem({
      restaurantId: storeId, name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["세트"],
      choice: { label: "맛", count: 2, options: [{ name: "간장 파닭", extra: 0 }, { name: "양념 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }, { name: "굽는 불닭", extra: 2000 }] },
    });
  });
  const order = (qty, choices) => call("POST", "/api/orders", { order: { ...chicken, storeId, item: "2마리 치킨 세트", qty, choices } }, buyer);

  it("마리 수만큼 서로 다른 맛을 고르면 주문되고, 맛 추가금을 세트 값에 더한다", async () => {
    const plain = await order(1, ["간장 파닭", "양념 파닭"]);
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
    assert.equal(plain.body.order.price, 26000);
    assert.deepEqual(plain.body.order.items[0].choices, [{ name: "간장 파닭", extra: 0 }, { name: "양념 파닭", extra: 0 }]);
    assert.equal(plain.body.order.items[0].choiceLabel, "맛");

    const extra = await order(1, ["블랙스완 파닭", "굽는 불닭"]);
    assert.equal(extra.body.order.price, 29000); // 26,000 + 1,000 + 2,000
    // 2세트면 서로 다른 맛 4가지
    const two = await order(2, ["간장 파닭", "양념 파닭", "블랙스완 파닭", "굽는 불닭"]);
    assert.equal(two.body.order.price, 55000); // 26,000 × 2 + 3,000
  });

  it("맛 수가 맞지 않거나, 같은 맛을 또 고르거나, 없는 맛이면 거절한다", async () => {
    assert.match((await order(1, ["간장 파닭"])).body.error, /맛을\(를\) 2가지 골라/);
    assert.match((await order(1)).body.error, /2가지 골라/);
    assert.match((await order(1, ["간장 파닭", "간장 파닭"])).body.error, /한 번만/);
    assert.match((await order(1, ["간장 파닭", "수원왕갈비 파닭"])).body.error, /고를 수 없는/);
    assert.match((await order(2, ["간장 파닭", "양념 파닭"])).body.error, /4가지 골라/);
  });

  it("맛 고르기가 없는 메뉴는 보낸 맛을 무시한다", async () => {
    const r = await call("POST", "/api/orders", { order: { ...chicken, storeId: "h1", item: "옛날통닭", qty: 1, choices: ["간장 파닭"] } }, buyer);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.order.items[0].choices, undefined);
  });
});

describe("사장님이 세트 메뉴의 맛 목록을 넣고 고치기", () => {
  let storeId;
  let owner;
  let otherOwner;
  const FLAVORS = { label: "맛", count: 2, options: [{ name: " 간장  파닭 ", extra: 0 }, { name: "양념 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }] };
  before(async () => {
    storeId = db.addStore({ name: "맛 목록 파닭", food: "chicken", hours: "00:00 - 24:00" }).id;
    db.setBankAccount(storeId, { bank: "국민은행", account: "123456-01-234567", holder: "김사장" });
    owner = await signup({ role: "owner", username: "flavorboss1", email: "flavorboss1@example.com", storeId, name: "맛 사장" });
    db.approveOwner("flavorboss1");
    otherOwner = await signup({ role: "owner", username: "flavorboss2", email: "flavorboss2@example.com", storeId: "p2", name: "피자 사장" });
    db.approveOwner("flavorboss2");
  });
  const add = (body, token = owner) => call("POST", `/api/stores/${storeId}/menu`, body, token);
  const patchMenu = (id, body, token = owner) => call("PATCH", `/api/stores/${storeId}/menu/${id}`, body, token);

  it("메뉴를 추가할 때 맛 목록을 같이 넣으면 정리해 저장하고, 챗봇 메뉴 목록에 나온다", async () => {
    const r = await add({ name: "2마리 세트", price: 26000, unit: "세트", choice: FLAVORS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.choice, { label: "맛", count: 2, options: [{ name: "간장 파닭", extra: 0 }, { name: "양념 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }] });
    assert.deepEqual((await call("GET", "/api/menu")).body.find((d) => d.id === r.body.id).choice, r.body.choice);
    // 맛 목록을 비워 보내면(null) 보통 메뉴
    const plain = await add({ name: "치킨무", price: 500, unit: "개", choice: null });
    assert.equal(plain.body.choice, undefined);
  });

  it("맛 목록이 규칙에 맞지 않으면 한국어로 거절하고 메뉴를 만들지 않는다", async () => {
    const tries = [
      [{ ...FLAVORS, count: 0 }, /1세트에 고를 수는 1~10/],
      [{ ...FLAVORS, count: 4 }, /맛을 고를 수\(4가지\)만큼은/],
      [{ ...FLAVORS, options: [{ name: "간장", extra: 0 }, { name: "", extra: 0 }] }, /맛 이름을 1~30자/],
      [{ ...FLAVORS, options: [{ name: "간장", extra: 0 }, { name: "간장", extra: 500 }] }, /같은 맛 이름이 두 번/],
      [{ ...FLAVORS, options: [{ name: "간장", extra: 0 }, { name: "양념", extra: -100 }] }, /추가금은 0~100,000원/],
      [{ ...FLAVORS, options: Array.from({ length: 41 }, (_, i) => ({ name: `맛${i}`, extra: 0 })) }, /맛은 40가지까지/],
      [{ ...FLAVORS, label: "아주아주긴고르기이름이에요" }, /고르기 이름은 10자까지/],
    ];
    for (const [choice, error] of tries) {
      const r = await add({ name: "잘못된 세트", price: 26000, unit: "세트", choice });
      assert.equal(r.status, 400);
      assert.match(r.body.error, error);
    }
    assert.ok(!(await call("GET", "/api/menu")).body.some((d) => d.name === "잘못된 세트"));
  });

  it("판매 중인 메뉴의 맛 목록을 고치거나 없애도, 지난 주문에 남은 고른 맛은 그대로다", async () => {
    const set = (await call("GET", "/api/menu")).body.find((d) => d.restaurantId === storeId && d.name === "2마리 세트");
    const ordered = await call("POST", "/api/orders", { order: { ...chicken, storeId, item: "2마리 세트", qty: 1, choices: ["간장 파닭", "블랙스완 파닭"] } }, buyer);
    assert.equal(ordered.status, 200, JSON.stringify(ordered.body));

    // 블랙스완을 빼고 추가금이 있는 새 맛을 넣고, 3가지 고르기로
    const changed = await patchMenu(set.id, { choice: { label: "맛", count: 3, options: [{ name: "간장 파닭", extra: 0 }, { name: "양념 파닭", extra: 0 }, { name: "굽는 불닭", extra: 2000 }] } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.choice.count, 3);
    assert.equal(changed.body.active, true); // 판매 여부는 그대로
    // 새 목록대로 주문을 받는다 (뺀 맛은 고를 수 없다)
    assert.match((await call("POST", "/api/orders", { order: { ...chicken, storeId, item: "2마리 세트", qty: 1, choices: ["간장 파닭", "양념 파닭", "블랙스완 파닭"] } }, buyer)).body.error, /고를 수 없는 맛/);
    const fresh = await call("POST", "/api/orders", { order: { ...chicken, storeId, item: "2마리 세트", qty: 1, choices: ["간장 파닭", "양념 파닭", "굽는 불닭"] } }, buyer);
    assert.equal(fresh.body.order.price, 28000);

    // 맛 고르기를 없애면 보통 메뉴로 팔린다
    const removed = await patchMenu(set.id, { choice: null });
    assert.equal(removed.body.choice, undefined);
    const plain = await call("POST", "/api/orders", { order: { ...chicken, storeId, item: "2마리 세트", qty: 1 } }, buyer);
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
    assert.equal(plain.body.order.items[0].choices, undefined);

    // 지난 주문 기록은 주문할 때의 맛·추가금 그대로
    const old = db.orderById(ordered.body.id);
    assert.deepEqual(old.order.items[0].choices, [{ name: "간장 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }]);
    assert.equal(old.order.price, 27000);
  });

  it("DB 목록을 catalog.json 모양으로 내보낼 때 맛 목록도 같이 나간다", async () => {
    const set = (await call("GET", "/api/menu")).body.find((d) => d.restaurantId === storeId && d.name === "2마리 세트");
    await patchMenu(set.id, { choice: FLAVORS });
    assert.equal(catalogWithMenu(db).deliveryMenu.find((d) => d.id === set.id).choice.options.length, 3);
    await patchMenu(set.id, { choice: null });
    assert.equal(catalogWithMenu(db).deliveryMenu.find((d) => d.id === set.id).choice, undefined);
  });

  it("맛 목록 고치기도 규칙과 권한을 검사한다", async () => {
    const set = (await call("GET", "/api/menu")).body.find((d) => d.restaurantId === storeId && d.name === "2마리 세트");
    assert.match((await patchMenu(set.id, { choice: { ...FLAVORS, count: 5 } })).body.error, /고를 수\(5가지\)만큼은/);
    assert.equal((await call("GET", "/api/menu")).body.find((d) => d.id === set.id).choice, undefined); // 거절하면 그대로
    assert.match((await patchMenu(set.id, {})).body.error, /바꿀 내용/);
    assert.equal((await patchMenu(set.id, { choice: FLAVORS }, otherOwner)).status, 403); // 다른 매장 사장님
    assert.equal((await patchMenu(set.id, { choice: FLAVORS }, null)).status, 401);
  });
});

describe("관리자에게 문의", () => {
  let customer, owner, admin;
  before(async () => {
    customer = await signup({ username: "asker0001", email: "asker@example.com", name: "문의 고객" });
    db.createUser({ username: "askowner1", passwordHash: hashPassword("password1"), name: "문의 사장님", role: "owner", storeId: "h3" });
    owner = (await call("POST", "/api/auth/login", { username: "askowner1", password: "password1" })).body.token;
    db.createUser({ username: "askadmin1", passwordHash: hashPassword("password1"), name: "관리자", role: "admin" });
    admin = (await call("POST", "/api/auth/login", { username: "askadmin1", password: "password1" })).body.token;
  });
  const ask = (token, body) => call("POST", "/api/inquiries", body, token);

  it("고객님·사장님이 보낸 문의는 자기 것만 보이고, 관리자는 전부 보며 새 문의 알림 메일을 받는다", async () => {
    notices.length = 0;
    const mine = await ask(customer, { category: "결제·환불", body: "  입금했는데 아직 입금 대기로 나와요.  " });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.deepEqual({ ...mine.body, id: undefined, createdAt: undefined }, { id: undefined, createdAt: undefined, username: "asker0001", role: "user", name: "문의 고객", category: "결제·환불", body: "입금했는데 아직 입금 대기로 나와요." });
    const fromOwner = await ask(owner, { category: "가게·메뉴", body: "메뉴 사진을 넣고 싶어요." });
    assert.equal(fromOwner.body.storeId, "h3");

    assert.deepEqual((await call("GET", "/api/inquiries", undefined, customer)).body.map((q) => q.id), [mine.body.id]);
    assert.deepEqual((await call("GET", "/api/inquiries", undefined, owner)).body.map((q) => q.id), [fromOwner.body.id]);
    const all = (await call("GET", "/api/inquiries", undefined, admin)).body.map((q) => q.id);
    assert.ok(all.includes(mine.body.id) && all.includes(fromOwner.body.id));

    await new Promise((r) => setImmediate(r)); // 알림은 기다리지 않고 보낸다
    assert.equal(notices.length, 2);
    assert.equal(notices[0].email, "operator@example.com");
    assert.match(notices[0].text, /문의 고객 고객님 · 결제·환불/);
    assert.match(notices[1].text, /^문의 사장님 \(.+\) · 가게·메뉴/); // 사장님은 매장 이름을 붙인다
  });

  it("관리자가 답하면 문의한 분이 답을 보고, 이메일이 있으면 알림 메일을 받는다. 다시 쓰면 고친다", async () => {
    const q = (await ask(customer, { category: "주문·배달", body: "배달이 늦어요. 언제 오나요?" })).body;
    notices.length = 0;
    const answered = await call("POST", `/api/inquiries/${q.id}/answer`, { answer: "가게에 확인해 보니 10분 뒤 도착해요." }, admin);
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    assert.equal(answered.body.answer, "가게에 확인해 보니 10분 뒤 도착해요.");
    assert.ok(answered.body.answeredAt > 0);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(notices.map((n) => [n.email, n.subject]), [["asker@example.com", "문의에 답변이 달렸어요"]]);
    const seen = (await call("GET", "/api/inquiries", undefined, customer)).body.find((x) => x.id === q.id);
    assert.equal(seen.answer, "가게에 확인해 보니 10분 뒤 도착해요.");
    assert.equal((await call("POST", `/api/inquiries/${q.id}/answer`, { answer: "고쳐 쓴 답변" }, admin)).body.answer, "고쳐 쓴 답변");
  });

  it("권한과 입력을 검사하고, 하루에 10건까지만 받는다", async () => {
    assert.equal((await ask(undefined, { category: "기타", body: "로그인 없이 보내기" })).status, 401);
    assert.equal((await ask(admin, { category: "기타", body: "관리자는 문의하지 않는다" })).status, 403);
    assert.match((await ask(customer, { category: "아무거나", body: "분류가 이상해요" })).body.error, /분류를 골라/);
    assert.match((await ask(customer, { category: "기타", body: "짧음" })).body.error, /5자 이상/);
    assert.match((await ask(customer, { category: "기타", body: "가".repeat(1001) })).body.error, /1000자까지/);
    const q = (await ask(owner, { category: "기타", body: "답변 권한 확인용 문의" })).body;
    assert.equal((await call("POST", `/api/inquiries/${q.id}/answer`, { answer: "사장님은 못 단다" }, owner)).status, 403);
    assert.equal((await call("POST", `/api/inquiries/${q.id}/answer`, { answer: "  " }, admin)).status, 400);
    assert.equal((await call("POST", "/api/inquiries/nope/answer", { answer: "없는 문의" }, admin)).status, 404);

    db.createUser({ username: "spammer01", passwordHash: hashPassword("password1"), name: "많이 묻는 분", role: "user" });
    const spammer = (await call("POST", "/api/auth/login", { username: "spammer01", password: "password1" })).body.token;
    for (let i = 0; i < 10; i++) assert.equal((await ask(spammer, { category: "기타", body: `문의 ${i}번째예요` })).status, 200);
    const over = await ask(spammer, { category: "기타", body: "열한 번째 문의예요" });
    assert.equal(over.status, 429);
    assert.match(over.body.error, /오늘은 문의를 더 보낼 수 없어요/);
  });

  it("회원 탈퇴하면 그 사람의 문의도 지운다", async () => {
    const token = await signup({ username: "leaver001", email: "leaver@example.com", name: "떠나는 분" });
    await ask(token, { category: "계정", body: "탈퇴하면 문의는 어떻게 되나요?" });
    assert.equal(db.listInquiries({ username: "leaver001" }).length, 1);
    assert.equal((await call("POST", "/api/auth/withdraw", { password: "password1" }, token)).status, 200);
    assert.equal(db.listInquiries({ username: "leaver001" }).length, 0);
  });
});

describe("장바구니: 한 주문에 메뉴 여러 개", () => {
  let storeId;
  let owner;
  const FLAVORS = { label: "맛", count: 2, options: [{ name: "간장 파닭", extra: 0 }, { name: "양념 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }, { name: "굽는 불닭", extra: 2000 }] };
  before(async () => {
    storeId = db.addStore({ name: "장바구니 치킨", food: "chicken", hours: "00:00 - 24:00" }).id;
    db.setBankAccount(storeId, DEFAULT_ACCOUNT);
    db.addMenuItem({ restaurantId: storeId, name: "후라이드", price: 18000, unit: "마리", keywords: ["치킨"] });
    db.addMenuItem({ restaurantId: storeId, name: "치즈볼", price: 5000, unit: "개", keywords: [] });
    db.addMenuItem({ restaurantId: storeId, name: "2마리 세트", price: 26000, unit: "세트", keywords: ["세트"], choice: FLAVORS });
    owner = await signup({ role: "owner", username: "cartboss01", email: "cartboss@example.com", storeId });
    db.approveOwner("cartboss01");
  });
  const order = (items, over = {}) => call("POST", "/api/orders", { order: { storeId, items, address: "제천시 장락동 제천빌라 331호", phone: "010-1234-5678", ...over } }, buyer);

  it("메뉴마다 수량·단위·가격을 서버가 정하고 합계를 price 에 둔다", async () => {
    const r = await order([{ item: "후라이드", qty: 2, price: 1, unit: "판" }, { item: "치즈볼", qty: 3 }]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.order.items, [
      { item: "후라이드", qty: 2, unit: "마리", price: 36000 },
      { item: "치즈볼", qty: 3, unit: "개", price: 15000 },
    ]);
    assert.equal(r.body.order.price, 51000);
    assert.equal(r.body.order.listPrice, undefined);
    assert.equal(r.body.order.store.name, "장바구니 치킨");
    // 메뉴 하나짜리 옛 모양(item·qty 가 주문 바로 아래)도 받아 items 하나짜리로 저장한다
    const legacy = await call("POST", "/api/orders", { order: { storeId, item: "치즈볼", qty: 2, address: "제천시 장락동 제천빌라 331호", phone: "010-1234-5678" } }, buyer);
    assert.equal(legacy.status, 200);
    assert.deepEqual(legacy.body.order.items, [{ item: "치즈볼", qty: 2, unit: "개", price: 10000 }]);
    assert.equal(legacy.body.order.price, 10000);
  });

  it("할인한 메뉴가 있으면 메뉴 줄에 할인율·할인 전 금액을, 주문에 할인 전 합계를 적는다", async () => {
    const fried = (await call("GET", "/api/menu")).body.find((d) => d.restaurantId === storeId && d.name === "후라이드");
    await call("PATCH", `/api/stores/${storeId}/settings`, { item: { id: fried.id, patch: { discountPct: 10 } } }, owner);
    const r = await order([{ item: "후라이드", qty: 1 }, { item: "치즈볼", qty: 1 }]);
    assert.deepEqual(r.body.order.items[0], { item: "후라이드", qty: 1, unit: "마리", price: 16200, discountPct: 10, listPrice: 18000 });
    assert.equal(r.body.order.items[1].discountPct, undefined);
    assert.equal(r.body.order.price, 21200);
    assert.equal(r.body.order.listPrice, 23000);
    await call("PATCH", `/api/stores/${storeId}/settings`, { item: { id: fried.id, patch: { discountPct: 0 } } }, owner);
  });

  it("같은 메뉴를 두 번 담으면 합치고, 합친 수량도 상한을 넘을 수 없다", async () => {
    const r = await order([{ item: "치즈볼", qty: 2 }, { item: "후라이드", qty: 1 }, { item: "치즈볼", qty: 3 }]);
    assert.deepEqual(r.body.order.items.map((l) => [l.item, l.qty]), [["치즈볼", 5], ["후라이드", 1]]);
    assert.equal(r.body.order.price, 25000 + 18000);
    const tooMany = await order([{ item: "치즈볼", qty: 6 }, { item: "치즈볼", qty: 5 }]);
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.error, /치즈볼은 한 번에 10개까지/);
  });

  it("세트는 메뉴마다 맛을 검사하고, 같은 세트를 다시 담으면 맛이 겹치지 않을 때만 합친다", async () => {
    const merged = await order([{ item: "2마리 세트", qty: 1, choices: ["간장 파닭", "양념 파닭"] }, { item: "치즈볼", qty: 1 }, { item: "2마리 세트", qty: 1, choices: ["블랙스완 파닭", "굽는 불닭"] }]);
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    assert.deepEqual(merged.body.order.items.map((l) => [l.item, l.qty, l.choices?.map((c) => c.name)]), [
      ["2마리 세트", 2, ["간장 파닭", "양념 파닭", "블랙스완 파닭", "굽는 불닭"]],
      ["치즈볼", 1, undefined],
    ]);
    assert.equal(merged.body.order.price, 26000 * 2 + 3000 + 5000);
    // 맛이 겹치면 따로 둔다 (같은 맛은 한 세트 안에서 한 번만)
    const apart = await order([{ item: "2마리 세트", qty: 1, choices: ["간장 파닭", "양념 파닭"] }, { item: "2마리 세트", qty: 1, choices: ["간장 파닭", "굽는 불닭"] }]);
    assert.equal(apart.status, 200, JSON.stringify(apart.body));
    assert.equal(apart.body.order.items.length, 2);
    assert.equal(apart.body.order.price, 26000 * 2 + 2000);
    // 맛이 모자라면 그 메뉴 이름으로 거절한다
    const short = await order([{ item: "치즈볼", qty: 1 }, { item: "2마리 세트", qty: 1, choices: ["간장 파닭"] }]);
    assert.equal(short.status, 400);
    assert.match(short.body.error, /맛을\(를\) 2가지 골라/);
  });

  it("한 주문은 한 매장 메뉴만, 1~10가지까지", async () => {
    const other = await order([{ item: "치즈볼", qty: 1 }, { item: "간장치킨", qty: 1 }]); // 간장치킨은 h3 메뉴
    assert.equal(other.status, 400);
    assert.match(other.body.error, /메뉴를 알 수 없어요/);
    assert.match((await order([])).body.error, /담아 주세요/);
    assert.match((await order(Array.from({ length: 11 }, () => ({ item: "치즈볼", qty: 1 })))).body.error, /10가지까지/);
    assert.equal((await order([{ item: "치즈볼", qty: 0 }, { item: "후라이드", qty: 1 }])).status, 400);
    // 품절·판매 중지는 그 메뉴 이름으로 알린다
    const ball = (await call("GET", "/api/menu")).body.find((d) => d.restaurantId === storeId && d.name === "치즈볼");
    await call("PATCH", `/api/stores/${storeId}/settings`, { item: { id: ball.id, patch: { soldOut: true } } }, owner);
    assert.match((await order([{ item: "후라이드", qty: 1 }, { item: "치즈볼", qty: 1 }])).body.error, /치즈볼은\(는\) 지금 품절/);
    await call("PATCH", `/api/stores/${storeId}/settings`, { item: { id: ball.id, patch: { soldOut: false } } }, owner);
  });

  it("장바구니 전에 저장된 메뉴 하나짜리 주문도 items 하나짜리로 읽히고, 인기 통계는 담긴 메뉴마다 센다", async () => {
    const legacy = db.addOrder({
      customer: "buyer0001", customerName: "주문자", payment: "계좌이체", storeId,
      order: { store: { name: "장바구니 치킨" }, storeId, item: "2마리 세트", qty: 1, unit: "세트", price: 24400, discountPct: 10, listPrice: 27000, choices: [{ name: "간장 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }], choiceLabel: "맛", address: "제천시 장락동", phone: "010-1234-5678" },
    });
    const read = db.orderById(legacy.id).order;
    assert.deepEqual(read.items, [{ item: "2마리 세트", qty: 1, unit: "세트", price: 24400, discountPct: 10, listPrice: 27000, choices: [{ name: "간장 파닭", extra: 0 }, { name: "블랙스완 파닭", extra: 1000 }], choiceLabel: "맛" }]);
    assert.deepEqual([read.price, read.listPrice, read.address, read.item, read.qty], [24400, 27000, "제천시 장락동", undefined, undefined]);
    // GET 으로도 같은 모양
    const mine = (await call("GET", "/api/orders", undefined, buyer)).body.find((o) => o.id === legacy.id);
    assert.deepEqual(mine.order.items, read.items);

    const before = (await call("GET", "/api/stats/popular")).body.items;
    await order([{ item: "후라이드", qty: 2 }, { item: "치즈볼", qty: 1 }]);
    const after = (await call("GET", "/api/stats/popular")).body.items;
    const menu = (await call("GET", "/api/menu")).body;
    const id = (name) => menu.find((d) => d.restaurantId === storeId && d.name === name).id;
    assert.equal((after[id("후라이드")] ?? 0) - (before[id("후라이드")] ?? 0), 1);
    assert.equal((after[id("치즈볼")] ?? 0) - (before[id("치즈볼")] ?? 0), 1);
  });
});
