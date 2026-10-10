import { useState, type FormEvent } from "react";
import { PASSWORD_MIN, resetAuth, resetPassword } from "../auth/auth";
import { setToken } from "../api/client";
import { normalizeEmail, sendResetCode } from "../api/emailVerification";
import { EmailVerifyField } from "./EmailVerifyField";
import { PasswordField } from "./PasswordField";

// 비밀번호 찾기 (#/reset): 가입할 때 쓴 이메일로 인증하고 새 비밀번호를 정한다. 끝나면 아이디도 알려 준다
export function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState<{ email: string; proof: string } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneFor, setDoneFor] = useState<string | null>(null); // 바꾼 계정의 아이디

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await resetPassword({
      email,
      proof: verified && verified.email === normalizeEmail(email) ? verified.proof : null,
      password,
      passwordConfirm,
    });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // 서버가 이 계정의 로그인을 모두 끊었으므로, 이 브라우저에 남은 로그인 상태도 지운다
    resetAuth();
    setToken(null);
    setDoneFor(result.username);
  }

  return (
    <div className="dash dash-center">
      {doneFor ? (
        <div className="dash-card login">
          <a className="dash-logo dark" href="#/login">
            Saylo
          </a>
          <h1>비밀번호를 바꿨어요</h1>
          <p className="form-notice" role="status">
            아이디는 <b>{doneFor}</b>이에요. 새 비밀번호로 로그인해 주세요.
          </p>
          <a className="btn primary wide" href="#/login">
            로그인하러 가기
          </a>
        </div>
      ) : (
        <form className="dash-card login" onSubmit={onSubmit} noValidate>
          <a className="dash-logo dark" href="#/login">
            Saylo
          </a>
          <h1>비밀번호 찾기</h1>
          <p className="role-hint">가입할 때 쓴 이메일로 인증하면 새 비밀번호를 정할 수 있어요. 아이디도 함께 알려 드려요.</p>
          <EmailVerifyField email={email} onEmailChange={setEmail} verifiedEmail={verified?.email ?? null} onVerified={setVerified} send={sendResetCode} />
          <PasswordField label="새 비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={`${PASSWORD_MIN}자 이상`} />
          <PasswordField label="새 비밀번호 확인" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
          </button>
          <a className="btn wide" href="#/login">
            로그인으로 돌아가기
          </a>
        </form>
      )}
    </div>
  );
}
