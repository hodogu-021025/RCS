import { describe, expect, it } from "vitest";
import {
  detectIntent,
  editDistance,
  foodWord,
  fuzzyFind,
  isOpenNow,
  jamo,
  mealOf,
  parsePeople,
  parseReservationSlots,
  recommendItems,
  refersToItem,
  refersToPlace,
  restaurantNamed,
  soldOutItemNamed,
  usableSlots,
  alternativesFor,
  deliversFood,
} from "./understanding";
import { FOODS, RESTAURANTS, restaurantById } from "./orderChatKnowledge";
import { getDb, refresh } from "../data/db";
import { server } from "../test/setup";

const at = (h: number, m = 0) => new Date(2026, 9, 10, h, m); // 2026-10-10 (토)

describe("의도 알아듣기", () => {
  it.each([
    ["배고파", "hungry"],
    ["뭐 먹지", "hungry"],
    ["추천해줘", "hungry"],
    ["메뉴 뭐 있어?", "hungry"],
    ["출출하다", "hungry"],
    ["안녕하세요", "greeting"],
    ["고마워요", "thanks"],
    ["감사합니다", "thanks"],
    ["내 주문 어디쯤 왔어", "orderStatus"],
    ["치킨 언제 와요?", "orderStatus"],
    ["주문 취소할래", "orderCancel"],
    ["배달 취소해 주세요", "orderCancel"],
    ["영업시간 알려줘", "storeInfo"],
    ["장락반점 어디에 있어?", "storeInfo"],
    ["몇 시까지 해요?", "storeInfo"],
    ["제일 가까운 식당", "nearest"],
    ["늘 먹던 거", "reorder"],
    ["지난번 메뉴 다시 주문", "reorder"],
  ])("%s → %s", (text, intent) => {
    expect(detectIntent(text)).toBe(intent);
  });

  it("주문하는 말은 의도로 잡지 않는다 (배달 흐름이 처리한다)", () => {
    for (const text of ["간장치킨 2마리 시켜줘", "피자 주문할래", "한식 먹고 싶어", "배달"]) expect(detectIntent(text)).toBeUndefined();
  });

  it("앞에서 말한 식당·메뉴를 가리키는 말", () => {
    expect(refersToPlace("그 식당 예약할래")).toBe(true);
    expect(refersToPlace("거기 몇 시까지 해?")).toBe(true);
    expect(refersToPlace("근처 식당")).toBe(false);
    expect(refersToItem("아까 그거 하나 더")).toBe(true);
    expect(refersToItem("같은 걸로 2개")).toBe(true);
    expect(refersToItem("간장치킨")).toBe(false);
  });
});

describe("오타·비슷한 이름", () => {
  it("한글을 자모로 풀어 거리를 잰다", () => {
    expect(jamo("간장")).toBe("ㄱㅏㄴㅈㅏㅇ");
    expect(editDistance(jamo("깐장치킨"), jamo("간장치킨"))).toBe(1);
  });

  it.each([
    ["깐장치킨", "간장치킨"],
    ["마르게리타 피자", "마르게리따 피자"],
    ["옛날통닥", "옛날통닭"],
    ["할머니국밥", "장락 할매국밥"],
    ["장락반졈 예약", "장락반점"],
  ])("%s → %s", (text, name) => {
    expect(fuzzyFind(text)?.name).toBe(name);
  });

  it("상관없는 말은 비슷한 이름으로 엮지 않는다", () => {
    for (const text of ["안녕하세요", "우주 음식", "오늘 날씨 어때", "국밥 먹고 싶어"]) expect(fuzzyFind(text)).toBeUndefined();
  });

  it("문장에 식당 이름이 들어 있으면 그 식당", () => {
    expect(restaurantNamed("장락반점 영업시간")?.id).toBe("c1");
    expect(restaurantNamed("짜장면")).toBeUndefined();
  });
});

describe("예약 정보 한 번에 받기", () => {
  const now = at(10);
  it("날짜·시간·인원을 같이 뽑는다", () => {
    const s = parseReservationSlots("내일 저녁 7시 4명 중식당 예약", now);
    expect(s.date).toEqual(new Date(2026, 9, 11));
    expect(s.time).toBe("19:00");
    expect(s.people).toBe(4);
  });

  it("인원은 명·사람이 붙을 때만 본다", () => {
    expect(parsePeople("치킨 2마리")).toBeUndefined();
    expect(parsePeople("7시")).toBeUndefined();
    expect(parsePeople("둘이서 갈게")).toBe(2);
    expect(parsePeople("혼자요")).toBe(1);
    expect(parsePeople("다섯 명")).toBe(5);
    expect(parsePeople("6사람")).toBe(6);
  });

  it("그 식당에서 쓸 수 없는 값은 버리고 이유를 알려 준다", () => {
    const r = restaurantById("c1"); // 11:00 - 21:00
    expect(usableSlots(r, { time: "23:00", people: 2 }, now)).toEqual({
      slots: { people: 2 },
      issue: "23:00에는 예약할 수 없어요. 마감 1시간 전까지 예약할 수 있어요.",
    });
    expect(usableSlots(r, { date: new Date(2026, 9, 10), time: "09:00" }, at(10)).slots.time).toBeUndefined();
    expect(usableSlots(r, { time: "19:00" }, now)).toEqual({ slots: { time: "19:00" }, issue: undefined });
  });
});

describe("추천", () => {
  it("시간대를 나눈다", () => {
    expect([at(8), at(12), at(15), at(19), at(23), at(2)].map(mealOf)).toEqual(["breakfast", "lunch", "afternoon", "dinner", "late", "late"]);
  });

  it("지금 시간대에 어울리는 메뉴가 앞에 온다 (catalog.json 의 meals)", () => {
    // 아침: 분식(떡볶이)이 아침 메뉴, 치킨·피자는 아님
    expect(recommendItems(at(8))[0].name).toBe("국물떡볶이");
    // 야식: 치킨·피자
    expect(recommendItems(at(23)).map((d) => d.name)).toEqual(["옛날통닭", "간장치킨", "마르게리따 피자"]);
  });

  it("같은 시간대 안에서는 최근 많이 주문된 메뉴가 앞에 온다", async () => {
    for (let i = 0; i < 3; i++) server.db.addOrder({ customer: "guest", customerName: "비회원", payment: "카드", storeId: "h3", order: { item: "간장치킨" } });
    await refresh(["popular"]);
    expect(getDb().popular.items.d2).toBe(3);
    expect(recommendItems(at(23))[0].name).toBe("간장치킨");
  });

  it("영업 중인지 (자정 넘겨 닫는 곳 포함)", () => {
    const h3 = RESTAURANTS.find((r) => r.id === "h3")!; // 16:00 - 01:00
    expect(isOpenNow(h3, at(15, 59))).toBe(false);
    expect(isOpenNow(h3, at(23))).toBe(true);
    expect(isOpenNow(h3, at(0, 30))).toBe(true);
    expect(isOpenNow(h3, at(1))).toBe(false);
  });
});

describe("품절·대체", () => {
  it("품절인 메뉴 이름을 그대로 말하면 그 메뉴를, 대신 권할 메뉴는 비슷한 것부터", async () => {
    server.db.updateStoreSettings("h3", { item: { id: "d2", patch: { soldOut: true } } });
    await refresh(["settings"]);
    const gone = soldOutItemNamed("간장치킨 시켜줘")!;
    expect(gone.name).toBe("간장치킨");
    expect(alternativesFor(gone).map((d) => d.name)).toEqual(["옛날통닭"]);
    expect(soldOutItemNamed("옛날통닭")).toBeUndefined();
  });

  it("배달 메뉴가 없는 음식 종류와, 문장 속 음식 낱말", () => {
    const chinese = FOODS.find((f) => f.key === "chinese")!;
    expect(deliversFood(chinese)).toBe(false);
    expect(deliversFood(FOODS.find((f) => f.key === "chicken")!)).toBe(true);
    expect(foodWord("짜장면을 배달해줘", chinese)).toBe("짜장면");
  });
});
