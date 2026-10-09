import { useState } from "react";
import { toMinutes } from "./orderChatKnowledge";
import { Wheel, type WheelItem } from "./Wheel";

interface Props {
  times: string[]; // 고를 수 있는 "HH:MM" (24시간제, 오름차순)
  active: boolean;
  onPick: (label: string) => void; // "오후 6:30" 처럼 사람이 읽는 형태로 넘긴다
}

type Period = "오전" | "오후";

const hourOf = (t: string) => Number(t.slice(0, 2));
const periodOf = (t: string): Period => (hourOf(t) < 12 ? "오전" : "오후");
const hour12 = (t: string) => hourOf(t) % 12 || 12;
const timeLabel = (t: string) => `${periodOf(t)} ${hour12(t)}:${t.slice(3)}`;

// 예약 시간 고르기: 오전/오후 · 시 · 분 세 휠을 굴려 고르고 아래 버튼으로 확정한다.
// 각 휠에는 영업시간 안에서 고를 수 있는 값만 나온다 (오후를 고르면 시 휠에 오후 시간만).
export function TimePicker({ times, active, onPick }: Props) {
  const [picked, setPicked] = useState(() => (times.includes("18:00") ? "18:00" : times[0]));
  if (times.length === 0) return <div className="picker">예약할 수 있는 시간이 없어요.</div>;

  const current = times.includes(picked) ? picked : times[0];
  const hh = current.slice(0, 2);
  const mm = current.slice(3);

  const periods: WheelItem[] = (["오전", "오후"] as const)
    .filter((p) => times.some((t) => periodOf(t) === p))
    .map((p) => ({ value: p, label: p }));
  const hours: WheelItem[] = [...new Set(times.filter((t) => periodOf(t) === periodOf(current)).map((t) => t.slice(0, 2)))].map(
    (h) => ({ value: h, label: String(hour12(`${h}:00`)), name: `${hour12(`${h}:00`)}시` }),
  );
  const minutes: WheelItem[] = times
    .filter((t) => t.startsWith(`${hh}:`))
    .map((t) => ({ value: t.slice(3), label: t.slice(3), name: `${t.slice(3)}분` }));

  // 오전/오후를 바꾸면 그쪽에서 지금 시각과 가장 가까운 시간으로
  function changePeriod(p: string) {
    const candidates = times.filter((t) => periodOf(t) === p);
    const nearest = candidates.reduce((a, b) =>
      Math.abs(toMinutes(b) - toMinutes(current)) < Math.abs(toMinutes(a) - toMinutes(current)) ? b : a,
    );
    setPicked(nearest);
  }
  // 시를 바꾸면 같은 분을 유지하고, 그 시에 없는 분이면 그 시의 첫 분으로
  function changeHour(h: string) {
    const sameMinute = `${h}:${mm}`;
    setPicked(times.includes(sameMinute) ? sameMinute : times.find((t) => t.startsWith(`${h}:`))!);
  }

  const label = timeLabel(current);

  return (
    <div className="picker time-picker">
      <div className="wheel-group">
        <Wheel label="오전/오후" items={periods} value={periodOf(current)} onChange={changePeriod} disabled={!active} />
        <Wheel label="시" items={hours} value={hh} onChange={changeHour} disabled={!active} />
        <span className="wheel-colon" aria-hidden="true">
          :
        </span>
        <Wheel label="분" items={minutes} value={mm} onChange={(m) => setPicked(`${hh}:${m}`)} disabled={!active} />
      </div>
      <button className="picker-confirm" type="button" aria-label={`${label} 선택`} disabled={!active} onClick={() => onPick(label)}>
        {label}
      </button>
    </div>
  );
}
