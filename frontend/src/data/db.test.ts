import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DELIVERY_MENU,
  availableDeliveryMenu,
  deliveryPrompt,
  findDeliveryItems,
  isWithinHours,
  makeOrder,
  nearbyRestaurants,
  restaurantById,
} from "../components/orderChatKnowledge";
import { addOrder, addReservation, getDb, resetDb, seedDemoData, setMenuItem, setOrderStatus, setStoreHours, subscribe } from "./db";
import { makeDemoRecords } from "./seed";

afterEach(resetDb);
const chicken = DELIVERY_MENU.find((d) => d.name === "간장치킨")!;

describe("주문·예약 기록", () => {
  it("결제한 주문이 매장 id 와 함께 '접수' 상태로 남고, 상태를 바꿀 수 있다", () => {
    const listener = vi.fn();
    subscribe(listener);
    const rec = addOrder(makeOrder(chicken, 2), "카카오페이", { username: "user", name: "김소비" });
    expect(rec).toMatchObject({ status: "접수", storeId: "h3", customer: "user", payment: "카카오페이" });
    expect(getDb().orders[0].order.price).toBe(40000);
    setOrderStatus(rec.id, "준비 중");
    expect(getDb().orders[0].status).toBe("준비 중");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("비로그인 주문은 비회원으로 남는다", () => {
    expect(addOrder(makeOrder(chicken, 1), "토스페이")).toMatchObject({ customer: "guest", customerName: "비회원" });
  });

  it("예약은 날짜를 YYYY-MM-DD 로 남긴다", () => {
    const rec = addReservation({ restaurantId: "c1", restaurantName: "장락반점", date: new Date(2026, 9, 2), time: "19:00", people: 2 });
    expect(rec).toMatchObject({ date: "2026-10-02", status: "예약 확정", restaurantId: "c1" });
  });

  it("보기 데이터는 비어 있을 때만 들어간다", () => {
    seedDemoData(() => makeDemoRecords(new Date(2026, 9, 9, 12, 0).getTime()));
    expect(getDb().orders.length).toBe(7);
    addOrder(makeOrder(chicken, 1), "토스페이");
    seedDemoData(() => makeDemoRecords());
    expect(getDb().orders.length).toBe(8);
  });
});

describe("사장님이 바꾼 매장 설정이 챗봇에 반영된다", () => {
  it("영업시간을 바꾸면 예약 가능 시간이 따라간다", () => {
    expect(isWithinHours(restaurantById("c1"), "20:00")).toBe(true);
    setStoreHours("c1", "11:00 - 18:00");
    expect(restaurantById("c1").hours).toBe("11:00 - 18:00");
    expect(nearbyRestaurants("chinese").find((r) => r.id === "c1")?.hours).toBe("11:00 - 18:00");
    expect(isWithinHours(restaurantById("c1"), "20:00")).toBe(false);
  });

  it("가격을 바꾸면 주문서 금액이, 품절시키면 메뉴 버튼과 검색에서 빠진다", () => {
    setMenuItem("h3", "d2", { price: 22000 });
    const item = findDeliveryItems("간장치킨")[0];
    expect(item.price).toBe(22000);
    expect(makeOrder(item, 2).price).toBe(44000);

    setMenuItem("h3", "d2", { soldOut: true });
    expect(findDeliveryItems("간장치킨")).toEqual([]);
    expect(availableDeliveryMenu().map((d) => d.name)).not.toContain("간장치킨");
    expect(deliveryPrompt().choices?.map((c) => c.label)).toEqual(["옛날통닭", "마르게리따 피자", "국물떡볶이"]);
    // "치킨" 은 이제 옛날통닭 하나만 가리킨다
    expect(findDeliveryItems("치킨 시켜줘").map((d) => d.id)).toEqual(["d1"]);
  });
});
