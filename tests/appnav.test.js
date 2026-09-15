/* ERP 공용 메뉴 부품(app/appnav.mjs) 연결 — 스마트팩토리 머리의 «🔀 시스템 이동»(PC)·«📲 사내 앱 이동»(휴대폰)을
   공용 부품 하나로 옮기고 옛 설치 오버레이 코드를 지웠다(사용자 승인 2026-09-15 · 휴대폰 교정 2026-09-16).

   확인:  ① 부품 module script 를 <head> 에 싣는다
         ② 헤더에 <maytutu-appnav app="smartfactory"> 요소를 둔다
         ③ beforeinstallprompt 를 최상위에서 window.__maytutuBip 로 붙잡는다
         ④ 옛 설치 UI 이름이 파일 어디에도(주석 포함) 남지 않았다
         ⑤ 서비스워커 등록 줄은 지우지 않는다
         ⑥ 매니페스트 related_applications — 휴대폰 목록의 «설치됨/설치 안됨» 을 크롬에 물을 수 있는 앱 3개

   실행:  node tests/appnav.test.js                                                        */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// 있음 검사는 주석을 걷어낸 사본으로 — 설명 주석에 같은 글자가 있으면 코드가 없어도 초록이 된다. 없음 검사는 주석까지 본다(SRC).
const CODE = SRC.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const ok = [];
const t = (n, f) => { f(); ok.push(n); };

t('부품 module script 를 <head> 에 싣는다', () => {
  assert.ok(
    CODE.includes('<script type="module" src="https://maytutu-erp.vercel.app/app/appnav.mjs"></script>'),
    'appnav.mjs module script 를 못 찾음'
  );
});

t('머리에 <maytutu-appnav app="smartfactory"> 요소를 둔다 · theme 속성은 없다(부품 창이 라이트 한 벌 — 2026-09-16)', () => {
  assert.ok(CODE.includes('<maytutu-appnav app="smartfactory"${(State.user && State.user.email)'), '머리의 maytutu-appnav 요소를 못 찾음');
  assert.ok(!/<maytutu-appnav[^>]*\btheme=/.test(CODE), '옛 theme 속성이 남았다');
});

t('로그인 화면(머리 없음)에도 설치 안내 자리 요소가 있다', () => {
  const body = CODE.slice(CODE.indexOf('<body>'), CODE.indexOf('<body>') + 400);
  assert.ok(body.includes('<maytutu-appnav app="smartfactory"></maytutu-appnav>'), '<body> 맨 앞의 설치 안내 자리 요소가 없다');
});

t('앱 이름 «메이투투 공장»(2026-09-16 사내 앱 이름 통일) — 매니페스트 name·short_name · 탭 제목 · 머리 · 로그인 제목이 같은 글자 · 옛 이름 없음', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.deepStrictEqual([m.name, m.short_name], ['메이투투 공장', '메이투투 공장'], '홈 화면 이름이 사내 앱 목록 이름과 다르다');
  assert.ok(CODE.includes('<title>메이투투 공장</title>'), '탭 제목');
  assert.ok(CODE.includes("renderHeader('메이투투 공장',"), '머리 제목');
  assert.ok(CODE.includes('margin-bottom:4px">메이투투 공장</div>'), '로그인 화면 제목');
  assert.ok(!SRC.includes('메이투투 스마트팩토리'), '옛 이름 «메이투투 스마트팩토리» 가 남았다');
});

t('로그인 이메일은 HS_ESC 로 이스케이프해 email 속성에 넣는다', () => {
  assert.ok(CODE.includes("HS_ESC(State.user.email)"), 'email 속성 이스케이프 배선을 못 찾음');
});

t('최상위에서 beforeinstallprompt 를 먼저 붙잡아 window.__maytutuBip 에 둔다', () => {
  assert.ok(/window\.addEventListener\('beforeinstallprompt', \(e\) => \{ e\.preventDefault\(\); window\.__maytutuBip = e; \}\);/.test(CODE), '최상위 beforeinstallprompt 붙잡기(__maytutuBip)를 못 찾음');
});

t('버튼 모양 CSS 변수를 둔다', () => {
  assert.ok(CODE.includes('maytutu-appnav{--appnav-bg:'), 'maytutu-appnav CSS 변수 블록을 못 찾음');
  assert.ok(CODE.includes('--appnav-text-display:none'), '420px 이하 텍스트 숨김 규칙을 못 찾음');
});

t('옛 설치 UI 코드가 파일 어디에도(주석 포함) 남지 않았다', () => {
  const banned = [
    'isStandaloneApp', 'installBtnHtml', 'paintInstallBtn', 'installApp(', 'installFromLanding',
    'INSTALL_GUIDE', 'installLandingMode', '_installLandingCtx', 'installLandingBodyHtml',
    'renderInstallLanding', 'updateInstallLanding', 'closeInstallLanding', 'openInstallLanding',
    'initInstallLanding', '_installPrompt',
  ];
  const found = banned.filter((name) => SRC.includes(name));
  assert.deepStrictEqual(found, [], `옛 설치 UI 이름이 남아 있음: ${found.join(', ')}`);
});

t('서비스워커 등록 줄은 그대로 남아 있다', () => {
  assert.ok(CODE.includes("navigator.serviceWorker.register('sw.js')"), '서비스워커 등록 줄이 사라짐 — 지우면 안 된다');
});

t('매니페스트 related_applications = ERP·미팅·세일즈 — 크롬은 앞 3개만 확인한다(정본 = maytutu-erp scripts/build_appnav.mjs relatedApplications)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.strictEqual(m.prefer_related_applications, false, 'true 면 크롬이 웹 설치를 막는다');
  assert.deepStrictEqual((m.related_applications || []).map((r) => [r.platform, r.url]), [
    ['webapp', 'https://maytutu-erp.vercel.app/app/manifest.json'],
    ['webapp', 'https://maytutu-meeting.vercel.app/app/meeting.webmanifest'],
    ['webapp', 'https://anghodu-sales.vercel.app/app/sales.webmanifest'],
  ], '휴대폰 «📲 사내 앱 이동» 이 물을 수 있는 앱이 ERP 쪽 규칙과 다르다 — 순서·개수까지 같게');
});

t('매니페스트 링크가 manifest.json 이다 — 다른 앱 assetlinks 의 site(…/maytutu-smartfactory/manifest.json)와 글자까지 맞아야 확인이 된다', () => {
  assert.ok(CODE.includes('<link rel="manifest" href="manifest.json">'), '매니페스트 링크가 바뀌었다 — maytutu-erp 스펙 manifest_url 과 assetlinks 도 같이 바꿀 것');
});

console.log(`✅ appnav 연결 검증 ${ok.length}건 통과`);
