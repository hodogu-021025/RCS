import { describe, expect, it } from "vitest";
import { orderCardRows, orderSummaryRows, completionText, findPayment } from "./orderChatKnowledge";
import {
  PRODUCTS,
  SHOP_PROMPT,
  addressPrompt,
  findProduct,
  findSize,
  looksLikeAddress,
  makeShopOrder,
  matchShopCategory,
  productsOf,
  shopQuantityQuestion,
  shippingFeeFor,
} from "./shoppingKnowledge";

const product = (name: string) => PRODUCTS.find((p) => p.name === name)!;

describe("쇼핑", () => {
  it("종류 선택지는 옷·신발·장난감·화장품·책이고, 상품 이름으로도 종류를 찾는다", () => {
    expect(SHOP_PROMPT.choices?.map((c) => c.label)).toEqual(["옷", "신발", "장난감", "화장품", "책"]);
    expect(matchShopCategory("운동화 보여줘")?.key).toBe("shoes");
    expect(matchShopCategory("선크림")?.key).toBe("cosmetics");
    expect(matchShopCategory("자동차")).toBeUndefined();
  });

  it("종류마다 상품이 있고, 띄어쓰기가 달라도 상품 이름을 찾는다", () => {
    for (const key of ["clothes", "shoes", "toys", "cosmetics", "books"] as const) expect(productsOf(key).length).toBeGreaterThan(0);
    expect(findProduct("베이직오버핏후드티", productsOf("clothes"))?.id).toBe("c1");
    expect(findProduct("에어플로우 러닝화", productsOf("clothes"))).toBeUndefined();
  });

  it("사이즈는 버튼 글자 그대로나 문장 속에서 찾는다", () => {
    const sizes = ["S", "M", "L", "XL"];
    expect(findSize("M", sizes)).toBe("M");
    expect(findSize("xl로 할게요", sizes)).toBe("XL");
    expect(findSize("260", ["240", "250", "260"])).toBe("260");
    expect(findSize("2600", ["240", "250", "260"])).toBeUndefined();
  });

  it("음성 인식이 소리 나는 대로 적은 사이즈도 알아듣는다", () => {
    const sizes = ["S", "M", "L", "XL"];
    expect(findSize("엠", sizes)).toBe("M");
    expect(findSize("엑스엘로 주세요", sizes)).toBe("XL");
    expect(findSize("라지", sizes)).toBe("L");
    expect(findSize("에스 사이즈", sizes)).toBe("S");
  });

  it("수량 질문은 상품·사이즈·단위에 맞춘다", () => {
    expect(shopQuantityQuestion(product("에어플로우 러닝화"), "260")).toBe(
      "에어플로우 러닝화 260은 1켤레에 89,000원이에요.\n몇 켤레 주문할까요?",
    );
    expect(shopQuantityQuestion(product("하루 10분 파이썬"))).toContain("몇 권 주문할까요?");
  });

  it("3만원 이상이면 배송비가 무료, 아니면 3,000원", () => {
    expect(shippingFeeFor(29999)).toBe(3000);
    expect(shippingFeeFor(30000)).toBe(0);
    const order = makeShopOrder(product("촉촉 립밤 3종 세트"), undefined, 2);
    expect(order).toMatchObject({ kind: "shop", qty: 2, unit: "개", shippingFee: 3000, price: 27000 });
  });

  it("배송지는 이 주소로 받거나, 시·구·동·로·길이 들어간 주소를 새로 받는다", () => {
    expect(addressPrompt("제천시 장락동 제천빌라 331호").directLabel).toBe("다른 주소 입력");
    expect(looksLikeAddress("서울시 마포구 연남동 12-3")).toBe(true);
    expect(looksLikeAddress("제천시 의림대로 210")).toBe(true);
    expect(looksLikeAddress("집으로")).toBe(false);
  });

  it("주문서·결제 요약·완료 문구에 사이즈·배송비·배송지가 들어간다", () => {
    const order = makeShopOrder(product("와이드 데님 팬츠"), "L", 1, "서울시 마포구 연남동 12-3");
    expect(orderCardRows(order)).toEqual([
      { label: "판매처", value: "블루라인" },
      { label: "상품", value: "와이드 데님 팬츠 (L) 1벌" },
      { label: "상품 금액", value: "45,000원" },
      { label: "배송비", value: "무료" },
      { label: "결제 금액", value: "45,000원", emphasis: true },
      { label: "배송지", value: "서울시 마포구 연남동 12-3" },
    ]);
    expect(orderSummaryRows(order).map((r) => r.label)).toEqual(["상품", "판매처", "배송지"]);
    const done = completionText(order, findPayment("카카오페이")!, new Date(2026, 9, 1, 10, 0));
    expect(done).toMatch(/주문번호: S\d{6}/);
    expect(done).toContain("블루라인 와이드 데님 팬츠 (L) 1벌");
    expect(done).toContain("도착 예정: 10월 3일 (토)");
  });
});
