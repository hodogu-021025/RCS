import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { orderSummaryRows, won, type Order, type PaymentMethod } from "./orderChatKnowledge";
import { Select, type SelectOption } from "./Select";

interface Props {
  method: PaymentMethod;
  order: Order;
  onCancel: () => void;
  onPaid: () => void;
}

type Phase = "form" | "processing" | "done";

const CLOSE_MS = 250; // .sheet transform 전환(0.25s)과 맞춘다
const PROCESSING_MS = 1600;
const DONE_MS = 1100;

// 결제수단별 데모 결제 화면. 아래에서 올라오는 시트로 띄우고, 결제가 끝나거나 취소되면 닫힘 애니메이션 뒤에 콜백을 부른다.
// 실제 결제는 하지 않는다 (카드·잔액 정보도 화면용 예시 값).
export function PaymentSheet({ method, order, onCancel, onPaid }: Props) {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [agreed, setAgreed] = useState(true);
  const titleId = useId();
  const payRef = useRef<HTMLButtonElement>(null);
  const timersRef = useRef<number[]>([]);
  // ×·바깥 클릭·ESC가 겹쳐도 닫기 콜백은 한 번만 부른다
  const closingRef = useRef(false);

  function later(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  // 마운트 직후 한 프레임 뒤에 열어야 올라오는 전환이 보인다
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    const timers = timersRef.current;
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(window.clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (visible) payRef.current?.focus();
  }, [visible]);

  function close(after: () => void) {
    if (closingRef.current) return;
    closingRef.current = true;
    setVisible(false);
    later(after, CLOSE_MS);
  }

  // 결제 진행 중에는 닫을 수 없다
  function cancel() {
    if (phase === "form") close(onCancel);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function pay() {
    setPhase("processing");
    later(() => {
      setPhase("done");
      later(() => close(onPaid), DONE_MS);
    }, PROCESSING_MS);
  }

  function onOverlayClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) cancel();
  }

  const themeVars = { "--theme": method.theme, "--theme-text": method.themeText } as CSSProperties;

  return (
    <div className={"overlay" + (visible ? " open" : "")} style={themeVars} onClick={onOverlayClick}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={"sheet-head theme-" + method.id}>
          <span className="ico">{method.icon}</span>
          <span id={titleId}>{method.label}</span>
          <button className="close" type="button" aria-label="닫기" onClick={cancel} disabled={phase !== "form"}>
            ×
          </button>
        </div>

        <div className="sheet-body">
          {phase === "form" && (
            <>
              <div className="label">결제 금액</div>
              <div className="amount">{won(order.price)}</div>
              <dl className="summary">
                {orderSummaryRows(order).map((row) => (
                  <Fragment key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </Fragment>
                ))}
              </dl>
              <MethodFields method={method} />
              <label className="agree">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                주문 내용을 확인했으며 결제에 동의합니다
              </label>
              <button ref={payRef} className="paybtn" type="button" disabled={!agreed} onClick={pay}>
                {won(order.price)} 결제하기
              </button>
            </>
          )}

          {phase === "processing" && (
            <div className="status-view">
              <div className="spinner" />
              <b>결제 진행 중…</b>
              <p>
                {method.label}로 {won(order.price)}을 결제하고 있어요
              </p>
            </div>
          )}

          {phase === "done" && (
            <div className="status-view">
              <div className="done-ico">✓</div>
              <b>결제 완료</b>
              <p>
                {won(order.price)} · {method.label}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CARDS: SelectOption[] = [
  { value: "shinhan", label: "신한카드", sub: "****-1234" },
  { value: "kb", label: "KB국민카드", sub: "****-5678" },
  { value: "hyundai", label: "현대카드", sub: "****-9012" },
];
const INSTALLMENTS: SelectOption[] = [
  { value: "0", label: "일시불" },
  { value: "2", label: "2개월", sub: "무이자" },
  { value: "3", label: "3개월", sub: "무이자" },
];

function MethodFields({ method }: { method: PaymentMethod }) {
  const [card, setCard] = useState(CARDS[0].value);
  const [installment, setInstallment] = useState(INSTALLMENTS[0].value);

  if (method.id === "card") {
    return (
      <>
        <div className="field">
          <Select label="카드 선택" options={CARDS} value={card} onChange={setCard} />
        </div>
        <div className="field">
          <Select label="할부" options={INSTALLMENTS} value={installment} onChange={setInstallment} />
        </div>
      </>
    );
  }

  const sources =
    method.id === "kakao"
      ? [
          ["카카오페이머니", "잔액 52,300원"],
          ["연결 카드 · 신한카드", "****-1234"],
        ]
      : [
          ["토스머니", "잔액 38,000원"],
          ["연결 계좌 · 토스뱅크", "****-4821"],
        ];

  return (
    <div className="field">
      <span>결제 수단</span>
      {sources.map(([name, sub], i) => (
        <label key={name} className="opt">
          <input type="radio" name="pay-source" defaultChecked={i === 0} />
          {name}
          <small>{sub}</small>
        </label>
      ))}
    </div>
  );
}
