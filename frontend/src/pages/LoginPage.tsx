import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { DEMO_ACCOUNTS, HOME_BY_ROLE, ROLE_LABEL, login, useSession } from "../auth/auth";

// 아이디·비밀번호로 로그인하고 역할에 맞는 페이지로 보낸다. 데모 계정은 화면에 적어 둔다
export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to={HOME_BY_ROLE[session.role]} replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const s = login(username, password);
    if (!s) {
      setError("아이디 또는 비밀번호가 맞지 않아요.");
      return;
    }
    navigate(HOME_BY_ROLE[s.role], { replace: true });
  }

  return (
    <div className="dash dash-center">
      <form className="dash-card login" onSubmit={onSubmit}>
        <a className="dash-logo dark" href="#/chat">
          Saylo
        </a>
        <h1>로그인</h1>
        <label>
          <span>아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>
          <span>비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary wide" type="submit" disabled={!username.trim() || !password}>
          로그인
        </button>
        <a className="btn wide" href="#/chat">
          로그인 없이 챗봇 쓰기
        </a>

        <div className="demo-accounts">
          <span>데모 계정 (비밀번호 1234)</span>
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.username}
              type="button"
              onClick={() => {
                setUsername(a.username);
                setPassword(a.password);
                setError(null);
              }}
            >
              {ROLE_LABEL[a.role]} · {a.username}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
