import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb } from "./db.mjs";
import { applyMenuImport, planMenuImport } from "./import-menu.mjs";
import { listedMenu } from "./stores.mjs";

const newDb = () => {
  const db = openDb(":memory:");
  const store = db.addStore({ name: "시험 파닭", food: "chicken", hours: "16:30 - 02:30" });
  return { db, storeId: store.id };
};
const menuFile = () => JSON.parse(readFileSync(new URL("./menus/motmalri-padak.json", import.meta.url), "utf8"));

describe("메뉴 목록 파일 한꺼번에 넣기 (import-menu.mjs)", () => {
  it("못말리는파닭 메뉴 파일: 38개를 넣고, 치킨은 세트 3개만 팔며 세트에는 맛 고르기가 붙는다", () => {
    const { db, storeId } = newDb();
    const data = menuFile();
    const plan = planMenuImport(db, storeId, data);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.add.length, 38);
    applyMenuImport(db, plan);
    const menu = listedMenu(db).filter((d) => d.restaurantId === storeId);
    assert.equal(menu.length, 38);
    const selling = menu.filter((d) => d.active);
    assert.equal(selling.length, 13);
    // 한 마리 메뉴는 판매 중지 (사장님 화면에서 다시 팔 수 있게 남겨 둔다)
    assert.equal(menu.find((d) => d.name === "간장파닭").active, false);
    const set2 = menu.find((d) => d.name === "2마리 치킨 세트");
    assert.equal(set2.active, true);
    assert.equal(set2.choice.count, 2);
    assert.equal(set2.choice.options.length, 23);
    assert.deepEqual(set2.choice.options.find((o) => o.name === "블랙스완 파닭"), { name: "블랙스완 파닭", extra: 1000 });
    assert.ok(!set2.choice.options.some((o) => o.name.includes("수원왕갈비"))); // 빠진 메뉴
    assert.equal(menu.find((d) => d.name === "4마리 치킨 세트").choice.count, 4);
    // 사이드에는 "치킨" 키워드를 넣지 않는다 ("치킨 시켜줘"에 떡볶이가 섞이지 않게)
    assert.ok(!menu.find((d) => d.name === "컵밥").keywords.includes("치킨"));
    for (const name of ["카스", "공기밥", "행복주택 제이앤비 (지역 배달비)"]) assert.ok(!menu.some((d) => d.name === name));

    // 다시 돌리면 이미 있는 메뉴는 건너뛴다
    const again = planMenuImport(db, storeId, data);
    assert.equal(again.add.length, 0);
    assert.equal(again.skip.length, 38);
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
    assert.equal(plan.update.length, 28); // 세트 3개(맛 고르기) + 한 마리 메뉴 25개(판매 중지)
    assert.deepEqual(plan.update.find((u) => u.name === "3마리 치킨 세트").changes, ["choice"]);
    assert.deepEqual(plan.update.find((u) => u.name === "양념파닭").changes, ["active"]);
    applyMenuImport(db, plan);
    const menu = listedMenu(db).filter((d) => d.restaurantId === storeId);
    assert.equal(menu.filter((d) => d.active).length, 13);
    assert.equal(menu.find((d) => d.name === "3마리 치킨 세트").choice.count, 3);
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
