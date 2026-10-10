import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { HOME_BY_ROLE, ROLE_LABEL, useSession, useSessionLoaded, type Role } from "../auth/auth";

interface Props {
  roles: Role[];
  children: ReactNode;
}

// 로그인하지 않았으면 로그인 페이지로 보내고, 역할이 다르면 안내만 보여 준다.
// 저장된 토큰으로 세션을 되살리는 중에는 잠깐 빈 틀을 보여 준다 (바로 로그인 페이지로 보내면 새로고침 때마다 튕긴다).
// 관리자가 지운 계정은 서버가 토큰을 거절하므로 다음 요청 때 자동으로 로그아웃된다
export function RequireRole({ roles, children }: Props) {
  const session = useSession();
  const loaded = useSessionLoaded();

  if (!loaded) return <div className="dash dash-mobile" aria-busy="true" />;
  if (!session) return <Navigate to="/login" replace />;
  if (!roles.includes(session.role)) {
    return (
      <div className="dash dash-center">
        <div className="dash-card">
          <h2>이 페이지는 {roles.map((r) => ROLE_LABEL[r]).join("·")} 전용이에요</h2>
          <p>
            지금은 {session.name}({ROLE_LABEL[session.role]})으로 로그인되어 있어요.
          </p>
          <div className="dash-actions">
            <a className="btn primary" href={`#${HOME_BY_ROLE[session.role]}`}>
              내 페이지로
            </a>
            <a className="btn" href="#/login">
              다른 계정으로 로그인
            </a>
          </div>
        </div>
      </div>
    );
  }
  return children;
}
