// 서버 DB 의 지금 메뉴 목록(사장님이 추가한 메뉴·바꾼 가격·판매 중지 포함)을 catalog.json 모양으로 내보낸다.
// 저장소의 목록 파일을 운영 서버와 맞출 때 쓴다.
//
//   운영 서버에서 (화면에 출력 → 저장소 폴더의 새 파일로 받기):
//     docker compose -f docker-compose.prod.yml exec -T api node export-catalog.mjs > server/catalog.new.json
//     내용을 확인한 뒤 server/catalog.json 으로 바꾸고 커밋한다
//   로컬 개발 (그 자리에서 바로 바꾸기):
//     node server/export-catalog.mjs --out server/catalog.json
//
// 주의: 로컬에서 "> server/catalog.json" 으로 받으면 셸이 파일을 먼저 비워서 이 스크립트가 빈 목록을 읽는다. --out 을 쓴다
import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.mjs";
import { DELIVERY_MENU, catalogWithMenu } from "./stores.mjs";

const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "data");
const db = openDb(join(DATA_DIR, "saylo.db"));
db.seedMenu(DELIVERY_MENU); // 서버를 한 번도 켜지 않은 DB 라도 목록 파일의 메뉴는 들어가게
const text = JSON.stringify(catalogWithMenu(db), null, 2) + "\n";
db.close();

const outAt = process.argv.indexOf("--out");
if (outAt > 0 && process.argv[outAt + 1]) {
  // 임시 파일에 다 쓴 뒤 이름을 바꾼다 (쓰다가 멈춰도 원래 파일이 깨지지 않게)
  const out = process.argv[outAt + 1];
  writeFileSync(out + ".tmp", text);
  renameSync(out + ".tmp", out);
  console.error(`${out} 에 메뉴 ${JSON.parse(text).deliveryMenu.length}개를 썼어요.`);
} else {
  process.stdout.write(text);
}
