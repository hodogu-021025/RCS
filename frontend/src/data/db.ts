// 주문·예약·매장 설정·계정은 API 서버(server/)의 DB 에 있다. 이 파일은 서버에서 받아 온 것을 화면이 쓰기 좋게 들고 있다가,
// 바꾸는 요청을 보낸 뒤 다시 받아 온다. 화면이 떠 있는 동안은 몇 초마다 새로 받아 다른 기기에서 생긴 변화(새 주문 등)를 보여 준다
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client";
import { getSession } from "../auth/auth";
import catalog from "../../../server/catalog.json";
import type { BankAccount, DeliveryItem, Order, Restaurant } from "../components/orderChatKnowledge";

// 서버에서 메뉴 목록을 받기 전에 쓰는 처음 목록 (서버도 이 파일로 시작한다)
const CATALOG_MENU = catalog.deliveryMenu as DeliveryItem[];
const CATALOG_STORES = catalog.restaurants as Restaurant[];

// 매장 목록 (목록 파일의 매장 + 관리자가 사장님 계정을 만들며 직접 입력한 매장). 서버에서 받기 전에는 목록 파일의 매장.
// 챗봇·화면 코드가 RESTAURANTS 로 같은 배열을 쓰므로, 새 목록을 받으면 배열을 바꿔 끼우지 않고 안의 내용만 바꾼다
export const STORES: Restaurant[] = [...CATALOG_STORES];
function setStores(list: Restaurant[]) {
  STORES.splice(0, STORES.length, ...list);
  patch({ stores: [...list], storesLoaded: true });
}

// 계좌이체: 주문하면 "입금 대기", 사장님이 입금을 확인하면 "접수"
export type OrderStatus = "입금 대기" | "접수" | "준비 중" | "완료" | "취소";
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
  items?: Record<string, { price?: number; soldOut?: boolean; discountPct?: number }>; // 배달 메뉴 id 별 (discountPct: 할인율 %)
  special?: { itemId: string; date: string }; // 오늘의 메뉴 (date 가 오늘(한국 날짜)일 때만 유효)
  pausedFrom?: number; // 미리 정해 둔 일시 중지가 시작되는 시각(밀리초). 없으면 바로 시작한 것
  pausedUntil?: number; // 일시 중지가 끝나는 시각(밀리초). 그때까지 새 배달 주문과 오늘 예약을 받지 않는다
}

export interface Account {
  username: string;
  name: string;
  email?: string;
  storeId?: string; // 사장님
  approved?: boolean; // 사장님: 관리자 승인 여부
  createdAt: number;
}

// 최근 30일 주문·예약 수 (챗봇 추천 순서). items: 배달 메뉴 id 별, restaurants: 식당 id 별
export interface Popularity {
  items: Record<string, number>;
  restaurants: Record<string, number>;
}

interface Db {
  popular: Popularity;
  stores: Restaurant[]; // 매장 목록 (STORES 와 같은 내용. 바뀌면 화면을 다시 그리려고 둔다)
  storesLoaded: boolean; // 서버에서 매장 목록을 한 번이라도 받아 왔는지 (그 전에는 관리자가 만든 매장을 모른다)
  menu: DeliveryItem[]; // 배달 메뉴 전체 (판매 중지는 active: false). 사장님이 추가한 메뉴도 들어 있다
  orders: OrderRecord[];
  reservations: ReservationRecord[];
  storeSettings: Record<string, StoreSettings>;
  owners: Account[];
  users: Account[];
  recordsLoaded: boolean; // 주문·예약을 서버에서 한 번이라도 받아 왔는지 (사장님 화면의 새 주문 알림 기준)
}

// 어떤 것을 받아 올지. settings: 영업시간·품절(누구나), popular: 인기 통계(누구나), records: 주문·예약(로그인한 사람의 범위), accounts: 사장님·고객님 목록(관리자)
export type DbPart = "settings" | "popular" | "menu" | "records" | "accounts";
export const POLL_MS = 5000;

let db: Db = { popular: { items: {}, restaurants: {} }, stores: CATALOG_STORES, storesLoaded: false, menu: CATALOG_MENU, orders: [], reservations: [], storeSettings: {}, owners: [], users: [], recordsLoaded: false };
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
  if (parts.includes("settings")) {
    // 매장 설정(영업시간·품절)을 보는 화면은 매장 목록도 같이 본다
    jobs.push(api<Db["storeSettings"]>("GET", "/api/stores/settings").then((storeSettings) => patch({ storeSettings })));
    jobs.push(api<Restaurant[]>("GET", "/api/stores").then(setStores));
  }
  if (parts.includes("menu")) jobs.push(api<DeliveryItem[]>("GET", "/api/menu").then((menu) => patch({ menu })));
  if (parts.includes("popular")) jobs.push(api<Popularity>("GET", "/api/stats/popular").then((popular) => patch({ popular })));
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
// 결제는 계좌이체 하나라 결제수단은 보내지 않는다. 돌려받은 주문에 입금 계좌·기한이 들어 있다
export async function addOrder(order: Order): Promise<OrderRecord> {
  const rec = await api<OrderRecord>("POST", "/api/orders", { order });
  if (getSession()) await refresh(["records"]);
  return rec;
}

// ---- 손님의 내 주문 (챗봇의 "내 주문 어디쯤 왔어", "주문 취소할래") ----
// 예전에 비회원 주문 조회용으로 이 브라우저에 남기던 영수증 번호는 더 쓰지 않으므로 지운다
try {
  localStorage.removeItem("saylo.receipts");
} catch {
  // 저장소가 막힌 브라우저면 남은 것도 없다
}

// 내 주문, 최근 것부터. 배달 주문은 로그인한 고객님만 하므로 고객님 계정으로만 찾는다 (사장님·관리자·비회원은 없다)
export async function fetchMyOrders(): Promise<OrderRecord[]> {
  if (getSession()?.role !== "user") return [];
  const list = await api<OrderRecord[]>("GET", "/api/orders");
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export async function cancelMyOrder(id: string): Promise<OrderRecord> {
  const rec = await api<OrderRecord>("POST", `/api/orders/${id}/cancel`, {});
  if (getSession()) await refresh(["records"]);
  return rec;
}

// ---- 입금 계좌 (사장님·관리자) ----
// 매장 계좌. 없으면 그 매장은 배달 주문을 받지 않는다
export interface StoreBank {
  account: BankAccount | null;
}
export const fetchStoreBank = (storeId: string) => api<StoreBank>("GET", `/api/stores/${storeId}/bank`);
export const saveStoreBank = (storeId: string, account: BankAccount) => api<StoreBank>("PUT", `/api/stores/${storeId}/bank`, account);
export const deleteStoreBank = (storeId: string) => api<StoreBank>("DELETE", `/api/stores/${storeId}/bank`);
// 관리자: 등록된 매장 계좌 전체 { 매장 id: 계좌 }
export const fetchAllBanks = () => api<Record<string, BankAccount>>("GET", "/api/bank");

export const getPopularity = (): Popularity => db.popular;
export const getMenu = (): DeliveryItem[] => db.menu;

// ---- 사장님 배달 메뉴 관리 ----
// 메뉴 추가: 바로 판매되고 챗봇에 나온다. keywords 는 손님이 부를 다른 이름 (매장 음식 종류 이름은 서버가 넣는다)
export async function addMenuItem(storeId: string, item: { name: string; price: number; unit: string; keywords: string[] }) {
  const rec = await api<DeliveryItem>("POST", `/api/stores/${storeId}/menu`, item);
  await refresh(["menu"]);
  return rec;
}

// 판매 중지(false)·다시 판매(true). 지우지 않고 숨긴다 (지난 주문 기록은 그대로)
export async function setMenuActive(storeId: string, itemId: string, active: boolean) {
  await api("PATCH", `/api/stores/${storeId}/menu/${itemId}`, { active });
  await refresh(["menu"]);
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
// 지금 일시 중지 중이면 끝나는 시각, 아니면 null. 미리 정해 둔 것은 시작 시각이 지나야 멈춘 것으로 본다
// (정한 시각이 지나면 서버에 다시 묻기 전에도 바로 시작·해제된 것으로 본다)
export function storePausedUntil(storeId: string, now = Date.now()): number | null {
  const { pausedFrom, pausedUntil } = getStoreSettings(storeId);
  return pausedUntil && pausedUntil > now && (pausedFrom ?? 0) <= now ? pausedUntil : null;
}

// 지금 멈춘 중이거나 미리 정해 둔 일시 중지 (사장님·관리자 화면용). active: 이미 시작했는지.
// 시작 시각이 비어 있으면(예전에 바로 멈춘 것) 지금으로 본다
export function storePause(storeId: string, now = Date.now()): { from: number; until: number; active: boolean } | null {
  const { pausedFrom, pausedUntil } = getStoreSettings(storeId);
  if (!pausedUntil || pausedUntil <= now) return null;
  return { from: pausedFrom ?? now, until: pausedUntil, active: (pausedFrom ?? 0) <= now };
}

// 일시 중지: from(없으면 지금)부터 until 까지 새 주문과 오늘 예약을 받지 않는다. null 이면 지우고 바로 다시 받는다
export async function setStorePause(storeId: string, pause: { from?: number; until: number } | null) {
  await api("PATCH", `/api/stores/${storeId}/settings`, { pause });
  await refresh(["settings"]);
}

export async function setStoreHours(storeId: string, hours: string) {
  await api("PATCH", `/api/stores/${storeId}/settings`, { hours });
  await refresh(["settings"]);
}

export async function setMenuItem(storeId: string, itemId: string, itemPatch: { price?: number; soldOut?: boolean; discountPct?: number }) {
  await api("PATCH", `/api/stores/${storeId}/settings`, { item: { id: itemId, patch: itemPatch } });
  await refresh(["settings"]);
}

// 오늘의 메뉴 정하기 (null 이면 해제). 서버가 오늘 날짜를 붙인다
export async function setSpecialMenu(storeId: string, itemId: string | null) {
  await api("PATCH", `/api/stores/${storeId}/settings`, { special: itemId ? { itemId } : null });
  await refresh(["settings"]);
}

// 관리자: 매장 정보(newStore)를 입력해 새 매장과 그 사장님 계정을 함께 만든다. 사장님 이름은 서버가 "매장 이름 사장님"으로 정하고,
// 새 매장은 매장 목록에 바로 들어간다
export interface NewStore {
  name: string;
  food: string;
  hours?: string;
  address?: string;
}
export async function addOwner(account: { username: string; password: string; newStore: NewStore }) {
  await api("POST", "/api/owners", account);
  await refresh(["accounts", "settings"]);
}

// 스스로 가입한 사장님을 승인한다 (거절은 removeOwner)
export async function approveOwner(username: string) {
  await api("POST", `/api/owners/${encodeURIComponent(username)}/approve`, {});
  await refresh(["accounts"]);
}

export async function removeOwner(username: string) {
  await api("DELETE", `/api/owners/${encodeURIComponent(username)}`);
  await refresh(["accounts"]);
}

// 로그아웃·다른 계정 로그인 때: 받아 둔 주문·예약·계정 목록을 비운다 (전 계정의 기록이 새 계정의 "새 주문" 기준이 되지 않게)
export function clearRecords() {
  patch({ orders: [], reservations: [], owners: [], users: [], recordsLoaded: false });
}

// 테스트용: 들고 있던 값을 비운다
export function resetDb() {
  STORES.splice(0, STORES.length, ...CATALOG_STORES);
  patch({ popular: { items: {}, restaurants: {} }, stores: CATALOG_STORES, storesLoaded: false, menu: CATALOG_MENU, orders: [], reservations: [], storeSettings: {}, owners: [], users: [], recordsLoaded: false });
}
