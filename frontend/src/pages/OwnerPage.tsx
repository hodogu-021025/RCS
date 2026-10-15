import { useEffect, useState, type FormEvent } from "react";
import { refreshSession, useSession } from "../auth/auth";
import { choicesText, clockText, findRestaurantById, untilText, formatDate, orderItemText, orderPriceLabel, won, type DeliveryItem, type Restaurant } from "../components/orderChatKnowledge";
import { todayKST } from "../components/deals";
import { DISCOUNT_MAX, discountedPrice, specialItemId } from "../components/deals";
import {
  addMenuItem,
  deleteStoreBank,
  fetchStoreBank,
  saveStoreBank,
  setMenuActive,
  setMenuItem,
  setSpecialMenu,
  setOrderStatus,
  setReservationStatus,
  setStoreHours,
  setStorePause,
  storePause,
  useDb,
  type OrderRecord,
  type ReservationRecord,
  type StoreBank,
  type StoreSettings,
} from "../data/db";
import { BankAccountForm } from "./BankAccountForm";
import { isStandalone } from "../pwa";
import { Select } from "../components/Select";
import { DashLayout, Tabs } from "./DashLayout";
import { formatDateTime, statusClass } from "./format";

type Tab = "orders" | "store" | "menu" | "sales";
// 상단 메뉴 아래 세부 메뉴 (관리자 화면과 같은 방식). 매출은 한 화면이라 세부 메뉴가 없다
type OrdersView = "delivery" | "reservations";
type StoreView = "hours" | "bank" | "info";
type MenuView = "selling" | "add" | "stopped";
type Filter = "all" | "입금 대기" | "접수" | "준비 중" | "완료";
// 사장님이 손을 써야 하는 주문: 입금 확인을 기다리거나, 입금이 확인돼 준비를 시작해야 하는 주문
const needsAction = (o: OrderRecord) => o.status === "입금 대기" || o.status === "접수";

const DAY = 86_400_000;

// 짧은 알림음 두 번 (파일 없이 브라우저가 소리를 만든다). 소리를 못 내는 환경이면 조용히 넘어간다
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.18].forEach((at) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.15);
    });
  } catch {
    // 소리는 부가 기능이다
  }
}

// 새 주문이 들어오면 잠깐 떠 있는 알림. key 로 주문 id 를 받아 새 주문마다 새로 마운트된다
function NewOrderToast({ record }: { record: OrderRecord }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    beep();
    const t = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div className="toast" role="status">
      새 주문: {orderItemText(record.order)} · {orderPriceLabel(record.order)} · 입금을 확인해 주세요
    </div>
  );
}

// 스스로 가입한 사장님은 관리자가 승인하기 전까지 매장 정보를 볼 수 없다. 승인되면 자동으로 넘어간다 (20초마다 확인)
function PendingApproval({ storeName }: { storeName: string }) {
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => void refreshSession(), 20_000);
    return () => window.clearInterval(t);
  }, []);
  async function checkNow() {
    setChecking(true);
    await refreshSession();
    setChecking(false);
  }
  return (
    <DashLayout title={`${storeName} 사장님`}>
      <section className="dash-section pending-approval">
        <h2>관리자 승인을 기다리고 있어요</h2>
        <p>
          {storeName}의 사장님이 맞는지 관리자가 확인하고 있어요. 승인되면 이 화면에서 바로 주문·예약을 받고 영업시간·메뉴를 관리할 수 있어요.
        </p>
        <button className="btn primary" type="button" onClick={checkNow} disabled={checking}>
          {checking ? "확인하는 중…" : "승인됐는지 확인"}
        </button>
      </section>
    </DashLayout>
  );
}

export function OwnerPage() {
  const session = useSession()!;
  const db = useDb();
  // 매장 목록이 바뀌어 내 매장이 사라졌으면 빈 매장 정보로 안내만 보여 준다 (아래에서 처리).
  // 관리자가 직접 만든 매장은 서버에서 매장 목록을 받아 온 뒤에 알 수 있으므로, 그 전에는 불러오는 중으로 본다
  const found = findRestaurantById(session.storeId);
  const store = found ?? { id: session.storeId ?? "", name: "알 수 없는 매장", hours: "", food: "" };
  const storeLoading = !found && !db.storesLoaded;
  const storeMissing = !found && db.storesLoaded;
  const orders = db.orders.filter((o) => o.storeId === store.id);
  const reservations = db.reservations.filter((r) => r.restaurantId === store.id);
  const pending = orders.filter(needsAction).length;

  const [tab, setTab] = useState<Tab>("orders");
  const [ordersView, setOrdersView] = useState<OrdersView>("delivery");
  const [storeView, setStoreView] = useState<StoreView>("hours");
  const [menuView, setMenuView] = useState<MenuView>("selling");
  const [filter, setFilter] = useState<Filter>("all");
  // 입금 계좌: 없으면 배달 주문을 받지 못하므로 매장 탭이 아닌 화면에서도 위에 띠로 알린다
  const [bank, setBank] = useState<StoreBank | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);
  const canLoadBank = !!found && session.approved !== false;
  useEffect(() => {
    if (!canLoadBank) return;
    let alive = true;
    fetchStoreBank(store.id)
      .then((b) => alive && setBank(b))
      .catch((err: unknown) => alive && setBankError(err instanceof Error ? err.message : "계좌 정보를 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [store.id, canLoadBank]);
  // 페이지를 열 때 이미 있던 주문에는 알리지 않는다: 서버에서 처음 받아 온 뒤의 맨 위 주문을 기억해 두고, 그 뒤에 생긴 것만 알린다
  // (렌더 중에 상태를 맞추는 React 의 파생 상태 방식)
  // 계정이 바뀌면(같은 기기에서 다른 사장님 로그인) 기준도 다시 잡는다
  const [seen, setSeen] = useState<{ user: string; id: string | null } | undefined>(undefined);
  const seenAtOpen = seen?.user === session.username ? seen.id : undefined;
  if (db.recordsLoaded && seenAtOpen === undefined) setSeen({ user: session.username, id: orders[0]?.id ?? null });
  const latest = orders[0];
  const isNew = seenAtOpen !== undefined && latest && latest.id !== seenAtOpen && latest.status === "입금 대기";

  const shownOrders = filter === "all" ? orders : orders.filter((o) => o.status === filter);
  // 일시 중지 중이거나 미리 정해 두었으면 매장 탭이 아닌 화면에서도 위에 띠로 알린다 (잊지 않게)
  const pauseInfo = storePause(store.id);
  const [bannerError, setBannerError] = useState<string | null>(null);
  function resumeFromBanner() {
    setBannerError(null);
    setStorePause(store.id, null).catch((err: unknown) => setBannerError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요."));
  }

  if (storeLoading) {
    return (
      <DashLayout title="사장님">
        <section className="dash-section">
          <p className="muted">매장 정보를 불러오는 중이에요.</p>
        </section>
      </DashLayout>
    );
  }
  if (storeMissing) {
    return (
      <DashLayout title="사장님">
        <section className="dash-section pending-approval">
          <h2>매장 정보를 찾을 수 없어요</h2>
          <p>이 계정에 연결된 매장이 지금 매장 목록에 없어요. 관리자에게 문의해 주세요.</p>
        </section>
      </DashLayout>
    );
  }
  if (session.approved === false) return <PendingApproval storeName={store.name} />;

  return (
    <DashLayout title={`${store.name} 사장님`}>
      {isNew && <NewOrderToast key={latest.id} record={latest} />}
      {/* 앱 받기 (안드로이드 앱 파일·아이폰 홈 화면 추가). 이미 앱으로 열었으면 보이지 않는다 */}
      {!isStandalone() && (
        <a className="app-strip" href="#/app">
          <span>Saylo 앱으로 열면 주문을 더 빨리 볼 수 있어요</span>
          <b>앱 받기</b>
        </a>
      )}
      <Tabs
        tabs={[
          { key: "orders", label: "주문·예약", badge: pending },
          { key: "store", label: "매장" },
          { key: "menu", label: "메뉴" },
          { key: "sales", label: "매출" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "orders" && (
        <Tabs
          sub
          tabs={[
            { key: "delivery", label: "배달 주문", badge: pending },
            { key: "reservations", label: "식당 예약" },
          ]}
          value={ordersView}
          onChange={setOrdersView}
        />
      )}
      {tab === "store" && (
        <Tabs
          sub
          tabs={[
            { key: "hours", label: "영업 관리" },
            { key: "bank", label: "입금 계좌" },
            { key: "info", label: "매장 정보" },
          ]}
          value={storeView}
          onChange={setStoreView}
        />
      )}
      {tab === "menu" && (
        <Tabs
          sub
          tabs={[
            { key: "selling", label: "판매 중" },
            { key: "add", label: "메뉴 추가" },
            { key: "stopped", label: "판매 중지" },
          ]}
          value={menuView}
          onChange={setMenuView}
        />
      )}
      {/* 일시 중지는 매장 > 영업 관리에서 다루므로 그 화면이 아닐 때 위에 띠로 알린다 */}
      {pauseInfo && !(tab === "store" && storeView === "hours") && (
        <div className="pause-banner" role="status">
          <span role={bannerError ? "alert" : undefined}>
            {bannerError ??
              (pauseInfo.active
                ? `새 주문을 잠시 받지 않고 있어요 · ${untilText(pauseInfo.until)}까지`
                : `${untilText(pauseInfo.from)}부터 ${untilText(pauseInfo.until)}까지 일시 중지 예정이에요`)}
          </span>
          <button type="button" className="btn small" onClick={resumeFromBanner}>
            {pauseInfo.active ? "다시 받기" : "취소"}
          </button>
        </div>
      )}

      {bank && !bank.account && !(tab === "store" && storeView === "bank") && (
        <div className="pause-banner" role="status">
          <span>입금 계좌가 없어 배달 주문을 받지 못하고 있어요</span>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setTab("store");
              setStoreView("bank");
            }}
          >
            계좌 등록
          </button>
        </div>
      )}

      {tab === "orders" && ordersView === "delivery" && (
        <>
          <section className="dash-section">
            <div className="section-head">
              <h2>배달 주문</h2>
              <div className="chips">
                {(["all", "입금 대기", "접수", "준비 중", "완료"] as Filter[]).map((f) => (
                  <button key={f} type="button" className={filter === f ? "chip active" : "chip"} onClick={() => setFilter(f)}>
                    {f === "all" ? "전체" : f}
                  </button>
                ))}
              </div>
            </div>
            {shownOrders.length === 0 && <p className="empty">해당하는 주문이 없어요.</p>}
            <ul className="record-list">
              {shownOrders.map((o) => (
                <OrderRow key={o.id} record={o} />
              ))}
            </ul>
          </section>
        </>
      )}

      {tab === "orders" && ordersView === "reservations" && (
        <section className="dash-section">
          <h2>식당 예약</h2>
          {reservations.length === 0 && <p className="empty">예약이 없어요.</p>}
          <ul className="record-list">
            {reservations.map((r) => (
              <ReservationRow key={r.id} record={r} />
            ))}
          </ul>
        </section>
      )}

      {tab === "store" && <StoreTab view={storeView} store={store} bank={bank} bankError={bankError} onBankChange={setBank} />}
      {tab === "menu" && <MenuTab view={menuView} storeId={store.id} />}
      {tab === "sales" && <SalesTab orders={orders} />}
    </DashLayout>
  );
}

function OrderRow({ record: o }: { record: OrderRecord }) {
  return (
    <li className={"record" + (needsAction(o) ? " pending" : "")}>
      <div className="record-head">
        <b>
          {o.order.item} {o.order.qty}
          {o.order.unit}
        </b>
        <span className="price">{orderPriceLabel(o.order)}</span>
        <span className={statusClass(o.status)}>{o.status}</span>
      </div>
      <dl>
        {/* 세트 메뉴의 고른 맛 */}
        {o.order.choices?.length ? (
          <div>
            <dt>{o.order.choiceLabel ?? "맛"}</dt>
            <dd>{choicesText(o.order.choices)}</dd>
          </div>
        ) : null}
        {o.order.address && (
          <div>
            <dt>배달지</dt>
            <dd>{o.order.address}</dd>
          </div>
        )}
        <div>
          <dt>주문자</dt>
          <dd>{o.customerName}</dd>
        </div>
        {o.order.phone && (
          <div>
            <dt>연락처</dt>
            {/* 휴대폰에서 누르면 바로 전화를 건다 */}
            <dd>
              <a className="tel" href={`tel:${o.order.phone.replace(/-/g, "")}`}>
                {o.order.phone}
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt>결제</dt>
          <dd>{o.payment}</dd>
        </div>
        {/* 계좌이체: 통장에서 이 이름·금액으로 들어왔는지 보고 입금 확인을 누른다 */}
        {o.order.depositor && (
          <div>
            <dt>입금자명</dt>
            <dd>{o.order.depositor}</dd>
          </div>
        )}
        {o.status === "입금 대기" && o.order.payBy && (
          <div>
            <dt>입금 기한</dt>
            <dd>{untilText(o.order.payBy)}까지 (지나면 자동 취소)</dd>
          </div>
        )}
        {o.status === "취소" && o.order.cancelNote && (
          <div>
            <dt>취소 이유</dt>
            <dd>{o.order.cancelNote}</dd>
          </div>
        )}
        <div>
          <dt>시각</dt>
          <dd>{formatDateTime(o.createdAt)}</dd>
        </div>
      </dl>
      <div className="record-actions">
        {o.status === "입금 대기" && (
          <>
            <button type="button" className="btn primary" onClick={() => setOrderStatus(o.id, "접수")}>
              입금 확인
            </button>
            <button type="button" className="btn" onClick={() => setOrderStatus(o.id, "취소")}>
              취소
            </button>
          </>
        )}
        {o.status === "접수" && (
          <>
            <button type="button" className="btn primary" onClick={() => setOrderStatus(o.id, "준비 중")}>
              준비 시작
            </button>
            <button type="button" className="btn" onClick={() => setOrderStatus(o.id, "취소")}>
              취소
            </button>
          </>
        )}
        {o.status === "준비 중" && (
          <button type="button" className="btn primary" onClick={() => setOrderStatus(o.id, "완료")}>
            배달 완료
          </button>
        )}
      </div>
    </li>
  );
}

function ReservationRow({ record: r }: { record: ReservationRecord }) {
  return (
    <li className="record">
      <div className="record-head">
        <b>
          {formatDate(new Date(r.date))} {r.time}
        </b>
        <span>{r.people}명</span>
        <span className={statusClass(r.status)}>{r.status}</span>
      </div>
      <dl>
        <div>
          <dt>예약자</dt>
          <dd>{r.customerName}</dd>
        </div>
        <div>
          <dt>예약 시각</dt>
          <dd>{formatDateTime(r.createdAt)}</dd>
        </div>
      </dl>
      {r.status === "예약 확정" && (
        <div className="record-actions">
          {/* 방문일이 되기 전에는 방문 완료를 누를 수 없다 (서버도 막는다) */}
          <button type="button" className="btn primary" disabled={r.date > todayKST()} onClick={() => setReservationStatus(r.id, "방문 완료")}>
            방문 완료
          </button>
          <button type="button" className="btn" onClick={() => setReservationStatus(r.id, "취소")}>
            취소
          </button>
        </div>
      )}
    </li>
  );
}

// 메뉴 추가 칸에서 고르는 수량 단위
const UNITS = ["마리", "판", "인분", "개", "그릇", "세트", "잔", "병"];
const PRICE_MIN = 100;
const PRICE_MAX = 1_000_000;

// 메뉴 추가: 이름·가격·단위·손님이 부를 다른 이름. 추가하면 바로 판매되고 소비자 챗봇에 나온다
function AddMenuForm({ storeId }: { storeId: string }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState(UNITS[0]);
  const [aliases, setAliases] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    const n = name.trim();
    const p = Number(price);
    const invalid = !n
      ? "메뉴 이름을 적어 주세요."
      : !Number.isInteger(p) || p < PRICE_MIN || p > PRICE_MAX
        ? `가격은 ${PRICE_MIN.toLocaleString("ko-KR")}원부터 ${PRICE_MAX.toLocaleString("ko-KR")}원까지 적어 주세요.`
        : null;
    if (invalid) return setError(invalid);
    setBusy(true);
    try {
      const keywords = aliases.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      await addMenuItem(storeId, { name: n, price: p, unit, keywords });
      setName("");
      setPrice("");
      setAliases("");
      setError(null);
      setDone(`${n} 메뉴를 추가했어요. 소비자 챗봇에 바로 보여요.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-section">
      <h2>메뉴 추가</h2>
      <form className="menu-form" onSubmit={onSubmit} noValidate>
        <label>
          <span>메뉴 이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="예) 양념치킨" />
        </label>
        <div className="menu-form-row">
          <label>
            <span>가격 (원)</span>
            <input type="number" inputMode="numeric" min={PRICE_MIN} step={500} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="예) 19000" />
          </label>
          <Select label="단위" options={UNITS.map((u) => ({ value: u, label: u }))} value={unit} onChange={setUnit} />
        </div>
        <label>
          <span>손님이 부를 다른 이름 (선택, 쉼표로 구분)</span>
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="예) 양념, 양념통닭" />
        </label>
        <p className="hint">매장 음식 종류 이름(예: 치킨)은 자동으로 들어가서, 손님이 "치킨"이라고만 말해도 이 메뉴를 추천해요.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="form-notice" role="status">
            {done}
          </p>
        )}
        <button className="btn primary wide" type="submit" disabled={busy}>
          {busy ? "추가하는 중…" : "메뉴 추가"}
        </button>
      </form>
    </section>
  );
}

type ItemSetting = NonNullable<StoreSettings["items"]>[string];

// 판매 중인 메뉴 카드: 이름·품절·판매 중지 한 줄 / 가격·할인율 한 줄 / 판매가(할인 반영).
// 가격·할인율은 칸을 벗어날 때 저장하고, 판매가는 적는 동안 바로 바뀐다
function MenuCard({
  item,
  setting,
  special,
  onSave,
  onStop,
  onError,
}: {
  item: DeliveryItem;
  setting: ItemSetting;
  special: boolean;
  onSave: (patch: ItemSetting) => void;
  onStop: () => void;
  onError: (message: string) => void;
}) {
  const listPrice = setting.price ?? item.price;
  const pct = setting.discountPct ?? 0;
  const [price, setPrice] = useState(String(listPrice));
  const [discount, setDiscount] = useState(pct ? String(pct) : "");
  // 서버 값이 바뀌면(저장 실패로 되돌아오거나 다른 기기에서 바꾸면) 칸도 그 값으로 (렌더 중에 맞추는 파생 상태 방식)
  const [seenPrice, setSeenPrice] = useState(listPrice);
  if (seenPrice !== listPrice) {
    setSeenPrice(listPrice);
    setPrice(String(listPrice));
  }
  const [seenPct, setSeenPct] = useState(pct);
  if (seenPct !== pct) {
    setSeenPct(pct);
    setDiscount(pct ? String(pct) : "");
  }

  // 적고 있는 값으로 판매가를 계산한다. 아직 맞지 않는 값이면 저장된 값으로
  const typedPrice = Number(price);
  const typedPct = discount === "" ? 0 : Number(discount);
  const shownPrice = typedPrice > 0 ? typedPrice : listPrice;
  const shownPct = Number.isInteger(typedPct) && typedPct >= 0 && typedPct <= DISCOUNT_MAX ? typedPct : pct;

  function savePrice() {
    if (typedPrice > 0 && typedPrice !== listPrice) onSave({ price: typedPrice });
    else if (!(typedPrice > 0)) setPrice(String(listPrice));
  }

  function saveDiscount() {
    if (typedPct === pct) return;
    if (!Number.isInteger(typedPct) || typedPct < 0 || typedPct > DISCOUNT_MAX) {
      onError(`할인율은 0~${DISCOUNT_MAX}% 사이 정수로 적어 주세요.`);
      setDiscount(pct ? String(pct) : "");
      return;
    }
    onSave({ discountPct: typedPct });
  }

  return (
    <li className={setting.soldOut ? "sold-out" : undefined}>
      <div className="menu-head">
        <b>
          {item.name}
          {special && <span className="badge-special">오늘의 메뉴</span>}
        </b>
        {/* 품절은 눌러서 켜고 끄는 버튼(켜지면 파란 칸), 판매 중지는 같은 모양의 버튼 */}
        <div className="menu-actions">
          <button
            type="button"
            className={"btn small" + (setting.soldOut ? " on" : "")}
            aria-pressed={!!setting.soldOut}
            aria-label={`${item.name} 품절`}
            onClick={() => onSave({ soldOut: !setting.soldOut })}
          >
            품절
          </button>
          <button type="button" className="btn small" onClick={onStop} aria-label={`${item.name} 판매 중지`}>
            판매 중지
          </button>
        </div>
      </div>
      {/* 가격 · 할인율 · 판매가 세 칸을 한 줄에. 칸 위에 이름, 판매가는 적는 대로 바로 바뀌는 읽기 전용 칸 */}
      <div className="price-grid">
        <label>
          <span>원 / 1{item.unit}</span>
          <input
            type="number"
            min={0}
            step={500}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={savePrice}
            aria-label={`${item.name} 가격`}
          />
        </label>
        <label>
          <span>할인율 (%)</span>
          <input
            type="number"
            min={0}
            max={DISCOUNT_MAX}
            step={5}
            value={discount}
            placeholder="0"
            onChange={(e) => setDiscount(e.target.value)}
            onBlur={saveDiscount}
            aria-label={`${item.name} 할인율`}
          />
        </label>
        <label>
          <span>판매가</span>
          <input
            readOnly
            tabIndex={-1}
            value={won(discountedPrice(shownPrice, shownPct))}
            aria-label={`${item.name} 판매가`}
            className={"sale-input" + (shownPct > 0 ? " discounted" : "")}
          />
        </label>
      </div>
    </li>
  );
}
const HOUR_MS = 60 * 60_000;
const pad2 = (n: number) => String(n).padStart(2, "0");

// 오늘 "HH:MM" 의 시각(밀리초)
function todayAt(hhmm: string, now = Date.now()): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// 시작·종료 칸의 "HH:MM" 을 실제 시각으로. 시작이 한 시간 안쪽으로 지났으면 지금(칸을 열어 둔 사이 기본값이 지난 것),
// 그보다 이르면 내일 그 시각. 종료는 시작 뒤에 오는 그 시각 (시작보다 이르거나 같으면 다음 날)
function pausePlan(start: string, end: string, now = Date.now()): { from: number; until: number } {
  let from = todayAt(start, now);
  if (from < now) from = now - from <= HOUR_MS ? now : from + 24 * HOUR_MS;
  let until = todayAt(end, now);
  while (until <= from) until += 24 * HOUR_MS;
  return { from, until };
}

// 남은 시간 "1:12:05" (한 시간 안이면 "12:05")
function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

// 일시 중지: 시작·종료 시간을 고르면 그동안 새 배달 주문과 오늘 예약을 받지 않고, 종료 시간이 되면 저절로 다시 받는다.
// 시작을 앞으로 잡으면 미리 정해 두는 것. 정해 두면 아래 타이머가 시작·끝까지 남은 시간을 1초마다 보여 준다
function PauseCard({ storeId }: { storeId: string }) {
  const [now, setNow] = useState(() => Date.now());
  const pause = storePause(storeId, now);
  const hasPause = !!pause;
  useEffect(() => {
    if (!hasPause) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [hasPause]);

  // 칸: 정해 둔 일시 중지가 있으면 그 시각, 없으면 시작은 지금·종료는 비워 둔다.
  // 저장된 값이 바뀌면(저장·해제·다른 기기에서 바꿈) 칸도 그 값으로 맞춘다 (렌더 중에 맞추는 파생 상태 방식)
  const savedKey = pause ? `${pause.from}-${pause.until}` : "none";
  const fill = () => ({ start: clockText(pause ? pause.from : Date.now()), end: pause ? clockText(pause.until) : "" });
  const [fields, setFields] = useState(fill);
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setFields(fill());
  }
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = !pause || fields.start !== clockText(pause.from) || fields.end !== clockText(pause.until);

  async function save(next: { from: number; until: number } | null) {
    setBusy(true);
    setError(null);
    try {
      await setStorePause(storeId, next);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function onSave() {
    if (!fields.start || !fields.end) return setError("시작 시간과 종료 시간을 골라 주세요.");
    void save(pausePlan(fields.start, fields.end));
  }

  return (
    <section className="dash-section pause-card">
      <h2>일시 중지</h2>
      <div className="hours-row">
        <label>
          <span>시작 시간</span>
          <input type="time" value={fields.start} onChange={(e) => setFields((f) => ({ ...f, start: e.target.value }))} />
        </label>
        <label>
          <span>종료 시간</span>
          <input type="time" value={fields.end} onChange={(e) => setFields((f) => ({ ...f, end: e.target.value }))} />
        </label>
      </div>
      {pause && (
        <div className={"pause-timer" + (pause.active ? " active" : "")} role="timer">
          <span>{pause.active ? "다시 받기까지" : "일시 중지 시작까지"}</span>
          <b>{countdown((pause.active ? pause.until : pause.from) - now)}</b>
          {!pause.active && <small>{`${untilText(pause.from, now)}부터 ${untilText(pause.until, now)}까지 멈춰요.`}</small>}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="pause-actions">
        {pause ? (
          <>
            <button type="button" className="btn" disabled={busy || !changed} onClick={onSave}>
              시간 바꾸기
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save(null)}>
              {pause.active ? "지금 다시 받기" : "일시 중지 취소"}
            </button>
          </>
        ) : (
          <button type="button" className="btn primary" disabled={busy || !fields.end} onClick={onSave}>
            일시 중지
          </button>
        )}
      </div>
    </section>
  );
}

// 매장 탭: 영업 상태(일시 중지)·영업시간·매장 정보. 바꾸면 소비자 챗봇에 바로 반영된다
// 입금 계좌: 결제는 계좌이체 하나라 고객님이 이 계좌로 입금한다. 없으면 이 매장은 배달 주문을 받지 못한다
interface BankProps {
  bank: StoreBank | null; // 아직 못 받아 왔으면 null
  bankError: string | null;
  onBankChange: (bank: StoreBank) => void;
}
function BankCard({ storeId, bank, bankError, onBankChange }: BankProps & { storeId: string }) {
  return (
    <section className="dash-section">
      <div className="section-head hours-head">
        <h2>입금 계좌</h2>
        <span className="head-note">결제는 계좌이체만 받아요.</span>
      </div>
      {bankError && (
        <p className="form-error" role="alert">
          {bankError}
        </p>
      )}
      {bank && (
        <>
          <p className="hint bank-hint">
            {bank.account
              ? "고객님이 주문하면 이 계좌로 입금 안내를 받아요. 입금을 확인하면 주문 목록에서 '입금 확인'을 눌러 주세요."
              : "계좌를 등록해야 배달 주문을 받을 수 있어요. 등록 전에는 고객님이 이 매장의 배달 주문을 할 수 없어요."}
          </p>
          <BankAccountForm
            key={bank.account ? `${bank.account.bank}-${bank.account.account}` : "none"}
            account={bank.account}
            onSave={async (a) => onBankChange(await saveStoreBank(storeId, a))}
            onDelete={async () => onBankChange(await deleteStoreBank(storeId))}
            deleteLabel="지우기 (배달 주문 중지)"
          />
        </>
      )}
    </section>
  );
}

// 매장 탭: 세부 메뉴에 따라 영업 관리(일시 중지·영업시간) / 입금 계좌 / 매장 정보 중 하나를 보여 준다
function StoreTab({ view, store, bank, bankError, onBankChange }: BankProps & { view: StoreView; store: Restaurant }) {
  useDb(["settings"]);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const run = (work: Promise<unknown>) => {
    setHoursError(null);
    work.catch((err: unknown) => setHoursError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요."));
  };
  // 자정 마감은 데이터에 "24:00"으로 적혀 있지만 시간 입력칸은 "00:00"까지만 받는다 (예약 시간 계산은 둘 다 자정으로 본다)
  const [open, close] = store.hours.split("-").map((s) => s.trim()).map((t) => (t === "24:00" ? "00:00" : t));

  if (view === "bank") return <BankCard storeId={store.id} bank={bank} bankError={bankError} onBankChange={onBankChange} />;
  if (view === "info")
    return (
      <section className="dash-section">
        <h2>매장 정보</h2>
        <dl className="policy-items">
          <div>
            <dt>매장 이름</dt>
            <dd>{store.name}</dd>
          </div>
          {store.address && (
            <div>
              <dt>주소</dt>
              <dd>{store.address}</dd>
            </div>
          )}
          {store.signature && (
            <div>
              <dt>대표 메뉴</dt>
              <dd>{store.signature}</dd>
            </div>
          )}
        </dl>
      </section>
    );
  return (
    <>
      <PauseCard storeId={store.id} />

      <section className="dash-section">
        <div className="section-head hours-head">
          <h2>영업시간</h2>
          <span className="head-note">예약은 마감 1시간 전까지 받아요.</span>
        </div>
        {/* 여는·닫는 시간 칸이 카드 가로를 반씩 나눠 꽉 채운다 */}
        {hoursError && (
          <p className="form-error" role="alert">
            {hoursError}
          </p>
        )}
        <div className="hours-row">
          <label>
            <span>여는 시간</span>
            <input type="time" value={open} onChange={(e) => e.target.value && run(setStoreHours(store.id, `${e.target.value} - ${close}`))} />
          </label>
          <label>
            <span>닫는 시간</span>
            <input type="time" value={close} onChange={(e) => e.target.value && run(setStoreHours(store.id, `${open} - ${e.target.value}`))} />
          </label>
        </div>
      </section>
    </>
  );
}

// 메뉴 탭: 오늘의 메뉴, 배달 메뉴(가격·할인·품절·판매 중지), 메뉴 추가, 판매 중지한 메뉴. 바꾸면 소비자 챗봇에 바로 반영된다
// 세부 메뉴에 따라 판매 중(오늘의 메뉴·가격·할인·품절) / 메뉴 추가 / 판매 중지한 메뉴 중 하나를 보여 준다
function MenuTab({ view, storeId }: { view: MenuView; storeId: string }) {
  const db = useDb(["settings", "menu"]);
  const [menuError, setMenuError] = useState<string | null>(null);
  // 서버에 바꾸라고 보내고, 실패하면(연결 끊김·서버가 거절) 이유를 보여 준다
  const run = (work: Promise<unknown>) => {
    setMenuError(null);
    work.catch((err: unknown) => setMenuError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요."));
  };
  const toggle = (itemId: string, active: boolean) => run(setMenuActive(storeId, itemId, active));
  const special = specialItemId(storeId);
  const mine = db.menu.filter((d) => d.restaurantId === storeId);
  const items = mine.filter((d) => d.active !== false);
  const stopped = mine.filter((d) => d.active === false);
  const settings = db.storeSettings[storeId]?.items ?? {};

  const errorLine = menuError && (
    <p className="form-error" role="alert">
      {menuError}
    </p>
  );

  if (view === "add") return <AddMenuForm storeId={storeId} />;
  if (view === "stopped")
    return (
      <section className="dash-section">
        <h2>판매 중지한 메뉴 ({stopped.length})</h2>
        {stopped.length === 0 && <p className="empty">판매 중지한 메뉴가 없어요.</p>}
        <ul className="menu-list">
          {stopped.map((d) => (
            <li key={d.id} className="stopped">
              <b>{d.name}</b>
              <span className="muted">
                {won(settings[d.id]?.price ?? d.price)} / 1{d.unit}
              </span>
              <button type="button" className="btn small" onClick={() => toggle(d.id, true)} aria-label={`${d.name} 다시 판매`}>
                다시 판매
              </button>
            </li>
          ))}
        </ul>
        {errorLine}
      </section>
    );
  return (
    <>
      <section className="dash-section">
        <h2>배달 메뉴</h2>
        {items.length === 0 && <p className="empty">이 매장에 등록된 배달 메뉴가 없어요.</p>}
        {items.length > 0 && (
          // 오늘의 메뉴: 오늘(한국 시간) 자정까지 챗봇이 가장 먼저 추천한다
          <div className="special-field">
            <Select
              label="오늘의 메뉴"
              options={[{ value: "", label: "없음" }, ...items.map((d) => ({ value: d.id, label: d.name }))]}
              value={special ?? ""}
              onChange={(v) => run(setSpecialMenu(storeId, v || null))}
            />
            <small>오늘 자정까지 챗봇이 가장 먼저 추천해요. 내일이 되면 자동으로 풀려요.</small>
          </div>
        )}
        <ul className="menu-list">
          {items.map((d) => (
            <MenuCard
              key={d.id}
              item={d}
              setting={settings[d.id] ?? {}}
              special={special === d.id}
              onSave={(patch) => run(setMenuItem(storeId, d.id, patch))}
              onStop={() => toggle(d.id, false)}
              onError={setMenuError}
            />
          ))}
        </ul>
        <p className="hint">품절은 오늘처럼 잠깐 못 파는 것, 판매 중지는 메뉴에서 내리는 것이에요. 판매 중지한 메뉴는 "판매 중지" 메뉴에서 다시 판매할 수 있어요.</p>
        {errorLine}
      </section>
    </>
  );
}

// 취소되지 않은 주문 기준. 오늘 / 최근 7일 / 메뉴별
function SalesTab({ orders }: { orders: OrderRecord[] }) {
  const [now] = useState(() => Date.now()); // 렌더마다 바뀌지 않게 열 때의 시각으로 계산한다
  const todayStart = new Date(new Date().toDateString()).getTime();
  // 매출은 입금이 확인된 주문만 (취소·입금 대기는 뺀다)
  const valid = orders.filter((o) => o.status !== "취소" && o.status !== "입금 대기");
  const today = valid.filter((o) => o.createdAt >= todayStart);
  const week = valid.filter((o) => o.createdAt >= now - 7 * DAY);
  const sum = (list: OrderRecord[]) => list.reduce((a, o) => a + o.order.price, 0);
  const byItem = new Map<string, { qty: number; sales: number }>();
  for (const o of week) {
    const cur = byItem.get(o.order.item) ?? { qty: 0, sales: 0 };
    byItem.set(o.order.item, { qty: cur.qty + o.order.qty, sales: cur.sales + o.order.price });
  }
  const top = [...byItem.entries()].sort((a, b) => b[1].sales - a[1].sales);

  return (
    <>
      <section className="dash-section">
        <div className="tiles">
          <div className="tile">
            <span>오늘 주문</span>
            <b>{today.length}건</b>
          </div>
          <div className="tile">
            <span>오늘 매출</span>
            <b>{won(sum(today))}</b>
          </div>
          <div className="tile">
            <span>최근 7일 주문</span>
            <b>{week.length}건</b>
          </div>
          <div className="tile">
            <span>최근 7일 매출</span>
            <b>{won(sum(week))}</b>
          </div>
        </div>
      </section>
      <section className="dash-section">
        <h2>최근 7일 인기 메뉴</h2>
        {top.length === 0 && <p className="empty">아직 주문이 없어요.</p>}
        <table className="dash-table">
          <thead>
            <tr>
              <th>메뉴</th>
              <th>수량</th>
              <th>매출</th>
            </tr>
          </thead>
          <tbody>
            {top.map(([name, v]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{v.qty}</td>
                <td>{won(v.sales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
