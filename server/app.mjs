// Saylo API. 화면(frontend)은 이 주소들만 부른다. 외부 패키지 없이 Node 내장 http 만 쓴다.
//
//   GET    /api/health
//   POST   /api/email/send-code        { email }                      인증번호 메일
//   POST   /api/email/verify           { email, code }                → { proof }  (회원가입에 같이 보낸다)
//   POST   /api/auth/signup            { role, username, password, name, email, proof, storeId? } → { token, session }
//   POST   /api/auth/login             { username, password }         → { token, session }
//   POST   /api/auth/logout
//   GET    /api/auth/me                                               → { session }  (토큰이 없거나 만료되면 null)
//   GET    /api/orders                 고객: 내 것 / 사장님: 내 매장 / 관리자: 전체
//   POST   /api/orders                 { order, payment }             로그인 없이도 가능 (비회원)
//   PATCH  /api/orders/:id             { status }                     그 매장 사장님·관리자
//   GET    /api/reservations           (주문과 같은 범위)
//   POST   /api/reservations           { restaurantId, restaurantName, date, time, people }
//   PATCH  /api/reservations/:id       { status }
//   GET    /api/stores/settings        누구나 (챗봇이 영업시간·품절을 본다)
//   PATCH  /api/stores/:id/settings    { hours? } 또는 { item: { id, patch: { price?, soldOut? } } }  그 매장 사장님·관리자
//   GET    /api/owners                 관리자
//   POST   /api/owners                 { username, password, name?, storeId }   관리자
//   DELETE /api/owners/:username       관리자
//   GET    /api/users                  관리자 (가입한 고객님)
//
// 로그인 상태는 Authorization: Bearer <token> 헤더로 보낸다. 토큰은 서버 DB 의 sessions 에 있고 30일 뒤 만료된다.
import { SESSION_TTL_MS, hashPassword, newToken, passwordError, usernameError, verifyPassword } from "./auth.mjs";
import { MAX_PEOPLE, MAX_QTY, ORDER_STATUSES, RESERVATION_STATUSES, STORE_IDS } from "./stores.mjs";
import { isValidEmail, normalizeEmail } from "./verification.mjs";

const MAX_BODY = 16 * 1024;
const GUEST = { username: "guest", name: "비회원" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new HttpError(400, message);
const needLogin = () => new HttpError(401, "로그인이 필요해요.");
const forbidden = () => new HttpError(403, "권한이 없어요.");

const publicSession = (u) => u && { username: u.username, role: u.role, name: u.name, ...(u.storeId ? { storeId: u.storeId } : {}) };
const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// db: openDb() 결과, verifier: createVerifier() 결과, mailer: createMailer() 결과
export function createApp({ db, verifier, mailer }) {
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
      if (isValidEmail(email) && db.emailTaken(email)) throw bad("이미 가입된 이메일이에요.");
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
      if (!verifier.consumeProof(email, body.proof)) throw bad("이메일 인증을 마쳐 주세요.");
      return startSession(db.createUser({ ...account, passwordHash: hashPassword(account.password) }));
    }],
    ["POST", "/api/auth/login", ({ body }) => {
      const row = db.findUserWithHash(str(body.username, 20));
      if (!row || !verifyPassword(String(body.password ?? ""), row.password_hash)) throw new HttpError(401, "아이디 또는 비밀번호가 맞지 않아요.");
      return startSession(db.findUser(row.username));
    }],
    ["POST", "/api/auth/logout", ({ token }) => {
      if (token) db.deleteSession(token);
      return { ok: true };
    }],
    ["GET", "/api/auth/me", ({ user }) => ({ session: publicSession(user) ?? null })],

    // ---- 주문 ----
    ["GET", "/api/orders", ({ user }) => {
      if (!user) throw needLogin();
      return db.listOrders(user.role === "admin" ? {} : user.role === "owner" ? { storeId: user.storeId } : { customer: user.username });
    }],
    ["POST", "/api/orders", ({ body, user }) => {
      const o = body.order ?? {};
      const qty = Number(o.qty);
      const price = Number(o.price);
      if (!str(o.item) || !str(o.unit, 10) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY || !Number.isFinite(price) || price < 0)
        throw bad("주문 내용이 맞지 않아요.");
      if (!STORE_IDS.has(o.storeId)) throw bad("매장을 알 수 없어요.");
      const order = {
        store: { name: str(o.store?.name), ...(o.store?.distance ? { distance: str(o.store.distance, 20) } : {}) },
        storeId: o.storeId,
        item: str(o.item),
        qty,
        unit: str(o.unit, 10),
        price,
        ...(o.address ? { address: str(o.address) } : {}),
      };
      const who = user ?? GUEST;
      return db.addOrder({ customer: who.username, customerName: who.name, payment: str(body.payment, 20) || "기타", storeId: o.storeId, order });
    }],
    ["PATCH", "/api/orders/:id", ({ params, body, user }) => {
      if (!user) throw needLogin();
      const rec = db.orderById(params.id);
      if (!rec) throw new HttpError(404, "없는 주문이에요.");
      if (user.role !== "admin" && !(user.role === "owner" && user.storeId === rec.storeId)) throw forbidden();
      if (!ORDER_STATUSES.has(body.status)) throw bad("상태 값이 맞지 않아요.");
      db.setOrderStatus(rec.id, body.status);
      return db.orderById(rec.id);
    }],

    // ---- 예약 ----
    ["GET", "/api/reservations", ({ user }) => {
      if (!user) throw needLogin();
      return db.listReservations(user.role === "admin" ? {} : user.role === "owner" ? { storeId: user.storeId } : { customer: user.username });
    }],
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
      if (user.role !== "admin" && !(user.role === "owner" && user.storeId === rec.restaurantId)) throw forbidden();
      if (!RESERVATION_STATUSES.has(body.status)) throw bad("상태 값이 맞지 않아요.");
      db.setReservationStatus(rec.id, body.status);
      return db.reservationById(rec.id);
    }],

    // ---- 매장 설정 ----
    ["GET", "/api/stores/settings", () => db.allStoreSettings()],
    ["PATCH", "/api/stores/:id/settings", ({ params, body, user }) => {
      if (!user) throw needLogin();
      if (!STORE_IDS.has(params.id)) throw new HttpError(404, "없는 매장이에요.");
      if (user.role !== "admin" && !(user.role === "owner" && user.storeId === params.id)) throw forbidden();
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

  // nginx·Vite 프록시 뒤에서 돌므로 실제 접속 IP 는 X-Forwarded-For 첫 값이다
  const clientIp = (req) => String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";

  // http.createServer 에 넘기는 요청 처리기
  return async function handle(req, res) {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    try {
      const route = routes.find((r) => r.method === req.method && r.re.test(path));
      if (!route) throw new HttpError(404, "없는 주소예요.");
      const params = Object.fromEntries(route.keys.map((k, i) => [k, path.match(route.re)[i + 1]]));
      const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim() || null;
      const user = token ? db.userByToken(token) : null;
      const body = req.method === "GET" || req.method === "DELETE" ? {} : await readJson(req);
      const result = await route.handler({ body, params, user, token, ip: clientIp(req) });
      send(res, 200, result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: status === 500 ? "서버에 문제가 생겼어요." : err.message, ...(err.extra ?? {}) });
    }
  };
}
