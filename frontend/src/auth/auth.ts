// 로그인 상태. 판단은 API 서버가 하고(비밀번호·세션은 서버 DB 에만 있다), 화면은 토큰과 세션 정보만 들고 있다.
// 처음 열 때 저장된 토큰으로 /api/auth/me 를 물어 세션을 되살린다
import { useSyncExternalStore } from "react";
import { ApiError, api, getToken, onUnauthorized, setToken } from "../api/client";
import { normalizeEmail } from "../api/emailVerification";

export type Role = "user" | "owner" | "admin";

export interface Session {
  username: string;
  role: Role;
  name: string;
  storeId?: string; // 사장님만
}

export const ROLE_LABEL: Record<Role, string> = { user: "소비자", owner: "사장님", admin: "관리자" };
export const HOME_BY_ROLE: Record<Role, string> = { user: "/chat", owner: "/owner", admin: "/admin" };

// 회원가입·사장님 계정 만들기가 함께 쓰는 입력 규칙 (서버도 같은 규칙으로 다시 검사한다)
export const USERNAME_RULE = "영문·숫자 8~20자";
export const PASSWORD_MIN = 8;
export const usernameError = (username: string): string | null =>
  /^[a-z0-9_]{8,20}$/i.test(username) ? null : `아이디는 ${USERNAME_RULE}로 적어 주세요.`;
export const passwordError = (password: string): string | null =>
  password.length < PASSWORD_MIN ? `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.` : null;

// ---- 세션 저장소 ----
interface State {
  session: Session | null;
  loaded: boolean; // 처음 /me 응답을 받았는지 (받기 전에는 로그인 페이지로 보내지 않는다)
}
let state: State = { session: null, loaded: !getToken() };
const listeners = new Set<() => void>();
function setState(next: State) {
  state = next;
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getState = () => state;

export const useSession = () => useSyncExternalStore(subscribe, getState, getState).session;
export const useSessionLoaded = () => useSyncExternalStore(subscribe, getState, getState).loaded;
export const getSession = () => state.session;

// 토큰이 더 이상 안 통하면(만료·계정 삭제) 로그아웃 상태로
onUnauthorized(() => {
  setToken(null);
  setState({ session: null, loaded: true });
});

// 테스트용: 로그인 안 된 처음 상태로
export const resetAuth = () => setState({ session: null, loaded: true });

// 앱이 열릴 때 한 번: 저장된 토큰으로 세션을 되살린다
export async function restoreSession() {
  if (!getToken()) return setState({ session: null, loaded: true });
  try {
    const { session } = await api<{ session: Session | null }>("GET", "/api/auth/me");
    if (!session) setToken(null);
    setState({ session, loaded: true });
  } catch (e) {
    // 서버에 못 닿으면 토큰은 두고 로그인 안 된 것으로 보여 준다 (다시 열면 재시도)
    if ((e as ApiError).status !== 401) setState({ session: null, loaded: true });
  }
}

function start({ token, session }: { token: string; session: Session }) {
  setToken(token);
  setState({ session, loaded: true });
  return session;
}

// 아이디·비밀번호가 맞으면 로그인하고 세션을 돌려준다. 틀리면 안내 문구
export async function login(username: string, password: string): Promise<{ session: Session } | { error: string }> {
  try {
    return { session: start(await api("POST", "/api/auth/login", { username: username.trim(), password })) };
  } catch (e) {
    return { error: (e as ApiError).message };
  }
}

export async function logout() {
  const token = getToken();
  setToken(null);
  setState({ session: null, loaded: true });
  if (token) await api("POST", "/api/auth/logout", {}).catch(() => {});
}

export interface SignupInput {
  role: "user" | "owner"; // 고객님 · 사장님
  username: string;
  password: string;
  passwordConfirm: string;
  name: string;
  email: string;
  proof: string | null; // 이메일 인증을 마치면 받은 증표
  storeId?: string; // 사장님만: 내 매장
}

// 회원가입. 서버가 검사하고 계정을 만들면 바로 로그인된다. 서버에 보내기 전에 바로 알 수 있는 것은 먼저 안내한다
export async function signup(input: SignupInput): Promise<{ error: string } | { session: Session }> {
  const username = input.username.trim();
  const name = input.name.trim();
  const { password, role, storeId } = input;
  const error =
    usernameError(username) ??
    (!name ? "이름을 적어 주세요." : null) ??
    (role === "owner" && !storeId ? "매장을 골라 주세요." : null) ??
    (!input.proof ? "이메일 인증을 마쳐 주세요." : null) ??
    passwordError(password) ??
    (password !== input.passwordConfirm ? "비밀번호가 서로 달라요." : null);
  if (error) return { error };
  try {
    const body = { role, username, password, passwordConfirm: input.passwordConfirm, name, email: normalizeEmail(input.email), proof: input.proof, storeId };
    return { session: start(await api("POST", "/api/auth/signup", body)) };
  } catch (e) {
    return { error: (e as ApiError).message };
  }
}
