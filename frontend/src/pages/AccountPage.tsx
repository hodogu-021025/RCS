import { useState, type FormEvent } from "react";
import { updateContact, useSession, withdraw } from "../auth/auth";
import { ADDRESS_MAX, hasResume } from "../components/delivery";
import { findRestaurantById } from "../components/orderChatKnowledge";
import { DashLayout } from "./DashLayout";
import { PasswordField } from "./PasswordField";
import { PhoneField } from "./PhoneField";

// 연락처·배달지. 챗봇 배달 주문은 여기 적은 배달지와 연락처로 보낸다 (배달지는 고객님만)
function ContactSection() {
  const session = useSession()!;
  const customer = session.role === "user";
  const [phone, setPhone] = useState(session.phone ?? "");
  const [address, setAddress] = useState(session.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // 챗봇에서 배달지가 없어 넘어온 고객님: 저장하면 하던 주문으로 돌아가는 버튼을 보여 준다
  const [fromChat] = useState(() => customer && hasResume(session.username));
  const missing = customer && (!session.address || !session.phone);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    const result = await updateContact(customer ? { phone, address } : { phone });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setPhone(result.session.phone ?? "");
    setAddress(result.session.address ?? "");
    setSaved(true);
  }

  return (
    <section className="dash-section">
      <h2>{customer ? "연락처·배달지" : "연락처"}</h2>
      {missing ? (
        <p className="contact-lead need">
          {!session.address ? "배달지를 등록해야 배달 주문을 할 수 있어요." : "연락받을 휴대폰 번호를 등록해야 배달 주문을 할 수 있어요."}
        </p>
      ) : (
        <p className="contact-lead">{customer ? "챗봇으로 배달 주문하면 이 주소와 번호로 보내 드려요." : "관리자가 매장 일로 연락드릴 번호예요."}</p>
      )}
      <form className="contact-form" onSubmit={onSave} noValidate>
        <PhoneField
          value={phone}
          onChange={(v) => {
            setSaved(false);
            setPhone(v);
          }}
        />
        {customer && (
          <label>
            <span>배달지</span>
            <input
              value={address}
              onChange={(e) => {
                setSaved(false);
                setAddress(e.target.value);
              }}
              placeholder="예) 제천시 장락동 제천빌라 331호"
              maxLength={ADDRESS_MAX}
              autoComplete="street-address"
              autoFocus={!session.address}
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saved && !missing && (
          <p className="form-notice" role="status">
            저장했어요.
          </p>
        )}
        {saved && !missing && fromChat ? (
          <a className="btn primary wide" href="#/chat">
            챗봇으로 돌아가 주문 이어 가기
          </a>
        ) : (
          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy ? "저장하는 중…" : "저장"}
          </button>
        )}
      </form>
    </section>
  );
}

// 계정 관리 (#/account, 고객님·사장님): 내 계정 정보, 연락처·배달지, 회원 탈퇴
export function AccountPage() {
  const session = useSession()!;
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = session.role === "owner";

  async function onWithdraw(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await withdraw(password);
    // 성공하면 로그아웃 상태가 돼 로그인 화면으로 넘어가므로 여기서 더 할 일은 없다
    if ("error" in result) {
      setBusy(false);
      setError(result.error);
    }
  }

  return (
    <DashLayout title="계정 관리" accountLink={false}>
      <section className="dash-section">
        <h2>내 계정</h2>
        <dl className="policy-items">
          <div>
            <dt>아이디</dt>
            <dd>{session.username}</dd>
          </div>
          <div>
            <dt>이름</dt>
            <dd>
              {session.name} · {owner ? "사장님" : "고객님"}
            </dd>
          </div>
          {owner && session.storeId && (
            <div>
              <dt>매장</dt>
              <dd>{findRestaurantById(session.storeId)?.name ?? "알 수 없는 매장"}</dd>
            </div>
          )}
        </dl>
      </section>

      <ContactSection />

      <section className="dash-section">
        <h2>회원 탈퇴</h2>
        <ul className="withdraw-notes">
          <li>아이디, 이름, 이메일, 비밀번호는 바로 삭제돼요.</li>
          <li>주문·예약 기록은 법에 따라 5년 동안 보관하지만, 이름이 '탈퇴한 회원'으로 바뀌어 누구인지 알 수 없게 돼요.</li>
          {owner && <li>매장에 들어온 주문·예약과 영업시간·메뉴 설정은 그대로 남아요. 다시 관리하려면 새로 가입해야 해요.</li>}
          <li>탈퇴하면 되돌릴 수 없어요. 같은 이메일로 새로 가입할 수는 있어요.</li>
        </ul>
        <form className="withdraw-form" onSubmit={onWithdraw} noValidate>
          <PasswordField label="비밀번호 확인" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <label className="consent-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>위 내용을 확인했고, 탈퇴할게요</span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn danger wide" type="submit" disabled={!confirmed || !password || busy}>
            {busy ? "탈퇴하는 중…" : "회원 탈퇴"}
          </button>
        </form>
      </section>
    </DashLayout>
  );
}
