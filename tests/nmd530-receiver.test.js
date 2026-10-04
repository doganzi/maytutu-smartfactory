/* NMD-530 시트 수신부(apps-script/nmd530_receiver.gs) 시뮬레이션 검증
   .gs 를 그대로 node:vm 에 올리고 Apps Script 전역(SpreadsheetApp 등)을 메모리 스텁으로 갈아 끼운다.

   실행:  node tests/nmd530-receiver.test.js      실패하면 assert 로 즉시 중단 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'nmd530_receiver.gs'), 'utf8');
let passed = 0;
const cases = [];
function test(name, fn) { cases.push([name, fn]); }

// ── 환경 만들기: 매번 새 시트·속성·락 ──
function makeEnv(props, opts) {
  opts = opts || {};
  const log = [];            // 작업 순서 기록
  const sheets = {};
  const stats = { openById: 0, lockRelease: 0, lockWait: 0, flush: 0, tzs: [] };
  function makeSheet(name) {
    const sh = {
      name, rows: [], frozen: 0, formats: {},
      getLastRow() { return this.rows.length; },
      setFrozenRows(n) { this.frozen = n; },
      getRange(r, c, nr, nc) {
        const self = this; nr = nr || 1; nc = nc || 1;
        return {
          setValues(v) {
            log.push(`setValues:${name}:${r}`);
            if (opts.failSetValues && name === '금속검출로그' && r > 1) throw new Error('boom 내부값 SECRET');
            for (let i = 0; i < v.length; i++) {
              const row = self.rows[r - 1 + i] || (self.rows[r - 1 + i] = []);
              for (let j = 0; j < v[i].length; j++) row[c - 1 + j] = v[i][j];
            }
          },
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = self.rows[r - 1 + i] || [];
              const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
              out.push(o);
            }
            return out;
          },
          setNumberFormat(f) { log.push(`fmt:${name}:${c}:${f}`); self.formats[c] = f; },
        };
      },
    };
    return sh;
  }
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
  };
  const ctx = {
    SpreadsheetApp: { openById: () => { stats.openById++; return ss; }, flush: () => { stats.flush++; log.push('flush'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    LockService: { getScriptLock: () => ({
      waitLock: () => { stats.lockWait++; log.push('waitLock'); if (opts.lockFail) throw new Error('lock timeout'); },
      releaseLock: () => { stats.lockRelease++; log.push('releaseLock'); },
    }) },
    Utilities: {
      // tz 를 실제로 반영: Asia/Seoul=+9h, UTC=0, 그 밖은 throw. 받은 tz 는 기록한다
      formatDate: (d, tz) => {
        stats.tzs.push(tz);
        const off = tz === 'Asia/Seoul' ? 9 : tz === 'UTC' ? 0 : null;
        if (off === null) throw new Error('모르는 tz ' + tz);
        return new Date(d.getTime() + off * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
      },
      getUuid: () => 'uuid',
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (s) => ({ s, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.s; } }),
    },
    Logger: { lines: [], log(m) { this.lines.push(m); } },
    Date: class extends Date {
      constructor(...a) { super(...(a.length ? a : ['2026-10-05T01:21:05Z'])); }   // 서버 시계 = KST 10:21:05
    },
    JSON, Array, Object, Math, String, Number, isNaN, isFinite, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'nmd530_receiver.gs' });
  const call = (body, raw) => {
    const out = ctx.doPost({ postData: { contents: raw !== undefined ? raw : JSON.stringify(body) } });
    assert.strictEqual(out.mime, 'JSON');
    return JSON.parse(out.getContent());
  };
  return { ctx, sheets, stats, log, call };
}

const PROPS = { NMD530_TOKEN: 'tok-abc', SHEET_ID: 'sid' };
const T0 = '2026-10-05T10:20:33+09:00';
function ev(id, extra) {
  return Object.assign({ id, t: T0, kind: 'DETECT', n: 2, total: 53, prev: 51, from: '2026-10-05T10:20:30+09:00',
    product: 1, ch1: 100, ch2: 0, flags: ['testMode'], downSec: null }, extra || {});
}
function batch(events, extra) {
  return Object.assign({ v: 1, token: 'tok-abc', device: 'NMD530-1', host: 'PC-1', collector: 'nmd530-bridge/1.0.0',
    sentAt: '2026-10-05T10:21:00+09:00', events,
    status: { link: 'UP', total: 53, product: 1, flags: [], lastValidAt: T0, downSince: null, spool: 0, bootAt: '2026-10-05T09:00:00+09:00' } }, extra || {});
}

test('토큰 불일치: auth 응답, 시트·락 접근 0회', () => {
  const E = makeEnv(PROPS);
  assert.deepStrictEqual(E.call(batch([ev('a')], { token: 'nope' })), { ok: false, error: 'auth' });
  assert.deepStrictEqual(E.call(batch([ev('a')], { token: undefined })), { ok: false, error: 'auth' });
  assert.strictEqual(E.stats.openById, 0);
  assert.strictEqual(E.stats.lockWait, 0);
  assert.deepStrictEqual(E.sheets, {});
  // 서버에 토큰이 없을 때도 열지 않는다
  const E2 = makeEnv({ SHEET_ID: 'sid' });
  assert.deepStrictEqual(E2.call(batch([ev('a')], { token: '' })), { ok: false, error: 'auth' });
  assert.strictEqual(E2.stats.openById, 0);
});

test('v 불일치·본문 파싱 불가·events 형식 오류: bad_request', () => {
  const E = makeEnv(PROPS);
  assert.deepStrictEqual(E.call(batch([], { v: 2 })), { ok: false, error: 'bad_request' });
  assert.deepStrictEqual(E.call(null, 'not json'), { ok: false, error: 'bad_request' });
  assert.deepStrictEqual(E.call(batch('x')), { ok: false, error: 'bad_request' });
  assert.strictEqual(E.stats.openById, 0);
});

test('정상 배치: 열 위치·한글 구분·KST 변환·서식 @ 가 setValues 보다 먼저', () => {
  const E = makeEnv(PROPS);
  const r = E.call(batch([
    ev('NMD530-1|B|0001'),
    ev('NMD530-1|B|0002', { kind: 'LINK_UP', n: null, prev: null, from: null, downSec: 45, flags: [] }),
    ev('NMD530-1|B|0003', { t: '2026-10-05T01:00:00Z', kind: 'RESET', n: null, flags: ['outError', 'balError', 'dualFreq'] }),
  ]));
  assert.deepStrictEqual(r, { ok: true, v: 1, saved: 3, dup: 0, bad: 0, badIdx: [] });
  const log = E.sheets['금속검출로그'];
  assert.strictEqual(log.rows.length, 4);             // 헤더 + 3
  assert.strictEqual(log.frozen, 1);
  assert.strictEqual(log.rows[0][0], '기록시각(KST)');
  const row = log.rows[1];
  assert.deepStrictEqual(row, ['2026-10-05 10:20:33', '검출', 2, 53, 51, '2026-10-05 10:20:30', 1, '테스트 모드', 100, 0, '',
    'NMD530-1', 'PC-1', '2026-10-05 10:21:05', 'NMD530-1|B|0001']);
  assert.strictEqual(log.rows[2][1], '통신복구');
  assert.strictEqual(log.rows[2][10], 45);
  assert.strictEqual(log.rows[2][5], '');
  assert.strictEqual(log.rows[3][0], '2026-10-05 10:00:00');   // Z → KST
  assert.strictEqual(log.rows[3][1], '리셋');
  assert.strictEqual(log.rows[3][7], 'Out error·Bal error·듀얼 주파수');
  // 서식 @ 는 A·F·L·M·N·O 열이고 데이터 setValues 보다 앞선다
  const dataWrite = E.log.indexOf('setValues:금속검출로그:2');
  assert.ok(dataWrite > 0);
  [1, 6, 12, 13, 14, 15].forEach((c) => {
    const i = E.log.indexOf(`fmt:금속검출로그:${c}:@`);
    assert.ok(i >= 0 && i < dataWrite, `열 ${c} 서식이 setValues 보다 먼저여야 함`);
  });
  assert.strictEqual(E.log.filter((x) => x.startsWith('setValues:금속검출로그:2')).length, 1);   // 한 번에 쓴다
});

test('같은 배치 두 번: 두 번째는 saved 0 / dup N, 행 수 불변', () => {
  const E = makeEnv(PROPS);
  const b = batch([ev('x1'), ev('x2'), ev('x3')]);
  assert.strictEqual(E.call(b).saved, 3);
  const r2 = E.call(b);
  assert.deepStrictEqual(r2, { ok: true, v: 1, saved: 0, dup: 3, bad: 0, badIdx: [] });
  assert.strictEqual(E.sheets['금속검출로그'].rows.length, 4);
  // 한 묶음 안의 같은 id 도 한 번만
  const r3 = E.call(batch([ev('y1'), ev('y1')]));
  assert.deepStrictEqual([r3.saved, r3.dup], [1, 1]);
});

test('일부 불량 이벤트: 불량만 bad, 나머지는 적재', () => {
  const E = makeEnv(PROPS);
  const r = E.call(batch([
    ev('ok1'),
    ev('b1', { kind: 'HACK' }),
    ev('b2', { t: 'yesterday' }),
    ev('x'.repeat(81)),
    ev('b4', { from: 'zzz' }),
    ev('b5', { n: 0 }),          // DETECT 증가분은 ≥1
    null,
    ev('ok2'),
  ]));
  assert.deepStrictEqual(r, { ok: true, v: 1, saved: 2, dup: 0, bad: 6, badIdx: [1, 2, 3, 4, 5, 6] });
  assert.strictEqual(E.sheets['금속검출로그'].rows.length, 3);
});

test('201건 거부, 200건은 허용', () => {
  const E = makeEnv(PROPS);
  const many = (n) => Array.from({ length: n }, (_, i) => ev('m' + i));
  assert.deepStrictEqual(E.call(batch(many(201))), { ok: false, error: 'bad_request' });
  assert.strictEqual(E.stats.openById, 0);
  assert.strictEqual(E.call(batch(many(200))).saved, 200);
});

test('상태 행: 처음 insert, 같은 기기는 같은 행 덮어쓰기, 다른 기기는 append', () => {
  const E = makeEnv(PROPS);
  E.call(batch([]));
  const st = E.sheets['금속검출상태'];
  assert.strictEqual(st.rows.length, 2);
  assert.strictEqual(st.frozen, 1);
  assert.deepStrictEqual(st.rows[1], ['NMD530-1', '2026-10-05 10:21:05', '2026-10-05T10:21:00+09:00', 'UP', 53, T0, 1, '', 0,
    'PC-1', 'nmd530-bridge/1.0.0', '', '2026-10-05T09:00:00+09:00']);
  const b2 = batch([]); b2.status = Object.assign({}, b2.status, { link: 'DOWN', total: 60, flags: ['balError'], downSince: T0, spool: 4 });
  E.call(b2);
  assert.strictEqual(st.rows.length, 2);
  assert.strictEqual(st.rows[1][3], 'DOWN');
  assert.strictEqual(st.rows[1][4], 60);
  assert.strictEqual(st.rows[1][7], 'Bal error');
  assert.strictEqual(st.rows[1][8], 4);
  assert.strictEqual(st.rows[1][11], T0);
  E.call(batch([], { device: 'NMD530-2' }));
  assert.strictEqual(st.rows.length, 3);
  assert.strictEqual(st.rows[2][0], 'NMD530-2');
  // status 가 null 이면 상태 시트는 그대로
  E.call(batch([], { status: null }));
  assert.strictEqual(st.rows.length, 3);
});

test('시트·헤더 자동 생성: 이미 헤더가 있으면 다시 쓰지 않는다', () => {
  const E = makeEnv(PROPS);
  assert.deepStrictEqual(E.sheets, {});
  E.call(batch([ev('h1')]));
  assert.deepStrictEqual(Object.keys(E.sheets).sort(), ['금속검출로그', '금속검출상태']);
  assert.strictEqual(E.sheets['금속검출상태'].rows[0][0], '기기');
  assert.strictEqual(E.sheets['금속검출상태'].rows[0].length, 13);
  assert.strictEqual(E.sheets['금속검출로그'].rows[0].length, 15);
  E.call(batch([ev('h2')]));
  assert.strictEqual(E.log.filter((x) => x === 'setValues:금속검출로그:1').length, 1);
});

test('숫자 칸에 문자열: 그 이벤트는 bad(빈칸으로 저장하지 않음)', () => {
  const E = makeEnv(PROPS);
  const r = E.call(batch([ev('n1', { total: '53' }), ev('n2', { ch1: 'abc' }), ev('n3', { n: '2' }), ev('n4', { total: null, ch2: null })]));
  assert.deepStrictEqual(r, { ok: true, v: 1, saved: 1, dup: 0, bad: 3, badIdx: [0, 1, 2] });
  assert.strictEqual(E.sheets['금속검출로그'].rows[1][3], '');   // null 은 빈칸
});

test('수식처럼 보이는 문자열은 값 그대로, 서식 @ 열에만 들어간다', () => {
  const E = makeEnv(PROPS);
  E.call(batch([ev('=1+1')], { host: '=HYPERLINK("x")', device: '+cmd' }));
  const row = E.sheets['금속검출로그'].rows[1];
  assert.strictEqual(row[14], '=1+1');
  assert.strictEqual(row[12], '=HYPERLINK("x")');
  assert.strictEqual(row[11], '+cmd');
  // 문자열 값이 들어가는 열은 모두 @ 서식
  [12, 13, 15].forEach((c) => assert.strictEqual(E.sheets['금속검출로그'].formats[c], '@'));
  // 상태 시트의 기기·수집PC 열도 @
  assert.strictEqual(E.sheets['금속검출상태'].formats[1], '@');
  assert.strictEqual(E.sheets['금속검출상태'].formats[10], '@');
});

test('락: 정상·예외·락 실패 모두에서 해제 호출 규칙 지킴, 오류 응답에 내부 값 없음', () => {
  const E = makeEnv(PROPS);
  E.call(batch([ev('l1')]));
  assert.deepStrictEqual([E.stats.lockWait, E.stats.lockRelease], [1, 1]);
  assert.ok(E.log.indexOf('waitLock') < E.log.indexOf('setValues:금속검출로그:1'));

  // 쓰기 중 예외 → server, 락은 해제, 응답에 스택·메시지 없음, 로그에 토큰 없음
  const F = makeEnv(PROPS, { failSetValues: true });
  const raw = F.ctx.doPost({ postData: { contents: JSON.stringify(batch([ev('f1')])) } }).getContent();
  assert.deepStrictEqual(JSON.parse(raw), { ok: false, error: 'server' });
  assert.ok(!/boom|SECRET|at /.test(raw));
  assert.deepStrictEqual([F.stats.lockWait, F.stats.lockRelease], [1, 1]);
  assert.ok(F.ctx.Logger.lines.length === 1 && !/tok-abc/.test(F.ctx.Logger.lines[0]));

  // 락을 못 잡으면 server, 잡지 못한 락은 해제하지 않는다
  const G = makeEnv(PROPS, { lockFail: true });
  assert.deepStrictEqual(G.call(batch([ev('g1')])), { ok: false, error: 'server' });
  assert.strictEqual(G.stats.lockRelease, 0);
  assert.strictEqual(G.stats.openById, 0);
});

test('NMD530_DEVICES: 목록에 없는 기기는 bad_request, 있으면 통과', () => {
  const E = makeEnv(Object.assign({ NMD530_DEVICES: 'NMD530-1, NMD530-2' }, PROPS));
  assert.deepStrictEqual(E.call(batch([ev('d1')], { device: 'EVIL' })), { ok: false, error: 'bad_request' });
  assert.strictEqual(E.stats.openById, 0);
  assert.strictEqual(E.call(batch([ev('d1')], { device: 'NMD530-2' })).saved, 1);
});

test('중복 검사는 끝 NMD530_DEDUP_ROWS(5000)행만 본다', () => {
  const E = makeEnv(PROPS);
  const N = E.ctx.NMD530_DEDUP_ROWS;
  assert.strictEqual(N, 5000);
  E.call(batch([ev('old')]));
  const log = E.sheets['금속검출로그'];
  for (let i = 0; i < N; i++) { const r = new Array(15).fill(''); r[14] = 'fill' + i; log.rows.push(r); }
  assert.strictEqual(E.call(batch([ev('fill0')])).dup, 1);         // 창 안쪽 끝 — 창이 실제로 N행을 덮는다
  assert.strictEqual(E.call(batch([ev('fill' + (N - 1))])).dup, 1);
  assert.strictEqual(E.call(batch([ev('old')])).saved, 1);     // 창 밖이라 새것으로 본다(계약대로)
});

test('F1 badIdx: 이번 요청 events 의 0기반 위치·bad 와 같은 개수, 로그엔 위치·사유코드만(내용 없음)', () => {
  const E = makeEnv(PROPS);
  const r = E.call(batch([ev('ok1'), ev('SECRETID', { kind: 'HACK' }), ev('ok2'), ev('b', { t: '2026-02-30T10:00:00+09:00' }), ev('c', { n: 0 })]));
  assert.deepStrictEqual([r.saved, r.bad, r.badIdx], [2, 3, [1, 3, 4]]);
  assert.strictEqual(r.bad, r.badIdx.length);
  assert.strictEqual(E.ctx.Logger.lines.length, 1);
  assert.strictEqual(E.ctx.Logger.lines[0], 'nmd530 bad idx=1:kind,3:time,4:detect_n');
  assert.ok(!/SECRETID|tok-abc|2026-02-30|HACK/.test(E.ctx.Logger.lines[0]));
  // 불량이 없으면 로그도 없다
  const E2 = makeEnv(PROPS);
  assert.deepStrictEqual(E2.call(batch([ev('z')])).badIdx, []);
  assert.strictEqual(E2.ctx.Logger.lines.length, 0);
  // 중복은 bad 가 아니다
  const E3 = makeEnv(PROPS);
  E3.call(batch([ev('q')]));
  assert.deepStrictEqual(E3.call(batch([ev('q')])).badIdx, []);
});

test('F3 id 가 constructor·__proto__·toString·hasOwnProperty 여도 정상 적재, 재전송은 dup', () => {
  const E = makeEnv(PROPS);
  const ids = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
  const r = E.call(batch(ids.map((i) => ev(i))));
  assert.deepStrictEqual([r.saved, r.dup, r.bad], [5, 0, 0]);
  assert.deepStrictEqual(E.sheets['금속검출로그'].rows.slice(1).map((x) => x[14]), ids);
  const r2 = E.call(batch(ids.map((i) => ev(i))));
  assert.deepStrictEqual([r2.saved, r2.dup], [0, 5]);
});

test('F4 존재하지 않는 날짜·시각은 bad 이고 시트에 안 쓰인다 / 실제 있는 날짜(윤일·Z)는 통과', () => {
  const E = makeEnv(PROPS);
  const badTs = ['2026-02-30T10:00:00+09:00', '2026-02-31T10:00:00+09:00', '2026-04-31T10:00:00+09:00', '2026-10-05T24:00:00+09:00',
    '2026-13-01T10:00:00+09:00', '2026-10-05T10:60:00+09:00', '2026-10-05T10:00:60+09:00', '2025-02-29T10:00:00+09:00', '2026-00-10T10:00:00+09:00'];
  const r = E.call(batch(badTs.map((t, i) => ev('r' + i, { t }))));
  assert.deepStrictEqual([r.saved, r.bad], [0, badTs.length]);
  assert.strictEqual(E.sheets['금속검출로그'].rows.length, 1);      // 헤더만
  const r2 = E.call(batch([ev('g1', { t: '2028-02-29T23:59:59+09:00' }), ev('g2', { t: '2026-10-05T01:00:00.123Z' }),
    ev('g3', { t: '2026-10-05T10:00:00+09:00', from: '2026-02-30T10:00:00+09:00' })]));
  assert.deepStrictEqual([r2.saved, r2.bad, r2.badIdx], [2, 1, [2]]);   // from 도 같은 검사
  assert.strictEqual(E.sheets['금속검출로그'].rows[1][0], '2028-02-29 23:59:59');
});

test('F5 숫자 칸은 0 이상의 정수만: 소수·음수·문자열 숫자(JSON 은 NaN 을 못 나른다) bad, 0 은 허용(DETECT n 은 ≥1)', () => {
  const E = makeEnv(PROPS);
  const cases = [
    ev('a1', { n: 1.5 }), ev('a2', { n: -1 }), ev('a3', { total: -1 }), ev('a4', { total: 1.5 }), ev('a5', { prev: -5 }),
    ev('a6', { product: 1.2 }), ev('a7', { ch1: -1 }), ev('a8', { ch2: 0.5 }), ev('a9', { downSec: -3 }),
    ev('a10', { kind: 'RESET', n: null, total: -1 }), ev('a11', { kind: 'LINK_UP', n: -5, prev: null }),
    ev('a12', { total: 'NaN' }), ev('a13', { n: 'x' }), ev('a14', { n: 0 }), ev('a15', { kind: 'GAP', n: 0.5 }),
  ];
  const r = E.call(batch(cases));
  assert.deepStrictEqual([r.saved, r.bad], [0, cases.length]);
  const r2 = E.call(batch([ev('p1', { total: 0, prev: 0, product: 0, ch1: 0, ch2: 0, downSec: 0 }), ev('p2', { kind: 'RESET', n: null })]));
  assert.deepStrictEqual([r2.saved, r2.bad], [2, 0]);
});

test('F6 상태 시트: 문자열 열(A·B·C·D·F·J·K·L·M)은 @ 서식, 숫자 열 E·G·I 는 서식 없음', () => {
  const E = makeEnv(PROPS);
  E.call(batch([], { status: Object.assign({}, batch([]).status, { link: '=UP' }) }));
  const st = E.sheets['금속검출상태'];
  [1, 2, 3, 4, 6, 10, 11, 12, 13].forEach((c) => assert.strictEqual(st.formats[c], '@', '열 ' + c));
  [5, 7, 9].forEach((c) => assert.strictEqual(st.formats[c], undefined, '숫자 열 ' + c));
  assert.strictEqual(st.rows[1][3], '=UP');
  assert.strictEqual(typeof st.rows[1][4], 'number');
});

test('F7 상태 upsert: 락 순서가 뒤바뀐 옛 요청은 덮어쓰지 않고, 같거나 새 요청·해석 불가는 덮어쓴다', () => {
  const E = makeEnv(PROPS);
  const mk = (sentAt, link, total) => batch([], { sentAt, status: Object.assign({}, batch([]).status, { link, total }) });
  E.call(mk('2026-10-05T10:21:00+09:00', 'UP', 60));
  const st = E.sheets['금속검출상태'];
  E.call(mk('2026-10-05T10:20:00+09:00', 'DOWN', 50));          // 늦게 도착한 옛 요청
  assert.deepStrictEqual([st.rows[1][2], st.rows[1][3], st.rows[1][4]], ['2026-10-05T10:21:00+09:00', 'UP', 60]);
  E.call(mk('2026-10-05T10:21:00+09:00', 'DOWN', 61));          // 같은 시각 → 덮어쓴다
  assert.deepStrictEqual([st.rows[1][3], st.rows[1][4]], ['DOWN', 61]);
  E.call(mk('2026-10-05T10:22:00+09:00', 'UP', 70));            // 새 요청
  assert.deepStrictEqual([st.rows[1][3], st.rows[1][4]], ['UP', 70]);
  E.call(mk('garbage', 'DOWN', 71));                            // 새 값이 해석 불가 → 덮어쓴다
  assert.deepStrictEqual([st.rows[1][3], st.rows[1][4]], ['DOWN', 71]);
  E.call(mk('2026-10-05T10:00:00+09:00', 'UP', 72));            // 기존 C 가 해석 불가 → 덮어쓴다
  assert.deepStrictEqual([st.rows[1][3], st.rows[1][4]], ['UP', 72]);
  assert.strictEqual(st.rows.length, 2);
});

test('F7b 상태 upsert: 기존 C 가 10분 넘게 미래면(시계가 앞섰다 바로잡힘) 얼어붙지 않고 덮어쓴다 — 10분 이내 역전만 옛 요청으로 거른다', () => {
  const E = makeEnv(PROPS);
  const mk = (sentAt, link, total) => batch([], { sentAt, status: Object.assign({}, batch([]).status, { link, total }) });
  E.call(mk('2026-10-05T12:00:00+09:00', 'UP', 60));              // 수집 PC 시계가 1시간 앞선 상태로 기록됨
  const st = E.sheets['금속검출상태'];
  E.call(mk('2026-10-05T10:59:00+09:00', 'DOWN', 61));            // 시계를 바로잡음 → 61분 과거 → 덮어쓴다
  assert.deepStrictEqual([st.rows[1][2], st.rows[1][3], st.rows[1][4]], ['2026-10-05T10:59:00+09:00', 'DOWN', 61]);
  E.call(mk('2026-10-05T10:49:00+09:00', 'UP', 50));              // 정확히 10분 과거 → 옛 요청으로 거른다(경계 포함)
  assert.deepStrictEqual([st.rows[1][3], st.rows[1][4]], ['DOWN', 61]);
  E.call(mk('2026-10-05T10:48:59+09:00', 'UP', 51));              // 10분 1초 과거 → 덮어쓴다
  assert.deepStrictEqual([st.rows[1][3], st.rows[1][4]], ['UP', 51]);
});

test('F8 doPost: 락을 놓기 전에 SpreadsheetApp.flush() 로 쓴 값을 확정한다(락 순서 waitLock → flush → releaseLock)', () => {
  const E = makeEnv(PROPS);
  E.call(batch([ev('fl1')]));
  assert.deepStrictEqual(E.log.filter((x) => x === 'waitLock' || x === 'flush' || x === 'releaseLock'), ['waitLock', 'flush', 'releaseLock']);
  const F = makeEnv(PROPS, { lockFail: true });
  F.call(batch([ev('fl2')]));
  assert.strictEqual(F.stats.flush, 0);                           // 락을 못 얻었으면 flush 도 하지 않는다
});

test('R10 시계 tz: 모든 formatDate 호출이 Asia/Seoul 이고 mock 이 tz 를 실제로 반영한다', () => {
  const E = makeEnv(PROPS);
  E.call(batch([ev('tz1')]));
  assert.ok(E.stats.tzs.length >= 3);
  assert.ok(E.stats.tzs.every((z) => z === 'Asia/Seoul'), JSON.stringify(E.stats.tzs));
  const d = new Date('2026-10-05T01:21:05Z');
  assert.strictEqual(E.ctx.Utilities.formatDate(d, 'Asia/Seoul', 'x'), '2026-10-05 10:21:05');
  assert.strictEqual(E.ctx.Utilities.formatDate(d, 'UTC', 'x'), '2026-10-05 01:21:05');
  assert.throws(() => E.ctx.Utilities.formatDate(d, 'America/New_York', 'x'));
});

test('R11 kind 6종 전부 B열 한글 매핑', () => {
  const E = makeEnv(PROPS);
  const kinds = { DETECT: '검출', GAP: '미관측구간', RESET: '리셋', LINK_DOWN: '통신끊김', LINK_UP: '통신복구', COLLECTOR_START: '수집기시작' };
  const evs = Object.keys(kinds).map((k) => ev('k-' + k, { kind: k }));
  assert.strictEqual(E.call(batch(evs)).saved, 6);
  const got = E.sheets['금속검출로그'].rows.slice(1).map((r) => [r[14], r[1]]);
  Object.keys(kinds).forEach((k, i) => assert.deepStrictEqual(got[i], ['k-' + k, kinds[k]]));
});

test('F2 nmd530_selfTest: 같은 본문 2회 → 1차 saved 2, 2차 saved 0 / dup 2, SELFTEST| 행 2건, 상태 시트 안 건드림', () => {
  const E = makeEnv(PROPS);
  const [r1, r2] = E.ctx.nmd530_selfTest().map((x) => JSON.parse(x));
  assert.deepStrictEqual([r1.saved, r1.dup, r1.bad], [2, 0, 0]);
  assert.deepStrictEqual([r2.saved, r2.dup, r2.bad], [0, 2, 0]);
  const rows = E.sheets['금속검출로그'].rows;
  assert.strictEqual(rows.length, 3);
  assert.ok(rows.slice(1).every((r) => r[14].startsWith('SELFTEST|') && r[1] === '수집기시작'));
  assert.strictEqual(E.sheets['금속검출상태'].rows.length, 1);     // 헤더만
  assert.strictEqual(E.ctx.Logger.lines.length, 2);
  assert.ok(!/tok-abc/.test(E.ctx.Logger.lines.join(' ')));
  // 허용 기기 목록이 있으면 그 첫 기기로 보낸다
  const E2 = makeEnv(Object.assign({ NMD530_DEVICES: 'NMD530-2, NMD530-3' }, PROPS));
  assert.strictEqual(JSON.parse(E2.ctx.nmd530_selfTest()[0]).saved, 2);
  assert.strictEqual(E2.sheets['금속검출로그'].rows[1][11], 'NMD530-2');
});

test('doGet: 건강 확인 응답', () => {
  const E = makeEnv(PROPS);
  const out = E.ctx.doGet({});
  assert.strictEqual(out.mime, 'JSON');
  assert.deepStrictEqual(JSON.parse(out.getContent()), { service: 'nmd530_receiver', ok: true });
  assert.strictEqual(E.stats.openById, 0);
});

test('소스 위생: 토큰·주소·시트 ID 하드코딩 없음', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/script\.google\.com\/macros|AKfycb|docs\.google\.com\/spreadsheets/.test(code));
  assert.ok(!/0x60|0x3A/i.test(code));
});

for (const [name, fn] of cases) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n' + (e.stack || e)); process.exit(1); }
}
console.log(`통과 ${passed}종`);
