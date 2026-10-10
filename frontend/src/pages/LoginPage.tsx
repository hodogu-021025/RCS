import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { HOME_BY_ROLE, login, useSession } from "../auth/auth";
import { PasswordField } from "./PasswordField";

// 아이디·비밀번호로 로그인하고 역할에 맞는 페이지로 보낸다. 계정이 없으면 회원가입으로
export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={HOME_BY_ROLE[session.role]} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await login(username, password);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    navigate(HOME_BY_ROLE[result.session.role], { replace: true });
  }

  return (
    <div className="dash dash-center">
      <form className="dash-card login" onSubmit={onSubmit}>
        <a className="dash-logo dark" href="#/login">
          Saylo
        </a>
        <h1>로그인</h1>
        <label>
          <span>아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <PasswordField label="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary wide" type="submit" disabled={!username.trim() || !password || busy}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
        <a className="btn wide" href="#/signup">
          회원가입
        </a>
        <a className="link-quiet" href="#/chat">
          로그인 없이 챗봇 쓰기
        </a>
      </form>
    </div>
  );
}
