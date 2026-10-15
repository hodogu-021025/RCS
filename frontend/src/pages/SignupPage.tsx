import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { HOME_BY_ROLE, PASSWORD_MIN, USERNAME_RULE, signup, useSession } from "../auth/auth";
import { normalizeEmail } from "../api/emailVerification";
import { EmailVerifyField } from "./EmailVerifyField";
import { PasswordField } from "./PasswordField";
import { PhoneField } from "./PhoneField";
import { PolicyItems } from "./PrivacyPage";
import { SIGNUP_CONSENT } from "./privacyPolicy";

// 회원가입: 고객님 계정을 만든다. 가입하면 바로 로그인돼 챗봇으로 간다.
// 사장님 계정은 관리자가 관리자 화면(매장·사장님 → 계정 만들기)에서 만든다
export function SignupPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // 인증을 마친 주소와 그때 받은 증표. 주소를 바꾸면 더 쓰지 않는다
  const [verified, setVerified] = useState<{ email: string; proof: string } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={HOME_BY_ROLE[session.role]} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await signup({
      username,
      name,
      email,
      phone,
      proof: verified && verified.email === normalizeEmail(email) ? verified.proof : null,
      password,
      passwordConfirm,
      agreePrivacy,
    });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    navigate(HOME_BY_ROLE[result.session.role], { replace: true });
  }

  return (
    <div className="dash dash-center">
      <form className="dash-card login signup" onSubmit={onSubmit} noValidate>
        <a className="dash-logo dark" href="#/login">
          Saylo
        </a>
        <h1>회원가입</h1>

        <p className="role-hint">챗봇으로 주문·예약하고 내 주문 내역을 볼 수 있어요. 사장님 계정은 관리자가 만들어 드려요.</p>

        <label>
          <span>아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder={USERNAME_RULE} autoFocus />
        </label>
        <label>
          <span>이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <PhoneField value={phone} onChange={setPhone} />
        <EmailVerifyField email={email} onEmailChange={setEmail} verifiedEmail={verified?.email ?? null} onVerified={setVerified} />
        <PasswordField label="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={`${PASSWORD_MIN}자 이상`} />
        <PasswordField
          label="비밀번호 확인"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          autoComplete="new-password"
        />

        {/* 필수 동의: 항목·목적·보유 기간·거부할 권리를 펼쳐 볼 수 있고, 전체 방침은 새 탭으로 연다 (입력한 내용이 지워지지 않게) */}
        <div className="consent">
          <label className="consent-check">
            <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
            <span>(필수) 만 14세 이상이며, 개인정보 수집·이용에 동의합니다</span>
          </label>
          <details className="consent-detail">
            <summary>내용 보기</summary>
            <PolicyItems items={SIGNUP_CONSENT} />
            <a href="#/privacy" target="_blank" rel="noopener">
              개인정보 처리방침 전체 보기
            </a>
          </details>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary wide" type="submit" disabled={busy}>
          {busy ? "가입하는 중…" : "가입하기"}
        </button>
        <a className="btn wide" href="#/login">
          이미 계정이 있어요 · 로그인
        </a>
      </form>
    </div>
  );
}
