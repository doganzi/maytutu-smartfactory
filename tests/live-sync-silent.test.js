/* 조용한 LiveSync — 시뮬레이션 검증 (사용자 지시 2026-10-04)
   «화면에 표시없이 새로고침 되는게 최선이고, 무조건 작업할때 방해되는 요소는 없어야함»

   실행:  node tests/live-sync-silent.test.js      실패하면 assert 로 즉시 중단
   방식:  index.html 의 SheetsAPI · LiveSync · Router · showLoading/toast 를 원본 그대로 떼어 vm 에서 돌린다
          (DOM·fetch·타이머만 가짜). 소스 문자열 검사는 주석을 걷어낸 사본에 «호출 형태» 로만 한다.
   범위:  ① 캐시 번호(_ver)·invalidateCache 수리  ② 화면이 읽은 목록(_track) — go/back 모두
          ③ 값이 같으면 화면에 아무 일도 없다 ④ 값이 바뀌면 조용히(로딩 막·토스트 없음) 다시 그리고 스크롤 유지
          ⑤ 손대는 중에는 미루되 잃지 않는다 ⑥ 수동 새로고침은 예전 그대로 ⑦ 폴링 되살리기·실패 내성
          ⑧ 저장·로딩 중 미룸 · 조용함은 손놀림으로만 풀림 · 그리다 실패하면 목록 복구 · 펼침 이어주기 · 입력값 보존(만진 칸·기본값 비교)
          ⑨ 미뤄진 보이게 됨·포커스 복귀는 한 번만 다시 시도  ⑩ 그린 뒤 손댄 다음의 새로 읽기는 변경 감지를 가리지 않는다
          ⑫ 리뷰어 지적 3건 — 읽기 실패가 있으면 이번 갱신은 접는다 · 🔄 는 자동 갱신/최소 간격에 막히지 않는다 ·
             +/− 버튼·스캐너가 바꾼 입력값(input 이벤트 없음)도 보존한다
          ⑪ 늦게 채워지는 칸(홈 서류·생산계획 · 성적서 탭 서류 현황)은 조용히 다시 그릴 때 비우지 않고(높이 유지 → 스크롤 안 튐),
             그 칸의 늦은 토스트도 조용히 한다(실단말기 측정 2026-10-04: 칸이 비면 높이 1712→1387, 채워지면 앵커링이 +325 밀어 스크롤 420→745) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
function slice(startMark, endMark) {
  const i = SRC.indexOf(startMark);
  assert.notStrictEqual(i, -1, `index.html 에서 시작 마커를 찾지 못함: ${startMark}`);
  const j = SRC.indexOf(endMark, i);
  assert.notStrictEqual(j, -1, `index.html 에서 종료 마커를 찾지 못함: ${endMark}`);
  return SRC.slice(i, j + endMark.length);
}
const strip = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const SHEETS_SRC = slice('const SheetsAPI = {', '\n};\n');
const LIVE_SRC = slice('// <live-sync>', '// </live-sync>');
const UI_SRC = slice('function showLoading()', "setTimeout(() => el.classList.remove('show'), duration);\n}");
const ROUTER_SRC = slice('const Router = {', '\n};\n');
const DOCALERT_SRC = slice('async function hsLoadHomeDocAlert() {', '\n}\n');   // 홈 「챙겨야 할 서류」 — 화면을 다 그린 뒤 뒤에서 채운다
const PRODPLAN_SRC = slice('async function loadHomeProdPlan() {', '\n}\n');      // 홈 「생산 계획」 — 마찬가지로 뒤에서 채운다

const settle = () => new Promise(r => setImmediate(r));
const tick = () => new Promise(r => setTimeout(r, 5)); // 펼침 기록은 setTimeout(0) 뒤에 읽으므로 타이머 한 바퀴를 기다린다

function makeEnv(initialSheets = {}) {
  const env = {
    sheets: JSON.parse(JSON.stringify(initialSheets)), failTabs: new Set(), onFetch: null,
    fetched: [], toasts: [], loadingShown: 0, renders: [], reads: {}, intervals: [], cleared: 0,
    raf: [], scrollWrites: [], dialogOpen: false, listeners: {}, timeouts: [],
  };
  const mkEl = () => ({ style: {}, innerHTML: '', scrollTop: 0, classList: { remove() {}, add() {} } });
  const els = {};
  const $id = id => els[id] || (els[id] = mkEl());
  els.content = mkEl();
  env.details = [];
  env.lateNodes = []; // 늦게 채워지는 칸(data-late-slot) 흉내 — 다시 그리기 «전» 의 옛 화면에 있던 칸
  env.controls = []; // 화면의 입력칸 흉내 — {type, value, defaultValue, ...}
  els.content.querySelectorAll = sel => (sel === 'details' ? env.details : sel === '[data-late-slot]' ? env.lateNodes : sel === 'input,select,textarea' ? env.controls : []);
  env.loadingVisible = false;
  els.loading = { classList: { remove() { env.loadingShown++; env.loadingVisible = true; }, add() { env.loadingVisible = false; }, contains: c => c === 'hidden' && !env.loadingVisible } };
  els.toast = { style: {}, classList: { remove() {} }, set textContent(v) { env.toasts.push(v); }, set className(v) {} };
  const on = key => (ev, fn) => { (env.listeners[key + ev] = env.listeners[key + ev] || []).push(fn); };
  const document = {
    visibilityState: 'visible', activeElement: null, addEventListener: on('doc:'),
    querySelector() { return env.dialogOpen ? {} : null; }, getElementById: $id,
  };
  const window = { scrollY: 0, addEventListener: on('win:'), scrollTo(x, y) { env.scrollWrites.push(y); this.scrollY = y; } };
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    CONFIG: { SHEET_ID: 'SID' }, Auth: { async tryRefreshToken() { return false; }, isTokenFresh() { return true; } },
    isPreviewing: () => false, _previewSkipWrite() {}, localStorage: { removeItem() {} },
    // 1초 이상 타이머(= 다시 시도 대기)는 기록만 하고 시험이 직접 불러 준다 — 실제로 기다리지 않는다
    setTimeout: (fn, ms) => { env.timeouts.push({ fn, ms }); return ms >= 1000 ? { fake: true } : setTimeout(fn, ms); }, clearTimeout,
    setInterval: (fn, ms) => { const h = { fn, ms, dead: false }; env.intervals.push(h); return h; },
    clearInterval: h => { env.cleared++; if (h) h.dead = true; },
    requestAnimationFrame: fn => env.raf.push(fn),
    _actionLocks: {}, document, window, $id, history: { pushState() {}, replaceState() {} }, renderBottomNav() {}, renderHeader() {},
    State: { token: 't', currentScreen: 'dashboard', prevScreen: null, _screenParams: {}, _lastParams: {} },
    Screens: {},
    fetch: async url => {
      const u = decodeURIComponent(url);
      env.fetched.push(u);
      if (env.onFetch) env.onFetch(u);
      if (env.gate) await env.gate; // 시험이 열어 주기 전까지 응답을 붙들어 둔다(느린 읽기)
      const tab = (u.match(/\/values\/([^?]+)/) || [])[1].split('!')[0];
      if (env.failTabs.has(tab) || !(tab in env.sheets)) return { ok: false, status: 403, text: async () => '' };
      return { ok: true, status: 200, json: async () => ({ values: [['hdr'], ...env.sheets[tab]] }) };
    },
  });
  vm.runInContext(SHEETS_SRC, ctx);
  vm.runInContext(UI_SRC, ctx);
  vm.runInContext(LIVE_SRC, ctx);
  vm.runInContext(ROUTER_SRC, ctx);
  Object.assign(env, {
    ctx, els, State: ctx.State, window, document,
    SheetsAPI: vm.runInContext('SheetsAPI', ctx), LiveSync: vm.runInContext('LiveSync', ctx), Router: vm.runInContext('Router', ctx),
    reset() { env.renders.length = 0; env.toasts.length = 0; env.loadingShown = 0; env.fetched.length = 0; env.scrollWrites.length = 0; env.raf.length = 0; env.timeouts.length = 0; /* 처음 그릴 때 토스트가 건 타이머도 비운다 */ },
    flushRaf() { for (let i = 0; i < 5 && env.raf.length; i++) env.raf.splice(0).forEach(f => f()); }, // rAF 안의 rAF(=두 프레임)까지 비운다
    async sync(trigger) { env.LiveSync._lastSyncTs = 0; await env.LiveSync.sync(trigger); },
  });
  return env;
}

/** 화면 흉내 — 로딩 막을 켜고, 탭을 읽고, 토스트를 띄우고, 스크롤을 맨 위로 튕긴다(innerHTML 교체처럼) */
function installScreen(env, name, tabs) {
  env.tabs = env.tabs || {}; env.tabs[name] = tabs; // 테스트가 «화면이 읽는 탭» 을 중간에 바꿀 수 있게
  env.ctx.Screens[name] = async function () {
    env.renders.push({ name, silent: !!env.ctx.State._silent });
    env.ctx.showLoading();
    for (const t of env.tabs[name]) env.reads[t] = Array.from(await env.SheetsAPI.getAll(t), r => r.join(',')); // 호스트 배열로(vm 영역이 다르면 deepStrictEqual 이 프로토타입에서 갈린다)
    env.silentAfterReads = !!env.ctx.State._silent;
    if (env.showLoadingAfterReads) env.ctx.showLoading(); // 읽은 «뒤» 에 로딩 막을 켜는 화면(네트워크를 탄 뒤에도 조용해야 한다)
    if (env.renderGate) await env.renderGate; // 그리는 «도중» 에 매달리는 화면 — 조용히 그리는 중인 상태를 붙들어 둔다(시험이 열어 줄 때까지)
    if (env.onRender) env.onRender();
    env.ctx.toast('화면 안내', 'err'); // 오류형 — 홈의 «시험성적서 만료» 같은 상시 알림이 이 종류다(실단말기 2026-10-04: 조용히 다시 그릴 때마다 떴다)
    env.els.content.scrollTop = 0;
    env.ctx.hideLoading();
  };
}
/** 화면을 «처음 그려진 상태» 로 만든다 — Router.render 가 읽은 목록을 적는다 */
async function opened(sheets, tabs = ['A', 'B'], screen = 'dashboard') {
  const env = makeEnv(sheets);
  installScreen(env, screen, tabs);
  env.State.currentScreen = screen;
  env.Router.render();
  await settle();
  env.reset();
  return env;
}
const SHEETS = () => ({ A: [['1', 'x']], B: [['2', 'y']] });

// 끝까지 돌았는지 지킨다 — 어느 await 가 영영 끝나지 않으면 Node 는 오류 없이 종료코드 0 으로 빠져나가
// 시험이 «멈춘 채 초록» 이 된다(변이 `_stuckMs: 0` 에서 ⑬ 이 조용히 끊긴 채 통과로 보였다). 마지막 줄까지 못 가면 실패로 바꾼다
let finished = false;
process.on('exit', code => {
  if (code === 0 && !finished) { console.error('✗ live-sync-silent: 끝까지 돌지 못했다 — 끝나지 않는 await 가 있다'); process.exitCode = 1; }
});

(async () => {
  // ═══ ① 캐시 번호 · invalidateCache 수리 ═══
  {
    const e = makeEnv(SHEETS()); const S = e.SheetsAPI;
    S._setCache('getAll:A', [['1']]);
    assert.strictEqual(S._ver['getAll:A'], 1, '처음 받으면 번호 1');
    S._setCache('getAll:A', [['1']]);
    assert.strictEqual(S._ver['getAll:A'], 1, '같은 값을 다시 받아도 번호는 그대로 — 값이 «달라질 때만» 오른다');
    S._setCache('getAll:A', [['2']]);
    assert.strictEqual(S._ver['getAll:A'], 2, '값이 바뀌면 번호가 오른다');

    ['getAll:시험성적서', 'getRange:시험성적서!A1:Z1', "getRange:'시험성적서'!A1", 'getAll:시험성적서2', 'getAll:완제품품목'].forEach(k => S._setCache(k, [[1]]));
    S.invalidateCache('시험성적서');
    assert.ok(!S._cache['getAll:시험성적서'], 'getAll 키가 지워져야 한다 — 예전엔 startsWith(탭) 이라 어떤 키와도 안 맞았다');
    assert.ok(!S._cache['getRange:시험성적서!A1:Z1'], 'getRange 키도 탭 이름으로 지워진다');
    assert.ok(!S._cache["getRange:'시험성적서'!A1"], '따옴표 친 탭 이름도');
    assert.ok(S._cache['getAll:시험성적서2'], '이름이 비슷한 다른 탭은 건드리지 않는다');
    assert.ok(S._cache['getAll:완제품품목'], '다른 탭은 그대로');

    const v = S._ver['getAll:A'];
    S.invalidateAllCache();
    assert.strictEqual(Object.keys(S._cache).length, 0, '전체 무효화는 캐시를 비운다');
    assert.strictEqual(S._ver['getAll:A'], v, '캐시를 비워도 번호는 유지 — 안 그러면 «바뀐 것» 을 놓친다');
    console.log('✔ ① 캐시 번호·invalidateCache');
  }

  // 쓰기 직후 읽기는 낡은 캐시를 보지 않는다(= ERP 즉시 반영 규칙)
  {
    const e = makeEnv({ A: [['old']] }); const S = e.SheetsAPI;
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await S.getAll('A'))), [['old']]);
    e.sheets.A = [['new']];
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await S.getAll('A'))), [['old']], '캐시 30초 안에는 그대로(전제)');
    S.invalidateCache('A');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await S.getAll('A'))), [['new']], '쓰기 뒤 invalidateCache 면 바로 새 값');
    console.log('✔ ① 쓰기 뒤 즉시 새 값');
  }

  // ═══ ② 화면이 읽은 목록(_track) ═══
  {
    const e = makeEnv(SHEETS()); const S = e.SheetsAPI;
    S._track = new Map();
    await S.getAll('A');
    assert.strictEqual(S._track.get('getAll:A'), 1, '캐시 미스로 읽어도 읽은 번호를 적는다');
    await S.getAll('A');
    assert.strictEqual(S._track.get('getAll:A'), 1, '캐시 히트도 적는다');
    await S.getAll('B', true, false);
    assert.ok(!S._track.has('getAll:B'), 'track=false(보이지 않는 선읽기)는 적지 않는다');
    await S.getRange('B!A1:B2');
    assert.ok(S._track.has('getRange:B!A1:B2'), 'getRange 도 적는다');
    S._track.clear();
    await S.getRange('B!A1:B2');
    assert.strictEqual(S._track.get('getRange:B!A1:B2'), 1, 'getRange 캐시 히트도 적는다');
    e.sheets.A = [['9']]; S.invalidateCache('A'); await S.getAll('A');
    assert.strictEqual(S._track.get('getAll:A'), 2, '값이 바뀐 뒤 다시 읽으면 새 번호');
    S._track = null;
    await assert.doesNotReject(() => S.getAll('A'), '추적이 꺼져 있어도 읽기는 정상');
    console.log('✔ ② 읽은 목록 기록');
  }

  // Router.go / Router.back 둘 다 화면마다 새 목록을 건다
  {
    const e = makeEnv({ 완제품품목: [['FG1']], 작업지시서: [['W1']] });
    installScreen(e, 'items-fg', ['완제품품목']);
    installScreen(e, 'dashboard', ['작업지시서']);
    e.State.currentScreen = 'dashboard';
    e.Router.go('items-fg'); await settle();
    assert.deepStrictEqual([...e.State._screenKeys['items-fg'].keys()], ['getAll:완제품품목'], 'go: 그 화면이 읽은 탭만');
    e.Router.go('dashboard'); await settle();
    assert.deepStrictEqual([...e.State._screenKeys['dashboard'].keys()], ['getAll:작업지시서'], '다른 화면은 자기 목록');
    assert.strictEqual(e.State._screenKeys['items-fg'].size, 1, '이전 화면 목록은 건드리지 않는다');
    e.Router.back(); await settle();
    assert.strictEqual(e.State.currentScreen, 'items-fg');
    assert.deepStrictEqual([...e.State._screenKeys['items-fg'].keys()], ['getAll:완제품품목'], 'back(안드로이드 뒤로 가기)도 새 목록 — go 만 고치면 뒤로 간 화면은 영영 갱신이 안 된다');
    assert.ok(e.State._screenKeys['items-fg'] === e.SheetsAPI._track, '지금 읽기는 지금 화면의 목록으로 간다');
    console.log('✔ ② Router go/back 추적');
  }

  // ═══ ③ 값이 같으면 화면에 아무 일도 없다 ═══
  {
    const e = await opened(SHEETS());
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, '값이 같으면 다시 그리지 않는다');
    assert.strictEqual(e.toasts.length, 0, '토스트 없음');
    assert.strictEqual(e.loadingShown, 0, '로딩 막 없음');
    assert.strictEqual(e.scrollWrites.length, 0, '스크롤을 건드리지 않는다');
    assert.strictEqual(e.fetched.length, 2, '그 화면의 탭(A·B)만 보이지 않게 받아 비교');
    for (const trig of ['focus', 'visibility']) {
      e.reset(); await e.sync(trig);
      assert.strictEqual(e.renders.length + e.toasts.length + e.loadingShown, 0, `${trig} 도 마찬가지 — 예전엔 «데이터 동기화 완료» 토스트가 떴다`);
    }
    console.log('✔ ③ 같으면 무반응');
  }

  // ═══ ④ 바뀌면 조용히 다시 그린다 ═══
  {
    const e = await opened(SHEETS());
    e.sheets.B = [['3', 'z']];
    e.els.content.scrollTop = 300; e.window.scrollY = 120;
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '바뀐 탭이 있으면 한 번 다시 그린다');
    assert.strictEqual(e.renders[0].silent, true, '그리는 동안 State._silent');
    assert.strictEqual(e.toasts.length, 0, '조용히 — 화면이 띄우려던 토스트도 삼킨다');
    assert.strictEqual(e.loadingShown, 0, '조용히 — 로딩 막도 없다');
    assert.strictEqual(e.State._silent, false, '끝나면 _silent 해제 — 이후 사용자 동작의 토스트는 보인다');
    assert.deepStrictEqual(e.reads.B, ['3,z'], '새 값으로 그려졌다');
    assert.strictEqual(e.els.content.scrollTop, 300, '#content 스크롤 위치 유지(화면이 맨 위로 튕겨도 되돌린다)');
    assert.ok(e.scrollWrites.includes(120), 'window 스크롤도 유지');
    e.els.content.scrollTop = 0; e.flushRaf();
    assert.strictEqual(e.els.content.scrollTop, 300, '다음 두 프레임에 한 번 더 복원(비동기 렌더 안정화)');
    e.ctx.toast('내가 누른 버튼의 안내', 'suc');
    assert.deepStrictEqual(e.toasts, ['내가 누른 버튼의 안내'], '갱신이 끝난 뒤의 토스트는 정상');

    e.reset(); await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, '다시 그린 뒤 같은 값이면 또 그리지 않는다 — 번호가 소비됐다(무한 재그림 방지)');
    console.log('✔ ④ 바뀌면 조용히 + 스크롤 유지');
  }

  // 화면이 그리다 예외를 던져도 _silent 가 남지 않는다
  {
    const e = await opened(SHEETS());
    e.ctx.Screens.dashboard = async () => { throw new Error('boom'); };
    e.sheets.A = [['9', '9']];
    await e.sync('poll');
    assert.strictEqual(e.State._silent, false, '예외 뒤에도 _silent 해제 — 안 그러면 앱 전체 토스트·로딩이 영영 죽는다');
    assert.strictEqual(e.LiveSync._isSyncing, false);
    console.log('✔ ④ 예외 내성');
  }

  // ═══ ⑤ 손대는 중에는 미루되 잃지 않는다 ═══
  const busyCases = [
    ['입력창 활성', e => { e.document.activeElement = { tagName: 'INPUT', id: 'q' }; }, e => { e.document.activeElement = null; }],
    ['모달 열림', e => { e.dialogOpen = true; }, e => { e.dialogOpen = false; }],
    ['방금 만짐(0.5초 전)', e => { e.LiveSync._lastTouchTs = Date.now() - 500; }, e => { e.LiveSync._lastTouchTs = 0; }],
  ];
  for (const [name, hold, release] of busyCases) {
    const e = await opened(SHEETS());
    hold(e);
    e.sheets.B = [['3', 'z']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, `${name}: 다시 그리지 않는다`);
    assert.strictEqual(e.toasts.length + e.loadingShown, 0, `${name}: 아무 표시도 없다`);
    release(e);
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, `${name}: 풀리면 다음 주기에 반영된다 — 미룬 것이지 잃은 게 아니다`);
    assert.deepStrictEqual(e.reads.B, ['3,z']);
  }
  console.log('✔ ⑤ 손대는 중 미룸·재개');

  // 손놀림 기록은 실제 이벤트로 쌓인다(init 이 다섯 이벤트에 건다)
  {
    const e = await opened(SHEETS());
    e.LiveSync.init();
    for (const ev of ['touchstart', 'pointerdown', 'keydown', 'wheel', 'scroll']) {
      assert.ok((e.listeners['doc:' + ev] || []).length === 1, `${ev} 손놀림 기록 등록`);
    }
    e.LiveSync._lastTouchTs = 0;
    e.listeners['doc:scroll'][0]();
    assert.ok(Date.now() - e.LiveSync._lastTouchTs < 200, '스크롤 이벤트가 손놀림 시각을 갱신');
    e.sheets.B = [['3', 'z']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, '스크롤 직후에는 바꾸지 않는다');
    console.log('✔ ⑤ 손놀림 이벤트');
  }

  // 받는 사이(비동기 구간)에 손대거나 화면을 옮겨도 안전하다
  {
    const e = await opened(SHEETS());
    e.sheets.B = [['3', 'z']];
    e.onFetch = () => { e.document.activeElement = { tagName: 'TEXTAREA', id: 'memo' }; };
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, '받는 중에 입력이 시작되면 이번엔 접는다');
    e.onFetch = null; e.document.activeElement = null;
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '입력이 끝난 다음 주기에 반영');

    const e2 = await opened(SHEETS());
    e2.sheets.B = [['3', 'z']];
    e2.onFetch = () => { e2.State.currentScreen = 'other'; };
    await e2.sync('poll');
    assert.strictEqual(e2.renders.length, 0, '받는 중에 다른 화면으로 가면 그 화면을 덮어쓰지 않는다');
    console.log('✔ ⑤ 비동기 구간 안전');
  }

  // 입력 보존 화면은 자동으로는 절대 다시 그리지 않는다
  {
    const e = await opened(SHEETS(), ['A', 'B'], 'inventory');
    e.sheets.B = [['3', 'z']];
    for (let i = 0; i < 3; i++) await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, '재고 화면 등은 펼침·입력 보존을 위해 자동 갱신 제외(수동만)');
    assert.strictEqual(e.fetched.length, 0, '받지도 않는다');
    for (const s of ['wo-create', 'bom-calc', 'req-form', 'data-audit', 'reject-modal', 'lot-detail', 'inventory', 'po-new', 'po-detail', 'vendors', 'items-rm', 'box-ship']) {
      assert.ok(e.LiveSync._busyReason(s), `${s} 은(는) 입력 보존 화면 목록에 있어야 한다`);
    }
    console.log('✔ ⑤ 입력 보존 화면');
  }

  // ═══ ⑥ 수동 새로고침은 예전 그대로 ═══
  {
    const e = await opened(SHEETS());
    e.document.activeElement = { tagName: 'INPUT', id: 'q' }; e.dialogOpen = true; e.LiveSync._lastTouchTs = Date.now();
    await e.sync('manual');
    assert.strictEqual(e.renders.length, 1, '수동은 값이 같아도·입력 중이어도 다시 그린다(사용자가 눌렀다)');
    assert.strictEqual(e.renders[0].silent, false, '수동은 로딩 막을 쓴다');
    assert.ok(e.loadingShown >= 1, '로딩 막 표시');
    assert.ok(e.toasts.some(t => t.startsWith('데이터 동기화 완료')), '완료 토스트');
    assert.strictEqual(e.fetched.length, 2, '캐시를 비웠으니 다시 받는다');
    assert.strictEqual(e.scrollWrites.length, 0, '수동은 스크롤을 되돌리지 않는다');
    console.log('✔ ⑥ 수동 새로고침');
  }

  // ═══ ⑦ 폴링 되살리기 · 실패 내성 · 특수 화면 ═══
  {
    const e = await opened(SHEETS());
    e.LiveSync.init();
    const armed = () => e.intervals.filter(h => !h.dead).length;
    assert.strictEqual(armed(), 1, '시작하면 폴링 1개');
    e.document.visibilityState = 'hidden'; e.listeners['doc:visibilitychange'][0]();
    assert.strictEqual(armed(), 0, '숨기면 폴링 중지');
    e.document.visibilityState = 'visible'; e.listeners['doc:visibilitychange'][0]();
    assert.strictEqual(armed(), 1, '다시 보이면 폴링을 되살린다 — 예전엔 화면을 옮기기 전까지 영영 안 돌았다');
    const timer = e.intervals.filter(h => !h.dead)[0];
    assert.strictEqual(timer.ms, 30000, '주기 30초');
    e.sheets.B = [['3', 'z']];
    e.LiveSync._lastSyncTs = 0; timer.fn(); await settle(); await settle();
    assert.strictEqual(e.renders.length, 1, '타이머가 돌면 poll 동기화');
    e.document.visibilityState = 'hidden'; e.reset(); e.LiveSync._lastSyncTs = 0; timer.fn(); await settle();
    assert.strictEqual(e.fetched.length, 0, '숨겨진 동안에는 타이머가 돌아도 받지 않는다');
    console.log('✔ ⑦ 폴링 되살리기');
  }

  {
    const e = await opened(SHEETS());
    e.failTabs.add('B'); e.sheets.A = [['9', '9']];
    await assert.doesNotReject(() => e.sync('poll'));
    assert.strictEqual(e.renders.length, 0, '받기 실패한 탭이 있으면 이번엔 접는다(⑫ — 화면이 그 탭을 다시 받으러 가다 손놀림과 겹치지 않게). 다음 주기에 다시 비교');
    assert.strictEqual(e.toasts.length, 0, '실패해도 토스트 없음 — 작업 중 오류 팝업 금지');

    const e2 = await opened(SHEETS());
    e2.failTabs.add('A'); e2.failTabs.add('B');
    await e2.sync('poll');
    assert.strictEqual(e2.renders.length + e2.toasts.length, 0, '오프라인이면 화면은 그대로');

    const e3 = makeEnv(SHEETS()); // 읽은 목록이 없는 화면(로그인 등)
    e3.ctx.Screens.login = async () => { e3.renders.push('login'); };
    e3.State.currentScreen = 'login';
    await e3.sync('poll');
    assert.strictEqual(e3.renders.length + e3.fetched.length, 0, '읽은 목록이 없으면 아무것도 안 한다');
    console.log('✔ ⑦ 실패 내성');
  }

  {
    const e = makeEnv({ 공정기록: [['W1', 'a'], ['W2', 'b']] });
    e.ctx.Screens['wo-execute'] = async () => { e.renders.push('wo-execute'); };
    e.State.currentScreen = 'wo-execute'; e.State.woExec = { woId: 'W1', records: [] };
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, '작업 실행 화면은 다시 그리지 않는다(스캔·사진 인메모리 보존)');
    assert.strictEqual(e.State.woExec.records.length, 1, 'records 만 갱신');
    assert.strictEqual(e.toasts.length, 0, '토스트 없음');
    assert.ok(e.fetched.some(u => u.includes('공정기록')));
    console.log('✔ ⑦ wo-execute');
  }

  // 화면이 다른 탭을 읽게 바뀌면 목록도 따라간다 — 더는 안 읽는 탭이 바뀌어도 화면을 건드리지 않는다
  {
    const e = await opened(SHEETS());
    e.tabs.dashboard = ['A'];            // 다음에 그릴 때는 A 만 읽는다(필터를 바꾼 화면 등)
    e.sheets.A = [['9', '9']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, 'A 가 바뀌어 한 번 다시 그림');
    assert.deepStrictEqual([...e.State._screenKeys.dashboard.keys()], ['getAll:A'], '다시 그린 뒤 목록은 이번에 읽은 탭만');
    e.reset(); e.sheets.B = [['8', '8']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, '이제 안 읽는 B 가 바뀌어도 화면은 가만히');
    assert.strictEqual(e.fetched.length, 1, 'B 는 받지도 않는다 — 불필요한 API 호출 없음');
    console.log('✔ 읽는 탭이 바뀌면 목록도');
  }

  // ═══ 빈도 — «너무 빈번» 하지 않게 ═══
  {
    const e = await opened(SHEETS());
    e.sheets.B = [['3', 'z']];
    e.LiveSync._lastSyncTs = 0;
    const p1 = e.LiveSync.sync('poll');
    e.LiveSync._lastSyncTs = 0; // 간격 검사를 통과시켜도
    const p2 = e.LiveSync.sync('poll');
    await Promise.all([p1, p2]);
    assert.strictEqual(e.renders.length, 1, '동시에 두 번 불려도 한 번만 — 이미 동기화 중이면 건너뛴다');
    assert.strictEqual(e.fetched.length, 2, '받기도 한 번분(A·B)만 — 겹쳐 부르면 API 호출이 두 배가 된다');

    const e2 = await opened(SHEETS());
    await e2.sync('poll');
    e2.sheets.B = [['3', 'z']];
    await e2.LiveSync.sync('poll'); // 간격 초기화 없이 바로
    assert.strictEqual(e2.renders.length, 0, '5초 안에 또 부르면 건너뛴다');
    e2.LiveSync._lastSyncTs = Date.now() - 6000;
    await e2.LiveSync.sync('poll');
    assert.strictEqual(e2.renders.length, 1, '간격이 지나면 다시 비교해 반영');
    console.log('✔ 빈도');
  }

  // ═══ ⑧ 리뷰어 지적 — 저장·로딩 중 · 네트워크 대기 · 실패 복구 · 화면 상태 ═══
  // (a) 저장·처리 중(잠금)이거나 로딩 막이 떠 있으면 미룬다 — 풀리면 반영
  for (const [name, hold, release] of [
    ['저장·처리 중(잠금)', e => { e.ctx._actionLocks.saveShip = true; }, e => { e.ctx._actionLocks.saveShip = false; }],
    ['로딩 막이 떠 있음', e => { e.loadingVisible = true; }, e => { e.loadingVisible = false; }],
  ]) {
    const e = await opened(SHEETS());
    hold(e);
    e.sheets.B = [['3', 'z']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, name + ': 다시 그리지 않는다');
    assert.strictEqual(e.fetched.length, 0, name + ': 받지도 않는다(바쁨 검사가 먼저)');
    release(e);
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, name + ': 풀리면 반영 — 미룬 것이지 잃은 게 아니다');
    assert.deepStrictEqual(e.reads.B, ['3,z']);
    const m = await opened(SHEETS()); hold(m);
    await m.sync('manual');
    assert.strictEqual(m.renders.length, 1, name + ': 수동 새로고침은 그대로 그린다');
  }
  console.log('✔ ⑧ 저장·로딩 중 미룸');

  // (b) 조용함은 «사용자 손놀림» 으로만 풀린다 — 렌더가 스스로 네트워크를 타도 그 화면의 로딩 막·토스트는 계속 삼키고(새지 않는다),
  //     재그림이 도는 중에 사용자가 터치·키·휠로 손댄 순간부터는 그가 누른 버튼의 로딩 막·토스트를 삼키지 않는다
  {
    const e = await opened(SHEETS());
    e.sheets.B = [['3', 'z']];
    await e.sync('poll');
    assert.strictEqual(e.silentAfterReads, true, '캐시만 읽으면 그리는 내내 _silent');

    // 새는 쪽 — 선읽기 대상은 이전 목록(A·B)뿐, C 는 그리다 처음 읽는다 = 캐시 미스. 읽은 «뒤» 에 showLoading 을 켜는 화면
    const withC = () => Object.assign(SHEETS(), { C: [['c']] });
    const e2 = await opened(withC());
    e2.tabs.dashboard = ['A', 'B', 'C']; e2.showLoadingAfterReads = true;
    e2.sheets.B = [['3', 'z']];
    await e2.sync('poll');
    assert.strictEqual(e2.renders.length, 1);
    assert.ok(e2.fetched.some(u => /\/values\/C$/.test(u)), 'C 는 실제로 네트워크를 탔다');
    assert.strictEqual(e2.silentAfterReads, true, '네트워크를 타도 조용함은 그대로 — 예전엔 _fetch 가 풀어서 그 뒤의 로딩 막·토스트가 새어 나왔다');
    assert.strictEqual(e2.loadingShown, 0, '읽은 뒤에 showLoading 을 불러도 로딩 막이 뜨지 않는다');
    assert.strictEqual(e2.toasts.length, 0, '화면이 띄우려던 토스트도 삼킨다');
    assert.strictEqual(e2.State._silent, false, '끝나면 해제');

    // 삼키는 쪽 — 재그림이 네트워크를 기다리는 사이 사용자가 손댄다
    for (const evName of ['touchstart', 'pointerdown', 'keydown', 'wheel']) {
      const e3 = await opened(withC());
      e3.LiveSync.init();
      e3.tabs.dashboard = ['A', 'B', 'C']; e3.showLoadingAfterReads = true;
      e3.sheets.B = [['3', 'z']];
      e3.onFetch = u => {
        if (!/\/values\/C$/.test(u)) return;
        e3.listeners['doc:' + evName][0]({ type: evName });
        e3.ctx.toast('내가 누른 버튼의 안내', 'suc');
      };
      await e3.sync('poll');
      assert.ok(e3.toasts.includes('내가 누른 버튼의 안내'), `${evName}: 손댄 순간부터 사용자 동작의 토스트는 보인다 — 삼키면 저장했는지 알 수 없다`);
      assert.strictEqual(e3.silentAfterReads, false, `${evName}: 조용함이 풀렸다`);
    }

    // 스크롤은 풀지 않는다 — 조용한 재그림 뒤 스크롤 위치를 되돌릴 때 생기는 scroll 이벤트를 손놀림으로 오해하면 안 된다
    const e4 = await opened(withC());
    e4.LiveSync.init();
    e4.tabs.dashboard = ['A', 'B', 'C']; e4.showLoadingAfterReads = true;
    e4.sheets.B = [['3', 'z']];
    e4.onFetch = u => { if (/\/values\/C$/.test(u)) e4.listeners['doc:scroll'][0]({ type: 'scroll' }); };
    await e4.sync('poll');
    assert.strictEqual(e4.silentAfterReads, true, 'scroll 은 조용함을 풀지 않는다');
    assert.strictEqual(e4.loadingShown, 0);
    console.log('✔ ⑧ 조용함은 손놀림으로만 풀린다(네트워크 대기로는 안 풀린다)');
  }

  // (c) 그리다 실패하면 이전 «읽은 목록» 으로 되돌려 다음 주기에 다시 시도한다
  {
    const e = await opened(SHEETS());
    const prev = e.State._screenKeys.dashboard;
    const ok = e.ctx.Screens.dashboard;
    e.ctx.Screens.dashboard = async () => { throw new Error('boom'); };
    e.sheets.A = [['9', '9']];
    await e.sync('poll');
    assert.ok(e.State._screenKeys.dashboard === prev, '실패하면 이전 목록 그대로 — 비워 두면 영영 재시도가 안 된다');
    assert.ok(e.SheetsAPI._track === prev, '지금 읽기 추적도 이전 목록으로');
    e.ctx.Screens.dashboard = ok;
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '고쳐진 뒤 다음 주기에 같은 변화를 다시 반영');
    assert.deepStrictEqual(e.reads.A, ['9,9']);
    console.log('✔ ⑧ 실패 시 목록 복구');
  }

  // (d) wo-execute — 작업 상태(woId)가 없으면 전체 재그림으로 새지 않는다
  {
    const e = makeEnv({ 공정기록: [['W1', 'a']] });
    e.ctx.Screens['wo-execute'] = async () => { e.renders.push('wo-execute-full'); };
    e.State.currentScreen = 'wo-execute'; e.State.woExec = undefined;
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, 'woId 가 없으면 아무것도 안 한다(전체 재그림 = 스캔·사진 유실)');
    console.log('✔ ⑧ wo-execute woId 없음');
  }

  // (e) 사용자가 펼친 <details> 는 조용한 재그림 뒤에도 그대로
  {
    const mkDetails = titles => titles.map(t => {
      const sum = { textContent: t };
      const d = { tagName: 'DETAILS', open: false, querySelector: sel => (sel === 'summary' ? sum : null) };
      sum.parentElement = d; sum.closest = sel => (sel === 'summary' ? sum : sel === '#content' ? {} : null);
      d.closest = sel => (sel === '#content' ? {} : null);
      return { d, sum };
    });
    // 브라우저처럼: 캡처 핸들러가 먼저 돌고, 열림/닫힘(기본 동작)은 그 뒤에 일어난다 — 핸들러가 곧바로 d.open 을 읽으면 «누르기 전» 값을 기록하게 된다
    const clickSummary = (e, sum) => { e.listeners['doc:click'][0]({ target: { closest: sel => (sel === 'summary' ? sum : sel === '#content' ? {} : null) } }); sum.parentElement.open = !sum.parentElement.open; };

    const e = await opened(SHEETS());
    e.LiveSync.init();
    let cur = mkDetails(['성적서', '이력']); e.details = cur.map(x => x.d);
    e.onRender = () => { cur = mkDetails(['성적서', '이력']); e.details = cur.map(x => x.d); };   // 다시 그리면 새 요소(기본 접힘)
    clickSummary(e, cur[1].sum); await tick(); // 접힘 → 사용자가 펼침
    e.sheets.B = [['3', 'z']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1);
    assert.strictEqual(cur[1].d.open, true, '사용자가 펼친 칸은 다시 그린 뒤에도 펼쳐져 있다');
    assert.strictEqual(cur[0].d.open, false, '건드리지 않은 칸은 화면이 정한 대로');

    // 접은 것도 이어진다 — 화면이 «열림» 으로 그려도 사용자가 접었으면 접힘
    const e2 = await opened(SHEETS());
    e2.LiveSync.init();
    let c2 = mkDetails(['성적서']); e2.details = c2.map(x => x.d); c2[0].d.open = true;
    e2.onRender = () => { c2 = mkDetails(['성적서']); c2[0].d.open = true; e2.details = c2.map(x => x.d); };
    clickSummary(e2, c2[0].sum); await tick(); // 열림 → 사용자가 접음
    e2.sheets.B = [['3', 'z']];
    await e2.sync('poll');
    assert.strictEqual(c2[0].d.open, false, '사용자가 접은 칸은 화면이 열어 그려도 접힘');

    // 제목이 달라지면(= 데이터가 바뀌어 모양이 달라짐) 엉뚱한 칸을 열지 않는다
    const e3 = await opened(SHEETS());
    e3.LiveSync.init();
    let c3 = mkDetails(['성적서 1건']); e3.details = c3.map(x => x.d);
    e3.onRender = () => { c3 = mkDetails(['성적서 2건']); e3.details = c3.map(x => x.d); };
    clickSummary(e3, c3[0].sum); await tick();
    e3.sheets.B = [['3', 'z']];
    await e3.sync('poll');
    assert.strictEqual(c3[0].d.open, false, '제목(키)이 안 맞으면 복원하지 않는다');

    // 명시적으로 다시 그리면(Router.render) 기록이 비워진다
    const e4 = await opened(SHEETS());
    e4.LiveSync.init();
    let c4 = mkDetails(['성적서']); e4.details = c4.map(x => x.d);
    e4.onRender = () => { c4 = mkDetails(['성적서']); e4.details = c4.map(x => x.d); };
    clickSummary(e4, c4[0].sum); await tick();
    e4.Router.render(); await settle(); e4.LiveSync._lastSyncTs = 0;
    e4.sheets.B = [['3', 'z']];
    await e4.sync('poll');
    assert.strictEqual(c4[0].d.open, false, '명시적 다시 그림 뒤에는 처음 상태부터 — 옛 펼침을 끌고 오지 않는다');

    // 화면 밖 클릭·summary 가 아닌 요소는 기록하지 않는다
    const e5 = await opened(SHEETS());
    e5.LiveSync.init();
    e5.listeners['doc:click'][0]({ target: { closest: () => null } });
    e5.listeners['doc:click'][0]({ target: null });
    const notDetails = { tagName: 'DIV', open: false, closest: sel => (sel === '#content' ? {} : null), querySelector: () => null };
    e5.listeners['doc:click'][0]({ target: { closest: sel => (sel === 'summary' ? { parentElement: notDetails } : null) } });
    await tick();
    assert.strictEqual(e5.LiveSync._carry, null, '무관한 클릭·details 가 아닌 부모의 summary 는 아무것도 기록하지 않는다');
    console.log('✔ ⑧ 펼침 이어주기');
  }

  // (f) 입력칸을 만졌으면 «그 값이 화면에 남아 있는 동안» 이 화면의 자동 갱신을 미룬다 — 칸이 사라졌거나 기본값으로 돌아오면 풀린다
  {
    const inC = sel => (sel === '#content' ? {} : null);
    const mkInput = (o = {}) => Object.assign({ tagName: 'INPUT', type: 'text', isConnected: true, value: '쓰는 중', defaultValue: '', closest: inC }, o);
    const evOf = el => ({ target: el });
    const outside = evOf({ tagName: 'INPUT', isConnected: true, value: 'x', defaultValue: '', closest: () => null });

    const e = await opened(SHEETS());
    e.LiveSync.init();
    e.listeners['doc:input'][0](outside);
    assert.strictEqual(e.LiveSync._carry, null, '#content 밖 입력은 기록하지 않는다');
    const box = mkInput();
    e.listeners['doc:input'][0](evOf(box));
    e.sheets.B = [['3', 'z']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 0, '입력칸을 만졌으면(포커스를 벗어났어도) 다시 그리지 않는다 — 쓰던 값이 사라진다');
    assert.strictEqual(e.fetched.length, 0);
    assert.ok(e.LiveSync._busyReason('dashboard').includes('입력한 값'), '사유가 입력값 보존');
    assert.strictEqual(e.LiveSync._busyReason('other-screen'), '', '다른 화면에는 영향 없다');

    // 화면이 Router.render 를 거치지 않고 다시 그려져 칸이 사라졌다 — 값도 이미 사라졌으니 미룰 이유가 없다(예전엔 화면을 떠날 때까지 자동 갱신이 죽었다)
    box.isConnected = false;
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '칸이 화면에서 사라지면 풀린다 — 다시 그려도 잃을 값이 없다');
    assert.strictEqual(e.LiveSync._carry.touched.size, 0, '사라진 칸은 기록에서도 지운다(메모리 누수 없음)');

    // 사용자가 지웠거나 되돌렸다 — 기본값과 같으면 잃을 것이 없다
    const clr = mkInput(); const e1 = await opened(SHEETS()); e1.LiveSync.init();
    e1.listeners['doc:input'][0](evOf(clr));
    assert.ok(e1.LiveSync._busyReason('dashboard'), '쓰는 중에는 미룬다');
    clr.value = clr.defaultValue;
    assert.strictEqual(e1.LiveSync._busyReason('dashboard'), '', '지웠으면(기본값으로 돌아왔으면) 풀린다');

    const chk = mkInput({ type: 'checkbox', checked: true, defaultChecked: false }); const e1c = await opened(SHEETS()); e1c.LiveSync.init();
    e1c.listeners['doc:change'][0](evOf(chk));
    assert.ok(e1c.LiveSync._busyReason('dashboard'), '체크한 채면 미룬다');
    chk.checked = false;
    assert.strictEqual(e1c.LiveSync._busyReason('dashboard'), '', '체크를 풀었으면 풀린다');
    // 화면이 처음부터 체크해 둔 칸 — 만졌다 되돌려 처음 상태면 잃을 것이 없다 / 그 칸을 풀었다면 바뀐 것이다
    const chk2 = mkInput({ type: 'checkbox', checked: true, defaultChecked: true }); const e1d = await opened(SHEETS()); e1d.LiveSync.init();
    e1d.listeners['doc:change'][0](evOf(chk2));
    assert.strictEqual(e1d.LiveSync._busyReason('dashboard'), '', '처음부터 체크된 칸은 그대로면 풀린다(기본값과 비교한다)');
    chk2.checked = false;
    assert.ok(e1d.LiveSync._busyReason('dashboard'), '처음 체크된 칸을 풀었으면 미룬다');
    // 화면이 처음부터 값을 채워 둔 글칸 — 사용자가 고쳤다가 원래 값으로 되돌리면 풀린다
    const txt = mkInput({ value: '기본값', defaultValue: '기본값' }); const e1e = await opened(SHEETS()); e1e.LiveSync.init();
    e1e.listeners['doc:input'][0](evOf(txt));
    assert.strictEqual(e1e.LiveSync._busyReason('dashboard'), '', '처음 채워진 값 그대로면 풀린다');
    txt.value = '고친 값';
    assert.ok(e1e.LiveSync._busyReason('dashboard'), '고쳤으면 미룬다');
    txt.value = '기본값';
    assert.strictEqual(e1e.LiveSync._busyReason('dashboard'), '', '원래 값으로 되돌렸으면 풀린다');

    const mkSel = (o = {}) => mkInput(Object.assign({ tagName: 'SELECT', type: 'select-one', multiple: false, value: '', defaultValue: '' }, o));
    const opt = (selected, defaultSelected) => ({ selected, defaultSelected });
    const sel1 = mkSel({ options: [opt(false, false), opt(true, false), opt(false, false)], selectedIndex: 1 });
    const es = await opened(SHEETS()); es.LiveSync.init();
    es.listeners['doc:change'][0](evOf(sel1));
    assert.ok(es.LiveSync._busyReason('dashboard'), '처음 고른 칸(첫 칸)이 아닌 것을 골랐으면 미룬다');
    sel1.selectedIndex = 0;
    assert.strictEqual(es.LiveSync._busyReason('dashboard'), '', '처음 칸으로 되돌렸으면 풀린다 — 고른 칸이 없던 셀렉트의 기본은 첫 칸');
    const sel2 = mkSel({ options: [opt(false, false), opt(false, false), opt(true, true)], selectedIndex: 2 });
    es.listeners['doc:change'][0](evOf(sel2));
    assert.strictEqual(es.LiveSync._busyReason('dashboard'), '', '화면이 처음부터 고른 칸(selected 속성)이면 그대로라 풀린다');
    sel2.selectedIndex = 0;
    assert.ok(es.LiveSync._busyReason('dashboard'), '다른 칸으로 바꿨으면 미룬다');
    const selM = mkSel({ multiple: true, options: [opt(true, false), opt(false, false)] });
    const em = await opened(SHEETS()); em.LiveSync.init();
    em.listeners['doc:change'][0](evOf(selM));
    assert.ok(em.LiveSync._busyReason('dashboard'), '다중 선택은 칸마다 기본과 비교 — 다르면 미룬다');
    selM.options[0].selected = false;
    assert.strictEqual(em.LiveSync._busyReason('dashboard'), '', '모두 기본으로 돌아오면 풀린다');

    e.State.currentScreen = 'other'; installScreen(e, 'other', ['A']);
    e.Router.render(); await settle(); e.reset(); e.sheets.A = [['9', '9']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '다른 화면으로 가서 다시 그리면 풀린다');

    const e2 = await opened(SHEETS());
    e2.LiveSync.init();
    e2.listeners['doc:change'][0](evOf(mkInput()));
    assert.ok(e2.LiveSync._busyReason('dashboard'), 'change 도 같다(셀렉트·체크박스)');
    await e2.sync('manual');
    assert.strictEqual(e2.LiveSync._carry, null, '수동 새로고침이 기록을 비운다');
    e2.reset(); e2.sheets.B = [['3', 'z']];
    await e2.sync('poll');
    assert.strictEqual(e2.renders.length, 1, '수동 새로고침 뒤에는 자동 갱신이 다시 돈다');

    const e3 = await opened(SHEETS());
    e3.LiveSync.init();
    e3.listeners['doc:input'][0](evOf(mkInput()));
    assert.strictEqual(e3.LiveSync._busyReason('elsewhere'), '', '기록의 화면과 다르면 무시');
    for (const ev of ['input', 'change', 'click']) {
      assert.strictEqual((e3.listeners['doc:' + ev] || []).length, 1, ev + ' 리스너 1개 등록');
    }
    console.log('✔ ⑧ 입력값 보존(만진 칸 · 기본값 비교 · 사라진 칸)');
  }

  // (g) 그리다 실패해도 그 사이 다른 화면으로 옮겨 갔다면 그 화면의 읽기 추적을 덮어쓰지 않는다
  {
    const e = await opened(SHEETS());
    const other = vm.runInContext('new Map()', e.ctx);
    e.ctx.Screens.dashboard = async () => { e.State.currentScreen = 'other'; e.SheetsAPI._track = other; throw new Error('boom'); };
    e.sheets.A = [['9', '9']];
    await e.sync('poll');
    assert.ok(e.SheetsAPI._track === other, '실패 복구가 지금 화면(other)의 읽기 추적을 옛 화면 목록으로 덮어쓰지 않는다');
    assert.ok(e.State._screenKeys.dashboard !== other && e.State._screenKeys.dashboard.size === 2, '그 화면 자신의 목록은 되돌린다');
    console.log('✔ ⑧ 실패 복구는 지금 화면의 추적을 건드리지 않는다');
  }

  // ═══ ⑨ 보이게 됨·포커스 복귀가 «곧 풀릴 사유» 로 미뤄지면 한 번만 다시 시도한다 ═══
  {
    const slow = e => e.timeouts.filter(t => t.ms >= 1000);
    const e = await opened(SHEETS());
    e.sheets.B = [['3', 'z']];
    e.LiveSync._lastTouchTs = Date.now();
    await e.sync('visibility');
    assert.strictEqual(e.renders.length, 0, '방금 만졌으니 이번엔 미룬다');
    assert.strictEqual(slow(e).length, 1, '한 번 다시 시도할 타이머가 걸린다');
    assert.strictEqual(slow(e)[0].ms, e.LiveSync._idleMs + 500, '손놀림이 가라앉을 만큼 뒤에');
    await e.sync('visibility');
    assert.strictEqual(slow(e).length, 1, '또 미뤄져도 타이머는 하나 — 쌓이지 않는다');
    e.LiveSync._lastTouchTs = 0;
    slow(e)[0].fn(); await tick(); await tick();
    assert.strictEqual(e.renders.length, 1, '손놀림이 가라앉은 뒤 다시 시도하면 반영 — 다음 폴링(30초)까지 낡은 화면을 보지 않는다');
    assert.strictEqual(e.LiveSync._retryTimer, null, '다시 시도가 끝나면 타이머 표시를 비운다');

    // 다시 시도가 또 미뤄지면 거기서 멈춘다 — 폴링에 맡긴다
    const e2 = await opened(SHEETS());
    e2.sheets.B = [['3', 'z']];
    e2.LiveSync._lastTouchTs = Date.now();
    await e2.sync('focus');
    assert.strictEqual(slow(e2).length, 1);
    e2.LiveSync._lastTouchTs = Date.now(); // 여전히 작업 중
    slow(e2)[0].fn(); await tick();
    assert.strictEqual(e2.renders.length, 0, '아직 작업 중이면 이번에도 미룬다');
    assert.strictEqual(slow(e2).length, 1, '다시 시도가 미뤄져도 새 타이머를 걸지 않는다 — 무한 재시도 없음');

    // 폴링의 보류는 다음 주기가 있으니 재시도하지 않는다 · 수동은 보류가 없다
    const e3 = await opened(SHEETS());
    e3.sheets.B = [['3', 'z']]; e3.LiveSync._lastTouchTs = Date.now();
    await e3.sync('poll');
    assert.strictEqual(slow(e3).length, 0, 'poll 보류는 재시도 타이머를 걸지 않는다');

    // 숨겨진 사이 타이머가 불려도 아무 일도 하지 않는다
    const e4 = await opened(SHEETS());
    e4.sheets.B = [['3', 'z']]; e4.LiveSync._lastTouchTs = Date.now();
    await e4.sync('visibility');
    e4.document.visibilityState = 'hidden'; e4.LiveSync._lastTouchTs = 0;
    slow(e4)[0].fn(); await tick();
    assert.strictEqual(e4.renders.length + e4.fetched.length, 0, '숨겨져 있으면 받지도 않는다');

    // 받아 보니 바뀐 게 있는데 그 사이 사용자가 손댔다(반영 보류) — 이것도 한 번 다시 시도
    const e5 = await opened(SHEETS());
    e5.sheets.B = [['3', 'z']];
    e5.onFetch = () => { e5.document.activeElement = { tagName: 'TEXTAREA', id: 'memo' }; };
    await e5.sync('focus');
    assert.strictEqual(e5.renders.length, 0);
    assert.strictEqual(slow(e5).length, 1, '반영 보류도 focus/visibility 면 한 번 다시 시도');
    const e6 = await opened(SHEETS());
    e6.sheets.B = [['3', 'z']];
    e6.onFetch = () => { e6.document.activeElement = { tagName: 'TEXTAREA', id: 'memo' }; };
    await e6.sync('poll');
    assert.strictEqual(slow(e6).length, 0, 'poll 의 반영 보류는 재시도하지 않는다');

    // 받은 뒤 반영 보류의 재시도는 «실제 흐름 그대로» 돈다 — 앞 시도가 _lastSyncTs 를 찍어 둬도 5초 간격에 막히지 않고, 또 미뤄지면 거기서 멈춘다
    const e8 = await opened(SHEETS());
    e8.sheets.B = [['3', 'z']];
    e8.onFetch = () => { e8.document.activeElement = { tagName: 'TEXTAREA', id: 'memo' }; };
    await e8.sync('focus');
    assert.strictEqual(e8.renders.length, 0);
    assert.strictEqual(slow(e8).length, 1, '반영 보류 → 한 번 다시 시도');
    e8.onFetch = null; e8.document.activeElement = null;           // 손을 뗐다
    e8.LiveSync._lastTouchTs = 0;
    assert.ok(Date.now() - e8.LiveSync._lastSyncTs < e8.LiveSync._minSyncGap, '앞 시도가 방금 _lastSyncTs 를 찍어 둔 상태(실제와 같다)');
    slow(e8)[0].fn(); await tick(); await tick();                  // 간격을 손으로 풀지 않는다 — 재시도 자신이 간격을 통과해야 한다
    assert.strictEqual(e8.renders.length, 1, '재시도는 최소 간격(5초)에 막히지 않고 반영한다 — 아니면 다음 폴링(30초)까지 낡은 화면');

    const e9 = await opened(SHEETS());
    e9.sheets.B = [['3', 'z']];
    const hot = () => { e9.document.activeElement = { tagName: 'TEXTAREA', id: 'memo' }; };
    e9.onFetch = hot;
    await e9.sync('focus');
    assert.strictEqual(slow(e9).length, 1);
    e9.document.activeElement = null;                               // 잠깐 풀렸다가
    slow(e9)[0].fn(); await tick(); await tick();                   // 재시도가 받는 사이 또 손댔다(onFetch 가 다시 붙인다)
    assert.strictEqual(e9.renders.length, 0, '또 손댔으면 이번에도 미룬다');
    assert.strictEqual(slow(e9).length, 1, '받은 뒤 보류가 또 나도 새 타이머를 걸지 않는다 — retried 가 _silentSync 까지 전달된다');

    // 수동·폴링은 _retryLater 자체가 막는다(수동은 보류 경로가 없어 sync 로는 닿지 않으니 직접 부른다)
    const e10 = await opened(SHEETS());
    e10.LiveSync._retryLater('manual', false); e10.LiveSync._retryLater('poll', false);
    assert.strictEqual(slow(e10).length, 0, 'manual·poll 은 재시도 타이머를 걸지 않는다');
    e10.LiveSync._retryLater('focus', false);
    assert.strictEqual(slow(e10).length, 1, 'focus 는 건다');

    // 폴링 타이머는 보이게 될 때마다 새로 걸어도 하나뿐이다
    const e7 = await opened(SHEETS());
    e7.LiveSync.init();
    const armed = () => e7.intervals.filter(h => !h.dead).length;
    for (let i = 0; i < 3; i++) { e7.document.visibilityState = 'visible'; e7.listeners['doc:visibilitychange'][0](); }
    assert.strictEqual(armed(), 1, '보임 이벤트가 여러 번 와도 폴링은 하나 — startPoll 이 먼저 지운다');
    console.log('✔ ⑨ 미뤄진 보이게 됨·포커스는 한 번만 다시 시도');
  }

  // ═══ ⑩ 그린 뒤 사용자가 손댄 다음의 «새로 읽기» 는 «화면이 그린 것» 으로 치지 않는다 ═══
  {
    // 직접: 그리는 중에는 새로 읽은 번호를 적고, 그린 뒤 손댔다면 이미 적힌 키는 그대로 두되 새 키는 적는다
    const e0 = makeEnv({ A: [['1']], B: [['2']], C: [['5']] }); const S0 = e0.SheetsAPI;
    S0._track = new Map(); S0._userAfterRender = false;
    await S0.getAll('A'); e0.sheets.A = [['9']]; await S0.getAll('A', false);
    assert.strictEqual(S0._track.get('getAll:A'), 2, '그리는 중(손대기 전)에 새로 읽은 값은 화면이 쓴 것 — 번호를 올린다');
    S0._userAfterRender = true;
    e0.sheets.A = [['10']]; await S0.getAll('A', false);
    assert.strictEqual(S0._track.get('getAll:A'), 2, '그린 뒤 손댔다면 이미 적힌 키의 번호는 안 올린다');
    await S0.getAll('C');
    assert.strictEqual(S0._track.get('getAll:C'), 1, '새 키는 적는다 — 늦게 불러온 부분도 변경 감지 대상');
    await S0.getAll('B', true, false);
    assert.ok(!S0._track.has('getAll:B'), 'track=false 는 여전히 적지 않는다');

    // 종단: 다이얼로그가 B 를 새로 읽었는데 화면은 옛 값 그대로 — 폴링이 바뀐 것으로 보고 다시 그린다
    const e = await opened(SHEETS());
    e.LiveSync.init();
    const fire = type => e.listeners['doc:' + type].forEach(f => f({ type }));
    assert.strictEqual(e.SheetsAPI._userAfterRender, false, '그린 직후엔 꺼져 있다');
    fire('scroll');
    assert.strictEqual(e.SheetsAPI._userAfterRender, false, '스크롤만으로는 켜지지 않는다');
    fire('touchstart');
    assert.strictEqual(e.SheetsAPI._userAfterRender, true, '손대면 켜진다');
    e.sheets.B = [['3', 'z']];
    await e.SheetsAPI.getAll('B', false);                                 // 버튼·대화상자가 새로 읽음(track 기본값 true)
    assert.strictEqual(e.State._screenKeys.dashboard.get('getAll:B'), 1, '화면은 옛 값(번호 1) 그대로');
    e.LiveSync._lastTouchTs = 0;
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '새로 읽은 값이 변경 감지를 가리지 않는다 — 화면이 옛 값이면 한가할 때 다시 그린다');
    assert.strictEqual(e.SheetsAPI._userAfterRender, false, '조용히 다시 그리면 표지가 꺼진다');
    assert.strictEqual(e.State._screenKeys.dashboard.get('getAll:B'), 2, '다시 그린 뒤엔 최신 번호');

    // 명시적으로 다시 그려도(Router.render) 표지가 꺼진다
    fire('keydown');
    assert.strictEqual(e.SheetsAPI._userAfterRender, true);
    e.Router.render(); await settle();
    assert.strictEqual(e.SheetsAPI._userAfterRender, false, 'Router.render 가 표지를 끈다');
    console.log('✔ ⑩ 그린 뒤 새로 읽은 값이 변경 감지를 가리지 않는다');
  }

  // ═══ ⑪ 늦게 채워지는 칸 — 비우지 않고 이어받는다 · 그 칸의 늦은 토스트는 조용히 한다 ═══
  {
    // 도우미: 이어받을 옛 내용이 있으면 그것으로, 없으면 빈 칸(또는 자리표시) — 표지(data-late-slot)는 항상 붙는다
    const e0 = makeEnv({}); const L0 = e0.LiveSync;
    assert.strictEqual(L0._lateCarry, null, '평소엔 이어받을 것이 없다');
    assert.strictEqual(L0.lateSlot('x'), '<div id="x" data-late-slot></div>', '이어받을 게 없으면 빈 칸');
    assert.strictEqual(L0.lateSlot('x', '자리', 'mt-12'), '<div id="x" class="mt-12" data-late-slot>자리</div>', '자리표시·클래스');
    L0._lateCarry = { x: '<b>옛</b>', y: '' };
    assert.strictEqual(L0.lateSlot('x', '자리'), '<div id="x" data-late-slot><b>옛</b></div>', '옛 내용이 있으면 자리표시 대신 그것');
    assert.strictEqual(L0.lateSlot('y', '자리'), '<div id="y" data-late-slot></div>', '옛 칸이 비어 있었으면 비운 채(자리표시로 되돌리지 않는다)');
    assert.strictEqual(L0.lateSlot('z', '자리'), '<div id="z" data-late-slot>자리</div>', '옛 화면에 없던 칸은 자리표시');

    // 종단: 조용히 다시 그리는 동안 화면 함수가 lateSlot 을 부르면 «다시 그리기 전» 옛 칸 내용을 받는다
    const e = await opened(SHEETS());
    const base = e.ctx.Screens.dashboard;
    e.ctx.Screens.dashboard = async function () {
      await base.apply(this, arguments);
      e.slotHtml = e.LiveSync.lateSlot('late', '확인 중…');
      e.carryKeys = Object.keys(e.LiveSync._lateCarry || {});
    };
    e.lateNodes = [{ id: 'late', innerHTML: '<i>옛 카드</i>' }, { id: '', innerHTML: '이름 없는 칸' }];
    e.sheets.B = [['3', 'z']];
    e.LiveSync._lastTouchTs = 0;
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '바뀌었으니 조용히 다시 그렸다');
    assert.ok(e.slotHtml.includes('<i>옛 카드</i>') && !e.slotHtml.includes('확인 중'), '다시 그리는 동안 칸이 옛 내용으로 차 있다 — 비어서 높이가 줄지 않는다');
    assert.deepStrictEqual(e.carryKeys, ['late'], 'id 없는 칸은 이어받지 않는다');
    assert.strictEqual(e.LiveSync._lateCarry, null, '다 그리면 이어받기 상자를 비운다 — 다음 그리기로 새지 않는다');

    // 평범한 그리기(Router.render · 수동)는 이어받지 않는다 — 처음 그리는 화면은 자리표시부터
    e.slotHtml = null; e.sheets.B = [['4', 'w']];
    e.Router.render(); await tick(); await tick();
    assert.ok(e.slotHtml.includes('확인 중…') && !e.slotHtml.includes('옛 카드'), '평범한 그리기는 자리표시부터 시작한다');

    // 그리다 실패해도 상자는 비운다
    const ef = await opened(SHEETS());
    ef.lateNodes = [{ id: 'late', innerHTML: '옛' }];
    ef.ctx.Screens.dashboard = async () => { throw new Error('그리기 실패'); };
    ef.sheets.B = [['3', 'z']]; ef.LiveSync._lastTouchTs = 0;
    await ef.sync('poll');
    assert.strictEqual(ef.LiveSync._lateCarry, null, '그리기가 실패해도 이어받기 상자는 비워진다');

    // 홈 「챙겨야 할 서류」 로더 — 실제 코드를 stub 으로 돌린다. 느린 Drive 는 «렌더가 끝난 뒤» 에 도착한다
    const docEnv = ({ findings, quietAtStart, scanFails }) => {
      const el = { innerHTML: '<carried/>' }, toasts = [], state = { _silent: quietAtStart };
      let release; const gate = new Promise(r => { release = r; });
      const ctx = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, State: state, HS_ESC: s => String(s), toast: m => toasts.push(m),
        $id: id => (id === 'home-doc-alert' ? el : null),
        DriveDocs: { scan: async () => { await gate; if (scanFails) throw new Error('drive down'); return {}; } },
        SheetsAPI: { getAll: async () => [] }, HaccpStd: { docFindings: () => findings },
      });
      vm.runInContext(DOCALERT_SRC, ctx);
      return { el, toasts, state, release, run: () => vm.runInContext('hsLoadHomeDocAlert()', ctx) };
    };
    const ERR = [{ sev: 'err', title: '성적서 없음', detail: '폴더에 파일 없음', kind: '서류없음' }];
    {
      const d = docEnv({ findings: ERR, quietAtStart: true });
      const p = d.run();            // 렌더 «안» 에서 불린다(조용한 갱신 중)
      d.state._silent = false;      // 렌더 함수가 끝나 조용함이 풀렸다
      d.release(); await p;         // 그 뒤에 Drive 가 도착
      assert.strictEqual(d.toasts.length, 0, '조용한 갱신 중에 시작된 채움은 끝난 뒤에도 토스트를 띄우지 않는다');
      assert.ok(d.el.innerHTML.includes('성적서 없음') && !d.el.innerHTML.includes('<carried/>'), '칸 내용은 새 값으로 바뀐다');
    }
    {
      const d = docEnv({ findings: ERR, quietAtStart: false });
      const p = d.run(); d.release(); await p;
      assert.strictEqual(d.toasts.length, 1, '평범한 그리기(진입)에서는 예전처럼 안내한다');
      assert.ok(/서류 미보관 1건/.test(d.toasts[0]), '문구는 그대로');
    }
    {
      const d = docEnv({ findings: [], quietAtStart: true });
      const p = d.run(); d.release(); await p;
      assert.strictEqual(d.el.innerHTML, '', '이제 부족한 서류가 없으면 이어받은 낡은 카드를 비운다');
      assert.strictEqual(d.toasts.length, 0);
    }
    {
      const d = docEnv({ findings: ERR, quietAtStart: true, scanFails: true });
      const p = d.run(); d.release(); await p;
      assert.strictEqual(d.el.innerHTML, '<carried/>', 'Drive 를 못 읽으면 마지막으로 알던 칸을 그대로 둔다(홈은 그대로여야 한다)');
      assert.strictEqual(d.toasts.length, 0);
    }

    // 홈 「생산 계획」 로더 — 만들 카드가 없으면 이어받은 낡은 카드를 비운다
    {
      const el = { innerHTML: '<carried/>' };
      const ctx = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, State: {}, $id: id => (id === 'home-prod-plan' ? el : null),
        SheetsAPI: { getAll: async () => [] }, FactoryPnl: { fetchDough: async () => ({ rows: [] }) },
      });
      vm.runInContext(PRODPLAN_SRC, ctx);
      await vm.runInContext('loadHomeProdPlan()', ctx);
      assert.strictEqual(el.innerHTML, '', '생산 계획 카드가 하나도 없으면 이어받은 낡은 카드를 비운다');
    }
    console.log('✔ ⑪ 늦게 채워지는 칸 — 이어받기 · 늦은 토스트 조용히 · 낡은 칸 비우기');
  }

  // ═══ ⑫ 리뷰어 지적 3건 — 읽기 실패 접기 · 🔄 막히지 않음 · JS 가 바꾼 입력값 (오류형 토스트 통과는 실단말기에서 회귀가 잡혀 되돌림) ═══
  {
    // 조용히 다시 그릴 때는 오류형 토스트도 삼킨다 — 홈의 «시험성적서 만료 3건» 같은 상시 알림이 오류형이라 종류로는 가를 수 없다
    // (사용자 동작의 토스트는 손댄 순간 조용함이 풀려 그대로 보인다: ⑧)
    const e = await opened(SHEETS());
    e.sheets.B = [['3', 'z']];
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '바뀌었으니 조용히 다시 그린다');
    assert.deepStrictEqual(e.toasts, [], '화면이 오류형으로 띄우려던 상시 알림도 삼킨다(실단말기에서 다시 뜬 것을 잡은 회귀)');

    // 하나라도 못 받으면 이번엔 접는다 — 다 받아지면 그때 반영(잃지 않는다)
    const f = await opened(SHEETS());
    f.sheets.A = [['9', 'q']]; f.failTabs.add('B');
    await f.sync('poll');
    assert.strictEqual(f.renders.length, 0, '읽기가 하나 실패하면 화면 함수가 그 탭을 다시 받으러 가지 않게 이번 갱신을 접는다');
    assert.ok(!f.State._silent, '접었으니 조용함도 남지 않는다');
    f.failTabs.delete('B');
    await f.sync('poll');
    assert.strictEqual(f.renders.length, 1, '다음 주기에 다 받아지면 반영한다');
    assert.deepStrictEqual(f.reads.A, ['9,q'], '그때 새 값으로');

    // 🔄 는 느린 자동 갱신에 막히지 않고, 연타만 막는다. 자동 갱신은 그 사이 화면이 새로 그려진 걸 알고 접는다
    const m = await opened(SHEETS());
    m.sheets.B = [['3', 'z']];
    let open; m.gate = new Promise(r => { open = r; });
    m.LiveSync._lastSyncTs = 0;
    const pollP = m.LiveSync.sync('poll');           // 조용한 읽기가 응답을 기다리는 중(수십 초 걸린 적이 있다)
    await settle();
    assert.strictEqual(m.LiveSync._isSyncing, true, '자동 갱신이 도는 중');
    const manP = m.LiveSync.sync('manual');          // 사용자가 🔄 를 눌렀다
    await settle();
    assert.strictEqual(m.LiveSync._manualRunning, true, '수동은 자동 갱신 때문에 건너뛰지 않고 시작한다 — 눌러도 반응 없음 금지');
    const dupP = m.LiveSync.sync('manual');          // 연타
    open(); await Promise.all([pollP, manP, dupP]); await settle();
    assert.strictEqual(m.renders.filter(r => !r.silent).length, 1, '수동 그리기는 한 번 — 연타는 막는다');
    assert.strictEqual(m.renders.length, 1, '자동 갱신은 그 사이 화면이 새로 그려진 걸 알고 접는다 — 두 번 그리지 않는다');
    assert.ok(m.toasts.some(t => t.startsWith('데이터 동기화 완료')), '수동은 완료 토스트 그대로');
    assert.strictEqual(m.LiveSync._manualRunning, false, '끝나면 수동 표지가 풀린다');

    // 🔄 는 5초 최소 간격에 막히지 않는다 — 자동 갱신은 여전히 막힌다
    const g = await opened(SHEETS());
    g.LiveSync._lastSyncTs = Date.now();
    await g.LiveSync.sync('manual');
    assert.strictEqual(g.renders.length, 1, '방금 자동 갱신이 돌았어도 🔄 는 먹힌다');
    g.reset(); g.sheets.B = [['3', 'z']]; g.LiveSync._lastSyncTs = Date.now();
    await g.LiveSync.sync('poll');
    assert.strictEqual(g.fetched.length + g.renders.length, 0, '자동 갱신은 5초 안에 또 돌지 않는다');

    // JS 가 값만 바꾼 입력칸(+/− 버튼·스캐너) — input 이벤트가 없어도 만진 뒤에는 보존한다
    const d = await opened(SHEETS());
    d.sheets.B = [['3', 'z']];
    const qty = { type: 'number', tagName: 'INPUT', value: '0', defaultValue: '0', isConnected: true };
    const hid = { type: 'hidden', tagName: 'INPUT', value: 'x', defaultValue: '' };
    const chk = { type: 'checkbox', tagName: 'INPUT', checked: false, defaultChecked: false };
    d.controls.push(qty, hid, chk);
    d.SheetsAPI._userAfterRender = false;            // 아직 아무도 안 만졌다
    qty.value = '3';                                  // 그리는 중 JS 가 채운 값 — 잃을 것이 없다
    assert.strictEqual(d.LiveSync._busyReason('dashboard'), '', '만지기 전에 JS 가 채운 값은 보지 않는다');
    d.SheetsAPI._userAfterRender = true;             // 사용자가 화면을 만졌다(터치·키)
    assert.ok(/입력한 값 보존/.test(d.LiveSync._busyReason('dashboard')), '만진 뒤 기본값과 다른 칸이 남아 있으면 미룬다');
    await d.sync('poll');
    assert.strictEqual(d.renders.length, 0, '미룬다 — + 버튼으로 올린 수량이 사라지지 않는다');
    qty.value = '0';                                  // 사용자가 되돌렸다
    assert.strictEqual(d.LiveSync._busyReason('dashboard'), '', '숨은 칸(hidden)은 보지 않고, 되돌렸으면 미룰 이유가 없다');
    chk.checked = true;                               // 체크박스를 JS 가 켰다
    assert.ok(/입력한 값 보존/.test(d.LiveSync._busyReason('dashboard')), '체크박스도 본다');
    chk.checked = false;
    await d.sync('poll');
    assert.strictEqual(d.renders.length, 1, '기본값으로 돌아오면 그때 반영한다 — 잃지 않는다');
    console.log('✔ ⑫ 읽기 실패 접기 · 오류형 상시 알림도 조용히 · 🔄 막히지 않음 · JS 가 바꾼 입력값');
  }

  // ═══ ⑬ 적대적 리뷰어 2차 지적 — 매달린 동기화 놓기 · 표는 자기가 올린 것만 내리기 · 처음 손댄 순간의 값 기준 · 실패하면 표지 되돌리기 ═══
  {
    const STUCK = 61000;
    // ① 읽기가 끝나지 않고 매달리면 «동기화 중» 이 영영 안 풀린다 — 60초 넘으면 낡은 것으로 놓고 다시 시작한다
    const a = await opened(SHEETS());
    a.sheets.B = [['3', 'z']];
    let open1; a.gate = new Promise(r => { open1 = r; });
    a.LiveSync._lastSyncTs = 0;
    const hung = a.LiveSync.sync('poll');             // 망이 끊겨 첫 읽기가 돌아오지 않는다
    await settle();
    assert.strictEqual(a.LiveSync._isSyncing, true, '자동 갱신이 매달려 있다');
    a.LiveSync._lastSyncTs = 0;
    a.fetched.length = 0;
    a.LiveSync._syncSince = Date.now() - 30000;       // 30초째 — 느린 망일 수 있다(한도 안)
    await a.LiveSync.sync('poll');
    assert.strictEqual(a.fetched.length, 0, '60초 안에는 겹쳐 돌지 않는다');
    a.LiveSync._syncSince = Date.now() - STUCK;       // 60초 넘게 끝나지 않았다
    a.LiveSync._lastSyncTs = 0;
    a.gate = null;                                    // 이번 읽기는 정상으로 돌아온다
    await a.LiveSync.sync('poll');
    assert.ok(a.fetched.length > 0, '매달린 것을 놓고 새로 읽는다 — 자동 갱신이 영영 죽지 않는다');
    assert.strictEqual(a.renders.length, 1, '새로 읽은 값으로 조용히 그린다');
    assert.strictEqual(a.LiveSync._isSyncing, false, '새 실행이 끝나면 표가 풀린다');
    // 매달렸던 낡은 실행이 늦게 끝나도 지금 실행의 표를 못 내린다
    a.sheets.B = [['4', 'w']];
    let open2; a.gate = new Promise(r => { open2 = r; });
    a.LiveSync._lastSyncTs = 0;
    const third = a.LiveSync.sync('poll');            // 세 번째 실행이 읽기를 기다리는 중
    await settle();
    assert.strictEqual(a.LiveSync._isSyncing, true);
    open1(); await hung; await settle();              // 낡은 첫 실행이 이제 끝난다
    assert.strictEqual(a.LiveSync._isSyncing, true, '낡은 실행의 finally 는 세 번째 실행의 표를 내리지 못한다(세대)');
    open2(); await third; await settle();
    assert.strictEqual(a.LiveSync._isSyncing, false);
    // 🔄 도 매달리면 같다
    const b = await opened(SHEETS());
    b.LiveSync._manualRunning = true; b.LiveSync._manualSince = Date.now() - STUCK;
    await b.LiveSync.sync('manual');
    assert.ok(b.renders.length === 1, '매달린 🔄 표를 놓고 다시 돈다');

    // ② 🔄 가 자동 갱신보다 먼저 끝나도 자동의 «도는 중» 표를 내리지 않는다 · 자동은 🔄 가 도는 중에도 쉰다
    const c = await opened(SHEETS());
    c.sheets.B = [['3', 'z']];
    let gA; c.gate = new Promise(r => { gA = r; });
    c.LiveSync._lastSyncTs = 0;
    const autoP = c.LiveSync.sync('poll');            // 자동이 읽기를 기다린다
    await settle();
    c.gate = null;
    await c.LiveSync.sync('manual');                  // 🔄 는 막히지 않고 먼저 끝난다
    assert.strictEqual(c.LiveSync._manualRunning, false);
    assert.strictEqual(c.LiveSync._isSyncing, true, '🔄 가 먼저 끝나도 아직 도는 자동 갱신의 표는 그대로 — 자동이 겹쳐 돌지 않는다');
    c.fetched.length = 0; c.LiveSync._lastSyncTs = 0;
    await c.LiveSync.sync('poll');
    assert.strictEqual(c.fetched.length, 0, '자동 갱신이 아직 도는 중이니 또 시작하지 않는다');
    gA(); await autoP; await settle();
    assert.strictEqual(c.LiveSync._isSyncing, false, '자동이 끝나면 풀린다');
    // 반대 — 자동이 먼저 끝나고 🔄 가 아직 도는 중이면 자동은 쉰다
    const d = await opened(SHEETS());
    d.sheets.B = [['3', 'z']];
    let gP; d.gate = new Promise(r => { gP = r; });
    d.LiveSync._lastSyncTs = 0;
    const pollP = d.LiveSync.sync('poll'); await settle();
    let gM; d.gate = new Promise(r => { gM = r; });
    const manP = d.LiveSync.sync('manual'); await settle();
    gP(); await pollP; await settle();                // 자동이 먼저 끝난다
    assert.strictEqual(d.LiveSync._isSyncing, false);
    assert.strictEqual(d.LiveSync._manualRunning, true, '🔄 는 아직 도는 중');
    d.fetched.length = 0; d.LiveSync._lastSyncTs = 0;
    await d.LiveSync.sync('poll');
    assert.strictEqual(d.fetched.length, 0, '🔄 가 도는 중에는 자동이 겹쳐 돌지 않는다');
    gM(); await manP; await settle();
    assert.strictEqual(d.LiveSync._manualRunning, false);

    // 🔄 연타는 자동 갱신이 없어도 막는다(두 번째는 건너뛴다)
    const q = await opened(SHEETS());
    let gq; q.gate = new Promise(r => { gq = r; });
    const m1 = q.LiveSync.sync('manual'); await settle();
    const n0 = q.fetched.length;
    await q.LiveSync.sync('manual');
    assert.strictEqual(q.fetched.length, n0, '🔄 가 도는 중에 또 누르면(연타) 건너뛴다');
    gq(); await m1;

    // 자동이 오래 매달려 있어도, 방금 시작한 🔄 는 낡은 것이 아니다 — 🔄 의 시각은 자동의 시각과 따로 잰다(연타는 건너뛴다)
    const z = await opened(SHEETS());
    z.sheets.B = [['3', 'z']];
    let gz; z.gate = new Promise(r => { gz = r; });
    z.LiveSync._lastSyncTs = 0;
    const zAuto = z.LiveSync.sync('poll'); await settle();
    z.LiveSync._syncSince = Date.now() - STUCK;       // 자동은 60초 넘게 매달렸다
    const zMan = z.LiveSync.sync('manual'); await settle(); // 🔄 는 막히지 않고 시작한다 — 시작 시각은 방금
    const nz = z.fetched.length;
    await z.LiveSync.sync('manual');
    assert.strictEqual(z.fetched.length, nz, '방금 시작한 🔄 는 낡은 것이 아니다 — 연타는 건너뛴다');
    gz(); await Promise.all([zAuto, zMan]); await settle();

    // 폴링은 «도는 중» 이어도 sync 에 맡긴다 — 매달림 감시가 거기 있어 폴링 쪽에서 먼저 막으면 영영 못 푼다
    const p = await opened(SHEETS());
    p.LiveSync.startPoll();
    p.LiveSync._isSyncing = true; p.LiveSync._syncSince = Date.now() - STUCK;
    p.LiveSync._lastSyncTs = 0;
    p.intervals[p.intervals.length - 1].fn();
    await settle();
    assert.ok(p.LiveSync._syncGen >= 1, '폴링이 불렀고 sync 가 매달린 표를 놓았다');

    // ③ 처음 손댄 «순간» 의 값과 비교한다 — 그리는 중 JS 가 채운 기본값은 사용자 변경이 아니다
    const e = await opened(SHEETS());
    e.sheets.B = [['3', 'z']];
    e.LiveSync.init();
    const range = { type: 'select-one', tagName: 'SELECT', multiple: false, selectedIndex: 2, options: [{ selected: false, defaultSelected: true }, { selected: false, defaultSelected: false }, { selected: true, defaultSelected: false }] };
    const qty = { type: 'number', tagName: 'INPUT', value: '3', defaultValue: '0', isConnected: true };
    const cb = { type: 'checkbox', tagName: 'INPUT', checked: false, defaultChecked: false };
    e.controls.push(range, qty, cb);                  // JS 가 그리는 중 기간 select 를 «이번 달» 로, 수량을 3 으로 채웠다(기본값과 다르다)
    e.listeners['doc:touchstart'][0]({ type: 'touchstart' }); // 사용자가 화면을 처음 만진다 — 이 순간 값을 찍는다
    e.LiveSync._lastTouchTs = 0;                      // 손놀림 2초 대기는 따로 시험했다(⑤) — 여기선 입력값 판정만 본다
    assert.strictEqual(e.LiveSync._busyReason('dashboard'), '', 'JS 가 채운 기본값은 처음 손댈 때 이미 그랬으니 변경이 아니다 — 자동 갱신을 영영 미루지 않는다');
    await e.sync('poll');
    assert.strictEqual(e.renders.length, 1, '그래서 값이 바뀌면 조용히 반영된다');
    e.reset();
    assert.strictEqual(e.SheetsAPI._userAfterRender, false, '조용히 다시 그렸으니 «손댔다» 표지는 꺼져 있다');
    e.listeners['doc:touchstart'][0]({ type: 'touchstart' }); // 다시 만진다 — 이 순간 값이 새 기준
    e.LiveSync._lastTouchTs = 0;
    qty.value = '4';                                  // 사용자가 + 를 눌렀다
    assert.ok(/입력한 값 보존/.test(e.LiveSync._busyReason('dashboard')), '처음 손댄 순간보다 바뀌었으면 미룬다');
    qty.value = '3'; range.selectedIndex = 1;
    assert.ok(/입력한 값 보존/.test(e.LiveSync._busyReason('dashboard')), 'select 도 처음 손댄 순간과 비교한다');
    range.selectedIndex = 2;
    assert.strictEqual(e.LiveSync._busyReason('dashboard'), '', '처음 손댄 순간 값으로 되돌렸으면 미룰 이유가 없다');
    cb.checked = true;                                // 체크박스를 JS 가 켰다
    assert.ok(/입력한 값 보존/.test(e.LiveSync._busyReason('dashboard')), '체크박스도 처음 손댄 순간과 비교한다');
    cb.checked = false;
    const late = { type: 'text', tagName: 'INPUT', value: 'abc', defaultValue: '' };
    e.controls.push(late);                            // 만진 뒤에 생긴 칸(찍어 둔 값이 없다)은 «처음 그려진 값» 과 비교한다
    assert.ok(/입력한 값 보존/.test(e.LiveSync._busyReason('dashboard')), '그 뒤에 생긴 칸은 기본값과 다르면 보존');
    late.value = '';
    // 다시 그리면 기준을 새로 잡는다 — 이어서 만지면 그때 값이 새 기준
    e.State.currentScreen = 'dashboard'; e.Router.render(); await settle();
    assert.strictEqual(e.SheetsAPI._userAfterRender, false, '다시 그리면 «손댔다» 표지가 꺼진다');
    qty.value = '9';
    e.listeners['doc:keydown'][0]({ type: 'keydown' });
    e.LiveSync._lastTouchTs = 0;
    assert.strictEqual(e.LiveSync._busyReason('dashboard'), '', '다시 만진 순간의 값이 새 기준이다');

    // ④ 그리기가 실패하면 «손댔다» 표지를 되돌린다 — 옛 화면이 그대로니 JS 가 바꾼 값 보호도 그대로
    const g = await opened(SHEETS());
    g.sheets.B = [['3', 'z']];
    g.SheetsAPI._userAfterRender = true;
    g.ctx.Screens.dashboard = async () => { throw new Error('그리다 실패'); };
    await g.sync('poll');
    assert.strictEqual(g.SheetsAPI._userAfterRender, true, '그리기가 실패해도 손댄 표지가 꺼지지 않는다');
    const h = await opened(SHEETS());
    h.sheets.B = [['3', 'z']];
    h.SheetsAPI._userAfterRender = false;
    h.ctx.Screens.dashboard = async () => { throw new Error('그리다 실패'); };
    await h.sync('poll');
    assert.strictEqual(h.SheetsAPI._userAfterRender, false, '손대지 않았으면 그대로 꺼져 있다(실패가 표지를 켜지 않는다)');
    console.log('✔ ⑬ 매달린 동기화 놓기 · 표는 자기 것만 · 처음 손댄 순간 기준 · 실패하면 표지 되돌리기');
  }

  // ═══ ⑭ 적대적 리뷰어 3차(fix8 diff) — 놓인 낡은 실행이 늦게 깨어나도 지금 실행을 흔들지 못한다 · 실패 복원은 비교 기준도 ═══
  {
    const STUCK = 61000;
    // ① 낡은 실행이 «읽기» 에서 깨어나면 그리지 않고 접는다 — 지금 실행이 그린다(겹쳐 그리면 화면이 두 번 바뀐다)
    const s = await opened(SHEETS());
    s.sheets.B = [['3', 'z']];
    let g1; s.gate = new Promise(r => { g1 = r; });
    s.LiveSync._lastSyncTs = 0;
    const staleA = s.LiveSync.sync('poll'); await settle();       // 첫 읽기가 돌아오지 않는다
    s.LiveSync._syncSince = Date.now() - STUCK;                   // 60초 넘게 매달렸다
    let g2; s.gate = new Promise(r => { g2 = r; });
    s.LiveSync._lastSyncTs = 0;
    const freshB = s.LiveSync.sync('poll'); await settle();       // 낡은 것을 놓고 새로 시작 — 이 읽기도 아직 안 돌아온다
    assert.strictEqual(s.LiveSync._syncGen, 1, '낡은 것을 놓았다');
    g1(); await staleA; await settle();                           // 낡은 첫 실행이 이제 깨어난다
    assert.strictEqual(s.renders.length, 0, '놓인 낡은 실행은 깨어나도 그리지 않는다 — 지금 실행이 그린다');
    g2(); await freshB; await settle();
    assert.strictEqual(s.renders.length, 1, '지금 실행이 한 번 그린다');

    // ② 낡은 실행이 «그리는 도중» 매달렸다 늦게 끝나도 지금 실행의 조용함을 지우지 못한다
    const t = await opened(SHEETS());
    t.sheets.B = [['3', 'z']];
    let r1; t.renderGate = new Promise(r => { r1 = r; });
    t.LiveSync._lastSyncTs = 0;
    const staleC = t.LiveSync.sync('poll'); await settle();       // 그리는 도중(화면 함수 안)에서 매달렸다
    assert.strictEqual(t.ctx.State._silent, true, '낡은 실행이 조용히 그리는 중');
    t.LiveSync._syncSince = Date.now() - STUCK;
    t.sheets.B = [['4', 'w']];                                    // 지금 실행이 그릴 새 값
    let r2; t.renderGate = new Promise(r => { r2 = r; });
    t.LiveSync._lastSyncTs = 0;
    const freshD = t.LiveSync.sync('poll'); await settle();       // 놓고 새로 시작해 그리는 도중에 매달린다
    assert.strictEqual(t.ctx.State._silent, true, '지금 실행이 조용히 그리는 중');
    r1(); await staleC; await settle();                           // 낡은 실행의 그리기가 이제 끝난다
    assert.strictEqual(t.ctx.State._silent, true, '낡은 실행의 뒤처리는 지금 실행의 조용함을 못 지운다(세대)');
    r2(); await freshD; await settle();
    assert.strictEqual(t.ctx.State._silent, false, '지금 실행이 끝나면 풀린다');

    // ③ 그리기가 실패하면 비교 기준(_domBase)도 되돌린다 — 안 그러면 그리는 도중의 손놀림이 «이미 바뀐 값» 을 새 기준으로 찍어
    //    JS 가 바꾼 값이 보호를 잃는다
    const f = await opened(SHEETS());
    f.sheets.B = [['3', 'z']];
    f.LiveSync.init();
    const q1 = { type: 'number', tagName: 'INPUT', value: '3', defaultValue: '0', isConnected: true };
    f.controls.push(q1);
    f.listeners['doc:touchstart'][0]({ type: 'touchstart' });     // 처음 손댄다 — 이 순간 값 3 이 기준
    q1.value = '4';                                               // + 를 눌렀다(input 이벤트 없이 JS 만 값을 바꾼다)
    f.LiveSync._lastTouchTs = 0;
    assert.ok(/입력한 값 보존/.test(f.LiveSync._busyReason('dashboard')), '처음 손댄 순간(3)과 다르니 보존');
    f.onRender = () => { f.listeners['doc:touchstart'][0]({ type: 'touchstart' }); throw new Error('그리다 실패'); }; // 그리는 도중 또 손댄다 → 옛 DOM(4)이 새 기준으로 찍힌다
    await f.sync('manual');
    f.LiveSync._lastTouchTs = 0;
    assert.strictEqual(f.SheetsAPI._userAfterRender, true, '그리기가 실패해도 손댄 표지는 그대로');
    // _busyReason 은 쓰지 않는다 — 그리다 실패한 🔄 는 hideLoading 전에 던져 «불러오는 중» 이 먼저 나온다. 비교 기준 자체를 본다
    assert.strictEqual(f.LiveSync._domDirty(), true, '실패하면 비교 기준도 되돌아가 JS 가 바꾼 값(4≠3)이 여전히 보호된다');
    console.log('✔ ⑭ 놓인 낡은 실행은 지금 실행을 못 흔든다 · 실패하면 비교 기준도 되돌린다');
  }

  // ═══ 소스 형태(주석 제거 사본 · 호출 형태) ═══
  {
    const live = strip(LIVE_SRC);
    const between = (a, b) => { const i = live.indexOf(a), j = live.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a}..${b}`); return live.slice(i, j); };
    const silent = between('async _silentSync(', 'async _renderScreen(');
    assert.ok(!/invalidateAllCache|toast\(/.test(silent), '조용한 경로는 캐시 전체 무효화·토스트를 부르지 않는다');
    assert.ok(/SheetsAPI\.getAll\(arg, false, false\)/.test(silent) && /SheetsAPI\.getRange\(arg, false, false\)/.test(silent), '선읽기는 track=false');
    assert.ok(/State\._silent = true;/.test(silent) && /finally \{ if \(gen === this\._syncGen\) \{ State\._silent = false; this\._lateCarry = null; \} \}/.test(silent), '_silent 와 이어받기 상자는 함께 finally 로 해제(같은 세대일 때만)');
    assert.ok(/this\._lateCarry = \{\};[\s\S]*querySelectorAll\('\[data-late-slot\]'\)[\s\S]*await this\._renderScreen\(screen\)/.test(silent), '옛 칸 내용은 다시 그리기 «전» 에 모은다');
    const manual = between('async _manualSync(', 'async _silentSync(');
    assert.ok(/SheetsAPI\.invalidateAllCache\(\)/.test(manual) && /toast\(/.test(manual), '수동 경로는 예전처럼 전체 무효화 + 토스트');
    assert.ok(/this\.startPoll\(\);\s*this\.sync\('visibility'\)/.test(live), '보이게 되면 폴링을 되살린 뒤 동기화');
    assert.ok(/const manual = trigger === 'manual';[\s\S]*if \(!manual\) \{[\s\S]*_busyReason/.test(live), '바쁨 검사는 자동 트리거에만');
    const ui = strip(UI_SRC);
    assert.ok(/function showLoading\(\) \{ if \(State\._silent\) return;/.test(ui), 'showLoading 은 조용한 갱신 중 무동작');
    assert.ok(/function toast\([^)]*\) \{\s*if \(State\._silent\) return;/.test(ui), 'toast 는 조용한 갱신 중 무동작');
    assert.ok(/SheetsAPI\._track = State\._screenKeys\[s\] = new Map\(\)/.test(strip(ROUTER_SRC)), 'Router.render 가 화면마다 읽은 목록을 새로 건다');
    assert.ok(!/startsWith\(tab\)/.test(strip(SHEETS_SRC)), '옛 invalidateCache(startsWith(tab)) 가 없다');
    assert.ok(!/State\._silent\s*=/.test(strip(SHEETS_SRC)), '네트워크 계층(_fetch)은 조용함을 건드리지 않는다 — 풀 수 있는 건 사용자 손놀림뿐');
    assert.ok(/const mark = e => \{[^}]*e\.type !== 'scroll'\) \{ State\._silent = false; if \(!SheetsAPI\._userAfterRender\) this\._snapDom\(\); SheetsAPI\._userAfterRender = true; \}/.test(live), '터치·키·휠 손놀림이 조용함을 풀고, 처음 손대는 순간의 입력값을 찍고(_snapDom), «그린 뒤 손댐» 표지를 켠다(스크롤 제외)');
    assert.ok(/if \(this\._userAfterRender && this\._track\.has\(key\)\) return;/.test(strip(SHEETS_SRC)), '그린 뒤 새로 읽은 값은 이미 적힌 키를 가리지 않는다');
    assert.strictEqual((strip(ROUTER_SRC).match(/SheetsAPI\._userAfterRender = false;/g) || []).length, 1, 'Router.render 가 표지를 끈다');
    assert.strictEqual((between('async _renderScreen(', '_carryFor() {').match(/SheetsAPI\._userAfterRender = false;/g) || []).length, 1, '_renderScreen 이 표지를 끈다');
    assert.ok(/if \(State\.currentScreen === screen\) SheetsAPI\._track = prevTrack/.test(live), '실패 복구는 지금 화면일 때만 읽기 추적을 되돌린다');
    assert.ok(/this\._retryLater\(trigger, retried\);\s*return;/.test(silent) && /this\._unsavedInput\(screen\)/.test(live), '반영 보류도 한 번 다시 시도 · 입력값 판정은 _unsavedInput');
    assert.ok(!/\.dirty\b/.test(live), '옛 dirty 불리언이 없다 — 만진 칸 집합(touched)으로 바뀌었다');
    // ⑪ 늦게 채워지는 칸 — 옛 «비어 시작하는 고정 칸» 은 없고, 세 칸 모두 lateSlot 으로
    const all = strip(SRC);
    assert.ok(/\$\{LiveSync\.lateSlot\('home-prod-plan'\)\}/.test(all) && /\$\{LiveSync\.lateSlot\('home-doc-alert'\)\}/.test(all), '홈의 두 늦은 칸은 lateSlot 으로');
    assert.ok(/LiveSync\.lateSlot\('hs-docs', /.test(all), '성적서 탭 서류 현황 칸도 lateSlot 으로');
    assert.ok(!/<div id="home-prod-plan"><\/div>/.test(all) && !/<div id="home-doc-alert"><\/div>/.test(all) && !/<div id="hs-docs" class="mt-12">/.test(all), '옛 고정 칸(비어 시작하는 리터럴)이 없다');
    const docAlert = strip(DOCALERT_SRC);
    assert.ok(docAlert.includes('const quiet = !!State._silent;') && docAlert.indexOf('const quiet') < docAlert.indexOf('await '), 'quiet 은 첫 await «전» 에 잡는다(= 렌더 안일 때)');
    assert.ok(/if \(errN > 0 && !quiet\) toast\(/.test(docAlert), '조용한 갱신에서 시작된 채움은 토스트를 건너뛴다');
    assert.ok(/if \(!findings\.length\) \{ el\.innerHTML = ''; return; \}/.test(docAlert), '부족한 서류가 없으면 칸을 비운다');
    assert.ok(/if \(!cards\.length\) \{ el\.innerHTML = ''; return; \}/.test(strip(PRODPLAN_SRC)), '만들 카드가 없으면 칸을 비운다');
    // ⑫ 리뷰어 지적 4건
    const uiSrc = strip(UI_SRC), toastSrc = uiSrc.slice(uiSrc.indexOf("function toast"));
    assert.ok(/if \(State\._silent\) return;/.test(toastSrc) && !/type !== 'err'/.test(toastSrc), '토스트: 조용한 구간은 오류형까지 삼킨다 — 홈의 상시 알림이 오류형이다');
    assert.ok(/if \(!manual && !retried && now - this\._lastSyncTs < this\._minSyncGap\)/.test(live), '최소 간격은 자동 갱신에만 — 🔄 는 안 막는다');
    assert.ok(/const busy = manual \? this\._manualRunning : \(this\._isSyncing \|\| this\._manualRunning\);/.test(live) && /if \(manual\) \{ this\._manualRunning = true; this\._manualSince = now; \}/.test(live) && /if \(manual\) this\._manualRunning = false;/.test(live), '수동은 연타만 막고 자동 갱신 중에도 시작한다 · 자동은 🔄 가 도는 중에 쉰다');
    assert.ok(/return p\.catch\(\(\) => \{ failed\+\+; \}\);/.test(silent) && /if \(failed\) \{[\s\S]*?return; \}/.test(silent), '미리 읽기가 하나라도 실패하면 이번 갱신을 접는다');
    assert.ok(/if \(this\._domDirty\(\)\) return /.test(live) && /_domDirty\(\) \{\s*if \(!SheetsAPI\._userAfterRender\) return false;/.test(live) && /querySelectorAll\('input,select,textarea'\)/.test(live), 'JS 가 바꾼 입력칸 보존 — 만지기 전엔 보지 않는다');
    // ⑬ 8차
    assert.ok(/_stuckMs: 60000,/.test(live) && /this\._syncGen\+\+; this\._isSyncing = false; this\._manualRunning = false; State\._silent = false;/.test(live), '매달린 동기화는 60초 넘으면 놓는다(세대를 올린다)');
    assert.ok(/if \(gen === this\._syncGen\) \{[^}]*if \(manual\) this\._manualRunning = false;[^}]*if \(owns\) this\._isSyncing = false;/.test(live), '표는 같은 세대·자기가 올린 것만 내린다');
    assert.ok(/const owns = !this\._isSyncing;/.test(live) && /if \(owns\) \{ this\._isSyncing = true; this\._syncSince = now; \}/.test(live), '자동의 표가 이미 있으면 🔄 는 그 표를 건드리지 않는다');
    assert.ok(/setInterval\(\(\) => \{\s*if \(document\.visibilityState === 'visible'\) this\.sync\('poll'\);/.test(live) && !/visible' && !this\._isSyncing/.test(live), '폴링은 도는 중이어도 sync 에 맡긴다(매달림 감시가 거기 있다)');
    assert.ok(/_snapDom\(\) \{[\s\S]*?this\._domBase = m;/.test(live) && /base && base\.has\(el\) \? this\._controlValue\(el\) !== base\.get\(el\) : this\._differsFromDefault\(el\)/.test(live), '입력 보존은 처음 손댄 순간 값과 비교하고, 그 뒤에 생긴 칸만 기본값과 비교한다');
    assert.ok(/const userBefore = SheetsAPI\._userAfterRender, baseBefore = this\._domBase;/.test(live) && /if \(userBefore\) \{ SheetsAPI\._userAfterRender = true; this\._domBase = baseBefore; \}/.test(live), '그리기가 실패하면 손댄 표지와 비교 기준을 이전 값으로 되돌린다');
    // ⑭ 9차
    assert.ok(/async _silentSync\(screen, trigger, retried\) \{\s*const gen = this\._syncGen;/.test(live) && /\}\)\);\s*if \(gen !== this\._syncGen\) \{[^}]*return; \}/.test(live), '낡은 실행은 읽기 뒤에 그리지 않고 접는다');
    assert.ok(/finally \{ if \(gen === this\._syncGen\) \{ State\._silent = false; this\._lateCarry = null; \} \}/.test(live), '그리기 뒤처리는 같은 세대일 때만 조용함을 푼다');
    assert.ok(/this\._manualRunning = false; State\._silent = false; this\._lateCarry = null;/.test(live), '놓을 때 늦은 칸 이어받기도 비운다');
    console.log('✔ 소스 형태');
  }

  finished = true;
  console.log('\nlive-sync-silent: 전부 통과');
})().catch(e => { console.error(e); process.exit(1); });
