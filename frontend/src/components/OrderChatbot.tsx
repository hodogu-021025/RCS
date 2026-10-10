import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import backgroundVideo from "../image/saylo_background.mp4";
import { PaymentSheet, type PaymentSheetHandle } from "./PaymentSheet";
import { useSpeechOutput, useVoiceInput } from "./useSpeech";
import { useSession } from "../auth/auth";
import { addOrder, addReservation, useDb } from "../data/db";
import { CalendarPicker } from "./CalendarPicker";
import { CountPicker } from "./CountPicker";
import { TimePicker } from "./TimePicker";
import { VoiceCaption } from "./VoiceCaption";
import { FALLBACK_PROMPT, QUICK_MENUS, menuIntent, menuReply, quickMenuReply } from "./quickMenu";
import {
  DEFAULT_PEOPLE,
  deliveryPrompt,
  FOOD_PROMPT,
  MAX_DAYS_AHEAD,
  MAX_PEOPLE,
  MAX_QTY,
  ORDER_CARD_QUESTION,
  ORDER_CARD_TITLE,
  PAYMENTS,
  checkVisitTime,
  orderCardRows,
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
  quantityQuestion,
  reservationDoneText,
  bookableTimes,
  isBookableDate,
  lastBookableDate,
  timePrompt,
  recommend,
  spokenTime,
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
  | {
      id: number;
      role: "bot";
      kind: "text";
      text: string;
      choices?: Choice[];
      placeholder?: string;
      picker?: BotPrompt["picker"];
      directLabel?: string;
      noDirect?: boolean;
      say?: string;
      picked?: string;
    }
  | { id: number; role: "bot"; kind: "order"; order: Order }
  | { id: number; role: "bot"; kind: "confirm" }
  | { id: number; role: "bot"; kind: "payment"; order: Order; selected?: PaymentId }
  | { id: number; role: "bot"; kind: "restaurants"; foodLabel: string; list: Restaurant[]; selected?: string }
  | { id: number; role: "bot"; kind: "restaurantPicked"; restaurant: Restaurant }
  | { id: number; role: "bot"; kind: "reservation"; reservation: Reservation }
  // 예약 인원 카운터. lead: 다시 물을 때 앞에 붙일 이유, picked: 고른 인원
  | { id: number; role: "bot"; kind: "people"; lead?: string; picked?: number }
  // 배달 수량 카운터 (마리·판·인분)
  | { id: number; role: "bot"; kind: "qty"; text: string; unit: string; max: number; priceEach: number; picked?: number };

type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, "id"> : never) : never;

// 대화 영역 아래에 겹쳐 뜨는 음성 카드의 내용
interface VoiceBar {
  kind: "listening" | "note";
  text: string;
}

const GREETING = "안녕하세요! Saylo예요.\n무엇을 주문해 드릴까요?";

let nextId = 1;
const botText = (text: string): NewMessage => ({ role: "bot", kind: "text", text });
const botPrompt = ({ text, choices, placeholder, picker, directLabel, noDirect, say }: BotPrompt): NewMessage => ({
  role: "bot",
  kind: "text",
  text,
  choices,
  placeholder,
  picker,
  directLabel,
  noDirect,
  say,
});
const DEFAULT_PLACEHOLDER = "메시지를 입력하세요";
const greeting = (): Message[] => [{ id: nextId++, ...botText(GREETING) } as Message];

// 배달 수량 카운터 말풍선
const deliveryQty = (item: DeliveryItem, lead?: string): NewMessage => ({
  role: "bot",
  kind: "qty",
  text: quantityQuestion(item, lead),
  unit: item.unit,
  max: MAX_QTY,
  priceEach: item.price,
});

// "직접 입력" 버튼 아이콘: 글자 입력은 연필, 날짜는 달력, 시간은 시계
function DirectInputIcon({ picker }: { picker?: BotPrompt["picker"] }) {
  const common = { stroke: "currentColor", strokeWidth: 1.5, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      {picker === "date" ? (
        <>
          <rect x="2.5" y="3.5" width="11" height="10" rx="2" {...common} />
          <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" {...common} />
        </>
      ) : picker === "time" ? (
        <>
          <circle cx="8" cy="8" r="5.5" {...common} />
          <path d="M8 5v3.2l2 1.3" {...common} />
        </>
      ) : (
        <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" {...common} />
      )}
    </svg>
  );
}

// 읽어 주기용 문장. 화면의 카드·버튼을 말로 풀어 쓴다 (선택지는 끝에 나열해서 말로 고를 수 있게)
function spokenText(m: Message): string {
  if (m.role === "user") return "";
  const line = (s: string) => s.replace(/\n/g, " ");
  // 선택지는 "중에서 고르세요"가 아니라 추천하듯 말한다. 질문마다 따로 써 둔 문장(say)이 있으면 그걸 읽는다
  switch (m.kind) {
    case "text":
      if (m.say) return m.say;
      if (!m.choices?.length) return line(m.text);
      return m.noDirect
        ? `${line(m.text)} ${m.choices.map((c) => c.label).join(", ")} 중에서 골라 주세요.`
        : `${line(m.text)} ${recommend(m.choices.map((c) => c.label))} 다른 것도 편하게 말씀해 주세요.`;
    case "confirm":
      return "";
    case "order":
      return `${ORDER_CARD_TITLE} ${orderCardRows(m.order).map((r) => `${r.label} ${r.value}`).join(", ")}. ${ORDER_CARD_QUESTION}`;
    case "payment":
      return `총 결제금액은 ${won(m.order.price)}이에요. ${PAYMENTS.map((p) => p.label).join(", ")}로 결제할 수 있어요. 어떤 걸로 하시겠어요?`;
    case "restaurants":
      return `근처 ${m.foodLabel} 맛집으로 ${recommend(m.list.map((r) => r.name))} 가까운 순서예요. 마음에 드는 곳을 말씀해 주세요.`;
    case "restaurantPicked":
      return `${withObjectParticle(m.restaurant.name)} 선택했어요.`;
    case "reservation": {
      const r = m.reservation;
      return `예약 내용을 확인해 주세요. ${r.restaurant.name}, ${formatDate(r.date)} ${spokenTime(r.time)}, ${r.people}명. 예약할까요?`;
    }
    case "people":
      return `${m.lead ? `${m.lead} ` : ""}${PEOPLE_QUESTION}`;
    case "qty":
      return line(m.text);
  }
}

// 헤더 아이콘 (선으로 그린 마이크·스피커)
const ICON = { stroke: "currentColor", strokeWidth: 1.5, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
const MicIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" {...ICON} />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" {...ICON} />
  </svg>
);
const ChatIcon = ({ hidden }: { hidden: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4.5A1.5 1.5 0 0 1 3 3z" {...ICON} />
    {hidden && <path d="M2 1.5l12 13" {...ICON} />}
  </svg>
);
const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M2.5 6h2.5l3-2.5v9l-3-2.5H2.5z" {...ICON} />
    {muted ? <path d="M10.5 6l3 4M13.5 6l-3 4" {...ICON} /> : <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" {...ICON} />}
  </svg>
);

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
  // 헤더의 채팅창 끄기: 말풍선 목록을 숨기고, 대신 봇이 소리로 하는 말만 가운데 자막으로 보여 준다 (기본은 꺼짐)
  const [chatHidden, setChatHidden] = useState(true);
  // "직접 입력" 을 누른 선택지 말풍선의 id. 그 말풍선이 최신 질문인 동안만 입력창이 열려 있다
  const [manualInputFor, setManualInputFor] = useState<number | null>(null);
  // 날짜·시간 질문에서 "직접 입력"으로 펼친 달력·시간 고르기의 말풍선 id
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  // 음성 입력에 대한 짧은 안내 ("답하는 중이에요" 등). 잠시 보였다가 사라진다
  const [notice, setNotice] = useState<string | null>(null);
  const quickMenuId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const sheetRef = useRef<PaymentSheetHandle>(null);

  // 말로 입력: 들은 문장을 글자로 입력한 것과 똑같이 처리한다 (입력창이 접혀 있어도 된다)
  const voice = useVoiceInput(handleVoice);
  const tts = useSpeechOutput();
  // 로그인한 소비자면 주문·예약 기록에 이름이 남고, 아니면 비회원으로 남는다
  const session = useSession();
  // 사장님이 바꾼 영업시간·품절을 서버에서 받아 온다 (메뉴 버튼과 예약 시간에 반영)
  useDb(["settings"]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

  // 음성 카드에 보일 내용. 없어질 때도 카드가 내려가는 동안 마지막 내용을 보여 줘야 하므로 마지막 값을 기억한다
  // (렌더 중에 상태를 맞추는 React 의 파생 상태 방식)
  const voiceBar: VoiceBar | null = voice.listening
    ? { kind: "listening", text: voice.interim }
    : voice.error || notice
      ? { kind: "note", text: voice.error ?? notice ?? "" }
      : null;
  const [shownBar, setShownBar] = useState<VoiceBar | null>(voiceBar);
  if (voiceBar && (voiceBar.kind !== shownBar?.kind || voiceBar.text !== shownBar.text)) setShownBar(voiceBar);

  // 배경 물결: 지금 누가 말하는지, 그리고 사라지는 동안 유지할 마지막 모양 (같은 파생 상태 방식)
  const voiceKind: "talking" | "listening" | null = tts.speaking ? "talking" : voice.listening ? "listening" : null;
  const [waveKind, setWaveKind] = useState<"talking" | "listening">("talking");
  if (voiceKind && voiceKind !== waveKind) setWaveKind(voiceKind);

  // 읽어 주기가 켜져 있으면 새로 온 봇 말풍선을 읽는다 (한 번에 여러 개가 오면 이어서)
  const spokenUpTo = useRef(0);
  const { speak } = tts;
  useEffect(() => {
    const fresh = messages.filter((m) => m.id > spokenUpTo.current);
    if (fresh.length === 0) return;
    spokenUpTo.current = fresh[fresh.length - 1].id;
    const text = fresh.map(spokenText).filter(Boolean).join(" ");
    if (text) speak(text);
  }, [messages, speak]);

  // 가장 최근 봇 말풍선이 버튼으로 답하는 질문(선택지·인원/수량 카운터)이면, "직접 입력" 을 누르기 전까지 입력창을 접어 둔다
  // (카운터에는 직접 입력이 없어 버튼으로만 답한다)
  const lastBot = messages.findLast((m) => m.role === "bot");
  const activePrompt =
    lastBot?.role === "bot" && ((lastBot.kind === "text" && lastBot.choices) || lastBot.kind === "people" || lastBot.kind === "qty")
      ? lastBot
      : undefined;
  // 채팅창을 끈 동안의 가운데 자막: 마지막으로 사용자가 말한 뒤에 나온 봇 말풍선들을 읽어 주는 문장 그대로
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  const botTurn = messages.slice(lastUserIndex + 1);
  const captionText = botTurn.map(spokenText).filter(Boolean).join(" ");
  const captionId = botTurn.at(-1)?.id ?? null;

  // 채팅창을 숨기면 선택 버튼도 안 보이므로 입력창은 늘 열어 둔다
  const composerOpen = chatHidden || !activePrompt || manualInputFor === activePrompt.id;
  // 선택 버튼은 그 질문이 대화의 마지막이고 봇이 답하는 중이 아닐 때만 누를 수 있다
  const activeChoicesId = activePrompt && messages.at(-1)?.id === activePrompt.id && !thinking ? activePrompt.id : undefined;
  const promptPlaceholder = activePrompt?.kind === "text" ? activePrompt.placeholder : undefined;
  const placeholder = (composerOpen && promptPlaceholder) || DEFAULT_PLACEHOLDER;
  // 빠른 메뉴는 입력창 안에 있으므로 입력창이 접히면 같이 숨는다
  const quickMenuOpen = menuOpen && composerOpen;

  // 새 메시지가 오거나 달력·시간 고르기가 펼쳐지면 맨 아래로
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, thinking, pickerOpenFor]);

  // 입력창이 펼쳐지거나 접히면서(또는 휴대폰 키보드가 올라오면서) 대화 영역 높이가 바뀌면 맨 아래를 계속 보여 준다.
  // 입력창은 애니메이션으로 열리므로 위 효과만으로는 마지막 말풍선의 버튼이 입력창 아래에 가려진다
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    // 애니메이션 중에는 매 프레임 불리므로 부드러운 스크롤(.chat 의 scroll-behavior) 대신 바로 옮긴다
    const observer = new ResizeObserver(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: "instant" });
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

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

  // 식당 목록 말풍선에서 고른 식당 표시
  function markPickedRestaurant(selected: string) {
    const target = lastIdOf(messages, ["restaurants"]);
    setMessages((prev) => prev.map((m) => (m.id === target && m.role === "bot" && m.kind === "restaurants" ? { ...m, selected } : m)));
  }

  // 가장 최근에 보여 준 식당 목록
  function latestRestaurants(): Restaurant[] {
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
    botReply(() => push(deliveryQty(item, qty !== undefined ? rangeLead(item) : undefined)));
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
      if (bookableTimes(restaurant, date, now).length === 0) {
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
        // 사장님·관리자 화면에서 보이도록 기록한다
        // 로그인했으면 그 사람 이름으로, 아니면 비회원으로 서버에 남는다 (실패해도 대화는 이어 간다)
        addReservation({ restaurantId: restaurant.id, restaurantName: restaurant.name, date: draft.date, time: draft.time, people: draft.people }).catch(
          () => {},
        );
        setRsv(null);
        setStage("idle");
        botReply(() => push(botText(done)), 900);
      } else {
        botReply(() => push(botText("예약할까요? '응' 또는 '취소'로 답해 주세요."), { role: "bot", kind: "confirm" }));
      }
    }
  }

  // 음성으로 들은 문장. 결제 화면이 떠 있으면 "결제"·"취소"만 받고, 그 밖에는 글자 입력과 같다
  function handleVoice(text: string) {
    if (stage === "paying") {
      if (isNo(text)) sheetRef.current?.cancel();
      else if (isYes(text) || text.includes("결제")) sheetRef.current?.pay();
      else setNotice('결제 화면에서는 "결제" 또는 "취소"라고 말씀해 주세요.');
      return;
    }
    if (thinking) {
      setNotice("답하는 중이에요. 잠시 뒤 다시 말씀해 주세요.");
      return;
    }
    setMenuOpen(false);
    handle(text);
  }

  function handle(raw: string) {
    const text = raw.trim();
    if (!text || thinking || stage === "paying") return;
    push({ role: "user", text });

    // 주문 확인·결제수단 단계에서 빠른 메뉴(배달·식당 등)를 고르면 주문을 접고 아래 일반 처리로 넘어간다
    const switchingMenu = (stage === "confirm" || stage === "pay") && !!quickMenuReply(text);

    if (stage === "confirm" && order && !switchingMenu) {
      if (isNo(text)) {
        setStage("idle");
        setOrder(null);
        botReply(() => push(botText("주문을 취소했어요. 다른 게 필요하면 말씀해 주세요!")));
      } else if (isYes(text)) {
        setStage("pay");
        botReply(() => push({ role: "bot", kind: "payment", order }));
      } else {
        botReply(() => push(botText(`${ORDER_CARD_QUESTION} '응' 또는 '취소'로 답해 주세요.`), { role: "bot", kind: "confirm" }));
      }
      return;
    }

    if (stage === "pay" && order && !switchingMenu) {
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
        else botReply(() => push(deliveryQty(pendingItem, rangeLead(pendingItem))));
        return;
      }
      if (isNo(text)) {
        cancelDelivery();
        return;
      }
      if (!quickMenuReply(text) && findDeliveryItems(text).length === 0) {
        botReply(() => push(deliveryQty(pendingItem, "수량을 잘 모르겠어요.")));
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
      if (!menuIntent(text)) {
        const menu = deliveryPrompt();
        const names = (menu.choices ?? []).map((c) => c.label);
        botReply(() =>
          push(
            botPrompt({
              ...menu,
              text: "그 메뉴는 아직 배달이 어려워요.\n대신 이런 메뉴는 어떠세요?",
              say: `그 메뉴는 아직 배달이 어려워요.${names.length ? ` 대신 ${recommend(names)}` : ""} 드시고 싶은 다른 메뉴도 말씀해 주세요.`,
            }),
          ),
        );
        return;
      }
    }

    // 식당 찾기 중에는 식당 이름 → 음식 종류 순으로 먼저 본다. 둘 다 아니면 아래 일반 처리로 넘어간다
    if (stage === "food" || stage === "restaurant") {
      const picked = stage === "restaurant" ? findRestaurant(text, latestRestaurants()) : undefined;
      if (picked) {
        // 식당을 고르면 예약으로 이어진다
        markPickedRestaurant(picked.id);
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
      if (!menuIntent(text) && findDeliveryItems(text).length === 0) {
        const hint = stage === "restaurant" ? "추천 맛집 중에서 고르시거나, 다른 음식을 말씀해 주세요." : "드시고 싶은 음식을 편하게 말씀해 주세요.";
        botReply(() =>
          push(botPrompt({ ...FOOD_PROMPT, text: `어떤 음식인지 잘 모르겠어요.\n${hint}`, say: `어떤 음식인지 잘 모르겠어요. ${hint}` })),
        );
        return;
      }
    }

    // 문장 속에 배달·식당을 뜻하는 말이 있으면 그 기능으로 ("배달 주문하고 싶어", "근처 식당 예약할래")
    const intent = menuIntent(text);
    const food = matchFood(text);

    // "중식 식당 예약해줘": 식당 말과 음식 종류를 같이 말했으면 바로 근처 식당 추천으로
    if (intent === "식당") {
      if (food) {
        startFresh();
        showRestaurants(food.label, nearbyRestaurants(food.key));
      } else {
        startMenu("식당");
      }
      return;
    }

    // "간장치킨 2마리 시켜줘", "떡볶이": 배달 메뉴 이름이 있으면 배달 주문으로
    if (tryDelivery(text)) return;

    if (intent === "배달") {
      startMenu("배달");
      return;
    }

    // "한식 먹고 싶어": 배달 메뉴에는 없는 음식 종류만 말했으면 근처 식당 추천으로
    if (food) {
      startFresh();
      showRestaurants(food.label, nearbyRestaurants(food.key));
      return;
    }

    botReply(() => push(botPrompt(FALLBACK_PROMPT)));
  }

  // 진행 중이던 주문·예약을 접고 처음부터
  function startFresh() {
    setPendingItem(null);
    setOrder(null);
    setRsv(null);
  }

  // 배달·식당의 첫 질문으로
  function startMenu(menu: "배달" | "식당") {
    const reply = menuReply(menu)!;
    startFresh();
    setStage(reply.next);
    botReply(() => push(botPrompt(reply)));
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
    // 사장님·관리자 화면에서 보이도록 기록한다
    addOrder(order, payMethod.label).catch(() => {});
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
    setPickerOpenFor(null);
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

  // 카운터(예약 인원·배달 수량)에서 고른 수. "3명", "2마리"처럼 입력한 것으로 처리한다
  function pickCount(promptId: number, count: number, unit: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === promptId && m.role === "bot" && (m.kind === "people" || m.kind === "qty") ? { ...m, picked: count } : m,
      ),
    );
    handle(`${count}${unit}`);
  }

  // 접혀 있던 입력창을 연다. 이미 열려 있으면 포커스만 옮긴다
  function openManualInput(promptId: number) {
    setManualInputFor(promptId);
    inputRef.current?.focus();
  }

  function togglePicker(promptId: number) {
    setPickerOpenFor((open) => (open === promptId ? null : promptId));
  }

  // 날짜·시간 고르기 화면. 고른 값은 사용자가 그렇게 입력한 것처럼 처리한다
  // 달력은 오늘부터 30일 안에서 예약할 시간이 남은 날만 고를 수 있다
  function renderPicker(picker: "date" | "time") {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const pickDate = (d: Date) => handle(`${d.getMonth() + 1}월 ${d.getDate()}일`);
    if (!rsv) return null;
    if (picker === "date") {
      return (
        <CalendarPicker
          today={today}
          lastDate={lastBookableDate(now)}
          active
          isSelectable={(d) => isBookableDate(rsv.restaurant, d, now)}
          onPick={pickDate}
        />
      );
    }
    if (!rsv.date) return null;
    return <TimePicker times={bookableTimes(rsv.restaurant, rsv.date, now)} active onPick={(t) => handle(t)} />;
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
        // 날짜·시간 질문은 "직접 입력"이 글자 입력창 대신 달력·시간 고르기를 펼친다
        const manual = m.picker ? pickerOpenFor === m.id : manualInputFor === m.id;
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
              {!m.noDirect && (
                <button
                  type="button"
                  className={"direct" + (manual ? " selected" : "")}
                  disabled={!active}
                  aria-pressed={manual}
                  aria-expanded={m.picker ? manual : undefined}
                  onClick={() => (m.picker ? togglePicker(m.id) : openManualInput(m.id))}
                >
                  <DirectInputIcon picker={m.picker} />
                  {m.directLabel ?? "직접 입력"}
                </button>
              )}
            </div>
            {active && manual && m.picker && renderPicker(m.picker)}
          </>
        );
      }
      case "confirm":
        return confirmActions(m.id);
      case "order":
        return (
          <>
            {ORDER_CARD_TITLE}
            <div>
              <div className="card">
                <dl>
                  {orderCardRows(m.order).map((row) => (
                    <Fragment key={row.label}>
                      <dt>{row.label}</dt>
                      <dd className={row.emphasis ? "price" : undefined}>{row.value}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
              <div style={{ marginTop: 10 }}>{ORDER_CARD_QUESTION}</div>
              {confirmActions(m.id)}
            </div>
          </>
        );
      case "payment":
        return (
          <>
            {`어떤 걸로 결제하시겠어요?\n총 결제금액: ${won(m.order.price)}`}
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
            {`근처 ${m.foodLabel} 맛집을 추천해요!\n가까운 순서예요. 마음에 드는 곳을 골라 주세요.`}
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
            <CountPicker
              unit="명"
              max={MAX_PEOPLE}
              initial={DEFAULT_PEOPLE}
              active={m.id === activeChoicesId}
              picked={m.picked}
              onPick={(n) => pickCount(m.id, n, "명")}
            />
          </>
        );
      case "qty":
        return (
          <>
            {m.text}
            <CountPicker
              unit={m.unit}
              max={m.max}
              initial={1}
              priceEach={m.priceEach}
              active={m.id === activeChoicesId}
              picked={m.picked}
              onPick={(n) => pickCount(m.id, n, m.unit)}
            />
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
        {/* 글자 로고 */}
        <h1 className="title">Saylo</h1>
        <div className="header-tools">
          {/* 계정: 비로그인은 로그인 페이지로, 로그인 상태면 내 주문 페이지로 (해시 주소라 링크만으로 이동한다) */}
          <a
            className={"icon-btn" + (session ? " on" : "")}
            href={session ? "#/me" : "#/login"}
            aria-label={session ? `${session.name} · 내 주문` : "로그인"}
            title={session ? `${session.name} · 내 주문` : "로그인"}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="8" cy="5.5" r="3" {...ICON} />
              <path d="M2.5 14.5a5.5 5.5 0 0 1 11 0" {...ICON} />
            </svg>
          </a>
          {/* 채팅창(말풍선 목록) 보이기·숨기기. 숨기면 배경 구체만 남고 말·글로 계속 주문할 수 있다 */}
          <button
            className={"icon-btn" + (chatHidden ? "" : " on")}
            type="button"
            aria-label={chatHidden ? "채팅창 켜기" : "채팅창 끄기"}
            title={chatHidden ? "채팅창 켜기" : "채팅창 끄기"}
            onClick={() => setChatHidden((h) => !h)}
          >
            <ChatIcon hidden={chatHidden} />
          </button>
          {tts.supported && (
            <button
              className={"icon-btn" + (tts.enabled ? " on" : "")}
              type="button"
              aria-pressed={tts.enabled}
              aria-label={tts.enabled ? "소리 끄기" : "소리 켜기"}
              title={tts.enabled ? "소리 끄기" : "소리 켜기"}
              onClick={tts.toggle}
            >
              <SpeakerIcon muted={!tts.enabled} />
            </button>
          )}
          <button
            className={"icon-btn mic" + (voice.listening ? " on" : "")}
            type="button"
            aria-pressed={voice.listening}
            aria-label={voice.listening ? "음성 모드 끄기" : "음성 모드"}
            title={voice.supported ? (voice.listening ? "음성 모드 끄기" : "음성 모드") : "이 브라우저는 음성 인식을 지원하지 않아요"}
            disabled={!voice.supported}
            onClick={voice.toggle}
          >
            <MicIcon />
          </button>
        </div>
        <button className="new-chat" type="button" onClick={reset} disabled={stage === "paying"}>
          <svg viewBox="0 0 16 16" width="12.6" height="12.6" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
          새 대화
        </button>
      </header>

      {/* 메시지 영역 뒤에 영상을 고정으로 깔고, 그 위에서 메시지 목록만 스크롤한다 */}
      {/* 누가 말하는 중인지에 따라 배경 구체 둘레에 물결이 퍼진다: 봇이 소리로 말하면 talking, 내가 음성 모드로 말하면 listening.
          data-wave 는 마지막 모양을 기억해서, 물결이 서서히 사라지는 동안 모양(속도·진하기)이 바뀌지 않게 한다 */}
      <div className={"chat-area" + (chatHidden ? " chat-hidden" : "")} data-voice={voiceKind ?? undefined} data-wave={waveKind}>
        <video className="chat-bg" src={backgroundVideo} autoPlay muted loop playsInline aria-hidden="true" />
        {/* 구체 둘레에서 퍼져 나가는 물결 (말하는 동안만 움직인다) */}
        <div className="orb-waves" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="chat" ref={listRef} inert={chatHidden}>
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

        {chatHidden && <VoiceCaption id={captionId} text={captionText} thinking={thinking} />}

        {/* 음성 카드: 대화 영역 위에 겹쳐서 아래에서 올라오고(show) 내려간다. 내려가는 동안은 마지막 내용을 그대로 보여 준다.
            듣는 동안은 중간 인식 결과, 아니면 오류·안내 문구 */}
        {shownBar && (
          <div
            className={"voice-bar" + (voiceBar ? " show" : "") + (shownBar.kind === "note" ? " note" : "")}
            role="status"
            aria-live="polite"
            inert={!voiceBar}
          >
            {shownBar.kind === "listening" ? (
              <>
                <span className="voice-dot" aria-hidden="true" />
                <span className="voice-text">{shownBar.text || "듣고 있어요. 말씀해 주세요."}</span>
                <button type="button" onClick={voice.stop}>
                  멈추기
                </button>
              </>
            ) : (
              <span className="voice-text">{shownBar.text}</span>
            )}
          </div>
        )}
      </div>

      {/* 선택지 질문이 떠 있으면 입력창을 접어 두고, "직접 입력" 을 누르면 올라온다 */}
      <div className={"composer" + (composerOpen ? "" : " collapsed")}>
        <form onSubmit={onSubmit} autoComplete="off" inert={!composerOpen}>
          <div className="input-wrap" ref={inputWrapRef}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} />
            {/* 메뉴를 + 버튼과 한 묶음으로 둬서 버튼 가운데에 맞춰 세운다 */}
            <div className="menu-anchor">
              {/* + 를 누르면 아래쪽 버튼부터 차례로 올라오고, 닫을 때는 위쪽 버튼부터 사라진다
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
              {/* 열리면 + 가 45도 돌아 × 모양이 된다 (CSS) */}
              <button
                className="menu-toggle"
                type="button"
                aria-label="메뉴"
                aria-expanded={quickMenuOpen}
                aria-controls={quickMenuId}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" {...ICON} strokeWidth={2} />
                </svg>
              </button>
            </div>
          </div>
          <button className="send" type="submit" aria-label="Say 전송" disabled={!input.trim()}>
            Say
          </button>
        </form>
      </div>

      {payMethod && order && (
        <PaymentSheet ref={sheetRef} method={payMethod} order={order} onCancel={onPayCancel} onPaid={onPaid} />
      )}
    </div>
  );
}
