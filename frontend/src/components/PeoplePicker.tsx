import { useState } from "react";
import { DEFAULT_PEOPLE, MAX_PEOPLE } from "./orderChatKnowledge";

interface Props {
  active: boolean;
  picked?: number;
  onPick: (people: number) => void;
}

// 예약 인원 고르기: − / + 로 1 ~ MAX_PEOPLE 명을 맞추고 "N명 선택" 으로 확정한다. 글자 입력 없이 버튼만으로 고른다
export function PeoplePicker({ active, picked, onPick }: Props) {
  const [count, setCount] = useState(picked ?? DEFAULT_PEOPLE);
  const shown = picked ?? count;

  return (
    <div className="people-picker">
      <div className="stepper" role="group" aria-label="인원">
        <button type="button" aria-label="한 명 줄이기" disabled={!active || shown <= 1} onClick={() => setCount((n) => n - 1)}>
          −
        </button>
        <output aria-live="polite">{shown}명</output>
        <button type="button" aria-label="한 명 늘리기" disabled={!active || shown >= MAX_PEOPLE} onClick={() => setCount((n) => n + 1)}>
          +
        </button>
      </div>
      <button className={"people-confirm" + (picked ? " selected" : "")} type="button" disabled={!active} onClick={() => onPick(count)}>
        {shown}명 선택
      </button>
    </div>
  );
}
