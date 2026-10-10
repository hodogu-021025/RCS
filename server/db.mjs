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
  r && { username: r.username, name: r.name, email: r.email ?? undefined, role: r.role, storeId: r.store_id ?? undefined, createdAt: r.created_at };

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
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  const q = (sql) => db.prepare(sql);

  const stmts = {
    userByName: q("SELECT * FROM users WHERE username = ?"),
    userByEmail: q("SELECT * FROM users WHERE email = ?"),
    usersByRole: q("SELECT * FROM users WHERE role = ? ORDER BY created_at"),
    insertUser: q("INSERT INTO users (username, password_hash, name, email, role, store_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    deleteUser: q("DELETE FROM users WHERE username = ?"),
    countRole: q("SELECT COUNT(*) AS n FROM users WHERE role = ?"),

    insertSession: q("INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    sessionUser: q("SELECT u.* FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? AND s.expires_at > ?"),
    deleteSession: q("DELETE FROM sessions WHERE token = ?"),
    sweepSessions: q("DELETE FROM sessions WHERE expires_at <= ?"),

    insertOrder: q("INSERT INTO orders (id, created_at, status, customer, customer_name, payment, store_id, order_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    orderById: q("SELECT * FROM orders WHERE id = ?"),
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
    findUser: (username) => toUser(stmts.userByName.get(username)) ?? null,
    findUserWithHash: (username) => stmts.userByName.get(username) ?? null,
    emailTaken: (email) => !!stmts.userByEmail.get(email),
    listByRole: (role) => stmts.usersByRole.all(role).map(toUser),
    countByRole: (role) => stmts.countRole.get(role).n,
    createUser({ username, passwordHash, name, email, role, storeId }) {
      stmts.insertUser.run(username, passwordHash, name, email ?? null, role, storeId ?? null, Date.now());
      return toUser(stmts.userByName.get(username));
    },
    deleteUser: (username) => stmts.deleteUser.run(username).changes > 0,

    // ---- 세션 ----
    createSession(token, username, ttlMs) {
      const now = Date.now();
      stmts.insertSession.run(token, username, now, now + ttlMs);
    },
    userByToken: (token) => toUser(stmts.sessionUser.get(token, Date.now())) ?? null,
    deleteSession: (token) => stmts.deleteSession.run(token),
    sweepSessions: () => stmts.sweepSessions.run(Date.now()),

    // ---- 주문 ----
    addOrder({ customer, customerName, payment, storeId, order }) {
      const id = newId("o");
      stmts.insertOrder.run(id, Date.now(), "접수", customer, customerName, payment, storeId, JSON.stringify(order));
      return toOrder(stmts.orderById.get(id));
    },
    orderById: (id) => (stmts.orderById.get(id) ? toOrder(stmts.orderById.get(id)) : null),
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
