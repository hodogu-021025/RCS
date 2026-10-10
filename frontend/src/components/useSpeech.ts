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

export function useSpeechOutput() {
  const supported = useMemo(() => typeof window !== "undefined" && "speechSynthesis" in window, []);
  const [enabled, setEnabled] = useState(soundPreference);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
    } catch {
      // 저장이 막힌 브라우저면 이번 방문 동안만 기억한다
    }
    if (!enabled) window.speechSynthesis?.cancel();
  }, [enabled]);

  const speak = useCallback(
    (text: string) => {
      if (!enabled || !supported || !text.trim()) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ko-KR";
      const voice = pickKoreanVoice();
      if (voice) utterance.voice = voice;
      // 조금 빠르고 살짝 높게: 같은 목소리라도 더 젊고 밝게 들린다
      utterance.rate = 1.08;
      utterance.pitch = 1.15;
      synth.speak(utterance);
    },
    [enabled, supported],
  );

  const toggle = useCallback(() => setEnabled((on) => !on), []);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  return { supported, enabled, toggle, speak };
}
