// 브라우저 내장 음성 기능: 말을 글자로(SpeechRecognition), 글자를 말로(speechSynthesis).
// 둘 다 서버 없이 돌지만 인식은 브라우저가 인터넷으로 처리하고, 마이크는 HTTPS(또는 localhost)에서만 열린다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// TypeScript DOM 타입에 SpeechRecognition 이 없어서 쓰는 만큼만 적는다
interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// 브라우저가 주는 오류 코드를 안내 문구로. null 이면 보여 주지 않는다 (사용자가 직접 멈춘 경우)
function errorMessage(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "마이크 사용이 허용되지 않았어요. 주소창의 마이크 권한을 확인해 주세요.";
    case "no-speech":
      return "말소리를 듣지 못했어요. 마이크를 다시 누르고 말씀해 주세요.";
    case "audio-capture":
      return "마이크를 찾지 못했어요. 마이크가 연결돼 있는지 확인해 주세요.";
    case "network":
      return "음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.";
    default:
      return "음성 인식에 문제가 생겼어요. 다시 시도해 주세요.";
  }
}

// 마이크 버튼을 누르면 한 문장을 듣고(한국어), 말이 끝나면 onResult 로 넘긴다. 듣는 동안의 중간 인식 결과는 interim 에 담긴다
export function useVoiceInput(onResult: (text: string) => void) {
  const supported = useMemo(() => !!recognitionCtor(), []);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  const onResultRef = useRef(onResult);
  useLayoutEffect(() => {
    onResultRef.current = onResult;
  });

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    // 읽어 주던 말을 마이크가 받아 적지 않게 멈춘다
    window.speechSynthesis?.cancel();

    const rec = new Ctor();
    rec.lang = "ko-KR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(finalText + interimText);
    };
    rec.onerror = (e) => setError(errorMessage(e.error));
    // 끝나면(말이 끝났거나, 멈췄거나, 오류) 확정된 글자를 넘긴다
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim("");
      const text = finalText.trim();
      if (text) onResultRef.current(text);
    };

    recRef.current = rec;
    setError(null);
    setInterim("");
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
      setError(errorMessage("unknown"));
    }
  }, []);

  const stop = useCallback(() => recRef.current?.stop(), []);
  const toggle = useCallback(() => (recRef.current ? stop() : start()), [start, stop]);

  // 오류 안내는 잠시 보였다가 사라진다
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, error, start, stop, toggle };
}

// 챗봇 답을 소리로 읽어 준다 (기본은 켜짐). 켜져 있을 때만 읽고, 새 답이 오면 읽던 것을 끊고 새 답을 읽는다
// 기기에 있는 한국어 목소리 중 자연스러운 젊은 여성 목소리를 앞에서부터 찾는다
// (Edge: SunHi 자연 음성, iPhone·Mac: Yuna, 안드로이드 Chrome: Google 한국어, Windows 기본: Heami)
const PREFERRED_VOICES = ["SunHi", "Yuna", "Google 한국의", "ko-KR-Wavenet", "Heami"];

function pickKoreanVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ko"));
  for (const name of PREFERRED_VOICES) {
    const found = voices.find((v) => v.name.includes(name));
    if (found) return found;
  }
  return voices[0];
}

// 소리는 처음에 켜져 있고, 끄면 그 선택을 이 브라우저에 기억한다
const SOUND_KEY = "saylo.sound";
function soundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

// 페이지를 막 열었을 때 브라우저는 목소리 목록을 아직 안 준다 (getVoices() 가 빈 배열이고, 조금 뒤 voiceschanged 로 온다).
// 그때 바로 읽으면 고른 목소리 없이 브라우저 기본 목소리로 나가므로, 목록이 올 때까지(최대 1.5초) 기다렸다 읽는다.
// 돌려주는 함수를 부르면 기다리던 것을 취소한다
const VOICES_WAIT_MS = 1500;
function whenVoicesReady(run: () => void): () => void {
  const synth = window.speechSynthesis;
  if (synth.getVoices().length > 0) {
    run();
    return () => {};
  }
  let settled = false;
  const go = () => {
    if (settled) return;
    settled = true;
    synth.removeEventListener?.("voiceschanged", go);
    window.clearTimeout(timer);
    run();
  };
  synth.addEventListener?.("voiceschanged", go);
  const timer = window.setTimeout(go, VOICES_WAIT_MS);
  return () => {
    settled = true;
    synth.removeEventListener?.("voiceschanged", go);
    window.clearTimeout(timer);
  };
}

export function useSpeechOutput() {
  const supported = useMemo(() => typeof window !== "undefined" && "speechSynthesis" in window, []);
  const [enabled, setEnabled] = useState(soundPreference);
  // 목소리 목록을 기다리는 중인 말 (새 말이 오면 이전 것은 버린다)
  const pendingRef = useRef<() => void>(() => {});
  // 지금 소리를 내는 중인지 (배경 구체의 말하는 효과에 쓴다). 새 말이 이전 말을 끊으면 이전 말의 끝 신호는 무시한다
  const [speakingNow, setSpeakingNow] = useState(false);
  const utteranceSeq = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
    } catch {
      // 저장이 막힌 브라우저면 이번 방문 동안만 기억한다
    }
    if (!enabled) {
      pendingRef.current();
      window.speechSynthesis?.cancel();
    }
  }, [enabled]);

  // 새로고침·페이지 이동 때 읽던 말을 끊는다. Chrome 은 그냥 두면 새 페이지에서도 이전 말을 이어서 읽는다
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    synth.cancel(); // 이전 페이지에서 남은 말
    const stop = () => synth.cancel();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      pendingRef.current();
      synth.cancel();
    };
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!enabled || !supported || !text.trim()) return;
      pendingRef.current();
      pendingRef.current = whenVoicesReady(() => {
        const synth = window.speechSynthesis;
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ko-KR";
        const voice = pickKoreanVoice();
        if (voice) utterance.voice = voice;
        // 조금 빠르고 살짝 높게: 같은 목소리라도 더 젊고 밝게 들린다
        utterance.rate = 1.08;
        utterance.pitch = 1.15;
        const seq = ++utteranceSeq.current;
        const mark = (on: boolean) => () => {
          if (utteranceSeq.current === seq) setSpeakingNow(on);
        };
        utterance.onstart = mark(true);
        utterance.onend = mark(false);
        utterance.onerror = mark(false); // 끊겼거나(새 말·끄기) 브라우저가 막은 경우
        synth.speak(utterance);
      });
    },
    [enabled, supported],
  );

  const toggle = useCallback(() => setEnabled((on) => !on), []);

  // 소리를 끄면 말도 멈추므로 끝 신호를 기다리지 않고 바로 말하지 않는 상태로 본다
  return { supported, enabled, toggle, speak, speaking: enabled && speakingNow };
}
