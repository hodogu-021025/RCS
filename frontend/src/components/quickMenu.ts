// 입력창의 + 버튼으로 여는 빠른 메뉴와, 무슨 말인지 모를 때의 안내.
// 배달·식당 각각의 첫 질문으로 이어진다.
import { FOOD_PROMPT, deliveryPrompt, type BotPrompt } from "./orderChatKnowledge";

export const QUICK_MENUS = ["배달", "식당"] as const;

export interface QuickMenuReply extends BotPrompt {
  // 다음 입력을 무엇으로 받을지: 배달은 메뉴, 식당은 음식 종류
  next: "menu" | "food";
}

// "배달", "배달이요", "식당 갈래요" 처럼 메뉴 이름으로 시작하고 뒤에 말투만 붙은 말.
// ("간장치킨 배달해줘" 는 주문이지 메뉴 선택이 아니므로 includes 로 보지 않는다)
const MENU_ONLY = new RegExp(`^(${QUICK_MENUS.join("|")})\\s*(이요|요|할래요?|할게요?|해\\s?줘|하고\\s?싶어요?|부탁해요?)?[.!]?$`);

export function quickMenuReply(text: string): QuickMenuReply | undefined {
  const menu = QUICK_MENUS.find((m) => m === MENU_ONLY.exec(text.trim())?.[1]);
  if (menu === "배달") return { ...deliveryPrompt(), next: "menu" };
  if (menu === "식당") return { ...FOOD_PROMPT, next: "food" };
  return undefined;
}

export const FALLBACK_PROMPT: BotPrompt = {
  text: "죄송해요, 잘 이해하지 못했어요.\n배달 주문과 식당 예약을 도와드릴 수 있어요.",
  say: "죄송해요, 잘 이해하지 못했어요. 배달 주문과 식당 예약을 도와드릴 수 있어요. 무엇을 해 드릴까요?",
  choices: QUICK_MENUS.map((m) => ({ label: m, value: m })),
};
