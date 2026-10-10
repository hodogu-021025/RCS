// 배달지·연락처. 주문할 때 한 번 받고, 이 브라우저에 기억해 두었다가 다음 주문 때 다시 쓴다.
// 로그인한 고객님은 다른 기기에서도 지난 주문의 배달지를 이어서 쓴다 (OrderChatbot).
// 전화번호 규칙은 서버(server/contact.mjs)와 같다
import type { BotPrompt } from "./orderChatKnowledge";

export interface DeliveryInfo {
  address: string;
  phone: string;
}

export const ADDRESS_MIN = 5;
export const ADDRESS_MAX = 100;
const KEY = "saylo.delivery";

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

export const cleanAddress = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, ADDRESS_MAX);
export const addressError = (text: string) => (cleanAddress(text).length < ADDRESS_MIN ? "주소를 조금 더 자세히 알려 주세요." : null);

export function loadDelivery(): Partial<DeliveryInfo> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!v || typeof v !== "object") return {};
    const { address, phone } = v as Record<string, unknown>;
    return {
      ...(typeof address === "string" && !addressError(address) ? { address: cleanAddress(address) } : {}),
      ...(typeof phone === "string" && normalizePhone(phone) ? { phone: normalizePhone(phone)! } : {}),
    };
  } catch {
    return {};
  }
}

export function saveDelivery(info: Partial<DeliveryInfo>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    // 저장이 막힌 브라우저면 다음 주문 때 다시 묻는다
  }
}

export const hasDelivery = (info: Partial<DeliveryInfo>): info is DeliveryInfo => !!info.address && !!info.phone;

// 주문서 확인 중에 "주소 바꿔줘", "연락처 바꿀래"
export function deliveryChange(text: string): "address" | "phone" | undefined {
  if (/연락처|전화|휴대폰|핸드폰|폰\s?번호/.test(text)) return "phone";
  if (/주소|배달지|배송지|받는\s?곳/.test(text)) return "address";
  return undefined;
}

// 주소·연락처를 묻는 동안 그만두는 말 (주소에 "no" 같은 글자가 섞일 수 있어 문장 첫머리만 본다)
export const isStopDelivery = (text: string) => /^(취소|그만|아니|안\s?할|주문\s?안)/.test(text.trim());

export const addressPrompt = (lead?: string): BotPrompt => ({
  text: `${lead ? `${lead}\n` : ""}배달 받을 주소를 알려 주세요.\n동·호수까지 알려 주시면 정확해요.`,
  placeholder: "예) 제천시 장락동 제천빌라 331호",
});

export const phonePrompt = (lead?: string): BotPrompt => ({
  text: `${lead ? `${lead}\n` : ""}가게에서 연락드릴 전화번호를 알려 주세요.`,
  placeholder: "예) 010-1234-5678",
});
