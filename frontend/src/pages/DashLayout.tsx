import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { HOME_BY_ROLE, logout, useSession } from "../auth/auth";

interface Props {
  title: string;
  children: ReactNode;
  accountLink?: boolean; // 맨 아래 "계정 관리 · 회원 탈퇴" 링크 (고객님·사장님만, 계정 관리 화면에서는 끈다)
}

// 사장님·관리자·내 주문 페이지의 공통 틀: 위에 로고·제목·로그아웃, 아래에 내용.
// 모바일 기준 웹이라 소비자 채팅 화면처럼 휴대폰 폭(최대 440px)의 앱 화면으로 띄운다
export function DashLayout({ title, children, accountLink = true }: Props) {
  const navigate = useNavigate();
  const session = useSession();

  function onLogout() {
    void logout(); // 화면의 로그인 상태는 바로 풀리고, 서버의 세션 삭제는 뒤에서 이어진다
    navigate("/login");
  }

  return (
    <div className="dash dash-mobile">
      <header className="dash-head">
        {/* 로고는 내 첫 화면으로: 고객님은 챗봇, 사장님·관리자는 각자의 화면 (사장님이 챗봇으로 빠져 돌아오지 못하는 일이 없게) */}
        <a
          className="dash-logo"
          href={`#${session ? HOME_BY_ROLE[session.role] : "/chat"}`}
          aria-label={!session || session.role === "user" ? "챗봇으로" : "내 첫 화면으로"}
        >
          Saylo
        </a>
        <span className="dash-title">{title}</span>
        <button type="button" className="dash-logout" onClick={onLogout}>
          로그아웃
        </button>
      </header>
      <main className="dash-main">
        {children}
        {accountLink && session && session.role !== "admin" && (
          <a className="account-link" href="#/account">
            계정 관리 · 회원 탈퇴
          </a>
        )}
      </main>
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

