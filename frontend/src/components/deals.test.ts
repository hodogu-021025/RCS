import { describe, expect, it } from "vitest";
import { discountedPrice, specialItemId, todayKST } from "./deals";
import { availableDeliveryMenu, makeOrder, orderCardRows, popularFirst, quantityQuestion } from "./orderChatKnowledge";
import { refresh } from "../data/db";
import { server } from "../test/setup";

describe("할인과 오늘의 메뉴 계산", () => {
  it("할인 가격은 10원 단위로 반올림하고, 한국 날짜는 서울 기준이다 (서버와 같은 규칙)", () => {
    expect(discountedPrice(19000, 0)).toBe(19000);
    expect(discountedPrice(19000, 10)).toBe(17100);
    expect(discountedPrice(18000, 33)).toBe(12060);
    expect(todayKST(new Date("2026-10-11T15:30:00Z"))).toBe("2026-10-12");
    expect(todayKST(new Date("2026-10-11T14:59:00Z"))).toBe("2026-10-11");
  });

  it("매장 설정의 할인·오늘의 메뉴가 메뉴 가격·순서·주문서에 반영되고, 지난 날짜의 오늘의 메뉴는 무시한다", async () => {
    server.db.updateStoreSettings("h3", { item: { id: "d2", patch: { discountPct: 20 } } });
    server.db.updateStoreSettings("s1", { special: { itemId: "d4", date: todayKST() } } as never);
    await refresh(["settings"]);

    const menu = availableDeliveryMenu();
    const chicken = menu.find((d) => d.id === "d2")!;
    expect(chicken).toMatchObject({ price: 16000, listPrice: 20000, discountPct: 20 });
    expect(menu.find((d) => d.id === "d4")?.special).toBe(true);
    // 오늘의 메뉴 → 할인 → 나머지
    expect(popularFirst(menu).map((d) => d.id)).toEqual(["d4", "d2", "d1", "d3"]);

    expect(quantityQuestion(chicken)).toContain("1마리 16,000원이에요. (20% 할인, 원래 20,000원)");
    const order = makeOrder(chicken, 2);
    expect(order).toMatchObject({ price: 32000, discountPct: 20, listPrice: 40000 });
    expect(orderCardRows(order).find((r) => r.label === "가격")?.value).toBe("32,000원 (20% 할인)");

    server.db.updateStoreSettings("s1", { special: { itemId: "d4", date: "2020-01-01" } } as never);
    await refresh(["settings"]);
    expect(specialItemId("s1")).toBeUndefined();
  });
});

describe("오늘의 메뉴·할인 안내 문장", () => {
  it("소리·자막은 자연스러운 문장으로, 말풍선은 메뉴 카드에 오늘의 메뉴·할인을 붙여 보여 준다", async () => {
    const { deliveryPrompt, dealsSay, menuBadge, discountTag } = await import("./orderChatKnowledge");
    server.db.updateStoreSettings("h3", { item: { id: "d2", patch: { discountPct: 20 } } });
    server.db.updateStoreSettings("s1", { special: { itemId: "d4", date: todayKST() } });
    await refresh(["settings"]);
    const prompt = deliveryPrompt();
    expect(prompt.say).toMatch(/^오늘의 메뉴는 국물떡볶이예요! 간장치킨은 20% 할인 중이에요\. 오늘은 /);
    // 말풍선 글에는 메뉴 이름을 늘어놓지 않고, 메뉴 카드에 오늘의 메뉴는 이름 옆 태그로, 할인은 설명 앞에 붙인다
    expect(prompt.text).toBe("오늘은 이런 메뉴 어떠세요?\n드시고 싶은 다른 메뉴도 편하게 말씀해 주세요.");
    expect(prompt.menu?.map((d) => d.id)).toEqual(["d4", "d2", "d1", "d3"]);
    expect(prompt.menu?.map((d) => [menuBadge(d), discountTag(d)])).toEqual([["오늘의 메뉴", undefined], [undefined, "20% 할인"], [undefined, undefined], [undefined, undefined]]);
    expect(dealsSay([])).toBe("");
  });
});
