import { useState } from "react";
import { formatDate } from "./orderChatKnowledge";

interface Props {
  today: Date;
  lastDate: Date;
  active: boolean;
  isSelectable: (date: Date) => boolean;
  onPick: (date: Date) => void;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

// 예약 날짜 달력. 날짜를 누르면 바로 고른다. 고를 수 없는 날(지난 날·너무 먼 날·예약 시간이 없는 날)은 막혀 있다
export function CalendarPicker({ today, lastDate, active, isSelectable, onPick }: Props) {
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const year = view.getFullYear();
  const month = view.getMonth();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const canPrev = monthIndex(view) > monthIndex(today);
  const canNext = monthIndex(view) < monthIndex(lastDate);
  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  return (
    <div className="picker calendar">
      <div className="calendar-head">
        <button type="button" aria-label="이전 달" disabled={!active || !canPrev} onClick={() => setView(new Date(year, month - 1, 1))}>
          ‹
        </button>
        <b aria-live="polite">
          {year}년 {month + 1}월
        </b>
        <button type="button" aria-label="다음 달" disabled={!active || !canNext} onClick={() => setView(new Date(year, month + 1, 1))}>
          ›
        </button>
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${year}년 ${month + 1}월`}>
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={"weekday" + (i === 0 ? " sun" : i === 6 ? " sat" : "")} role="columnheader">
            {w}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = new Date(year, month, i + 1);
          const day = date.getDay();
          return (
            <button
              key={i}
              type="button"
              className={"day" + (isToday(date) ? " today" : "") + (day === 0 ? " sun" : day === 6 ? " sat" : "")}
              aria-label={formatDate(date)}
              disabled={!active || !isSelectable(date)}
              onClick={() => onPick(date)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
