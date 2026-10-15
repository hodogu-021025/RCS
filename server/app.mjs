// Saylo API. 화면(frontend)은 이 주소들만 부른다. 외부 패키지 없이 Node 내장 http 만 쓴다.
//
//   GET    /api/health
//   POST   /api/email/send-code        { email }                      인증번호 메일
//   POST   /api/email/verify           { email, code }                → { proof }  (회원가입에 같이 보낸다)
//   POST   /api/auth/signup            { role, username, password, name, email, proof, phone, storeId?, agreePrivacy: true } → { token, session }
//   POST   /api/auth/login             { username, password }         → { token, session }
//   POST   /api/auth/logout
//   GET    /api/auth/me                                               → { session }  (토큰이 없거나 만료되면 null)
//   POST   /api/auth/reset/send-code   { email }                      비밀번호 찾기: 가입된 이메일로 인증번호 (확인은 /api/email/verify)
//   POST   /api/auth/reset             { email, proof, password, passwordConfirm } → { username }  새 비밀번호 (다른 기기 로그인은 끊긴다)
//   PATCH  /api/auth/contact           { phone?, address? }           → { session }  내 연락처·배달지 (배달지는 고객님만)
//   POST   /api/auth/withdraw          { password }                   회원 탈퇴 (고객님·사장님). 주문·예약 기록은 이름을 지우고 남긴다
//   GET    /api/orders                 고객: 내 것 / 사장님: 내 매장 / 관리자: 전체
//   POST   /api/orders                 { order }                      로그인한 고객님만. order.address·order.phone 필수.
//                                      결제는 계좌이체: "입금 대기"로 들어오고, 응답의 order.bank 계좌로 order.payBy 까지 입금한다
//   PATCH  /api/orders/:id             { status }                     그 매장 사장님·관리자 (입금 대기 → 접수 가 입금 확인)
//   POST   /api/orders/:id/cancel                                     주문한 고객님이 취소 (입금 대기·접수 상태일 때만)
//   GET    /api/reservations           (주문과 같은 범위)
//   POST   /api/reservations           { restaurantId, restaurantName, date, time, people }
//   PATCH  /api/reservations/:id       { status }
//   GET    /api/stores                 누구나: 매장 목록 (목록 파일 + 관리자가 만든 매장)
//   GET    /api/stores/settings        누구나 (챗봇이 영업시간·품절을 본다)
//   GET    /api/menu                   누구나: 배달 메뉴 전체 (판매 중지는 active: false)
//   POST   /api/stores/:id/menu        { name, price, unit, keywords? }  그 매장 사장님(승인)·관리자: 메뉴 추가, 바로 판매
//   PATCH  /api/stores/:id/menu/:itemId  { active }                 판매 중지(false)·다시 판매(true)
//   GET    /api/stats/popular          누구나: 최근 30일 메뉴별 주문 수·식당별 예약 수 (챗봇 추천 순서)
//   PATCH  /api/stores/:id/settings    { hours? } · { item: { id, patch: { price?, soldOut?, discountPct? } } } · { special: { itemId } | null }
//                                      · { pause: { from?: 밀리초, until: 밀리초 } | null }  그 매장 사장님·관리자
//                                      (pause: from(없거나 지났으면 지금)부터 until 까지 새 배달 주문과 오늘 예약을 받지 않는다.
//                                       둘 다 지금부터 24시간 안, until 은 from 보다 뒤. null 이면 일시 중지를 지우고 바로 다시 받는다)
//                                      (special: 오늘의 메뉴. 서버가 한국 날짜로 오늘을 붙이고, 그날만 보인다. discountPct 0 은 할인 끔)
//   GET    /api/stores/:id/bank        그 매장 사장님·관리자 → { account }  매장 입금 계좌 (없으면 그 매장은 배달 주문을 받지 않는다)
//   PUT    /api/stores/:id/bank        { bank, account, holder }       그 매장 사장님·관리자: 입금 계좌 등록·변경
//   DELETE /api/stores/:id/bank        (지우면 배달 주문을 받지 않는다)
//   GET    /api/bank                   관리자 → { 매장 id: 계좌 }  등록된 매장 계좌 전체
//   GET    /api/owners                 관리자
//   POST   /api/owners                 { username, password, newStore | storeId }   관리자. 사장님 이름은 "매장 이름 사장님"
//                                      newStore: { name, food, hours?, address? } 새 매장을 만들고 그 매장 사장님으로
//   POST   /api/owners/:username/approve  관리자: 스스로 가입한 사장님 승인 (승인 전에는 매장 주문·예약·설정에 접근할 수 없다)
//   DELETE /api/owners/:username       관리자 (승인 거절도 이것으로)
//   GET    /api/users                  관리자 (가입한 고객님)
//
// 로그인 상태는 Authorization: Bearer <token> 헤더로 보낸다. 토큰은 서버 DB 의 sessions 에 있고 30일 뒤 만료된다.
import { SESSION_TTL_MS, hashPassword, newToken, passwordError, usernameError, verifyPassword } from "./auth.mjs";
import {
  DELIVERY_MENU,
  DISCOUNT_MAX,
  MAX_PEOPLE,
  MAX_QTY,
  MENU_KEYWORDS_MAX,
  MENU_NAME_MAX,
  MENU_PRICE_MAX,
  MENU_PRICE_MIN,
  MENU_UNIT_MAX,
  CUSTOMER_CANCELABLE,
  ORDER_NEXT,
  ORDER_STATUSES,
  PAYMENT_METHOD,
  PAY_WINDOW_MS,
  cleanBankAccount,
  RESERVATION_NEXT,
  RESERVATION_STATUSES,
  hoursError,
  isPaused,
  PAUSE_MAX_MS,
  pauseEndText,
  withTopic,
  allStores,
  cleanNewStore,
  findStore,
  sameStoreName,
  hasStore,
  pickedChoices,
  discountedPrice,
  foodLabel,
  listedMenu,
  todayKST,
} from "./stores.mjs";
import { isValidEmail, normalizeEmail } from "./verification.mjs";
import { ADDRESS_MAX, ADDRESS_MIN, normalizePhone } from "./contact.mjs";

const MAX_BODY = 16 * 1024;
// 지금 개인정보 처리방침의 시행일 (frontend/src/pages/privacyPolicy.ts 의 PRIVACY_EFFECTIVE 와 같게). 가입할 때 이 버전에 동의한 것으로 남긴다
export const PRIVACY_VERSION = "2026-10-15";
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

// 연락처·배달지는 본인 세션에만 싣는다 (챗봇이 배달 주문에 쓴다)
const publicSession = (u) =>
  u && {
    username: u.username,
    role: u.role,
    name: u.name,
    ...(u.storeId ? { storeId: u.storeId } : {}),
    ...(u.role === "owner" ? { approved: u.approved } : {}),
    ...(u.phone ? { phone: u.phone } : {}),
    ...(u.address ? { address: u.address } : {}),
  };
const PHONE_ERROR = "전화번호를 010-1234-5678 형식으로 적어 주세요.";
const PENDING_OWNER = "관리자 승인을 기다리고 있어요. 승인되면 매장 주문·예약을 볼 수 있어요.";
const OWNER_SIGNUP_CLOSED = "사장님 계정은 관리자가 만들어 드려요. 관리자에게 요청해 주세요.";

// 로그인 시도 제한: 비밀번호를 계속 대입해 보는 걸 막는다 (15분 안에 아이디별 5번, IP별 20번 실패하면 잠시 막는다)
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_PER_USER = 5;
export const LOGIN_MAX_PER_IP = 20;
const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// db: openDb() 결과, verifier: createVerifier() 결과, mailer: createMailer() 결과
// now: 시계 (테스트에서 로그인 제한 시간을 넘길 때). 기본은 부를 때마다 Date.now 를 읽는다 (테스트가 시계를 바꿔도 따라가게)
export function createApp({ db, verifier, mailer, now = () => Date.now() }) {
  // 목록 파일의 배달 메뉴 중 DB 에 없는 것을 채워 넣는다 (사장님이 추가·판매 중지한 메뉴는 그대로)
  db.seedMenu(DELIVERY_MENU);
  // 판매 중인 그 매장의 그 이름 메뉴
  // 끝난 일시 중지는 화면에 보내지 않는다 (정한 시각이 지나면 저절로 다시 받는다). 시작 전인 것(미리 정해 둔 것)은 보낸다
  const liveSettings = (s) => {
    if (!s?.pausedUntil || s.pausedUntil > now()) return s;
    const { pausedFrom: _from, pausedUntil: _ended, ...rest } = s;
    return rest;
  };
  const storePaused = (storeId) => {
    const s = db.allStoreSettings()[storeId];
    return isPaused(s, now()) ? s.pausedUntil : null;
  };
  const activeMenuItem = (storeId, name) => {
    const item = db.menuItemByName(storeId, name);
    return item?.active ? item : null;
  };

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
  // 매장: 목록 파일(catalog.json)의 매장 + 관리자가 사장님 계정을 만들며 직접 입력한 매장(DB)
  const hasStoreId = (id) => typeof id === "string" && hasStore(db, id);
  const storeName = (id) => findStore(db, id)?.name;

  // 그 매장의 주문·예약·설정을 바꿀 수 있는지: 관리자, 또는 승인된 그 매장 사장님
  // 사장님 계정이 없어지면(탈퇴·관리자 삭제) 그 매장에 다른 사장님이 남지 않았을 때 매장 입금 계좌(예금주 이름이 든 사장님 정보)도 지운다.
  // 그 뒤 그 매장은 새 계좌가 등록될 때까지 배달 주문을 받지 않는다
  function forgetStoreBank(storeId) {
    if (storeId && !db.listByRole("owner").some((o) => o.storeId === storeId)) db.setBankAccount(storeId, null);
  }

  // 입금 기한이 지난 "입금 대기" 주문을 취소한다. 주문을 보거나 바꾸기 직전에 부른다 (서버도 1분마다 부른다)
  const expireUnpaid = () => db.expireUnpaidOrders(now() - PAY_WINDOW_MS);

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
    if (role === "owner" && !hasStoreId(storeId)) throw bad("매장을 골라 주세요.");
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
      // 회원가입은 고객님만. 사장님 계정은 관리자가 관리자 화면에서 만든다
      if (body.role === "owner") throw bad(OWNER_SIGNUP_CLOSED);
      const role = "user";
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) throw bad("이메일 주소를 다시 확인해 주세요.");
      if (body.password !== body.passwordConfirm) throw bad("비밀번호가 서로 달라요.");
      // 다른 입력을 먼저 검사하고, 증표는 맨 마지막에 쓴다 (틀린 입력 때문에 증표가 날아가지 않게)
      const account = checkAccount({ role, username: body.username, password: body.password, name: body.name, email });
      const phone = normalizePhone(body.phone);
      if (!phone) throw bad(PHONE_ERROR);
      if (body.agreePrivacy !== true) throw bad("개인정보 수집·이용에 동의해 주세요.");
      if (!verifier.consumeProof(email, body.proof)) throw bad("이메일 인증을 마쳐 주세요.");
      const user = db.createUser({ ...account, phone, passwordHash: hashPassword(account.password), privacyVersion: PRIVACY_VERSION });
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
    // 계정 관리: 연락처는 고객님·사장님, 배달지는 고객님만 (챗봇 배달 주문은 계정의 배달지·연락처로 보낸다)
    ["PATCH", "/api/auth/contact", ({ body, user }) => {
      if (!user) throw needLogin();
      if (user.role === "admin") throw forbidden();
      const patch = {};
      if (body.phone !== undefined) {
        patch.phone = normalizePhone(body.phone);
        if (!patch.phone) throw bad(PHONE_ERROR);
      }
      if (body.address !== undefined) {
        if (user.role !== "user") throw forbidden();
        patch.address = str(body.address, ADDRESS_MAX).replace(/\s+/g, " ");
        if (patch.address.length < ADDRESS_MIN) throw bad("배달지를 동·호수까지 자세히 적어 주세요.");
      }
      return { session: publicSession(db.updateContact(user.username, patch)) };
    }],
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
      if (user.role === "owner") forgetStoreBank(user.storeId);
      return { ok: true };
    }],

    // ---- 주문 ----
    ["GET", "/api/orders", ({ user }) => {
      expireUnpaid();
      return db.listOrders(recordScope(user));
    }],
    ["POST", "/api/orders", ({ body, user }) => {
      // 배달 주문은 로그인한 고객님만 (배달지·연락처를 계정에 두고 쓴다). 식당 예약은 비회원도 된다
      if (!user) throw new HttpError(401, "배달 주문은 로그인한 뒤에 할 수 있어요.");
      if (user.role !== "user") throw new HttpError(403, "배달 주문은 고객님 계정으로 할 수 있어요.");
      const o = body.order ?? {};
      const qty = Number(o.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw bad("주문 내용이 맞지 않아요.");
      if (!hasStoreId(o.storeId)) throw bad("매장을 알 수 없어요.");
      const pausedUntil = storePaused(o.storeId);
      if (pausedUntil) throw bad(`${withTopic(storeName(o.storeId))} 지금 잠시 주문을 받지 않아요. ${pauseEndText(pausedUntil, now())}부터 다시 받아요.`);
      // 메뉴·단위·금액은 화면이 보낸 값을 믿지 않고 목록(catalog.json)과 사장님 설정(가격·품절)으로 다시 정한다
      const item = activeMenuItem(o.storeId, str(o.item));
      if (!item) throw bad(db.menuItemByName(o.storeId, str(o.item)) ? `${str(o.item)}은(는) 지금 판매하지 않아요.` : "메뉴를 알 수 없어요.");
      const setting = db.allStoreSettings()[o.storeId]?.items?.[item.id] ?? {};
      if (setting.soldOut) throw bad(`${item.name}은(는) 지금 품절이에요.`);
      // 세트 메뉴: 고른 맛을 검사한다 (세트 수 × 마리 수만큼, 메뉴의 맛 목록 안에서 서로 다르게). 맛의 추가금은 세트 값에 더한다
      let choices;
      let extra = 0;
      if (item.choice) {
        const picked = pickedChoices(item.choice, o.choices, qty);
        if (picked.error) throw bad(picked.error);
        choices = picked.choices;
        extra = picked.extra;
      }
      // 1단위 가격: 사장님이 바꾼 가격, 그다음 할인율 (10원 단위로 반올림)
      const listPrice = setting.price ?? item.price;
      const discountPct = setting.discountPct ?? 0;
      const unitPrice = discountedPrice(listPrice, discountPct);
      // 배달지와 연락처는 꼭 받는다 (가게가 배달하고 연락할 수 있게)
      const address = str(o.address, ADDRESS_MAX);
      if (address.length < ADDRESS_MIN) throw bad("배달 받을 주소를 적어 주세요.");
      const phone = normalizePhone(o.phone);
      if (!phone) throw bad("연락받을 전화번호를 다시 확인해 주세요.");
      const order = {
        store: { name: storeName(o.storeId), ...(o.store?.distance ? { distance: str(o.store.distance, 20) } : {}) },
        storeId: o.storeId,
        item: item.name,
        qty,
        unit: item.unit,
        price: unitPrice * qty + extra, // 세트 메뉴면 고른 맛의 추가금을 더한다 (할인은 세트 값에만)
        // 할인했으면 할인율과 할인 전 금액도 남긴다 (영수증·사장님 화면에 보여 준다)
        ...(discountPct > 0 ? { discountPct, listPrice: listPrice * qty + extra } : {}),
        // 세트 메뉴의 고른 맛 (사장님 화면·내 주문에 보여 준다)
        ...(choices ? { choices, choiceLabel: item.choice.label } : {}),
        address,
        phone,
      };
      // 결제는 계좌이체: 그 매장의 입금 계좌를 주문에 적어 두고, 사장님이 입금을 확인할 때까지 "입금 대기". 계좌가 없는 매장은 주문을 받지 않는다
      const bank = db.bankAccount(o.storeId);
      if (!bank) throw bad(`${withTopic(storeName(o.storeId))} 아직 입금 계좌를 등록하지 않아 주문을 받을 수 없어요.`);
      // 입금 기한은 주문 시각 기준: 기한이 지났는지도 같은 주문 시각(created_at)으로 본다
      const at = now();
      Object.assign(order, { bank, depositor: user.name, payBy: at + PAY_WINDOW_MS });
      return db.addOrder({ customer: user.username, customerName: user.name, payment: PAYMENT_METHOD, storeId: o.storeId, order, status: "입금 대기", createdAt: at });
    }],
    // 손님이 취소: 주문한 고객님이 로그인해 있고, 가게가 아직 준비를 시작하지 않았을 때만
    ["POST", "/api/orders/:id/cancel", ({ params, user }) => {
      expireUnpaid();
      const rec = db.orderById(params.id);
      if (!rec) throw new HttpError(404, "없는 주문이에요.");
      if (!user) throw needLogin();
      if (user.username !== rec.customer) throw forbidden();
      if (!CUSTOMER_CANCELABLE.has(rec.status)) throw new HttpError(409, rec.status === "취소" ? "이미 취소된 주문이에요." : "가게에서 이미 준비를 시작해서 취소할 수 없어요.");
      db.setOrderStatus(rec.id, "취소");
      return db.orderById(rec.id);
    }],
    ["PATCH", "/api/orders/:id", ({ params, body, user }) => {
      if (!user) throw needLogin();
      expireUnpaid(); // 입금 기한이 지난 주문을 뒤늦게 "입금 확인"하지 않게 먼저 정리한다
      const rec = db.orderById(params.id);
      if (!rec) throw new HttpError(404, "없는 주문이에요.");
      assertManages(user, rec.storeId);
      if (!ORDER_STATUSES.has(body.status)) throw bad("상태 값이 맞지 않아요.");
      if (!ORDER_NEXT[rec.status].includes(body.status)) throw new HttpError(409, `${rec.status} 상태의 주문은 ${body.status}(으)로 바꿀 수 없어요.`);
      // 입금 대기 → 접수는 사장님의 "입금 확인": 확인 시각을 주문에 남긴다
      if (rec.status === "입금 대기" && body.status === "접수") db.confirmPayment(rec.id, now());
      else db.setOrderStatus(rec.id, body.status);
      return db.orderById(rec.id);
    }],

    // ---- 예약 ----
    ["GET", "/api/reservations", ({ user }) => db.listReservations(recordScope(user))],
    ["POST", "/api/reservations", ({ body, user }) => {
      const people = Number(body.people);
      if (!hasStoreId(body.restaurantId)) throw bad("식당을 알 수 없어요.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) || !/^\d{2}:\d{2}$/.test(String(body.time))) throw bad("날짜·시간이 맞지 않아요.");
      if (!Number.isInteger(people) || people < 1 || people > MAX_PEOPLE) throw bad("인원이 맞지 않아요.");
      // 일시 중지 중에는 오늘 예약만 막는다 (내일 이후 예약은 그대로 받는다)
      if (body.date === todayKST(new Date(now())) && storePaused(body.restaurantId)) throw bad("오늘 예약은 잠시 받지 않아요. 내일 이후 날짜로 예약해 주세요.");
      const who = user ?? GUEST;
      return db.addReservation({
        customer: who.username,
        customerName: who.name,
        restaurantId: body.restaurantId,
        restaurantName: storeName(body.restaurantId) ?? str(body.restaurantName),
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
      if (!RESERVATION_NEXT[rec.status].includes(body.status)) throw new HttpError(409, `${rec.status} 상태의 예약은 ${body.status}(으)로 바꿀 수 없어요.`);
      if (body.status === "방문 완료" && rec.date > todayKST()) throw new HttpError(409, "방문일이 되기 전에는 방문 완료로 바꿀 수 없어요.");
      db.setReservationStatus(rec.id, body.status);
      return db.reservationById(rec.id);
    }],

    // ---- 매장 설정 ----
    // 매장 목록: 목록 파일의 매장 + 관리자가 직접 만든 매장 (source: "admin")
    ["GET", "/api/stores", () => allStores(db)],
    ["GET", "/api/stores/settings", () => Object.fromEntries(Object.entries(db.allStoreSettings()).map(([id, s]) => [id, liveSettings(s)]))],
    // 챗봇 추천용: 최근 30일 메뉴별 주문 수(배달 메뉴 id 로)와 식당별 예약 수. 개인 정보 없이 숫자만
    ["GET", "/api/stats/popular", () => {
      const { items, restaurants } = db.popularity(Date.now() - 30 * 24 * 60 * 60_000);
      const byMenuId = {};
      for (const [key, n] of Object.entries(items)) {
        const [storeId, name] = key.split("|");
        const item = db.menuItemByName(storeId, name);
        if (item) byMenuId[item.id] = (byMenuId[item.id] ?? 0) + n;
      }
      return { items: byMenuId, restaurants };
    }],
    // ---- 입금 계좌 (결제는 계좌이체만) ----
    ["GET", "/api/stores/:id/bank", ({ params, user }) => {
      if (!hasStoreId(params.id)) throw new HttpError(404, "없는 매장이에요.");
      assertManages(user, params.id);
      return { account: db.bankAccount(params.id) };
    }],
    ["PUT", "/api/stores/:id/bank", ({ params, body, user }) => {
      if (!hasStoreId(params.id)) throw new HttpError(404, "없는 매장이에요.");
      assertManages(user, params.id);
      const account = cleanBankAccount(body);
      if (account.error) throw bad(account.error);
      return { account: db.setBankAccount(params.id, account) };
    }],
    ["DELETE", "/api/stores/:id/bank", ({ params, user }) => {
      if (!hasStoreId(params.id)) throw new HttpError(404, "없는 매장이에요.");
      assertManages(user, params.id);
      db.setBankAccount(params.id, null);
      return { account: null };
    }],
    ["GET", "/api/bank", ({ user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      return db.allBankAccounts();
    }],

    // ---- 배달 메뉴 ----
    ["GET", "/api/menu", () => listedMenu(db)],
    // 사장님이 메뉴 추가: 바로 판매된다. 그 매장의 음식 종류 이름("치킨")은 자동으로 키워드에 넣어 챗봇이 찾을 수 있게
    ["POST", "/api/stores/:id/menu", ({ params, body, user }) => {
      if (!hasStoreId(params.id)) throw new HttpError(404, "없는 매장이에요.");
      assertManages(user, params.id);
      const name = str(body.name, MENU_NAME_MAX + 1);
      if (!name || name.length > MENU_NAME_MAX) throw bad(`메뉴 이름을 1~${MENU_NAME_MAX}자로 적어 주세요.`);
      if (activeMenuItem(params.id, name)) throw bad("이미 판매 중인 같은 이름의 메뉴가 있어요.");
      const price = Number(body.price);
      if (!Number.isInteger(price) || price < MENU_PRICE_MIN || price > MENU_PRICE_MAX) {
        throw bad(`가격은 ${MENU_PRICE_MIN.toLocaleString("ko-KR")}원부터 ${MENU_PRICE_MAX.toLocaleString("ko-KR")}원까지 적어 주세요.`);
      }
      const unit = str(body.unit, MENU_UNIT_MAX + 1);
      if (!unit || unit.length > MENU_UNIT_MAX) throw bad("단위(마리·판·인분 등)를 골라 주세요.");
      const given = Array.isArray(body.keywords) ? body.keywords : [];
      const squash = (s) => String(s).replace(/\s+/g, "").toLowerCase();
      const keywords = [...new Set([...given.map(squash), squash(foodLabel(findStore(db, params.id)?.food) ?? "")])].filter((k) => k && k.length <= 15).slice(0, MENU_KEYWORDS_MAX);
      return db.addMenuItem({ restaurantId: params.id, name, price, unit, keywords });
    }],
    // 판매 중지·다시 판매. 지운 것처럼 챗봇과 주문에서 빠지지만, 지난 주문 기록은 그대로 남는다
    ["PATCH", "/api/stores/:id/menu/:itemId", ({ params, body, user }) => {
      if (!hasStoreId(params.id)) throw new HttpError(404, "없는 매장이에요.");
      assertManages(user, params.id);
      const item = db.menuItem(params.itemId);
      if (!item || item.restaurantId !== params.id) throw new HttpError(404, "없는 메뉴예요.");
      if (typeof body.active !== "boolean") throw bad("판매 여부(active)를 보내 주세요.");
      if (body.active && !item.active && activeMenuItem(params.id, item.name)) throw bad("같은 이름의 메뉴가 이미 판매 중이에요.");
      const updated = db.updateMenuItem(item.id, { active: body.active });
      // 오늘의 메뉴였던 걸 내리면 오늘의 메뉴도 푼다
      if (!body.active && db.allStoreSettings()[params.id]?.special?.itemId === item.id) db.updateStoreSettings(params.id, { special: null });
      return updated;
    }],

    ["PATCH", "/api/stores/:id/settings", ({ params, body, user }) => {
      if (!user) throw needLogin();
      if (!hasStoreId(params.id)) throw new HttpError(404, "없는 매장이에요.");
      assertManages(user, params.id);
      const patch = {};
      if (body.hours !== undefined) {
        const err = hoursError(body.hours);
        if (err) throw bad(err);
        patch.hours = body.hours;
      }
      if (body.item) {
        const id = str(body.item.id, 40);
        if (db.menuItem(id)?.restaurantId !== params.id) throw bad("메뉴를 알 수 없어요.");
        const p = body.item.patch ?? {};
        const itemPatch = {};
        if (p.price !== undefined) {
          const price = Number(p.price);
          if (!Number.isFinite(price) || price <= 0) throw bad("가격이 맞지 않아요.");
          itemPatch.price = price;
        }
        if (p.soldOut !== undefined) itemPatch.soldOut = !!p.soldOut;
        if (p.discountPct !== undefined) {
          const pct = Number(p.discountPct);
          if (!Number.isInteger(pct) || pct < 0 || pct > DISCOUNT_MAX) throw bad(`할인율은 0~${DISCOUNT_MAX}% 사이 정수로 적어 주세요.`);
          itemPatch.discountPct = pct;
        }
        if (!id) throw bad("메뉴를 알 수 없어요.");
        patch.item = { id, patch: itemPatch };
      }
      // 오늘의 메뉴: 그 매장에서 판매 중인 메뉴만. null 이면 해제
      if (body.special !== undefined) {
        if (body.special === null) patch.special = null;
        else {
          const item = db.menuItem(str(body.special?.itemId, 40));
          if (!item || item.restaurantId !== params.id || !item.active) throw bad("오늘의 메뉴는 이 매장에서 판매 중인 메뉴로 골라 주세요.");
          patch.special = { itemId: item.id, date: todayKST() };
        }
      }
      // 일시 중지: 사장님이 고른 시각까지. null 이면 바로 다시 받는다
      if (body.pause !== undefined) {
        if (body.pause === null) {
          patch.pausedFrom = null;
          patch.pausedUntil = null;
        } else {
          const until = Number(body.pause?.until);
          // 시작 시각이 없거나 이미 지났으면 지금부터
          const asked = body.pause?.from === undefined || body.pause?.from === null ? now() : Number(body.pause.from);
          if (!Number.isInteger(until) || !Number.isInteger(asked) || until > now() + PAUSE_MAX_MS) throw bad("일시 중지는 지금부터 24시간 안의 시각으로 정해 주세요.");
          const from = Math.max(asked, now());
          if (until <= from) throw bad("종료 시간은 시작 시간보다 뒤여야 해요.");
          patch.pausedFrom = from; // 실제로 멈추기 시작하는 시각 (사장님 화면의 시작 시간 칸에 보인다)
          patch.pausedUntil = until;
        }
      }
      return liveSettings(db.updateStoreSettings(params.id, patch));
    }],

    // ---- 관리자: 사장님·고객님 ----
    ["GET", "/api/owners", ({ user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      return db.listByRole("owner");
    }],
    ["POST", "/api/owners", ({ body, user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      // 관리자 화면은 새 매장(newStore: 이름·음식 종류·영업시간·주소)을 입력해 매장과 사장님 계정을 함께 만든다.
      // 이미 있는 매장(storeId)에 붙이는 것도 API 로는 받는다 (목록 파일의 매장처럼 사장님이 아직 없는 매장).
      // 사장님 이름은 늘 "매장 이름 사장님"으로 정한다
      if (body.newStore) {
        const store = cleanNewStore(body.newStore);
        if (store.error) throw bad(store.error);
        if (allStores(db).some((s) => sameStoreName(s.name, store.name))) throw bad("같은 이름의 매장이 이미 있어요.");
        // 계정 입력을 먼저 검사해서, 아이디가 겹치는 등으로 계정을 못 만들면 매장도 만들지 않는다
        checkAccount({ role: "user", username: body.username, password: body.password, name: `${store.name} 사장님` });
        const created = db.addStore(store);
        return createAccount({ role: "owner", username: body.username, password: body.password, name: `${created.name} 사장님`, storeId: created.id });
      }
      const storeId = str(body.storeId, 40);
      return createAccount({ role: "owner", username: body.username, password: body.password, name: `${storeName(storeId) ?? "매장"} 사장님`, storeId });
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
      forgetStoreBank(target.storeId);
      return { ok: true };
    }],
    ["GET", "/api/users", ({ user }) => {
      if (user?.role !== "admin") throw user ? forbidden() : needLogin();
      // 고객님의 배달지는 관리자 목록에 싣지 않는다 (주문을 받은 가게만 그 주문의 배달지를 본다)
      return db.listByRole("user").map(({ address: _address, ...u }) => u);
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
