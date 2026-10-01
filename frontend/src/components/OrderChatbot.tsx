import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import backgroundVideo from "../image/linkon_background.mp4";
import logo from "../image/linkon_logo.png";
import { PaymentSheet } from "./PaymentSheet";
import { PeoplePicker } from "./PeoplePicker";
import {
  DELIVERY_PROMPT,
  FALLBACK_PROMPT,
  FOOD_PROMPT,
  MAX_DAYS_AHEAD,
  MAX_PEOPLE,
  MAX_QTY,
  PAYMENTS,
  QUICK_MENUS,
  checkVisitTime,
  completionText,
  datePrompt,
  findDeliveryItems,
  findPayment,
  findRestaurant,
  formatDate,
  isNo,
  isYes,
  km,
  makeOrder,
  matchFood,
  nearbyRestaurants,
  parseQuantity,
  parseVisitDate,
  parseVisitTime,
  PEOPLE_QUESTION,
  pickDeliveryPrompt,
  quantityPrompt,
  quickMenuReply,
  reservationDoneText,
  timeChoices,
  timePrompt,
  withObjectParticle,
  won,
  type BotPrompt,
  type Choice,
  type DeliveryItem,
  type Order,
  type PaymentId,
  type PaymentMethod,
  type Reservation,
  type Restaurant,
} from "./orderChatKnowledge";

// 배달: idle → menu(메뉴 대기) → qty(수량 대기) → confirm(주문 확인 대기) → pay(결제수단 선택 대기) → paying(결제 팝업) → done
// 식당: idle → food(음식 종류 대기) → restaurant(식당 목록에서 선택 대기)
//      → rsvDate(날짜) → rsvTime(시간) → rsvPeople(인원) → rsvConfirm(예약 확인) → idle
type Stage =
  | "idle" | "menu" | "qty" | "confirm" | "pay" | "paying" | "done"
  | "food" | "restaurant" | "rsvDate" | "rsvTime" | "rsvPeople" | "rsvConfirm";

// 예약 정보는 날짜 → 시간 → 인원 순으로 채워진다
type ReservationDraft = Partial<Reservation> & { restaurant: Restaurant };

type Message =
  | { id: number; role: "user"; text: string }
  // choices 가 있으면 선택 버튼 + "직접 입력" 을 붙인다. picked: 누른 선택지의 value
  | { id: number; role: "bot"; kind: "text"; text: string; choices?: Choice[]; placeholder?: string; picked?: string }
  | { id: number; role: "bot"; kind: "order"; order: Order }
  | { id: number; role: "bot"; kind: "confirm" }
  | { id: number; role: "bot"; kind: "payment"; order: Order; selected?: PaymentId }
  | { id: number; role: "bot"; kind: "restaurants"; foodLabel: string; list: Restaurant[]; selected?: string }
  | { id: number; role: "bot"; kind: "restaurantPicked"; restaurant: Restaurant }
  | { id: number; role: "bot"; kind: "reservation"; reservation: Reservation }
  // 예약 인원 카운터. lead: 다시 물을 때 앞에 붙일 이유, picked: 고른 인원
  | { id: number; role: "bot"; kind: "people"; lead?: string; picked?: number };

type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, "id"> : never) : never;

const GREETING = "안녕하세요! link ON이에요.\n무엇을 주문해 드릴까요?";

let nextId = 1;
const botText = (text: string): NewMessage => ({ role: "bot", kind: "text", text });
const botPrompt = ({ text, choices, placeholder }: BotPrompt): NewMessage => ({ role: "bot", kind: "text", text, choices, placeholder });
const DEFAULT_PLACEHOLDER = "메시지를 입력하세요";
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
  // 메뉴를 고르고 수량을 기다리는 중인 배달 메뉴
  const [pendingItem, setPendingItem] = useState<DeliveryItem | null>(null);
  // 진행 중인 식당 예약
  const [rsv, setRsv] = useState<ReservationDraft | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // "직접 입력" 을 누른 선택지 말풍선의 id. 그 말풍선이 최신 질문인 동안만 입력창이 열려 있다
  const [manualInputFor, setManualInputFor] = useState<number | null>(null);
  const quickMenuId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);

  // 가장 최근 봇 말풍선이 버튼으로 답하는 질문(선택지·인원 카운터)이면, "직접 입력" 을 누르기 전까지 입력창을 접어 둔다
  // (인원 카운터에는 직접 입력이 없어 버튼으로만 답한다)
  const lastBot = messages.findLast((m) => m.role === "bot");
  const activePrompt =
    lastBot?.role === "bot" && ((lastBot.kind === "text" && lastBot.choices) || lastBot.kind === "people") ? lastBot : undefined;
  const composerOpen = !activePrompt || manualInputFor === activePrompt.id;
  // 선택 버튼은 그 질문이 대화의 마지막이고 봇이 답하는 중이 아닐 때만 누를 수 있다
  const activeChoicesId = activePrompt && messages.at(-1)?.id === activePrompt.id && !thinking ? activePrompt.id : undefined;
  const promptPlaceholder = activePrompt?.kind === "text" ? activePrompt.placeholder : undefined;
  const placeholder = (composerOpen && promptPlaceholder) || DEFAULT_PLACEHOLDER;
  // 빠른 메뉴는 입력창 안에 있으므로 입력창이 접히면 같이 숨는다
  const quickMenuOpen = menuOpen && composerOpen;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, thinking]);

  // 입력창이 열리면 바로 쓸 수 있게 포커스한다
  useEffect(() => {
    if (composerOpen) inputRef.current?.focus();
  }, [composerOpen]);

  // 빠른 메뉴는 바깥을 누르거나 ESC 로 닫는다
  useEffect(() => {
    if (!quickMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!inputWrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [quickMenuOpen]);

  useEffect(() => {
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

  function markRestaurant(selected: string) {
    const target = lastIdOf(messages, ["restaurants"]);
    setMessages((prev) => prev.map((m) => (m.id === target && m.role === "bot" && m.kind === "restaurants" ? { ...m, selected } : m)));
  }

  // 가장 최근에 보여 준 식당 목록
  function latestRestaurantList(): Restaurant[] {
    const target = lastIdOf(messages, ["restaurants"]);
    const m = messages.find((msg) => msg.id === target);
    return m && m.role === "bot" && m.kind === "restaurants" ? m.list : [];
  }

  function showRestaurants(foodLabel: string, list: Restaurant[]) {
    setStage("restaurant");
    botReply(() => push({ role: "bot", kind: "restaurants", foodLabel, list }), 900);
  }

  function startOrder(item: DeliveryItem, qty: number) {
    const next = makeOrder(item, qty);
    setPendingItem(null);
    setOrder(next);
    setStage("confirm");
    botReply(() => push(botText("근처 매장을 찾았어요"), { role: "bot", kind: "order", order: next }), 1000);
  }

  const rangeLead = (item: DeliveryItem) => `1${item.unit}부터 ${MAX_QTY}${item.unit}까지 주문할 수 있어요.`;

  // 말 속에서 배달 메뉴를 찾는다. 수량까지 있으면 바로 주문서로, 없으면 수량을 묻고,
  // 여러 메뉴에 걸리는 말("치킨")이면 그중에서 고르게 한다. 메뉴를 못 찾으면 false
  function tryDelivery(text: string): boolean {
    const items = findDeliveryItems(text);
    if (items.length === 0) return false;
    if (items.length > 1) {
      setPendingItem(null);
      setStage("menu");
      botReply(() => push(botPrompt(pickDeliveryPrompt(items))));
      return true;
    }
    const item = items[0];
    const qty = parseQuantity(text);
    if (qty !== undefined && qty >= 1 && qty <= MAX_QTY) {
      startOrder(item, qty);
      return true;
    }
    setPendingItem(item);
    setStage("qty");
    botReply(() => push(botPrompt(quantityPrompt(item, qty !== undefined ? rangeLead(item) : undefined))));
    return true;
  }

  function cancelDelivery() {
    setStage("idle");
    setPendingItem(null);
    botReply(() => push(botText("배달 주문을 그만할게요. 다른 게 필요하면 말씀해 주세요!")));
  }

  // 예약 단계별 처리: 날짜 → 시간 → 인원 → 확인. 알아듣지 못하거나 범위를 벗어나면 이유를 붙여 같은 질문을 다시 한다
  function continueReservation(text: string, draft: ReservationDraft) {
    const { restaurant } = draft;
    const now = new Date();

    if (isNo(text)) {
      setRsv(null);
      setStage("idle");
      botReply(() => push(botText("예약을 취소했어요. 다른 게 필요하면 말씀해 주세요!")));
      return;
    }

    if (stage === "rsvDate") {
      const date = parseVisitDate(text, now);
      if (!(date instanceof Date)) {
        const lead =
          date === "past" ? "이미 지난 날짜예요." : date === "far" ? `오늘부터 ${MAX_DAYS_AHEAD}일 안에서만 예약할 수 있어요.` : "날짜를 잘 모르겠어요.";
        botReply(() => push(botPrompt(datePrompt(restaurant, now, lead))));
        return;
      }
      if (timeChoices(restaurant, date, now).length === 0) {
        botReply(() => push(botPrompt(datePrompt(restaurant, now, `${formatDate(date)}은 예약할 수 있는 시간이 지났어요.`))));
        return;
      }
      setRsv({ ...draft, date });
      setStage("rsvTime");
      botReply(() => push(botPrompt(timePrompt(restaurant, date, now))));
      return;
    }

    if (stage === "rsvTime" && draft.date) {
      const date = draft.date;
      const time = parseVisitTime(text);
      const check = time ? checkVisitTime(restaurant, date, time, now) : undefined;
      if (!time || check !== "ok") {
        const lead = !time
          ? "시간을 잘 모르겠어요."
          : check === "past"
            ? "이미 지난 시간이에요."
            : `${time}에는 예약할 수 없어요. 마감 1시간 전까지 예약할 수 있어요.`;
        botReply(() => push(botPrompt(timePrompt(restaurant, date, now, lead))));
        return;
      }
      setRsv({ ...draft, time });
      setStage("rsvPeople");
      botReply(() => push({ role: "bot", kind: "people" }));
      return;
    }

    if (stage === "rsvPeople" && draft.date && draft.time) {
      const people = parseQuantity(text);
      if (people === undefined || people < 1 || people > MAX_PEOPLE) {
        const lead = people === undefined ? "인원을 잘 모르겠어요." : `1명부터 ${MAX_PEOPLE}명까지 예약할 수 있어요.`;
        botReply(() => push({ role: "bot", kind: "people", lead }));
        return;
      }
      const reservation: Reservation = { restaurant, date: draft.date, time: draft.time, people };
      setRsv(reservation);
      setStage("rsvConfirm");
      botReply(() => push({ role: "bot", kind: "reservation", reservation }));
      return;
    }

    if (stage === "rsvConfirm" && draft.date && draft.time && draft.people) {
      if (isYes(text)) {
        const done = reservationDoneText({ restaurant, date: draft.date, time: draft.time, people: draft.people });
        setRsv(null);
        setStage("idle");
        botReply(() => push(botText(done)), 900);
      } else {
        botReply(() => push(botText("예약할까요? '응' 또는 '취소'로 답해 주세요."), { role: "bot", kind: "confirm" }));
      }
    }
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

    // 식당 예약 중. 빠른 메뉴(배달·식당 등)를 고르면 예약을 접고 아래 일반 처리로 넘어간다
    if (rsv && (stage === "rsvDate" || stage === "rsvTime" || stage === "rsvPeople" || stage === "rsvConfirm")) {
      if (!quickMenuReply(text)) {
        continueReservation(text, rsv);
        return;
      }
      setRsv(null);
    }

    // 배달 수량: 숫자만 오면 그 수량으로 주문서를 만든다. 다른 메뉴를 말하면 아래 일반 처리에서 메뉴부터 다시 받는다
    if (stage === "qty" && pendingItem) {
      const qty = parseQuantity(text);
      if (qty !== undefined && findDeliveryItems(text).length === 0) {
        if (qty >= 1 && qty <= MAX_QTY) startOrder(pendingItem, qty);
        else botReply(() => push(botPrompt(quantityPrompt(pendingItem, rangeLead(pendingItem)))));
        return;
      }
      if (isNo(text)) {
        cancelDelivery();
        return;
      }
      if (!quickMenuReply(text) && findDeliveryItems(text).length === 0) {
        botReply(() => push(botPrompt(quantityPrompt(pendingItem, "수량을 잘 모르겠어요."))));
        return;
      }
    }

    // 배달 메뉴 고르는 중
    if (stage === "menu") {
      if (tryDelivery(text)) return;
      if (isNo(text)) {
        cancelDelivery();
        return;
      }
      if (!quickMenuReply(text)) {
        botReply(() => push(botPrompt({ ...DELIVERY_PROMPT, text: "지금은 아래 메뉴를 배달할 수 있어요.\n골라 주시거나 메뉴 이름을 입력해 주세요." })));
        return;
      }
    }

    // 식당 찾기 중에는 식당 이름 → 음식 종류 순으로 먼저 본다. 둘 다 아니면 아래 일반 처리로 넘어간다
    if (stage === "food" || stage === "restaurant") {
      const picked = stage === "restaurant" ? findRestaurant(text, latestRestaurantList()) : undefined;
      if (picked) {
        // 식당을 고르면 예약으로 이어진다
        markRestaurant(picked.id);
        setRsv({ restaurant: picked });
        setStage("rsvDate");
        botReply(() =>
          push({ role: "bot", kind: "restaurantPicked", restaurant: picked }, botPrompt(datePrompt(picked, new Date()))),
        );
        return;
      }
      const food = matchFood(text);
      if (food) {
        showRestaurants(food.label, nearbyRestaurants(food.key));
        return;
      }
      if (isNo(text)) {
        setStage("idle");
        botReply(() => push(botText("식당 찾기를 그만할게요. 다른 게 필요하면 말씀해 주세요!")));
        return;
      }
      if (!quickMenuReply(text) && findDeliveryItems(text).length === 0) {
        const hint = stage === "restaurant" ? "목록에서 식당을 고르거나, 다른 음식을 골라 주세요." : "아래에서 고르거나 직접 입력해 주세요.";
        botReply(() => push(botPrompt({ ...FOOD_PROMPT, text: `어떤 음식인지 잘 모르겠어요.\n${hint}` })));
        return;
      }
    }

    const quickReply = quickMenuReply(text);
    if (quickReply) {
      setPendingItem(null);
      setStage(quickReply.next ?? "idle");
      botReply(() => push(botPrompt(quickReply)));
      return;
    }

    // "간장치킨 2마리 시켜줘"처럼 메뉴를 바로 말하면 배달 주문으로
    if (tryDelivery(text)) return;

    botReply(() => push(botPrompt(FALLBACK_PROMPT)));
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
    setManualInputFor(null);
    setPendingItem(null);
    setRsv(null);
    inputRef.current?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMenuOpen(false);
    handle(input);
    setInput("");
  }

  function pickChoice(promptId: number, choice: Choice) {
    setMessages((prev) =>
      prev.map((m) => (m.id === promptId && m.role === "bot" && m.kind === "text" ? { ...m, picked: choice.value } : m)),
    );
    handle(choice.value);
  }

  function pickPeople(promptId: number, people: number) {
    setMessages((prev) =>
      prev.map((m) => (m.id === promptId && m.role === "bot" && m.kind === "people" ? { ...m, picked: people } : m)),
    );
    handle(`${people}명`);
  }

  // 접혀 있던 입력창을 연다. 이미 열려 있으면 포커스만 옮긴다
  function openManualInput(promptId: number) {
    setManualInputFor(promptId);
    inputRef.current?.focus();
  }

  function pickQuickMenu(menu: string) {
    setMenuOpen(false);
    handle(menu);
    inputRef.current?.focus();
  }

  // 주문 확인과 예약 확인이 같은 "응 해줘 / 취소" 버튼을 쓴다
  const activeConfirmId =
    stage === "confirm" || stage === "rsvConfirm" ? lastIdOf(messages, ["order", "reservation", "confirm"]) : undefined;
  const activePaymentId = stage === "pay" ? lastIdOf(messages, ["payment"]) : undefined;
  const activeRestaurantsId = stage === "restaurant" ? lastIdOf(messages, ["restaurants"]) : undefined;

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
      case "text": {
        if (!m.choices) return m.text;
        const active = m.id === activeChoicesId;
        const manual = manualInputFor === m.id;
        return (
          <>
            {m.text}
            <div className="choices">
              {m.choices.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={m.picked === c.value ? "selected" : undefined}
                  disabled={!active}
                  onClick={() => pickChoice(m.id, c)}
                >
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                className={"direct" + (manual ? " selected" : "")}
                disabled={!active}
                aria-pressed={manual}
                onClick={() => openManualInput(m.id)}
              >
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path
                    d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
                직접 입력
              </button>
            </div>
          </>
        );
      }
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
                    {m.order.food} {m.order.qty}{m.order.unit}
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
      case "restaurants":
        return (
          <>
            {`근처 ${m.foodLabel} 식당이에요. 가까운 순서예요.\n원하는 곳을 눌러 주세요.`}
            <div className="places">
              {m.list.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={m.selected === r.id ? "selected" : undefined}
                  disabled={m.id !== activeRestaurantsId}
                  onClick={() => handle(r.name)}
                >
                  <span className="place-main">
                    <b>{r.name}</b>
                    <small>
                      대표 메뉴 {r.signature} · 평점 {r.rating.toFixed(1)}
                    </small>
                  </span>
                  <span className="place-distance">{km(r.distanceKm)}</span>
                </button>
              ))}
            </div>
          </>
        );
      case "restaurantPicked":
        return (
          <>
            {`${withObjectParticle(m.restaurant.name)} 선택했어요.`}
            <div className="card">
              <dl>
                <dt>식당</dt>
                <dd>{m.restaurant.name}</dd>
                <dt>거리</dt>
                <dd>{km(m.restaurant.distanceKm)}</dd>
                <dt>대표 메뉴</dt>
                <dd>{m.restaurant.signature}</dd>
                <dt>영업시간</dt>
                <dd>{m.restaurant.hours}</dd>
                <dt>주소</dt>
                <dd>{m.restaurant.address}</dd>
              </dl>
            </div>
          </>
        );
      case "people":
        return (
          <>
            {`${m.lead ? `${m.lead}\n` : ""}${PEOPLE_QUESTION}`}
            <PeoplePicker active={m.id === activeChoicesId} picked={m.picked} onPick={(n) => pickPeople(m.id, n)} />
          </>
        );
      case "reservation":
        return (
          <>
            예약 내용을 확인해 주세요.
            <div>
              <div className="card">
                <dl>
                  <dt>식당</dt>
                  <dd>{m.reservation.restaurant.name}</dd>
                  <dt>날짜</dt>
                  <dd>{formatDate(m.reservation.date)}</dd>
                  <dt>시간</dt>
                  <dd className="price">{m.reservation.time}</dd>
                  <dt>인원</dt>
                  <dd>{m.reservation.people}명</dd>
                  <dt>주소</dt>
                  <dd>{m.reservation.restaurant.address}</dd>
                </dl>
              </div>
              <div style={{ marginTop: 10 }}>예약할까요?</div>
              {confirmActions(m.id)}
            </div>
          </>
        );
    }
  }

  return (
    <div className="app">
      <header>
        <h1 className="title">
          <img src={logo} alt="link ON" />
        </h1>
        <button className="new-chat" type="button" onClick={reset} disabled={stage === "paying"}>
          <svg viewBox="0 0 16 16" width="12.6" height="12.6" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
          새 대화
        </button>
      </header>

      {/* 메시지 영역 뒤에 영상을 고정으로 깔고, 그 위에서 메시지 목록만 스크롤한다 */}
      <div className="chat-area">
        <video className="chat-bg" src={backgroundVideo} autoPlay muted loop playsInline aria-hidden="true" />
        <div className="chat" ref={listRef}>
          {/* 같은 쪽이 연달아 말하면 cont 로 간격을 좁혀 한 묶음처럼 보이게 한다 */}
          {messages.map((m, i) => {
            const cont = messages[i - 1]?.role === m.role ? " cont" : "";
            return (
              <Fragment key={m.id}>
                {m.role === "user" ? (
                  <div className={"row user" + cont}>
                    <div className="bubble">{m.text}</div>
                  </div>
                ) : (
                  <div className={"row bot" + cont}>
                    <div className="bubble">{renderBot(m)}</div>
                  </div>
                )}
              </Fragment>
            );
          })}
          {thinking && (
            <div className={"row bot" + (messages.at(-1)?.role === "bot" ? " cont" : "")} aria-label="입력 중">
              <div className="bubble typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 선택지 질문이 떠 있으면 입력창을 접어 두고, "직접 입력" 을 누르면 올라온다 */}
      <div className={"composer" + (composerOpen ? "" : " collapsed")}>
        <form onSubmit={onSubmit} autoComplete="off" inert={!composerOpen}>
          <div className="input-wrap" ref={inputWrapRef}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} />
            {/* 메뉴를 link 버튼과 한 묶음으로 둬서 link 의 가운데에 맞춰 세운다 */}
            <div className="link-anchor">
              {/* link 를 누르면 아래쪽 버튼부터 차례로 올라오고, 닫을 때는 위쪽 버튼부터 사라진다
                  (--d: 나타나는 순서, --c: 사라지는 순서) */}
              <div id={quickMenuId} className={"quick-menu" + (quickMenuOpen ? " open" : "")} inert={!quickMenuOpen}>
                {QUICK_MENUS.map((menu, i) => (
                  <button
                    key={menu}
                    type="button"
                    style={{ "--d": QUICK_MENUS.length - 1 - i, "--c": i } as CSSProperties}
                    onClick={() => pickQuickMenu(menu)}
                  >
                    {menu}
                  </button>
                ))}
              </div>
              <button
                className="link-toggle"
                type="button"
                aria-label="link 메뉴"
                aria-expanded={quickMenuOpen}
                aria-controls={quickMenuId}
                onClick={() => setMenuOpen((open) => !open)}
              >
                link
              </button>
            </div>
          </div>
          <button className="send" type="submit" aria-label="ON 전송" disabled={!input.trim()}>
            ON
          </button>
        </form>
      </div>

      {payMethod && order && <PaymentSheet method={payMethod} order={order} onCancel={onPayCancel} onPaid={onPaid} />}
    </div>
  );
}
