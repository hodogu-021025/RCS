import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import backgroundVideo from "../image/saylo_background.mp4";
import { PaymentSheet, type PaymentSheetHandle } from "./PaymentSheet";
import { useSpeechOutput, useVoiceInput } from "./useSpeech";
import { useSession } from "../auth/auth";
import { addOrder, addReservation, cancelMyOrder, fetchMyOrders, getReceipts, useDb, type OrderRecord } from "../data/db";
import {
  addressError,
  addressPrompt,
  cleanAddress,
  deliveryChange,
  hasDelivery,
  isStopDelivery,
  loadDelivery,
  normalizePhone,
  phonePrompt,
  saveDelivery,
  type DeliveryInfo,
} from "./delivery";
import { CalendarPicker } from "./CalendarPicker";
import { CountPicker } from "./CountPicker";
import { TimePicker } from "./TimePicker";
import { VoiceCaption } from "./VoiceCaption";
import { FALLBACK_PROMPT, QUICK_MENUS, menuIntent, menuReply, quickMenuReply } from "./quickMenu";
import {
  DEFAULT_PEOPLE,
  deliveryPrompt,
  FOOD_PROMPT,
  FOODS,
  MAX_DAYS_AHEAD,
  MAX_PEOPLE,
  MAX_QTY,
  ORDER_CARD_QUESTION,
  ORDER_CARD_TITLE,
  PAYMENTS,
  checkVisitTime,
  orderCardRows,
  completionCard,
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
  reservationDoneCard,
  bookableTimes,
  isBookableDate,
  lastBookableDate,
  timePrompt,
  recommend,
  availableDeliveryMenu,
  withTopicParticle,
  spokenTime,
  withObjectParticle,
  won,
  type BotPrompt,
  type Choice,
  type DeliveryItem,
  type InfoCard,
  type Order,
  type OrderRow,
  type PaymentId,
  type PaymentMethod,
  type Reservation,
  type Restaurant,
} from "./orderChatKnowledge";
import {
  MEAL_WORD,
  alternativesFor,
  deliversFood,
  detectIntent,
  foodWord,
  foodsForMeal,
  fuzzyFind,
  hasSlots,
  isOpenNow,
  mealOf,
  nearestRestaurants,
  orderLabel,
  orderStatusCard,
  storeInfoCard,
  parsePeople,
  parseReservationSlots,
  recommendItems,
  refersToItem,
  refersToPlace,
  restaurantNamed,
  slotsText,
  soldOutItemNamed,
  usableSlots,
  type FuzzyHit,
  type ReservationSlots,
} from "./understanding";

// 배달: idle → menu(메뉴 대기) → qty(수량 대기) → confirm(주문 확인 대기) → pay(결제수단 선택 대기) → paying(결제 팝업) → done
// 식당: idle → food(음식 종류 대기) → restaurant(식당 목록에서 선택 대기)
//      → rsvDate(날짜) → rsvTime(시간) → rsvPeople(인원) → rsvConfirm(예약 확인) → idle
// 배달지: 주소·연락처를 모르면 주문서 전에 address(주소) → phone(연락처)를 묻는다
// 그 밖: info(어느 가게 정보인지 고르는 중), cancelConfirm(내 주문 취소 확인)
type Stage =
  | "idle" | "menu" | "qty" | "confirm" | "pay" | "paying" | "done"
  | "food" | "restaurant" | "rsvDate" | "rsvTime" | "rsvPeople" | "rsvConfirm"
  | "info" | "cancelConfirm" | "address" | "phone";

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
  // heading: "근처 ○○ 맛집을 추천해요" 대신 쓸 첫 문장 (가장 가까운 곳, 어느 가게인지 묻기)
  | { id: number; role: "bot"; kind: "restaurants"; foodLabel: string; list: Restaurant[]; heading?: string; selected?: string }
  | { id: number; role: "bot"; kind: "restaurantPicked"; restaurant: Restaurant }
  | { id: number; role: "bot"; kind: "reservation"; reservation: Reservation }
  // 예약 인원 카운터. lead: 다시 물을 때 앞에 붙일 이유, picked: 고른 인원
  | { id: number; role: "bot"; kind: "people"; lead?: string; picked?: number }
  // 표로 보여 주는 안내: 예약 완료·결제 완료·주문 상태·가게 정보
  | { id: number; role: "bot"; kind: "info"; card: InfoCard }
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
      if (m.heading) return `${line(m.heading)} ${recommend(m.list.map((r) => r.name))}`;
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
    case "info":
      return m.card.say ?? `${line(m.card.title)} ${m.card.rows.map((r) => `${r.label} ${r.value}`).join(", ")}.${m.card.note ? ` ${m.card.note}` : ""}`;
  }
}

// ---- 채팅창을 끈 동안의 가운데 자막 ----
// 표가 있는 답(주문서·예약 확인·식당·안내)은 자막에 제목·질문 한 줄만 적고, 다 적히면 그 아래에 표를 띄운다.
// 소리로는 지금처럼 표 내용까지 읽는다 (spokenText)
export interface CaptionCard {
  key: string;
  rows: OrderRow[];
  list?: boolean; // 식당 목록: 왼쪽이 이름, 오른쪽이 거리·대표 메뉴
}

function captionCard(m: Message, now: Date): CaptionCard | null {
  if (m.role === "user") return null;
  const key = `m${m.id}`;
  switch (m.kind) {
    case "order":
      return { key, rows: orderCardRows(m.order) };
    case "reservation": {
      const r = m.reservation;
      return {
        key,
        rows: [
          { label: "식당", value: r.restaurant.name },
          { label: "날짜", value: formatDate(r.date) },
          { label: "시간", value: r.time, emphasis: true },
          { label: "인원", value: `${r.people}명` },
          { label: "주소", value: r.restaurant.address },
        ],
      };
    }
    case "restaurantPicked": {
      const r = m.restaurant;
      return {
        key,
        rows: [
          { label: "식당", value: r.name },
          { label: "거리", value: km(r.distanceKm) },
          { label: "대표 메뉴", value: r.signature },
          { label: "영업시간", value: r.hours },
          { label: "주소", value: r.address },
        ],
      };
    }
    case "info":
      return { key, rows: m.card.rows };
    case "restaurants":
      return {
        key,
        list: true,
        rows: m.list.map((r) => ({
          label: r.name,
          value: `${km(r.distanceKm)} · ${r.signature} · ${isOpenNow(r, now) ? "영업 중" : `${r.hours.split("-")[0].trim()} 오픈`}`,
        })),
      };
    default:
      return null;
  }
}

function captionLine(m: Message): string {
  if (m.role === "user") return "";
  switch (m.kind) {
    case "order":
      return `${ORDER_CARD_TITLE} ${ORDER_CARD_QUESTION}`;
    case "reservation":
      return "예약 내용을 확인해 주세요. 예약할까요?";
    case "restaurantPicked":
      return `${withObjectParticle(m.restaurant.name)} 선택했어요.`;
    case "info":
      return [m.card.title, m.card.note].filter(Boolean).join(" ");
    case "restaurants":
      return m.heading ? m.heading.replace(/\n/g, " ") : `근처 ${m.foodLabel} 맛집을 추천해요! 마음에 드는 곳을 말씀해 주세요.`;
    default:
      return spokenText(m);
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
  // 한 문장에 같이 말해 둔 것들: 메뉴를 고르기 전에 말한 수량("치킨 두 마리"), 결제수단("카카오페이로"),
  // 식당을 고르기 전에 말한 예약 날짜·시간·인원("내일 7시 4명")
  const [pendingQty, setPendingQty] = useState<number | null>(null);
  const [pendingPay, setPendingPay] = useState<PaymentMethod | null>(null);
  const [rsvSlots, setRsvSlots] = useState<ReservationSlots>({});
  // "그 식당", "아까 그거"가 가리킬 마지막 식당·메뉴
  const [lastPlace, setLastPlace] = useState<Restaurant | null>(null);
  const [lastItem, setLastItem] = useState<DeliveryItem | null>(null);
  // 취소할지 묻고 있는 내 주문
  const [cancelTarget, setCancelTarget] = useState<OrderRecord | null>(null);
  // 배달지·연락처 (이 브라우저에 기억해 둔 것). 모르는 동안 고른 메뉴·수량은 pendingOrder 에 두고 주소부터 묻는다
  const [delivery, setDelivery] = useState<Partial<DeliveryInfo>>(loadDelivery);
  const [pendingOrder, setPendingOrder] = useState<{ item: DeliveryItem; qty: number } | null>(null);
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
  // 사장님이 바꾼 영업시간·품절과 인기 통계를 서버에서 받아 온다 (메뉴 버튼·추천 순서와 예약 시간에 반영)
  useDb(["settings", "popular"]);

  // 로그인한 고객님이 이 브라우저에서 처음 주문하면, 다른 기기에서 했던 지난 주문의 배달지·연락처를 이어서 쓴다
  const knownDelivery = hasDelivery(delivery);
  useEffect(() => {
    if (session?.role !== "user" || knownDelivery) return;
    let alive = true;
    fetchMyOrders()
      .then((list) => {
        const last = list.find((o) => o.order.address && o.order.phone);
        if (alive && last) setDelivery((d) => ({ address: d.address ?? last.order.address, phone: d.phone ?? last.order.phone }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session?.role, session?.username, knownDelivery]);

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
  const captionText = botTurn.map(captionLine).filter(Boolean).join(" ");
  const captionCards = botTurn.flatMap((m) => captionCard(m, new Date()) ?? []);
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

  // 식당 목록 말풍선. heading 이 있으면 "근처 ○○ 맛집" 대신 그 문장으로 시작한다 (가장 가까운 곳, 어느 가게인지 묻기)
  function showRestaurants(foodLabel: string, list: Restaurant[], opts: { heading?: string; lead?: NewMessage[]; next?: Stage } = {}) {
    setStage(opts.next ?? "restaurant");
    botReply(() => push(...(opts.lead ?? []), { role: "bot", kind: "restaurants", foodLabel, list, heading: opts.heading }), 900);
  }

  // 메뉴·수량이 정해지면 주문서로. 배달지·연락처를 아직 모르면 먼저 묻고, 다 받으면 이어서 주문서를 보여 준다
  function startOrder(item: DeliveryItem, qty: number, info: Partial<DeliveryInfo> = delivery) {
    setPendingItem(null);
    setLastItem(item);
    if (!hasDelivery(info)) {
      setPendingOrder({ item, qty });
      askDelivery(info.address ? "phone" : "address");
      return;
    }
    const next = makeOrder(item, qty, info);
    setPendingOrder(null);
    setOrder(next);
    setStage("confirm");
    botReply(() => push(botText("근처 매장을 찾았어요."), { role: "bot", kind: "order", order: next }), 1000);
  }

  function askDelivery(what: "address" | "phone", lead?: string) {
    setStage(what);
    botReply(() => push(botPrompt(what === "address" ? addressPrompt(lead) : phonePrompt(lead))));
  }

  // 주소·연락처 답. 받은 것은 이 브라우저에 기억해 두고, 둘 다 있으면 기다리던 주문서로 넘어간다
  function answerDelivery(text: string) {
    if (isStopDelivery(text)) {
      setPendingOrder(null);
      cancelDelivery();
      return;
    }
    let info: Partial<DeliveryInfo>;
    if (stage === "address") {
      const error = addressError(text);
      if (error) return askDelivery("address", error);
      info = { ...delivery, address: cleanAddress(text) };
    } else {
      const phone = normalizePhone(text);
      if (!phone) return askDelivery("phone", "전화번호를 잘 모르겠어요. 숫자로 알려 주세요.");
      info = { ...delivery, phone };
    }
    setDelivery(info);
    saveDelivery(info);
    if (!info.phone) return askDelivery("phone");
    if (pendingOrder) startOrder(pendingOrder.item, pendingOrder.qty, info);
    else {
      setStage("idle");
      botReply(() => push(botText("배달지를 저장했어요. 다음 주문부터 이 주소로 보내 드릴게요.")));
    }
  }

  const rangeLead = (item: DeliveryItem) => `1${item.unit}부터 ${MAX_QTY}${item.unit}까지 주문할 수 있어요.`;
  const qtyInRange = (n: number | undefined): n is number => n !== undefined && n >= 1 && n <= MAX_QTY;

  // 고른 메뉴(들)로 주문을 이어 간다. 수량까지 있으면 바로 주문서로, 없으면 수량을 묻고,
  // 여러 메뉴면 그중에서 고르게 한다. 같이 말한 수량("두 마리")·결제수단("카카오페이로")은 기억해 뒀다가 쓴다
  function deliverItems(items: DeliveryItem[], text: string) {
    const pay = findPayment(text);
    if (pay) setPendingPay(pay);
    const said = parseQuantity(text);
    if (items.length > 1) {
      setPendingItem(null);
      setPendingQty(qtyInRange(said) ? said : null);
      setStage("menu");
      botReply(() => push(botPrompt(pickDeliveryPrompt(items))));
      return;
    }
    const item = items[0];
    const qty = said ?? pendingQty ?? undefined;
    setPendingQty(null);
    setLastItem(item);
    if (qtyInRange(qty)) {
      startOrder(item, qty);
      return;
    }
    setPendingItem(item);
    setStage("qty");
    botReply(() => push(deliveryQty(item, qty !== undefined ? rangeLead(item) : undefined)));
  }

  // 말 속에서 배달 메뉴를 찾는다. 이름을 정확히 말한 메뉴가 품절이면 비슷한 메뉴를 권한다. 둘 다 아니면 false
  function tryDelivery(text: string): boolean {
    const items = findDeliveryItems(text);
    if (items.length > 0) {
      // "깐장치킨"은 "치킨"으로 여러 메뉴에 걸리지만, 이름이 비슷한 메뉴가 그중에 있으면 그 메뉴로 본다
      const near = items.length > 1 ? fuzzyFind(text) : undefined;
      const one = near?.kind === "menu" ? items.find((d) => d.id === near.item.id) : undefined;
      deliverItems(one ? [one] : items, text);
      return true;
    }
    const gone = soldOutItemNamed(text);
    if (!gone) return false;
    const alts = alternativesFor(gone);
    setPendingItem(null);
    setStage(alts.length ? "menu" : "idle");
    const head = `${withTopicParticle(gone.name)} 지금 품절이에요.`;
    botReply(() =>
      push(
        alts.length
          ? botPrompt({
              ...pickDeliveryPrompt(alts),
              text: `${head}\n대신 이런 메뉴는 어떠세요?`,
              say: `${head} 대신 ${recommend(alts.map((d) => d.name))}`,
            })
          : botText(`${head}\n지금은 주문할 수 있는 다른 메뉴가 없어요.`),
      ),
    );
    return true;
  }

  function cancelDelivery() {
    setStage("idle");
    setPendingItem(null);
    setPendingQty(null);
    setPendingPay(null);
    botReply(() => push(botText("배달 주문을 그만할게요. 다른 게 필요하면 말씀해 주세요!")));
  }

  // 예약은 날짜 → 시간 → 인원 → 확인 순서. 이미 받은 값은 건너뛰고, 쓸 수 없는 값은 이유와 함께 다시 묻는다
  function proceedReservation(draft: ReservationDraft, lead: NewMessage[] = []) {
    const now = new Date();
    const { restaurant } = draft;
    const { slots, issue } = usableSlots(restaurant, draft, now);
    const next: ReservationDraft = { restaurant, ...slots };
    let ask: NewMessage;
    if (!next.date) {
      setStage("rsvDate");
      ask = botPrompt(datePrompt(restaurant, now, issue));
    } else if (!next.time) {
      setStage("rsvTime");
      ask = botPrompt(timePrompt(restaurant, next.date, now, issue));
    } else if (next.people === undefined) {
      setStage("rsvPeople");
      ask = { role: "bot", kind: "people", lead: issue };
    } else {
      setStage("rsvConfirm");
      ask = { role: "bot", kind: "reservation", reservation: next as Reservation };
    }
    setRsv(next);
    botReply(() => push(...lead, ask));
  }

  // 식당을 정하면 예약으로. 앞에서 말해 둔 날짜·시간·인원은 채우고 남은 것만 묻는다
  function beginReservation(restaurant: Restaurant, slots: ReservationSlots, lead: NewMessage[] = []) {
    setRsvSlots({});
    setLastPlace(restaurant);
    proceedReservation({ restaurant, ...slots }, [{ role: "bot", kind: "restaurantPicked", restaurant }, ...lead]);
  }

  // 예약 단계별 처리. 한 번에 여러 값을 말해도("내일 8시 4명") 받아 두고, 확인 단계에서 "8시로 바꿔줘"처럼 고칠 수도 있다
  function continueReservation(text: string, draft: ReservationDraft) {
    const { restaurant } = draft;
    const now = new Date();
    const extra = parseReservationSlots(text, now);

    if (stage === "rsvConfirm") {
      if (hasSlots(extra)) {
        proceedReservation({ ...draft, ...extra }, [botText(`말씀하신 대로 바꿨어요. (${slotsText(extra)})`)]);
        return;
      }
      if (isYes(text) && draft.date && draft.time && draft.people) {
        const done = reservationDoneCard({ restaurant, date: draft.date, time: draft.time, people: draft.people });
        // 사장님·관리자 화면에서 보이도록 기록한다
        // 로그인했으면 그 사람 이름으로, 아니면 비회원으로 서버에 남는다 (실패해도 대화는 이어 간다)
        addReservation({ restaurantId: restaurant.id, restaurantName: restaurant.name, date: draft.date, time: draft.time, people: draft.people }).catch(
          () => {},
        );
        setRsv(null);
        setStage("idle");
        botReply(() => push({ role: "bot", kind: "info", card: done }), 900);
        return;
      }
    }

    if (isNo(text)) {
      setRsv(null);
      setStage("idle");
      botReply(() => push(botText("예약을 취소했어요. 다른 게 필요하면 말씀해 주세요!")));
      return;
    }

    if (stage === "rsvConfirm") {
      botReply(() => push(botText("예약할까요? '응' 또는 '취소'로 답해 주세요."), { role: "bot", kind: "confirm" }));
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
      proceedReservation({ ...draft, ...extra, date });
      return;
    }

    if (stage === "rsvTime" && draft.date) {
      const date = extra.date ?? draft.date;
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
      proceedReservation({ ...draft, ...extra, time });
      return;
    }

    if (stage === "rsvPeople" && draft.date && draft.time) {
      const people = parsePeople(text) ?? parseQuantity(text);
      if (people === undefined || people < 1 || people > MAX_PEOPLE) {
        const lead = people === undefined ? "인원을 잘 모르겠어요." : `1명부터 ${MAX_PEOPLE}명까지 예약할 수 있어요.`;
        botReply(() => push({ role: "bot", kind: "people", lead }));
        return;
      }
      proceedReservation({ ...draft, ...extra, people });
    }
  }

  // 서버에 물어봐야 하는 답(주문 조회·취소). 기다리는 동안 타이핑 표시를 보여 주고, 실패하면 이유를 말한다
  function botReplyAsync(work: () => Promise<() => void>) {
    setThinking(true);
    work()
      .catch((e: unknown) => () => push(botText(e instanceof Error && e.message ? e.message : "잠시 후 다시 시도해 주세요.")))
      .then((apply) =>
        later(() => {
          setThinking(false);
          apply();
        }, 600),
      );
  }

  const deliveryChoice: Choice = { label: "배달 주문하기", value: "배달" };

  // "내 주문 어디쯤 왔어": 가장 최근 주문의 상태와 도착 예정 시각
  function showOrderStatus() {
    botReplyAsync(async () => {
      const latest = (await fetchMyOrders())[0];
      if (!latest) return () => push(botPrompt({ text: "최근 주문 내역이 없어요.\n배달 주문을 도와드릴까요?", choices: [deliveryChoice] }));
      return () => push({ role: "bot", kind: "info", card: orderStatusCard(latest) });
    });
  }

  // "주문 취소할래": 가게가 아직 준비를 시작하지 않은(접수) 주문만 취소할 수 있다
  function askCancelOrder() {
    botReplyAsync(async () => {
      const latest = (await fetchMyOrders()).find((o) => o.status !== "취소");
      if (!latest) return () => push(botText("취소할 주문이 없어요."));
      if (latest.status !== "접수") {
        const why = latest.status === "완료" ? "이미 배달이 끝나서" : "가게에서 이미 준비를 시작해서";
        return () => push(botText(`${orderLabel(latest)} 주문은 ${why} 취소할 수 없어요.\n가게에 직접 문의해 주세요.`));
      }
      return () => {
        setCancelTarget(latest);
        setStage("cancelConfirm");
        push(
          botPrompt({
            text: `${orderLabel(latest)} 주문을 취소할까요?`,
            choices: [
              { label: "취소할게요", value: "응 취소할게요" },
              { label: "그대로 둘게요", value: "아니요 그대로 둘게요" },
            ],
            noDirect: true,
          }),
        );
      };
    });
  }

  function answerCancel(text: string, target: OrderRecord) {
    const keep = /아니|그대로|유지|그냥|됐어|싫어/.test(text);
    if (!keep && !isYes(text) && !/취소/.test(text)) {
      botReply(() => push(botText("주문을 취소할까요? '취소할게요' 또는 '그대로 둘게요'로 답해 주세요.")));
      return;
    }
    setCancelTarget(null);
    setStage("idle");
    if (keep) {
      botReply(() => push(botText("주문을 그대로 둘게요. 맛있게 드세요!")));
      return;
    }
    botReplyAsync(async () => {
      await cancelMyOrder(target.id);
      return () => push(botText("주문을 취소했어요.\n결제하신 금액은 같은 결제 수단으로 환불돼요."));
    });
  }

  // "늘 먹던 거", "지난번 거 다시": 마지막 주문(취소 제외)을 같은 수량으로 주문서까지 만든다
  function reorder(text: string) {
    botReplyAsync(async () => {
      const last = (await fetchMyOrders()).find((o) => o.status !== "취소");
      if (!last) {
        return () => {
          setStage("menu");
          push(botPrompt({ ...deliveryPrompt(), text: "아직 주문하신 기록이 없어요.\n오늘은 이런 메뉴 어떠세요?" }));
        };
      }
      const item = availableDeliveryMenu().find((d) => d.restaurantId === last.storeId && d.name === last.order.item);
      if (!item) {
        return () => {
          if (!tryDelivery(last.order.item)) push(botPrompt({ ...deliveryPrompt(), text: `${last.order.item}은(는) 지금 주문할 수 없어요.\n대신 이런 메뉴는 어떠세요?` }));
        };
      }
      const said = parseQuantity(text);
      const qty = qtyInRange(said) ? said : last.order.qty;
      // 지난 주문의 배달지로 보낸다 (없으면 기억해 둔 배달지, 그것도 없으면 주소부터 묻는다)
      const info: Partial<DeliveryInfo> = last.order.address && last.order.phone ? { address: last.order.address, phone: last.order.phone } : delivery;
      return () => {
        if (!hasDelivery(info)) return startOrder(item, qty, info);
        const next = makeOrder(item, qty, info);
        setLastItem(item);
        setOrder(next);
        setStage("confirm");
        push(botText(`지난번에 드신 ${item.name} ${qty}${item.unit}로 주문서를 만들었어요.`), { role: "bot", kind: "order", order: next });
      };
    });
  }

  // 가게 정보: 영업시간(지금 영업 중인지)·주소. 예약·배달로 바로 이어 갈 수 있게 버튼을 붙인다
  function showStoreInfo(r: Restaurant) {
    setLastPlace(r);
    setStage("idle");
    const delivers = availableDeliveryMenu().some((d) => d.restaurantId === r.id);
    const choices: Choice[] = [
      { label: "예약하기", value: `${r.name} 예약` },
      ...(delivers ? [{ label: "배달 주문", value: `${r.name} 배달` }] : []),
    ];
    const next = delivers ? "예약하거나 배달 주문할 수 있어요." : "예약을 도와드릴까요?";
    botReply(() => push({ role: "bot", kind: "info", card: storeInfoCard(r, new Date()) }, botPrompt({ text: next, choices })));
  }

  // 시간대에 어울리고 많이 주문된 메뉴를 추천한다 ("배고파", "뭐 먹지", "메뉴 뭐 있어")
  function showRecommendations() {
    const now = new Date();
    const word = MEAL_WORD[mealOf(now)];
    const items = recommendItems(now);
    const canReorder = session?.role === "user" || getReceipts().length > 0;
    startFresh();
    setStage("menu");
    botReply(() =>
      push(
        botPrompt({
          text: `${word} 메뉴로 이런 건 어떠세요?\n식당에서 드시고 싶으면 '식당'이라고 말씀해 주세요.`,
          say: `${word} 메뉴로 ${recommend(items.map((d) => d.name))} 식당에서 드시고 싶으면 식당이라고 말씀해 주세요.`,
          choices: [
            ...(canReorder ? [{ label: "지난번 메뉴 다시", value: "지난번 메뉴 다시 주문" }] : []),
            ...items.map((d) => ({ label: d.name, value: d.name })),
            { label: "식당 찾기", value: "식당" },
          ],
          placeholder: "예) 간장치킨",
        }),
      ),
    );
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

    // 배달지·연락처를 묻는 중
    if (stage === "address" || stage === "phone") {
      answerDelivery(text);
      return;
    }

    if (stage === "confirm" && order && !switchingMenu) {
      // "주소 바꿔줘", "연락처 바꿀래": 그 항목만 다시 묻고 같은 메뉴·수량으로 주문서를 다시 만든다
      const change = deliveryChange(text);
      const ordered = availableDeliveryMenu().find((d) => d.restaurantId === order.storeId && d.name === order.item);
      if (change && ordered) {
        setPendingOrder({ item: ordered, qty: order.qty });
        setOrder(null);
        askDelivery(change, change === "address" ? "새 배달지로 다시 만들어 드릴게요." : "새 연락처로 다시 만들어 드릴게요.");
        return;
      }
      // "3마리로 해줘": 수량만 바꿔 주문서를 다시 보여 준다 ("해줘"가 들어 있어도 '응'보다 먼저 본다)
      const newQty = parseQuantity(text);
      const item = availableDeliveryMenu().find((d) => d.restaurantId === order.storeId && d.name === order.item);
      if (newQty !== undefined && item && findDeliveryItems(text).length === 0) {
        if (!qtyInRange(newQty)) {
          botReply(() => push(botText(rangeLead(item)), { role: "bot", kind: "confirm" }));
          return;
        }
        const next = makeOrder(item, newQty);
        setOrder(next);
        botReply(() => push(botText(`수량을 ${newQty}${item.unit}로 바꿨어요.`), { role: "bot", kind: "order", order: next }));
        return;
      }
      if (isNo(text)) {
        setStage("idle");
        setOrder(null);
        setPendingPay(null);
        botReply(() => push(botText("주문을 취소했어요. 다른 게 필요하면 말씀해 주세요!")));
      } else if (isYes(text)) {
        // 처음에 결제수단까지 말했으면("카카오페이로") 고르는 단계를 건너뛰고 결제 화면으로
        if (pendingPay) {
          const method = pendingPay;
          setPendingPay(null);
          setStage("paying");
          botReply(() => {
            push({ role: "bot", kind: "payment", order, selected: method.id });
            later(() => setPayMethod(method), 300);
          });
        } else {
          setStage("pay");
          botReply(() => push({ role: "bot", kind: "payment", order }));
        }
      } else if (findDeliveryItems(text).length > 0) {
        // 다른 메뉴를 말하면 그 메뉴로 다시
        setOrder(null);
        tryDelivery(text);
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

    if (stage === "cancelConfirm" && cancelTarget) {
      answerCancel(text, cancelTarget);
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
        if (qtyInRange(qty)) startOrder(pendingItem, qty);
        else botReply(() => push(deliveryQty(pendingItem, rangeLead(pendingItem))));
        return;
      }
      if (isNo(text)) {
        cancelDelivery();
        return;
      }
      if (!quickMenuReply(text) && findDeliveryItems(text).length === 0 && !detectIntent(text)) {
        botReply(() => push(deliveryQty(pendingItem, "수량을 잘 모르겠어요.")));
        return;
      }
    }

    // 다른 기능으로 넘어갈 만한 말인지 (아래 단계별 처리에서 "모르겠어요" 대신 일반 처리로 보낸다)
    const understood = () =>
      !!menuIntent(text) || !!detectIntent(text) || !!matchFood(text) || !!restaurantNamed(text) || !!fuzzyFind(text) || refersToItem(text);

    // 배달 메뉴 고르는 중
    if (stage === "menu") {
      if (tryDelivery(text)) return;
      if (isNo(text)) {
        cancelDelivery();
        return;
      }
      if (!understood()) {
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

    // 어느 가게 정보가 궁금한지 묻는 중
    if (stage === "info") {
      const picked = findRestaurant(text, latestRestaurants()) ?? restaurantNamed(text);
      if (picked) {
        markPickedRestaurant(picked.id);
        showStoreInfo(picked);
        return;
      }
    }

    // 식당 찾기 중에는 식당 이름 → 음식 종류 순으로 먼저 본다. 둘 다 아니면 아래 일반 처리로 넘어간다
    if (stage === "food" || stage === "restaurant") {
      const slots = parseReservationSlots(text, new Date());
      const picked = stage === "restaurant" ? findRestaurant(text, latestRestaurants()) : undefined;
      if (picked) {
        // 식당을 고르면 예약으로 이어진다
        markPickedRestaurant(picked.id);
        beginReservation(picked, { ...rsvSlots, ...slots });
        return;
      }
      const food = matchFood(text);
      if (food) {
        setRsvSlots((prev) => ({ ...prev, ...slots }));
        showRestaurants(food.label, nearbyRestaurants(food.key));
        return;
      }
      // "아무거나", "추천해줘": 지금 시간대에 어울리는 음식의 근처 맛집을 권한다
      if (detectIntent(text) === "hungry") {
        const meal = mealOf(new Date());
        const pick = foodsForMeal(meal)[0] ?? FOODS[0];
        setRsvSlots((prev) => ({ ...prev, ...slots }));
        showRestaurants(pick.label, nearbyRestaurants(pick.key), { lead: [botText(`그럼 ${MEAL_WORD[meal]}으로 ${pick.label} 어떠세요?`)] });
        return;
      }
      if (isNo(text)) {
        setStage("idle");
        setRsvSlots({});
        botReply(() => push(botText("식당 찾기를 그만할게요. 다른 게 필요하면 말씀해 주세요!")));
        return;
      }
      // "내일 7시 4명": 식당을 고르기 전에 말한 예약 정보는 기억해 둔다
      if (hasSlots(slots) && !restaurantNamed(text)) {
        setRsvSlots((prev) => ({ ...prev, ...slots }));
        const ask = stage === "restaurant" ? "추천 맛집 중에서 골라 주세요." : "어떤 음식이 당기세요?";
        botReply(() =>
          push(
            stage === "restaurant"
              ? botText(`좋아요, ${slotsText(slots)}로 기억해 둘게요.\n${ask}`)
              : botPrompt({ ...FOOD_PROMPT, text: `좋아요, ${slotsText(slots)}로 기억해 둘게요.\n${ask}`, say: `좋아요, 기억해 둘게요. ${ask}` }),
          ),
        );
        return;
      }
      if (!understood() && findDeliveryItems(text).length === 0) {
        const hint = stage === "restaurant" ? "추천 맛집 중에서 고르시거나, 다른 음식을 말씀해 주세요." : "드시고 싶은 음식을 편하게 말씀해 주세요.";
        botReply(() =>
          push(botPrompt({ ...FOOD_PROMPT, text: `어떤 음식인지 잘 모르겠어요.\n${hint}`, say: `어떤 음식인지 잘 모르겠어요. ${hint}` })),
        );
        return;
      }
    }

    routeGeneral(text);
  }

  // 진행 중인 단계와 상관없이 문장만 보고 기능을 고른다. 알아듣지 못해도 비슷한 이름을 찾아 되묻거나 할 수 있는 일을 안내한다
  function routeGeneral(text: string) {
    const now = new Date();
    const intent = detectIntent(text);
    const menu = menuIntent(text);
    const food = matchFood(text);
    const slots = parseReservationSlots(text, now);
    const place = restaurantNamed(text) ?? (refersToPlace(text) ? (lastPlace ?? undefined) : undefined);

    // 주문 조회·취소는 "주문"이 들어 있어 배달로 오해하기 쉬우므로 가장 먼저
    if (intent === "orderStatus") return showOrderStatus();
    if (intent === "orderCancel") return askCancelOrder();
    // "아까 그거 하나 더": 이번 대화에서 말한 메뉴, 없으면 지난 주문
    if (refersToItem(text) && lastItem) {
      startFresh();
      deliverItems([lastItem], text);
      return;
    }
    if (intent === "reorder" || refersToItem(text)) return reorder(text);

    if (intent === "storeInfo") {
      if (place) return showStoreInfo(place);
      const list = food ? nearbyRestaurants(food.key) : nearestRestaurants(4);
      showRestaurants(food?.label ?? "", list, { heading: "어느 가게가 궁금하세요?\n가게를 고르시면 영업시간과 주소를 알려 드릴게요.", next: "info" });
      return;
    }

    // 가게 이름을 말했으면: 메뉴·배달 얘기면 그 가게 배달, 아니면 그 가게 예약
    if (place) {
      const storeMenu = availableDeliveryMenu().filter((d) => d.restaurantId === place.id);
      const named = findDeliveryItems(text).filter((d) => d.restaurantId === place.id);
      if (storeMenu.length && (named.length || menu === "배달")) {
        startFresh();
        setLastPlace(place);
        deliverItems(named.length ? named : storeMenu, text);
        return;
      }
      startFresh();
      beginReservation(place, { ...rsvSlots, ...slots });
      return;
    }

    // "할머니국밥": 식당 이름과 비슷하면 음식 종류("국밥")보다 먼저 그 식당인지 되묻는다
    // ("떡볶이"처럼 배달 메뉴가 바로 잡히는 말은 식당 이름의 한 낱말과 같아도 배달로 본다)
    const nearPlace = findDeliveryItems(text).length === 0 ? fuzzyFind(text) : undefined;
    if (nearPlace?.kind === "restaurant") {
      askDidYouMean(nearPlace);
      return;
    }

    if (intent === "nearest" && !food) {
      startFresh();
      setRsvSlots(slots);
      showRestaurants("", nearestRestaurants(), { heading: "가장 가까운 곳들이에요!\n마음에 드는 곳을 고르시면 예약을 도와드릴게요." });
      return;
    }

    // "중식 식당 예약해줘": 식당 말과 음식 종류를 같이 말했으면 바로 근처 식당 추천으로
    if (menu === "식당") {
      if (food) {
        startFresh();
        setRsvSlots(slots);
        showRestaurants(food.label, nearbyRestaurants(food.key));
      } else {
        startMenu("식당");
        setRsvSlots(slots);
      }
      return;
    }

    // "간장치킨 2마리 시켜줘", "떡볶이": 배달 메뉴 이름이 있으면 배달 주문으로
    if (tryDelivery(text)) return;

    // "짜장면 배달해줘": 배달 메뉴에 없는 음식이면 그 음식을 파는 근처 식당을 대신 권한다
    if (food && !deliversFood(food) && (menu === "배달" || stage === "menu")) {
      const word = foodWord(text, food);
      startFresh();
      showRestaurants(food.label, nearbyRestaurants(food.key), {
        lead: [botText(`${withTopicParticle(word)} 아직 배달이 안 돼요.\n대신 근처 ${food.label} 맛집에서 드시는 건 어때요?`)],
      });
      return;
    }

    if (menu === "배달") {
      startMenu("배달");
      return;
    }

    // "한식 먹고 싶어": 배달 메뉴에는 없는 음식 종류만 말했으면 근처 식당 추천으로
    if (food) {
      startFresh();
      setRsvSlots(slots);
      showRestaurants(food.label, nearbyRestaurants(food.key));
      return;
    }

    if (intent === "hungry") return showRecommendations();

    if (intent === "greeting" || intent === "thanks") {
      const head = intent === "greeting" ? `안녕하세요${session ? `, ${session.name}님` : ""}! 오늘은 무엇을 도와드릴까요?` : "천만에요! 더 필요한 게 있으면 언제든 말씀해 주세요.";
      botReply(() =>
        push(
          botPrompt({
            text: `${head}\n배달 주문과 식당 예약을 도와드릴 수 있어요.`,
            say: `${head} 배달 주문과 식당 예약을 도와드릴 수 있어요.`,
            choices: QUICK_MENUS.map((m) => ({ label: m, value: m })),
          }),
        ),
      );
      return;
    }

    // "내일 저녁 7시 4명": 식당 이름 없이 예약 정보만 말했으면 기억해 두고 음식부터 묻는다
    if (hasSlots(slots) && (slots.time || slots.people)) {
      startMenu("식당");
      setRsvSlots(slots);
      return;
    }

    // "마르게리타": 비슷한 메뉴 이름이 있으면 되묻는다
    const hit = fuzzyFind(text);
    if (hit) {
      askDidYouMean(hit);
      return;
    }

    if (isNo(text)) {
      botReply(() =>
        push(
          botPrompt({
            text: "알겠어요.\n배달 주문이나 식당 예약이 필요하면 말씀해 주세요.",
            choices: QUICK_MENUS.map((m) => ({ label: m, value: m })),
          }),
        ),
      );
      return;
    }

    botReply(() => push(botPrompt(FALLBACK_PROMPT)));
  }

  function askDidYouMean(hit: FuzzyHit) {
    setStage("idle");
    botReply(() =>
      push(
        botPrompt({
          text: `혹시 ${withObjectParticle(hit.name)} 찾으세요?`,
          choices: [
            { label: hit.kind === "menu" ? `${hit.name} 주문` : `${hit.name} 예약`, value: hit.name },
            { label: "아니요", value: "아니요" },
          ],
        }),
      ),
    );
  }

  // 진행 중이던 주문·예약을 접고 처음부터
  function startFresh() {
    setPendingItem(null);
    setPendingQty(null);
    setPendingPay(null);
    setOrder(null);
    setRsv(null);
    setRsvSlots({});
    setCancelTarget(null);
    setPendingOrder(null);
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
    const card = completionCard(order, payMethod);
    // 사장님·관리자 화면에서 보이도록 기록한다
    addOrder(order, payMethod.label).catch(() => {});
    setPayMethod(null);
    setPendingPay(null);
    setOrder(null);
    setStage("done");
    botReply(() => push({ role: "bot", kind: "info", card }), 500);
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
    setPendingQty(null);
    setPendingPay(null);
    setRsvSlots({});
    setLastPlace(null);
    setLastItem(null);
    setCancelTarget(null);
    setPendingOrder(null);
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
  const activeRestaurantsId = stage === "restaurant" || stage === "info" ? lastIdOf(messages, ["restaurants"]) : undefined;

  // delivery: 배달 주문서에는 "배달지 변경"도 붙인다
  function confirmActions(id: number, delivery = false) {
    const active = id === activeConfirmId;
    return (
      <div className="actions">
        <button className="primary" type="button" disabled={!active} onClick={() => handle("응 해줘")}>
          응 해줘
        </button>
        <button type="button" disabled={!active} onClick={() => handle("취소할게")}>
          취소
        </button>
        {delivery && (
          <button type="button" className="quiet" disabled={!active} onClick={() => handle("배달지 변경")}>
            배달지 변경
          </button>
        )}
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
              {confirmActions(m.id, true)}
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
            {m.heading ?? `근처 ${m.foodLabel} 맛집을 추천해요!\n가까운 순서예요. 마음에 드는 곳을 골라 주세요.`}
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
                      대표 메뉴 {r.signature} · 평점 {r.rating.toFixed(1)} · {isOpenNow(r, new Date()) ? "영업 중" : `${r.hours.split("-")[0].trim()} 오픈`}
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
      case "info":
        return (
          <>
            {m.card.title}
            <div className="card">
              <dl>
                {m.card.rows.map((row) => (
                  <Fragment key={row.label}>
                    <dt>{row.label}</dt>
                    <dd className={row.emphasis ? "price" : undefined}>{row.value}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
            {m.card.note && <div className="card-note">{m.card.note}</div>}
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

        {chatHidden && <VoiceCaption id={captionId} text={captionText} cards={captionCards} thinking={thinking} />}

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
