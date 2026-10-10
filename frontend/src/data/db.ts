// 브라우저(localStorage)에 두는 데모 데이터베이스: 주문·예약 내역, 사장님이 바꾼 매장 설정, 관리자가 만든 사장님 계정.
// 서버가 없어서 같은 브라우저 안에서만 공유된다 (다른 탭에는 storage 이벤트로 전달). 실제 서비스에서는 이 파일을 API 호출로 바꾸면 된다.
import { useSyncExternalStore } from "react";
import type { Order } from "../components/orderChatKnowledge";

export type OrderStatus = "접수" | "준비 중" | "완료" | "취소";
export type ReservationStatus = "예약 확정" | "방문 완료" | "취소";

export interface OrderRecord {
  id: string;
  createdAt: number; // epoch ms
  status: OrderStatus;
  customer: string; // 로그인 아이디, 비로그인은 "guest"
  customerName: string;
  payment: string; // 결제수단 이름
  storeId: string; // 식당 id
  order: Order;
}

export interface ReservationRecord {
  id: string;
  createdAt: number;
  status: ReservationStatus;
  customer: string;
  customerName: string;
  restaurantId: string;
  restaurantName: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
  people: number;
}

// 사장님이 바꾼 값만 담는다. 없는 항목은 코드의 기본값(orderChatKnowledge)을 쓴다
export interface StoreSettings {
  hours?: string; // "11:00 - 21:00"
  items?: Record<string, { price?: number; soldOut?: boolean }>; // 배달 메뉴 id 별
}

export interface OwnerAccount {
  username: string;
  password: string; // 데모라서 그대로 저장한다
  name: string;
  storeId: string;
  email?: string; // 회원가입한 사장님만 (관리자가 만든 계정은 없음)
}

// 회원가입한 소비자
export interface UserAccount {
  username: string;
  password: string; // 데모라서 그대로 저장한다
  name: string;
  email?: string; // 인증한 이메일 (이메일 인증을 넣기 전에 가입한 계정은 없음)
  createdAt: number;
}

interface Db {
  orders: OrderRecord[];
  reservations: ReservationRecord[];
  storeSettings: Record<string, StoreSettings>;
  owners: OwnerAccount[];
  users: UserAccount[];
}

const KEY = "saylo.db";
const EMPTY: Db = { orders: [], reservations: [], storeSettings: {}, owners: [], users: [] };

let cacheRaw: string | null | undefined;
let cache: Db = EMPTY;
const listeners = new Set<() => void>();

// localStorage 의 원문이 바뀌었을 때만 다시 파싱해서, 같은 내용이면 같은 객체를 돌려준다 (useSyncExternalStore 가 요구)
export function getDb(): Db {
  const raw = localStorage.getItem(KEY);
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = raw ? { ...EMPTY, ...parseDb(raw) } : EMPTY;
  }
  return cache;
}

// 손상된 값(잘린 JSON 등)이 들어 있어도 화면이 죽지 않게 빈 데이터로 본다
function parseDb(raw: string): Partial<Db> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const db = parsed as Partial<Db>;
    // 쇼핑·예매를 없애기 전에 저장된 주문(보기용 기록 포함)은 빼고 배달 주문만 남긴다
    if (Array.isArray(db.orders)) db.orders = db.orders.filter((o) => !["shop", "ticket"].includes((o?.order as { kind?: string } | undefined)?.kind ?? ""));
    return db;
  } catch {
    return {};
  }
}

function notify() {
  for (const l of listeners) l();
}

export function updateDb(mutate: (db: Db) => void) {
  const next: Db = structuredClone(getDb());
  mutate(next);
  localStorage.setItem(KEY, JSON.stringify(next));
  notify();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 다른 탭에서 바뀌면 이 탭도 갱신한다
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) notify();
  });
}

export function useDb(): Db {
  return useSyncExternalStore(subscribe, getDb, getDb);
}

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const toDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Who {
  username: string;
  name: string;
}
const GUEST: Who = { username: "guest", name: "비회원" };

export function addOrder(order: Order, payment: string, who: Who | null = null): OrderRecord {
  const w = who ?? GUEST;
  const record: OrderRecord = {
    id: newId("o"),
    createdAt: Date.now(),
    status: "접수",
    customer: w.username,
    customerName: w.name,
    payment,
    storeId: order.storeId ?? order.store.name,
    order,
  };
  updateDb((db) => db.orders.unshift(record));
  return record;
}

export function setOrderStatus(id: string, status: OrderStatus) {
  updateDb((db) => {
    const o = db.orders.find((r) => r.id === id);
    if (o) o.status = status;
  });
}

export function addReservation(
  r: { restaurantId: string; restaurantName: string; date: Date; time: string; people: number },
  who: Who | null = null,
): ReservationRecord {
  const w = who ?? GUEST;
  const record: ReservationRecord = {
    id: newId("r"),
    createdAt: Date.now(),
    status: "예약 확정",
    customer: w.username,
    customerName: w.name,
    restaurantId: r.restaurantId,
    restaurantName: r.restaurantName,
    date: toDateKey(r.date),
    time: r.time,
    people: r.people,
  };
  updateDb((db) => db.reservations.unshift(record));
  return record;
}

export function setReservationStatus(id: string, status: ReservationStatus) {
  updateDb((db) => {
    const r = db.reservations.find((x) => x.id === id);
    if (r) r.status = status;
  });
}

export const getStoreSettings = (storeId: string): StoreSettings => getDb().storeSettings[storeId] ?? {};

export function setStoreHours(storeId: string, hours: string) {
  updateDb((db) => {
    db.storeSettings[storeId] = { ...db.storeSettings[storeId], hours };
  });
}

export function setMenuItem(storeId: string, itemId: string, patch: { price?: number; soldOut?: boolean }) {
  updateDb((db) => {
    const s = (db.storeSettings[storeId] ??= {});
    s.items = { ...s.items, [itemId]: { ...s.items?.[itemId], ...patch } };
  });
}

export function addOwner(account: OwnerAccount) {
  updateDb((db) => {
    db.owners = db.owners.filter((o) => o.username !== account.username);
    db.owners.push(account);
  });
}

export function addUser(account: UserAccount) {
  updateDb((db) => {
    db.users.push(account);
  });
}

export function removeOwner(username: string) {
  updateDb((db) => {
    db.owners = db.owners.filter((o) => o.username !== username);
  });
}

// 처음 열었을 때 사장님·관리자 화면이 비어 보이지 않게 넣는 보기용 기록. 이미 데이터가 있으면 건드리지 않는다
export function seedDemoData(make: () => { orders: OrderRecord[]; reservations: ReservationRecord[] }) {
  if (localStorage.getItem(KEY) !== null) return;
  const { orders, reservations } = make();
  localStorage.setItem(KEY, JSON.stringify({ ...EMPTY, orders, reservations }));
  notify();
}

// 테스트용: 캐시까지 비운다
export function resetDb() {
  localStorage.removeItem(KEY);
  cacheRaw = undefined;
  cache = EMPTY;
  notify();
}
