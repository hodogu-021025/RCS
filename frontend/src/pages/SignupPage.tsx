import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { HOME_BY_ROLE, PASSWORD_MIN, USERNAME_RULE, signup, useSession, type SignupInput } from "../auth/auth";
import { normalizeEmail } from "../api/emailVerification";
import { RESTAURANTS } from "../components/orderChatKnowledge";
import { EmailVerifyField } from "./EmailVerifyField";
import { PasswordField } from "./PasswordField";

type SignupRole = SignupInput["role"];
const ROLES: { value: SignupRole; label: string; hint: string }[] = [
  { value: "user", label: "고객님", hint: "챗봇으로 주문·예약하고 내 주문 내역을 볼 수 있어요." },
  { value: "owner", label: "사장님", hint: "내 매장의 주문·예약을 받고 영업시간·메뉴를 관리해요." },
];

// 회원가입: 고객님 / 사장님 중 고르고 계정을 만든다. 가입하면 바로 로그인돼 역할에 맞는 화면으로 간다
export function SignupPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [role, setRole] = useState<SignupRole>("user");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [email, setEmail] = useState("");
  // 인증을 마친 주소와 그때 받은 증표. 주소를 바꾸면 더 쓰지 않는다
  const [verified, setVerified] = useState<{ email: string; proof: string } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={HOME_BY_ROLE[session.role]} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await signup({
      role,
      username,
      name,
      email,
      proof: verified && verified.email === normalizeEmail(email) ? verified.proof : null,
      password,
      passwordConfirm,
      storeId: role === "owner" ? storeId : undefined,
    });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    navigate(HOME_BY_ROLE[result.session.role], { replace: true });
  }

  function pickRole(next: SignupRole) {
    setRole(next);
    setError(null);
  }

  return (
    <div className="dash dash-center">
      <form className="dash-card login signup" onSubmit={onSubmit} noValidate>
        <a className="dash-logo dark" href="#/login">
          Saylo
        </a>
        <h1>회원가입</h1>

        {/* 흰 바탕 칸이 고른 쪽으로 미끄러진다 (data-active, CSS) */}
        <div className="role-switch" role="radiogroup" aria-label="가입 유형" data-active={role}>
          {ROLES.map((r) => (
            <button key={r.value} type="button" role="radio" aria-checked={role === r.value} onClick={() => pickRole(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="role-hint">{ROLES.find((r) => r.value === role)!.hint}</p>

        <label>
          <span>아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder={USERNAME_RULE} autoFocus />
        </label>
        <label>
          <span>{role === "owner" ? "대표자 이름" : "이름"}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        {role === "owner" && (
          <label>
            <span>매장</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">매장을 골라 주세요</option>
              {RESTAURANTS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <EmailVerifyField email={email} onEmailChange={setEmail} verifiedEmail={verified?.email ?? null} onVerified={setVerified} />
        <PasswordField label="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={`${PASSWORD_MIN}자 이상`} />
        <PasswordField
          label="비밀번호 확인"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          autoComplete="new-password"
        />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary wide" type="submit" disabled={busy}>
          {busy ? "가입하는 중…" : `${ROLES.find((r) => r.value === role)!.label}으로 가입하기`}
        </button>
        <a className="btn wide" href="#/login">
          이미 계정이 있어요 · 로그인
        </a>
      </form>
    </div>
  );
}
