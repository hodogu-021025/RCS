// API 전체를 실제 http 로 돌려 보는 테스트 (메모리 DB, 가짜 메일)
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { createApp } from "./app.mjs";
import { openDb } from "./db.mjs";
import { createVerifier } from "./verification.mjs";

let server;
let base;
let sent; // 가짜로 보낸 메일 [{ email, code }]
let db;

before(async () => {
  db = openDb(":memory:");
  sent = [];
  const verifier = createVerifier({ sendMail: async (email, code) => void sent.push({ email, code }), generateCode: () => "123456" });
  const mailer = { mode: "dev-console", sendMail: verifier.sendMail, describe: "test" };
  server = http.createServer(createApp({ db, verifier, mailer }));
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
  const r = await call("POST", "/api/auth/signup", { role, username, name, email, proof: v.body.proof, password: "password1", passwordConfirm: "password1", storeId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

const chicken = { store: { name: "청전 치킨공방", distance: "1.8km" }, storeId: "h3", item: "간장치킨", qty: 2, unit: "마리", price: 40000, address: "제천시 장락동" };

describe("회원가입·로그인", () => {
  it("인증번호를 받고 확인한 증표로만 가입되고, 가입하면 바로 로그인된다", async () => {
    await call("POST", "/api/email/send-code", { email: "Hong@Example.com" });
    assert.deepEqual(sent.at(-1), { email: "hong@example.com", code: "123456" });

    const noProof = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong", name: "홍길동", email: "hong@example.com", password: "password1", passwordConfirm: "password1" });
    assert.equal(noProof.status, 400);
    assert.match(noProof.body.error, /이메일 인증/);

    const v = await call("POST", "/api/email/verify", { email: "hong@example.com", code: "123456" });
    assert.equal(v.body.verified, true);
    const r = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong", name: "홍길동", email: "hong@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.session, { username: "hongildong", role: "user", name: "홍길동" });

    const me = await call("GET", "/api/auth/me", undefined, r.body.token);
    assert.deepEqual(me.body.session, r.body.session);
    // 증표는 한 번만 쓴다
    const again = await call("POST", "/api/auth/signup", { role: "user", username: "hongildong2", name: "홍", email: "hong@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1" });
    assert.equal(again.status, 400);
  });

  it("아이디·비밀번호 규칙, 중복 아이디·이메일, 비밀번호 확인을 서버가 검사한다", async () => {
    await call("POST", "/api/email/send-code", { email: "rule@example.com" });
    const v = await call("POST", "/api/email/verify", { email: "rule@example.com", code: "123456" });
    const base = { role: "user", name: "규칙", email: "rule@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1" };
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
    const noStore = await call("POST", "/api/auth/signup", { role: "owner", username: "bossbanjeom", name: "김사장", email: "owner@example.com", proof: v.body.proof, password: "password1", passwordConfirm: "password1", storeId: "zz9" });
    assert.match(noStore.body.error, /매장을 골라/);
    // 증표는 실패한 시도에서도 쓰였으므로 다시 인증한다
    const token = await signup({ role: "owner", username: "bossbanjeom", email: "owner2@example.com", storeId: "c1", name: "김사장" });
    const me = await call("GET", "/api/auth/me", undefined, token);
    assert.deepEqual(me.body.session, { username: "bossbanjeom", role: "owner", name: "김사장", storeId: "c1" });
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
