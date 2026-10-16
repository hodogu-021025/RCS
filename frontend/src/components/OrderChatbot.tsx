import { Fragment, useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import backgroundVideo from "../image/saylo_background.mp4";
import { AccountText, CopyButton } from "./CopyButton";
import { InstallBanner } from "./InstallBanner";
import { TelLink } from "./TelLink";
import { AccountIcon, ChatIcon, HelpIcon, MenuIcon, MicIcon, PlusIcon, SpeakerIcon } from "./icons";
import { Tutorial } from "./Tutorial";
import { markTutorialSeen, tutorialSeen } from "./tutorialSeen";
import { useSpeechOutput, useVoiceInput } from "./useSpeech";
import { useSession } from "../auth/auth";
import { addOrder, addReservation, cancelMyOrder, fetchMyOrders, refresh, storePausedUntil, useDb, type OrderRecord } from "../data/db";
import { deliveryChange, hasDelivery, rememberResume, takeResume, type DeliveryInfo, type ResumeDelivery, type ResumeLine } from "./delivery";
import { CalendarPicker } from "./CalendarPicker";
import { ChoicePicker } from "./ChoicePicker";
import { CountPicker } from "./CountPicker";
import { TimePicker } from "./TimePicker";
import { VoiceCaption } from "./VoiceCaption";
import { FALLBACK_PROMPT, QUICK_MENUS, menuIntent, menuReply, quickMenuReply } from "./quickMenu";
import {
  DEFAULT_PEOPLE,
  pausedToday,
  deliveryMenu,
  pausedText,
  squash,
  orderItemText,
  deliveryPrompt,
  popularFirst,
  priceText,
  discountTag,
  menuBadge,
  restaurantById,
  FOOD_PROMPT,
  FOODS,
  foodsOnOffer,
  filledRows,
  hasStoresFor,
  MAX_DAYS_AHEAD,
  MAX_PEOPLE,
  MAX_QTY,
  MAX_ORDER_ITEMS,
  ORDER_CARD_QUESTION,
  ORDER_CARD_TITLE,
  CART_QUESTION,
  CART_MORE,
  CART_CHECKOUT,
  addItem,
  cartCardRows,
  itemText,
  makeOrderItem,
  replaceItem,
  storeOrder,
  withItems,
  menusNamedIn,
  orderPriceLabel,
  itemPriceLabel,
  checkVisitTime,
  orderCardRows,
  datePrompt,
  findDeliveryItems,
  findRestaurant,
  formatDate,
  isNo,
  isYes,
  km,
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
  withRoParticle,
  won,
  matchChoices,
  withoutQuantity,
  type BotPrompt,
  type Choice,
  type ChosenOption,
  type DeliveryItem,
  type InfoCard,
  type Order,
  type OrderItem,
  type OrderRow,
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
  mealOf,
  nearestRestaurants,
  openStateText,
  orderLabel,
  orderStatusCard,
  transferCard,
  storeInfoCard,
  parsePeople,
  parseReservationSlots,
  recommendItems,
  recommendRestaurants,
  refersToItem,
  refersToEarlierOrder,
  refersToPlace,
  restaurantNamed,
  slotsText,
  soldOutItemNamed,
  usableSlots,
  type FuzzyHit,
  type ReservationSlots,
} from "./understanding";

// 배달: idle → menu(메뉴 대기) → qty(수량 대기) → [세트 메뉴면 choose(맛 고르기)] → cart("더 담을까요?": 더 담으면 menu 부터 다시)
//       → confirm(주문서 확인 대기) → done. 한 주문에 한 가게 메뉴를 여러 개 담는다(장바구니). 다른 가게 메뉴를 말하면 switchStore(비우고 새로 시작할지 묻는 중)
// 식당: idle → food(음식 종류 대기) → restaurant(식당 목록에서 선택 대기)
//      → rsvDate(날짜) → rsvTime(시간) → rsvPeople(인원) → rsvConfirm(예약 확인) → idle
// 배달 주문은 로그인한 고객님만, 계정의 배달지·연락처로 한다. 로그인 전이면 needLogin(로그인하러 갈지 묻는 중),
//        계정에 배달지·연락처가 없으면 needContact(계정 관리로 갈지 묻는 중)에서 멈춘다
// 그 밖: info(어느 가게 정보인지 고르는 중), cancelConfirm(내 주문 취소 확인)
type Stage =
  | "idle" | "menu" | "qty" | "choose" | "cart" | "switchStore" | "confirm" | "done"
  | "food" | "restaurant" | "rsvDate" | "rsvTime" | "rsvPeople" | "rsvConfirm"
  | "info" | "cancelConfirm" | "needLogin" | "needContact";

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
      menu?: DeliveryItem[]; // 추천 메뉴 (채팅창을 끈 동안 표로)
      picked?: string;
    }
  | { id: number; role: "bot"; kind: "order"; order: Order }
  // 장바구니: 담은 메뉴 목록과 "더 담을까요?" (더 담기 · 이대로 주문). text: 표 위 한 줄 ("간장치킨 2마리를 담았어요.")
  // midway: 바로 앞 모습에 메뉴를 더 담기만 한 것 ("아까 거"로 되살릴 때 그 앞 모습은 담는 도중이라 뺀다)
  | { id: number; role: "bot"; kind: "cart"; text: string; order: Order; midway?: boolean }
  | { id: number; role: "bot"; kind: "confirm" }
  // heading: "근처 ○○ 맛집을 추천해요" 대신 쓸 첫 문장 (가장 가까운 곳, 어느 가게인지 묻기)
  // choices: 카드 아래 작은 버튼 (식당 찾기 첫 추천의 음식 종류), picked: 누른 버튼의 value
  | {
      id: number;
      role: "bot";
      kind: "restaurants";
      foodLabel: string;
      list: Restaurant[];
      heading?: string;
      selected?: string;
      choices?: Choice[];
      picked?: string;
      placeholder?: string; // 아래 "직접 입력"을 눌렀을 때 입력창 안내 문구
    }
  | { id: number; role: "bot"; kind: "restaurantPicked"; restaurant: Restaurant }
  | { id: number; role: "bot"; kind: "reservation"; reservation: Reservation }
  // 예약 인원 카운터. lead: 다시 물을 때 앞에 붙일 이유, picked: 고른 인원
  | { id: number; role: "bot"; kind: "people"; lead?: string; picked?: number }
  // 표로 보여 주는 안내: 예약 완료·결제 완료·주문 상태·가게 정보
  | { id: number; role: "bot"; kind: "info"; card: InfoCard }
  // 배달 수량 카운터 (마리·판·인분)
  | { id: number; role: "bot"; kind: "qty"; text: string; unit: string; max: number; priceEach: number; picked?: number }
  // 세트 메뉴의 맛 고르기 표. need: 고를 수, basePrice: 맛 추가금 전 금액, picked: 고르기를 마친 맛
  | { id: number; role: "bot"; kind: "choices"; text: string; label: string; need: number; options: { name: string; extra: number }[]; basePrice: number; picked?: string[] };

type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, "id"> : never) : never;

// 대화 영역 아래에 겹쳐 뜨는 음성 카드의 내용
interface VoiceBar {
  kind: "listening" | "note";
  text: string;
}

const GREETING = "안녕하세요! Saylo예요.\n무엇을 주문해 드릴까요?";

let nextId = 1;
const botText = (text: string): NewMessage => ({ role: "bot", kind: "text", text });
const botPrompt = ({ text, choices, placeholder, picker, directLabel, noDirect, say, menu }: BotPrompt): NewMessage => ({
  role: "bot",
  kind: "text",
  text,
  choices,
  placeholder,
  picker,
  directLabel,
  noDirect,
  say,
  menu,
});
const DEFAULT_PLACEHOLDER = "메시지를 입력하세요";
// 식당 찾기를 고르면 바로 보여 주는 추천 식당 목록의 첫 문장
const RESTAURANT_PICKS_HEADING = "오늘은 이런 식당 어떠세요?\n드시고 싶은 음식을 말씀해 주시면 그 음식 맛집을 찾아 드릴게요.";
// 로그인 전인 손님을 로그인 화면으로, 계정에 배달지·연락처가 없는 고객님을 계정 관리로 보내는 버튼
const LOGIN_CHOICE: Choice = { label: "로그인하러 가기", value: "로그인할게요" };
const REDIRECT_MS = 3000; // 안내를 보여 준 뒤 로그인 화면·계정 관리로 저절로 넘어가기까지
const ACCOUNT_CHOICE: Choice = { label: "계정 관리로 가기", value: "계정 관리로 갈게요" };
const INQUIRY_CHOICE: Choice = { label: "문의하러 가기", value: "문의 화면으로 갈게요" };
const greeting = (): Message[] => [{ id: nextId++, ...botText(GREETING) } as Message];

// 장바구니("더 담을까요?")에서 더 담지 않고 주문하겠다는 말: "그만 담을게", "더 안 시킬게", "이제 됐어", "없어", "그게 다야", "이대로 주문"
const DONE_ADDING = /그만\s?(담|시킬|골라|고를)|더\s?(안|없|필요\s?없)|더는\s?(안|없|됐|괜찮)|안\s?담|됐어|됐습니다|됐네|괜찮|없어|없습니다|없을|그게\s?다|이게\s?다|다\s?담았|이대로|그대로|주문(할|해|하자|하고|이요)|결제|끝/;
// 담은 것을 모두 접겠다는 말 ("취소"는 따로 본다): "그만할래", "주문 안 할래", "안 먹을래"
const DROP_ALL = /그만\s?(할|둘|하|해)|주문\s?안\s?(할|해)|안\s?(먹|할래|할게|시킬래)/;
// 더 담겠다는 말 ("더 담기", "더 시킬게", "추가할래"). "더 담을 거 없어"처럼 뒤집는 말은 아니다
const MORE = /더\s?담|더\s?시킬|더\s?주문|추가(할|로|하고|해)/;
const MORE_NEGATED = /없|안\s|됐|괜찮|그만/;
// 값을 묻는 말: "얼마야?", "다 해서 얼마", "합계", "간장치킨 가격"
const PRICE_ASK = /얼마|합계|총\s?(액|금액)|금액|가격/;
// 담아 둔 메뉴를 다시 보자는 말: "장바구니", "담은 거 보여줘", "담아 둔 메뉴"
const CART_WORDS = /장바구니|담은\s?(거|것|메뉴)|담아\s?둔/;
// 담긴 메뉴의 수량을 바꾸는 말: "1마리로", "3묶음으로 해줘", "2개로 바꿔", "수량 변경"
const QTY_CHANGE = /\S(으로|로)(?=\s|$|[.!?,~]|해|바꿔|변경|수정|할|주|요|만|부탁)|바꿔|바꾸|변경|수정/;
// 띄어쓰기를 지우고 메뉴 이름도 지운 말 (이름 속 "로"(로제 떡볶이)에 걸리지 않게)
const withoutNames = (text: string, names: string[]) => names.reduce((rest, name) => rest.split(squash(name)).join(" "), squash(text));

// 한 문장에 여러 메뉴를 말했을 때 차례로 담을 메뉴 (수량을 말하지 않았으면 qty 없음)
type PendingAdd = { item: DeliveryItem; qty?: number };

// 배달 수량 카운터 말풍선
const deliveryQty = (item: DeliveryItem, lead?: string): NewMessage => ({
  role: "bot",
  kind: "qty",
  text: quantityQuestion(item, lead),
  unit: item.unit,
  max: MAX_QTY,
  priceEach: item.price,
});

// 세트 메뉴의 맛 고르기 말풍선. 세트 수 × 1세트에 고를 수만큼, 같은 맛은 한 번만 고른다
const choicePrompt = (item: DeliveryItem, qty: number, lead?: string): NewMessage => {
  const c = item.choice!;
  const need = c.count * qty;
  return {
    role: "bot",
    kind: "choices",
    text: `${lead ? `${lead}\n` : ""}${item.name} ${qty}${item.unit}의 ${withObjectParticle(c.label)} ${need}가지 골라 주세요.\n같은 ${withTopicParticle(c.label)} 한 번만 고를 수 있어요.`,
    label: c.label,
    need,
    options: c.options,
    basePrice: item.price * qty,
  };
};

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
    case "cart":
      return `${line(m.text)} ${cartCardRows(m.order).map((r) => `${r.label} ${r.value}`).join(", ")}. ${CART_QUESTION} ${CART_MORE} 또는 ${CART_CHECKOUT}이라고 말씀해 주세요.`;
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
    case "choices":
      return `${line(m.text)} 표에서 고르시거나 ${m.label} 이름을 말씀해 주세요.`;
    case "info":
      return m.card.say ?? `${line(m.card.title)} ${m.card.rows.map((r) => `${r.label} ${r.value}`).join(", ")}.${m.card.note ? ` ${m.card.note}` : ""}`;
  }
}

// ---- 추천 카드 ----
// 식당 추천과 배달 메뉴 추천을 같은 모양으로 보여 준다: 굵은 이름, 아래 작은 글씨 설명, 오른쪽 알약(식당은 거리, 메뉴는 가격).
// tags: 설명 맨 앞에 강조해 붙이는 오늘의 메뉴·할인. 채팅창을 끈 동안의 표(pickCardRow)도 같은 내용이다
interface PickCard {
  id: string;
  name: string;
  badge?: string; // 이름 옆 작은 태그 (오늘의 메뉴)
  tags: string[];
  info: string[];
  pill?: string; // 오른쪽 작은 글자 (거리·가격). 거리를 모르는 매장은 없다
}

const restaurantCard = (r: Restaurant, now: Date): PickCard => ({
  id: r.id,
  name: r.name,
  tags: [],
  // 영업 상태는 예약할 때 참고용. 일시 중지한 곳은 목록에 아예 나오지 않는다
  // 관리자가 직접 만든 매장은 대표 메뉴·평점·거리가 없을 수 있어 있는 것만 적는다
  info: [r.signature && `대표 메뉴 ${r.signature}`, r.rating !== undefined && `평점 ${r.rating.toFixed(1)}`, openStateText(r, now)].filter((x): x is string => !!x),
  pill: km(r.distanceKm),
});

// 메뉴 카드: 오늘의 메뉴는 이름 옆 태그, 할인은 설명 앞, 그다음 가게 이름. 일시 중지한 가게의 메뉴는 목록에 아예 나오지 않으므로
// 영업 상태는 적지 않는다
function menuCard(d: DeliveryItem): PickCard {
  const deal = discountTag(d);
  return { id: d.id, name: d.name, badge: menuBadge(d), tags: deal ? [deal] : [], info: [restaurantById(d.restaurantId).name], pill: won(d.price) };
}

const pickCardRow = (c: PickCard): OrderRow => ({ label: c.name, badge: c.badge, value: [c.pill, ...c.tags, ...c.info].filter(Boolean).join(" · ") });

// 카드 목록. 버튼의 이름은 식당·메뉴 이름이고, 설명·알약은 읽기 프로그램에 덧붙는 설명으로 준다
function PickCards({ cards, selected, disabled, onPick }: { cards: PickCard[]; selected?: string; disabled: boolean; onPick: (c: PickCard) => void }) {
  const uid = useId();
  return (
    <div className="places">
      {cards.map((c) => {
        const id = `${uid}-${c.id}`;
        return (
          <button
            key={c.id}
            type="button"
            className={selected === c.id ? "selected" : undefined}
            disabled={disabled}
            onClick={() => onPick(c)}
            aria-labelledby={id}
            aria-describedby={`${c.badge ? `${id}-badge ` : ""}${id}-info${c.pill ? ` ${id}-pill` : ""}`}
          >
            <span className="place-main">
              <span className="place-name">
                <b id={id}>{c.name}</b>
                {c.badge && (
                  <span className="place-badge" id={`${id}-badge`}>
                    {c.badge}
                  </span>
                )}
              </span>
              <small id={`${id}-info`}>
                {c.tags.map((t) => (
                  <Fragment key={t}>
                    <em className="place-deal">{t}</em>
                    {" · "}
                  </Fragment>
                ))}
                {c.info.join(" · ")}
              </small>
            </span>
            {c.pill && (
              <span className="place-distance" id={`${id}-pill`}>
                {c.pill}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- 채팅창을 끈 동안의 가운데 자막 ----
// 표가 있는 답(주문서·예약 확인·식당·안내)은 자막에 제목·질문 한 줄만 적고, 다 적히면 그 아래에 표를 띄운다.
// 소리로는 지금처럼 표 내용까지 읽는다 (spokenText)
export interface CaptionCard {
  key: string;
  messageId: number; // 이 표를 낸 봇 말풍선
  rows: OrderRow[];
  list?: boolean; // 메뉴·식당 목록: 이름이 앞, 아래 줄에 가격·가게·거리 등
  pickable?: boolean; // 줄을 눌러 고를 수 있는지 (그 질문이 지금 답할 차례일 때만)
  choices?: boolean; // 맛 고르기: 줄 대신 채팅창과 같은 체크 표(ChoicePicker)를 띄운다 (picker 는 그릴 때 붙인다)
  picker?: ReactNode;
}

function captionCard(m: Message, now: Date): CaptionCard | null {
  if (m.role === "user") return null;
  const key = `m${m.id}`;
  const messageId = m.id;
  switch (m.kind) {
    case "order":
      return { key, messageId, rows: orderCardRows(m.order) };
    case "cart":
      return { key, messageId, rows: cartCardRows(m.order) };
    // 맛 고르기: 채팅창과 같은 체크 표 (눌러서 고르거나 맛 이름을 말해서 고른다)
    case "choices":
      return { key, messageId, rows: [], choices: true };
    case "reservation": {
      const r = m.reservation;
      return {
        key,
        messageId,
        rows: filledRows([
          { label: "식당", value: r.restaurant.name },
          { label: "날짜", value: formatDate(r.date) },
          { label: "시간", value: r.time, emphasis: true },
          { label: "인원", value: `${r.people}명` },
          { label: "주소", value: r.restaurant.address },
        ]),
      };
    }
    case "restaurantPicked": {
      const r = m.restaurant;
      return {
        key,
        messageId,
        rows: filledRows([
          { label: "식당", value: r.name },
          { label: "거리", value: km(r.distanceKm) },
          { label: "대표 메뉴", value: r.signature },
          { label: "영업시간", value: r.hours },
          { label: "주소", value: r.address },
        ]),
      };
    }
    case "info":
      return { key, messageId, rows: m.card.rows };
    case "text":
      if (!m.menu?.length) return null;
      return { key, messageId, list: true, rows: m.menu.map((d) => pickCardRow(menuCard(d))) };
    case "restaurants":
      return { key, messageId, list: true, rows: m.list.map((r) => pickCardRow(restaurantCard(r, now))) };
    default:
      return null;
  }
}

function captionLine(m: Message): string {
  if (m.role === "user") return "";
  // 메뉴를 추천하는 말풍선: 이름은 아래 표로 보여 주므로 자막은 짧은 안내만
  if (m.kind === "text" && m.menu?.length) return m.text.replace(/\n/g, " ");
  switch (m.kind) {
    case "order":
      return `${ORDER_CARD_TITLE} ${ORDER_CARD_QUESTION}`;
    case "cart":
      return `${m.text} ${CART_QUESTION}`;
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
  // 장바구니: 담은 메뉴들이 든 주문서. 담는 중(cart)·더 담을 메뉴의 수량·맛 고르기·주문서 확인(confirm) 동안 유지된다.
  // 한 처리 안에서 담은 직후 바로 읽어야 하는 곳이 있어(상태는 다음 렌더에 바뀐다) ref 로도 든다
  const [, setOrder] = useState<Order | null>(null); // 값은 cartRef 로 읽는다 (바뀌면 다시 그리게 상태로도 둔다)
  const cartRef = useRef<Order | null>(null);
  const cart = () => cartRef.current;
  function setCart(next: Order | null) {
    cartRef.current = next;
    setOrder(next);
  }
  // 담은 것과 다른 가게 메뉴를 말해 "새로 시작할까요?"라고 묻는 동안 기억해 둔 그 메뉴들과 말
  // lines: 한 문장에 여러 메뉴를 말한 경우 차례로 담을 메뉴들
  const [pendingSwitch, setPendingSwitch] = useState<{ items: DeliveryItem[]; text: string; lines?: PendingAdd[] } | null>(null);
  // 한 문장에 여러 메뉴를 말했을 때 아직 담지 않은 메뉴들, 그리고 담은 것·못 담은 이유 (다 담은 뒤 한 번에 알린다)
  const queueRef = useRef<PendingAdd[]>([]);
  // 주문서를 보다가 세트 수를 바꿔 맛을 다시 고르는 중: 다 고르면 장바구니가 아니라 주문서로 돌아간다
  const backToOrderRef = useRef(false);
  const notesRef = useRef<{ added: string[]; notes: string[] }>({ added: [], notes: [] });
  // 모아 둔 안내를 한 문장으로 꺼내고 비운다: "양념치킨은 지금 주문할 수 없어요. 간장치킨 1마리, 보쌈 중 2개를 담았어요."
  function takeNotesText(): string {
    const { added, notes } = notesRef.current;
    notesRef.current = { added: [], notes: [] };
    return [...notes, ...(added.length ? [`${withObjectParticle(added.join(", "))} 담았어요.`] : [])].join("\n");
  }
  const takeNotes = (): NewMessage[] => {
    const text = takeNotesText();
    return text ? [botText(text)] : [];
  };
  // 메뉴를 고르고 수량을 기다리는 중인 배달 메뉴
  const [pendingItem, setPendingItem] = useState<DeliveryItem | null>(null);
  // 진행 중인 식당 예약
  const [rsv, setRsv] = useState<ReservationDraft | null>(null);
  // 한 문장에 같이 말해 둔 것들: 메뉴를 고르기 전에 말한 수량("치킨 두 마리"),
  // 식당을 고르기 전에 말한 예약 날짜·시간·인원("내일 7시 4명")
  const [pendingQty, setPendingQty] = useState<number | null>(null);
  // 세트 메뉴의 맛을 고르는 중인 메뉴와 세트 수
  const [choosing, setChoosing] = useState<{ item: DeliveryItem; qty: number } | null>(null);
  const [rsvSlots, setRsvSlots] = useState<ReservationSlots>({});
  // "그 식당", "아까 그거"가 가리킬 마지막 식당·메뉴
  const [lastPlace, setLastPlace] = useState<Restaurant | null>(null);
  const [lastItem, setLastItem] = useState<DeliveryItem | null>(null);
  // 취소할지 묻고 있는 내 주문
  const [cancelTarget, setCancelTarget] = useState<OrderRecord | null>(null);
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
  // 사용법 안내: 이 브라우저에서 처음 열면 저절로 띄운다
  const [tutorialOpen, setTutorialOpen] = useState(() => !tutorialSeen());
  const quickMenuId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  // "새 대화"를 누를 때마다 1씩 오른다. 그 전에 시작한 서버 조회의 답은 새 대화에 끼어들지 않는다
  const conversationRef = useRef(0);

  // 말로 입력: 들은 문장을 글자로 입력한 것과 똑같이 처리한다 (입력창이 접혀 있어도 된다)
  const voice = useVoiceInput(handleVoice);
  const tts = useSpeechOutput();
  // 로그인한 소비자면 주문·예약 기록에 이름이 남고, 아니면 비회원으로 남는다
  const session = useSession();
  // 사장님이 바꾼 영업시간·품절·메뉴와 인기 통계를 서버에서 받아 온다 (메뉴 버튼·추천 순서와 예약 시간에 반영)
  useDb(["settings", "popular", "menu"]);

  // 배달 주문은 로그인한 고객님이 계정 관리에 적은 배달지·연락처로 한다 (어느 기기에서든 같다)
  const member = session?.role === "user";
  const myDelivery: Partial<DeliveryInfo> = session?.role === "user" ? { address: session.address, phone: session.phone } : {};
  const memberReady = member && hasDelivery(myDelivery);

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
    lastBot?.role === "bot" &&
    ((lastBot.kind === "text" && lastBot.choices) || lastBot.kind === "people" || lastBot.kind === "qty" || lastBot.kind === "choices" || (lastBot.kind === "restaurants" && lastBot.choices))
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
  const promptPlaceholder = activePrompt?.kind === "text" || activePrompt?.kind === "restaurants" ? activePrompt.placeholder : undefined;
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
  function showRestaurants(
    foodLabel: string,
    list: Restaurant[],
    opts: { heading?: string; lead?: NewMessage[]; next?: Stage; choices?: Choice[]; placeholder?: string; delay?: number } = {},
  ) {
    // 추천할 곳이 하나도 없으면 빈 목록 대신 그렇다고 알리고 다른 음식을 권한다
    // (그 음식을 파는 가게가 아예 없을 때와, 있지만 모두 일시 중지 중일 때 말이 다르다)
    if (list.length === 0) {
      const food = FOODS.find((f) => f.label === foodLabel);
      const text =
        food && !hasStoresFor(food.key)
          ? `아직 근처에 ${foodLabel} 가게가 없어요.\n다른 음식은 어떠세요?`
          : `지금 ${foodLabel ? `근처 ${foodLabel} 가게가` : "근처 가게가"} 모두 잠시 쉬고 있어요.\n다른 음식은 어떠세요?`;
      setStage("food");
      botReply(() =>
        push(
          ...(opts.lead ?? []),
          botPrompt({ ...FOOD_PROMPT, text, say: text.replace("\n", " "), choices: FOOD_PROMPT.choices?.filter((c) => c.label !== foodLabel) }),
        ),
      );
      return;
    }
    setStage(opts.next ?? "restaurant");
    botReply(() => push(...(opts.lead ?? []), { role: "bot", kind: "restaurants", foodLabel, list, heading: opts.heading, choices: opts.choices, placeholder: opts.placeholder }), opts.delay ?? 900);
  }

  // 메뉴·수량이 정해지면 장바구니에 담는다 (로그인이나 배달지가 없으면 그 안내에서 멈춘다)
  // 세트 메뉴(맛 고르기가 있는 메뉴)는 맛부터 고르고, 고른 맛(choices)으로 담는다
  function startOrder(item: DeliveryItem, qty: number, choices?: ChosenOption[]) {
    if (deliveryBlocked({ itemId: item.id, qty, ...resumeCartOf(cart()) }) || !hasDelivery(myDelivery)) return;
    setPendingItem(null);
    setLastItem(item);
    if (item.choice && !choices) {
      setChoosing({ item, qty });
      setStage("choose");
      const lead = takeNotes();
      botReply(() => push(...lead, choicePrompt(item, qty)));
      return;
    }
    setChoosing(null);
    addToCart(item, qty, choices);
  }

  // 한 문장에 여러 메뉴를 말했을 때("간장치킨 1마리랑 양념치킨 2마리"): 같은 가게 메뉴를 말한 순서대로 담는다.
  // 수량을 말하지 않은 메뉴는 수량을, 세트는 맛을 차례로 묻는다. 담은 메뉴와 다른 가게 메뉴만 말했으면 새로 시작할지 묻는다
  function addNamed(lines: PendingAdd[], text: string) {
    const bag = cart();
    const storeId = bag?.items.length ? bag.storeId : lines[0].item.restaurantId;
    const here = lines.filter((l) => l.item.restaurantId === storeId);
    if (!here.length) {
      askSwitchStore(lines.map((l) => l.item), text, lines);
      return;
    }
    notesRef.current = { added: [], notes: [] };
    const others = lines.filter((l) => l.item.restaurantId !== storeId);
    if (others.length) {
      notesRef.current.notes.push(`${withTopicParticle(others.map((l) => l.item.name).join(", "))} 다른 가게 메뉴라 한 주문에 같이 담지 않았어요.`);
    }
    const menu = availableDeliveryMenu();
    const ok = here.flatMap((l) => menu.filter((d) => d.id === l.item.id).map((item) => ({ item, qty: l.qty })));
    const gone = here.filter((l) => !menu.some((d) => d.id === l.item.id));
    if (gone.length) notesRef.current.notes.push(`${withTopicParticle(gone.map((l) => l.item.name).join(", "))} 지금 주문할 수 없어요.`);
    if (!ok.length) {
      const head = takeNotesText();
      if (bag?.items.length) showCart(bag, `${head}\n지금 담은 메뉴예요.`);
      else offerInstead(head.replace(/\n/g, " "), alternativesFor(gone[0].item));
      return;
    }
    const restLines: ResumeLine[] = ok.slice(1).flatMap((l) => (qtyInRange(l.qty) ? [{ itemId: l.item.id, qty: l.qty }] : []));
    const remembered = resumeCartOf(bag);
    if (deliveryBlocked({ itemId: ok[0].item.id, qty: ok[0].qty, ...(remembered.cart || restLines.length ? { cart: [...(remembered.cart ?? []), ...restLines] } : {}) })) return;
    queueRef.current = ok.slice(1);
    takeQueued(ok[0]);
  }

  // 차례로 담는 메뉴 하나: 수량을 말했으면 담고(세트면 맛부터), 아니면 수량을 묻는다
  function takeQueued({ item, qty: said }: PendingAdd) {
    setLastItem(item);
    // 세트 메뉴(맛 고르기가 있고 단위가 "세트")는 수량을 말하지 않았으면 1세트로 바로 맛을 고른다 (deliverItems 와 같은 규칙)
    const qty = said ?? (item.choice && item.unit === "세트" ? 1 : undefined);
    if (qtyInRange(qty)) {
      startOrder(item, qty);
      return;
    }
    setPendingQty(null);
    setPendingItem(item);
    setStage("qty");
    const lead = takeNotes();
    botReply(() => push(...lead, deliveryQty(item, qty !== undefined ? rangeLead(item) : undefined)));
  }

  // 계정의 배달지·연락처 (둘 다 있을 때만. 주문서에 적는다)
  const deliveryInfo = () => (hasDelivery(myDelivery) ? myDelivery : undefined);

  // 장바구니에 담고 "더 담을까요?"를 묻는다. 같은 메뉴가 이미 있으면 합친다 (addItem).
  // 담은 메뉴가 있으면 같은 가게 것만 온다 (다른 가게 메뉴는 deliverItems 가 먼저 새로 시작할지 묻는다)
  function addToCart(item: DeliveryItem, qty: number, choices?: ChosenOption[]) {
    const line = makeOrderItem(item, qty, choices);
    const bag = cart();
    const base = bag && bag.storeId === item.restaurantId ? bag : storeOrder(item.restaurantId, [], deliveryInfo());
    let next = addItem(base, line);
    const notes = notesRef.current;
    if (next.items.length > MAX_ORDER_ITEMS) {
      notes.notes.push(`메뉴는 ${MAX_ORDER_ITEMS}가지까지 담을 수 있어서 ${withObjectParticle(item.name)} 담지 못했어요.`);
      next = base;
    } else if (next.items.some((l) => l.qty > MAX_QTY)) {
      // 같은 메뉴를 더 담아 합친 수량이 상한을 넘으면 담지 않는다 (서버도 받지 않는다)
      const had = base.items.filter((l) => l.item === item.name).reduce((sum, l) => sum + l.qty, 0);
      notes.notes.push(`${withTopicParticle(item.name)} 한 번에 ${MAX_QTY}${item.unit}까지 주문할 수 있어요. 이미 ${had}${item.unit} 담겨 있어서 더 담지 못했어요.`);
      next = base;
    } else {
      notes.added.push(itemText(line)); // 고른 맛은 아래 표에 적힌다
    }
    // 한 문장에 말한 메뉴가 더 남았으면 다음 메뉴로 (다 담은 뒤 한 번에 장바구니를 보여 준다)
    const queued = queueRef.current.shift();
    if (queued) {
      setCart(next.items.length ? next : null);
      takeQueued(queued);
      return;
    }
    if (backToOrderRef.current) {
      backToOrderRef.current = false;
      showOrderCard(next, takeNotes());
      return;
    }
    showCart(next, takeNotesText(), bag?.items.length ? next !== base : false); // 담은 것에 더 담았으면 그 앞 모습은 담는 도중
  }

  // 담은 메뉴 목록을 보여 주고 더 담을지 묻는다 (더 담기 · 이대로 주문)
  function showCart(next: Order, text: string, midway = false) {
    setCart(next);
    setStage("cart");
    botReply(() => push({ role: "bot", kind: "cart", text, order: next, ...(midway ? { midway } : {}) }));
  }

  // 담은 메뉴로 주문서를 보여 주고 "응 해줘"를 기다린다
  function showOrderCard(next: Order, lead: NewMessage[] = []) {
    // 담은 뒤 사장님이 가격·할인을 바꿨으면 지금 가격으로 다시 계산해 보여 준다 (주문 금액은 서버가 지금 가격으로 정한다)
    const fresh = repriced(next);
    const changed = !!fresh && fresh.price !== next.price;
    const card = changed ? fresh : next;
    setCart(card);
    setStage("confirm");
    const note: NewMessage[] = changed ? [botText("담으신 뒤 가격이 바뀌어 지금 가격으로 다시 계산했어요.")] : [];
    botReply(() => push(...lead, ...note, { role: "bot", kind: "order", order: card }));
  }

  // 담은 메뉴를 지금 메뉴 목록·가격으로 다시 계산한 주문서. 그사이 담을 수 없게 된 메뉴가 있으면 null (주문하면 서버가 그 이유를 알린다)
  function repriced(o: Order): Order | null {
    const { lines, gone, repick } = rebuildLines(o.storeId ?? "", o.items);
    if (gone.length || repick || lines.length !== o.items.length) return null;
    return withItems(o, lines);
  }

  // 장바구니를 로그인·배달지 등록 뒤에 이어 가려고 기억해 둘 모양 (메뉴 id·수량·고른 맛 이름)
  function resumeCartOf(bag: Order | null): Pick<ResumeDelivery, "cart"> {
    const lines = (bag?.items ?? []).flatMap((line): ResumeLine[] => {
      const d = deliveryMenu().find((x) => x.restaurantId === bag!.storeId && x.name === line.item);
      return d ? [{ itemId: d.id, qty: line.qty, ...(line.choices?.length ? { choices: line.choices.map((c) => c.name) } : {}) }] : [];
    });
    return lines.length ? { cart: lines } : {};
  }

  // 전에 담았던 메뉴들(이번 대화의 주문서·지난 주문·로그인 전에 기억한 장바구니)을 지금 메뉴 목록·가격으로 다시 담는다.
  // 품절·일시 중지·사라진 메뉴는 gone 에 두고, 세트인데 고른 맛을 그대로 쓸 수 없는(세트 수가 바뀌었거나 그 맛이 메뉴에서 빠진) 첫 메뉴는
  // repick 에 둔다 (맛만 다시 고르면 담긴다. 그런 세트가 둘 이상이면 나머지는 gone). saidQty: 메뉴가 하나일 때 새로 말한 수량
  type LineSpec = { item: string; qty: number; choices?: { name: string }[] };
  function rebuildLines(storeId: string, specs: LineSpec[], saidQty?: number) {
    const lines: OrderItem[] = [];
    const gone: { name: string; known?: DeliveryItem }[] = [];
    let repick: { item: DeliveryItem; qty: number } | undefined;
    for (const spec of specs) {
      const known = deliveryMenu().find((d) => d.restaurantId === storeId && d.name === spec.item);
      const item = known && availableDeliveryMenu().find((d) => d.id === known.id);
      if (!item) {
        gone.push({ name: spec.item, known });
        continue;
      }
      const qty = specs.length === 1 && qtyInRange(saidQty) ? saidQty : spec.qty;
      const picked = (spec.choices ?? []).map((c) => item.choice?.options.find((o) => o.name === c.name));
      const choices = item.choice && qty === spec.qty && picked.length === item.choice.count * qty && picked.every(Boolean) ? (picked as ChosenOption[]) : undefined;
      if (item.choice && !choices) {
        if (repick) gone.push({ name: spec.item, known });
        else repick = { item, qty };
        continue;
      }
      lines.push(makeOrderItem(item, qty, choices));
    }
    return { lines, gone, repick };
  }
  // 다시 담지 못한 메뉴 안내
  const goneNote = (gone: { name: string }[]): NewMessage[] => (gone.length ? [botText(`${withTopicParticle(gone.map((g) => g.name).join(", "))} 지금 담을 수 없어 뺐어요.`)] : []);
  // 주문서 맨 마지막 메뉴 ("아까 그거"가 가리킬 메뉴)
  const lastItemOf = (bag: Order) => availableDeliveryMenu().find((d) => d.restaurantId === bag.storeId && d.name === bag.items.at(-1)?.item) ?? null;

  // 전에 보여 드린 주문서를 다시: 같은 메뉴들·수량(메뉴가 하나고 새로 말한 수량이 있으면 그 수량)·고른 맛으로, 값과 배달지는 지금 것으로 만든다.
  // 그사이 품절·일시 중지된 메뉴는 빼고 알리고(다 그러면 다른 메뉴를 권한다), 세트 수가 바뀌었거나 고른 맛이 메뉴에서 빠졌으면 맛만 다시 고른다
  function restoreOrder(draft: Order, text: string, first: boolean) {
    startFresh();
    const storeId = draft.storeId ?? "";
    const { lines, gone, repick } = rebuildLines(storeId, draft.items, parseQuantity(text));
    if (!lines.length && !repick) {
      const g = gone[0];
      const paused = g?.known && storePausedUntil(g.known.restaurantId);
      offerInstead(
        g?.known && paused ? pausedText(restaurantById(g.known.restaurantId).name, paused) : `${withTopicParticle(g?.name ?? "그 메뉴")} 지금 주문할 수 없어요.`,
        g?.known ? alternativesFor(g.known) : availableDeliveryMenu(),
      );
      return;
    }
    const base = storeOrder(storeId, lines, deliveryInfo());
    if (deliveryBlocked({ ...(repick ? { itemId: repick.item.id, qty: repick.qty } : {}), ...resumeCartOf(base) }) || !hasDelivery(myDelivery)) return;
    setCart(lines.length ? base : null);
    if (repick) {
      push(...goneNote(gone));
      startOrder(repick.item, repick.qty);
      return;
    }
    setLastItem(lastItemOf(base));
    showOrderCard(base, [...goneNote(gone), botText(`${first ? "처음에" : "아까"} 고르신 ${withRoParticle(orderItemText(base))} 주문서를 다시 만들었어요.`)]);
  }

  // 배달 주문은 로그인한 고객님이 계정에 배달지·연락처를 적어 둬야 할 수 있다. 아니면 안내하고 멈춘다(true).
  // 고르던 메뉴·수량은 기억해 두었다가 로그인하거나 배달지를 등록하고 돌아오면 이어 간다
  function deliveryBlocked(resume: ResumeDelivery): boolean {
    if (!session) {
      sendAway("login", "배달 주문은 로그인한 뒤에 할 수 있어요.\n로그인 화면으로 이동시켜드릴게요.", resume);
      return true;
    }
    if (session.role !== "user") {
      startFresh();
      setStage("idle");
      botReply(() => push(botText("배달 주문은 고객님 계정으로 할 수 있어요.")));
      return true;
    }
    if (hasDelivery(myDelivery)) return false;
    const what = !myDelivery.address && !myDelivery.phone ? "배달지와 연락처" : !myDelivery.address ? "배달지" : "연락처";
    sendAway("account", `아직 계정에 ${what}가 없어요.\n${what}를 등록해주세요.`, resume, true);
    return true;
  }

  // 로그인 화면이나 계정 관리로 보낸다.
  // auto: 안내를 읽을 틈(3초)을 두고 저절로 넘어간다 (로그인 전, 계정에 배달지·연락처가 없을 때).
  // 아니면 버튼을 누르거나 "응"이라고 할 때 간다 (주문서에서 "주소 바꿔줘"처럼 손님이 바꾸겠다고 할 때)
  function sendAway(to: "login" | "account", text: string, resume: ResumeDelivery, auto = to === "login") {
    startFresh();
    rememberResume(session?.username ?? null, resume);
    setStage(to === "login" ? "needLogin" : "needContact");
    if (auto) {
      botReply(() => {
        push(botText(text));
        // 해시 주소라 주소만 바꾸면 그 화면으로 간다. "새 대화"를 누르거나 화면을 떠나면 타이머째 취소된다
        later(() => window.location.assign(to === "login" ? "#/login" : "#/account"), REDIRECT_MS);
      });
      return;
    }
    botReply(() => push(botPrompt({ text, choices: [ACCOUNT_CHOICE], noDirect: true })));
  }

  // 로그인하거나 배달지를 등록하고 돌아왔을 때: 담아 두었던 메뉴들은 다시 담고, 고르던 메뉴는 수량까지 골랐으면 담고, 메뉴만 골랐으면 수량부터.
  // 고르던 메뉴가 없으면(배달지만 바꾸고 온 경우) 담은 메뉴로 주문서를 바로 보여 주고, 아무것도 없으면 메뉴부터
  function continueOrder(resume: ResumeDelivery) {
    const chosen = resume.itemId ? deliveryMenu().find((d) => d.id === resume.itemId) : undefined;
    const item = chosen && availableDeliveryMenu().find((d) => d.id === chosen.id);
    push(botText(`${session ? `${session.name}님, ` : ""}고르시던 배달 주문을 이어서 도와드릴게요.`));
    // 담아 두었던 메뉴들 (한 가게 것만. 그사이 품절된 것은 빼고 알린다)
    const specs = (resume.cart ?? []).flatMap((l) => {
      const d = deliveryMenu().find((x) => x.id === l.itemId);
      return d ? [{ storeId: d.restaurantId, item: d.name, qty: l.qty, choices: l.choices?.map((name) => ({ name })) }] : [];
    });
    const storeId = specs[0]?.storeId;
    const rebuilt = storeId ? rebuildLines(storeId, specs.filter((s) => s.storeId === storeId)) : { lines: [], gone: [], repick: undefined };
    push(...goneNote(rebuilt.gone));
    const bag = storeId && rebuilt.lines.length ? storeOrder(storeId, rebuilt.lines, deliveryInfo()) : null;
    setCart(bag);
    // 그사이 그 가게가 일시 중지했거나 메뉴가 품절됐으면 이유를 말하고 다른 메뉴를 권한다
    if (chosen && !item) {
      const paused = storePausedUntil(chosen.restaurantId);
      offerInstead(paused ? pausedText(restaurantById(chosen.restaurantId).name, paused) : `${withTopicParticle(chosen.name)} 지금 품절이에요.`, alternativesFor(chosen));
      return;
    }
    if (item && qtyInRange(resume.qty)) startOrder(item, resume.qty);
    else if (item) deliverItems([item], "");
    else if (rebuilt.repick) startOrder(rebuilt.repick.item, rebuilt.repick.qty);
    else if (bag) showOrderCard(bag);
    else startMenu("배달");
  }

  const rangeLead = (item: DeliveryItem) => `1${item.unit}부터 ${MAX_QTY}${item.unit}까지 주문할 수 있어요.`;
  const qtyInRange = (n: number | undefined): n is number => n !== undefined && n >= 1 && n <= MAX_QTY;

  // 고른 메뉴(들)로 주문을 이어 간다. 수량까지 있으면 바로 주문서로, 없으면 수량을 묻고,
  // 여러 메뉴면 그중에서 고르게 한다. 같이 말한 수량("두 마리")은 기억해 뒀다가 쓴다
  function deliverItems(items: DeliveryItem[], text: string) {
    // 한 주문은 한 가게: 담은 메뉴가 있으면 같은 가게 메뉴만 남기고, 없으면 담은 것을 비우고 새로 시작할지 묻는다
    const bag = cart();
    if (bag?.items.length) {
      const same = items.filter((d) => d.restaurantId === bag.storeId);
      if (!same.length) {
        askSwitchStore(items, text);
        return;
      }
      items = same;
    }
    const said = parseQuantity(text);
    queueRef.current = [];
    if (deliveryBlocked({ ...(items.length === 1 ? { itemId: items[0].id, qty: said ?? pendingQty ?? undefined } : {}), ...resumeCartOf(bag) })) return;
    if (items.length > 1) {
      setPendingItem(null);
      setPendingQty(qtyInRange(said) ? said : null);
      setStage("menu");
      botReply(() => push(botPrompt(pickDeliveryPrompt(items))));
      return;
    }
    const item = items[0];
    // 세트 메뉴(맛 고르기가 있고 단위가 "세트", 예: 2마리 치킨 세트)는 메뉴 하나가 곧 한 세트라 수량을 묻지 않고 1세트로 바로 맛을 고른다.
    // 이 말에서 수량을 말했을 때만("2마리 치킨 세트 2세트") 그 수량으로. 앞서 "치킨 두 마리"처럼 말해 둔 마리 수는 세트 수가 아니라 쓰지 않는다
    const setMenu = !!item.choice && item.unit === "세트";
    const qty = setMenu ? (said ?? 1) : (said ?? pendingQty ?? undefined);
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
    // "간장치킨 1마리랑 양념치킨 2마리": 메뉴 이름을 둘 이상 말했으면 메뉴마다 그 뒤에 말한 수량으로 차례로 담는다
    // (같은 이름이 여러 가게에 있어 한 자리에 여러 메뉴가 걸리면 아래 원래 방식으로 고르게 한다)
    const named = menusNamedIn(text);
    // 수량도 주문하는 말도 없으면("간장치킨이랑 옛날통닭 뭐가 나아?") 담지 않고 아래에서 그중에 고르게 한다
    const wantsAll = named.some((n) => parseQuantity(n.part) !== undefined) || /주세요|줘|시켜|주문|담아|추가/.test(text);
    if (wantsAll && named.length >= 2 && new Set(named.map((n) => n.start)).size === named.length) {
      addNamed(named.map((n) => ({ item: n.item, qty: parseQuantity(n.part) })), text);
      return true;
    }
    const items = findDeliveryItems(text);
    if (items.length > 0) {
      // "깐장치킨"은 "치킨"으로 여러 메뉴에 걸리지만, 이름이 비슷한 메뉴가 그중에 있으면 그 메뉴로 본다.
      // 세 글자 이하의 짧은 이름("족발 소")은 "족발 시켜줘"의 "족발시"처럼 한 글자만 달라도 비슷해 보이므로 이렇게 고르지 않는다.
      // "소떡소떡"처럼 말한 낱말로 시작하는 메뉴가 여럿이면(1개·2개 묶음·3개 묶음) 하나를 고르지 않고 그중에서 고르게 한다
      const near = items.length > 1 ? fuzzyFind(text) : undefined;
      const words = text.split(/\s+/).map(squash).filter((w) => [...w].length >= 2);
      const ambiguous = words.some((w) => items.filter((d) => squash(d.name).startsWith(w)).length > 1);
      const one = near?.kind === "menu" && !ambiguous && [...squash(near.item.name)].length >= 4 ? items.find((d) => d.id === near.item.id) : undefined;
      deliverItems(one ? [one] : items, text);
      return true;
    }
    // 이름을 말한 메뉴가 품절이거나, 그 가게가 일시 중지 중이면 이유를 말하고 비슷한 메뉴를 권한다
    const gone = soldOutItemNamed(text);
    if (!gone) return false;
    const paused = storePausedUntil(gone.restaurantId);
    offerInstead(paused ? pausedText(restaurantById(gone.restaurantId).name, paused) : `${withTopicParticle(gone.name)} 지금 품절이에요.`, alternativesFor(gone));
    return true;
  }

  // 지금 주문할 수 없는 메뉴·가게(품절·일시 중지) 대신 다른 메뉴를 권한다
  function offerInstead(head: string, alts: DeliveryItem[]) {
    setPendingItem(null);
    setStage(alts.length ? "menu" : "idle");
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
  }

  // 고르던 메뉴(수량·맛을 묻는 중)를 그만둔다. 한 문장에 말한 메뉴가 더 남았으면 다음 메뉴로 가고,
  // 이미 담은 메뉴가 있으면 그것은 그대로 두고 더 담을지 다시 묻는다
  function cancelDelivery() {
    setPendingItem(null);
    setPendingQty(null);
    setChoosing(null);
    backToOrderRef.current = false;
    const queued = queueRef.current.shift();
    if (queued) {
      notesRef.current.notes.push("그 메뉴는 담지 않을게요.");
      takeQueued(queued);
      return;
    }
    const bag = cart();
    if (bag?.items.length) {
      showCart(bag, "그 메뉴는 담지 않을게요. 지금 담은 메뉴예요.");
      return;
    }
    setStage("idle");
    botReply(() => push(botText("배달 주문을 그만할게요. 다른 게 필요하면 말씀해 주세요!")));
  }

  // 더 담을 메뉴의 수량·맛을 묻는 중에 "이대로 주문", "그만 담을게": 그 메뉴는 담지 않고 담아 둔 메뉴로 주문서를 보여 준다
  function skipToOrder(bag: Order) {
    setPendingItem(null);
    setPendingQty(null);
    setChoosing(null);
    queueRef.current = [];
    notesRef.current = { added: [], notes: [] };
    backToOrderRef.current = false;
    showOrderCard(bag, [botText("고르시던 메뉴는 담지 않고, 담아 두신 메뉴로 주문서를 보여 드릴게요.")]);
  }

  // "얼마야?": 담은 메뉴 이름을 말했으면 그 줄의 금액, 담지 않은 메뉴면 1단위 값, 아니면 합계(메뉴가 여럿이면 줄마다)를 알려 주고 묻던 것을 다시 묻는다
  function answerPrice(text: string, bag: Order, inCart: boolean) {
    const named = findDeliveryItems(text); // 담지 않은 메뉴(다른 가게 것도)는 1단위 값을 알려 준다
    const inBag = bag.items.filter((l) => named.some((d) => d.name === l.item));
    const answer = inBag.length
      ? `${inBag.map((l) => `${itemText(l)} ${itemPriceLabel(l)}`).join(", ")}이에요.`
      : named.length === 1
        ? `${withTopicParticle(named[0].name)} ${restaurantById(named[0].restaurantId).name}에서 1${named[0].unit}에 ${priceText(named[0])}이에요.`
        : `지금 담은 메뉴는 모두 ${orderPriceLabel(bag)}이에요.${bag.items.length > 1 ? `\n${bag.items.map((l) => `${itemText(l)} ${won(l.price)}`).join(", ")}` : ""}`;
    botReply(() =>
      push(botText(`${answer}\n${inCart ? CART_QUESTION : ORDER_CARD_QUESTION}`), ...(inCart ? [] : [{ role: "bot", kind: "confirm" } as NewMessage])),
    );
  }

  // 담은 메뉴를 모두 비우고 주문을 접는다
  function cancelAll() {
    startFresh();
    setStage("idle");
    botReply(() => push(botText("주문을 취소했어요. 다른 게 필요하면 말씀해 주세요!")));
  }

  // 담은 것과 다른 가게 메뉴를 말했을 때: 담은 것을 비우고 새로 시작할지 묻는다 (한 주문은 한 가게)
  function askSwitchStore(items: DeliveryItem[], text: string, lines?: PendingAdd[]) {
    const bag = cart()!;
    setPendingItem(null);
    setChoosing(null);
    queueRef.current = [];
    setPendingSwitch({ items, text, lines });
    setStage("switchStore");
    const other = restaurantById(items[0].restaurantId).name;
    const head = `지금 담은 건 ${bag.store.name} 거예요. ${withTopicParticle(other)} 다른 가게라 한 주문에 같이 담을 수 없어요.`;
    botReply(() =>
      push(
        botPrompt({
          text: `${head}\n담은 것을 비우고 새로 시작할까요?`,
          say: `${head} 담은 것을 비우고 새로 시작할까요?`,
          choices: [
            { label: "새로 시작", value: "응 새로 시작할게" },
            { label: "담은 것 그대로", value: "아니 그대로 둘게" },
          ],
          noDirect: true,
        }),
      ),
    );
  }

  // "더 담기": 그 가게의 메뉴를 보여 주고 고르게 한다
  function showMoreMenu(bag: Order) {
    const menu = availableDeliveryMenu().filter((d) => d.restaurantId === bag.storeId);
    if (!menu.length) {
      showCart(bag, "이 가게에 지금 더 담을 수 있는 메뉴가 없어요.");
      return;
    }
    const prompt = pickDeliveryPrompt(menu);
    setPendingItem(null);
    setStage("menu");
    botReply(() =>
      push(
        botPrompt({
          ...prompt,
          text: `${bag.store.name} 메뉴예요. 어떤 메뉴를 더 담을까요?\n이름을 말씀하시거나 아래에서 골라 주세요.`,
          say: `어떤 메뉴를 더 담을까요? ${recommend((prompt.menu ?? []).map((d) => d.name))}`,
        }),
      ),
    );
  }

  // "족발 빼줘", "소떡소떡 취소": 담은 메뉴 중 그 메뉴만 뺀다. 마지막 메뉴를 빼면 주문을 접는다. 뺄 메뉴 이름이 없으면 false
  // resume: 다른 메뉴의 수량·맛을 묻는 중에 뺐을 때, 빼고 나서 다시 보여 줄 그 질문 (장바구니 카드·주문서 대신)
  function removeFromCart(text: string, bag: Order, resume?: () => NewMessage): boolean {
    if (!/빼|제외|취소|지워|삭제|없애/.test(text)) return false;
    const typed = squash(text);
    const named = new Set(findDeliveryItems(text, bag.storeId).map((d) => d.name));
    const targets = bag.items.map((_, i) => i).filter((i) => named.has(bag.items[i].item) || typed.includes(squash(bag.items[i].item)));
    if (!targets.length) return false;
    // "족발 빼줘"인데 족발 소·족발 중이 다 담겨 있으면 어느 것인지 묻는다
    if (targets.length > 1 && !/다\s|전부|모두/.test(text)) {
      botReply(() =>
        push(
          botPrompt({
            text: "어느 메뉴를 뺄까요?",
            choices: targets.map((i) => ({ label: itemText(bag.items[i]), value: `${bag.items[i].item} 빼줘` })),
            noDirect: true,
          }),
        ),
      );
      return true;
    }
    // 한 메뉴를 담긴 수량보다 적게 말했으면("3마리 중 1마리 빼줘") 그만큼만 뺀다
    const less = parseQuantity(text);
    const one = targets.length === 1 ? bag.items[targets[0]] : undefined;
    if (one && less !== undefined && less >= 1 && less < one.qty) {
      const left = one.qty - less;
      const gone = withObjectParticle(itemText({ ...one, qty: less }));
      const item = availableDeliveryMenu().find((d) => d.restaurantId === bag.storeId && d.name === one.item);
      // 세트는 남은 세트 수만큼 맛을 다시 고른다 (고르면 다시 담긴다)
      if (one.choices?.length && item?.choice && !resume) {
        const rest = replaceItem(bag, targets[0]);
        setCart(rest.items.length ? rest : null);
        notesRef.current = { added: [], notes: [`${gone} 뺐어요. 남은 ${left}${one.unit}의 ${withObjectParticle(one.choiceLabel ?? "맛")} 다시 골라 주세요.`] };
        backToOrderRef.current = stage === "confirm";
        startOrder(item, left);
        return true;
      }
      if (!one.choices?.length) {
        const each = (v: number | undefined) => (v === undefined ? undefined : (v / one.qty) * left);
        const listPrice = each(one.listPrice);
        const fewer = replaceItem(bag, targets[0], { ...one, qty: left, price: each(one.price)!, ...(listPrice !== undefined ? { listPrice } : {}) });
        if (resume) {
          cartRef.current = fewer;
          botReply(() => push(botText(`${gone} 뺐어요.`), resume()));
        } else if (stage === "cart") showCart(fewer, `${gone} 뺐어요.`);
        else showOrderCard(fewer, [botText(`${gone} 뺐어요.`)]);
        return true;
      }
    }
    const removed = withObjectParticle(targets.map((i) => itemText(bag.items[i])).join(", "));
    const next = withItems(bag, bag.items.filter((_, i) => !targets.includes(i)));
    if (resume) {
      cartRef.current = next.items.length ? next : null; // 묻던 질문(수량·맛)은 그대로 이어 간다
      botReply(() => push(botText(`${removed} 뺐어요.`), resume()));
      return true;
    }
    if (!next.items.length) {
      startFresh();
      setStage("idle");
      botReply(() => push(botText(`${removed} 뺐어요. 담은 메뉴가 없어서 주문을 접었어요.\n다른 게 필요하면 말씀해 주세요!`)));
      return true;
    }
    if (stage === "cart") showCart(next, `${removed} 뺐어요.`);
    else showOrderCard(next, [botText(`${removed} 뺐어요.`)]);
    return true;
  }

  // "간장치킨 말고 양념치킨으로", "치즈볼 대신 감자튀김": 담긴 앞 메뉴를 빼고 뒤 메뉴를 담는다. 바꾸는 말이 아니면 false
  function replaceInCart(text: string, bag: Order): boolean {
    const word = /말고|대신|빼고|바꿔|바꾸|변경/.exec(text);
    if (!word) return false;
    const named = menusNamedIn(text);
    const inBag = (n: { item: DeliveryItem }) => bag.items.some((l) => l.item === n.item.name);
    // 바꿀 메뉴: 장바구니에 없는 메뉴 (말고·대신·빼고 뒤에 말한 것, 아니면 "양념치킨으로 바꿔줘"처럼 하나만 말한 것)
    const to = named.find((n) => n.start > word.index && !inBag(n)) ?? (named.length === 1 && !inBag(named[0]) ? named[0] : undefined);
    if (!to || to.item.restaurantId !== bag.storeId) return false;
    // 뺄 메뉴: 말한 담긴 메뉴, 말하지 않았으면 마지막에 담은 메뉴
    const from = named.filter((n) => n !== to && inBag(n)).at(-1);
    const at = from ? bag.items.findIndex((l) => l.item === from.item.name) : bag.items.length - 1;
    const item = availableDeliveryMenu().find((d) => d.id === to.item.id);
    if (at < 0 || !item) return false;
    const old = bag.items[at];
    const said = parseQuantity(to.part);
    const qty = qtyInRange(said) ? said : old.unit === item.unit ? old.qty : 1;
    const rest = replaceItem(bag, at);
    setCart(rest.items.length ? rest : null);
    setPendingItem(null);
    setChoosing(null);
    queueRef.current = [];
    notesRef.current = { added: [], notes: [`${withObjectParticle(itemText(old))} 뺐어요.`] };
    backToOrderRef.current = stage === "confirm";
    startOrder(item, qty);
    return true;
  }

  // "3개로 해줘": 마지막에 담은 메뉴(또는 이름을 말한 메뉴)의 수량을 바꾼다. 수량 바꾸는 말이 아니면 false
  function changeCartQty(text: string, bag: Order): boolean {
    const n = parseQuantity(text);
    if (n === undefined) return false;
    if (/더|추가|또\s/.test(text)) return false; // "소떡소떡 하나 더": 더 담는 말
    const typed = squash(text);
    const named = bag.items.filter((l) => typed.includes(squash(l.item)) || findDeliveryItems(text, bag.storeId).some((d) => d.name === l.item));
    // 같은 세트가 맛이 겹쳐 두 줄로 담겼으면 한 메뉴로 본다 (줄을 다 빼고 그 수만큼 맛을 다시 고른다)
    const sameSet = named.length > 1 && named.every((l) => l.item === named[0].item && l.choices?.length);
    const target = named.length === 1 || sameSet ? named[0] : named.length === 0 ? bag.items.at(-1) : undefined;
    if (!target) return false;
    // 담긴 메뉴 이름을 말했으면 "로/으로"나 "바꿔"가 있을 때만 수량을 바꾼다 ("간장치킨 1마리로").
    // 없으면("간장치킨 2마리") 그만큼 더 담는다 (아래에서 메뉴를 담는 흐름으로)
    if (named.length && !QTY_CHANGE.test(withoutNames(text, bag.items.map((l) => l.item)))) return false;
    const item = availableDeliveryMenu().find((d) => d.restaurantId === bag.storeId && d.name === target.item);
    if (!item) return false;
    // 수량 표현("2세트")을 빼고도 장바구니에 없는 다른 메뉴가 걸리면 수량 바꾸기가 아니라 더 담는 말이다 ("세트"가 세트 메뉴 키워드라도)
    // (메뉴 이름을 다 말했으면 "2마리 치킨 세트 2세트로"의 "치킨"처럼 이름 속 낱말이 다른 메뉴에 걸려도 그 메뉴의 수량 바꾸기다)
    if (!typed.includes(squash(target.item)) && findDeliveryItems(withoutQuantity(text, item.unit)).some((d) => !bag.items.some((l) => l.item === d.name))) return false;
    if (!qtyInRange(n)) {
      botReply(() => push(botText(rangeLead(item)), ...(stage === "confirm" ? [{ role: "bot", kind: "confirm" } as NewMessage] : [])));
      return true;
    }
    const at = bag.items.indexOf(target);
    // 세트 메뉴는 고를 맛 수가 바뀌므로 그 줄을 빼고 맛부터 다시 고른다 (고르면 다시 담긴다)
    if (item.choice) {
      const rest = sameSet ? withItems(bag, bag.items.filter((l) => l.item !== target.item)) : replaceItem(bag, at);
      setCart(rest.items.length ? rest : null);
      backToOrderRef.current = stage === "confirm";
      startOrder(item, n);
      return true;
    }
    const next = replaceItem(bag, at, makeOrderItem(item, n));
    const note = `${bag.items.length > 1 ? `${item.name} ` : ""}수량을 ${withRoParticle(`${n}${item.unit}`)} 바꿨어요.`;
    if (stage === "cart") showCart(next, note);
    else showOrderCard(next, [botText(note)]);
    return true;
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
    // 일시 중지 중인 곳은 오늘 예약만 받지 않는다 (날짜 버튼·달력에서 오늘이 빠진다).
    // "오늘"이라고 말했으면 날짜를 다시 물을 때 같은 안내가 나오므로 여기서는 뺀다
    const askedToday = !!slots.date && pausedToday(restaurant, slots.date, new Date());
    const pausedNote: NewMessage[] =
      storePausedUntil(restaurant.id) && !askedToday ? [botText(`${withTopicParticle(restaurant.name)} 오늘 예약을 잠시 받지 않아요. 내일 이후 날짜로 도와드릴게요.`)] : [];
    proceedReservation({ restaurant, ...slots }, [{ role: "bot", kind: "restaurantPicked", restaurant }, ...pausedNote, ...lead]);
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
        const { date, time, people } = draft;
        const done = reservationDoneCard({ restaurant, date, time, people });
        setRsv(null);
        setStage("idle");
        // 서버가 받은 뒤에 완료로 보여 준다 (로그인했으면 그 사람 이름으로, 아니면 비회원으로 남는다).
        // 그사이 가게가 일시 중지했거나 연결이 끊기면 완료 대신 그 이유를 알려 준다
        botReplyAsync(async () => {
          await addReservation({ restaurantId: restaurant.id, restaurantName: restaurant.name, date, time, people });
          return () => push({ role: "bot", kind: "info", card: done });
        });
        return;
      }
    }

    if (isNo(text) && !hasSlots(extra)) {
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
            : check === "paused"
              ? `${withTopicParticle(restaurant.name)} 오늘 예약을 잠시 받지 않아요.`
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
    const generation = conversationRef.current;
    work()
      .catch((e: unknown) => () => push(botText(e instanceof Error && e.message ? e.message : "잠시 후 다시 시도해 주세요.")))
      .then((apply) => {
        // 기다리는 동안 "새 대화"로 대화를 비웠으면 이 답은 버린다
        if (generation !== conversationRef.current) return;
        later(() => {
          setThinking(false);
          apply();
        }, 600);
      });
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

  // "주문 취소할래": 가게가 아직 준비를 시작하지 않은(입금 대기·접수) 주문만 취소할 수 있다
  function askCancelOrder() {
    botReplyAsync(async () => {
      const latest = (await fetchMyOrders()).find((o) => o.status !== "취소");
      if (!latest) return () => push(botText("취소할 주문이 없어요."));
      if (latest.status !== "입금 대기" && latest.status !== "접수") {
        const why = latest.status === "완료" ? "이미 배달이 끝나서" : "가게에서 이미 준비를 시작해서";
        return () => push(botText(`${orderLabel(latest)} 주문은 ${why} 취소할 수 없어요.\n가게에 직접 문의해 주세요.`));
      }
      return () => {
        setCancelTarget(latest);
        setStage("cancelConfirm");
        push(
          botPrompt({
            text: `${orderLabel(latest)} 주문을 취소할까요?`,
            say: `${orderLabel(latest)} 주문을 취소할까요? 취소할게요 또는 그대로 둘게요라고 말씀해 주세요.`,
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
    // "취소 안 할래", "취소 말고", "아니요", "그대로 둘게요"는 그대로 두기. "그냥 취소해줘"처럼 취소가 분명하면 취소
    const cancelWord = /취소/.test(text);
    const negated = /(안\s?할|안\s?해|말고|하지\s?마|취소\s?안)/.test(text);
    const keep = negated || (!cancelWord && /아니|그대로|유지|됐어|싫어|그냥/.test(text));
    if (!keep && !isYes(text) && !cancelWord) {
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
      // 입금 전(입금 대기)이면 돌려받을 돈이 없다. 입금이 확인된 뒤(접수)면 환불은 가게가 직접 해 준다 (계좌이체라 자동 환불이 없다)
      return () =>
        push(
          botText(
            target.status === "입금 대기"
              ? "주문을 취소했어요.\n아직 입금 전이라 따로 하실 일은 없어요."
              : `주문을 취소했어요.\n입금하신 금액은 ${target.order.store.name}에서 돌려드려요. 환불이 늦어지면 가게에 문의해 주세요.`,
          ),
        );
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
      // 지난 주문의 메뉴들을 지금 메뉴 목록·가격으로 다시 담는다 (메뉴가 하나고 새로 말한 수량이 있으면 그 수량).
      // 세트 메뉴는 지난번에 고른 맛 그대로 (수량이 바뀌었거나 그 맛이 메뉴에서 빠졌으면 맛부터 다시 고른다)
      const { lines, gone, repick } = rebuildLines(last.storeId, last.order.items, parseQuantity(text));
      if (!lines.length && !repick) {
        const name = gone[0]?.name ?? "지난번 메뉴";
        return () => {
          if (!tryDelivery(name)) push(botPrompt({ ...deliveryPrompt(), text: `${withTopicParticle(name)} 지금 주문할 수 없어요.\n대신 이런 메뉴는 어떠세요?` }));
        };
      }
      // 지금 계정의 배달지로 보낸다 (로그인이나 배달지가 없으면 그 안내에서 멈춘다)
      return () => {
        startFresh();
        const base = storeOrder(last.storeId, lines, deliveryInfo());
        if (deliveryBlocked({ ...(repick ? { itemId: repick.item.id, qty: repick.qty } : {}), ...resumeCartOf(base) }) || !hasDelivery(myDelivery)) return;
        setCart(lines.length ? base : null);
        if (repick) {
          push(...goneNote(gone));
          startOrder(repick.item, repick.qty);
          return;
        }
        setLastItem(lastItemOf(base));
        setCart(base);
        setStage("confirm");
        push(...goneNote(gone), botText(`지난번에 드신 ${withRoParticle(orderItemText(base))} 주문서를 만들었어요.`), { role: "bot", kind: "order", order: base });
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
    // 버튼 이름("예약하기")을 "추천해요"로 읽지 않도록 소리·자막 문장은 따로 둔다
    const say = delivers ? "예약하거나 배달 주문할 수 있어요. 어떻게 해 드릴까요?" : "예약을 도와드릴까요?";
    botReply(() => push({ role: "bot", kind: "info", card: storeInfoCard(r, new Date()) }, botPrompt({ text: next, say, choices })));
  }

  // 오늘의 메뉴와 할인 중인 메뉴 ("할인하는 거 있어?", "오늘의 메뉴 뭐야?")
  function showDeals() {
    const deals = popularFirst(availableDeliveryMenu()).filter((d) => d.special || d.discountPct);
    startFresh(true); // 담아 둔 메뉴는 그대로 (다른 가게 메뉴를 고르면 새로 시작할지 묻는다)
    setStage("menu");
    if (deals.length === 0) {
      botReply(() => push(botPrompt({ ...deliveryPrompt(), text: "지금 진행 중인 할인이나 오늘의 메뉴는 없어요.\n대신 이런 메뉴는 어떠세요?" })));
      return;
    }
    const lines = deals.map((d) => `${d.special ? "오늘의 메뉴 " : ""}${d.name} ${priceText(d)}`);
    botReply(() =>
      push(
        botPrompt({
          ...pickDeliveryPrompt(deals),
          text: "오늘의 메뉴와 할인 중인 메뉴예요!\n마음에 드는 걸로 골라 주세요.",
          say: `오늘의 메뉴와 할인 중인 메뉴예요! ${lines.join(". ")}. 마음에 드는 걸로 말씀해 주세요.`,
        }),
      ),
    );
  }

  // 시간대에 어울리고 많이 주문된 메뉴를 추천한다 ("배고파", "뭐 먹지", "메뉴 뭐 있어")
  function showRecommendations() {
    const now = new Date();
    const word = MEAL_WORD[mealOf(now)];
    const items = recommendItems(now);
    const canReorder = session?.role === "user"; // 지난 주문은 로그인한 고객님 계정에만 있다
    startFresh(true); // 담아 둔 메뉴는 그대로
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
          placeholder: items[0] ? `예) ${items[0].name}` : undefined, // 지금 권하는 첫 메뉴
          menu: items,
        }),
      ),
    );
  }

  // 음성으로 들은 문장. 글자 입력과 같다
  function handleVoice(text: string) {
    if (thinking) {
      setNotice("답하는 중이에요. 잠시 뒤 다시 말씀해 주세요.");
      return;
    }
    setMenuOpen(false);
    handle(text);
  }

  // 받아들였으면 true. 봇이 답하는 중이면 받지 않는다 (입력창의 글은 그대로 남긴다)
  function handle(raw: string): boolean {
    const text = raw.trim();
    if (!text || thinking) {
      if (text && thinking) setNotice("답하는 중이에요. 잠시 뒤 다시 보내 주세요.");
      return false;
    }
    push({ role: "user", text });
    handleAccepted(text);
    return true;
  }

  function handleAccepted(text: string) {
    // 문의 안내의 "문의하러 가기" 버튼: 해시 주소라 주소만 바꾸면 그 화면으로 간다
    if (text === INQUIRY_CHOICE.value && session && session.role !== "admin") {
      window.location.assign("#/inquiry");
      return;
    }

    // "치킨집 예약", "근처 맛집": 메뉴 이름(치킨)이 들어 있어도 식당·예약 말이면 배달이 아니라 식당 찾기로 본다
    const wantsRestaurant = menuIntent(text) === "식당";
    // 담는 중·주문 확인 단계에서 빠른 메뉴(배달·식당 등)를 고르거나 식당·예약 얘기를 하면 주문을 접고 아래 일반 처리로 넘어간다
    const switchingMenu = (stage === "confirm" || stage === "cart" || stage === "switchStore") && (!!quickMenuReply(text) || wantsRestaurant);
    const bag = cart();

    // 로그인하러 갈지, 계정 관리로 갈지 묻는 중. 가겠다는 말이면 가고, 다른 말이면 아래 일반 처리로
    if (stage === "needLogin" || stage === "needContact") {
      const login = stage === "needLogin";
      const go = text === (login ? LOGIN_CHOICE : ACCOUNT_CHOICE).value || isYes(text) || (login ? /로그인|가입/ : /계정|등록|배달지|주소|연락처|전화/).test(text);
      if (go) {
        // 해시 주소라 주소만 바꾸면 그 화면으로 간다 (헤더의 계정 링크와 같다)
        window.location.assign(login ? "#/login" : "#/account");
        return;
      }
      setStage("idle");
    }

    // "처음에 선택했던 메뉴로 주문할게", "아까 취소한 거 다시": 이번 대화에서 보여 드린 주문서를 메뉴·수량·고른 맛 그대로 다시 만든다.
    // "처음"이면 맨 처음 주문서, 아니면 지금 보고 있는 것 바로 전 주문서
    const earlier = refersToEarlierOrder(text);
    if (earlier) {
      // 보여 드린 주문서와 장바구니 (같은 주문서가 장바구니로도 주문서로도 나왔으면 한 번만)
      const snaps = messages
        .flatMap((m) => (m.role === "bot" && (m.kind === "order" || m.kind === "cart") ? [{ order: m.order, midway: m.kind === "cart" && !!m.midway }] : []))
        .filter((x, i, all) => all.findIndex((y) => y.order === x.order) === i);
      // 바로 다음 모습이 이 모습에 메뉴를 더 담기만 한 것이면 담는 도중이라 뺀다 (수량을 바꾸거나 뺀 모습은 되살릴 수 있다)
      const drafts = snaps.filter((_, i) => !snaps[i + 1]?.midway).map((x) => x.order);
      const draft = earlier.first ? drafts[0] : drafts.filter((o) => o !== cart()).at(-1);
      if (draft) {
        restoreOrder(draft, text, earlier.first);
        return;
      }
      // 되살릴 다른 주문서가 없는데 담는 중이면 지금 담은 메뉴를 그대로 보여 준다 (방금 담은 메뉴를 버리지 않게)
      if (bag?.items.length) {
        showCart(bag, "지금 담아 두신 메뉴예요.");
        return;
      }
    }

    // 담아 둔 배달 메뉴가 있으면 어느 단계에서든(식당 찾기·예약 중에도) "장바구니", "담은 거 보여줘"로 다시 본다
    if (bag?.items.length && stage !== "cart" && stage !== "confirm" && CART_WORDS.test(text) && findDeliveryItems(text).length === 0) {
      startFresh(true);
      showCart(bag, "담아 두신 메뉴예요.");
      return;
    }

    // 다른 가게 메뉴를 말해 "담은 것을 비우고 새로 시작할까요?"라고 묻는 중
    if (stage === "switchStore" && pendingSwitch && bag && !switchingMenu) {
      const keep = /아니|그대로|둘게|말고|취소/.test(text);
      if (!keep && (isYes(text) || /새로|비우/.test(text))) {
        setPendingSwitch(null);
        setCart(null);
        if (pendingSwitch.lines) addNamed(pendingSwitch.lines, pendingSwitch.text);
        else deliverItems(pendingSwitch.items, pendingSwitch.text);
        return;
      }
      if (keep) {
        setPendingSwitch(null);
        showCart(bag, "담은 메뉴 그대로 둘게요.");
        return;
      }
      botReply(() => push(botText("담은 것을 비우고 새로 시작할까요? '새로 시작' 또는 '그대로'로 답해 주세요.")));
      return;
    }

    // 담는 중("더 담을까요?")이거나 주문서를 보는 중: 메뉴를 더 담거나 빼거나 수량을 바꾸거나, 주문으로 넘어간다
    if ((stage === "cart" || stage === "confirm") && bag && !switchingMenu) {
      const inCart = stage === "cart";
      // "주소 바꿔줘", "연락처 바꿀래": 배달지·연락처는 계정 관리에서 바꾼다. 바꾸고 돌아오면 담은 메뉴 그대로 주문서를 다시 만든다
      const change = deliveryChange(text);
      if (change) {
        sendAway(
          "account",
          `${change === "address" ? "배달지" : "연락처"}는 계정 관리에서 바꿀 수 있어요.\n바꾸고 돌아오시면 같은 메뉴로 주문서를 다시 만들어 드릴게요.`,
          resumeCartOf(bag),
        );
        return;
      }
      const namesMenu = findDeliveryItems(text).length > 0;
      // "얼마야?", "다 해서 얼마": 합계를, 메뉴 이름을 말했으면 그 메뉴 값을 알려 주고 묻던 것을 다시 묻는다
      if (PRICE_ASK.test(text)) {
        answerPrice(text, bag, inCart);
        return;
      }
      // 메뉴 이름 없이 "하나 더", "두 개 더": 마지막에 담은 메뉴를 그만큼 더 담는다. "추가", "더"만 말하면 그 가게 메뉴를 보여 준다
      if (!namesMenu && /더|추가|또/.test(text) && !MORE_NEGATED.test(text)) {
        const n = parseQuantity(text);
        const last = lastItemOf(bag);
        if (n !== undefined && last) {
          if (!qtyInRange(n)) botReply(() => push(botText(rangeLead(last))));
          else startOrder(last, n);
          return;
        }
        if (n === undefined && /^\s*(추가|더)\s*(요|해\s?줘|줘|할게요?|할래요?)?\s*[.!?~]*\s*$/.test(text)) {
          showMoreMenu(bag);
          return;
        }
      }
      // "더 담기", "더 시킬게": 그 가게 메뉴를 보여 준다 (주문서를 보는 중에도. 메뉴 이름을 같이 말했으면 아래에서 바로 담는다. "더 담을 거 없어"는 아니다)
      if (MORE.test(text) && !MORE_NEGATED.test(text) && !namesMenu) {
        showMoreMenu(bag);
        return;
      }
      // "간장치킨 말고 양념치킨으로": 바꿔 담는다
      if (replaceInCart(text, bag)) return;
      // "족발 빼줘": 그 메뉴만 뺀다. "3개로 해줘": 수량을 바꾼다 ("해줘"가 들어 있어도 '응'보다 먼저 본다)
      if (removeFromCart(text, bag)) return;
      // 메뉴 이름 없이 "다 빼줘", "전부 지워", "장바구니 비워줘": 모두 비운다
      if (!namesMenu && /(다|전부|모두|싹|전체)\s?(빼|지워|삭제|없애|취소)|비워|비우/.test(text)) {
        cancelAll();
        return;
      }
      if (changeCartQty(text, bag)) return;
      // 가게 정보("청전 치킨공방 영업시간")·가게 정보의 "배달 주문" 버튼("청전 치킨공방 배달"): 가게 이름 속 "치킨"을 메뉴로 보기 전에 받는다.
      // 답만 하는 가게 정보 뒤에는 담던 단계(더 담을까요?·주문할까요?)를 그대로 이어 간다 ('응'이면 다음으로)
      const storeAsk = detectIntent(text) === "storeInfo";
      const storeOrderAsk = !!restaurantNamed(text) && menuIntent(text) === "배달";
      if (storeAsk || storeOrderAsk) {
        const back = stage;
        routeGeneral(text);
        if (storeAsk && (!!restaurantNamed(text) || (refersToPlace(text) && !!lastPlace))) setStage(back);
        return;
      }
      // "떡볶이도 추가", "소떡소떡 하나 더", 메뉴 이름만: 그 메뉴를 더 담는다 (수량·맛을 묻는 흐름 그대로)
      if (findDeliveryItems(text).length > 0) {
        tryDelivery(text);
        return;
      }
      // "취소": 담은 것을 모두 비운다 (메뉴 이름을 같이 말했으면 위에서 그 메뉴만 뺐다)
      if (/취소/.test(text)) {
        cancelAll();
        return;
      }
      // "지난번 메뉴 다시 주문해줘", "아까 그거 하나 더": '주문해줘'가 들어 있어도 지금 장바구니를 주문하는 말이 아니다
      const intent = detectIntent(text);
      if (intent === "reorder" || refersToItem(text)) {
        routeGeneral(text);
        return;
      }
      // 담는 중: "그만 담을게", "더 안 시킬게", "이제 됐어", "아니"는 더 담지 않겠다는 말(주문서로). 주문서를 보는 중에는 '응'만 주문한다
      const done = isYes(text) || (inCart && (DONE_ADDING.test(text) || isNo(text)));
      if (!done && DROP_ALL.test(text)) {
        cancelAll();
        return;
      }
      if (!done && !inCart && isNo(text)) {
        showCart(bag, "주문하지 않고, 담은 메뉴는 그대로 둘게요.\n더 담거나 빼실 수 있어요. 모두 지우려면 '취소'라고 말씀해 주세요.");
        return;
      }
      if (done) {
        // 주문서를 보는 사이에 가게가 일시 중지했으면 주문하지 않는다
        const until = storePausedUntil(bag.storeId ?? "");
        if (until) {
          startFresh();
          setStage("idle");
          botReply(() => push(botText(`${pausedText(bag.store.name, until)}\n이 주문은 접었어요. 다른 메뉴를 주문하시겠어요?`)));
          return;
        }
        if (inCart) showOrderCard(bag);
        else placeOrder(bag);
        return;
      }
      // "내 주문 어디쯤 왔어", "할인하는 거 있어?", "영업시간" 같은 다른 질문에는 답한다 (담은 메뉴는 그대로 둔다)
      if (intent && intent !== "orderCancel") {
        const back = stage;
        routeGeneral(text);
        // 인사처럼 그 자리에서 답만 하는 말이면 담던 단계를 그대로 이어 간다
        if (intent === "greeting" || intent === "thanks") setStage(back);
        return;
      }
      if (inCart) {
        botReply(() =>
          push(
            botPrompt({
              text: `${CART_QUESTION}\n'${CART_MORE}' 또는 '${CART_CHECKOUT}'으로 답해 주세요. 메뉴 이름을 말씀하시면 그 메뉴를 더 담아요.`,
              say: `${CART_QUESTION} ${CART_MORE} 또는 ${CART_CHECKOUT}이라고 말씀해 주세요. 메뉴 이름을 말씀하시면 그 메뉴를 더 담아요.`,
              choices: [
                { label: CART_MORE, value: CART_MORE },
                { label: CART_CHECKOUT, value: CART_CHECKOUT },
              ],
            }),
          ),
        );
      } else {
        botReply(() => push(botText(`${ORDER_CARD_QUESTION} '응' 또는 '취소'로 답해 주세요.`), { role: "bot", kind: "confirm" }));
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

    // 세트 메뉴의 맛 고르는 중: 표에서 고른 맛(버튼)이나 말한 맛 이름이 고를 수만큼이면 주문서로. 모자라거나 넘치면 다시 고르게 한다
    if (stage === "choose" && choosing) {
      const c = choosing.item.choice!;
      const need = c.count * choosing.qty;
      const found = matchChoices(text, c.options);
      if (found.length > 0) {
        if (found.length === need) {
          startOrder(choosing.item, choosing.qty, found);
          return;
        }
        const lead = found.length < need ? `${need}가지를 골라 주세요. 지금 ${found.length}가지를 말씀하셨어요.` : `${need}가지만 고를 수 있어요.`;
        botReply(() => push(choicePrompt(choosing.item, choosing.qty, lead)));
        return;
      }
      // 맛을 고르는 중에 "치즈볼 빼줘": 담아 둔 메뉴에서 빼고, 맛 고르기를 다시 보여 준다
      const held = cart();
      if (held?.items.length && removeFromCart(text, held, () => choicePrompt(choosing.item, choosing.qty))) return;
      if (held?.items.length && DONE_ADDING.test(text) && findDeliveryItems(text).length === 0) {
        skipToOrder(held);
        return;
      }
      if (isNo(text)) {
        cancelDelivery();
        return;
      }
      if (!quickMenuReply(text) && findDeliveryItems(text).length === 0 && !detectIntent(text)) {
        botReply(() => push(choicePrompt(choosing.item, choosing.qty, `어떤 ${withObjectParticle(c.label)} 드실지 잘 모르겠어요.`)));
        return;
      }
      setChoosing(null);
    }

    // 배달 수량: 숫자만 오면 그 수량으로 주문서를 만든다. 다른 메뉴를 말하면 아래 일반 처리에서 메뉴부터 다시 받는다
    if (stage === "qty" && pendingItem) {
      // 수량을 묻는 중에 "치즈볼 빼줘": 담아 둔 메뉴에서 빼고, 묻던 수량을 다시 묻는다
      const held = cart();
      if (held?.items.length && removeFromCart(text, held, () => deliveryQty(pendingItem))) return;
      const qty = parseQuantity(text);
      // "1세트"처럼 단위가 메뉴 키워드("세트")와 같아도 수량으로 본다. 수량 표현을 빼고도 다른 메뉴가 걸릴 때만 메뉴를 다시 받는다
      if (qty !== undefined && findDeliveryItems(withoutQuantity(text, pendingItem.unit)).every((d) => d.id === pendingItem.id)) {
        if (qtyInRange(qty)) startOrder(pendingItem, qty);
        else botReply(() => push(deliveryQty(pendingItem, rangeLead(pendingItem))));
        return;
      }
      if (held?.items.length && DONE_ADDING.test(text) && findDeliveryItems(text).length === 0) {
        skipToOrder(held);
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

    // 배달 메뉴 고르는 중 ("더 담기"로 왔으면 담은 메뉴가 있다)
    if (stage === "menu") {
      // 식당·예약 말이나 가게 이름("청전 치킨공방 영업시간")이 있으면 아래 일반 처리가 그 가게 기준으로 다룬다
      if (!wantsRestaurant && !restaurantNamed(text) && tryDelivery(text)) return;
      if (bag?.items.length) {
        // 더 담지 않겠다는 말이면 담은 메뉴로 주문서를, "취소"·"그만할래"면 모두 비운다
        if (/취소/.test(text) || (DROP_ALL.test(text) && !DONE_ADDING.test(text))) {
          cancelAll();
          return;
        }
        if (isNo(text) || DONE_ADDING.test(text)) {
          showOrderCard(bag, [botText("그럼 담은 메뉴로 주문서를 보여 드릴게요.")]);
          return;
        }
      }
      if (isNo(text)) {
        cancelDelivery();
        return;
      }
      // "응", "좋아": 아직 고른 메뉴가 없으니 ("배달이 어려워요"가 아니라) 보여 드린 메뉴 중에서 골라 달라고 한다
      if (isYes(text)) {
        const lastBot = messages.at(-1);
        const shown = lastBot?.role === "bot" && lastBot.kind === "text" && lastBot.menu?.length ? lastBot.menu : undefined;
        const ask = "어떤 메뉴로 할지 골라 주세요.";
        botReply(() => push(botPrompt({ ...(shown ? pickDeliveryPrompt(shown) : deliveryPrompt()), text: `${ask}\n이름을 말씀하시거나 아래에서 눌러 주세요.`, say: `${ask} 이름을 말씀하시거나 아래에서 눌러 주세요.` })));
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
        const pick = foodsForMeal(meal)[0] ?? foodsOnOffer()[0] ?? FOODS[0];
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
    // 담아 둔 배달 메뉴가 있을 때 (식당 예약·가게 정보를 보고 돌아왔을 때): "장바구니"·"응"은 담은 메뉴를, "이대로 주문"·"주문할게"는 주문서를 보여 준다
    const held = cart();
    if (held?.items.length && !place && menu !== "식당" && findDeliveryItems(text).length === 0 && intent !== "reorder") {
      if (/이대로|주문(할|해|하자|하고)|결제/.test(text)) return showOrderCard(held);
      if (CART_WORDS.test(text) || isYes(text)) return showCart(held, "담아 두신 메뉴예요.");
    }
    // "아까 그거 하나 더": 이번 대화에서 말한 메뉴, 없으면 지난 주문
    if (refersToItem(text) && lastItem) {
      // 담아 둔 메뉴는 그대로 두고 그 메뉴를 더 담는다
      startFresh(true);
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

    // 가게 이름을 말했으면: 배달 메뉴가 있는 가게는 예약 말(예약·식당, 날짜·시간·인원)이 없으면 그 가게 메뉴를, 아니면 그 가게 예약
    if (place) {
      // "장락 옛날통닭 내일 7시 예약": 예약·식당 말이 있으면 가게 이름 속 메뉴 이름(옛날통닭)보다 예약을 먼저 본다
      const wantsBooking = menu === "식당";
      // 일시 중지 중인 가게에 배달을 청하면 이유를 말하고 같은 음식의 다른 가게 메뉴를 권한다 (예약은 아래에서 내일 이후로)
      const paused = storePausedUntil(place.id);
      const placeItemNamed = deliveryMenu().some((d) => d.restaurantId === place.id && squash(text).includes(squash(d.name)));
      if (!wantsBooking && paused && (menu === "배달" || placeItemNamed)) {
        startFresh(true);
        const sameFood = availableDeliveryMenu().filter((d) => restaurantById(d.restaurantId).food === place.food);
        offerInstead(pausedText(place.name, paused), sameFood.length ? sameFood : availableDeliveryMenu());
        return;
      }
      const storeMenu = availableDeliveryMenu().filter((d) => d.restaurantId === place.id);
      const named = findDeliveryItems(text, place.id); // 그 가게 메뉴 중에서 ("못말리는파닭 간장" → 간장 파닭을 고를 수 있는 메뉴)
      if (!wantsBooking && storeMenu.length && (named.length || menu === "배달" || !hasSlots(slots))) {
        startFresh(true); // 다른 가게 메뉴면 deliverItems 가 새로 시작할지 묻는다
        setLastPlace(place);
        deliverItems(named.length ? named : storeMenu, text);
        return;
      }
      const lead = keptNote();
      startFresh(true);
      beginReservation(place, { ...rsvSlots, ...slots }, lead);
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
      const lead = keptNote();
      startFresh(true);
      setRsvSlots(slots);
      showRestaurants("", nearestRestaurants(), { lead, heading: "가장 가까운 곳들이에요!\n마음에 드는 곳을 고르시면 예약을 도와드릴게요." });
      return;
    }

    // "중식 식당 예약해줘": 식당 말과 음식 종류를 같이 말했으면 바로 근처 식당 추천으로
    if (menu === "식당") {
      if (food) {
        const lead = keptNote();
        startFresh(true);
        setRsvSlots(slots);
        showRestaurants(food.label, nearbyRestaurants(food.key), { lead });
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
      // 그 음식을 파는 근처 가게도 없으면 "대신 맛집에서" 대신 배달이 안 된다는 말만 하고, 가게가 없다는 안내로 이어진다
      const offer = hasStoresFor(food.key) ? `\n대신 근처 ${food.label} 맛집에서 드시는 건 어때요?` : "";
      showRestaurants(food.label, nearbyRestaurants(food.key), {
        lead: [botText(`${withTopicParticle(word)} 아직 배달이 안 돼요.${offer}`)],
      });
      return;
    }

    if (menu === "배달") {
      startMenu("배달");
      return;
    }

    // "한식 먹고 싶어": 배달 메뉴에는 없는 음식 종류만 말했으면 근처 식당 추천으로
    if (food) {
      const lead = keptNote();
      startFresh(true);
      setRsvSlots(slots);
      showRestaurants(food.label, nearbyRestaurants(food.key), { lead });
      return;
    }

    if (intent === "deals") return showDeals();
    // "문의할래", "고객센터": 관리자에게 문의하는 화면으로 안내한다 (답을 받으려면 로그인해야 한다)
    if (intent === "inquiry") {
      startFresh();
      if (!session || session.role === "admin") {
        setStage("needLogin");
        botReply(() => push(botPrompt({ text: "관리자에게 문의는 로그인한 뒤에 남길 수 있어요.\n답변을 받을 계정이 필요해요.", choices: [LOGIN_CHOICE], noDirect: true })));
        return;
      }
      setStage("idle");
      const text = "관리자에게 문의를 남기시면 확인하고 답해 드려요.\n아래 버튼을 누르면 문의 화면으로 가요.";
      botReply(() => push(botPrompt({ text, say: text.replace("\n", " "), choices: [INQUIRY_CHOICE], noDirect: true })));
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

  // 담아 둔 배달 메뉴가 있는데 식당 찾기·예약으로 넘어갈 때 알려 줄 말 (메뉴는 지우지 않는다)
  const keptNote = (): NewMessage[] =>
    cart()?.items.length ? [botText("담아 두신 배달 메뉴는 그대로 둘게요. 나중에 '장바구니'라고 말씀하시면 다시 보여 드려요.")] : [];

  // 진행 중이던 주문·예약을 접고 처음부터. keepCart 가 아니면 담은 메뉴도 비운다
  function startFresh(keepCart = false) {
    setPendingItem(null);
    setPendingQty(null);
    setChoosing(null);
    if (!keepCart) setCart(null);
    setPendingSwitch(null);
    queueRef.current = [];
    backToOrderRef.current = false;
    notesRef.current = { added: [], notes: [] };
    setRsv(null);
    setRsvSlots({});
    setCancelTarget(null);
  }

  // 배달·식당의 첫 질문으로. 식당도 배달처럼 바로 추천 목록(카드)을 보여 주고, 다른 음식을 말하면 그 음식 맛집으로 바꾼다
  function startMenu(menu: "배달" | "식당") {
    if (menu === "식당") {
      const lead = keptNote();
      startFresh(true);
      // 카드 아래에는 음식 종류 버튼을 붙여 눌러서 그 음식 맛집으로 바로 갈 수 있게 한다
      showRestaurants("", recommendRestaurants(new Date()), {
        lead,
        heading: RESTAURANT_PICKS_HEADING,
        choices: FOOD_PROMPT.choices,
        placeholder: FOOD_PROMPT.placeholder,
        delay: 700,
      });
      return;
    }
    if (deliveryBlocked({})) return;
    // 담아 둔 메뉴가 있으면 비우지 않고 그 가게 메뉴를 보여 준다 ("배달" 빠른 메뉴를 눌러도 장바구니가 사라지지 않게)
    const bag = cart();
    if (bag?.items.length) {
      startFresh(true);
      showMoreMenu(bag);
      return;
    }
    const reply = menuReply(menu)!;
    startFresh();
    setStage(reply.next);
    botReply(() => push(botPrompt(reply)));
  }

  // 주문서를 확인하면 계좌이체 주문으로 넣는다. 서버가 그 매장의 입금 계좌와 입금 기한을 붙여 돌려주면 입금 안내를 보여 준다.
  // 그사이 가게가 일시 중지했거나 품절됐거나 입금 계좌가 없으면 서버가 거절하므로 그 이유를 알린다
  function placeOrder(placed: Order) {
    setCart(null);
    setStage("done");
    botReplyAsync(async () => {
      // 주문 직전에 매장 설정·메뉴를 새로 받아, 주문서를 보는 사이 가격이 바뀌었으면 주문하지 않고 바뀐 금액으로 다시 확인받는다
      await refresh(["settings", "menu"]).catch(() => undefined);
      const fresh = repriced(placed);
      if (fresh && fresh.price !== placed.price) {
        return () => {
          setCart(fresh);
          setStage("confirm");
          push(botText("그사이 가격이 바뀌었어요. 바뀐 금액으로 다시 확인해 주세요."), { role: "bot", kind: "order", order: fresh });
        };
      }
      try {
        const rec = await addOrder(placed);
        return () => push({ role: "bot", kind: "info", card: transferCard(rec) });
      } catch (e) {
        const why = e instanceof Error && e.message ? e.message : "잠시 후 다시 시도해 주세요.";
        // 서버가 거절하면(그사이 품절·일시 중지 등) 매장 설정·메뉴를 새로 받아, 지금 담을 수 있는 메뉴는 장바구니에 그대로 남긴다
        await refresh(["settings", "menu"]).catch(() => undefined);
        return () => {
          const head = botText(`${why}\n주문이 접수되지 않았어요.`);
          const storeId = placed.storeId ?? "";
          const { lines, gone, repick } = storePausedUntil(storeId) ? { lines: [], gone: [], repick: undefined } : rebuildLines(storeId, placed.items);
          if (!lines.length && !repick) {
            setStage("idle");
            push(head);
            return;
          }
          const info = placed.address && placed.phone ? { address: placed.address, phone: placed.phone } : deliveryInfo();
          const kept = storeOrder(storeId, lines, info);
          setCart(lines.length ? kept : null);
          if (repick) {
            push(head, ...goneNote(gone));
            startOrder(repick.item, repick.qty);
            return;
          }
          setStage("cart");
          push(head, ...goneNote(gone), { role: "bot", kind: "cart", text: gone.length ? "남은 메뉴는 그대로 담아 두었어요." : "담은 메뉴는 그대로 있어요.", order: kept });
        };
      }
    });
  }

  function reset() {
    conversationRef.current += 1;
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    setMessages(greeting());
    setStage("idle");
    setCart(null);
    setPendingSwitch(null);
    queueRef.current = [];
    notesRef.current = { added: [], notes: [] };
    setThinking(false);
    setManualInputFor(null);
    setPickerOpenFor(null);
    setPendingItem(null);
    setRsv(null);
    setPendingQty(null);
    setRsvSlots({});
    setLastPlace(null);
    setLastItem(null);
    setCancelTarget(null);
    inputRef.current?.focus();
  }

  function closeTutorial() {
    markTutorialSeen();
    setTutorialOpen(false);
  }

  // 안내의 예시 문장을 누르면 안내를 닫고 그 말을 보낸 것처럼 바로 해 본다
  function tryTutorialExample(text: string) {
    closeTutorial();
    handle(text);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMenuOpen(false);
    if (handle(input)) setInput("");
  }

  function pickChoice(promptId: number, choice: Choice) {
    setMessages((prev) =>
      prev.map((m) => (m.id === promptId && m.role === "bot" && m.kind === "text" ? { ...m, picked: choice.value } : m)),
    );
    handle(choice.value);
  }

  // 식당 목록 아래 음식 종류 버튼: 누른 것을 표시하고 그 말을 한 것처럼 처리한다
  function pickRestaurantsChoice(promptId: number, choice: Choice) {
    setMessages((prev) => prev.map((m) => (m.id === promptId && m.role === "bot" && m.kind === "restaurants" ? { ...m, picked: choice.value } : m)));
    handle(choice.value);
  }

  // 채팅창을 끈 동안 표의 줄을 누르면 그 메뉴·식당을 고른 것으로 한다 (말풍선 카드를 누른 것과 같다)
  function pickCaptionRow(messageId: number, index: number) {
    const m = messages.find((x) => x.id === messageId);
    if (m?.role !== "bot") return;
    if (m.kind === "text" && m.menu?.[index]) pickChoice(m.id, { label: m.menu[index].name, value: m.menu[index].name });
    else if (m.kind === "restaurants" && m.list[index]) handle(m.list[index].name);
  }

  // 카운터(예약 인원·배달 수량)에서 고른 수. "3명", "2마리"처럼 입력한 것으로 처리한다
  // 맛 고르기 표에서 "선택 완료": 표를 잠그고, 고른 맛 이름을 손님 말로 보내 같은 처리로 주문서를 만든다
  function pickChoices(promptId: number, names: string[]) {
    setMessages((prev) => prev.map((m) => (m.id === promptId && m.role === "bot" && m.kind === "choices" ? { ...m, picked: names } : m)));
    handle(names.join(", "));
  }

  // 맛 고르기 표 (채팅 말풍선과 채팅창을 끈 동안의 자막 아래에 같은 표를 쓴다)
  function choicePickerFor(messageId: number) {
    const m = messages.find((x) => x.id === messageId);
    if (!m || m.role !== "bot" || m.kind !== "choices") return undefined;
    return (
      <ChoicePicker
        label={m.label}
        need={m.need}
        options={m.options}
        basePrice={m.basePrice}
        active={m.id === activeChoicesId}
        picked={m.picked}
        onPick={(names) => pickChoices(m.id, names)}
      />
    );
  }

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
  // 장바구니의 "더 담기 · 이대로 주문"은 더 담을지 묻는 중인 마지막 장바구니 말풍선에서만
  const activeCartId = stage === "cart" ? lastIdOf(messages, ["cart"]) : undefined;
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
        // 추천 메뉴는 식당 추천과 같은 카드로 보여 주고, 나머지 선택지(식당 찾기·지난번 메뉴 다시 등)는 그 아래 작은 버튼으로
        const menu = m.menu ?? [];
        const others = m.choices.filter((c) => !menu.some((d) => d.name === c.value));
        return (
          <>
            {m.text}
            {menu.length > 0 && (
              <PickCards
                cards={menu.map((d) => menuCard(d))}
                selected={menu.find((d) => d.name === m.picked)?.id}
                disabled={!active}
                onPick={(c) => pickChoice(m.id, { label: c.name, value: c.name })}
              />
            )}
            <div className="choices">
              {others.map((c) => (
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
      case "cart": {
        const active = m.id === activeCartId && !thinking;
        return (
          <>
            {m.text}
            <div>
              <div className="card">
                <dl>
                  {cartCardRows(m.order).map((row, i) => (
                    <Fragment key={i}>
                      <dt>{row.label}</dt>
                      <dd className={row.emphasis ? "price" : undefined}>{row.value}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
              <div style={{ marginTop: 10 }}>{CART_QUESTION}</div>
              <div className="actions">
                <button type="button" disabled={!active} onClick={() => handle(CART_MORE)}>
                  {CART_MORE}
                </button>
                <button className="primary" type="button" disabled={!active} onClick={() => handle(CART_CHECKOUT)}>
                  {CART_CHECKOUT}
                </button>
              </div>
            </div>
          </>
        );
      }
      case "order":
        return (
          <>
            {ORDER_CARD_TITLE}
            <div>
              <div className="card">
                <dl>
                  {orderCardRows(m.order).map((row, i) => (
                    <Fragment key={i}>
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
      case "restaurants":
        return (
          <>
            {m.heading ?? `근처 ${m.foodLabel} 맛집을 추천해요!\n가까운 순서예요. 마음에 드는 곳을 골라 주세요.`}
            <PickCards
              cards={m.list.map((r) => restaurantCard(r, new Date()))}
              selected={m.selected}
              disabled={m.id !== activeRestaurantsId}
              onPick={(c) => handle(c.name)}
            />
            {m.choices && (
              // 배달 추천처럼: 그 질문이 마지막이고 봇이 답하는 중이 아닐 때만 누를 수 있고, 끝에 "직접 입력"
              <div className="choices">
                {m.choices.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={m.picked === c.value ? "selected" : undefined}
                    disabled={m.id !== activeChoicesId}
                    onClick={() => pickRestaurantsChoice(m.id, c)}
                  >
                    {c.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={"direct" + (manualInputFor === m.id ? " selected" : "")}
                  disabled={m.id !== activeChoicesId}
                  aria-pressed={manualInputFor === m.id}
                  onClick={() => openManualInput(m.id)}
                >
                  <DirectInputIcon />
                  직접 입력
                </button>
              </div>
            )}
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
                {m.card.rows.map((row, i) => (
                  <Fragment key={i}>
                    <dt>{row.label}</dt>
                    <dd className={row.emphasis ? "price" : undefined}>
                      {row.tel ? <TelLink phone={row.value} /> : row.copy ? <AccountText value={row.value} /> : row.value}
                      {row.copy && <CopyButton text={row.copy} label="계좌번호 복사" />}
                    </dd>
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
      case "choices":
        return (
          <>
            {m.text}
            {choicePickerFor(m.id)}
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

  // 로그인하러 갔거나 계정 관리로 갔던 고객님이 돌아오면, 고르던 메뉴·수량으로 주문을 이어 간다.
  // 배달지가 아직 없으면 계정 관리 안내부터 다시 한다. 로그인하거나 배달지를 등록한(memberReady 가 바뀐) 그 순간에만 보고,
  // 기억해 둔 주문은 그 순간에 바로 꺼낸다 (그 뒤에 새로 기억한 주문을 잘못 이어 가지 않게. checkedFor 로 한 번만).
  // 이어 가기 직전에 매장 설정(품절·일시 중지)을 새로 받아 온다 (오래된 값이면 그사이 멈춘 가게 메뉴로 주문서를 만들 수 있다).
  // StrictMode 처럼 효과가 바로 정리됐다 다시 돌아도 한 번만 이어 가도록 꺼낸 주문은 ref 에 두고 함께 쓴다
  const resumeOrder = useEffectEvent((resume: ResumeDelivery) => {
    if (!deliveryBlocked(resume)) continueOrder(resume);
  });
  const pendingResume = useRef<ResumeDelivery | null>(null);
  const checkedFor = useRef<string | null>(null);
  const username = member ? session?.username : undefined;
  useEffect(() => {
    if (!username) return;
    const key = `${username}:${memberReady}`;
    if (checkedFor.current !== key) {
      checkedFor.current = key;
      pendingResume.current = takeResume(username) ?? pendingResume.current;
    }
    if (!pendingResume.current) return;
    let cancelled = false;
    void refresh(["settings"]).then(() => {
      if (cancelled) return;
      const resume = pendingResume.current;
      pendingResume.current = null;
      if (resume) resumeOrder(resume);
    });
    return () => {
      cancelled = true;
    };
  }, [memberReady, username]);

  return (
    <div className="app">
      <header>
        {/* 글자 로고 */}
        <h1 className="title">Saylo</h1>
        <div className="header-tools">
          {/* 사용법 안내를 다시 연다 (처음 열 때는 저절로 뜬다) */}
          <button className="icon-btn" type="button" aria-label="사용법 보기" title="사용법 보기" onClick={() => setTutorialOpen(true)}>
            <HelpIcon />
          </button>
          {/* 계정: 비로그인은 로그인 페이지로, 로그인 상태면 내 주문 페이지로 (해시 주소라 링크만으로 이동한다) */}
          <a
            className={"icon-btn" + (session ? " on" : "")}
            href={!session ? "#/login" : session.role === "admin" ? "#/admin" : "#/me"}
            aria-label={!session ? "로그인" : session.role === "admin" ? `${session.name} · 관리자 화면` : `${session.name} · 내 주문`}
            title={!session ? "로그인" : session.role === "admin" ? `${session.name} · 관리자 화면` : `${session.name} · 내 주문`}
          >
            <AccountIcon />
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
        {/* 주문을 서버에 넣는 사이에는 새 대화로 입금 안내를 날리지 않게 막는다 */}
        <button className="new-chat" type="button" onClick={reset} disabled={stage === "done" && thinking}>
          <PlusIcon />
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

        {chatHidden && (
          <VoiceCaption
            id={captionId}
            text={captionText}
            cards={captionCards.map((c) => ({ ...c, pickable: c.list && (c.messageId === activeChoicesId || c.messageId === activeRestaurantsId), picker: c.choices ? choicePickerFor(c.messageId) : undefined }))}
            thinking={thinking}
            onPick={pickCaptionRow}
          />
        )}

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

      {/* 앱으로 설치 안내 (설치할 수 있을 때만, 입력창 바로 위에 작게) */}
      <InstallBanner />

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
                <MenuIcon />
              </button>
            </div>
          </div>
          <button className="send" type="submit" aria-label="Say 전송" disabled={!input.trim()}>
            Say
          </button>
        </form>
      </div>

      {tutorialOpen && <Tutorial onClose={closeTutorial} onTry={tryTutorialExample} />}
    </div>
  );
}
