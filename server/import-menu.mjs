// 메뉴 목록 파일(server/menus/*.json)을 한 매장의 배달 메뉴로 한꺼번에 넣는다. 사장님 화면의 "메뉴 추가"와 같은 규칙으로 검사한다.
// 기본은 미리 보기만 하고, --apply 를 붙여야 실제로 넣는다. 그 매장에 이미 판매 중인 같은 이름의 메뉴는 건너뛴다.
//
//   운영 서버 (파일은 표준 입력으로 넘긴다. 이미지에 menus/ 를 넣지 않아도 된다):
//     docker compose -f docker-compose.prod.yml exec -T api node import-menu.mjs --store <매장 id> < server/menus/파일.json
//     docker compose -f docker-compose.prod.yml exec -T api node import-menu.mjs --store <매장 id> --apply < server/menus/파일.json
//   로컬 개발:
//     node server/import-menu.mjs --db server/data/saylo.db --store <매장 id> --file server/menus/파일.json [--apply]
//
// 파일 모양: { "items": [{ "name", "price", "unit", "keywords": [] }], "excluded": [...] }  (excluded 는 읽지 않는다)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "./db.mjs";
import { MENU_KEYWORDS_MAX, MENU_NAME_MAX, MENU_PRICE_MAX, MENU_PRICE_MIN, MENU_UNIT_MAX, findStore } from "./stores.mjs";

const squash = (s) => String(s).replace(/\s+/g, "").toLowerCase();

// 넣을 계획: { store, add: [메뉴], skip: [{ name, reason }], errors: [{ name, error }] }. errors 가 하나라도 있으면 아무것도 넣지 않는다
export function planMenuImport(db, storeId, data) {
  const store = findStore(db, storeId);
  if (!store) return { store: null, add: [], skip: [], errors: [{ name: "-", error: `없는 매장이에요: ${storeId}` }] };
  const selling = new Set(db.listMenu().filter((d) => d.restaurantId === storeId && d.active).map((d) => d.name));
  const items = Array.isArray(data?.items) ? data.items : [];
  const plan = { store, add: [], skip: [], errors: [] };
  const seen = new Set();
  if (items.length === 0) plan.errors.push({ name: "-", error: "items 가 비어 있어요." });
  for (const raw of items) {
    const name = String(raw?.name ?? "").trim().replace(/\s+/g, " ");
    const price = Number(raw?.price);
    const unit = String(raw?.unit ?? "").trim();
    const keywords = [...new Set((Array.isArray(raw?.keywords) ? raw.keywords : []).map(squash))].filter((k) => k && k.length <= 15);
    const error =
      !name || name.length > MENU_NAME_MAX ? `메뉴 이름은 1~${MENU_NAME_MAX}자` :
      !Number.isInteger(price) || price < MENU_PRICE_MIN || price > MENU_PRICE_MAX ? `가격은 ${MENU_PRICE_MIN}~${MENU_PRICE_MAX}원 정수` :
      !unit || unit.length > MENU_UNIT_MAX ? `단위는 1~${MENU_UNIT_MAX}자` :
      keywords.length > MENU_KEYWORDS_MAX ? `키워드는 ${MENU_KEYWORDS_MAX}개까지` :
      seen.has(name) ? "파일 안에 같은 이름이 또 있어요" : null;
    seen.add(name);
    if (error) plan.errors.push({ name: name || "(이름 없음)", error });
    else if (selling.has(name)) plan.skip.push({ name, reason: "이미 판매 중" });
    else plan.add.push({ restaurantId: storeId, name, price, unit, keywords });
  }
  return plan;
}

// 계획대로 넣고 넣은 메뉴를 돌려준다 (검사 오류가 있으면 아무것도 넣지 않는다)
export function applyMenuImport(db, plan) {
  if (plan.errors.length) throw new Error("검사 오류가 있어 넣지 않았어요.");
  return plan.add.map((item) => db.addMenuItem(item));
}

function args(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--store" || a === "--file" || a === "--db") out[a.slice(2)] = argv[++i];
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const opt = args(process.argv.slice(2));
  if (!opt.store) {
    console.error("사용법: node import-menu.mjs --store <매장 id> [--file 파일.json | < 파일.json] [--db DB 경로] [--apply]");
    process.exit(2);
  }
  const text = opt.file && opt.file !== "-" ? readFileSync(opt.file, "utf8") : readFileSync(0, "utf8");
  const dbPath = opt.db ?? join(process.env.DATA_DIR ?? join(import.meta.dirname, "data"), "saylo.db");
  const db = openDb(dbPath);
  const plan = planMenuImport(db, opt.store, JSON.parse(text));
  console.log(`매장: ${plan.store ? `${plan.store.name} (${opt.store})` : opt.store} · DB ${dbPath}`);
  for (const d of plan.add) console.log(`  넣기  ${d.name} · ${d.price.toLocaleString("ko-KR")}원 / ${d.unit} · ${d.keywords.join(", ")}`);
  for (const s of plan.skip) console.log(`  건너뜀 ${s.name} (${s.reason})`);
  for (const e of plan.errors) console.log(`  오류  ${e.name}: ${e.error}`);
  console.log(`넣기 ${plan.add.length} · 건너뜀 ${plan.skip.length} · 오류 ${plan.errors.length}`);
  if (plan.errors.length) process.exitCode = 1;
  else if (!opt.apply) console.log("미리 보기만 했어요. 넣으려면 --apply 를 붙여 다시 실행하세요.");
  else console.log(`넣었어요: ${applyMenuImport(db, plan).length}개`);
  db.close();
}
