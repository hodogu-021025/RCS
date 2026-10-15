// 메뉴 목록 파일(server/menus/*.json)을 한 매장의 배달 메뉴로 한꺼번에 넣는다. 사장님 화면의 "메뉴 추가"와 같은 규칙으로 검사한다.
// 기본은 미리 보기만 하고, --apply 를 붙여야 실제로 바꾼다.
// 그 매장에 같은 이름의 메뉴가 이미 있으면 건너뛰고, --update 를 붙이면 그 메뉴를 파일대로 고친다
// (판매 여부 active, 맛 고르기 choice, 단위, 키워드. 가격은 사장님 화면의 가격 설정이 앞서므로 고치지 않는다).
//
//   운영 서버 (파일은 표준 입력으로 넘긴다. 이미지에 menus/ 를 넣지 않아도 된다):
//     docker compose -f docker-compose.prod.yml exec -T api node import-menu.mjs --store <매장 id> [--update] < server/menus/파일.json
//     docker compose -f docker-compose.prod.yml exec -T api node import-menu.mjs --store <매장 id> [--update] --apply < server/menus/파일.json
//   로컬 개발:
//     node server/import-menu.mjs --db server/data/saylo.db --store <매장 id> --file server/menus/파일.json [--update] [--apply]
//
// 파일 모양: { "items": [{ "name", "price", "unit", "keywords": [], "active"?: false, "choice"?: { label, count, options: [{ name, extra }] } }],
//             "excluded": [...] }  (excluded 는 읽지 않는다)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "./db.mjs";
import { MENU_KEYWORDS_MAX, MENU_NAME_MAX, MENU_PRICE_MAX, MENU_PRICE_MIN, MENU_UNIT_MAX, cleanChoice, findStore } from "./stores.mjs";

const squash = (s) => String(s).replace(/\s+/g, "").toLowerCase();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// 파일의 메뉴 하나를 검사해 정리한다. 문제가 있으면 { error }
function cleanItem(raw) {
  const name = String(raw?.name ?? "").trim().replace(/\s+/g, " ");
  const price = Number(raw?.price);
  const unit = String(raw?.unit ?? "").trim();
  const keywords = [...new Set((Array.isArray(raw?.keywords) ? raw.keywords : []).map(squash))].filter((k) => k && k.length <= 15);
  const active = raw?.active !== false;
  const choice = raw?.choice ? cleanChoice(raw.choice) : undefined;
  const error =
    !name || name.length > MENU_NAME_MAX ? `메뉴 이름은 1~${MENU_NAME_MAX}자` :
    !Number.isInteger(price) || price < MENU_PRICE_MIN || price > MENU_PRICE_MAX ? `가격은 ${MENU_PRICE_MIN}~${MENU_PRICE_MAX}원 정수` :
    !unit || unit.length > MENU_UNIT_MAX ? `단위는 1~${MENU_UNIT_MAX}자` :
    keywords.length > MENU_KEYWORDS_MAX ? `키워드는 ${MENU_KEYWORDS_MAX}개까지` :
    choice?.error ? `맛 고르기: ${choice.error}` : null;
  return error ? { name: name || "(이름 없음)", error } : { name, price, unit, keywords, active, ...(choice ? { choice } : {}) };
}

// 바꿀 계획: { store, add: [메뉴], update: [{ id, name, patch, changes }], skip: [{ name, reason }], errors: [{ name, error }] }.
// errors 가 하나라도 있으면 아무것도 바꾸지 않는다
export function planMenuImport(db, storeId, data, { update = false } = {}) {
  const store = findStore(db, storeId);
  if (!store) return { store: null, add: [], update: [], skip: [], errors: [{ name: "-", error: `없는 매장이에요: ${storeId}` }] };
  const mine = db.listMenu().filter((d) => d.restaurantId === storeId);
  // 같은 이름이 여럿이면(판매 중지 후 다시 추가 등) 판매 중인 것, 그다음 최근 것
  const existing = (name) => mine.filter((d) => d.name === name).sort((a, b) => Number(b.active) - Number(a.active))[0];
  const items = Array.isArray(data?.items) ? data.items : [];
  const plan = { store, add: [], update: [], skip: [], errors: [] };
  const seen = new Set();
  if (items.length === 0) plan.errors.push({ name: "-", error: "items 가 비어 있어요." });
  for (const raw of items) {
    const item = cleanItem(raw);
    if (item.error) {
      plan.errors.push(item);
      continue;
    }
    if (seen.has(item.name)) {
      plan.errors.push({ name: item.name, error: "파일 안에 같은 이름이 또 있어요" });
      continue;
    }
    seen.add(item.name);
    const cur = existing(item.name);
    if (!cur) {
      plan.add.push({ restaurantId: storeId, ...item });
      continue;
    }
    if (!update) {
      plan.skip.push({ name: item.name, reason: cur.active ? "이미 판매 중" : "이미 있음 (판매 중지)" });
      continue;
    }
    const patch = { active: item.active, unit: item.unit, keywords: item.keywords, choice: item.choice ?? null };
    const changes = Object.keys(patch).filter((k) => !same(cur[k], patch[k]));
    if (changes.length === 0) plan.skip.push({ name: item.name, reason: "파일과 같음" });
    else plan.update.push({ id: cur.id, name: item.name, patch, changes });
  }
  return plan;
}

// 계획대로 넣고 고친다. 넣은 메뉴와 고친 메뉴를 돌려준다 (검사 오류가 있으면 아무것도 바꾸지 않는다)
export function applyMenuImport(db, plan) {
  if (plan.errors.length) throw new Error("검사 오류가 있어 바꾸지 않았어요.");
  const added = plan.add.map(({ active, ...item }) => {
    const rec = db.addMenuItem(item);
    return active ? rec : db.updateMenuItem(rec.id, { active: false });
  });
  const updated = plan.update.map((u) => db.updateMenuItem(u.id, u.patch));
  return { added, updated };
}

function args(argv) {
  const out = { apply: false, update: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--update") out.update = true;
    else if (a === "--store" || a === "--file" || a === "--db") out[a.slice(2)] = argv[++i];
  }
  return out;
}

const describeItem = (d) =>
  `${d.name} · ${d.price.toLocaleString("ko-KR")}원 / ${d.unit}${d.active ? "" : " · 판매 중지로"}${d.choice ? ` · ${d.choice.label} ${d.choice.count}가지 고르기 (${d.choice.options.length}가지 중)` : ""}`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const opt = args(process.argv.slice(2));
  if (!opt.store) {
    console.error("사용법: node import-menu.mjs --store <매장 id> [--file 파일.json | < 파일.json] [--db DB 경로] [--update] [--apply]");
    process.exit(2);
  }
  const text = opt.file && opt.file !== "-" ? readFileSync(opt.file, "utf8") : readFileSync(0, "utf8");
  const dbPath = opt.db ?? join(process.env.DATA_DIR ?? join(import.meta.dirname, "data"), "saylo.db");
  const db = openDb(dbPath);
  const plan = planMenuImport(db, opt.store, JSON.parse(text), { update: opt.update });
  console.log(`매장: ${plan.store ? `${plan.store.name} (${opt.store})` : opt.store} · DB ${dbPath}`);
  for (const d of plan.add) console.log(`  넣기   ${describeItem(d)}`);
  for (const u of plan.update) {
    const what = u.changes.map((k) => (k === "active" ? (u.patch.active ? "다시 판매" : "판매 중지") : k === "choice" ? (u.patch.choice ? `맛 ${u.patch.choice.count}가지 고르기 (${u.patch.choice.options.length}가지 중)` : "맛 고르기 없앰") : k));
    console.log(`  고치기 ${u.name}: ${what.join(", ")}`);
  }
  for (const s of plan.skip) console.log(`  건너뜀 ${s.name} (${s.reason})`);
  for (const e of plan.errors) console.log(`  오류   ${e.name}: ${e.error}`);
  console.log(`넣기 ${plan.add.length} · 고치기 ${plan.update.length} · 건너뜀 ${plan.skip.length} · 오류 ${plan.errors.length}`);
  if (plan.errors.length) process.exitCode = 1;
  else if (!opt.apply) console.log("미리 보기만 했어요. 바꾸려면 --apply 를 붙여 다시 실행하세요.");
  else {
    const done = applyMenuImport(db, plan);
    console.log(`바꿨어요: 넣기 ${done.added.length} · 고치기 ${done.updated.length}`);
  }
  db.close();
}
