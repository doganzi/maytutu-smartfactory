/* ERP 공용 메뉴 부품(app/appnav.mjs) 연결 — 스마트팩토리 머리의 «🔀 시스템 이동»(PC)·«📲 앱 설치»(휴대폰)를
   공용 부품 하나로 옮기고 옛 설치 오버레이 코드를 지웠다(사용자 승인 2026-09-15).

   확인:  ① 부품 module script 를 <head> 에 싣는다
         ② 헤더에 <maytutu-appnav app="smartfactory"> 요소를 둔다
         ③ beforeinstallprompt 를 최상위에서 window.__maytutuBip 로 붙잡는다
         ④ 옛 설치 UI 이름이 파일 어디에도(주석 포함) 남지 않았다
         ⑤ 서비스워커 등록 줄은 지우지 않는다

   실행:  node tests/appnav.test.js                                                        */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const ok = [];
const t = (n, f) => { f(); ok.push(n); };

t('부품 module script 를 <head> 에 싣는다', () => {
  assert.ok(
    SRC.includes('<script type="module" src="https://maytutu-erp.vercel.app/app/appnav.mjs"></script>'),
    'appnav.mjs module script 를 못 찾음'
  );
});

t('머리에 <maytutu-appnav app="smartfactory"> 요소를 둔다', () => {
  assert.ok(/<maytutu-appnav app="smartfactory"/.test(SRC), 'maytutu-appnav 요소를 못 찾음');
});

t('로그인 이메일은 HS_ESC 로 이스케이프해 email 속성에 넣는다', () => {
  assert.ok(SRC.includes("HS_ESC(State.user.email)"), 'email 속성 이스케이프 배선을 못 찾음');
});

t('최상위에서 beforeinstallprompt 를 먼저 붙잡아 window.__maytutuBip 에 둔다', () => {
  assert.ok(SRC.includes("window.addEventListener('beforeinstallprompt'"), 'beforeinstallprompt 리스너를 못 찾음');
  assert.ok(SRC.includes('window.__maytutuBip = e'), '__maytutuBip 캡처를 못 찾음');
});

t('버튼 모양 CSS 변수를 둔다', () => {
  assert.ok(SRC.includes('maytutu-appnav{--appnav-bg:'), 'maytutu-appnav CSS 변수 블록을 못 찾음');
  assert.ok(SRC.includes('--appnav-text-display:none'), '420px 이하 텍스트 숨김 규칙을 못 찾음');
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
  assert.ok(SRC.includes("navigator.serviceWorker.register('sw.js')"), '서비스워커 등록 줄이 사라짐 — 지우면 안 된다');
});

console.log(`✅ appnav 연결 검증 ${ok.length}건 통과`);
