import { useEffect, useId, useRef, useState } from "react";
import { confirmVerificationCode, isValidEmail, normalizeEmail, sendVerificationCode } from "../api/emailVerification";

interface Props {
  email: string;
  onEmailChange: (email: string) => void;
  verifiedEmail: string | null; // 인증을 마친 주소 (정규화된 값). 입력값과 같아야 인증된 것
  onVerified: (result: { email: string; proof: string } | null) => void; // 인증을 마친 주소와 증표 (회원가입에 같이 보낸다)
  send?: typeof sendVerificationCode; // 인증번호를 보내는 API (기본: 회원가입용. 비밀번호 찾기는 sendResetCode)
}

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// 이메일 + 인증번호: "인증번호 받기" → 메일로 온 6자리를 적고 "확인" → 인증 완료.
// 번호는 5분 동안 쓸 수 있고, 다시 받기는 1분 뒤부터 된다 (서버가 같은 규칙으로 막는다)
export function EmailVerifyField({ email, onEmailChange, verifiedEmail, onVerified, send: sendCode = sendVerificationCode }: Props) {
  const id = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"sending" | "checking" | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const verified = verifiedEmail !== null && verifiedEmail === normalizeEmail(email);
  const waiting = sentTo !== null && sentTo === normalizeEmail(email) && !verified;
  const left = expiresAt - now;
  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));

  // 남은 시간·다시 받기 대기 시간을 1초마다 다시 그린다
  useEffect(() => {
    if (!waiting && cooldown === 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [waiting, cooldown]);

  function changeEmail(value: string) {
    onEmailChange(value);
    // 다른 주소로 바꾸면 보냈던 번호는 그 주소 것이라 더 쓰지 않는다
    if (sentTo && normalizeEmail(value) !== sentTo) {
      setSentTo(null);
      setCode("");
      setNote(null);
    }
  }

  async function send() {
    const target = normalizeEmail(email);
    if (!isValidEmail(target)) return setNote({ text: "이메일 주소를 다시 확인해 주세요.", error: true });
    setBusy("sending");
    setNote(null);
    const r = await sendCode(target);
    setBusy(null);
    const t = Date.now();
    setNow(t);
    if (!r.ok) {
      if (r.retryAfter) setResendAt(t + r.retryAfter * 1000);
      return setNote({ text: r.error, error: true });
    }
    setSentTo(target);
    setExpiresAt(t + r.expiresIn * 1000);
    setResendAt(t + r.resendIn * 1000);
    setCode("");
    setNote({ text: "인증번호를 보냈어요. 메일이 보이지 않으면 스팸함도 확인해 주세요." });
    window.setTimeout(() => codeRef.current?.focus(), 0);
  }

  async function check() {
    if (!sentTo) return;
    if (!/^\d{6}$/.test(code)) return setNote({ text: "메일로 받은 인증번호 6자리를 적어 주세요.", error: true });
    setBusy("checking");
    const r = await confirmVerificationCode(sentTo, code);
    setBusy(null);
    if (!r.ok) return setNote({ text: r.error, error: true });
    onVerified({ email: sentTo, proof: r.proof });
    setSentTo(null);
    setCode("");
    setNote(null);
  }

  return (
    <div className="email-field">
      <label htmlFor={id}>
        <span>이메일</span>
      </label>
      <div className="inline-row">
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          readOnly={verified}
          onChange={(e) => changeEmail(e.target.value)}
        />
        {verified ? (
          <>
            <span className="verified-badge">
              <CheckIcon />
              인증 완료
            </span>
            <button type="button" className="btn inline" onClick={() => onVerified(null)}>
              변경
            </button>
          </>
        ) : (
          <button type="button" className="btn inline" disabled={!email.trim() || busy !== null || cooldown > 0} onClick={send}>
            {busy === "sending" ? "보내는 중…" : waiting || cooldown > 0 ? (cooldown > 0 ? `다시 받기 ${cooldown}초` : "다시 받기") : "인증번호 받기"}
          </button>
        )}
      </div>

      {waiting && (
        <div className="inline-row code-row">
          <div className="code-input">
            <input
              ref={codeRef}
              aria-label="인증번호"
              placeholder="인증번호 6자리"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                // 가입 폼이 제출되지 않게, 엔터는 인증번호 확인으로
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (left > 0) void check();
                }
              }}
            />
            <span className={"code-timer" + (left <= 60_000 ? " soon" : "")} aria-label="남은 시간">
              {left > 0 ? mmss(left) : "만료"}
            </span>
          </div>
          <button type="button" className="btn inline primary" disabled={busy !== null || left <= 0 || code.length !== 6} onClick={check}>
            {busy === "checking" ? "확인 중…" : "확인"}
          </button>
        </div>
      )}

      {waiting && left <= 0 && <p className="field-note error">인증번호가 만료됐어요. 다시 받아 주세요.</p>}
      {note && !(waiting && left <= 0) && (
        <p className={"field-note" + (note.error ? " error" : "")} role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}
