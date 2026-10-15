import { useState } from "react";
import { won, type ChoiceOption } from "./orderChatKnowledge";

interface Props {
  label: string; // "맛"
  need: number; // 고를 수 (세트 수 × 1세트에 고를 수)
  options: ChoiceOption[];
  basePrice: number; // 맛 추가금을 더하기 전 금액 (세트 값 × 세트 수)
  active: boolean; // 지금 고를 수 있는지 (지난 말풍선이면 false)
  picked?: string[]; // 고르기를 마친 맛 (마치면 표가 잠긴다)
  onPick: (names: string[]) => void;
}

// 세트 메뉴의 맛 고르기 표. 추가금이 같은 맛끼리 묶어 두 칸씩 보여 주고, 맛은 한 번씩만 고른다.
// 고를 수만큼 고르면 나머지 칸은 잠기고 "선택 완료"가 켜진다
export function ChoicePicker({ label, need, options, basePrice, active, picked, onPick }: Props) {
  const [chosen, setChosen] = useState<string[]>(picked ?? []);
  const shown = picked ?? chosen;
  const full = shown.length >= need;
  const extra = options.filter((o) => shown.includes(o.name)).reduce((sum, o) => sum + o.extra, 0);
  const groups = [...new Set(options.map((o) => o.extra))].sort((a, b) => a - b).map((value) => ({ value, items: options.filter((o) => o.extra === value) }));
  const toggle = (name: string) => setChosen((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : cur.length < need ? [...cur, name] : cur));

  return (
    <div className="choice-picker" role="group" aria-label={`${label} 고르기`}>
      {groups.map((g) => (
        <div className="choice-group" key={g.value}>
          <div className="choice-group-head">{g.value ? `${won(g.value)} 추가` : "추가금 없음"}</div>
          <div className="choice-grid">
            {g.items.map((o) => {
              const on = shown.includes(o.name);
              return (
                <button
                  key={o.name}
                  type="button"
                  className={"choice-cell" + (on ? " on" : "")}
                  aria-pressed={on}
                  disabled={!active || !!picked || (!on && full)}
                  onClick={() => toggle(o.name)}
                >
                  <span className="choice-box" aria-hidden="true" />
                  <span className="choice-name">{o.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="choice-foot">
        <span aria-live="polite">
          {need}가지 중 {shown.length}가지 · {won(basePrice + extra)}
        </span>
        <button
          className={"count-confirm" + (picked ? " selected" : "")}
          type="button"
          disabled={!active || !!picked || shown.length !== need}
          onClick={() => onPick(chosen)}
        >
          {picked ? "선택 완료됨" : "선택 완료"}
        </button>
      </div>
    </div>
  );
}
