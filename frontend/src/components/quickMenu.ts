// 입력창의 link 버튼으로 여는 빠른 메뉴와, 무슨 말인지 모를 때의 안내.
// 배달·식당·쇼핑·예매 각각의 첫 질문으로 이어진다.
import { DELIVERY_PROMPT, FOOD_PROMPT, type BotPrompt } from "./orderChatKnowledge";
import { SHOP_PROMPT } from "./shoppingKnowledge";
import { TICKET_PROMPT } from "./ticketKnowledge";

export const QUICK_MENUS = ["배달", "식당", "쇼핑", "예매"] as const;
export type QuickMenu = (typeof QUICK_MENUS)[number];

export interface QuickMenuReply extends BotPrompt {
  // 다음 입력을 무엇으로 받을지: 배달은 메뉴, 식당은 음식 종류, 쇼핑은 상품 종류, 예매는 예매 종류
  next: "menu" | "food" | "shopCategory" | "tkCategory";
}

export function quickMenuReply(text: string): QuickMenuReply | undefined {
  const menu = QUICK_MENUS.find((m) => m === text.trim());
  if (menu === "배달") return { ...DELIVERY_PROMPT, next: "menu" };
  if (menu === "식당") return { ...FOOD_PROMPT, next: "food" };
  if (menu === "쇼핑") return { ...SHOP_PROMPT, next: "shopCategory" };
  if (menu === "예매") return { ...TICKET_PROMPT, next: "tkCategory" };
  return undefined;
}

export const FALLBACK_PROMPT: BotPrompt = {
  text: "죄송해요, 잘 이해하지 못했어요.\n원하는 서비스를 골라 주세요.",
  choices: QUICK_MENUS.map((m) => ({ label: m, value: m })),
};
