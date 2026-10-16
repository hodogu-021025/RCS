import { useEffect, useRef, useState } from "react";

// "농협은행 301-1234-5678-91": 좁은 화면에서 계좌번호가 하이픈에서 끊겨 두 줄로 나뉘지 않게, 마지막 낱말(번호)을 한 덩어리로 둔다
export function AccountText({ value }: { value: string }) {
  const at = value.lastIndexOf(" ");
  return (
    <>
      {value.slice(0, at + 1)}
      <span className="nowrap">{value.slice(at + 1)}</span>
    </>
  );
}

// 계좌번호 옆의 "복사" 버튼. 누르면 글자를 복사하고 잠깐 "복사됨"으로 바뀐다.
// 클립보드를 쓸 수 없는 브라우저(권한 거절·http)면 "복사 안 됨"으로 알려 직접 적게 한다
export function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("fail");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button type="button" className={"copy-btn" + (state === "done" ? " done" : "")} onClick={() => void copy()} aria-label={`${label}: ${text}`}>
      {state === "done" ? "복사됨" : state === "fail" ? "복사 안 됨" : label}
    </button>
  );
}
