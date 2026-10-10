import { PRIVACY_SECTIONS, type PolicyItem } from "./privacyPolicy";

export function PolicyItems({ items }: { items: PolicyItem[] }) {
  return (
    <dl className="policy-items">
      {items.map((it) => (
        <div key={it.label}>
          <dt>{it.label}</dt>
          <dd>{it.text}</dd>
        </div>
      ))}
    </dl>
  );
}

// 개인정보 처리방침 (#/privacy). 로그인하지 않아도 볼 수 있고, 회원가입 화면에서는 새 탭으로 연다
export function PrivacyPage() {
  return (
    <div className="dash dash-mobile">
      <header className="dash-head">
        <a className="dash-logo" href="#/login" aria-label="로그인 화면으로">
          Saylo
        </a>
        <span className="dash-title">개인정보 처리방침</span>
      </header>
      <main className="dash-main policy">
        <p className="policy-lead">Saylo는 주문과 예약에 꼭 필요한 정보만 받고, 아래처럼 다뤄요.</p>
        {PRIVACY_SECTIONS.map((s) => (
          <section key={s.title} className="dash-section">
            <h2>{s.title}</h2>
            {s.paragraphs?.map((p) => <p key={p}>{p}</p>)}
            {s.items && <PolicyItems items={s.items} />}
          </section>
        ))}
      </main>
    </div>
  );
}
