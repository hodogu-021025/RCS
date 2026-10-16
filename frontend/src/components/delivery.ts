// 배달지·연락처. 배달 주문은 로그인한 고객님만 하고, 계정 관리에 적은 배달지·연락처로 보낸다 (OrderChatbot).
// 전화번호 규칙은 서버(server/contact.mjs)와 같다

export interface DeliveryInfo {
  address: string;
  phone: string;
}

export const ADDRESS_MIN = 5;
export const ADDRESS_MAX = 100;

// 숫자만 남겨 010-1234-5678, 02-123-4567 모양으로. 전화번호가 아니면 null
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2);
  if (d.startsWith("02")) {
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`;
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`;
    return null;
  }
  if (!/^0\d+$/.test(d)) return null;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return null;
}

// 입력하는 동안 숫자만 받아 하이픈을 넣는다 (010-1234-5678, 02-123-4567). 다 적었는지는 normalizePhone 으로 본다
export function formatPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, "");
  // cuts: 각 덩어리가 끝나는 자리. 마지막 자리 뒤의 숫자는 버린다
  const parts = (cuts: number[]) => cuts.map((end, i) => d.slice(i ? cuts[i - 1] : 0, end)).filter(Boolean).join("-");
  if (d.startsWith("02")) return d.length <= 9 ? parts([2, 5, 9]) : parts([2, 6, 10]);
  // 010 은 늘 11자리라 처음부터 3-4-4 로 끊는다. 그 밖(031, 011 등)은 10자리면 3-3-4, 11자리면 3-4-4
  return d.startsWith("010") || d.length > 10 ? parts([3, 7, 11]) : parts([3, 6, 10]);
}
export const PHONE_PLACEHOLDER = "010-1234-5678";
export const PHONE_ERROR = "전화번호를 010-1234-5678 형식으로 적어 주세요.";

// 로그인 전이거나 계정에 배달지가 없는데 배달 주문을 시작하면 로그인 화면·계정 관리로 보낸다. 그동안 고른 메뉴·수량을 기억해 두었다가
// 로그인하거나 배달지를 저장하고 챗봇으로 돌아오면 이어 간다 (30분 안에, 한 번만).
// username: 기억해 둔 계정. 로그인 전에 기억한 것(null)은 그 탭에서 로그인한 계정이 이어 받는다
const RESUME_KEY = "saylo.resumeDelivery";
const RESUME_TTL_MS = 30 * 60_000;
export interface ResumeDelivery {
  itemId?: string;
  qty?: number;
}
export function rememberResume(username: string | null, resume: ResumeDelivery) {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...resume, username, at: Date.now() }));
  } catch {
    // 저장이 막힌 브라우저면 돌아와서 처음부터 고른다
  }
}
function readResume(username: string): ResumeDelivery | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null");
    if (!v || typeof v !== "object") return null;
    const { itemId, qty, at, username: owner } = v as Record<string, unknown>;
    if ((owner !== username && owner !== null) || typeof at !== "number" || Date.now() - at > RESUME_TTL_MS) return null;
    return { ...(typeof itemId === "string" ? { itemId } : {}), ...(typeof qty === "number" ? { qty } : {}) };
  } catch {
    return null;
  }
}
export const hasResume = (username: string) => readResume(username) !== null;
export function takeResume(username: string): ResumeDelivery | null {
  const r = readResume(username);
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // 위와 같다
  }
  return r;
}

export const cleanAddress = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, ADDRESS_MAX);
export const addressError = (text: string) => (cleanAddress(text).length < ADDRESS_MIN ? "주소를 조금 더 자세히 알려 주세요." : null);

export const hasDelivery = (info: Partial<DeliveryInfo>): info is DeliveryInfo => !!info.address && !!info.phone;

// 주문서 확인 중에 "주소 바꿔줘", "연락처 바꿀래"
export function deliveryChange(text: string): "address" | "phone" | undefined {
  if (/연락처|전화|휴대폰|핸드폰|폰\s?번호/.test(text)) return "phone";
  if (/주소|배달지|배송지|받는\s?곳/.test(text)) return "address";
  return undefined;
}
