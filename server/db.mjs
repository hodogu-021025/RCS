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
`;

const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const toUser = (r) =>
  r && {
    username: r.username,
    name: r.name,
    email: r.email ?? undefined,
    role: r.role,
    storeId: r.store_id ?? undefined,
    createdAt: r.created_at,
    ...(r.role === "owner" ? { approved: r.approved !== 0 } : {}),
  };

const toOrder = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  status: r.status,
  customer: r.customer,
  customerName: r.customer_name,
  payment: r.payment,
  storeId: r.store_id,
  order: JSON.parse(r.order_json),
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

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // 나중에 생긴 칸: 비회원이 자기 주문을 조회·취소할 때 쓰는 영수증 번호
  if (!db.prepare("PRAGMA table_info(orders)").all().some((c) => c.name === "receipt")) db.exec("ALTER TABLE orders ADD COLUMN receipt TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS orders_receipt ON orders(receipt)");
  // 회원가입 때 동의한 개인정보 처리방침 버전(시행일)과 동의 시각. 관리자가 만든 계정은 비어 있다
  const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!userCols.includes("privacy_version")) db.exec("ALTER TABLE users ADD COLUMN privacy_version TEXT");
  if (!userCols.includes("privacy_agreed_at")) db.exec("ALTER TABLE users ADD COLUMN privacy_agreed_at INTEGER");
  // 사장님 승인: 스스로 가입한 사장님은 관리자가 승인하기 전까지 매장 정보를 볼 수 없다. 이 칸이 생기기 전 계정은 승인된 것으로 본다
  if (!userCols.includes("approved")) db.exec("ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1");
  const q = (sql) => db.prepare(sql);

  const stmts = {
    userByName: q("SELECT * FROM users WHERE username = ?"),
    userByEmail: q("SELECT * FROM users WHERE email = ?"),
    usersByRole: q("SELECT * FROM users WHERE role = ? ORDER BY created_at"),
    insertUser: q("INSERT INTO users (username, password_hash, name, email, role, store_id, created_at, privacy_version, privacy_agreed_at, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    approveOwner: q("UPDATE users SET approved = 1 WHERE username = ? AND role = 'owner'"),
    userByEmail: q("SELECT * FROM users WHERE email = ?"),
    setPassword: q("UPDATE users SET password_hash = ? WHERE username = ?"),
    deleteSessionsOf: q("DELETE FROM sessions WHERE username = ?"),
    privacyConsent: q("SELECT privacy_version, privacy_agreed_at FROM users WHERE username = ?"),
    deleteUser: q("DELETE FROM users WHERE username = ?"),
    anonymizeOrders: q("UPDATE orders SET customer = ?, customer_name = ?, receipt = NULL WHERE customer = ?"),
    ordersOf: q("SELECT id, order_json FROM orders WHERE customer = ?"),
    setOrderJson: q("UPDATE orders SET order_json = ? WHERE id = ?"),
    anonymizeReservations: q("UPDATE reservations SET customer = ?, customer_name = ? WHERE customer = ?"),
    countRole: q("SELECT COUNT(*) AS n FROM users WHERE role = ?"),

    insertSession: q("INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    sessionUser: q("SELECT u.* FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? AND s.expires_at > ?"),
    deleteSession: q("DELETE FROM sessions WHERE token = ?"),
    sweepSessions: q("DELETE FROM sessions WHERE expires_at <= ?"),

    insertOrder: q("INSERT INTO orders (id, created_at, status, customer, customer_name, payment, store_id, order_json, receipt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    orderById: q("SELECT * FROM orders WHERE id = ?"),
    orderByReceipt: q("SELECT * FROM orders WHERE receipt = ?"),
    ordersSince: q("SELECT store_id, order_json, status FROM orders WHERE created_at >= ?"),
    reservationsSince: q("SELECT restaurant_id, status FROM reservations WHERE created_at >= ?"),
    allOrders: q("SELECT * FROM orders ORDER BY created_at DESC"),
    ordersByStore: q("SELECT * FROM orders WHERE store_id = ? ORDER BY created_at DESC"),
    ordersByCustomer: q("SELECT * FROM orders WHERE customer = ? ORDER BY created_at DESC"),
    setOrderStatus: q("UPDATE orders SET status = ? WHERE id = ?"),

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
      "INSERT INTO store_settings (store_id, hours, items_json) VALUES (?, ?, ?) ON CONFLICT(store_id) DO UPDATE SET hours = excluded.hours, items_json = excluded.items_json",
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
    createUser({ username, passwordHash, name, email, role, storeId, privacyVersion = null, approved = true }) {
      const now = Date.now();
      stmts.insertUser.run(username, passwordHash, name, email ?? null, role, storeId ?? null, now, privacyVersion, privacyVersion ? now : null, approved ? 1 : 0);
      return toUser(stmts.userByName.get(username));
    },
    deleteUser: (username) => stmts.deleteUser.run(username).changes > 0,
    // 회원 탈퇴: 계정(과 세션)은 지우고, 법에 따라 보관하는 주문·예약 기록은 누구 것인지 알 수 없게 바꿔 남긴다.
    // WITHDRAWN 은 아이디 규칙(영문·숫자·_)에 맞지 않아 같은 이름으로 새로 가입해 옛 기록을 볼 수 없다
    withdrawUser(username) {
      db.exec("BEGIN");
      try {
        // 주문 내용 속 배달지·연락처도 지운다 (메뉴·금액 같은 거래 기록만 남긴다)
        for (const r of stmts.ordersOf.all(username)) {
          const { address, phone, ...rest } = JSON.parse(r.order_json);
          if (address !== undefined || phone !== undefined) stmts.setOrderJson.run(JSON.stringify(rest), r.id);
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
    // receipt: 주문한 사람에게만 주는 번호 (비회원이 나중에 조회·취소할 때)
    addOrder({ customer, customerName, payment, storeId, order, receipt = null }) {
      const id = newId("o");
      stmts.insertOrder.run(id, Date.now(), "접수", customer, customerName, payment, storeId, JSON.stringify(order), receipt);
      return toOrder(stmts.orderById.get(id));
    },
    orderById: (id) => (stmts.orderById.get(id) ? toOrder(stmts.orderById.get(id)) : null),
    orderByReceipt: (receipt) => (stmts.orderByReceipt.get(receipt) ? toOrder(stmts.orderByReceipt.get(receipt)) : null),
    receiptOf: (id) => stmts.orderById.get(id)?.receipt ?? null,
    // since 이후 취소되지 않은 주문(메뉴 이름·매장별)과 예약(식당별) 수
    popularity(since) {
      const items = {};
      const restaurants = {};
      for (const r of stmts.ordersSince.all(since)) {
        if (r.status === "취소") continue;
        const key = `${r.store_id}|${JSON.parse(r.order_json).item}`;
        items[key] = (items[key] ?? 0) + 1;
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

    // ---- 매장 설정 (사장님이 바꾼 값만) ----
    allStoreSettings() {
      const out = {};
      for (const r of stmts.allSettings.all()) out[r.store_id] = { ...(r.hours ? { hours: r.hours } : {}), items: JSON.parse(r.items_json) };
      return out;
    },
    updateStoreSettings(storeId, patch) {
      const cur = stmts.settingsById.get(storeId);
      const hours = patch.hours ?? cur?.hours ?? null;
      const items = cur ? JSON.parse(cur.items_json) : {};
      if (patch.item) items[patch.item.id] = { ...items[patch.item.id], ...patch.item.patch };
      stmts.upsertSettings.run(storeId, hours, JSON.stringify(items));
      return { ...(hours ? { hours } : {}), items };
    },

    close: () => db.close(),
  };
}
