import { useState } from "react";
import { findRestaurantById } from "../components/orderChatKnowledge";
import { INQUIRY_TEXT_MAX, answerInquiry, type Inquiry } from "../data/inquiries";
import { Tabs } from "./DashLayout";
import { InquiryCard } from "./InquiryPage";

type View = "waiting" | "all";

// 관리자 > 문의: 고객님·사장님이 보낸 문의. 답변을 기다리는 것부터 보여 주고, 카드에서 바로 답한다 (답한 것도 고쳐 쓸 수 있다)
export function InquiriesTab({ list, error, reload }: { list: Inquiry[] | null; error: string | null; reload: () => void }) {
  const waiting = (list ?? []).filter((q) => !q.answer);
  const [view, setView] = useState<View>("waiting");
  const shown = view === "waiting" ? waiting : (list ?? []);
  return (
    <>
      <Tabs
        sub
        tabs={[
          { key: "waiting" as const, label: "답변 대기", badge: waiting.length },
          { key: "all" as const, label: "전체" },
        ]}
        value={view}
        onChange={setView}
      />
      <section className="dash-section">
        <h2>{view === "waiting" ? `답변 대기 (${waiting.length})` : `전체 문의 (${list?.length ?? 0})`}</h2>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {list && shown.length === 0 && <p className="empty">{view === "waiting" ? "답변을 기다리는 문의가 없어요." : "아직 들어온 문의가 없어요."}</p>}
        <ul className="record-list">
          {shown.map((q) => (
            <InquiryCard key={q.id} q={q} who={whoAsked(q)}>
              <AnswerForm q={q} onDone={reload} />
            </InquiryCard>
          ))}
        </ul>
      </section>
    </>
  );
}

// "김손님 · 고객님 · customer01", "맛있는 족발 테스트점 사장님 · owner1234"
function whoAsked(q: Inquiry): string {
  if (q.role === "owner") {
    const store = findRestaurantById(q.storeId)?.name;
    return [q.name, store && !q.name.startsWith(store) ? store : "", q.username].filter(Boolean).join(" · ");
  }
  return `${q.name} · 고객님 · ${q.username}`;
}

function AnswerForm({ q, onDone }: { q: Inquiry; onDone: () => void }) {
  const [open, setOpen] = useState(!q.answer);
  const [text, setText] = useState(q.answer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <div className="record-actions">
        <button type="button" className="btn small" onClick={() => setOpen(true)}>
          답변 고치기
        </button>
      </div>
    );
  }

  async function submit() {
    if (!text.trim()) return setError("답변을 적어 주세요.");
    setBusy(true);
    try {
      await answerInquiry(q.id, text.trim());
    } catch (err) {
      setBusy(false);
      return setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.");
    }
    setBusy(false);
    setError(null);
    setOpen(false);
    onDone();
  }

  return (
    <div className="inquiry-reply">
      <label>
        <span className="sr-only">답변</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={INQUIRY_TEXT_MAX} rows={3} placeholder="답변을 적어 주세요." />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="record-actions">
        <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>
          {busy ? "보내는 중…" : q.answer ? "답변 고치기" : "답변 보내기"}
        </button>
        {q.answer && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setText(q.answer ?? "");
              setError(null);
              setOpen(false);
            }}
          >
            그만두기
          </button>
        )}
      </div>
    </div>
  );
}
