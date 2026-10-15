import { useState, type FormEvent } from "react";
import { INQUIRY_BODY_MIN, INQUIRY_CATEGORIES, INQUIRY_TEXT_MAX, sendInquiry, useInquiries, type Inquiry } from "../data/inquiries";
import { DashLayout } from "./DashLayout";
import { formatDateTime } from "./format";

// 관리자에게 문의 (#/inquiry, 고객님·사장님): 분류를 고르고 내용을 적어 보내면 관리자 화면의 문의 탭에 쌓인다.
// 아래에 내가 보낸 문의와 관리자 답변을 보여 준다 (이메일이 있으면 답변이 달릴 때 메일로도 알려 준다)
export function InquiryPage() {
  const { list, error: loadError, reload } = useInquiries();
  const [category, setCategory] = useState<string>("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSent(false);
    const text = body.trim();
    if (!category) return setError("문의 분류를 골라 주세요.");
    if (text.length < INQUIRY_BODY_MIN) return setError(`문의 내용을 ${INQUIRY_BODY_MIN}자 이상 적어 주세요.`);
    setBusy(true);
    try {
      await sendInquiry({ category, body: text });
    } catch (err) {
      setBusy(false);
      return setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.");
    }
    setBusy(false);
    setError(null);
    setBody("");
    setCategory("");
    setSent(true);
    reload();
  }

  return (
    <DashLayout title="관리자에게 문의">
      <section className="dash-section">
        <h2>문의 보내기</h2>
        <p className="inquiry-lead">주문, 결제, 가게, 계정 등 궁금한 점을 남겨 주세요. 관리자가 확인하고 이 화면에 답해 드려요.</p>
        <form className="inquiry-form" onSubmit={onSubmit} noValidate>
          <div className="chips" role="radiogroup" aria-label="문의 분류">
            {INQUIRY_CATEGORIES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={category === c} className={"chip" + (category === c ? " active" : "")} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <label>
            <span>문의 내용</span>
            <textarea
              value={body}
              onChange={(e) => {
                setSent(false);
                setBody(e.target.value);
              }}
              maxLength={INQUIRY_TEXT_MAX}
              rows={5}
              placeholder="예) 입금했는데 아직 '입금 대기'로 나와요."
            />
          </label>
          <p className="inquiry-count muted">
            {body.length} / {INQUIRY_TEXT_MAX}자
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {sent && (
            <p className="form-notice" role="status">
              문의를 보냈어요. 답변이 달리면 아래에서 볼 수 있어요.
            </p>
          )}
          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy ? "보내는 중…" : "문의 보내기"}
          </button>
        </form>
      </section>

      <section className="dash-section">
        <h2>내 문의{list ? ` (${list.length})` : ""}</h2>
        {loadError && (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        )}
        {list?.length === 0 && <p className="empty">아직 보낸 문의가 없어요.</p>}
        <ul className="record-list">
          {list?.map((q) => <InquiryCard key={q.id} q={q} />)}
        </ul>
      </section>
    </DashLayout>
  );
}

// 문의 한 건: 분류·답변 상태, 보낸 내용, 관리자 답변 (관리자 화면에서도 쓴다)
export function InquiryCard({ q, who, children }: { q: Inquiry; who?: string; children?: React.ReactNode }) {
  return (
    <li className={"record inquiry" + (q.answer ? "" : " pending")}>
      <div className="record-head">
        <b>{q.category}</b>
        <span className={"status " + (q.answer ? "s-완료" : "s-입금-대기")}>{q.answer ? "답변 완료" : "답변 대기"}</span>
      </div>
      <dl>
        {who && (
          <div>
            <dt>보낸 분</dt>
            <dd>{who}</dd>
          </div>
        )}
        <div>
          <dt>보낸 시각</dt>
          <dd>{formatDateTime(q.createdAt)}</dd>
        </div>
      </dl>
      <p className="inquiry-body">{q.body}</p>
      {q.answer && (
        <div className="inquiry-answer">
          <span className="inquiry-answer-head">관리자 답변 · {formatDateTime(q.answeredAt ?? q.createdAt)}</span>
          <p>{q.answer}</p>
        </div>
      )}
      {children}
    </li>
  );
}
