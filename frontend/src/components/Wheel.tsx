import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";

export interface WheelItem {
  value: string;
  label: string;
  name?: string; // 화면 읽기용 이름 (예: "7시"). 없으면 label
}

interface Props {
  label: string;
  items: WheelItem[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

// 한 칸 높이. CSS(.wheel-scroll 의 높이·위아래 여백, .wheel-item 높이)와 맞춰야 가운데 줄이 맞는다
export const WHEEL_ITEM_HEIGHT = 36;

// 위아래로 굴려서 고르는 열(휴대폰 알람 시간 고르기 방식). 가운데 줄에 멈춘 값이 선택값이다.
// 굴리면 scroll-snap 으로 한 칸씩 맞춰지고, 멈추면 그 칸을 고른다. 항목을 누르거나 ↑↓ 키로도 움직인다.
export function Wheel({ label, items, value, onChange, disabled }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const index = Math.max(0, items.findIndex((it) => it.value === value));
  // 멈춤 판정은 타이머가 끝난 시점의 최신 값으로 한다 (그사이 다른 열 때문에 목록이 바뀔 수 있다)
  const latest = useRef({ items, value, index, onChange, disabled });
  useLayoutEffect(() => {
    latest.current = { items, value, index, onChange, disabled };
  });

  // 선택값이 바뀌면(누르기·키보드·다른 열 때문에) 그 칸을 가운데로 바로 옮긴다.
  // 부드럽게 미끄러뜨리면 창이 가려졌을 때 중간에 멈춰 휠 위치와 선택값이 어긋나므로 바로 옮긴다
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = index * WHEEL_ITEM_HEIGHT;
  }, [index, items.length]);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // 굴리기가 멈추면(스크롤 이벤트가 잠깐 끊기면) 가운데 칸을 고른다
  function onScroll() {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = ref.current;
      const now = latest.current;
      if (!el) return;
      const i = Math.min(now.items.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_HEIGHT)));
      if (now.disabled) {
        el.scrollTop = now.index * WHEEL_ITEM_HEIGHT; // 고를 수 없을 때는 제자리로
        return;
      }
      if (now.items[i] && now.items[i].value !== now.value) now.onChange(now.items[i].value);
    }, 120);
  }

  function onKeyDown(e: KeyboardEvent) {
    const last = items.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, index + 1),
      ArrowUp: Math.max(0, index - 1),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      if (moves[e.key] !== index) onChange(items[moves[e.key]].value);
    }
  }

  return (
    <div
      ref={ref}
      className="wheel-scroll"
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${id}-${index}`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onScroll={onScroll}
      onKeyDown={disabled ? undefined : onKeyDown}
    >
      {items.map((it, i) => (
        <div
          key={it.value}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === index}
          aria-label={it.name ?? it.label}
          className={"wheel-item" + (i === index ? " selected" : "")}
          onClick={() => !disabled && it.value !== value && onChange(it.value)}
        >
          {it.label}
        </div>
      ))}
    </div>
  );
}
