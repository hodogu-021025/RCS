// SQLite 저장소 (Node 내장 node:sqlite, 외부 패키지 없음). 파일 하나에 계정·세션·주문·예약·매장 설정을 둔다.
// 서버를 여러 대로 늘리거나 더 커지면 이 파일만 Postgres 등으로 바꾸면 된다 (API 는 그대로).
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE,
    role          TEXT NOT NULL CHECK (role IN ('user', 'owner', 'admin')),
    store_id      TEXT,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id            TEXT PRIMARY KEY,
    created_at    INTEGER NOT NULL,
    status        TEXT NOT NULL,
    customer      TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    payment       TEXT NOT NULL,
    store_id      TEXT NOT NULL,
    order_json    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS orders_store ON orders(store_id, created_at);
  CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer, created_at);
  CREATE TABLE IF NOT EXISTS reservations (
    id              TEXT PRIMARY KEY,
    created_at      INTEGER NOT NULL,
    status          TEXT NOT NULL,
    customer        TEXT NOT NULL,
    customer_name   TEXT NOT NULL,
    restaurant_id   TEXT NOT NULL,
    restaurant_name TEXT NOT NULL,
    date            TEXT NOT NULL,
    time            TEXT NOT NULL,
    people          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reservations_store ON reservations(restaurant_id, created_at);
  CREATE INDEX IF NOT EXISTS reservations_customer ON reservations(customer, created_at);
  CREATE TABLE IF NOT EXISTS store_settings (
    store_id   TEXT PRIMARY KEY,
    hours      TEXT,
    items_json TEXT NOT NULL DEFAULT '{}'
  );
  -- 배달 메뉴. 목록 파일(catalog.json)의 메뉴(source=catalog)와 사장님이 추가한 메뉴(source=owner).
  -- 삭제하지 않고 active=0 (판매 중지)로 숨긴다: 지난 주문 기록이 메뉴 이름을 그대로 가리키게
  CREATE TABLE IF NOT EXISTS menu_items (
    id            TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    name          TEXT NOT NULL,
    price         INTEGER NOT NULL,
    unit          TEXT NOT NULL,
    keywords_json TEXT NOT NULL DEFAULT '[]',
    active        INTEGER NOT NULL DEFAULT 1,
    source        TEXT NOT NULL DEFAULT 'catalog',
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS menu_store ON menu_items(restaurant_id);
  -- 관리자가 사장님 계정을 만들며 직접 입력한 매장. 목록 파일(catalog.json)의 매장과 합쳐서 쓴다.
  -- 목록 파일의 매장은 여기에 넣지 않는다 (목록 파일에서 뺀 매장이 DB 에 남아 되살아나지 않게)
  CREATE TABLE IF NOT EXISTS stores (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    food       TEXT NOT NULL,
    hours      TEXT NOT NULL,
    address    TEXT,
    signature  TEXT,
    created_at INTEGER NOT NULL
  );
  -- 매장 입금 계좌 (결제는 계좌이체만). 사장님이 등록해야 그 매장이 배달 주문을 받는다
  CREATE TABLE IF NOT EXISTS bank_accounts (
    store_id   TEXT PRIMARY KEY,
    bank       TEXT NOT NULL,
    account    TEXT NOT NULL,
    holder     TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;


const toSettings = (r) => ({
  ...(r.hours ? { hours: r.hours } : {}),
  items: JSON.parse(r.items_json),
  ...(r.special_json ? { special: JSON.parse(r.special_json) } : {}),
  ...(r.paused_from ? { pausedFrom: r.paused_from } : {}),
  ...(r.paused_until ? { pausedUntil: r.paused_until } : {}),
});

// 관리자가 만든 매장을 목록 파일(catalog.json)의 restaurants 모양으로. 비어 있는 칸은 빼고, source 로 구분한다
const toStore = (r) =>
  r && {
    id: r.id,
    name: r.name,
    food: r.food,
    hours: r.hours,
    ...(r.address ? { address: r.address } : {}),
    ...(r.signature ? { signature: r.signature } : {}),
    source: "admin",
  };

const toMenuItem = (r) =>
  r && {
    id: r.id,
    restaurantId: r.restaurant_id,
    name: r.name,
    price: r.price,
    unit: r.unit,
    keywords: JSON.parse(r.keywords_json),
    active: r.active !== 0,
    source: r.source,
    // 세트 메뉴의 맛 고르기 { label, count, options }: 1세트에 count 가지 맛을 options 중에서 하나씩 고른다
    ...(r.choice_json ? { choice: JSON.parse(r.choice_json) } : {}),
  };

const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const toUser = (r) =>
  r && {
    username: r.username,
    name: r.name,
    email: r.email ?? undefined,
    role: r.role,
    storeId: r.store_id ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    createdAt: r.created_at,
    ...(r.role === "owner" ? { approved: r.approved !== 0 } : {}),
  };

// 주문 내용(order_json): { store, storeId, items: [{ item, qty, unit, price, listPrice?, discountPct?, choices?, choiceLabel? }], price(합계), listPrice?(할인 전 합계), address, phone, ... }.
// 장바구니 전에 저장된 메뉴 하나짜리 주문은 item·qty·unit·choices 가 주문 바로 아래에 있다. 읽을 때 items 하나짜리로 바꿔
// 화면·통계가 한 모양만 다루게 한다 (DB 는 그대로 둔다)
export function normalizeOrder(o) {
  if (Array.isArray(o.items)) return o;
  const { item, qty, unit, discountPct, listPrice, choices, choiceLabel, ...rest } = o;
  const line = {
    item,
    qty,
    unit,
    price: o.price,
    ...(discountPct ? { discountPct, listPrice } : {}),
    ...(choices ? { choices, ...(choiceLabel ? { choiceLabel } : {}) } : {}),
  };
  return { ...rest, items: [line], ...(discountPct && listPrice !== undefined ? { listPrice } : {}) };
}

const toOrder = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  status: r.status,
  customer: r.customer,
  customerName: r.customer_name,
  payment: r.payment,
  storeId: r.store_id,
  order: normalizeOrder(JSON.parse(r.order_json)),
});

const toReservation = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  status: r.status,
  customer: r.customer,
  customerName: r.customer_name,
  restaurantId: r.restaurant_id,
  restaurantName: r.restaurant_name,
  date: r.date,
  time: r.time,
  people: r.people,
});

// path: 파일 경로. ":memory:" 면 메모리에만 (테스트)
// 탈퇴한 회원의 주문·예약에 남는 주문자
export const WITHDRAWN = { customer: "~withdrawn", name: "탈퇴한 회원" };

// 주문(대금결제·재화 공급) 기록의 법정 보관 기간. 지나면 지운다 (개인정보 처리방침 3번)
export const ORDER_KEEP_YEARS = 5;

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // 예전에 비회원 주문 조회·취소에 쓰던 영수증 번호 칸. 배달 주문이 회원 전용이 되면서 더 쓰지 않아 비워 둔다
  // (칸은 예전 DB와 모양을 맞추려고 남긴다)
  if (!db.prepare("PRAGMA table_info(orders)").all().some((c) => c.name === "receipt")) db.exec("ALTER TABLE orders ADD COLUMN receipt TEXT");
  db.exec("UPDATE orders SET receipt = NULL WHERE receipt IS NOT NULL");
  // 예전에 잠깐 있던 관리자 기본 계좌(store_id 'default')는 쓰지 않는다. 남아 있으면 지운다
  db.exec("DELETE FROM bank_accounts WHERE store_id = 'default'");
  // 회원가입 때 동의한 개인정보 처리방침 버전(시행일)과 동의 시각. 관리자가 만든 계정은 비어 있다
  // 세트 메뉴의 맛 고르기 (없으면 그냥 메뉴)
  if (!db.prepare("PRAGMA table_info(menu_items)").all().some((c) => c.name === "choice_json")) db.exec("ALTER TABLE menu_items ADD COLUMN choice_json TEXT");
  const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!userCols.includes("privacy_version")) db.exec("ALTER TABLE users ADD COLUMN privacy_version TEXT");
  if (!userCols.includes("privacy_agreed_at")) db.exec("ALTER TABLE users ADD COLUMN privacy_agreed_at INTEGER");
  // 사장님 승인: 스스로 가입한 사장님은 관리자가 승인하기 전까지 매장 정보를 볼 수 없다. 이 칸이 생기기 전 계정은 승인된 것으로 본다
  if (!userCols.includes("approved")) db.exec("ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1");
  // 연락처(가입할 때 받는다)와 배달지(고객님이 계정 관리에서 적는다). 이 칸이 생기기 전 계정은 비어 있다
  if (!userCols.includes("phone")) db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  if (!userCols.includes("address")) db.exec("ALTER TABLE users ADD COLUMN address TEXT");
  // 오늘의 메뉴 { itemId, date }: 그 날짜(한국 시간)에만 오늘의 메뉴로 보인다
  if (!db.prepare("PRAGMA table_info(store_settings)").all().some((c) => c.name === "special_json")) db.exec("ALTER TABLE store_settings ADD COLUMN special_json TEXT");
  // 일시 중지가 끝나는 시각(밀리초). 비어 있거나 지난 시각이면 주문을 받는다
  if (!db.prepare("PRAGMA table_info(store_settings)").all().some((c) => c.name === "paused_until")) db.exec("ALTER TABLE store_settings ADD COLUMN paused_until INTEGER");
  // 일시 중지가 시작되는 시각(밀리초). 미리 정해 두면 앞으로의 시각, 바로 멈추면 그 순간. 비어 있으면 끝나는 시각까지 멈춘 것
  if (!db.prepare("PRAGMA table_info(store_settings)").all().some((c) => c.name === "paused_from")) db.exec("ALTER TABLE store_settings ADD COLUMN paused_from INTEGER");
  const q = (sql) => db.prepare(sql);

  const stmts = {
    userByName: q("SELECT * FROM users WHERE username = ?"),
    userByEmail: q("SELECT * FROM users WHERE email = ?"),
    usersByRole: q("SELECT * FROM users WHERE role = ? ORDER BY created_at"),
    insertUser: q("INSERT INTO users (username, password_hash, name, email, role, store_id, created_at, privacy_version, privacy_agreed_at, approved, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    setContact: q("UPDATE users SET phone = ?, address = ? WHERE username = ?"),
    approveOwner: q("UPDATE users SET approved = 1 WHERE username = ? AND role = 'owner'"),
    userByEmail: q("SELECT * FROM users WHERE email = ?"),
    setPassword: q("UPDATE users SET password_hash = ? WHERE username = ?"),
    deleteSessionsOf: q("DELETE FROM sessions WHERE username = ?"),
    privacyConsent: q("SELECT privacy_version, privacy_agreed_at FROM users WHERE username = ?"),
    deleteUser: q("DELETE FROM users WHERE username = ?"),
    insertMenuIfMissing: q("INSERT OR IGNORE INTO menu_items (id, restaurant_id, name, price, unit, keywords_json, active, source, created_at, choice_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'catalog', ?, ?)"),
    insertMenu: q("INSERT INTO menu_items (id, restaurant_id, name, price, unit, keywords_json, active, source, created_at, choice_json) VALUES (?, ?, ?, ?, ?, ?, 1, 'owner', ?, ?)"),
    listMenu: q("SELECT * FROM menu_items ORDER BY rowid"),
    menuById: q("SELECT * FROM menu_items WHERE id = ?"),
    listStores: q("SELECT * FROM stores ORDER BY created_at, rowid"),
    storeById: q("SELECT * FROM stores WHERE id = ?"),
    insertStore: q("INSERT INTO stores (id, name, food, hours, address, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    menuByName: q("SELECT * FROM menu_items WHERE restaurant_id = ? AND name = ? ORDER BY active DESC, rowid DESC LIMIT 1"),
    updateMenu: q("UPDATE menu_items SET name = ?, unit = ?, keywords_json = ?, active = ?, choice_json = ? WHERE id = ?"),
    anonymizeOrders: q("UPDATE orders SET customer = ?, customer_name = ?, receipt = NULL WHERE customer = ?"),
    ordersOf: q("SELECT id, order_json FROM orders WHERE customer = ?"),
    setOrderJson: q("UPDATE orders SET order_json = ? WHERE id = ?"),
    anonymizeReservations: q("UPDATE reservations SET customer = ?, customer_name = ? WHERE customer = ?"),
    countRole: q("SELECT COUNT(*) AS n FROM users WHERE role = ?"),

    insertSession: q("INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    sessionUser: q("SELECT u.* FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? AND s.expires_at > ?"),
    deleteSession: q("DELETE FROM sessions WHERE token = ?"),
    sweepSessions: q("DELETE FROM sessions WHERE expires_at <= ?"),

    insertOrder: q("INSERT INTO orders (id, created_at, status, customer, customer_name, payment, store_id, order_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    orderById: q("SELECT * FROM orders WHERE id = ?"),
    purgeOrders: q("DELETE FROM orders WHERE created_at < ?"),
    ordersSince: q("SELECT store_id, order_json, status FROM orders WHERE created_at >= ?"),
    reservationsSince: q("SELECT restaurant_id, status FROM reservations WHERE created_at >= ?"),
    allOrders: q("SELECT * FROM orders ORDER BY created_at DESC"),
    ordersByStore: q("SELECT * FROM orders WHERE store_id = ? ORDER BY created_at DESC"),
    ordersByCustomer: q("SELECT * FROM orders WHERE customer = ? ORDER BY created_at DESC"),
    setOrderStatus: q("UPDATE orders SET status = ? WHERE id = ?"),
    confirmPayment: q("UPDATE orders SET status = '접수', order_json = ? WHERE id = ? AND status = '입금 대기'"),
    unpaidBefore: q("SELECT id, order_json FROM orders WHERE status = '입금 대기' AND created_at < ?"),
    expireOrder: q("UPDATE orders SET status = '취소', order_json = ? WHERE id = ? AND status = '입금 대기'"),

    bankById: q("SELECT bank, account, holder FROM bank_accounts WHERE store_id = ?"),
    allBanks: q("SELECT store_id, bank, account, holder FROM bank_accounts"),
    upsertBank: q(
      "INSERT INTO bank_accounts (store_id, bank, account, holder, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(store_id) DO UPDATE SET bank = excluded.bank, account = excluded.account, holder = excluded.holder, updated_at = excluded.updated_at",
    ),
    deleteBank: q("DELETE FROM bank_accounts WHERE store_id = ?"),

    insertReservation: q(
      "INSERT INTO reservations (id, created_at, status, customer, customer_name, restaurant_id, restaurant_name, date, time, people) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    reservationById: q("SELECT * FROM reservations WHERE id = ?"),
    allReservations: q("SELECT * FROM reservations ORDER BY created_at DESC"),
    reservationsByStore: q("SELECT * FROM reservations WHERE restaurant_id = ? ORDER BY created_at DESC"),
    reservationsByCustomer: q("SELECT * FROM reservations WHERE customer = ? ORDER BY created_at DESC"),
    setReservationStatus: q("UPDATE reservations SET status = ? WHERE id = ?"),

    allSettings: q("SELECT * FROM store_settings"),
    settingsById: q("SELECT * FROM store_settings WHERE store_id = ?"),
    upsertSettings: q(
      "INSERT INTO store_settings (store_id, hours, items_json, special_json, paused_from, paused_until) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(store_id) DO UPDATE SET hours = excluded.hours, items_json = excluded.items_json, special_json = excluded.special_json, paused_from = excluded.paused_from, paused_until = excluded.paused_until",
    ),
  };

  return {
    // ---- 계정 ----
    privacyConsent(username) {
      const r = stmts.privacyConsent.get(username);
      return r ? { version: r.privacy_version, agreedAt: r.privacy_agreed_at } : null;
    },
    approveOwner: (username) => stmts.approveOwner.run(username).changes > 0,
    findUserByEmail: (email) => toUser(stmts.userByEmail.get(email)) ?? null,
    // 비밀번호를 바꾸면 다른 기기의 로그인도 모두 끊는다
    setPassword(username, passwordHash) {
      stmts.setPassword.run(passwordHash, username);
      stmts.deleteSessionsOf.run(username);
    },
    findUser: (username) => toUser(stmts.userByName.get(username)) ?? null,
    findUserWithHash: (username) => stmts.userByName.get(username) ?? null,
    emailTaken: (email) => !!stmts.userByEmail.get(email),
    listByRole: (role) => stmts.usersByRole.all(role).map(toUser),
    countByRole: (role) => stmts.countRole.get(role).n,
    // approved: 사장님만 의미가 있다 (스스로 가입하면 false, 관리자가 만들면 true)
    createUser({ username, passwordHash, name, email, role, storeId, privacyVersion = null, approved = true, phone }) {
      const now = Date.now();
      stmts.insertUser.run(username, passwordHash, name, email ?? null, role, storeId ?? null, now, privacyVersion, privacyVersion ? now : null, approved ? 1 : 0, phone ?? null);
      return toUser(stmts.userByName.get(username));
    },
    // 연락처·배달지 바꾸기. 넘기지 않은 칸은 그대로 둔다
    updateContact(username, { phone, address }) {
      const cur = stmts.userByName.get(username);
      if (!cur) return null;
      stmts.setContact.run(phone === undefined ? cur.phone : phone, address === undefined ? cur.address : address, username);
      return toUser(stmts.userByName.get(username));
    },
    deleteUser: (username) => stmts.deleteUser.run(username).changes > 0,

    // ---- 배달 메뉴 ----
    // 목록 파일의 메뉴 중 DB 에 없는 것만 넣는다 (이미 있는 메뉴는 사장님이 바꾼 그대로 둔다)
    seedMenu(items) {
      const now = Date.now();
      for (const d of items) {
        stmts.insertMenuIfMissing.run(d.id, d.restaurantId, d.name, d.price, d.unit, JSON.stringify(d.keywords ?? []), d.active === false ? 0 : 1, now, d.choice ? JSON.stringify(d.choice) : null);
      }
    },
    listMenu: () => stmts.listMenu.all().map(toMenuItem),
    menuItem: (id) => toMenuItem(stmts.menuById.get(id)) ?? null,
    // 그 매장의 그 이름 메뉴 (같은 이름이 있으면 판매 중인 것, 그다음 최근 것)
    menuItemByName: (storeId, name) => toMenuItem(stmts.menuByName.get(storeId, name)) ?? null,
    // ---- 관리자가 직접 만든 매장 (목록 파일의 매장과 같은 모양. 거리·평점은 없다) ----
    listStores: () => stmts.listStores.all().map(toStore),
    storeById: (id) => toStore(stmts.storeById.get(id)) ?? null,
    addStore({ name, food, hours, address, signature }) {
      const id = newId("s");
      stmts.insertStore.run(id, name, food, hours, address ?? null, signature ?? null, Date.now());
      return toStore(stmts.storeById.get(id));
    },
    addMenuItem({ restaurantId, name, price, unit, keywords, choice }) {
      const id = newId("m");
      stmts.insertMenu.run(id, restaurantId, name, price, unit, JSON.stringify(keywords), Date.now(), choice ? JSON.stringify(choice) : null);
      return toMenuItem(stmts.menuById.get(id));
    },
    updateMenuItem(id, patch) {
      const cur = toMenuItem(stmts.menuById.get(id));
      if (!cur) return null;
      const next = { ...cur, ...patch };
      stmts.updateMenu.run(next.name, next.unit, JSON.stringify(next.keywords), next.active ? 1 : 0, next.choice ? JSON.stringify(next.choice) : null, id);
      return toMenuItem(stmts.menuById.get(id));
    },
    // 회원 탈퇴: 계정(과 세션)은 지우고, 법에 따라 보관하는 주문·예약 기록은 누구 것인지 알 수 없게 바꿔 남긴다.
    // WITHDRAWN 은 아이디 규칙(영문·숫자·_)에 맞지 않아 같은 이름으로 새로 가입해 옛 기록을 볼 수 없다
    withdrawUser(username) {
      db.exec("BEGIN");
      try {
        // 주문 내용 속 배달지·연락처·입금자명(이름)도 지운다 (메뉴·금액 같은 거래 기록만 남긴다)
        for (const r of stmts.ordersOf.all(username)) {
          const { address, phone, depositor, ...rest } = JSON.parse(r.order_json);
          if (address !== undefined || phone !== undefined || depositor !== undefined) stmts.setOrderJson.run(JSON.stringify(rest), r.id);
        }
        stmts.anonymizeOrders.run(WITHDRAWN.customer, WITHDRAWN.name, username);
        stmts.anonymizeReservations.run(WITHDRAWN.customer, WITHDRAWN.name, username);
        const deleted = stmts.deleteUser.run(username).changes > 0;
        db.exec("COMMIT");
        return deleted;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },

    // ---- 세션 ----
    createSession(token, username, ttlMs) {
      const now = Date.now();
      stmts.insertSession.run(token, username, now, now + ttlMs);
    },
    userByToken: (token) => toUser(stmts.sessionUser.get(token, Date.now())) ?? null,
    deleteSession: (token) => stmts.deleteSession.run(token),
    sweepSessions: () => stmts.sweepSessions.run(Date.now()),

    // ---- 주문 ----
    addOrder({ customer, customerName, payment, storeId, order, status = "접수", createdAt = Date.now() }) {
      const id = newId("o");
      stmts.insertOrder.run(id, createdAt, status, customer, customerName, payment, storeId, JSON.stringify(order));
      return toOrder(stmts.orderById.get(id));
    },
    orderById: (id) => (stmts.orderById.get(id) ? toOrder(stmts.orderById.get(id)) : null),
    // cutoff 전에 들어와 아직 "입금 대기"인 주문을 취소하고(이유를 주문에 적는다) 취소한 건수를 돌려준다
    expireUnpaidOrders(cutoff) {
      let n = 0;
      for (const r of stmts.unpaidBefore.all(cutoff)) {
        const order = { ...JSON.parse(r.order_json), cancelNote: "입금 기한이 지나 자동으로 취소됐어요." };
        n += Number(stmts.expireOrder.run(JSON.stringify(order), r.id).changes);
      }
      return n;
    },
    // 보관 기간(ORDER_KEEP_YEARS)이 지난 주문을 지우고 지운 건수를 돌려준다
    purgeExpiredOrders(now = Date.now()) {
      const cutoff = new Date(now);
      cutoff.setFullYear(cutoff.getFullYear() - ORDER_KEEP_YEARS);
      return Number(stmts.purgeOrders.run(cutoff.getTime()).changes);
    },
    // since 이후 취소되지 않은 주문(메뉴 이름·매장별, 한 주문에 담긴 메뉴마다 1)과 예약(식당별) 수
    popularity(since) {
      const items = {};
      const restaurants = {};
      for (const r of stmts.ordersSince.all(since)) {
        if (r.status === "취소") continue;
        for (const line of normalizeOrder(JSON.parse(r.order_json)).items) {
          const key = `${r.store_id}|${line.item}`;
          items[key] = (items[key] ?? 0) + 1;
        }
      }
      for (const r of stmts.reservationsSince.all(since)) {
        if (r.status === "취소") continue;
        restaurants[r.restaurant_id] = (restaurants[r.restaurant_id] ?? 0) + 1;
      }
      return { items, restaurants };
    },
    listOrders: ({ storeId, customer } = {}) =>
      (storeId ? stmts.ordersByStore.all(storeId) : customer ? stmts.ordersByCustomer.all(customer) : stmts.allOrders.all()).map(toOrder),
    setOrderStatus: (id, status) => stmts.setOrderStatus.run(status, id).changes > 0,
    // 사장님이 입금을 확인: 접수로 바꾸고 확인 시각(paidAt)을 주문에 남긴다 (관리자 거래 내역)
    confirmPayment(id, at) {
      const r = stmts.orderById.get(id);
      if (!r) return false;
      return stmts.confirmPayment.run(JSON.stringify({ ...JSON.parse(r.order_json), paidAt: at }), id).changes > 0;
    },

    // ---- 예약 ----
    addReservation({ customer, customerName, restaurantId, restaurantName, date, time, people }) {
      const id = newId("r");
      stmts.insertReservation.run(id, Date.now(), "예약 확정", customer, customerName, restaurantId, restaurantName, date, time, people);
      return toReservation(stmts.reservationById.get(id));
    },
    reservationById: (id) => (stmts.reservationById.get(id) ? toReservation(stmts.reservationById.get(id)) : null),
    listReservations: ({ storeId, customer } = {}) =>
      (storeId
        ? stmts.reservationsByStore.all(storeId)
        : customer
          ? stmts.reservationsByCustomer.all(customer)
          : stmts.allReservations.all()
      ).map(toReservation),
    setReservationStatus: (id, status) => stmts.setReservationStatus.run(status, id).changes > 0,

    // ---- 입금 계좌 ----
    bankAccount: (storeId) => {
      const r = stmts.bankById.get(storeId);
      return r ? { bank: r.bank, account: r.account, holder: r.holder } : null;
    },
    // { 매장 id: 계좌 }
    allBankAccounts() {
      const out = {};
      for (const r of stmts.allBanks.all()) out[r.store_id] = { bank: r.bank, account: r.account, holder: r.holder };
      return out;
    },
    // account 가 null 이면 지운다
    setBankAccount(storeId, account) {
      if (account) stmts.upsertBank.run(storeId, account.bank, account.account, account.holder, Date.now());
      else stmts.deleteBank.run(storeId);
      return account;
    },

    // ---- 매장 설정 (사장님이 바꾼 값만) ----
    allStoreSettings() {
      const out = {};
      for (const r of stmts.allSettings.all()) out[r.store_id] = toSettings(r);
      return out;
    },
    // patch: { hours?, item?: { id, patch }, special?: { itemId, date } | null, pausedFrom?: 밀리초 | null, pausedUntil?: 밀리초 | null }
    updateStoreSettings(storeId, patch) {
      const cur = stmts.settingsById.get(storeId);
      const hours = patch.hours ?? cur?.hours ?? null;
      const items = cur ? JSON.parse(cur.items_json) : {};
      if (patch.item) {
        const next = { ...items[patch.item.id], ...patch.item.patch };
        if (!next.discountPct) delete next.discountPct; // 할인 0% 는 할인 끔
        items[patch.item.id] = next;
      }
      const special = patch.special !== undefined ? patch.special : cur?.special_json ? JSON.parse(cur.special_json) : null;
      const pausedFrom = patch.pausedFrom !== undefined ? patch.pausedFrom : (cur?.paused_from ?? null);
      const pausedUntil = patch.pausedUntil !== undefined ? patch.pausedUntil : (cur?.paused_until ?? null);
      stmts.upsertSettings.run(storeId, hours, JSON.stringify(items), special ? JSON.stringify(special) : null, pausedFrom, pausedUntil);
      return toSettings({ hours, items_json: JSON.stringify(items), special_json: special ? JSON.stringify(special) : null, paused_from: pausedFrom, paused_until: pausedUntil });
    },

    close: () => db.close(),
  };
}
