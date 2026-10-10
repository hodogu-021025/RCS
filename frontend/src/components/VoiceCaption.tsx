import { useEffect, useState } from "react";

// 한 글자씩 나오는 간격. 긴 답은 조금 빠르게 적어 전체가 5초 안팎에 끝나게 한다
const MAX_DELAY_MS = 45;
const MIN_DELAY_MS = 15;
const TARGET_TOTAL_MS = 5000;

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// 글자가 실시간으로 적히는 것처럼 한 글자씩 보여 준다. 새 문장이면 부모가 key 를 바꿔 처음부터 다시 적는다
function Typewriter({ text }: { text: string }) {
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
    <p className={"caption-text" + (chars.length > 70 ? " long" : "")} aria-hidden="true">
      {chars.slice(0, shown).join("")}
    </p>
  );
}

// "." 로 끝난 문장 뒤에서 줄을 바꾼다. 숫자 속 점(1.8km)은 뒤에 띄어쓰기가 없어 그대로 둔다
const breakAfterSentences = (text: string) => text.replace(/\.\s+/g, ".\n");

interface Props {
  id: number | null; // 지금 보여 줄 봇 답의 id (바뀌면 다시 적는다)
  text: string;
  thinking: boolean;
}

// 채팅창을 끈 동안 배경 구체 가운데에 띄우는 자막: 봇이 소리로 읽어 주는 바로 그 문장.
// 봇이 답을 준비하는 동안은 점 세 개가 깜빡인다
export function VoiceCaption({ id, text, thinking }: Props) {
  return (
    <div className="voice-caption">
      {thinking ? (
        <span className="caption-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : (
        text && <Typewriter key={id} text={breakAfterSentences(text)} />
      )}
      {/* 화면 읽기 프로그램에는 한 글자씩이 아니라 문장 전체를 한 번에 알린다 */}
      <p className="sr-only" aria-live="polite">
        {thinking ? "" : text}
      </p>
    </div>
  );
}
