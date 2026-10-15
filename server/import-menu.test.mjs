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

describe("메뉴 목록 파일 한꺼번에 넣기 (import-menu.mjs)", () => {
  it("못말리는파닭 메뉴 파일은 검사 오류 없이 38개를 넣고, 넣은 메뉴는 메뉴 목록에 나온다", () => {
    const { db, storeId } = newDb();
    const data = JSON.parse(readFileSync(new URL("./menus/motmalri-padak.json", import.meta.url), "utf8"));
    const plan = planMenuImport(db, storeId, data);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.add.length, 38);
    const added = applyMenuImport(db, plan);
    assert.equal(added.length, 38);
    const menu = listedMenu(db).filter((d) => d.restaurantId === storeId);
    assert.equal(menu.length, 38);
    const wing = menu.find((d) => d.name === "간장파닭");
    assert.deepEqual([wing.price, wing.unit, wing.active], [18000, "마리", true]);
    assert.deepEqual(wing.keywords, ["간장", "파닭", "치킨"]);
    // 사이드에는 "치킨" 키워드를 넣지 않는다 ("치킨 시켜줘"에 콜라·떡볶이가 섞이지 않게)
    assert.ok(!menu.find((d) => d.name === "컵밥").keywords.includes("치킨"));
    // 빼기로 한 항목(주류·배달비·추가 옵션)은 들어가지 않는다
    for (const name of ["카스", "공기밥", "행복주택 제이앤비 (지역 배달비)"]) assert.ok(!menu.some((d) => d.name === name));

    // 다시 돌리면 이미 판매 중인 메뉴는 건너뛴다
    const again = planMenuImport(db, storeId, data);
    assert.equal(again.add.length, 0);
    assert.equal(again.skip.length, 38);
  });

  it("규칙에 맞지 않는 메뉴가 하나라도 있으면 아무것도 넣지 않는다", () => {
    const { db, storeId } = newDb();
    const plan = planMenuImport(db, storeId, {
      items: [
        { name: "괜찮은 메뉴", price: 10000, unit: "마리", keywords: [] },
        { name: "너무 싼 메뉴", price: 50, unit: "개", keywords: [] },
        { name: "괜찮은 메뉴", price: 10000, unit: "마리", keywords: [] },
      ],
    });
    assert.deepEqual(plan.errors.map((e) => e.name), ["너무 싼 메뉴", "괜찮은 메뉴"]);
    assert.throws(() => applyMenuImport(db, plan), /넣지 않았어요/);
    assert.equal(db.listMenu().filter((d) => d.restaurantId === storeId).length, 0);
    assert.match(planMenuImport(db, "nope", { items: [] }).errors[0].error, /없는 매장/);
  });
});
