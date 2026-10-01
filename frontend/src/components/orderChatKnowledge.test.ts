import { describe, expect, it } from "vitest";
import { completionText, findPayment, isNo, isOrderRequest, isYes, makeOrder, parseQty, won } from "./orderChatKnowledge";

describe("isOrderRequest", () => {
  it("메뉴/매장과 주문 동사가 같이 있으면 주문으로 본다", () => {
    expect(isOrderRequest("근처 BBQ 매장에서 황금올리브 시켜줘")).toBe(true);
    expect(isOrderRequest("치킨 배달해줘")).toBe(true);
  });

  it("둘 중 하나만 있으면 주문이 아니다", () => {
    expect(isOrderRequest("황금올리브 맛있어?")).toBe(false);
    expect(isOrderRequest("안녕")).toBe(false);
  });
});

describe("isYes / isNo", () => {
  it("긍정·부정 답을 구분한다", () => {
    expect(isYes("응 해줘")).toBe(true);
    expect(isYes("OK")).toBe(true);
    expect(isNo("아니 취소할래")).toBe(true);
    expect(isNo("응 해줘")).toBe(false);
  });
});

describe("parseQty", () => {
  it("숫자·한글 수량을 읽고, 없으면 1마리", () => {
    expect(parseQty("황금올리브 2마리")).toBe(2);
    expect(parseQty("두 마리 시켜줘")).toBe(2);
    expect(parseQty("황금올리브 시켜줘")).toBe(1);
  });

  it("1~10마리 범위로 자른다", () => {
    expect(parseQty("50마리")).toBe(10);
    expect(parseQty("0마리")).toBe(1);
  });
});

describe("findPayment", () => {
  it("줄여 말해도 결제수단을 찾는다", () => {
    expect(findPayment("카카오로 할게")?.id).toBe("kakao");
    expect(findPayment("토스페이")?.id).toBe("toss");
    expect(findPayment("카드로 해줘")?.id).toBe("card");
    expect(findPayment("현금")).toBeUndefined();
  });
});

describe("makeOrder / completionText", () => {
  it("수량만큼 가격을 계산한다", () => {
    expect(makeOrder(2).price).toBe(42000);
    expect(won(42000)).toBe("42,000원");
  });

  it("완료 문구에 결제수단·금액·주문번호·도착 예정 시각을 넣는다", () => {
    const text = completionText(makeOrder(1), findPayment("토스페이")!, new Date(2026, 9, 1, 10, 0));
    expect(text).toContain("토스페이로 21,000원 결제가 완료되었어요");
    expect(text).toMatch(/주문번호: BBQ\d{6}/);
    expect(text).toContain("도착 예정: 약 40분 후 (10:40)");
  });
});
