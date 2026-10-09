import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import backgroundVideo from "../image/saylo_background.mp4";
import { PaymentSheet, type PaymentSheetHandle } from "./PaymentSheet";
import { useSpeechOutput, useVoiceInput } from "./useSpeech";
import { CalendarPicker } from "./CalendarPicker";
import { CountPicker } from "./CountPicker";
import { TimePicker } from "./TimePicker";
import { FALLBACK_PROMPT, QUICK_MENUS, quickMenuReply } from "./quickMenu";
import {
  MAX_SHOP_QTY,
  SHOP_PROMPT,
  addressPrompt,
  categoryOf,
  findProduct,
  findSize,
  keepsAddress,
  looksLikeAddress,
  makeShopOrder,
  matchShopCategory,
  productsOf,
  shopQuantityQuestion,
  sizePrompt,
  type Product,
} from "./shoppingKnowledge";
import {
  MAX_TICKETS,
  MAX_TICKET_DAYS,
  TICKET_PROMPT,
  findShow,
  isShowDate,
  lastShowDate,
  makeTicketOrder,
  matchTicketCategory,
  sessionPrompt,
  sessionsOn,
  showDatePrompt,
  showsOf,
  ticketQuantityQuestion,
  type Show,
} from "./ticketKnowledge";
import {
  ADDRESS,
  DEFAULT_PEOPLE,
  DELIVERY_PROMPT,
  FOOD_PROMPT,
  MAX_DAYS_AHEAD,
  MAX_PEOPLE,
  MAX_QTY,
  PAYMENTS,
  checkVisitTime,
  daysBetween,
  orderCardQuestion,
  orderCardRows,
  orderCardTitle,
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
// 쇼핑: idle → shopCategory(종류) → shopProduct(상품) → shopSize(사이즈) → shopQty(수량) → shopAddress(배송지) → confirm → pay …
// 예매: idle → tkCategory(종류) → tkShow(작품) → tkDate(날짜) → tkTime(회차) → tkQty(매수) → confirm → pay …
type Stage =
  | "idle" | "menu" | "qty" | "confirm" | "pay" | "paying" | "done"
  | "food" | "restaurant" | "rsvDate" | "rsvTime" | "rsvPeople" | "rsvConfirm"
  | "shopCategory" | "shopProduct" | "shopSize" | "shopQty" | "shopAddress"
  | "tkCategory" | "tkShow" | "tkDate" | "tkTime" | "tkQty";

const SHOP_STAGES: Stage[] = ["shopCategory", "shopProduct", "shopSize", "shopQty", "shopAddress"];
const TICKET_STAGES: Stage[] = ["tkCategory", "tkShow", "tkDate", "tkTime", "tkQty"];

// 예약 정보는 날짜 → 시간 → 인원 순으로 채워진다
type ReservationDraft = Partial<Reservation> & { restaurant: Restaurant };
// 쇼핑은 상품 → 사이즈 → 수량, 예매는 작품 → 날짜 → 회차 순으로 채워진다
interface ShopDraft {
  product?: Product;
  size?: string;
  qty?: number;
}
interface TicketDraft {
  show?: Show;
  date?: Date;
  time?: string;
}

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
  // 수량 카운터: 배달(마리·판·인분)·쇼핑(벌·켤레·개·권)·예매(매)
  | { id: number; role: "bot"; kind: "qty"; text: string; unit: string; max: number; priceEach: number; picked?: number }
  // 쇼핑 상품 목록, 예매 작품 목록
  | { id: number; role: "bot"; kind: "products"; categoryLabel: string; list: Product[]; selected?: string }
  | { id: number; role: "bot"; kind: "shows"; categoryLabel: string; list: Show[]; selected?: string };

type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, "id"> : never) : never;

const GREETING = "안녕하세요! Saylo예요.\n무엇을 주문해 드릴까요?";

let nextId = 1;
const botText = (text: string): NewMessage => ({ role: "bot", kind: "text", text });
const botPrompt = ({ text, choices, placeholder, picker, directLabel, noDirect }: BotPrompt): NewMessage => ({
  role: "bot",
  kind: "text",
  text,
  choices,
  placeholder,
  picker,
  directLabel,
  noDirect,
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
  switch (m.kind) {
    case "text":
      return m.choices?.length ? `${line(m.text)} ${m.choices.map((c) => c.label).join(", ")} 중에서 말씀해 주세요.` : line(m.text);
    case "confirm":
      return "";
    case "order":
      return `${orderCardTitle(m.order)} ${orderCardRows(m.order).map((r) => `${r.label} ${r.value}`).join(", ")}. ${orderCardQuestion(m.order)}`;
    case "payment":
      return `결제 수단을 말씀해 주세요. 총 결제금액 ${won(m.order.price)}. ${PAYMENTS.map((p) => p.label).join(", ")}.`;
    case "restaurants":
      return `근처 ${m.foodLabel} 식당이에요. ${m.list.map((r) => `${r.name} ${km(r.distanceKm)}`).join(", ")}. 원하는 곳을 말씀해 주세요.`;
    case "restaurantPicked":
      return `${withObjectParticle(m.restaurant.name)} 선택했어요.`;
    case "reservation": {
      const r = m.reservation;
      return `예약 내용을 확인해 주세요. ${r.restaurant.name}, ${formatDate(r.date)} ${r.time}, ${r.people}명. 예약할까요?`;
    }
    case "people":
      return `${m.lead ? `${m.lead} ` : ""}${PEOPLE_QUESTION}`;
    case "qty":
      return line(m.text);
    case "products":
      return `${m.categoryLabel} 상품이에요. ${m.list.map((p) => `${p.name} ${won(p.price)}`).join(", ")}. 원하는 상품을 말씀해 주세요.`;
    case "shows":
      return `예매할 수 있는 ${m.categoryLabel}이에요. ${m.list.map((s) => `${s.title} ${won(s.price)}`).join(", ")}. 원하는 작품을 말씀해 주세요.`;
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
  // 진행 중인 식당 예약 · 쇼핑 · 예매
  const [rsv, setRsv] = useState<ReservationDraft | null>(null);
  const [shop, setShop] = useState<ShopDraft>({});
  const [ticket, setTicket] = useState<TicketDraft>({});
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

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
  const composerOpen = !activePrompt || manualInputFor === activePrompt.id;
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

  // 목록 말풍선(식당·상품·작품)에서 고른 항목 표시
  function markPicked(kind: "restaurants" | "products" | "shows", selected: string) {
    const target = lastIdOf(messages, [kind]);
    setMessages((prev) => prev.map((m) => (m.id === target && m.role === "bot" && m.kind === kind ? ({ ...m, selected } as Message) : m)));
  }

  // 가장 최근에 보여 준 목록
  function latestList<K extends "restaurants" | "products" | "shows">(kind: K) {
    const target = lastIdOf(messages, [kind]);
    const m = messages.find((msg) => msg.id === target);
    return (m && m.role === "bot" && m.kind === kind ? m.list : []) as Extract<Message, { kind: K }>["list"];
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
        setRsv(null);
        setStage("idle");
        botReply(() => push(botText(done)), 900);
      } else {
        botReply(() => push(botText("예약할까요? '응' 또는 '취소'로 답해 주세요."), { role: "bot", kind: "confirm" }));
      }
    }
  }

  // 쇼핑·예매에서 주문서까지 왔을 때: 확인 카드 → (응) → 결제수단 → 결제 팝업은 배달과 같다
  function startCheckout(next: Order) {
    setOrder(next);
    setShop({});
    setTicket({});
    setStage("confirm");
    botReply(() => push({ role: "bot", kind: "order", order: next }), 900);
  }

  function endFlow(message: string) {
    setStage("idle");
    setShop({});
    setTicket({});
    botReply(() => push(botText(message)));
  }

  const shopQty = (product: Product, size?: string): NewMessage => ({
    role: "bot",
    kind: "qty",
    text: shopQuantityQuestion(product, size),
    unit: categoryOf(product).unit,
    max: MAX_SHOP_QTY,
    priceEach: product.price,
  });

  const ticketQty = (show: Show, date: Date, time: string): NewMessage => ({
    role: "bot",
    kind: "qty",
    text: ticketQuantityQuestion(show, date, time),
    unit: "매",
    max: MAX_TICKETS,
    priceEach: show.price,
  });

  // 쇼핑 단계별 처리: 종류 → 상품 → (사이즈) → 수량 → 배송지 → 주문서
  function continueShopping(text: string) {
    if (isNo(text)) {
      endFlow("쇼핑을 그만할게요. 다른 게 필요하면 말씀해 주세요!");
      return;
    }

    // 상품 목록이 떠 있으면 상품 이름부터 본다
    const product = stage === "shopProduct" ? findProduct(text, latestList("products")) : undefined;
    if (product) {
      markPicked("products", product.id);
      setShop({ product });
      if (categoryOf(product).sizes) {
        setStage("shopSize");
        botReply(() => push(botPrompt(sizePrompt(product))));
      } else {
        setStage("shopQty");
        botReply(() => push(shopQty(product)));
      }
      return;
    }
    if (stage === "shopCategory" || stage === "shopProduct") {
      const category = matchShopCategory(text);
      if (category) {
        setShop({});
        setStage("shopProduct");
        botReply(() => push({ role: "bot", kind: "products", categoryLabel: category.label, list: productsOf(category.key) }), 900);
        return;
      }
      const hint = stage === "shopProduct" ? "목록에서 상품을 고르거나, 다른 종류를 골라 주세요." : "아래에서 고르거나 직접 입력해 주세요.";
      botReply(() => push(botPrompt({ ...SHOP_PROMPT, text: `어떤 상품인지 잘 모르겠어요.\n${hint}` })));
      return;
    }

    const chosen = shop.product;
    if (!chosen) return;

    if (stage === "shopSize") {
      const size = findSize(text, categoryOf(chosen).sizes ?? []);
      if (!size) {
        botReply(() => push(botPrompt(sizePrompt(chosen, "사이즈를 잘 모르겠어요."))));
        return;
      }
      setShop({ product: chosen, size });
      setStage("shopQty");
      botReply(() => push(shopQty(chosen, size)));
      return;
    }

    if (stage === "shopQty") {
      const qty = parseQuantity(text);
      if (qty === undefined || qty < 1 || qty > MAX_SHOP_QTY) {
        botReply(() => push(shopQty(chosen, shop.size)));
        return;
      }
      setShop({ ...shop, qty });
      setStage("shopAddress");
      botReply(() => push(botPrompt(addressPrompt(ADDRESS))));
      return;
    }

    if (stage === "shopAddress" && shop.qty) {
      const address = keepsAddress(text) || isYes(text) ? ADDRESS : looksLikeAddress(text) ? text.trim() : undefined;
      if (!address) {
        botReply(() => push(botPrompt(addressPrompt(ADDRESS, "주소를 잘 모르겠어요. 시·구·동이나 도로명까지 적어 주세요."))));
        return;
      }
      startCheckout(makeShopOrder(chosen, shop.size, shop.qty, address));
    }
  }

  // 예매 단계별 처리: 종류 → 작품 → 날짜 → 회차 → 매수 → 주문서
  function continueTicketing(text: string) {
    if (isNo(text)) {
      endFlow("예매를 그만할게요. 다른 게 필요하면 말씀해 주세요!");
      return;
    }
    const now = new Date();

    const show = stage === "tkShow" ? findShow(text, latestList("shows")) : undefined;
    if (show) {
      markPicked("shows", show.id);
      setTicket({ show });
      setStage("tkDate");
      botReply(() => push(botPrompt(showDatePrompt(show, now))));
      return;
    }
    if (stage === "tkCategory" || stage === "tkShow") {
      const category = matchTicketCategory(text);
      if (category) {
        setTicket({});
        setStage("tkShow");
        botReply(() => push({ role: "bot", kind: "shows", categoryLabel: category.label, list: showsOf(category.key) }), 900);
        return;
      }
      const hint = stage === "tkShow" ? "목록에서 작품을 고르거나, 다른 종류를 골라 주세요." : "아래에서 고르거나 직접 입력해 주세요.";
      botReply(() => push(botPrompt({ ...TICKET_PROMPT, text: `무엇을 예매할지 잘 모르겠어요.\n${hint}` })));
      return;
    }

    const chosen = ticket.show;
    if (!chosen) return;

    if (stage === "tkDate") {
      const date = parseVisitDate(text, now);
      let lead: string | undefined;
      if (date === "past") lead = "이미 지난 날짜예요.";
      else if (date === "far" || (date instanceof Date && daysBetween(now, date) > MAX_TICKET_DAYS))
        lead = `오늘부터 ${MAX_TICKET_DAYS + 1}일 안에서만 예매할 수 있어요.`;
      else if (!(date instanceof Date)) lead = "날짜를 잘 모르겠어요.";
      else if (!isShowDate(chosen, date, now)) lead = `${formatDate(date)}은 남은 회차가 없어요.`;
      if (lead || !(date instanceof Date)) {
        botReply(() => push(botPrompt(showDatePrompt(chosen, now, lead))));
        return;
      }
      setTicket({ show: chosen, date });
      setStage("tkTime");
      botReply(() => push(botPrompt(sessionPrompt(chosen, date, now))));
      return;
    }

    if (stage === "tkTime" && ticket.date) {
      const date = ticket.date;
      const time = parseVisitTime(text);
      if (!time || !sessionsOn(chosen, date, now).includes(time)) {
        botReply(() => push(botPrompt(sessionPrompt(chosen, date, now, "그 시간에는 회차가 없어요."))));
        return;
      }
      setTicket({ ...ticket, time });
      setStage("tkQty");
      botReply(() => push(ticketQty(chosen, date, time)));
      return;
    }

    if (stage === "tkQty" && ticket.date && ticket.time) {
      const qty = parseQuantity(text);
      if (qty === undefined || qty < 1 || qty > MAX_TICKETS) {
        botReply(() => push(ticketQty(chosen, ticket.date!, ticket.time!)));
        return;
      }
      startCheckout(makeTicketOrder(chosen, ticket.date, ticket.time, qty));
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

    if (stage === "confirm" && order) {
      if (isNo(text)) {
        setStage("idle");
        setOrder(null);
        const cancelled = order.kind === "ticket" ? "예매를 취소했어요." : "주문을 취소했어요.";
        botReply(() => push(botText(`${cancelled} 다른 게 필요하면 말씀해 주세요!`)));
      } else if (isYes(text)) {
        setStage("pay");
        botReply(() => push({ role: "bot", kind: "payment", order }));
      } else {
        botReply(() => push(botText(`${orderCardQuestion(order)} '응' 또는 '취소'로 답해 주세요.`), { role: "bot", kind: "confirm" }));
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

    // 쇼핑·예매 중. 마찬가지로 빠른 메뉴를 고르면 진행 중인 것을 접고 아래로 넘어간다
    if (SHOP_STAGES.includes(stage) || TICKET_STAGES.includes(stage)) {
      if (!quickMenuReply(text)) {
        if (SHOP_STAGES.includes(stage)) continueShopping(text);
        else continueTicketing(text);
        return;
      }
      setShop({});
      setTicket({});
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
      if (!quickMenuReply(text)) {
        botReply(() => push(botPrompt({ ...DELIVERY_PROMPT, text: "지금은 아래 메뉴를 배달할 수 있어요.\n골라 주시거나 메뉴 이름을 입력해 주세요." })));
        return;
      }
    }

    // 식당 찾기 중에는 식당 이름 → 음식 종류 순으로 먼저 본다. 둘 다 아니면 아래 일반 처리로 넘어간다
    if (stage === "food" || stage === "restaurant") {
      const picked = stage === "restaurant" ? findRestaurant(text, latestList("restaurants")) : undefined;
      if (picked) {
        // 식당을 고르면 예약으로 이어진다
        markPicked("restaurants", picked.id);
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
      setRsv(null);
      setShop({});
      setTicket({});
      setStage(quickReply.next);
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
    setPickerOpenFor(null);
    setPendingItem(null);
    setRsv(null);
    setShop({});
    setTicket({});
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
  // 달력은 식당 예약(영업일·30일)과 공연 예매(남은 회차·14일)에서 함께 쓰고, 고를 수 있는 날만 다르다
  function renderPicker(picker: "date" | "time") {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const pickDate = (d: Date) => handle(`${d.getMonth() + 1}월 ${d.getDate()}일`);
    if (picker === "date" && stage === "tkDate" && ticket.show) {
      const show = ticket.show;
      return <CalendarPicker today={today} lastDate={lastShowDate(now)} active isSelectable={(d) => isShowDate(show, d, now)} onPick={pickDate} />;
    }
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
  const activeProductsId = stage === "shopProduct" ? lastIdOf(messages, ["products"]) : undefined;
  const activeShowsId = stage === "tkShow" ? lastIdOf(messages, ["shows"]) : undefined;

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
            {orderCardTitle(m.order)}
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
              <div style={{ marginTop: 10 }}>{orderCardQuestion(m.order)}</div>
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
      case "products":
        return (
          <>
            {`${m.categoryLabel} 상품이에요.\n원하는 상품을 눌러 주세요.`}
            <div className="places">
              {m.list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={m.selected === p.id ? "selected" : undefined}
                  disabled={m.id !== activeProductsId}
                  onClick={() => handle(p.name)}
                >
                  <span className="place-main">
                    <b>{p.name}</b>
                    <small>
                      {p.brand} · {p.desc}
                    </small>
                  </span>
                  <span className="place-distance">{won(p.price)}</span>
                </button>
              ))}
            </div>
          </>
        );
      case "shows":
        return (
          <>
            {`예매할 수 있는 ${m.categoryLabel}이에요.\n원하는 작품을 눌러 주세요.`}
            <div className="places">
              {m.list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={m.selected === s.id ? "selected" : undefined}
                  disabled={m.id !== activeShowsId}
                  onClick={() => handle(s.title)}
                >
                  <span className="place-main">
                    <b>{s.title}</b>
                    <small>
                      {s.venue} · {s.info}
                    </small>
                  </span>
                  <span className="place-distance">{won(s.price)}</span>
                </button>
              ))}
            </div>
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
          {tts.supported && (
            <button
              className={"icon-btn" + (tts.enabled ? " on" : "")}
              type="button"
              aria-pressed={tts.enabled}
              aria-label={tts.enabled ? "답 읽어 주기 끄기" : "답 읽어 주기 켜기"}
              title={tts.enabled ? "답 읽어 주기 끄기" : "답 읽어 주기 켜기"}
              onClick={tts.toggle}
            >
              <SpeakerIcon muted={!tts.enabled} />
            </button>
          )}
          <button
            className={"icon-btn mic" + (voice.listening ? " on" : "")}
            type="button"
            aria-pressed={voice.listening}
            aria-label={voice.listening ? "듣기 멈추기" : "말로 입력"}
            title={voice.supported ? (voice.listening ? "듣기 멈추기" : "말로 입력") : "이 브라우저는 음성 인식을 지원하지 않아요"}
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

      {/* 음성 상태 띠: 듣는 동안은 중간 인식 결과, 아니면 오류·안내 문구 */}
      {(voice.listening || voice.error || notice) && (
        <div className={"voice-bar" + (voice.listening ? "" : " note")} role="status" aria-live="polite">
          {voice.listening ? (
            <>
              <span className="voice-dot" aria-hidden="true" />
              <span className="voice-text">{voice.interim || "듣고 있어요. 말씀해 주세요."}</span>
              <button type="button" onClick={voice.stop}>
                멈추기
              </button>
            </>
          ) : (
            <span className="voice-text">{voice.error ?? notice}</span>
          )}
        </div>
      )}

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
