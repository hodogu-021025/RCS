// Saylo API. 화면(frontend)은 이 주소들만 부른다. 외부 패키지 없이 Node 내장 http 만 쓴다.
//
//   GET    /api/health
//   POST   /api/email/send-code        { email }                      인증번호 메일
//   POST   /api/email/verify           { email, code }                → { proof }  (회원가입에 같이 보낸다)
//   POST   /api/auth/signup            { role, username, password, name, email, proof, storeId?, agreePrivacy: true } → { token, session }
//   POST   /api/auth/login             { username, password }         → { token, session }
//   POST   /api/auth/logout
//   GET    /api/auth/me                                               → { session }  (토큰이 없거나 만료되면 null)
//   POST   /api/auth/reset/send-code   { email }                      비밀번호 찾기: 가입된 이메일로 인증번호 (확인은 /api/email/verify)
//   POST   /api/auth/reset             { email, proof, password, passwordConfirm } → { username }  새 비밀번호 (다른 기기 로그인은 끊긴다)
//   POST   /api/auth/withdraw          { password }                   회원 탈퇴 (고객님·사장님). 주문·예약 기록은 이름을 지우고 남긴다
//   GET    /api/orders                 고객: 내 것 / 사장님: 내 매장 / 관리자: 전체
//   POST   /api/orders                 { order, payment }             로그인 없이도 가능 (비회원). order.address·order.phone 필수
//   PATCH  /api/orders/:id             { status }                     그 매장 사장님·관리자
//   POST   /api/orders/lookup          { receipts }                   비회원: 주문할 때 받은 영수증 번호로 내 주문 보기
//   POST   /api/orders/:id/cancel      { receipt? }                   손님 취소 (접수 상태일 때만)
//   GET    /api/reservations           (주문과 같은 범위)
//   POST   /api/reservations           { restaurantId, restaurantName, date, time, people }
//   PATCH  /api/reservations/:id       { status }
//   GET    /api/stores/settings        누구나 (챗봇이 영업시간·품절을 본다)
//   GET    /api/stats/popular          누구나: 최근 30일 메뉴별 주문 수·식당별 예약 수 (챗봇 추천 순서)
//   PATCH  /api/stores/:id/settings    { hours? } 또는 { item: { id, patch: { price?, soldOut? } } }  그 매장 사장님·관리자
//   GET    /api/owners                 관리자
//   POST   /api/owners                 { username, password, name?, storeId }   관리자
//   POST   /api/owners/:username/approve  관리자: 스스로 가입한 사장님 승인 (승인 전에는 매장 주문·예약·설정에 접근할 수 없다)
//   DELETE /api/owners/:username       관리자 (승인 거절도 이것으로)
//   GET    /api/users                  관리자 (가입한 고객님)
//
// 로그인 상태는 Authorization: Bearer <token> 헤더로 보낸다. 토큰은 서버 DB 의 sessions 에 있고 30일 뒤 만료된다.
import { SESSION_TTL_MS, hashPassword, newToken, passwordError, usernameError, verifyPassword } from "./auth.mjs";
import { MAX_PEOPLE, MAX_QTY, ORDER_STATUSES, RESERVATION_STATUSES, STORE_IDS, findMenuItem, restaurantName } from "./stores.mjs";
import { isValidEmail, normalizeEmail } from "./verification.mjs";
import { ADDRESS_MAX, ADDRESS_MIN, normalizePhone } from "./contact.mjs";

const MAX_BODY = 16 * 1024;
// 지금 개인정보 처리방침의 시행일 (frontend/src/pages/privacyPolicy.ts 의 PRIVACY_EFFECTIVE 와 같게). 가입할 때 이 버전에 동의한 것으로 남긴다
export const PRIVACY_VERSION = "2026-10-10";
const GUEST = { username: "guest", name: "비회원" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new HttpError(400, message);

// 로컬·사설망 주소인지 (127.x, 10.x, 172.16-31.x, 192.168.x, ::1, 그리고 IPv4 를 감싼 ::ffff: 꼴)
export function isPrivateAddress(address) {
  const a = String(address).replace(/^::ffff:/, "");
  if (a === "::1" || a === "localhost") return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
}
const needLogin = () => new HttpError(401, "로그인이 필요해요.");
const forbidden = () => new HttpError(403, "권한이 없어요.");

const publicSession = (u) =>
  u && { username: u.username, role: u.role, name: u.name, ...(u.storeId ? { storeId: u.storeId } : {}), ...(u.role === "owner" ? { approved: u.approved } : {}) };
const PENDING_OWNER = "관리자 승인을 기다리고 있어요. 승인되면 매장 주문·예약을 볼 수 있어요.";

// 로그인 시도 제한: 비밀번호를 계속 대입해 보는 걸 막는다 (15분 안에 아이디별 5번, IP별 20번 실패하면 잠시 막는다)
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_PER_USER = 5;
export const LOGIN_MAX_PER_IP = 20;
const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// db: openDb() 결과, verifier: createVerifier() 결과, mailer: createMailer() 결과
// now: 시계 (테스트에서 로그인 제한 시간을 넘길 때)
export function createApp({ db, verifier, mailer, now = Date.now }) {
  // ---- 권한 ----
  // 주문·예약을 볼 수 있는 범위. 승인 전 사장님은 막는다
  function recordScope(user) {
    if (!user) throw needLogin();
    if (user.role === "admin") return {};
    if (user.role === "owner") {
      if (!user.approved) throw new HttpError(403, PENDING_OWNER);
      return { storeId: user.storeId };
    }
    return { customer: user.username };
  }
  // 그 매장의 주문·예약·설정을 바꿀 수 있는지: 관리자, 또는 승인된 그 매장 사장님
  function assertManages(user, storeId) {
    if (!user) throw needLogin();
    if (user.role === "admin") return;
    if (user.role === "owner" && user.storeId === storeId) {
      if (!user.approved) throw new HttpError(403, PENDING_OWNER);
      return;
    }
    throw forbidden();
  }

  // ---- 로그인 시도 제한 ----
  const loginFails = new Map(); // "u:아이디" 또는 "ip:주소" → [실패 시각…]
  const recentFails = (key) => (loginFails.get(key) ?? []).filter((at) => now() - at < LOGIN_WINDOW_MS);
  function checkLoginLimit(keys) {
    for (const [key, max] of keys) {
      const fails = recentFails(key);
      if (fails.length < max) continue;
      const retryAfter = Math.max(1, Math.ceil((fails[0] + LOGIN_WINDOW_MS - now()) / 1000));
      const err = new HttpError(429, `로그인을 너무 여러 번 실패했어요. ${Math.ceil(retryAfter / 60)}분 뒤에 다시 시도해 주세요.`);
      err.extra = { retryAfter };
      throw err;
    }
  }
  function recordLoginFail(keys) {
    if (loginFails.size > 10_000) for (const k of loginFails.keys()) if (recentFails(k).length === 0) loginFails.delete(k);
    for (const [key] of keys) loginFails.set(key, [...recentFails(key), now()]);
  }
  const userKey = (username) => `u:${String(username).toLowerCase()}`;

  // ---- 계정 ----
  // 입력을 검사해 정리된 값을 돌려준다. 문제가 있으면 400
  function checkAccount({ role, username, password, name, email, storeId }) {
    username = str(username, 20);
    name = str(name, 40);
    const error = usernameError(username) ?? passwordError(password) ?? (!name ? "이름을 적어 주세요." : null);
    if (error) throw bad(error);
    if (db.findUser(username)) throw bad("이미 있는 아이디예요.");
    if (role === "owner" && !STORE_IDS.has(storeId)) throw bad("매장을 골라 주세요.");
    if (email && db.emailTaken(email)) throw bad("이미 가입된 이메일이에요.");
    return { role, username, password, name, email, storeId: role === "owner" ? storeId : undefined };
  }
  const createAccount = (input) => {
    const a = checkAccount(input);
    return db.createUser({ ...a, passwordHash: hashPassword(a.password) });
  };

  function startSession(user) {
    const token = newToken();
    db.createSession(token, user.username, SESSION_TTL_MS);
    return { token, session: publicSession(user) };
  }

  const routes = [
    ["GET", "/api/health", () => ({ ok: true, mail: mailer.mode })],

    ["POST", "/api/email/send-code", async ({ body, ip }) => {
      if (mailer.mode === "off") throw new HttpError(503, "이메일 인증이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.");
      const email = normalizeEmail(body.email);
      // "가입된 이메일인지" 답도 IP 별 발송 횟수에 세어, 주소를 하나씩 넣어 보며 가입 여부를 캐지 못하게 한다
      if (isValidEmail(email) && db.emailTaken(email)) {
        verifier.countAttempt(ip);
        throw bad("이미 가입된 이메일이에요.");
      }
      const r = await verifier.sendCode(email, ip);
      if (r.status !== 200) throw Object.assign(new HttpError(r.status, r.body.error), { extra: r.body });
      return r.body;
    }],
    ["POST", "/api/email/verify", ({ body }) => {
      const r = verifier.verifyCode(body.email, body.code);
      if (r.status !== 200) throw new HttpError(r.status, r.body.error);
      return r.body;
    }],

    ["POST", "/api/auth/signup", ({ body }) => {
      const role = body.role === "owner" ? "owner" : body.role === "user" ? "user" : null;
      if (!role) throw bad("고객님 또는 사장님을 골라 주세요.");
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) throw bad("이메일 주소를 다시 확인해 주세요.");
      if (body.password !== body.passwordConfirm) throw bad("비밀번호가 서로 달라요.");
      // 다른 입력을 먼저 검사하고, 증표는 맨 마지막에 쓴다 (틀린 입력 때문에 증표가 날아가지 않게)
      const account = checkAccount({ role, username: body.username, password: body.password, name: body.name, email, storeId: str(body.storeId, 10) });
      if (body.agreePrivacy !== true) throw bad("개인정보 수집·이용에 동의해 주세요.");
      if (!verifier.consumeProof(email, body.proof)) throw bad("이메일 인증을 마쳐 주세요.");
      // 스스로 가입한 사장님은 관리자가 승인해야 매장 정보를 볼 수 있다 (아무나 남의 가게 주문을 보지 못하게)
      const user = db.createUser({ ...account, passwordHash: hashPassword(account.password), privacyVersion: PRIVACY_VERSION, approved: role !== "owner" });
      return startSession(user);
    }],
    ["POST", "/api/auth/login", ({ body, ip }) => {
      const username = str(body.username, 20);
      const keys = [[userKey(username), LOGIN_MAX_PER_USER], [`ip:${ip}`, LOGIN_MAX_PER_IP]];
      checkLoginLimit(keys);
      const row = db.findUserWithHash(username);
      if (!row || !verifyPassword(String(body.password ?? ""), row.password_hash)) {
        recordLoginFail(keys);
        throw new HttpError(401, "아이디 또는 비밀번호가 맞지 않아요.");
      }
      loginFails.delete(userKey(username));
      return startSession(db.findUser(row.username));
    }],
    // 비밀번호 찾기: 가입된 이메일로 인증번호를 보내고, 인증을 마치면 새 비밀번호로 바꾼다
    ["POST", "/api/auth/reset/send-code", async ({ body, ip }) => {
      if (mailer.mode === "off") throw new HttpError(503, "이메일 인증이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.");
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) throw bad("이메일 주소를 다시 확인해 주세요.");
      const target = db.findUserByEmail(email);
      if (!target || target.role === "admin") {
        verifier.countAttempt(ip); // 위와 같은 이유로 틀린 시도도 센다
        throw bad("가입된 이메일이 아니에요. 가입할 때 쓴 주소를 적어 주세요.");
      }
      const r = await verifier.sendCode(email, ip);
      if (r.status !== 200) throw Object.assign(new HttpError(r.status, r.body.error), { extra: r.body });
      return r.body;
    }],
    ["POST", "/api/auth/reset", ({ body }) => {
      const email = normalizeEmail(body.email);
      const user = isValidEmail(email) ? db.findUserByEmail(email) : null;
      if (!user || user.role === "admin") throw bad("가입된 이메일이 아니에요.");
      const error = passwordError(body.password) ?? (body.password !== body.passwordConfirm ? "비밀번호가 서로 달라요." : null);
      if (error) throw bad(error);
      // 증표는 맨 마지막에 쓴다 (틀린 입력 때문에 다시 인증하지 않게)
      if (!verifier.consumeProof(email, body.proof)) throw bad("이메일 인증을 마쳐 주세요.");
      db.setPassword(user.username, hashPassword(body.password));
      loginFails.delete(userKey(user.username));
      return { ok: true, username: user.username };
    }],
    ["POST", "/api/auth/logout", ({ token }) => {
      if (token) db.deleteSession(token);
      return { ok: true };
    }],
    ["GET", "/api/auth/me", ({ user }) => ({ session: publicSession(user) ?? null })],
    ["POST", "/api/auth/withdraw", ({ body, user }) => {
      if (!user) throw needLogin();
      if (user.role === "admin") throw new HttpError(403, "관리자 계정은 탈퇴할 수 없어요.");
      // 401 은 화면이 "로그인이 풀렸다"로 받아들이므로, 비밀번호가 틀리면 400 으로 알린다
      const keys = [[userKey(user.username), LOGIN_MAX_PER_USER]];
      checkLoginLimit(keys);
      const row = db.findUserWithHash(user.username);
      if (!row || !verifyPassword(String(body.password ?? ""), row.password_hash)) {
        recordLoginFail(keys);
        throw bad("비밀번호가 맞지 않아요.");
      }
      db.withdrawUser(user.username);
      return { ok: true };
    }],

    // ---- 주문 ----
    ["GET", "/api/orders", ({ user }) => db.listOrders(recordScope(user))],
    ["POST", "/api/orders", ({ body, user }) => {
      const o = body.order ?? {};
      const qty = Number(o.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw bad("주문 내용이 맞지 않아요.");
      if (!STORE_IDS.has(o.storeId)) throw bad("매장을 알 수 없어요.");
      // 메뉴·단위·금액은 화면이 보낸 값을 믿지 않고 목록(catalog.json)과 사장님 설정(가격·품절)으로 다시 정한다
      const item = findMenuItem(o.storeId, str(o.item));
      if (!item) throw bad("메뉴를 알 수 없어요.");
      const setting = db.allStoreSettings()[o.storeId]?.items?.[item.id] ?? {};
      if (setting.soldOut) throw bad(`${item.name}은(는) 지금 품절이에요.`);
      // 배달지와 연락처는 꼭 받는다 (가게가 배달하고 연락할 수 있게)
      const address = str(o.address, ADDRESS_MAX);
      if (address.length < ADDRESS_MIN) throw bad("배달 받을 주소를 적어 주세요.");
      const phone = normalizePhone(o.phone);
      if (!phone) throw bad("연락받을 전화번호를 다시 확인해 주세요.");
      const order = {
        store: { name: restaurantName(o.storeId), ...(o.store?.distance ? { distance: str(o.store.distance, 20) } : {}) },
        storeId: o.storeId,
        item: item.name,
        qty,
        unit: item.unit,
        price: (setting.price ?? item.price) * qty,
        address,
        phone,
      };
      const who = user ?? GUEST;
      const receipt = newToken();
      const rec = db.addOrder({ customer: who.username, customerName: who.name, payment: str(body.payment, 20) || "기타", storeId: o.storeId, order, receipt });
      return { ...rec, receipt };
    }],
    // 비회원도 영수증 번호로 자기 주문을 본다 (로그인 손님은 GET /api/orders)
    ["POST", "/api/orders/lookup", ({ body }) => {
      const receipts = Array.isArray(body.receipts) ? body.receipts.slice(0, 20).map((r) => str(r, 100)) : [];
      // 보낸 번호를 그대로 붙여 돌려준다 (손님이 이미 가진 번호라 새로 드러나는 것은 없다)
      return receipts.flatMap((r) => { const rec = db.orderByReceipt(r); return rec ? [{ ...rec, receipt: r }] : []; });
    }],
    // 손님이 취소: 주문한 사람(로그인)이거나 영수증 번호가 맞고, 가게가 아직 준비를 시작하지 않았을 때만
    ["POST", "/api/orders/:id/cancel", ({ params, body, user }) => {
      const rec = db.orderById(params.id);
      if (!rec) throw new HttpError(404, "없는 주문이에요.");
      const mine = (user && user.username === rec.customer) || (body.receipt && body.receipt === db.receiptOf(rec.id));
      if (!mine) throw forbidden();
      if (rec.status !== "접수") throw new HttpError(409, rec.status === "취소" ? "이미 취소된 주문이에요." : "가게에서 이미 준비를 시작해서 취소할 수 없어요.");
      db.setOrderStatus(rec.id, "취소");
      return db.orderById(rec.id);
    }],
    ["PATCH", "/api/orders/:id", ({ params, body, user }) => {
      if (!user) throw needLogin();
      const rec = db.orderById(params.id);
      if (!rec) throw new HttpError(404, "없는 주문이에요.");
      assertManages(user, rec.storeId);
      if (!ORDER_STATUSES.has(body.status)) throw bad("상태 값이 맞지 않아요.");
      db.setOrderStatus(rec.id, body.status);
      return db.orderById(rec.id);
    }],

    // ---- 예약 ----
    ["GET", "/api/reservations", ({ user }) => db.listReservations(recordScope(user))],
    ["POST", "/api/reservations", ({ body, user }) => {
      const people = Number(body.people);
      if (!STORE_IDS.has(body.restaurantId)) throw bad("식당을 알 수 없어요.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) || !/^\d{2}:\d{2}$/.test(String(body.time))) throw bad("날짜·시간이 맞지 않아요.");
      if (!Number.isInteger(people) || people < 1 || people > MAX_PEOPLE) throw bad("인원이 맞지 않아요.");
      const who = user ?? GUEST;
      return db.addReservation({
        customer: who.username,
        customerName: who.name,
        restaurantId: body.restaurantId,
        restaurantName: str(body.restaurantName),
        date: body.date,
        time: body.time,
        people,
      });
    }],
    ["PATCH", "/api/reservations/:id", ({ params, body, user }) => {
      if (!user) throw needLogin();
      const rec = db.reservationById(params.id);
      if (!rec) throw new HttpError(404, "없는 예약이에요.");
      assertManages(user, rec.restaurantId);
      if (!RESERVATION_STATUSES.has(body.status)) throw bad("상태 값이 맞지 않아요.");
      db.setReservationStatus(rec.id, body.status);
      return db.reservationById(rec.id);
    }],

    // ---- 매장 설정 ----
    ["GET", "/api/stores/settings", () => db.allStoreSettings()],
    // 챗봇 추천용: 최근 30일 메뉴별 주문 수(배달 메뉴 id 로)와 식당별 예약 수. 개인 정보 없이 숫자만
    ["GET", "/api/stats/popular", () => {
      const { items, restaurants } = db.popularity(Date.now() - 30 * 24 * 60 * 60_000);
      const byMenuId = {};
      for (const [key, n] of Object.entries(items)) {
        const [storeId, name] = key.split("|");
        const item = findMenuItem(storeId, name);
        if (item) byMenuId[item.id] = (byMenuId[item.id] ?? 0) + n;
      }
      return { items: byMenuId, restaurants };
    }],
    ["PATCH", "/api/stores/:id/settings", ({ params, body, user }) => {
      if (!user) throw needLogin();
      if (!STORE_IDS.has(params.id)) throw new HttpError(404, "없는 매장이에요.");
      assertManages(user, params.id);
      const patch = {};
      if (body.hours !== undefined) {
        if (!/^\d{2}:\d{2} - \d{2}:\d{2}$/.test(String(body.hours))) throw bad("영업시간 형식이 맞지 않아요.");
        patch.hours = body.hours;
      }
      if (body.item) {
        const id = str(body.item.id, 10);
        const p = body.item.patch ?? {};
        const itemPatch = {};
        if (p.price !== undefined) {
          const price = Number(p.price);
          if (!Number.isFinite(price) || price <= 0) throw bad("가격이 맞지 않아요.");
          itemPatch.price = price;
        }
        if (p.soldOut !== undefined) itemPatch.soldOut = !!p.soldOut;
        if (!id) throw bad("메뉴를 알 수 없어요.");
        patch.item = { id, patch: itemPatch };
      }
      return db.updateStoreSettings(params.id, patch);
    }],

    // ---- 관리자: 사장님·고객님 ----
    ["GET", "/api/owners", ({ user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      return db.listByRole("owner");
    }],
    ["POST", "/api/owners", ({ body, user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      const storeId = str(body.storeId, 10);
      return createAccount({ role: "owner", username: body.username, password: body.password, name: str(body.name, 40) || "사장님", storeId });
    }],
    ["POST", "/api/owners/:username/approve", ({ params, user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      if (!db.approveOwner(params.username)) throw new HttpError(404, "없는 사장님 계정이에요.");
      return db.findUser(params.username);
    }],
    ["DELETE", "/api/owners/:username", ({ params, user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      const target = db.findUser(params.username);
      if (!target || target.role !== "owner") throw new HttpError(404, "없는 사장님 계정이에요.");
      db.deleteUser(target.username); // 세션도 같이 지워진다 (ON DELETE CASCADE)
      return { ok: true };
    }],
    ["GET", "/api/users", ({ user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      return db.listByRole("user");
    }],
  ].map(([method, pattern, handler]) => ({
    method,
    handler,
    keys: [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]),
    re: new RegExp("^" + pattern.replace(/:(\w+)/g, "([^/]+)") + "$"),
  }));

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, "요청이 너무 커요."));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          const parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
          resolve(parsed && typeof parsed === "object" ? parsed : {});
        } catch {
          reject(new HttpError(400, "요청 형식이 맞지 않아요."));
        }
      });
      req.on("error", reject);
    });
  }

  function send(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  // nginx·Vite 프록시 뒤에서 돌므로 실제 접속 IP 는 X-Forwarded-For 첫 값이다.
  // 다만 그 헤더는 프록시(같은 컴퓨터·Docker 내부망)에서 온 요청일 때만 믿는다. 인터넷에 바로 열린 서버에서는
  // 누구나 헤더를 꾸며 IP 별 제한(인증 메일·로그인)을 피할 수 있기 때문이다
  const clientIp = (req) => {
    const peer = req.socket.remoteAddress ?? "";
    const forwarded = isPrivateAddress(peer) ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    return forwarded || peer || "unknown";
  };

  // http.createServer 에 넘기는 요청 처리기
  return async function handle(req, res) {
    try {
      let path;
      try {
        path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      } catch {
        throw bad("주소가 맞지 않아요."); // %FF 처럼 풀 수 없는 글자
      }
      const route = routes.find((r) => r.method === req.method && r.re.test(path));
      if (!route) throw new HttpError(404, "없는 주소예요.");
      const params = Object.fromEntries(route.keys.map((k, i) => [k, path.match(route.re)[i + 1]]));
      const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim() || null;
      const user = token ? db.userByToken(token) : null;
      const body = req.method === "GET" || req.method === "DELETE" ? {} : await readJson(req);
      const result = await route.handler({ body, params, user, token, ip: clientIp(req) });
      send(res, 200, result);
    } catch (err) {
      // status 가 붙은 오류(verifier 의 429)도 그 상태로 답한다
      const status = err instanceof HttpError || (typeof err?.status === "number" && err.status >= 400 && err.status < 600) ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: status === 500 ? "서버에 문제가 생겼어요." : err.message, ...(err.extra ?? {}) });
    }
  };
}
