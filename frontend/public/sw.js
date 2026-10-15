// Saylo 서비스 워커. 브라우저가 Saylo 를 "설치할 수 있는 앱"으로 알아보게 하는 최소한의 일만 한다.
// - 주문·로그인 같은 서버 데이터(/api/)와 화면 파일은 저장하지 않고 늘 서버에서 받는다 (오래된 화면·데이터가 남지 않게)
// - 인터넷이 끊겨 화면을 열 수 없을 때만 안내 화면을 보여 준다
// 바꾸면 브라우저가 다음 방문 때 새 파일로 바꿔 끼운다 (nginx 가 이 파일은 캐시하지 않게 보낸다)

const OFFLINE_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#007cfc" />
<title>Saylo</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #e9eef5; color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
  main { text-align: center; padding: 24px; }
  h1 { margin: 0 0 8px; font-size: 26px; font-weight: 900; color: #007cfc; }
  p { margin: 0 0 20px; color: #475569; line-height: 1.6; }
  button { border: 0; border-radius: 999px; padding: 12px 22px; background: #007cfc; color: #fff; font-size: 15px; font-weight: 700; }
</style>
</head>
<body>
<main>
  <h1>Saylo</h1>
  <p>인터넷에 연결되어 있지 않아요.<br />연결을 확인한 뒤 다시 시도해 주세요.</p>
  <button type="button" onclick="location.reload()">다시 시도</button>
</main>
</body>
</html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // 예전 버전이 만들었을지 모르는 캐시는 모두 지운다 (이 서비스 워커는 캐시를 쓰지 않는다)
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // 화면 이동(주소창으로 여는 요청)만 다룬다. 나머지(API·이미지·스크립트)는 브라우저가 평소처럼 받는다
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    ),
  );
});
