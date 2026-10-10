import { describe, expect, it } from "vitest";
import { FOOD_PROMPT } from "./orderChatKnowledge";
import { FALLBACK_PROMPT, QUICK_MENUS, menuIntent, quickMenuReply } from "./quickMenu";

describe("quickMenuReply", () => {
  it("배달·식당이 각각 첫 질문과 다음 단계로 이어진다", () => {
    expect(quickMenuReply("배달")).toMatchObject({ next: "menu" });
    expect(quickMenuReply("배달")?.text).toContain("오늘은 이런 메뉴 어떠세요?");
    expect(quickMenuReply("식당")).toEqual({ ...FOOD_PROMPT, next: "food" });
    expect(QUICK_MENUS).toEqual(["배달", "식당"]);
    expect(FALLBACK_PROMPT.choices?.map((c) => c.value)).toEqual(["배달", "식당"]);
  });

  it("메뉴 이름 뒤에 말투가 붙은 정도는 받고, 문장 속에 들어 있는 건 메뉴 선택으로 보지 않는다", () => {
    expect(quickMenuReply("배달이요")).toMatchObject({ next: "menu" });
    expect(quickMenuReply("식당 할래요")).toMatchObject({ next: "food" });
    expect(quickMenuReply("배달 해줘.")).toMatchObject({ next: "menu" });
    expect(quickMenuReply("치킨 배달해줘")).toBeUndefined();
    expect(quickMenuReply("배달 주문")).toBeUndefined();
  });

  it("문장 속에 배달·식당을 뜻하는 말이 있으면 그 기능으로 본다", () => {
    expect(menuIntent("배달 주문하고 싶어")).toBe("배달");
    expect(menuIntent("뭐 좀 시켜 먹을래")).toBe("배달");
    expect(menuIntent("주문할게요")).toBe("배달");
    expect(menuIntent("근처 식당 예약할래")).toBe("식당");
    expect(menuIntent("맛집 추천해줘")).toBe("식당");
    expect(menuIntent("오늘 저녁 예약하고 싶어")).toBe("식당");
    expect(menuIntent("식당에서 시켜 먹을래")).toBe("식당"); // "배달" 이 없으면 식당 말이 먼저
    expect(menuIntent("한식 배달")).toBe("배달");
    expect(menuIntent("안녕")).toBeUndefined();
  });

  it("쇼핑·예매는 더 이상 없다", () => {
    expect(quickMenuReply("쇼핑")).toBeUndefined();
    expect(quickMenuReply("예매")).toBeUndefined();
  });
});
