import { useState } from "react";
import { withObjectParticle } from "../components/orderChatKnowledge";
import { CHOICE_COUNT_MAX, CHOICE_EXTRA_MAX, CHOICE_LABEL_MAX, CHOICE_NAME_MAX, CHOICE_OPTIONS_MAX, newRow, parseBulk, type ChoiceDraft, type ChoiceRow } from "./menuChoice";

// 세트 메뉴의 "맛 고르기" 편집 칸 (메뉴 추가 폼과 메뉴 카드에서 같이 쓴다).
// 위: 고르기 이름(맛) · 1세트에 고를 수 / 가운데: 맛 이름 + 추가금 줄을 넣고 빼는 작은 표 / 아래: 여러 개 한 번에 넣기
export function ChoiceEditor({ draft, onChange }: { draft: ChoiceDraft; onChange: (next: ChoiceDraft) => void }) {
  const [bulk, setBulk] = useState("");
  const label = draft.label.trim() || "맛";
  const full = draft.options.length >= CHOICE_OPTIONS_MAX;
  const setRow = (key: number, patch: Partial<ChoiceRow>) => onChange({ ...draft, options: draft.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) });
  const removeRow = (key: number) => onChange({ ...draft, options: draft.options.filter((o) => o.key !== key) });
  const addRow = () => !full && onChange({ ...draft, options: [...draft.options, newRow()] });

  // 한 번에 넣기: 비어 있는 줄은 걷어 내고 뒤에 붙인다 (이미 있는 이름은 건너뛴다). 40가지를 넘는 것은 넣지 않는다
  function addBulk() {
    const kept = draft.options.filter((o) => o.name.trim() || o.extra.trim());
    const names = new Set(kept.map((o) => o.name.trim()));
    const added: ChoiceRow[] = [];
    for (const row of parseBulk(bulk)) {
      if (names.has(row.name)) continue;
      names.add(row.name);
      added.push(row);
    }
    onChange({ ...draft, options: [...kept, ...added].slice(0, CHOICE_OPTIONS_MAX) });
    setBulk("");
  }

  return (
    <div className="choice-editor" role="group" aria-label={`${label} 고르기 편집`}>
      <div className="choice-editor-top">
        <label>
          <span>고르기 이름</span>
          <input value={draft.label} maxLength={CHOICE_LABEL_MAX} placeholder="맛" onChange={(e) => onChange({ ...draft, label: e.target.value })} />
        </label>
        <label>
          <span>1세트에 고를 수</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={CHOICE_COUNT_MAX}
            value={draft.count}
            onChange={(e) => onChange({ ...draft, count: e.target.value })}
          />
        </label>
      </div>
      <p className="hint">
        2마리 세트면 2를 적어요. 손님은 세트마다 서로 다른 {withObjectParticle(label)} 이 수만큼 골라요.
      </p>

      <div className="choice-rows-head" aria-hidden="true">
        <span>{label} 이름</span>
        <span>추가금 (원)</span>
      </div>
      <ol className="choice-rows">
        {draft.options.map((o, i) => (
          <li key={o.key}>
            <input
              value={o.name}
              maxLength={CHOICE_NAME_MAX}
              placeholder={i === 0 ? "예) 간장 파닭" : ""}
              onChange={(e) => setRow(o.key, { name: e.target.value })}
              aria-label={`${label} ${i + 1} 이름`}
            />
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={CHOICE_EXTRA_MAX}
              step={500}
              value={o.extra}
              placeholder="0"
              onChange={(e) => setRow(o.key, { extra: e.target.value })}
              aria-label={`${label} ${i + 1} 추가금`}
            />
            <button type="button" className="btn small" onClick={() => removeRow(o.key)} aria-label={`${label} ${i + 1} 빼기`}>
              빼기
            </button>
          </li>
        ))}
      </ol>
      <div className="choice-rows-foot">
        <button type="button" className="btn small" onClick={addRow} disabled={full}>
          {label} 한 줄 추가
        </button>
        <span className="muted">
          {draft.options.filter((o) => o.name.trim()).length} / {CHOICE_OPTIONS_MAX}가지
        </span>
      </div>

      <details className="choice-bulk">
        <summary>여러 개 한 번에 넣기</summary>
        <textarea
          value={bulk}
          rows={3}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={"쉼표나 줄바꿈으로 나눠 적어요. 추가금은 이름 뒤에 +1000\n예) 간장 파닭, 양념 파닭, 블랙스완 파닭 +1000"}
          aria-label={`${label} 여러 개 한 번에 넣기`}
        />
        <button type="button" className="btn small" onClick={addBulk} disabled={!bulk.trim()}>
          목록에 넣기
        </button>
      </details>
    </div>
  );
}
