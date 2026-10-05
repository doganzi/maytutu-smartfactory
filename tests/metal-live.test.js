/* 금속검출 실시간현황 검증 — index.html 에 실려 있는 코드를 그대로 떼어 vm 으로 돌린다.
   실행:  node tests/metal-live.test.js
   범위: 순수 함수 + 시트 읽기 실패 구분 + 화면 렌더(가짜 DOM, XSS 이스케이프·30초 틱) + «읽기 전용»·«낡은 것 삭제» 검증 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.State = {}; global.Screens = {};
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function slice(a, b) {
  const i = SRC.indexOf(a); assert.notStrictEqual(i, -1, '시작 마커 없음: ' + a);
  const j = SRC.indexOf(b, i); assert.notStrictEqual(j, -1, '종료 마커 없음: ' + b);
  return SRC.slice(i, j);
}
const START = '/* ── 금속검출 실시간현황 (NMD-530) ──', END = '/* ── 끝: 금속검출 실시간현황 ── */';
const metalSrc = slice(START, END) + END;
// parseLogTs·tempPeriodStart 는 동결온도 화면 것을 재사용하므로 같은 곳에서 떼어 온다. escReason 도 화면이 쓰는 그대로.
const escLine = slice('const escReason', '\n');
const code = escLine + '\n' + slice('function tempPeriodStart', 'const tempLogName') + '\n' + metalSrc +
  '\n;({ METAL_STALE_MS, METAL_SKEW_MS, METAL_TICK_MS, metalParseLog, metalParseStatus, metalConnState, metalSummarize, metalCountSkipped, metalLoad,' +
  ' metalCcpLineHtml, metalFillCcpLine, metalLabel, metalBadge, metalStopTick, parseLogTs, tempPeriodStart,' +
  ' metalNum, metalAgo, metalConnCardHtml, metalGapCardHtml, metalUnreadNote, METAL_UNKNOWN })';
const M = vm.runInThisContext(code, { filename: 'index.html#metal-live' });

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const okA = async (name, fn) => { await fn(); pass++; console.log('  ✓ ' + name); };
const T = s => M.parseLogTs(s);
const NOW = T('2026-10-05 12:00:00');
const MIN = 60000;

console.log('\n[1] metalConnState — 5상태와 경계');
const stRow = (recv, link, extra) => M.metalParseStatus([['NMD530-1', recv, '', link, '5', '', '1', '', '0', 'PC', 'v', (extra && extra.down) || '', '']], 'NMD530-1');
ok('상태 행 없음 → 가동 전(idle)', () => assert.strictEqual(M.metalConnState(null, NOW).key, 'idle'));
ok('정확히 3분 + UP → 정상', () => assert.strictEqual(M.metalConnState(stRow('2026-10-05 11:57:00', 'UP'), NOW).key, 'ok'));
ok('3분 + 1ms → 무응답', () => assert.strictEqual(M.metalConnState(stRow('2026-10-05 11:57:00', 'UP'), NOW + 1).key, 'stale'));
ok('3분 이내 + DOWN → 통신 끊김(주황)', () => assert.strictEqual(M.metalConnState(stRow('2026-10-05 11:59:30', 'DOWN'), NOW).key, 'linkdown'));
ok('3분 초과 + DOWN → 무응답이 우선', () => assert.strictEqual(M.metalConnState(stRow('2026-10-05 11:50:00', 'DOWN'), NOW).key, 'stale'));
ok('수신시각 불명 → 정상으로 위장하지 않고 무응답', () => assert.strictEqual(M.metalConnState(stRow('', 'UP'), NOW).key, 'stale'));
ok('임계 상수 3분 · 시계 허용 2분', () => { assert.strictEqual(M.METAL_STALE_MS, 180000); assert.strictEqual(M.METAL_SKEW_MS, 120000); });
ok('수신시각이 미래로 2분 «이내» → 정상(경계 포함)', () => assert.strictEqual(M.metalConnState(stRow('2026-10-05 12:02:00', 'UP'), NOW).key, 'ok'));
ok('수신시각이 미래로 2분 초과 → 시계 불일치(음수 경과를 정상으로 위장하지 않음)', () => {
  const c = M.metalConnState(stRow('2026-10-05 12:02:01', 'UP'), NOW);
  assert.strictEqual(c.key, 'clock'); assert.strictEqual(c.badge, 'warn');
});

console.log('\n[2] 시트 행 파싱 — 열 위치(계약 §6)');
const logRow = ['2026-10-05 10:20:33', '검출', '2', '53', '51', '2026-10-05 10:20:30', '1', '테스트 모드', '100', '', '', 'NMD530-1', 'PC', '2026-10-05 10:20:40', 'NMD530-1|b|0007'];
ok('로그 A~O 위치', () => {
  const e = M.metalParseLog([logRow])[0];
  assert.deepStrictEqual([e.kind, e.n, e.total, e.prev, e.product, e.flags, e.ch1, e.ch2, e.downSec, e.device, e.id],
    ['DETECT', 2, 53, 51, 1, '테스트 모드', 100, null, null, 'NMD530-1', 'NMD530-1|b|0007']);
  assert.strictEqual(e.t, T('2026-10-05 10:20:33')); assert.strictEqual(e.from, T('2026-10-05 10:20:30'));
});
ok('빈칸은 null(0 아님) · 숫자 문자열은 숫자 · 통신복구 끊김(초) K열', () => {
  const e = M.metalParseLog([['2026-10-05 10:30:00', '통신복구', '', '', '', '', '', '', '', '', '45', 'D', 'P', '', 'id2']])[0];
  assert.strictEqual(e.n, null); assert.strictEqual(e.downSec, 45); assert.strictEqual(e.kind, 'LINK_UP');
});
ok('건수 칸은 0 이상의 정수만 — 공백·음수·소수·무한·글자는 null (0 으로 위장하지 않는다)', () => {
  for (const bad of ['', ' ', '   ', '-1', '2.5', 'Infinity', '1e3', '0x10', 'abc', '3건', null, undefined, NaN, -1, 2.5, Infinity, {}, []]) {
    assert.strictEqual(M.metalNum(bad), null, JSON.stringify(bad) + ' → null');
  }
  for (const [v, want] of [['0', 0], ['7', 7], [' 12 ', 12], ['007', 7], [0, 0], [9, 9]]) assert.strictEqual(M.metalNum(v), want, String(v));
  const e = M.metalParseLog([['2026-10-05 10:00:00', '검출', ' ', '-1', '2.5', '', 'Infinity', '', 'abc', '', '  ']])[0];
  assert.deepStrictEqual([e.n, e.total, e.prev, e.product, e.ch1, e.downSec], [null, null, null, null, null, null]);
});
ok('metalAgo — 시각이 없으면 «20730일 전» 이 아니라 시각 미상 · 연결 카드도 «읽지 못함»', () => {
  assert.strictEqual(M.metalAgo(0, NOW), '시각 미상'); assert.strictEqual(M.metalAgo(NOW - 5 * MIN, NOW), '5분 전');
  const st = stRow('', 'UP');
  const html = M.metalConnCardHtml(st, M.metalConnState(st, NOW), NOW);
  assert.ok(html.includes('마지막 확인 시각을 읽지 못함')); assert.ok(!/일 전/.test(html));
});
ok('헤더 행·빈 행은 버린다', () => assert.strictEqual(M.metalParseLog([['기록시각(KST)', '구분'], [], null, ['', '검출']]).length, 0));
ok('상태 행 A~M 위치 · 기기 선택', () => {
  const rows = [['A', '2026-10-05 11:00:00'], ['NMD530-1', '2026-10-05 11:59:00', '2026-10-05 11:58:59', 'down', '77', '2026-10-05 11:58:00', '1', 'Bal error', '3', 'PC', 'v1', '2026-10-05 11:58:30', '2026-10-05 08:00:00']];
  const s = M.metalParseStatus(rows, 'NMD530-1');
  assert.deepStrictEqual([s.link, s.total, s.product, s.flags, s.spool, s.host, s.version], ['DOWN', 77, 1, 'Bal error', 3, 'PC', 'v1']);
  assert.strictEqual(s.downSince, T('2026-10-05 11:58:30')); assert.strictEqual(s.boot, T('2026-10-05 08:00:00'));
  assert.strictEqual(M.metalParseStatus(rows, 'ZZ'), null); assert.strictEqual(M.metalParseStatus([], ''), null);
});
ok('구분 한글 → 코드 6종 · 라벨/배지', () => {
  const ko = { '검출': 'DETECT', '미관측구간': 'GAP', '리셋': 'RESET', '통신끊김': 'LINK_DOWN', '통신복구': 'LINK_UP', '수집기시작': 'COLLECTOR_START' };
  const bd = { DETECT: 'err', GAP: 'warn', RESET: 'warn', LINK_DOWN: 'err', LINK_UP: 'suc', COLLECTOR_START: 'gray' };
  Object.keys(ko).forEach(k => {
    const e = M.metalParseLog([['2026-10-05 10:00:00', k]])[0];
    assert.strictEqual(e.kind, ko[k]); assert.strictEqual(M.metalLabel(e.kind), k); assert.strictEqual(M.metalBadge(e.kind), bd[ko[k]]);
  });
});
ok('시각을 못 읽어 버려지는 «내용 있는» 행만 센다 (빈 행·null 은 세지 않음)', () => {
  assert.strictEqual(M.metalCountSkipped([['', ''], [], null, ['잘못된 시각', '검출'], ['', '검출', '2'], ['2026-10-05 10:00:00', '검출', '1']]), 2);
  assert.strictEqual(M.metalCountSkipped(null), 0); assert.strictEqual(M.metalCountSkipped([]), 0);
});

console.log('\n[3] metalSummarize');
const ev = (t, kind, o) => Object.assign({ t: T(t), kind, n: null, downSec: null, from: 0 }, o || {});
const S0 = T('2026-10-05 00:00:00');
const events = [
  ev('2026-10-04 23:59:59', 'DETECT', { n: 9 }),                                   // 기간 밖
  ev('2026-10-05 08:00:00', 'COLLECTOR_START', { from: T('2026-10-05 07:50:00') }), // 공백 600초
  ev('2026-10-05 09:00:00', 'DETECT', { n: 2 }),
  ev('2026-10-05 09:30:00', 'GAP', { n: 3 }),
  ev('2026-10-05 10:00:00', 'DETECT', { n: 1 }),
  ev('2026-10-05 10:10:00', 'LINK_UP', { downSec: 120 }),
  ev('2026-10-05 10:20:00', 'LINK_UP', { downSec: 60 }),
  ev('2026-10-05 11:00:00', 'RESET'), ev('2026-10-05 11:30:00', 'RESET'),
  ev('2026-10-05 11:40:00', 'LINK_DOWN'),
];
ok('DETECT·GAP 따로 합산 · 마지막 검출 · 리셋 횟수', () => {
  const s = M.metalSummarize(events, S0, 0, NOW);
  assert.strictEqual(s.detectTimed, 3); assert.strictEqual(s.detectGap, 3); assert.strictEqual(s.resets, 2);
  assert.strictEqual(s.lastDetectAt, T('2026-10-05 10:00:00'));
});
ok('통신끊김 downSec 합 + COLLECTOR_START 공백 합 → 분', () => {
  const s = M.metalSummarize(events, S0, 0, NOW);
  assert.strictEqual(s.downSec, 180); assert.strictEqual(s.collectorGapSec, 600); assert.strictEqual(s.gapSec, 780); assert.strictEqual(s.gapMinutes, 13);
});
ok('기간 경계: 시작 시각 정확히 포함 · 전체(0)는 전부', () => {
  const e2 = [ev('2026-10-05 00:00:00', 'DETECT', { n: 4 })];
  assert.strictEqual(M.metalSummarize(e2, S0, 0, NOW).detectTimed, 4);
  assert.strictEqual(M.metalSummarize(e2, S0 + 1, 0, NOW).detectTimed, 0);
  assert.strictEqual(M.metalSummarize(events, 0, 0, NOW).detectTimed, 12);
});
ok('endMs 이후 제외', () => assert.strictEqual(M.metalSummarize(events, S0, T('2026-10-05 09:00:00'), NOW).detectGap, 0));
ok('짧은 공백(20초)도 0분으로 감추지 않는다', () => {
  const s = M.metalSummarize([ev('2026-10-05 09:00:00', 'LINK_UP', { downSec: 20 })], 0, 0, NOW);
  assert.strictEqual(s.gapMinutes, 1);
});
ok('분 환산은 합계 초에서 «한 번만» — 20초 + 20초 = 40초 → 1분 (각각 올림해 2분이 되지 않음)', () => {
  const s = M.metalSummarize([ev('2026-10-05 09:00:00', 'LINK_UP', { downSec: 20 }), ev('2026-10-05 09:10:00', 'LINK_UP', { downSec: 20 })], 0, 0, NOW);
  assert.strictEqual(s.gapSec, 40); assert.strictEqual(s.gapMinutes, 1);
});
ok('빈 입력 → 전부 0', () => {
  const s = M.metalSummarize([], 0, 0, NOW);
  assert.deepStrictEqual(s, { detectTimed: 0, detectGap: 0, lastDetectAt: 0, resets: 0, unreadable: 0, unreadGap: 0, downSec: 0, collectorGapSec: 0, ongoingSec: 0, gapSec: 0, gapMinutes: 0 });
  assert.strictEqual(M.metalSummarize(null, 0, 0, NOW).detectTimed, 0);
});
ok('공백 겹침 — 수집기 정지 10분 안의 통신복구 2분은 두 번 세지 않는다', () => {
  const s = M.metalSummarize([
    ev('2026-10-05 10:10:00', 'COLLECTOR_START', { from: T('2026-10-05 10:00:00') }),
    ev('2026-10-05 10:05:00', 'LINK_UP', { downSec: 120 }),
  ], 0, 0, NOW);
  assert.strictEqual(s.gapSec, 600); assert.strictEqual(s.downSec, 120); assert.strictEqual(s.collectorGapSec, 600); assert.strictEqual(s.gapMinutes, 10);
});
ok('공백 겹침 — 일부만 겹치면 합집합 (10:00~10:10 ∪ 10:08~10:15 = 15분)', () => {
  const s = M.metalSummarize([
    ev('2026-10-05 10:10:00', 'COLLECTOR_START', { from: T('2026-10-05 10:00:00') }),
    ev('2026-10-05 10:15:00', 'LINK_UP', { downSec: 420 }),
  ], 0, 0, NOW);
  assert.strictEqual(s.gapSec, 900);
});
ok('기간 시작 앞에서 시작한 공백은 시작 시각에서 자른다 (00:30 복구 · 1시간 끊김 → 오늘은 30분)', () => {
  const s = M.metalSummarize([ev('2026-10-05 00:30:00', 'LINK_UP', { downSec: 3600 })], S0, 0, NOW);
  assert.strictEqual(s.gapSec, 1800);
  assert.strictEqual(M.metalSummarize([ev('2026-10-05 00:30:00', 'LINK_UP', { downSec: 3600 })], 0, 0, NOW).gapSec, 3600);
});
ok('endMs 가 없으면 상한 없음 — 이 기기 시계보다 미래인 행도 버리지 않는다', () => {
  const s = M.metalSummarize([ev('2026-10-05 13:00:00', 'DETECT', { n: 2 })], S0, 0, NOW);
  assert.strictEqual(s.detectTimed, 2);
});

ok('끊김 시간(K열)을 읽지 못한 통신복구 행은 0분으로 세지 않고 따로 센다 — 안내문에도 나온다', () => {
  const s = M.metalSummarize([ev('2026-10-05 09:00:00', 'LINK_UP', { downSec: null }), ev('2026-10-05 09:10:00', 'LINK_UP', { downSec: 0 }), ev('2026-10-05 09:20:00', 'LINK_UP', { downSec: 60 })], 0, 0, NOW);
  assert.strictEqual(s.unreadGap, 1); assert.strictEqual(s.downSec, 60);
  assert.ok(M.metalUnreadNote(0, 0, 1).includes('끊김 시간을 읽지 못한 통신복구 행 1건')); assert.strictEqual(M.metalUnreadNote(0, 0, 0), '');
});

console.log('\n[3b] 지금 진행 중인 공백 (status 를 주면 포함)');
const stObj = (recv, link, downSince, lastValid) => ({ recv: T(recv), link, downSince: downSince ? T(downSince) : 0, lastValid: lastValid ? T(lastValid) : 0 });
ok('통신 끊김 진행 중 — 끊김시작~지금이 공백에 들어간다', () => {
  const s = M.metalSummarize([], S0, 0, NOW, stObj('2026-10-05 11:59:30', 'DOWN', '2026-10-05 11:50:00'));
  assert.strictEqual(s.ongoingSec, 600); assert.strictEqual(s.downSec, 600); assert.strictEqual(s.gapMinutes, 10);
});
ok('끊김시작을 모르면 마지막 유효 관측부터', () => {
  const s = M.metalSummarize([], S0, 0, NOW, stObj('2026-10-05 11:59:30', 'DOWN', '', '2026-10-05 11:55:00'));
  assert.strictEqual(s.ongoingSec, 300);
});
ok('수집기 무응답 진행 중 — 마지막 수신~지금', () => {
  const s = M.metalSummarize([], S0, 0, NOW, stObj('2026-10-05 11:50:00', 'UP'));
  assert.strictEqual(s.ongoingSec, 600); assert.strictEqual(s.collectorGapSec, 600); assert.strictEqual(s.downSec, 0);
});
ok('무응답 + 끊김인데 끊김 시작이 비어 있으면 마지막 유효 응답부터 끊김으로 센다', () => {
  const s = M.metalSummarize([], S0, 0, NOW, stObj('2026-10-05 11:50:00', 'DOWN', '', '2026-10-05 11:45:00'));
  assert.strictEqual(s.downSec, 300); assert.strictEqual(s.collectorGapSec, 600); assert.strictEqual(s.gapSec, 900);
});
ok('무응답 + 그 전부터 끊김 — 둘 다 공백 (끊김 10분 + 무응답 10분 = 20분)', () => {
  const s = M.metalSummarize([], S0, 0, NOW, stObj('2026-10-05 11:50:00', 'DOWN', '2026-10-05 11:40:00'));
  assert.strictEqual(s.downSec, 600); assert.strictEqual(s.collectorGapSec, 600); assert.strictEqual(s.gapSec, 1200); assert.strictEqual(s.ongoingSec, 1200);
});
ok('진행 중 공백이 이미 센 구간과 겹치면 한 번만 (복구 이벤트 [11:50~11:52] ∪ 진행 중 [11:51~12:00] = 10분)', () => {
  const s = M.metalSummarize([ev('2026-10-05 11:52:00', 'LINK_UP', { downSec: 120 })], S0, 0, NOW, stObj('2026-10-05 11:59:30', 'DOWN', '2026-10-05 11:51:00'));
  assert.strictEqual(s.gapSec, 600);
});
ok('정상(UP · 3분 이내) 이면 진행 중 공백 없음', () => {
  const s = M.metalSummarize([], S0, 0, NOW, stObj('2026-10-05 11:59:30', 'UP'));
  assert.strictEqual(s.ongoingSec, 0); assert.strictEqual(s.gapMinutes, 0);
});
ok('status 없음 · endMs 지정(과거 구간) · 시계 불일치(수신이 미래) → 진행 중 공백을 만들지 않는다', () => {
  assert.strictEqual(M.metalSummarize([], S0, 0, NOW, null).ongoingSec, 0);
  assert.strictEqual(M.metalSummarize([], S0, NOW, NOW, stObj('2026-10-05 11:59:30', 'DOWN', '2026-10-05 11:50:00')).ongoingSec, 0);
  assert.strictEqual(M.metalSummarize([], S0, 0, NOW, stObj('2026-10-05 12:10:00', 'DOWN', '2026-10-05 11:50:00')).ongoingSec, 0);
});
ok('진행 중 공백도 기간 시작에서 자른다', () => {
  const s = M.metalSummarize([], T('2026-10-05 11:55:00'), 0, NOW, stObj('2026-10-05 11:59:30', 'DOWN', '2026-10-05 11:00:00'));
  assert.strictEqual(s.ongoingSec, 300);
});
ok('증가분 숫자를 읽지 못한 검출 행은 0건으로 세지 않고 따로 센다 (마지막 검출 시각은 유지)', () => {
  const s = M.metalSummarize([ev('2026-10-05 09:00:00', 'DETECT', { n: null }), ev('2026-10-05 09:10:00', 'GAP', { n: null }), ev('2026-10-05 09:20:00', 'DETECT', { n: 2 })], S0, 0, NOW);
  assert.strictEqual(s.unreadable, 2); assert.strictEqual(s.detectTimed, 2); assert.strictEqual(s.detectGap, 0);
  assert.strictEqual(s.lastDetectAt, T('2026-10-05 09:20:00'));
});

ok('판단 불가 연결(시계 불일치·상태 없음·읽지 못함)이면 «공백 0분» 을 초록으로 두지 않고 경고를 붙인다', () => {
  const zero = M.metalSummarize([], S0, 0, NOW);
  for (const key of ['clock', 'idle', 'unread']) {
    const html = M.metalGapCardHtml(zero, { key });
    assert.ok(html.includes('지금 진행 중인 공백은 계산하지 못했습니다'), key); assert.ok(html.includes('var(--warn)') && !html.includes('var(--suc)'), key);
  }
  for (const key of ['ok', 'linkdown', 'stale']) assert.ok(!M.metalGapCardHtml(zero, { key }).includes('계산하지 못했습니다'), key);
  assert.ok(!M.metalGapCardHtml(zero).includes('계산하지 못했습니다'));
});

console.log('\n[4] 시트 읽기 — 읽기 실패 ≠ 비어 있음');
const sheetsOf = fn => { global.SheetsAPI = { calls: [], tracks: [], getAll(tab, cache, track) { this.calls.push([tab, cache]); this.tracks.push([tab, track]); return fn(tab); } }; return global.SheetsAPI; };
(async () => {
  await okA('탭이 아직 없음(400) → 읽기 실패 아님·빈 값 (수집기 가동 전)', async () => {
    const api = sheetsOf(tab => Promise.reject(new Error('Sheets GET ' + tab + ': 400')));
    const d = await M.metalLoad();
    assert.strictEqual(d.readFail, false); assert.deepStrictEqual(d.events, []); assert.strictEqual(d.status, null);
    assert.deepStrictEqual(api.calls.map(c => c.join('|')).sort(), ['금속검출로그|false', '금속검출상태|false']);   // 캐시를 쓰지 않고 두 탭을 읽는다
  });
  await okA('500·403·401 → 읽기 실패 (한쪽만 실패해도)', async () => {
    for (const code of [500, 403, 401, 429]) {
      sheetsOf(tab => (tab === '금속검출상태' ? Promise.reject(new Error('Sheets GET ' + tab + ': ' + code)) : Promise.resolve([logRow])));
      assert.strictEqual((await M.metalLoad()).readFail, true, String(code));
    }
  });
  await okA('네트워크 예외(TypeError) → 읽기 실패', async () => {
    sheetsOf(() => Promise.reject(new TypeError('Failed to fetch')));
    assert.strictEqual((await M.metalLoad()).readFail, true);
  });
  await okA('정상 응답 → 행을 파싱하고 시각을 못 읽은 행 수를 같이 돌려준다', async () => {
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? [logRow, ['잘못된 시각', '검출', '1']] : [['NMD530-1', '2026-10-05 11:59:00', '', 'UP', '53']]));
    const d = await M.metalLoad();
    assert.strictEqual(d.readFail, false); assert.strictEqual(d.events.length, 1); assert.strictEqual(d.skipped, 1); assert.strictEqual(d.status.total, 53);
  });
  await okA('getAll 이 undefined 를 돌려줘도 죽지 않는다', async () => {
    sheetsOf(() => Promise.resolve(undefined));
    const d = await M.metalLoad();
    assert.strictEqual(d.readFail, false); assert.deepStrictEqual(d.events, []);
  });

  console.log('\n[5] 화면 렌더 (가짜 DOM) — 이스케이프 · 읽기 실패 · 빈 상태 · 30초 틱');
  const realNow = Date.now, realSet = global.setInterval, realClear = global.clearInterval;
  const dom = { els: {}, timers: [], cleared: [] };
  const content = () => dom.els.content.innerHTML;
  global.$id = id => dom.els[id] || null;
  global.renderHeader = () => {}; global.showLoading = () => {}; global.hideLoading = () => {}; global.Router = { go() {} };
  global.setInterval = (fn, ms) => { dom.timers.push({ fn, ms }); return dom.timers.length; };
  global.clearInterval = h => dom.cleared.push(h);
  const reset = () => { M.metalStopTick(); dom.els = { content: { innerHTML: '' } }; dom.timers.length = 0; dom.cleared.length = 0; global.State.metalPeriod = 0; global.State.metalLimit = 200; global.State.currentScreen = 'metal-live'; Date.now = () => NOW; };
  const render = () => global.Screens['metal-live']();
  const XSS = '<img src=x onerror=alert(1)>';

  await okA('읽기 실패 → «0건·공백 0분» 이 아니라 읽지 못함 카드 + 다시 시도, 틱 없음', async () => {
    reset(); sheetsOf(() => Promise.reject(new Error('Sheets GET x: 500')));
    await render();
    assert.ok(content().includes('시트를 읽지 못했습니다')); assert.ok(content().includes("Router.go('metal-live')"));
    assert.ok(!/0건/.test(content()) && !content().includes('모니터링 공백'));
    assert.strictEqual(dom.timers.length, 0);
  });
  await okA('탭 없음(400) → 읽기 실패가 아니라 «수집기 가동 전»', async () => {
    reset(); sheetsOf(tab => Promise.reject(new Error('Sheets GET ' + tab + ': 400')));
    await render();
    assert.ok(content().includes('수집기 가동 전')); assert.ok(!content().includes('읽지 못했습니다'));
  });
  await okA('XSS — 시트 값(시각·구분·설비상태·구간·수신시각)의 태그는 전부 이스케이프된다', async () => {
    reset();
    const lg = [
      ['2026-10-05 10:20' + XSS, '검출', '2', '53', '51', '2026-10-05 10:20:30', '1', XSS, '', '', '', 'NMD530-1', 'PC', '', 'id1'],
      ['2026-10-05 10:30:00', '<b>x</b>', '', '', '', '2026-10-05 ' + XSS, '', '', '', '', '', 'NMD530-1', 'PC', '', 'id2'],
    ];
    const stt = [['NMD530-1', '2026-10-05 11:59' + XSS, '', 'UP', '53', '', '', XSS, '0', 'PC', 'v', '', '']];
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? lg : stt));
    await render();
    const html = content();
    assert.ok(!/<im/i.test(html), '이스케이프 안 된 <img 가 남음');
    assert.ok(!/<b>x/i.test(html), '이스케이프 안 된 <b> 가 남음');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));   // 설비상태 전체 문자열
    assert.ok(html.includes('&lt;im'));                                // 시각·수신시각은 잘려 표시돼도 꺾쇠는 이스케이프
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));                  // 알 수 없는 구분 라벨
  });
  await okA('정상 렌더 — 카드 id(metal-conn·metal-gap)와 30초 틱이 생기고 이전 틱은 정리된다', async () => {
    reset();
    const lg = [logRow, ['2026-10-05 10:10:00', '통신복구', '', '', '', '', '', '', '', '', '120', 'NMD530-1', 'PC', '', 'id3']];
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? lg : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']]));
    await render();
    assert.ok(content().includes('id="metal-conn"') && content().includes('id="metal-gap"'));
    assert.ok(content().includes('>정상<')); assert.ok(content().includes('2건'));
    assert.strictEqual(dom.timers.length, 1); assert.strictEqual(dom.timers[0].ms, M.METAL_TICK_MS);
    await render();                                                    // 다시 그리면 앞선 틱을 먼저 정리한다
    assert.strictEqual(dom.timers.length, 2); assert.deepStrictEqual(dom.cleared, [1]);
  });
  const tickCards = () => { dom.els['metal-conn'] = { outerHTML: '' }; dom.els['metal-gap'] = { outerHTML: '' }; };
  await okA('틱 — 상태 탭(1행)만 다시 읽고(추적 없이) 로그 탭은 다시 읽지 않는다', async () => {
    reset();
    const api = sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']]));
    await render();
    const n0 = api.calls.length; tickCards();
    Date.now = () => NOW + MIN;
    await dom.timers[0].fn();
    assert.deepStrictEqual(api.calls.slice(n0).map(c => c.join('|')), ['금속검출상태|false']);
    assert.deepStrictEqual(api.tracks.slice(n0), [['금속검출상태', false]]);      // 화면 추적(LiveSync)에 끼어들지 않는다
    assert.deepStrictEqual(dom.cleared, []);
  });
  await okA('틱 — 수집기가 새 보고를 올렸으면 10분이 지나도 «정상» 을 유지한다(옛 값으로 응답 없음 오경보 없음)', async () => {
    reset();
    let latest = '2026-10-05 11:59:30';
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', latest, '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']]));
    await render(); tickCards();
    latest = '2026-10-05 12:09:30'; Date.now = () => NOW + 10 * MIN;
    await dom.timers[0].fn();
    assert.ok(dom.els['metal-conn'].outerHTML.includes('>정상<'), dom.els['metal-conn'].outerHTML);
    assert.ok(!dom.els['metal-gap'].outerHTML.includes('지금도 공백 진행 중'));
    assert.ok(/<div id="metal-gap" class="card"/.test(dom.els['metal-gap'].outerHTML));   // 카드 id 를 유지해야 다음 틱도 찾는다
  });
  await okA('틱 — 새 보고가 없이 10분이 지나면 «수집기 응답 없음» 으로 바뀌고 공백이 자란다', async () => {
    reset();
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']]));
    await render(); tickCards();
    Date.now = () => NOW + 10 * MIN;
    await dom.timers[0].fn();
    assert.ok(dom.els['metal-conn'].outerHTML.includes('수집기 응답 없음'));
    assert.ok(dom.els['metal-gap'].outerHTML.includes('지금도 공백 진행 중'));
  });
  await okA('틱 — 상태 탭을 읽지 못하면 옛 값을 정상처럼 두지 않고 «판단 불가» + 공백 경고', async () => {
    reset();
    let fail = false;
    let latest = '2026-10-05 11:59:30';
    sheetsOf(tab => (tab === '금속검출상태' && fail ? Promise.reject(new Error('Sheets GET ' + tab + ': 500')) : Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', latest, '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']])));
    await render(); tickCards();
    fail = true; Date.now = () => NOW + 10 * MIN;                       // 옛 값(11:59:30)은 이미 10분 묵음 — 옛 값으로 계산하면 «진행 중 공백» 이 나온다
    await dom.timers[0].fn();
    assert.ok(dom.els['metal-conn'].outerHTML.includes('연결을 판단할 수 없음')); assert.ok(!dom.els['metal-conn'].outerHTML.includes('>정상<'));
    assert.ok(dom.els['metal-gap'].outerHTML.includes('지금 진행 중인 공백은 계산하지 못했습니다'));
    assert.ok(!dom.els['metal-gap'].outerHTML.includes('지금도 공백 진행 중'));   // 못 읽은 상태로 진행 중 공백을 지어내지 않는다
    fail = false; latest = '2026-10-05 12:09:30'; Date.now = () => NOW + 11 * MIN;
    await dom.timers[0].fn();
    assert.ok(dom.els['metal-conn'].outerHTML.includes('>정상<'));       // 다음 틱에 회복
  });
  await okA('틱 — 읽는 사이 화면이 다시 그려지면(타이머 교체) 그 틱의 결과는 버린다', async () => {
    reset();
    let release; const hold = new Promise(r => { release = r; });
    let pending = false;
    sheetsOf(tab => (tab === '금속검출상태' && pending ? hold.then(() => [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']]) : Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']])));
    await render(); tickCards();
    pending = true; Date.now = () => NOW + MIN;
    const inflight = dom.timers[0].fn();                                // 읽는 중
    pending = false; await render();                                    // 사용자가 기간 칩을 눌러 다시 그림 → 앞 타이머 정리, 새 타이머
    dom.els['metal-conn'] = { outerHTML: 'NEW' }; dom.els['metal-gap'] = { outerHTML: 'NEW' };
    release(); await inflight;
    assert.strictEqual(dom.els['metal-conn'].outerHTML, 'NEW'); assert.strictEqual(dom.els['metal-gap'].outerHTML, 'NEW');   // 옛 틱이 새 카드를 덮지 않음
  });
  await okA('틱 — 읽는 중이면 다음 틱은 겹쳐 읽지 않는다', async () => {
    reset();
    let release; const hold = new Promise(r => { release = r; });
    let pending = false;
    const api = sheetsOf(tab => (tab === '금속검출상태' && pending ? hold.then(() => [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']]) : Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']])));
    await render(); tickCards();
    const n0 = api.calls.length; pending = true;
    const a = dom.timers[0].fn(); const b = dom.timers[0].fn();
    release(); await a; await b;
    assert.strictEqual(api.calls.length - n0, 1);
  });
  await okA('틱 — 화면을 벗어나 카드가 없으면 스스로 멈춘다 (예외 없음)', async () => {
    reset();
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53']]));
    await render();
    delete dom.els['metal-conn'];
    await dom.timers[0].fn();
    assert.deepStrictEqual(dom.cleared, [1]);
  });
  await okA('틱 — 읽는 사이 화면을 벗어나 카드가 사라졌으면 그 틱에서 바로 멈춘다(다음 틱까지 끌지 않는다)', async () => {
    reset();
    let release; const hold = new Promise(r => { release = r; });
    let pending = false;
    sheetsOf(tab => (tab === '금속검출상태' && pending ? hold.then(() => [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']]) : Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']])));
    await render(); tickCards();
    pending = true; Date.now = () => NOW + MIN;
    const inflight = dom.timers[0].fn();
    assert.deepStrictEqual(dom.cleared, []);                            // 읽기 시작 시점엔 카드가 있어 멈추지 않는다
    delete dom.els['metal-conn']; delete dom.els['metal-gap'];          // 읽는 중에 화면을 떠남
    release(); await inflight;
    assert.deepStrictEqual(dom.cleared, [1]);
  });
  await okA('읽는 사이 다른 화면으로 옮겼으면 그리지 않고 틱도 만들지 않는다', async () => {
    reset();
    let release; const hold = new Promise(r => { release = r; });
    sheetsOf(tab => hold.then(() => (tab === '금속검출로그' ? [logRow] : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53', '2026-10-05 11:59:00', '1', '', '0', 'PC', 'v', '', '']])));
    const p = render();
    global.State.currentScreen = 'dashboard';                          // 로딩 중에 다른 화면으로 이동
    release(); await p;
    assert.strictEqual(content(), ''); assert.strictEqual(dom.timers.length, 0);
  });
  await okA('판단 불가 연결(상태 시트 비어 있고 로그만 있음)이면 화면 공백 카드에 경고', async () => {
    reset();
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? [logRow] : []));
    await render();
    assert.ok(content().includes('지금 진행 중인 공백은 계산하지 못했습니다'));
  });
  await okA('읽기 실패로 다시 그리면 이전 틱을 먼저 멈춘다', async () => {
    reset();
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? [logRow] : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53']]));
    await render();
    sheetsOf(() => Promise.reject(new Error('Sheets GET x: 500')));
    await render();
    assert.deepStrictEqual(dom.cleared, [1]);
  });
  await okA('읽지 못한 행 안내 — 시각 불명 행·숫자 불명 검출 행 수가 화면에 나온다', async () => {
    reset();
    const lg = [logRow, ['잘못된 시각', '검출', '1'], ['2026-10-05 10:40:00', '검출', '', '', '', '', '', '', '', '', '', 'NMD530-1', 'PC', '', 'id9']];
    sheetsOf(tab => Promise.resolve(tab === '금속검출로그' ? lg : [['NMD530-1', '2026-10-05 11:59:30', '', 'UP', '53']]));
    await render();
    assert.ok(content().includes('시각을 읽지 못한 행 1건')); assert.ok(content().includes('증가분 숫자를 읽지 못한 검출 행 1건'));
  });
  Date.now = realNow; global.setInterval = realSet; global.clearInterval = realClear;

  console.log('\n[6] CCP-1P 참고 줄');
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const CN = today.getTime() + 60 * MIN;                               // 오늘 13:00
  const cev = (kind, o) => Object.assign({ t: today.getTime(), kind, n: null, downSec: null, from: 0 }, o || {});
  ok('읽기 실패·null → 숨기지 않고 «읽지 못했습니다»', () => {
    [null, { readFail: true, events: [], status: null }].forEach(d => {
      const r = M.metalCcpLineHtml(d, CN); assert.strictEqual(r.show, true); assert.ok(r.html.includes('읽지 못했습니다')); assert.ok(r.html.includes('[현황 보기]'));
    });
  });
  ok('시트가 비어 있으면(가동 전) 줄을 숨긴다', () => assert.strictEqual(M.metalCcpLineHtml({ events: [], status: null, readFail: false }, CN).show, false));
  ok('정상 — 오늘 건수·공백 분', () => {
    const r = M.metalCcpLineHtml({ events: [cev('DETECT', { n: 2 }), cev('GAP', { n: 1 }), cev('LINK_UP', { downSec: 120 })], status: null, readFail: false, skipped: 0 }, CN);
    assert.ok(r.show); assert.ok(r.html.includes('<b>3건</b>')); assert.ok(r.html.includes('<b>2분</b>')); assert.ok(!r.html.includes('진행 중'));
  });
  ok('진행 중 공백은 분에 포함하고 «(진행 중)» 을 붙인다', () => {
    const st = { recv: CN - 30000, link: 'DOWN', downSince: CN - 10 * MIN, lastValid: 0 };
    const r = M.metalCcpLineHtml({ events: [cev('DETECT', { n: 1 })], status: st, readFail: false, skipped: 0 }, CN);
    assert.ok(r.html.includes('<b>10분</b>')); assert.ok(r.html.includes('(진행 중)'));
  });
  ok('연결을 판단할 수 없으면(상태 시트 없음) 줄에 «현재 연결 확인 불가» 를 붙인다 · 정상 연결이면 붙이지 않는다', () => {
    const none = M.metalCcpLineHtml({ events: [cev('DETECT', { n: 1 })], status: null, readFail: false, skipped: 0 }, CN);
    assert.ok(none.html.includes('현재 연결 확인 불가'));
    const okSt = M.metalParseStatus([['NMD530-1', '2026-10-05 12:59:30', '', 'UP', '5']], 'NMD530-1');
    const good = M.metalCcpLineHtml({ events: [cev('DETECT', { n: 1 })], status: okSt, readFail: false, skipped: 0 }, T('2026-10-05 13:00:00'));
    assert.ok(!good.html.includes('확인 불가'));
  });
  ok('읽지 못한 행 수에는 끊김 시간을 못 읽은 복구 행도 들어간다', () => {
    const r = M.metalCcpLineHtml({ events: [cev('LINK_UP', { downSec: null })], status: null, readFail: false, skipped: 0 }, CN);
    assert.ok(r.html.includes('읽지 못한 행 1건'));
  });
  ok('읽지 못한 행이 있으면 건수를 덧붙인다', () => {
    const r = M.metalCcpLineHtml({ events: [cev('DETECT', { n: 1 }), cev('DETECT', { n: null })], status: null, readFail: false, skipped: 2 }, CN);
    assert.ok(r.html.includes('읽지 못한 행 3건'));
  });
  await okA('metalFillCcpLine — 실패하면 줄을 숨기지 않고 경고, 비면 숨김, 요소가 없으면 조용히 끝', async () => {
    const el = { style: {}, innerHTML: '' };
    reset(); dom.els['ccp-auto-7'] = el;
    sheetsOf(() => Promise.reject(new Error('Sheets GET x: 500')));
    await M.metalFillCcpLine(7);
    assert.strictEqual(el.style.display, 'flex'); assert.ok(el.innerHTML.includes('읽지 못했습니다'));
    sheetsOf(tab => Promise.reject(new Error('Sheets GET ' + tab + ': 400')));
    await M.metalFillCcpLine(7);
    assert.strictEqual(el.style.display, 'none');
    await M.metalFillCcpLine(99);
    const first = { style: {}, innerHTML: '' }, second = { style: {}, innerHTML: '' };
    dom.els['ccp-auto-8'] = first;
    sheetsOf(tab => { dom.els['ccp-auto-8'] = second; return Promise.reject(new Error('Sheets GET ' + tab + ': 500')); });   // 읽는 사이 일지가 다시 그려짐
    await M.metalFillCcpLine(8);
    assert.strictEqual(first.innerHTML, ''); assert.ok(second.innerHTML.includes('읽지 못했습니다'));
    Date.now = realNow;
  });

  console.log('\n[7] 삭제 검증 — 읽기 전용 화면 · 낡은 것 제거 (주석 걷어낸 사본)');
  const stripped = metalSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  ok('0x60 · 0x3A 없음', () => { assert.ok(!/0x60/i.test(stripped)); assert.ok(!/0x3A/i.test(stripped)); });
  ok('쓰기 호출 없음 (append·updateRowByIndex·batchUpdate)', () => {
    assert.ok(!/\.(append|updateRowByIndex|batchUpdate)\s*\(/.test(stripped));
    assert.ok(/SheetsAPI\.getAll\(/.test(stripped));
  });
  ok('헥스 색 하드코딩 없음 — 테마 변수만 (옛 var(--x,#hex) 폴백·#fff 삭제)', () => {
    assert.deepStrictEqual(stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);
  });
  ok('옛 오류 삼킴(.catch(() => [])) 삭제 — 읽기 실패는 readFail 로만 알린다', () => {
    assert.ok(!/\.catch\(\s*\(\s*\)\s*=>\s*\[\s*\]\s*\)/.test(stripped));
    assert.ok(/readFail/.test(stripped));
  });
  ok('화면 연결 — 더보기 메뉴 항목 · 하단 탭 매핑 · 일지 참고 줄 자리와 호출', () => {
    const noC = SRC.split(/\r?\n/).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');   // 주석 줄은 뺀다(전체를 /*…*/ 로 걷으면 문자열 속 '/*' 가 코드를 삼킨다)
    assert.ok(/target:\s*'metal-live'/.test(noC)); assert.ok(/'metal-live':\s*'more'/.test(noC));
    assert.ok(/id="ccp-auto-\$\{stepNo\}"/.test(noC)); assert.ok(/if \(stepType === 'inspect'\) metalFillCcpLine\(stepNo\)/.test(noC));
  });
  ok('폰에서 설명 문장이 한 줄로 잘리지 않는다 — 앱의 .card 말줄임 규칙을 이 화면(.metal-wrap)에서만 풀고, 세 갈래 화면 뿌리(읽기 실패·가동 전·본 화면)가 모두 그 클래스를 건다', () => {
    const lines = SRC.split(/\r?\n/).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l));
    const rule = lines.find(l => /^\.metal-wrap \.card \.fs-11\.c-txt-l/.test(l));
    assert.ok(rule, '해제 규칙 없음');
    for (const sel of ['.fs-11.c-txt-l', '.fs-12.c-txt-l', '.fs-14.fw-7']) assert.ok(rule.includes('.metal-wrap .card ' + sel), sel + ' 빠짐');
    assert.ok(/white-space:\s*normal/.test(rule) && /text-overflow:\s*clip/.test(rule) && /overflow:\s*visible/.test(rule));
    const at = lines.findIndex(l => l.startsWith("Screens['metal-live']"));
    assert.ok(at >= 0);
    const scr = lines.slice(at, at + 80).join('\n');
    assert.strictEqual((scr.match(/<div class="metal-wrap" style="padding:16px">/g) || []).length, 3);
    assert.ok(!/<div style="padding:16px">/.test(scr), '클래스 없는 화면 뿌리가 남았다');
  });
  ok('이 화면의 outline 버튼(다시 시도·더 보기)은 색 클래스(btn-pri)를 가진다 — 없으면 .btn 의 흰 글씨가 투명 배경 위에서 보이지 않는다', () => {
    const lines = SRC.split(/\r?\n/).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l));
    const at = lines.findIndex(l => l.startsWith("Screens['metal-live']"));
    assert.ok(at >= 0);
    const scr = lines.slice(at, at + 80).join('\n');
    const btns = scr.match(/<button class="btn btn-outline[^"]*"/g) || [];
    assert.strictEqual(btns.length, 2);
    for (const b of btns) assert.ok(/\bbtn-(pri|err|info|warn|gray)\b/.test(b), '색 클래스 없음: ' + b);
  });
  ok('기본 기간은 «오늘»(1) · 읽는 쪽 쓰기 금지는 메서드 이름 전체(append·update*·delete*·clear·set*·batch*)', () => {
    assert.ok(/State\.metalPeriod == null\) State\.metalPeriod = 1/.test(stripped));
    assert.ok(!/SheetsAPI\.(append|update\w*|delete\w*|clear\w*|set\w*|batch\w*|write\w*|insert\w*)\s*\(/.test(stripped));
  });
  ok('시간 기반 갱신은 setInterval 하나 — 정리(clearInterval) 경로가 있다', () => {
    assert.strictEqual((stripped.match(/\bsetInterval\s*\(/g) || []).length, 1);
    assert.ok(/clearInterval\s*\(\s*metalTimer\s*\)/.test(stripped));
  });

  console.log(`\n통과 ${pass}종`);
})().catch(e => { console.error('\n실패:', e && e.stack || e); process.exit(1); });
