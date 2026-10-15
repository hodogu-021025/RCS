import { useState, type FormEvent } from "react";
import { BANKS, type BankAccount } from "../components/orderChatKnowledge";
import { Select } from "../components/Select";

interface Props {
  account: BankAccount | null; // 지금 등록된 계좌 (없으면 바로 입력칸을 보여 준다)
  onSave: (account: BankAccount) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  deleteLabel?: string; // 지우기 버튼 글자
}

// 매장 입금 계좌 보기·등록·바꾸기·지우기 (사장님 화면, 관리자 화면의 매장별 계좌). 결제는 계좌이체 하나라 고객님이 이 계좌로 입금한다.
// 서버가 다시 검사한다 (계좌번호는 숫자와 '-'만, 숫자 8~16자리)
export function BankAccountForm({ account, onSave, onDelete, deleteLabel = "지우기" }: Props) {
  const [editing, setEditing] = useState(false);
  const [bank, setBank] = useState(account?.bank ?? "");
  const [number, setNumber] = useState(account?.account ?? "");
  const [holder, setHolder] = useState(account?.holder ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit() {
    setBank(account?.bank ?? "");
    setNumber(account?.account ?? "");
    setHolder(account?.holder ?? "");
    setError(null);
    setEditing(true);
  }

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!bank) return setError("은행을 골라 주세요.");
    void run(() => onSave({ bank, account: number.trim(), holder: holder.trim() }));
  }

  if (account && !editing) {
    return (
      <>
        <dl className="policy-items bank-view">
          <div>
            <dt>은행</dt>
            <dd>{account.bank}</dd>
          </div>
          <div>
            <dt>계좌번호</dt>
            <dd>{account.account}</dd>
          </div>
          <div>
            <dt>예금주</dt>
            <dd>{account.holder}</dd>
          </div>
        </dl>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="record-actions">
          <button type="button" className="btn primary small" onClick={startEdit}>
            계좌 바꾸기
          </button>
          <button type="button" className="btn small" disabled={busy} onClick={() => void run(onDelete)}>
            {deleteLabel}
          </button>
        </div>
      </>
    );
  }

  return (
    <form className="form-grid bank-form" onSubmit={submit} noValidate>
      <Select label="은행" placeholder="은행을 골라 주세요" options={BANKS.map((b) => ({ value: b, label: b }))} value={bank} onChange={setBank} />
      <label>
        <span>계좌번호</span>
        <input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" placeholder="숫자만 또는 '-' 포함" autoComplete="off" />
      </label>
      <label>
        <span>예금주</span>
        <input value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="record-actions">
        <button type="submit" className="btn primary small" disabled={busy}>
          {account ? "바꾼 계좌 저장" : "계좌 등록"}
        </button>
        {account && (
          <button type="button" className="btn small" onClick={() => setEditing(false)}>
            그만두기
          </button>
        )}
      </div>
    </form>
  );
}
