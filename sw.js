/* 메이투투 스마트팩토리 — 최소 서비스워커
   목적: 캐시를 만들지 않는다. main 브랜치 푸시 = GitHub Pages 즉시 배포이므로,
   sw 가 응답을 캐시해 두면 옛 화면이 고착된다(재고·LOT·HACCP 판정이 낡은 코드로 도는 사고).
   그럼에도 이 파일이 있어야 하는 이유: 크롬(153~)은 «fetch 핸들러가 있는 서비스워커»가
   있어야만 PC 에서 beforeinstallprompt(설치 권유)를 띄운다
   (https://developer.chrome.com/blog/update-install-criteria). 그래서 캐시 없이
   fetch 만 가로채는 형태로 둔다 — 오프라인일 때만 안내 화면을 대신 보여준다. */

const OFFLINE_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>오프라인 — 메이투투 스마트팩토리</title>
<style>
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
    background:#f5f6f8; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .box { text-align:center; padding:32px; }
  .box h1 { font-size:18px; margin:0 0 8px; }
  .box p { font-size:14px; color:#666; margin:0 0 20px; }
  button { font-size:14px; padding:10px 20px; border-radius:8px; border:none;
    background:#2b6cb0; color:#fff; cursor:pointer; }
</style></head>
<body>
  <div class="box">
    <h1>네트워크에 연결할 수 없습니다</h1>
    <p>연결되면 다시 열어 주세요.</p>
    <button onclick="location.reload()">다시 시도</button>
  </div>
</body></html>`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode !== 'navigate' || req.method !== 'GET') return;

  event.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'include', redirect: 'manual' })
      .catch(() => fetch(req))
      .catch(() => new Response(OFFLINE_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      }))
  );
});
