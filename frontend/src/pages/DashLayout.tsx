import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "../auth/auth";

interface Props {
  title: string;
  children: ReactNode;
}

// 사장님·관리자·내 주문 페이지의 공통 틀: 위에 로고·제목·로그아웃, 아래에 내용.
// 모바일 기준 웹이라 소비자 채팅 화면처럼 휴대폰 폭(최대 440px)의 앱 화면으로 띄운다
export function DashLayout({ title, children }: Props) {
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="dash dash-mobile">
      <header className="dash-head">
        <a className="dash-logo" href="#/chat" aria-label="소비자 챗봇으로">
          Saylo
        </a>
        <span className="dash-title">{title}</span>
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

