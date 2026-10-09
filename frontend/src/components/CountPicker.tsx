import { useState } from "react";
import { won } from "./orderChatKnowledge";

interface Props {
  unit: string; // "명", "마리", "판", "인분"
  max: number;
  initial: number;
  active: boolean;
  picked?: number;
  // 1단위 가격을 주면 선택 버튼에 합계 금액을 함께 보여 준다
  priceEach?: number;
  onPick: (count: number) => void;
}

// "한 명", "한 마리", "한 판", "1인분" — 줄이기·늘리기 버튼의 읽기 이름에 쓴다
const oneUnit = (unit: string) => (unit === "인분" ? "1인분" : `한 ${unit}`);

// 수 고르기: − / + 로 1 ~ max 를 맞추고 "N단위 선택" 으로 확정한다. 글자 입력 없이 버튼만으로 고른다 (예약 인원·배달 수량)
export function CountPicker({ unit, max, initial, active, picked, priceEach, onPick }: Props) {
  const [count, setCount] = useState(picked ?? initial);
  const shown = picked ?? count;
  // 버튼에는 수량(과 합계 금액)만 보이고, 읽기 이름에는 "선택"을 붙여 무엇을 하는 버튼인지 알린다
  const label = `${shown}${unit}` + (priceEach ? ` · ${won(priceEach * shown)}` : "");

  return (
    <div className="count-picker">
      <div className="stepper" role="group" aria-label={unit === "명" ? "인원" : "수량"}>
        <button type="button" aria-label={`${oneUnit(unit)} 줄이기`} disabled={!active || shown <= 1} onClick={() => setCount((n) => n - 1)}>
          −
        </button>
        <output aria-live="polite">
          {shown}
          {unit}
        </output>
        <button type="button" aria-label={`${oneUnit(unit)} 늘리기`} disabled={!active || shown >= max} onClick={() => setCount((n) => n + 1)}>
          +
        </button>
      </div>
      <button
        className={"count-confirm" + (picked ? " selected" : "")}
        type="button"
        aria-label={`${label} 선택`}
        disabled={!active}
        onClick={() => onPick(count)}
      >
        {label}
      </button>
    </div>
  );
}
