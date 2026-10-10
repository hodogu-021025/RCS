import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
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

// 자막 아래 표. 카드가 떠오르고 줄이 하나씩 차례로 나타난다 (--i: 줄 순서)
function CaptionCards({ cards }: { cards: CaptionCard[] }) {
  return (
    <div className="caption-cards">
      {cards.map((c) => (
        <div key={c.key} className={"caption-card" + (c.list ? " list" : "")}>
          <dl>
            {c.rows.map((row, i) => (
              <div key={row.label} className="caption-row" style={{ "--i": i } as CSSProperties}>
                <dt>{row.label}</dt>
                <dd className={row.emphasis ? "price" : undefined}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

// "." 로 끝난 문장 뒤에서 줄을 바꾼다. 숫자 속 점(1.8km)은 뒤에 띄어쓰기가 없어 그대로 둔다
const breakAfterSentences = (text: string) => text.replace(/\.\s+/g, ".\n");

interface Props {
  id: number | null; // 지금 보여 줄 봇 답의 id (바뀌면 다시 적는다)
  text: string;
  cards?: CaptionCard[]; // 자막을 다 적은 뒤 아래에 띄울 표 (주문서·예약 확인·식당·안내)
  thinking: boolean;
}

// 채팅창을 끈 동안 배경 구체 가운데에 띄우는 자막: 봇이 소리로 읽어 주는 바로 그 문장.
// 봇이 답을 준비하는 동안은 점 세 개가 깜빡인다
export function VoiceCaption({ id, text, cards = [], thinking }: Props) {
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
        text && <Typewriter key={id} text={breakAfterSentences(text)} after={hasCards ? <CaptionCards cards={cards} /> : undefined} />
      )}
      {/* 화면 읽기 프로그램에는 한 글자씩이 아니라 문장 전체를 한 번에 알린다 */}
      <p className="sr-only" aria-live="polite">
        {thinking ? "" : text}
      </p>
    </div>
  );
}
