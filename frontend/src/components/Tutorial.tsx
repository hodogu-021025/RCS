import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AccountIcon, ChatIcon, HelpIcon, MicIcon, PlusIcon, SpeakerIcon } from "./icons";

// 처음 챗봇을 열면 뜨는 사용법 안내. 몇 장을 넘겨 보며 쓰는 법을 익힌다.
// 끝까지 보거나 닫으면 이 브라우저에선 다시 띄우지 않고(tutorialSeen.ts), 헤더의 "?" 버튼으로 언제든 다시 볼 수 있다

// 2장의 예시 문장. 누르면 안내를 닫고 그 말을 보낸 것처럼 바로 해 본다
const TUTORIAL_EXAMPLES = ["간장치킨 두 마리 시켜줘", "내일 저녁 7시 4명 식당 예약", "배고파, 뭐 먹지?", "내 주문 어디쯤 왔어?"];

interface Step {
  title: string;
  body: string;
  visual: (onTry: (text: string) => void) => ReactNode;
}

// 헤더 버튼 설명 한 줄 (실제 헤더와 같은 모양의 아이콘을 앞에 둔다)
const HeaderRow = ({ icon, name, text }: { icon: ReactNode; name: string; text: string }) => (
  <li>
    <span className="tutorial-icon" aria-hidden="true">
      {icon}
    </span>
    <span>
      <b>{name}</b>
      {text}
    </span>
  </li>
);

const STEPS: Step[] = [
  {
    title: "말로 주문하는 Saylo예요",
    body: "배달 주문과 식당 예약을 채팅이나 목소리로 도와드려요. 친구에게 말하듯 편하게 적으면 AI가 알아듣고 다음 단계를 안내해요.",
    visual: () => (
      <div className="tutorial-chat" aria-hidden="true">
        <p className="me">치킨 먹고 싶어</p>
        <p className="bot">이런 메뉴를 추천해요! 마음에 드는 걸로 골라 주세요.</p>
      </div>
    ),
  },
  {
    title: "이렇게 말해 보세요",
    body: "메뉴·수량·날짜·인원을 한 번에 말해도 알아들어요. 아래 문장을 누르면 바로 해 볼 수 있어요.",
    visual: (onTry) => (
      <div className="tutorial-examples">
        {TUTORIAL_EXAMPLES.map((t) => (
          <button key={t} type="button" onClick={() => onTry(t)}>
            “{t}”
          </button>
        ))}
      </div>
    ),
  },
  {
    title: "버튼으로도 골라요",
    body: "추천 카드나 버튼을 누르면 그대로 진행돼요. 원하는 게 없으면 '직접 입력'을 눌러 적어 주세요.",
    visual: () => (
      <ul className="tutorial-list">
        <HeaderRow icon={<PlusIcon />} name="빠른 메뉴" text="입력창의 + 버튼으로 배달·식당을 바로 시작해요" />
        <HeaderRow icon={<span className="tutorial-dot">✓</span>} name="추천 카드" text="메뉴·식당 카드를 눌러 고르면 다음 단계로 가요" />
        <HeaderRow icon={<span className="tutorial-dot">↺</span>} name="바꾸기·취소" text="'3마리로 해줘', '취소할래'처럼 말해도 돼요" />
      </ul>
    ),
  },
  {
    title: "목소리로도 쓸 수 있어요",
    body: "위쪽 버튼으로 듣고 말하는 방식을 바꿔요.",
    visual: () => (
      <ul className="tutorial-list header-like">
        <HeaderRow icon={<MicIcon />} name="음성 모드" text="누르고 말하면 글자로 바꿔 주문해요" />
        <HeaderRow icon={<SpeakerIcon muted={false} />} name="소리" text="AI의 답을 소리 내어 읽어 드려요" />
        <HeaderRow icon={<ChatIcon hidden={false} />} name="채팅창" text="끄면 말풍선 대신 큰 자막으로 보여요" />
        <HeaderRow icon={<AccountIcon />} name="계정" text="로그인, 내 주문, 배달지 관리" />
        <HeaderRow icon={<HelpIcon />} name="사용법" text="이 안내를 다시 볼 수 있어요" />
      </ul>
    ),
  },
  {
    title: "배달 주문 전에 확인해 주세요",
    body: "배달은 로그인한 고객님만 할 수 있어요. 계정 관리에서 배달지와 휴대폰 번호를 등록해 두면 바로 주문서가 만들어져요. 식당 예약은 로그인 없이도 돼요.",
    visual: () => (
      <ol className="tutorial-steps">
        <li>로그인 또는 회원가입</li>
        <li>계정 관리에서 배달지 등록</li>
        <li>챗봇에서 "배달"이라고 말하기</li>
      </ol>
    ),
  },
];

interface Props {
  onClose: () => void; // 닫기·건너뛰기·시작하기
  onTry: (text: string) => void; // 예시 문장을 눌렀을 때 (안내를 닫고 그 말을 보낸다)
}

export function Tutorial({ onClose, onTry }: Props) {
  const [step, setStep] = useState(0);
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  // 장을 넘길 때마다 주 버튼(다음·시작하기)으로 초점을 옮겨 키보드로도 이어서 넘길 수 있게 한다
  useEffect(() => {
    primaryRef.current?.focus();
  }, [step]);

  // Esc 로 닫고, ← → 로 넘긴다
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setStep((s) => Math.min(STEPS.length - 1, s + 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay open tutorial-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="tutorial-head">
          <span className="tutorial-count">
            {step + 1} / {STEPS.length}
          </span>
          <button type="button" className="tutorial-skip" onClick={onClose}>
            건너뛰기
          </button>
        </div>
        <h2 id={titleId}>{current.title}</h2>
        <p className="tutorial-body">{current.body}</p>
        <div className="tutorial-visual">{current.visual(onTry)}</div>
        <div className="tutorial-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.title} className={i === step ? "on" : undefined} />
          ))}
        </div>
        <div className="tutorial-actions">
          {step > 0 && (
            <button type="button" className="tutorial-prev" onClick={() => setStep(step - 1)}>
              이전
            </button>
          )}
          <button ref={primaryRef} type="button" className="tutorial-next" onClick={() => (last ? onClose() : setStep(step + 1))}>
            {last ? "시작하기" : "다음"}
          </button>
        </div>
      </div>
    </div>
  );
}
