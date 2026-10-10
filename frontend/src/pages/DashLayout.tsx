import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ROLE_LABEL, logout, useSession } from "../auth/auth";

interface Props {
  title: string;
  children: ReactNode;
}

// 사장님·관리자·내 주문 페이지의 공통 틀: 위에 로고·제목·계정, 아래에 내용
export function DashLayout({ title, children }: Props) {
  const session = useSession();
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="dash">
      <header className="dash-head">
        <a className="dash-logo" href="#/chat" aria-label="소비자 챗봇으로">
          Saylo
        </a>
        <span className="dash-title">{title}</span>
        {session && (
          <span className="dash-user">
            {session.name} · {ROLE_LABEL[session.role]}
          </span>
        )}
        <button type="button" className="dash-logout" onClick={onLogout}>
          로그아웃
        </button>
      </header>
      <main className="dash-main">{children}</main>
    </div>
  );
}

interface TabsProps<T extends string> {
  tabs: { key: T; label: string; badge?: number }[];
  value: T;
  onChange: (key: T) => void;
}

export function Tabs<T extends string>({ tabs, value, onChange }: TabsProps<T>) {
  return (
    <div className="dash-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === value}
          className={t.key === value ? "active" : undefined}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.badge ? <span className="badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

