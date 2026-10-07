/* 🔔 출하승인 알림(웹푸시) — 시뮬레이션 검증 (사용자 지시 2026-10-07 «출하 승인알람을 한성호 팀장의 공장 앱에서»)

   실행:  node tests/ship-approve-push.test.js      실패하면 assert 로 즉시 중단
   범위:  ① ShipApprovePush 의 순수 부분(index.html 원본을 그대로 떼어 돌린다) — 받는 사람·시트 행 모양·키 변환·?go 딥링크
          ② 서비스워커(sw.js 원본) — 푸시를 받으면 알림을 띄우고, 누르면 열린 창을 올리거나 새로 연다
          ③ 배선 — 함수만 있고 호출이 빠지면 로직 시험은 초록인데 화면엔 아무것도 없다. 그래서 꽂힌 자리까지 본다.
   서버(판단·발송)는 maytutu-erp `scripts/sf_ship_approve_push.gs` + `tests/sf_ship_approve_push.test.mjs`. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
// vm 안에서 만든 배열·객체는 프로토타입이 달라 deepStrictEqual 이 «같은데 다르다» 고 한다 — 비교 전에 평범한 값으로
const plain = x => JSON.parse(JSON.stringify(x));
function slice(startMark, endMark) {
  const i = SRC.indexOf(startMark);
  assert.notStrictEqual(i, -1, `index.html 에서 시작 마커를 찾지 못함: ${startMark}`);
  const j = SRC.indexOf(endMark, i);
  assert.notStrictEqual(j, -1, `index.html 에서 종료 마커를 찾지 못함: ${endMark}`);
  return SRC.slice(i, j + endMark.length);
}

// ── ① 모듈을 떼어 돌린다 ─────────────────────────────────────────────────────
function load({ href = 'https://maytutu-factory.vercel.app/app/factory/home', user = { email: 'lead@example.com', role: 'admin' } } = {}) {
  const went = [], replaced = [], listeners = {};
  const ctx = {
    State: { user, currentScreen: 'dashboard' },
    ON_ERP_HOST: true,
    location: { href },
    history: { state: { screen: 'init' }, replaceState(s, t, u) { replaced.push(u); ctx.location.href = new URL(u, ctx.location.href).href; } },
    navigator: { serviceWorker: { addEventListener(ev, fn) { listeners[ev] = fn; } }, userAgent: 'test' },
    window: {}, Notification: {}, URL, atob: s => Buffer.from(s, 'base64').toString('binary'), Uint8Array,
    Router: { go(s) { went.push(s); } },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(slice('// <ship-approve-push>', '// </ship-approve-push>') + '\n;this.ShipApprovePush = ShipApprovePush;', ctx,
    { filename: 'index.html#ShipApprovePush' });
  return { P: ctx.ShipApprovePush, ctx, went, replaced, listeners };
}

{
  const { P } = load();

  // 받는 사람 — 사용자 선택 «한성호 팀장만»(2026-10-07). 명단은 코드가 아니라 공장 시트 «사용자» 탭 F열 «알림» 이다
  //   (이 저장소는 public — 이메일을 코드에 적으면 세상에 공개된다). 아래 이메일은 시험용 가짜다.
  assert.strictEqual(P.FLAG, '출하승인');
  assert.strictEqual(P.USER_COL, 5, '사용자 탭 F열 — [0]=email [1]=name [2]=role [3]=phone [4]=createdAt 다음 칸');
  const users = [
    ['boss@example.com', '대표', 'admin', '', '2026-04-01'],                       // F 비어 있음
    ['lead@example.com', '팀장', 'admin', '', '2026-09-25', '출하승인'],
    ['worker@example.com', '작업자', 'worker', '', '2026-04-01', '출하승인'],       // 작업자는 승인권이 없다
    ['multi@example.com', '관리', 'admin', '', '2026-09-25', '검교정, 출하승인'],   // 여러 낱말
    ['near@example.com', '관리', 'admin', '', '2026-09-25', '출하승인대기'],        // 비슷한 글자는 아니다
  ];
  assert.strictEqual(P.isRecipientIn(users, 'lead@example.com'), true);
  assert.strictEqual(P.isRecipientIn(users, '  LEAD@example.com '), true, '대소문자·공백이 달라도 같은 사람');
  assert.strictEqual(P.isRecipientIn(users, 'multi@example.com'), true, '쉼표로 여러 알림을 적어도 읽는다');
  for (const other of ['boss@example.com', 'worker@example.com', 'near@example.com', 'nobody@example.com', '', null, undefined]) {
    assert.strictEqual(P.isRecipientIn(users, other), false, `${other} 는 받는 사람이 아니다 — 켜기 단추가 안 보여야 한다`);
  }
  assert.strictEqual(P.isRecipientIn(null, 'lead@example.com'), false, '사용자 탭을 못 읽으면 아무도 아니다(단추를 감춘다)');
  assert.strictEqual(P.flagged(['x@example.com', '', 'ADMIN', '', '', '출하승인']), true, '역할 글자 대소문자 무관');

  // 활성 판정 — 시트가 TRUE 를 불리언으로도, 글자로도 돌려준다
  for (const v of [true, 'TRUE', 'true', ' TRUE ']) assert.strictEqual(P.isActive(v), true, `${JSON.stringify(v)} = 켜짐`);
  for (const v of [false, '', 'FALSE', null, undefined, '1']) assert.strictEqual(P.isActive(v), false, `${JSON.stringify(v)} = 꺼짐`);

  // 시트 행 모양 — 서버(sf_ship_approve_push.gs)는 머리글 이름으로 읽는다. 이름·순서가 계약이다
  assert.deepStrictEqual(plain(P.HEADER), ['subId', 'email', 'endpoint', 'p256dh', 'auth', 'device', 'active', 'topics', 'createdAt', 'updatedAt']);
  const j = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPx-key', auth: '-starts-with-dash' } };
  const row = P.rowFor(j, 'LEAD@example.com', 'Mozilla/5.0 '.repeat(20), '2026-10-07 18:00', 'SFP-1');
  assert.strictEqual(row.length, P.HEADER.length, '행 칸 수 = 머리글 칸 수');
  const at = k => row[P.HEADER.indexOf(k)];
  assert.strictEqual(at('subId'), 'SFP-1');
  assert.strictEqual(at('email'), 'lead@example.com', '이메일은 소문자로 — 서버가 소문자로 대조한다');
  assert.strictEqual(at('endpoint'), j.endpoint);
  assert.strictEqual(at('p256dh'), "'BPx-key", 'USER_ENTERED 로 쓰므로 키 앞에 따옴표 — 시트는 따옴표를 저장하지 않는다');
  assert.strictEqual(at('auth'), "'-starts-with-dash", '«-» 로 시작하는 키가 수식(#ERROR!)이 되지 않게');
  assert.ok(at('device').length <= 120, '기기 정보는 120자로 자른다');
  assert.strictEqual(at('active'), 'TRUE');
  assert.strictEqual(at('topics'), 'ship_approve', '서버는 이 토픽 행만 본다');
  assert.strictEqual(at('createdAt'), '2026-10-07 18:00');
  assert.strictEqual(at('updatedAt'), '2026-10-07 18:00');

  // 다시 켤 때의 고침 — 칸 번호가 머리글과 맞아야 한다(번호가 하나 밀리면 키가 기기 칸에 들어간다)
  const patch = P.patchFor(j, 'lead@example.com', 'UA', '2026-10-08 08:00');
  const name = i => P.HEADER[i];
  assert.deepStrictEqual(Object.keys(patch).map(Number).map(name).sort(),
    ['active', 'auth', 'device', 'email', 'p256dh', 'topics', 'updatedAt'].sort(), '고치는 칸 = 만든 날·subId·endpoint 를 뺀 전부');
  assert.strictEqual(patch[P.HEADER.indexOf('active')], 'TRUE');
  assert.strictEqual(patch[P.HEADER.indexOf('p256dh')], "'BPx-key");
  assert.strictEqual(patch[P.HEADER.indexOf('updatedAt')], '2026-10-08 08:00');

  // VAPID 공개키 변환 — base64url(패딩 없음) → 바이트
  const raw = Buffer.from(Array.from({ length: 65 }, (_, i) => (i * 37 + 4) & 255));
  const b64url = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.deepStrictEqual(Buffer.from(P.b64ToBytes(b64url)), raw, 'base64url → 원래 65바이트');
  assert.strictEqual(P.sameKey({ options: { applicationServerKey: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) } }, b64url), true);
  const other = Buffer.from(raw); other[10] ^= 1;
  assert.strictEqual(P.sameKey({ options: { applicationServerKey: other.buffer.slice(other.byteOffset, other.byteOffset + other.length) } }, b64url), false,
    '키가 바뀌었으면 다시 구독해야 한다(옛 키로는 서버가 못 보낸다)');
  assert.strictEqual(P.sameKey({ options: {} }, b64url), true, '키를 안 알려 주는 옛 브라우저는 그대로 쓴다');

  assert.strictEqual(P.GO_URL, '/app/factory/home?go=approve', '알림 주소 — 서버와 시험 발송이 같은 값을 쓴다');
}

// ?go= 딥링크 — 알림을 눌러 «새로» 열렸을 때
{
  const { P, ctx, went, replaced } = load({ href: 'https://maytutu-factory.vercel.app/app/factory/home?v=1&go=approve#x' });
  // 모듈이 읽히는 순간(captureGo) 이미 잡았다 — 한 번 더 불러도 같다(주소에서 이미 지웠다)
  P.captureGo();
  assert.strictEqual(P._go, 'approve');
  assert.deepStrictEqual(replaced, ['/app/factory/home?v=1#x'], 'go 만 지우고 나머지 주소는 그대로 — 새로고침해도 다시 안 끌려간다');
  assert.strictEqual(P.consumeGo(), true, '승인대기로 갔다');
  assert.deepStrictEqual(went, ['production']);
  assert.strictEqual(ctx.State._prodActiveTab, '승인대기', '생산 화면의 «승인대기» 탭으로');
  assert.strictEqual(P.consumeGo(), false, '한 번만 쓴다 — 다음 화면 이동을 가로채지 않는다');
}
{
  const { P, went, replaced } = load({ href: 'https://maytutu-factory.vercel.app/app/factory/home' });
  P.captureGo();
  assert.deepStrictEqual(replaced, [], 'go 가 없으면 주소를 건드리지 않는다');
  assert.strictEqual(P.consumeGo(), false, '갈 곳이 없으면 false — initApp 이 마지막 화면 복원으로 넘어간다');
  assert.deepStrictEqual(went, []);
}
{
  const { P, went } = load({ user: null });
  assert.strictEqual(P.go('approve'), false, '로그인 전엔 이동하지 않는다');
  assert.strictEqual(load().P.go('elsewhere'), false, '모르는 목적지는 무시');
  assert.deepStrictEqual(went, []);
}
// 앱이 열려 있을 때 — 서비스워커 메시지로 이동
{
  const { listeners, went, ctx } = load();
  assert.strictEqual(typeof listeners.message, 'function', '서비스워커 message 를 듣는다');
  listeners.message({ data: { type: 'sf-go', go: 'approve' } });
  assert.deepStrictEqual(went, ['production']);
  assert.strictEqual(ctx.State._prodActiveTab, '승인대기');
  listeners.message({ data: { type: 'other' } });
  listeners.message({});
  assert.deepStrictEqual(went, ['production'], '다른 메시지는 무시');
}

// ── ② 서비스워커 ─────────────────────────────────────────────────────────────
function loadSw({ clients = [] } = {}) {
  const on = {}, shown = [], opened = [], posted = [];
  const self = {
    addEventListener(ev, fn) { on[ev] = fn; },
    skipWaiting() {}, clients: {
      claim() {}, async matchAll() { return clients; }, async openWindow(u) { opened.push(u); },
    },
    registration: { scope: 'https://maytutu-factory.vercel.app/app/factory/', async showNotification(t, o) { shown.push({ t, o }); } },
  };
  clients.forEach(c => { c.focus = async () => { c.focused = true; }; c.postMessage = m => posted.push(m); });
  const ctx = { self, URL, Response: function () {}, fetch() {}, console };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx, { filename: 'sw.js' });
  const fire = async (ev, extra) => { let p; on[ev]({ waitUntil(x) { p = x; }, ...extra }); await p; };
  return { on, fire, shown, opened, posted };
}
(async () => {
  {
    const { on, fire, shown } = loadSw();
    for (const ev of ['install', 'activate', 'fetch', 'push', 'notificationclick']) assert.strictEqual(typeof on[ev], 'function', `sw.js 가 ${ev} 를 듣는다`);
    await fire('push', { data: { json: () => ({ title: '🧊 출하승인 대기 2건', body: '10/6 1·2번', url: '/app/factory/home?go=approve', tag: 'sf-ship-approve' }) } });
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].t, '🧊 출하승인 대기 2건');
    assert.strictEqual(shown[0].o.body, '10/6 1·2번');
    assert.strictEqual(shown[0].o.tag, 'sf-ship-approve');
    assert.strictEqual(shown[0].o.renotify, true, '같은 tag 로 새 내용이 오면 다시 울린다');
    assert.strictEqual(shown[0].o.data.url, '/app/factory/home?go=approve');
    // 본문이 JSON 이 아니어도 죽지 않고 글자로 띄운다
    await fire('push', { data: { json() { throw new Error('x'); }, text: () => '평문' } });
    assert.strictEqual(shown[1].t, '메이투투 공장');
    assert.strictEqual(shown[1].o.body, '평문');
    await fire('push', {});
    assert.strictEqual(shown.length, 3, '본문 없는 푸시도 알림은 띄운다(userVisibleOnly 약속)');
  }
  {
    // 열린 창이 없으면 — 승인 화면 주소로 새로 연다
    const { fire, opened } = loadSw();
    let closed = false;
    await fire('notificationclick', { notification: { close() { closed = true; }, data: { url: '/app/factory/home?go=approve' } } });
    assert.strictEqual(closed, true);
    assert.deepStrictEqual(opened, ['https://maytutu-factory.vercel.app/app/factory/home?go=approve']);
  }
  {
    // 공장 앱이 이미 열려 있으면 — 그 창을 올리고 «어디로» 만 알린다(새 창·재로그인 없음)
    const win = { url: 'https://maytutu-factory.vercel.app/app/factory/home#dashboard' };
    const { fire, opened, posted } = loadSw({ clients: [{ url: 'https://elsewhere.example/' }, win] });
    await fire('notificationclick', { notification: { close() {}, data: { url: '/app/factory/home?go=approve' } } });
    assert.strictEqual(win.focused, true);
    assert.deepStrictEqual(plain(posted), [{ type: 'sf-go', go: 'approve' }]);
    assert.deepStrictEqual(opened, [], '열린 창이 있으면 새로 열지 않는다');
  }

  // ── ③ 배선 ─────────────────────────────────────────────────────────────────
  // 🔒 public 저장소 — 직원 이메일이 코드에 한 글자도 없어야 한다(명단은 시트 칸이 정본)
  assert.deepStrictEqual(SRC.match(/[A-Za-z0-9._%+-]+@anghodu\.(?:biz|com)/g) || [], [], 'index.html 에 사내 이메일이 들어갔다 — 공개 저장소다');
  assert.deepStrictEqual(SW.match(/[A-Za-z0-9._%+-]+@anghodu\.(?:biz|com)/g) || [], [], 'sw.js 에 사내 이메일이 들어갔다');
  // 받는 사람 판정은 시트 한 칸 — 홈 권유·설정 줄이 둘 다 그 판정을 거친다
  assert.match(slice('  async fillHome() {', '  async fillSettings() {'), /await this\.amRecipient\(\)/, '홈 권유가 받는 사람 판정을 안 거친다');
  assert.match(slice('  async fillSettings() {', '// </ship-approve-push>'), /await this\.amRecipient\(\)/, '설정 줄이 받는 사람 판정을 안 거친다');
  assert.match(SRC, /if \(!ShipApprovePush\.consumeGo\(\) && !restoreLastScreen\(\)\) \{/,
    'initApp — 알림으로 열렸으면 마지막 화면 복원보다 먼저 승인대기로');
  assert.ok(SRC.indexOf('ShipApprovePush.captureGo();') > SRC.indexOf('const ShipApprovePush = {'), '모듈을 읽자마자 ?go 를 잡는다');
  assert.match(SRC, /\$\{isAdmin \? LiveSync\.lateSlot\('home-ship-push'\) : ''\}/, '홈 — 관리자 화면에 권유 칸');
  assert.match(SRC, /hsLoadHomeDocAlert\(\);[^\n]*\n\s*ShipApprovePush\.fillHome\(\);/, '홈을 다 그린 뒤 권유 칸을 채운다');
  assert.match(SRC, /<div id="set-ship-push"><\/div>/, '설정 › 알림 카드 안에 출하승인 줄 자리');
  assert.match(SRC, /ShipApprovePush\.fillSettings\(\);/, '설정을 그린 뒤 그 줄을 채운다');
  assert.match(SRC, /onclick="ShipApprovePush\.enable\(\)"/, '켜기 단추가 enable 에 꽂혀 있다');
  assert.match(SRC, /ShipApprovePush\.\$\{on \? 'disable' : 'enable'\}\(\)/, '설정에서 끄고 켤 수 있다');
  assert.match(SRC, /onclick="ShipApprovePush\.test\(\)"/, '켠 뒤 시험 알림을 그 자리에서 보낼 수 있다');
  // 켜기는 «누른 손길 안에서» 권한부터 — 앞에 await 가 끼면 크롬·사파리가 권한 창을 막는다
  const en = slice('  async enable() {', '  async disable() {');
  assert.ok(en.indexOf('await Notification.requestPermission()') < en.indexOf('await this._ready()')
    && en.indexOf('await Notification.requestPermission()') === en.indexOf('await '), '첫 await 가 권한 요청이어야 한다');
  // 즉시 반영 — 켜고/끈 뒤 화면을 다시 그린다(새로고침 없이 상태가 바뀌어 보여야 한다)
  assert.match(slice('  async enable() {', '  async disable() {'), /finally \{ hideLoading\(\); this\._after\(\); \}/);
  assert.match(slice('  async disable() {', '  async test() {'), /finally \{ hideLoading\(\); this\._after\(\); \}/);

  console.log('✅ ship-approve-push — 받는 사람·행 모양·키·딥링크·서비스워커·배선 통과');
})().catch(e => { console.error(e); process.exit(1); });
