// 데모 로그인: 아이디·비밀번호가 정해진 계정 3개(소비자·사장님·관리자) + 관리자가 만든 사장님 계정.
// 로그인 상태는 브라우저(localStorage)에 남는다. 서버가 없으므로 실제 인증은 아니다.
import { useSyncExternalStore } from "react";
import { getDb, type OwnerAccount } from "../data/db";

export type Role = "user" | "owner" | "admin";

export interface Session {
  username: string;
  role: Role;
  name: string;
  storeId?: string; // 사장님만
}

interface Account extends Session {
  password: string;
}

export const DEMO_ACCOUNTS: Account[] = [
  { username: "user", password: "1234", role: "user", name: "김소비" },
  { username: "owner", password: "1234", role: "owner", name: "청전 치킨공방 사장님", storeId: "h3" },
  { username: "admin", password: "1234", role: "admin", name: "관리자" },
];

export const ROLE_LABEL: Record<Role, string> = { user: "소비자", owner: "사장님", admin: "관리자" };
export const HOME_BY_ROLE: Record<Role, string> = { user: "/", owner: "/owner", admin: "/admin" };

const KEY = "saylo.session";
const listeners = new Set<() => void>();
let cacheRaw: string | null | undefined;
let cache: Session | null = null;

export function getSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = raw ? (JSON.parse(raw) as Session) : null;
  }
  return cache;
}

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) notify();
  });
}

export const useSession = () => useSyncExternalStore(subscribe, getSession, getSession);

const ownerToAccount = (o: OwnerAccount): Account => ({ ...o, role: "owner" });

// 아이디·비밀번호가 맞으면 로그인하고 세션을 돌려준다. 틀리면 null
export function login(username: string, password: string): Session | null {
  const all = [...DEMO_ACCOUNTS, ...getDb().owners.map(ownerToAccount)];
  const found = all.find((a) => a.username === username.trim() && a.password === password);
  if (!found) return null;
  const session: Session = { username: found.username, role: found.role, name: found.name };
  if (found.storeId) session.storeId = found.storeId;
  localStorage.setItem(KEY, JSON.stringify(session));
  notify();
  return session;
}

export function logout() {
  localStorage.removeItem(KEY);
  notify();
}

// 관리자 화면용: 모든 사장님 계정 (데모 + 관리자가 만든 것)
export function allOwners(): (OwnerAccount & { builtIn: boolean })[] {
  const demo = DEMO_ACCOUNTS.filter((a) => a.role === "owner").map((a) => ({
    username: a.username,
    password: a.password,
    name: a.name,
    storeId: a.storeId!,
    builtIn: true,
  }));
  return [...demo, ...getDb().owners.map((o) => ({ ...o, builtIn: false }))];
}

export const isUsernameTaken = (username: string) =>
  DEMO_ACCOUNTS.some((a) => a.username === username) || getDb().owners.some((o) => o.username === username);
