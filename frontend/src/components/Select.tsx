import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface SelectOption {
  value: string;
  label: string;
  sub?: string; // 오른쪽에 흐리게 붙는 설명 (카드 번호, 무이자 등)
}

interface Props {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string; // 아직 아무것도 고르지 않았을 때(value 가 목록에 없을 때) 흐리게 보이는 글자
}

// 직접 그리는 드롭다운. 기본 <select> 는 펼친 목록을 꾸밀 수 없어서 버튼 + listbox 로 만든다 (결제 팝업·사장님·관리자·회원가입 화면이 같이 쓴다).
// 키보드: ↑↓ Home End 로 이동, Enter·Space 로 고르기, Esc·Tab 으로 닫기. 바깥을 누르면 닫힌다.
export function Select({ label, options, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const found = options.findIndex((o) => o.value === value);
  // 고른 것이 없으면 자리표시 글자를 보여 주고(있을 때), 없으면 첫 항목을 고른 것으로 본다
  const selectedIndex = found < 0 && placeholder === undefined ? 0 : found;
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options[selectedIndex] as SelectOption | undefined;

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openList() {
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(index: number) {
    onChange(options[index].value);
    close();
  }

  function onButtonKeyDown(e: KeyboardEvent) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openList();
    }
  }

  function onListKeyDown(e: KeyboardEvent) {
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, activeIndex + 1),
      ArrowUp: Math.max(0, activeIndex - 1),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setActiveIndex(moves[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === "Escape") {
      // 결제 팝업의 Esc(팝업 닫기)까지 가지 않게 여기서 멈춘다
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  return (
    <div className={"select" + (open ? " open" : "")} ref={rootRef}>
      <span className="select-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKeyDown}
      >
        <span id={`${id}-value`} className={"select-value" + (selected ? "" : " placeholder")}>
          {selected?.label ?? placeholder}
          {selected?.sub && <small>{selected.sub}</small>}
        </span>
        <svg className="select-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          className="select-list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-opt-${activeIndex}`}
          onKeyDown={onListKeyDown}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === selectedIndex}
              className={"select-option" + (i === activeIndex ? " active" : "")}
              onPointerEnter={() => setActiveIndex(i)}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {o.sub && <small>{o.sub}</small>}
              <svg className="select-check" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
