import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { AccountText, CopyButton } from "./CopyButton";
import { TelLink } from "./TelLink";
import type { CaptionCard } from "./OrderChatbot";

// 한 글자씩 나오는 간격. 긴 답은 조금 빠르게 적어 전체가 5초 안팎에 끝나게 한다
const MAX_DELAY_MS = 45;
const MIN_DELAY_MS = 15;
const TARGET_TOTAL_MS = 5000;

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// 글자가 실시간으로 적히는 것처럼 한 글자씩 보여 준다. 새 문장이면 부모가 key 를 바꿔 처음부터 다시 적는다.
// after: 다 적은 뒤에 아래로 띄울 것 (표)
function Typewriter({ text, after }: { text: string; after?: ReactNode }) {
  const chars = Array.from(text); // 한글·이모지를 한 글자씩 (코드 단위로 자르지 않게)
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? chars.length : 0));
  const total = chars.length;
  const done = shown >= total;

  // 문장 하나에 타이머 하나: 일정한 간격으로 한 글자씩 늘리고, 다 적으면 멈춘다
  useEffect(() => {
    if (done) return;
    const delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, TARGET_TOTAL_MS / total));
    const t = window.setInterval(() => setShown((n) => Math.min(n + 1, total)), delay);
    return () => window.clearInterval(t);
  }, [done, total]);

  return (
    <div className="caption-body">
      <p className={"caption-text" + (chars.length > 70 ? " long" : "")} aria-hidden="true">
        {chars.slice(0, shown).join("")}
      </p>
      {done && after}
    </div>
  );
}

// 자막 아래 표. 카드가 떠오르고 줄이 하나씩 차례로 나타난다 (--i: 줄 순서).
// 메뉴·식당 목록 표는 줄을 눌러(또는 Enter·Space) 그 메뉴·식당을 고를 수 있다
function CaptionCards({ cards, onPick }: { cards: CaptionCard[]; onPick?: (messageId: number, index: number) => void }) {
  return (
    <div className="caption-cards">
      {cards.map((c) =>
        c.picker ? (
          // 맛 고르기: 채팅창과 같은 체크 표 (표가 자기 테두리를 가진다)
          <div key={c.key} className="caption-card picker">
            {c.picker}
          </div>
        ) : (
          <div key={c.key} className={"caption-card" + (c.list ? " list" : "")}>
            <dl>
              {c.rows.map((row, i) => {
                const pick = c.pickable && onPick ? () => onPick(c.messageId, i) : undefined;
                const onKeyDown = (e: KeyboardEvent) => {
                  if (pick && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    pick();
                  }
                };
                return (
                  <div
                    key={`${i}-${row.label}`}
                    className={"caption-row" + (pick ? " pickable" : "")}
                    style={{ "--i": i } as CSSProperties}
                    {...(pick ? { role: "button", tabIndex: 0, "aria-label": row.label, onClick: pick, onKeyDown } : {})}
                  >
                    <dt>
                      {row.label}
                      {row.badge && <span className="place-badge">{row.badge}</span>}
                    </dt>
                    <dd className={row.emphasis ? "price" : undefined}>
                      {row.tel ? <TelLink phone={row.value} /> : row.copy ? <AccountText value={row.value} /> : row.value}
                      {row.copy && <CopyButton text={row.copy} label="계좌번호 복사" />}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ),
      )}
    </div>
  );
}

// 문장 부호(. ? !) 뒤에서 줄을 바꿔 한 줄에 한 문장씩 읽히게 한다. 다만 이어지는 짧은 문장들("안녕하세요! Saylo예요.")은
// 한 줄에 둔다. 숫자 속 점(1.8km)은 뒤에 띄어쓰기가 없어 그대로 둔다
const SHORT_LINE_CHARS = 18;
function breakAfterSentences(text: string): string {
  const lines: string[] = [];
  for (const part of text.split(/(?<=[.?!])\s+/)) {
    const last = lines.length - 1;
    if (last >= 0 && Array.from(`${lines[last]} ${part}`).length <= SHORT_LINE_CHARS) lines[last] += ` ${part}`;
    else lines.push(part);
  }
  return lines.join("\n");
}

interface Props {
  id: number | null; // 지금 보여 줄 봇 답의 id (바뀌면 다시 적는다)
  text: string;
  cards?: CaptionCard[]; // 자막을 다 적은 뒤 아래에 띄울 표 (주문서·예약 확인·식당·안내)
  thinking: boolean;
  onPick?: (messageId: number, index: number) => void; // 목록 표의 줄을 눌렀을 때
}

// 채팅창을 끈 동안 배경 구체 가운데에 띄우는 자막: 봇이 소리로 읽어 주는 바로 그 문장.
// 봇이 답을 준비하는 동안은 점 세 개가 깜빡인다
export function VoiceCaption({ id, text, cards = [], thinking, onPick }: Props) {
  const hasCards = !thinking && cards.length > 0;
  return (
    <div className={"voice-caption" + (hasCards ? " has-cards" : "")}>
      {thinking ? (
        <span className="caption-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : (
        text && <Typewriter key={id} text={breakAfterSentences(text)} after={hasCards ? <CaptionCards cards={cards} onPick={onPick} /> : undefined} />
      )}
      {/* 화면 읽기 프로그램에는 한 글자씩이 아니라 문장 전체를 한 번에 알린다 */}
      <p className="sr-only" aria-live="polite">
        {thinking ? "" : text}
      </p>
    </div>
  );
}
