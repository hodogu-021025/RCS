// 데모 로그인: 아이디·비밀번호가 정해진 계정 3개(소비자·사장님·관리자) + 관리자가 만든 사장님 계정 + 회원가입한 소비자.
// 로그인 상태는 브라우저(localStorage)에 남는다. 서버가 없으므로 실제 인증은 아니다.
import { useSyncExternalStore } from "react";
import { normalizeEmail } from "../api/emailVerification";
import { addOwner, addUser, getDb, type OwnerAccount, type UserAccount } from "../data/db";

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
export const HOME_BY_ROLE: Record<Role, string> = { user: "/chat", owner: "/owner", admin: "/admin" };

const KEY = "saylo.session";
const listeners = new Set<() => void>();
let cacheRaw: string | null | undefined;
let cache: Session | null = null;

export function getSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = raw ? parseSession(raw) : null;
  }
  return cache;
}

// 손상된 값이면 로그인 안 된 것으로 본다
function parseSession(raw: string): Session | null {
  try {
    const s: unknown = JSON.parse(raw);
    return s && typeof s === "object" && "username" in s && "role" in s ? (s as Session) : null;
  } catch {
    return null;
  }
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
const userToAccount = ({ username, password, name }: UserAccount): Account => ({ username, password, name, role: "user" });

const allAccounts = (): Account[] => [
  ...DEMO_ACCOUNTS,
  ...getDb().owners.map(ownerToAccount),
  ...getDb().users.map(userToAccount),
];

function startSession(a: Account): Session {
  const session: Session = { username: a.username, role: a.role, name: a.name };
  if (a.storeId) session.storeId = a.storeId;
  localStorage.setItem(KEY, JSON.stringify(session));
  notify();
  return session;
}

// 아이디·비밀번호가 맞으면 로그인하고 세션을 돌려준다. 틀리면 null
export function login(username: string, password: string): Session | null {
  const found = allAccounts().find((a) => a.username === username.trim() && a.password === password);
  return found ? startSession(found) : null;
}

// 회원가입·사장님 계정 만들기가 함께 쓰는 입력 규칙. 문제가 없으면 null
export const USERNAME_RULE = "영문·숫자 8~20자";
export const PASSWORD_MIN = 8;
export function usernameError(username: string): string | null {
  if (!/^[a-z0-9_]{8,20}$/i.test(username)) return `아이디는 ${USERNAME_RULE}로 적어 주세요.`;
  if (isUsernameTaken(username)) return "이미 있는 아이디예요.";
  return null;
}
export const passwordError = (password: string): string | null =>
  password.length < PASSWORD_MIN ? `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.` : null;

// 이미 가입에 쓰인 이메일인지 (대소문자 무시)
export const isEmailTaken = (email: string) => {
  const e = normalizeEmail(email);
  return [...getDb().users, ...getDb().owners].some((a) => a.email === e);
};

export interface SignupInput {
  role: "user" | "owner"; // 고객님 · 사장님
  username: string;
  password: string;
  passwordConfirm: string;
  name: string;
  email: string;
  emailVerified: boolean; // 인증번호 확인을 마쳤는지 (회원가입 화면이 서버에서 확인받은 뒤 true)
  storeId?: string; // 사장님만: 내 매장
}

// 회원가입. 고객님은 회원으로, 사장님은 고른 매장의 사장님 계정으로 만든다 (관리자 화면의 매장·사장님 목록에도 뜬다).
// 맞지 않는 값이 있으면 안내 문구를 돌려주고, 가입되면 바로 로그인한다
export function signup(input: SignupInput): { error: string } | { session: Session } {
  const username = input.username.trim();
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const { password, role, storeId } = input;
  const error =
    usernameError(username) ??
    (!name ? "이름을 적어 주세요." : null) ??
    (role === "owner" && !storeId ? "매장을 골라 주세요." : null) ??
    (!input.emailVerified ? "이메일 인증을 마쳐 주세요." : null) ??
    (isEmailTaken(email) ? "이미 가입된 이메일이에요." : null) ??
    passwordError(password) ??
    (password !== input.passwordConfirm ? "비밀번호가 서로 달라요." : null);
  if (error) return { error };
  if (role === "owner") {
    addOwner({ username, password, name, storeId: storeId!, email });
    return { session: startSession({ username, password, name, role, storeId }) };
  }
  addUser({ username, password, name, email, createdAt: Date.now() });
  return { session: startSession({ username, password, name, role }) };
}

export function logout() {
  localStorage.removeItem(KEY);
  notify();
}

// 관리자 화면용: 모든 사장님 계정 (데모 + 관리자가 만들거나 회원가입한 것)
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

export const isUsernameTaken = (username: string) => allAccounts().some((a) => a.username === username);

// 세션의 계정이 아직 있는지. 관리자가 지운 사장님 계정은 세션이 남아 있어도 로그인으로 치지 않는다
export const accountExists = (session: Session) => isUsernameTaken(session.username);
