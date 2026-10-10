import { useState, type FormEvent } from "react";
import { useSession, withdraw } from "../auth/auth";
import { restaurantById } from "../components/orderChatKnowledge";
import { DashLayout } from "./DashLayout";
import { PasswordField } from "./PasswordField";

// 계정 관리 (#/account, 고객님·사장님): 내 계정 정보와 회원 탈퇴
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
              <dd>{restaurantById(session.storeId).name}</dd>
            </div>
          )}
        </dl>
      </section>

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
