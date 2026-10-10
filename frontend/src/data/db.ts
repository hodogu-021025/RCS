// 주문·예약·매장 설정·계정은 API 서버(server/)의 DB 에 있다. 이 파일은 서버에서 받아 온 것을 화면이 쓰기 좋게 들고 있다가,
// 바꾸는 요청을 보낸 뒤 다시 받아 온다. 화면이 떠 있는 동안은 몇 초마다 새로 받아 다른 기기에서 생긴 변화(새 주문 등)를 보여 준다
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client";
import { getSession } from "../auth/auth";
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

export interface Account {
  username: string;
  name: string;
  email?: string;
  storeId?: string; // 사장님
  createdAt: number;
}

interface Db {
  orders: OrderRecord[];
  reservations: ReservationRecord[];
  storeSettings: Record<string, StoreSettings>;
  owners: Account[];
  users: Account[];
  recordsLoaded: boolean; // 주문·예약을 서버에서 한 번이라도 받아 왔는지 (사장님 화면의 새 주문 알림 기준)
}

// 어떤 것을 받아 올지. settings: 영업시간·품절(누구나), records: 주문·예약(로그인한 사람의 범위), accounts: 사장님·고객님 목록(관리자)
export type DbPart = "settings" | "records" | "accounts";
export const POLL_MS = 5000;

let db: Db = { orders: [], reservations: [], storeSettings: {}, owners: [], users: [], recordsLoaded: false };
const listeners = new Set<() => void>();
function patch(next: Partial<Db>) {
  db = { ...db, ...next };
  for (const l of listeners) l();
}
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getDb = () => db;

// 받아 오기. 실패(서버 꺼짐 등)하면 지금 값을 그대로 둔다
export async function refresh(parts: DbPart[]) {
  const session = getSession();
  const jobs: Promise<void>[] = [];
  if (parts.includes("settings")) jobs.push(api<Db["storeSettings"]>("GET", "/api/stores/settings").then((storeSettings) => patch({ storeSettings })));
  if (parts.includes("records") && session) {
    jobs.push(api<OrderRecord[]>("GET", "/api/orders").then((orders) => patch({ orders, recordsLoaded: true })));
    jobs.push(api<ReservationRecord[]>("GET", "/api/reservations").then((reservations) => patch({ reservations })));
  }
  if (parts.includes("accounts") && session?.role === "admin") {
    jobs.push(api<Account[]>("GET", "/api/owners").then((owners) => patch({ owners })));
    jobs.push(api<Account[]>("GET", "/api/users").then((users) => patch({ users })));
  }
  await Promise.allSettled(jobs);
}

// 화면에서: 지정한 것들을 바로 받아 오고, 화면이 떠 있는 동안 몇 초마다 다시 받는다
export function useDb(parts: DbPart[] = ["settings", "records"]): Db {
  const key = parts.join(",");
  useEffect(() => {
    const list = key.split(",") as DbPart[];
    let stopped = false;
    const tick = () => void refresh(list);
    tick();
    const timer = window.setInterval(() => !stopped && tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [key]);
  return useSyncExternalStore(subscribe, getDb, getDb);
}

export const toDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---- 바꾸는 요청들. 성공하면 관련된 것을 다시 받아 온다 ----
export async function addOrder(order: Order, payment: string): Promise<OrderRecord> {
  const rec = await api<OrderRecord>("POST", "/api/orders", { order, payment });
  if (getSession()) await refresh(["records"]);
  return rec;
}

export async function setOrderStatus(id: string, status: OrderStatus) {
  await api("PATCH", `/api/orders/${id}`, { status });
  await refresh(["records"]);
}

export async function addReservation(r: { restaurantId: string; restaurantName: string; date: Date; time: string; people: number }): Promise<ReservationRecord> {
  const rec = await api<ReservationRecord>("POST", "/api/reservations", { ...r, date: toDateKey(r.date) });
  if (getSession()) await refresh(["records"]);
  return rec;
}

export async function setReservationStatus(id: string, status: ReservationStatus) {
  await api("PATCH", `/api/reservations/${id}`, { status });
  await refresh(["records"]);
}

export const getStoreSettings = (storeId: string): StoreSettings => db.storeSettings[storeId] ?? {};

export async function setStoreHours(storeId: string, hours: string) {
  await api("PATCH", `/api/stores/${storeId}/settings`, { hours });
  await refresh(["settings"]);
}

export async function setMenuItem(storeId: string, itemId: string, itemPatch: { price?: number; soldOut?: boolean }) {
  await api("PATCH", `/api/stores/${storeId}/settings`, { item: { id: itemId, patch: itemPatch } });
  await refresh(["settings"]);
}

export async function addOwner(account: { username: string; password: string; name: string; storeId: string }) {
  await api("POST", "/api/owners", account);
  await refresh(["accounts"]);
}

export async function removeOwner(username: string) {
  await api("DELETE", `/api/owners/${encodeURIComponent(username)}`);
  await refresh(["accounts"]);
}

// 테스트용: 들고 있던 값을 비운다
export function resetDb() {
  patch({ orders: [], reservations: [], storeSettings: {}, owners: [], users: [], recordsLoaded: false });
}
