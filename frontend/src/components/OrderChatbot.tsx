import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { PaymentSheet } from "./PaymentSheet";
import {
  PAYMENTS,
  SUGGESTIONS,
  completionText,
  findPayment,
  isNo,
  isOrderRequest,
  isYes,
  makeOrder,
  parseQty,
  won,
  type Order,
  type PaymentId,
  type PaymentMethod,
} from "./orderChatKnowledge";

// idle → confirm(주문 확인 대기) → pay(결제수단 선택 대기) → paying(결제 팝업) → done
type Stage = "idle" | "confirm" | "pay" | "paying" | "done";

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "bot"; kind: "text"; text: string }
  | { id: number; role: "bot"; kind: "order"; order: Order }
  | { id: number; role: "bot"; kind: "confirm" }
  | { id: number; role: "bot"; kind: "payment"; order: Order; selected?: PaymentId };

type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, "id"> : never) : never;

const GREETING = "안녕하세요! 🍗 주문 도우미예요.\n무엇을 주문해 드릴까요?";

let nextId = 1;
const botText = (text: string): NewMessage => ({ role: "bot", kind: "text", text });
const greeting = (): Message[] => [{ id: nextId++, ...botText(GREETING) } as Message];

// 마지막으로 나온 해당 종류 메시지의 id. 버튼은 가장 최근 말풍선에서만 누를 수 있다
function lastIdOf(messages: Message[], kinds: string[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "bot" && kinds.includes(m.kind)) return m.id;
  }
  return undefined;
}

export function OrderChatbot() {
  const [messages, setMessages] = useState<Message[]>(greeting);
  const [stage, setStage] = useState<Stage>("idle");
  const [order, setOrder] = useState<Order | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, thinking]);

  useEffect(() => {
    inputRef.current?.focus();
    const timers = timersRef.current;
    return () => timers.forEach(window.clearTimeout);
  }, []);

  function later(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  function push(...msgs: NewMessage[]) {
    const withIds = msgs.map((m) => ({ ...m, id: nextId++ }) as Message);
    setMessages((prev) => [...prev, ...withIds]);
  }

  // 타이핑 표시를 잠깐 보여 준 뒤 봇 응답을 붙인다
  function botReply(build: () => void, delay = 700) {
    setThinking(true);
    later(() => {
      setThinking(false);
      build();
    }, delay);
  }

  function markPayment(selected: PaymentId | undefined) {
    const target = lastIdOf(messages, ["payment"]);
    setMessages((prev) => prev.map((m) => (m.id === target && m.role === "bot" && m.kind === "payment" ? { ...m, selected } : m)));
  }

  function handle(raw: string) {
    const text = raw.trim();
    if (!text || thinking || stage === "paying") return;
    push({ role: "user", text });

    if (stage === "confirm" && order) {
      if (isNo(text)) {
        setStage("idle");
        setOrder(null);
        botReply(() => push(botText("주문을 취소했어요. 다른 메뉴가 필요하면 말씀해 주세요!")));
      } else if (isYes(text)) {
        setStage("pay");
        botReply(() => push({ role: "bot", kind: "payment", order }));
      } else {
        botReply(() => push(botText("주문을 진행할까요? '응' 또는 '취소'로 답해 주세요."), { role: "bot", kind: "confirm" }));
      }
      return;
    }

    if (stage === "pay" && order) {
      const method = findPayment(text);
      if (method) {
        markPayment(method.id);
        setStage("paying");
        later(() => setPayMethod(method), 300);
      } else if (isNo(text)) {
        setStage("idle");
        setOrder(null);
        botReply(() => push(botText("결제를 취소했어요.")));
      } else {
        botReply(() => push(botText("신용카드, 카카오페이, 토스페이 중에서 선택해 주세요.")));
      }
      return;
    }

    if (isOrderRequest(text)) {
      const next = makeOrder(parseQty(text));
      setOrder(next);
      setStage("confirm");
      botReply(() => push(botText("근처 매장을 찾았어요 📍"), { role: "bot", kind: "order", order: next }), 1000);
      return;
    }

    botReply(() => push(botText('죄송해요, 잘 이해하지 못했어요.\n예) "근처 BBQ 매장에서 황금올리브 시켜줘"')));
  }

  function onPayCancel() {
    setPayMethod(null);
    markPayment(undefined);
    setStage("pay");
    botReply(() => push(botText("결제를 취소했어요. 다른 결제 수단을 선택하거나 다시 시도해 주세요.")), 400);
  }

  function onPaid() {
    if (!order || !payMethod) return;
    const text = completionText(order, payMethod);
    setPayMethod(null);
    setOrder(null);
    setStage("done");
    botReply(() => push(botText(text)), 500);
  }

  function reset() {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    setMessages(greeting());
    setStage("idle");
    setOrder(null);
    setThinking(false);
    inputRef.current?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    handle(input);
    setInput("");
  }

  const activeConfirmId = stage === "confirm" ? lastIdOf(messages, ["order", "confirm"]) : undefined;
  const activePaymentId = stage === "pay" ? lastIdOf(messages, ["payment"]) : undefined;

  function confirmActions(id: number) {
    const active = id === activeConfirmId;
    return (
      <div className="actions">
        <button className="primary" type="button" disabled={!active} onClick={() => handle("응 해줘")}>
          응 해줘
        </button>
        <button type="button" disabled={!active} onClick={() => handle("취소할게")}>
          취소
        </button>
      </div>
    );
  }

  function renderBot(m: Exclude<Message, { role: "user" }>) {
    switch (m.kind) {
      case "text":
        return m.text;
      case "confirm":
        return confirmActions(m.id);
      case "order":
        return (
          <>
            주문 내역을 확인해 주세요.
            <div>
              <div className="card">
                <dl>
                  <dt>매장</dt>
                  <dd>
                    {m.order.store.name} · {m.order.store.distance}
                  </dd>
                  <dt>음식</dt>
                  <dd>
                    {m.order.food} {m.order.qty}마리
                  </dd>
                  <dt>가격</dt>
                  <dd className="price">{won(m.order.price)}</dd>
                  <dt>위치</dt>
                  <dd>{m.order.address}</dd>
                </dl>
              </div>
              <div style={{ marginTop: 10 }}>주문할까요?</div>
              {confirmActions(m.id)}
            </div>
          </>
        );
      case "payment":
        return (
          <>
            {`결제 수단을 선택해 주세요.\n총 결제금액: ${won(m.order.price)}`}
            <div className="pay">
              {PAYMENTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={m.selected === p.id ? "selected" : undefined}
                  disabled={m.id !== activePaymentId}
                  onClick={() => handle(p.label)}
                >
                  <span className={"ico ico-" + p.id}>{p.icon}</span>
                  {p.label}
                </button>
              ))}
            </div>
          </>
        );
    }
  }

  return (
    <div className="app">
      <header>
        <div className="avatar">🍗</div>
        <div>
          <div className="title">주문 도우미</div>
          <div className="status">● 온라인</div>
        </div>
        <button type="button" onClick={reset} disabled={stage === "paying"}>
          새 대화
        </button>
      </header>

      <div className="chat" ref={listRef}>
        {messages.map((m) => (
          <Fragment key={m.id}>
            {m.role === "user" ? (
              <div className="row user">
                <div className="bubble">{m.text}</div>
              </div>
            ) : (
              <div className="row bot">
                <div className="avatar">🍗</div>
                <div className="bubble">{renderBot(m)}</div>
              </div>
            )}
          </Fragment>
        ))}
        {thinking && (
          <div className="row bot" aria-label="입력 중">
            <div className="avatar">🍗</div>
            <div className="bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <div className="suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => handle(s)}>
            {s}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} autoComplete="off">
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="메시지를 입력하세요" />
        <button type="submit">전송</button>
      </form>

      {payMethod && order && <PaymentSheet method={payMethod} order={order} onCancel={onPayCancel} onPaid={onPaid} />}
    </div>
  );
}
