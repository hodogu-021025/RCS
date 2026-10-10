import { describe, expect, it } from "vitest";
import { FOOD_PROMPT } from "./orderChatKnowledge";
import { FALLBACK_PROMPT, quickMenuReply } from "./quickMenu";
import { SHOP_PROMPT } from "./shoppingKnowledge";
import { TICKET_PROMPT } from "./ticketKnowledge";

describe("quickMenuReply", () => {
  it("배달·식당·쇼핑·예매가 각각 첫 질문과 다음 단계로 이어진다", () => {
    expect(quickMenuReply("배달")).toMatchObject({ next: "menu" });
    expect(quickMenuReply("배달")?.text).toContain("오늘은 이런 메뉴 어떠세요?");
    expect(quickMenuReply("식당")).toEqual({ ...FOOD_PROMPT, next: "food" });
    expect(quickMenuReply("쇼핑")).toEqual({ ...SHOP_PROMPT, next: "shopCategory" });
    expect(quickMenuReply("예매")).toEqual({ ...TICKET_PROMPT, next: "tkCategory" });
    expect(FALLBACK_PROMPT.choices?.map((c) => c.value)).toEqual(["배달", "식당", "쇼핑", "예매"]);
  });

  it("메뉴 이름 뒤에 말투가 붙은 정도는 받고, 문장 속에 들어 있는 건 메뉴 선택으로 보지 않는다", () => {
    expect(quickMenuReply("배달이요")).toMatchObject({ next: "menu" });
    expect(quickMenuReply("쇼핑할래요")).toMatchObject({ next: "shopCategory" });
    expect(quickMenuReply("예매 해줘.")).toMatchObject({ next: "tkCategory" });
    expect(quickMenuReply("치킨 배달해줘")).toBeUndefined();
    expect(quickMenuReply("배달 주문")).toBeUndefined();
  });
});
