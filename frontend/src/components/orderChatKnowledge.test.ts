import { describe, expect, it } from "vitest";
import {
  DELIVERY_MENU,
  deliveryPrompt,
  RESTAURANTS,
  bookableTimes,
  checkVisitTime,
  completionText,
  findDeliveryItems,
  findPayment,
  findRestaurant,
  formatDate,
  isNo,
  isBookableDate,
  isWithinHours,
  isYes,
  km,
  makeOrder,
  matchFood,
  nearbyRestaurants,
  parseQuantity,
  parseVisitDate,
  parseVisitTime,
  quantityQuestion,
  reservationDoneText,
  timeChoices,
  withObjectParticle,
  withTopicParticle,
  won,
} from "./orderChatKnowledge";

const item = (name: string) => DELIVERY_MENU.find((d) => d.name === name)!;

describe("isYes / isNo", () => {
  it("긍정·부정 답을 구분한다", () => {
    expect(isYes("응 해줘")).toBe(true);
    expect(isYes("OK")).toBe(true);
    expect(isNo("아니 취소할래")).toBe(true);
    expect(isNo("응 해줘")).toBe(false);
  });
});

describe("배달 메뉴", () => {
  it("배달·식당 어디에도 황금올리브는 없고, 배달 예시는 다른 메뉴들이다", () => {
    expect(deliveryPrompt().choices?.map((c) => c.label)).toEqual(["옛날통닭", "간장치킨", "마르게리따 피자", "국물떡볶이"]);
    expect(DELIVERY_MENU.some((d) => d.name.includes("황금올리브"))).toBe(false);
    expect(RESTAURANTS.some((r) => r.signature.includes("황금올리브") || r.name.includes("BBQ"))).toBe(false);
  });

  it("메뉴 이름이 있으면 그 메뉴 하나, 종류만 말하면 해당 메뉴 전부를 찾는다", () => {
    expect(findDeliveryItems("마르게리따피자 2판").map((d) => d.id)).toEqual(["d3"]);
    expect(findDeliveryItems("간장 치킨 줘").map((d) => d.id)).toEqual(["d2"]);
    expect(findDeliveryItems("치킨 시켜줘").map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(findDeliveryItems("짜장면")).toEqual([]);
  });

  it("숫자·한글 수량을 읽고, 수량이 없으면 undefined", () => {
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("3마리")).toBe(3);
    expect(parseQuantity("두 마리")).toBe(2);
    expect(parseQuantity("둘")).toBe(2);
    expect(parseQuantity("다섯 판")).toBe(5);
    expect(parseQuantity("옛날통닭 시켜줘")).toBeUndefined();
    // 단위 없는 한·두·세·네 는 수량으로 보지 않는다
    expect(parseQuantity("한식")).toBeUndefined();
    expect(parseQuantity("네 주세요")).toBeUndefined();
  });

  it("수량 질문은 매장·1단위 가격을 알려 주고 단위에 맞춰 묻는다", () => {
    expect(quantityQuestion(item("국물떡볶이"))).toBe("국물떡볶이는 장락 떡볶이에서 1인분 6,000원이에요.\n몇 인분 주문할까요?");
    expect(quantityQuestion(item("옛날통닭"))).toContain("옛날통닭은 장락 옛날통닭에서 1마리 18,000원이에요.");
    expect(quantityQuestion(item("간장치킨"), "수량을 잘 모르겠어요.")).toBe("수량을 잘 모르겠어요.\n몇 마리 주문할까요?");
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

describe("식당 찾기", () => {
  it("음식 종류나 메뉴 이름으로 카테고리를 찾는다", () => {
    expect(matchFood("한식")?.key).toBe("korean");
    expect(matchFood("짬뽕 먹고 싶어")?.key).toBe("chinese");
    expect(matchFood("삼겹살")?.key).toBe("meat");
    expect(matchFood("아무거나")).toBeUndefined();
  });

  it("해당 음식을 다루는 식당만 가까운 순으로 돌려준다", () => {
    const list = nearbyRestaurants("chinese");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r) => r.food === "chinese")).toBe(true);
    expect(list.map((r) => r.distanceKm)).toEqual([...list.map((r) => r.distanceKm)].sort((a, b) => a - b));
  });

  it("띄어쓰기가 달라도 목록에서 식당 이름을 찾는다", () => {
    const list = nearbyRestaurants("korean");
    expect(findRestaurant("장락할매국밥", list)?.id).toBe("k1");
    expect(findRestaurant("장락반점", list)).toBeUndefined();
  });

  it("받침에 맞춰 을/를을 붙인다", () => {
    expect(withObjectParticle("장락반점")).toBe("장락반점을");
    expect(withObjectParticle("하소 피자키친")).toBe("하소 피자키친을");
    expect(withObjectParticle("장락 떡볶이")).toBe("장락 떡볶이를");
    expect(withObjectParticle("Saylo")).toBe("Saylo를");
    expect(withTopicParticle("러닝화 260")).toBe("러닝화 260은");
    expect(withTopicParticle("후드티 S")).toBe("후드티 S는");
    expect(withObjectParticle("2마리")).toBe("2마리를");
    expect(withObjectParticle("1판")).toBe("1판을");
    expect(withObjectParticle("메뉴!")).toBe("메뉴!을(를)");
    expect(withTopicParticle("간장치킨")).toBe("간장치킨은");
    expect(withTopicParticle("마르게리따 피자")).toBe("마르게리따 피자는");
    expect(km(0.5)).toBe("0.5km");
  });
});

describe("식당 예약", () => {
  // 2026-10-01(목) 오전 10시 기준
  const now = new Date(2026, 9, 1, 10, 0);
  const restaurant = (name: string) => RESTAURANTS.find((r) => r.name === name)!;
  const ymd = (d: unknown) => (d instanceof Date ? `${d.getMonth() + 1}/${d.getDate()}` : d);

  it("오늘·내일·모레와 날짜 표현을 읽고, 지난 날·너무 먼 날은 구분한다", () => {
    expect(ymd(parseVisitDate("내일", now))).toBe("10/2");
    expect(ymd(parseVisitDate("모레 갈게", now))).toBe("10/3");
    expect(ymd(parseVisitDate("10월 5일", now))).toBe("10/5");
    expect(ymd(parseVisitDate("10/7", now))).toBe("10/7");
    expect(ymd(parseVisitDate("3일", now))).toBe("10/3");
    expect(parseVisitDate("9월 30일", now)).toBe("past");
    expect(parseVisitDate("12월 25일", now)).toBe("far");
    expect(parseVisitDate("2월 30일", now)).toBeUndefined();
    expect(parseVisitDate("언제든", now)).toBeUndefined();
    expect(formatDate(new Date(2026, 9, 2))).toBe("10월 2일 (금)");
  });

  it("시간 표현을 24시간제로 읽는다 (오전이라 안 하면 1~9시는 오후)", () => {
    expect(parseVisitTime("19:30")).toBe("19:30");
    expect(parseVisitTime("7시")).toBe("19:00");
    expect(parseVisitTime("저녁 7시 반")).toBe("19:30");
    expect(parseVisitTime("오전 11시")).toBe("11:00");
    expect(parseVisitTime("12시 15분")).toBe("12:15");
    expect(parseVisitTime("오후 12:30")).toBe("12:30");
    expect(parseVisitTime("오전 12:30")).toBe("00:30");
    expect(parseVisitTime("오후 7:30")).toBe("19:30");
    expect(parseVisitTime("아무 때나")).toBeUndefined();
  });

  it("영업시간 안이면서 마감 1시간 전까지만 받고, 자정 넘어 닫는 곳도 처리한다", () => {
    const chinese = restaurant("장락반점"); // 11:00 - 21:00
    expect(isWithinHours(chinese, "11:00")).toBe(true);
    expect(isWithinHours(chinese, "20:00")).toBe(true);
    expect(isWithinHours(chinese, "20:30")).toBe(false);
    expect(isWithinHours(chinese, "10:30")).toBe(false);
    const lateChicken = restaurant("청전 치킨공방"); // 16:00 - 01:00
    expect(isWithinHours(lateChicken, "23:30")).toBe(true);
    expect(isWithinHours(lateChicken, "00:30")).toBe(false);
  });

  it("오늘은 지난 시간을 빼고 시간 선택지를 준다", () => {
    const today = new Date(2026, 9, 1);
    const evening = new Date(2026, 9, 1, 18, 30);
    expect(checkVisitTime(restaurant("장락반점"), today, "18:00", evening)).toBe("past");
    expect(timeChoices(restaurant("장락반점"), today, evening).map((c) => c.value)).toEqual(["19:00", "20:00"]);
    expect(timeChoices(restaurant("장락반점"), today, new Date(2026, 9, 1, 20, 30))).toEqual([]);
  });

  it("고르기 화면용: 10분 단위 예약 가능 시각과 달력에서 고를 수 있는 날", () => {
    const chinese = restaurant("장락반점"); // 11:00 - 21:00
    const tomorrow = new Date(2026, 9, 2);
    const times = bookableTimes(chinese, tomorrow, now);
    expect(times[0]).toBe("11:00");
    expect(times.at(-1)).toBe("20:00");
    expect(times).toContain("19:30");
    // 오늘 20:30 이후면 남은 시각이 없어 달력에서 막힌다
    expect(isBookableDate(chinese, new Date(2026, 9, 1), new Date(2026, 9, 1, 20, 30))).toBe(false);
    expect(isBookableDate(chinese, new Date(2026, 9, 31), now)).toBe(true);
    expect(isBookableDate(chinese, new Date(2026, 10, 1), now)).toBe(false);
    expect(isBookableDate(chinese, new Date(2026, 8, 30), now)).toBe(false);
  });

  it("인원은 수량과 같은 규칙으로 읽는다", () => {
    expect(parseQuantity("2명")).toBe(2);
    expect(parseQuantity("두 명")).toBe(2);
    expect(parseQuantity("여섯")).toBe(6);
  });

  it("완료 문구에 예약번호·식당·날짜·시간·인원을 넣는다", () => {
    const text = reservationDoneText({ restaurant: restaurant("장락반점"), date: new Date(2026, 9, 2), time: "19:00", people: 2 }, now);
    expect(text).toContain("예약이 완료되었어요!");
    expect(text).toMatch(/예약번호: R\d{6}/);
    expect(text).toContain("장락반점 · 10월 2일 (금) 19:00 · 2명");
  });
});

describe("makeOrder / completionText", () => {
  it("메뉴의 매장·단위로 주문서를 만들고 수량만큼 가격을 계산한다", () => {
    const order = makeOrder(item("간장치킨"), 2);
    expect(order).toMatchObject({ kind: "delivery", item: "간장치킨", qty: 2, unit: "마리", price: 40000 });
    expect(order.store).toEqual({ name: "청전 치킨공방", distance: "1.8km" });
    expect(won(40000)).toBe("40,000원");
  });

  it("완료 문구에 결제수단·금액·주문번호·단위·도착 예정 시각을 넣는다", () => {
    const text = completionText(makeOrder(item("마르게리따 피자"), 1), findPayment("토스페이")!, new Date(2026, 9, 1, 10, 0));
    expect(text).toContain("토스페이로 19,000원 결제가 완료되었어요");
    expect(text).toMatch(/주문번호: ON\d{6}/);
    expect(text).toContain("장락 화덕피자에서 마르게리따 피자 1판을 준비 중이에요");
    expect(text).toContain("도착 예정: 약 40분 후 (10:40)");
  });
});
