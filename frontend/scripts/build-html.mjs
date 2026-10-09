// HTML 한 파일 만들기 (npm run build:html)
// 1) 이미지·영상까지 전부 data URI 로 넣어 빌드한다 (dist-html/)
// 2) 나온 JS·CSS 를 index.html 안에 그대로 넣어 저장소 루트의 saylo.html 로 저장한다
// 결과 파일은 서버 없이 더블클릭으로 열어도 동작한다. (본문 글꼴 Pretendard 만 인터넷에서 받고, 없으면 맑은 고딕으로 보인다)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-html");
const target = resolve(root, "..", "saylo.html");

await build({
  root,
  base: "./",
  logLevel: "warn",
  build: {
    outDir,
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER, // 로고·배경 영상도 파일로 빼지 않고 넣는다
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 4096, // 이미지·영상을 넣어 커진 것이라 경고하지 않는다
  },
});

let html = readFileSync(join(outDir, "index.html"), "utf8");
const read = (src) => readFileSync(join(outDir, src.replace(/^\.?\//, "")), "utf8");

// 함수형 replace: 코드 안의 "$&" 같은 문자열이 치환 패턴으로 해석되지 않게 한다
html = html.replace(/<script type="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  // 코드 안에 "</script" 가 있으면 태그가 일찍 닫히므로 끊어 둔다
  const code = read(src).replace(/<\/script/gi, "<\\/script");
  return `<script type="module">${code}</script>`;
});
html = html.replace(/<link rel="stylesheet"[^>]*\bhref="(\.\/assets\/[^"]+)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`);

if (/\b(src|href)="\.\/assets\//.test(html)) throw new Error("아직 바깥 파일을 가리키는 태그가 남아 있어요");

writeFileSync(target, html);
console.log(`✓ ${target} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
