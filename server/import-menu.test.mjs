import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.mjs";
import { applyMenuImport, planMenuImport } from "./import-menu.mjs";
import { listedMenu } from "./stores.mjs";

const newDb = () => {
  const db = openDb(":memory:");
  const store = db.addStore({ name: "시험 치킨집", food: "chicken", hours: "16:30 - 02:30" });
  return { db, storeId: store.id };
};
// 메뉴 목록 파일 견본: 한 마리 메뉴는 판매 중지로 두고 1마리 치킨·세트(맛 고르기)로 파는 가게
const FLAVORS = [
  { name: "후라이드", extra: 0 },
  { name: "양념", extra: 0 },
  { name: "뿌링클", extra: 1000 },
];
const menuFile = () => ({
  storeName: "시험 치킨집",
  items: [
    { name: "1마리 치킨", price: 18000, unit: "마리", keywords: ["치킨"], choice: { label: "맛", count: 1, options: FLAVORS } },
    { name: "2마리 치킨 세트", price: 26000, unit: "세트", keywords: ["세트", "치킨"], choice: { label: "맛", count: 2, options: FLAVORS } },
    { name: "후라이드치킨", price: 18000, unit: "마리", keywords: ["후라이드"], active: false },
    { name: "양념치킨", price: 18000, unit: "마리", keywords: ["양념"], active: false },
    { name: "컵밥", price: 2000, unit: "개", keywords: ["컵밥"] },
  ],
  excluded: [{ name: "맥주", reason: "주류 성인 확인 기능이 없다" }],
});

describe("메뉴 목록 파일 한꺼번에 넣기 (import-menu.mjs)", () => {
  it("메뉴 파일을 넣고, 한 마리 메뉴는 판매 중지로, 1마리 치킨·세트는 맛 고르기를 붙여 판다. 다시 돌리면 건너뛴다", () => {
    const { db, storeId } = newDb();
    const data = menuFile();
    const plan = planMenuImport(db, storeId, data);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.add.length, 5);
    applyMenuImport(db, plan);
    const menu = listedMenu(db).filter((d) => d.restaurantId === storeId);
    assert.equal(menu.length, 5);
    assert.deepEqual(menu.filter((d) => d.active).map((d) => d.name), ["1마리 치킨", "2마리 치킨 세트", "컵밥"]);
    // 한 마리 메뉴는 판매 중지 (사장님 화면에서 다시 팔 수 있게 남겨 둔다)
    assert.equal(menu.find((d) => d.name === "양념치킨").active, false);
    const set2 = menu.find((d) => d.name === "2마리 치킨 세트");
    assert.equal(set2.choice.count, 2);
    assert.deepEqual(set2.choice.options.find((o) => o.name === "뿌링클"), { name: "뿌링클", extra: 1000 });
    const one = menu.find((d) => d.name === "1마리 치킨");
    assert.equal(one.price, 18000);
    assert.equal(one.choice.count, 1);
    assert.deepEqual(one.choice.options, set2.choice.options);
    assert.ok(!menu.some((d) => d.name === "맥주")); // excluded 는 읽지 않는다

    // 다시 돌리면 이미 있는 메뉴는 건너뛴다
    const again = planMenuImport(db, storeId, data);
    assert.equal(again.add.length, 0);
    assert.equal(again.skip.length, 5);
  });

  it("--update: 이미 있는 메뉴를 파일대로 고친다 (맛 고르기 붙이기, 판매 중지·다시 판매). 가격은 고치지 않는다", () => {
    const { db, storeId } = newDb();
    // 예전 파일처럼 맛 고르기 없이 모두 판매 중으로 넣어 둔 상태
    const old = menuFile();
    old.items = old.items.map(({ choice: _c, active: _a, ...item }) => item);
    applyMenuImport(db, planMenuImport(db, storeId, old));
    const sideId = listedMenu(db).find((d) => d.name === "컵밥").id;

    const plan = planMenuImport(db, storeId, menuFile(), { update: true });
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.add.length, 0);
    assert.equal(plan.update.length, 4); // 1마리 치킨·세트(맛 고르기) + 한 마리 메뉴 2개(판매 중지)
    assert.deepEqual(plan.update.find((u) => u.name === "2마리 치킨 세트").changes, ["choice"]);
    assert.deepEqual(plan.update.find((u) => u.name === "양념치킨").changes, ["active"]);
    applyMenuImport(db, plan);
    const menu = listedMenu(db).filter((d) => d.restaurantId === storeId);
    assert.equal(menu.filter((d) => d.active).length, 3);
    assert.equal(menu.find((d) => d.name === "2마리 치킨 세트").choice.count, 2);
    assert.equal(menu.find((d) => d.id === sideId).active, true);
    // 한 번 더 돌리면 고칠 게 없다
    assert.equal(planMenuImport(db, storeId, menuFile(), { update: true }).update.length, 0);
  });

  it("규칙에 맞지 않는 메뉴·맛이 하나라도 있으면 아무것도 바꾸지 않는다", () => {
    const { db, storeId } = newDb();
    const plan = planMenuImport(db, storeId, {
      items: [
        { name: "괜찮은 메뉴", price: 10000, unit: "마리", keywords: [] },
        { name: "너무 싼 메뉴", price: 50, unit: "개", keywords: [] },
        { name: "괜찮은 메뉴", price: 10000, unit: "마리", keywords: [] },
        { name: "맛이 모자란 세트", price: 20000, unit: "세트", choice: { count: 3, options: [{ name: "간장", extra: 0 }, { name: "양념", extra: 0 }] } },
        { name: "추가금이 이상한 세트", price: 20000, unit: "세트", choice: { count: 1, options: [{ name: "간장", extra: -500 }] } },
      ],
    });
    assert.deepEqual(plan.errors.map((e) => e.name), ["너무 싼 메뉴", "괜찮은 메뉴", "맛이 모자란 세트", "추가금이 이상한 세트"]);
    assert.throws(() => applyMenuImport(db, plan), /바꾸지 않았어요/);
    assert.equal(db.listMenu().filter((d) => d.restaurantId === storeId).length, 0);
    assert.match(planMenuImport(db, "nope", { items: [] }).errors[0].error, /없는 매장/);
  });
});
