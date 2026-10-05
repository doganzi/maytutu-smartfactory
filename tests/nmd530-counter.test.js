/* NMD-530 카운터 엔진 표 기반 단위 시험 — 계약서 docs/NMD530_PIPELINE.md §3 표의 모든 행.
   순수 함수 모듈이라 네트워크·파일·실제 시계가 없다(시각은 전부 주입).

   실행:  node tests/nmd530-counter.test.js      실패하면 assert 로 즉시 중단 */
const assert = require('assert');
const path = require('path');
const { createCounter, kstIso, makeBootId } = require(path.join(__dirname, '..', 'bridge', 'nmd530-counter.js'));

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message); process.exit(1); }
}

const T0 = Date.UTC(2026, 9, 5, 1, 0, 0);   // 2026-10-05 10:00:00 KST
const S = 1000;
const DOWN = 30 * S;
const mk = (state, extra) => createCounter(Object.assign({ downAfterMs: DOWN, state, device: 'NMD530-1', bootId: 'B1', now: () => T0 }, extra));
const obs = (t, total, extra) => Object.assign({ t, total, product: 1, ch1: 90, ch2: 0, flags: [] }, extra);
const kinds = evs => evs.map(e => e.kind);

console.log('── nmd530-counter 시험 ──');

/* §3 표 1행: 첫 관측 */
ok('첫 관측: 기준만 잡고 COLLECTOR_START 한 건 — 증가분을 지어내지 않음', () => {
  const c = mk({});
  const ev = c.onValid(obs(T0 + 3 * S, 50));
  assert.deepStrictEqual(kinds(ev), ['COLLECTOR_START']);
  assert.strictEqual(ev[0].total, 50);
  assert.strictEqual(ev[0].n, null);
  assert.strictEqual(ev[0].prev, null);
  assert.strictEqual(ev[0].from, null);
  assert.strictEqual(ev[0].t, kstIso(T0));        // 프로세스 시작 시각
});

/* 2행: 증가 + 간격 ≤ downAfterMs */
ok('증가 +N, 간격 ≤ downAfterMs → DETECT (n·prev·from)', () => {
  const c = mk({}); c.onValid(obs(T0 + 3 * S, 50));
  const ev = c.onValid(obs(T0 + 6 * S, 53));
  assert.deepStrictEqual(kinds(ev), ['DETECT']);
  assert.strictEqual(ev[0].n, 3); assert.strictEqual(ev[0].prev, 50); assert.strictEqual(ev[0].total, 53);
  assert.strictEqual(ev[0].from, kstIso(T0 + 3 * S));
  assert.strictEqual(ev[0].t, kstIso(T0 + 6 * S));
});
ok('간격이 정확히 downAfterMs 이면 아직 DETECT (경계: ≤)', () => {
  const c = mk({}); c.onValid(obs(T0, 1));
  assert.deepStrictEqual(kinds(c.onValid(obs(T0 + DOWN, 2))), ['DETECT']);
});

/* 3행: 증가 + 간격 > downAfterMs */
ok('간격이 downAfterMs 를 1ms 넘으면 GAP (시각을 알 수 없음)', () => {
  const c = mk({}); c.onValid(obs(T0, 1));
  const ev = c.onValid(obs(T0 + DOWN + 1, 4));
  assert.deepStrictEqual(kinds(ev), ['GAP']);
  assert.strictEqual(ev[0].n, 3); assert.strictEqual(ev[0].from, kstIso(T0));
});

/* 4행: 같은 값 */
ok('같은 값 → 이벤트 없음', () => {
  const c = mk({}); c.onValid(obs(T0, 7));
  assert.deepStrictEqual(c.onValid(obs(T0 + 3 * S, 7)), []);
  assert.deepStrictEqual(c.onValid(obs(T0 + 6 * S, 7)), []);
});

/* 5행: 감소 = 리셋 */
ok('감소 → RESET (prev·total, 증가분 n 없음) 후 새 값이 기준', () => {
  const c = mk({}); c.onValid(obs(T0, 100));
  const ev = c.onValid(obs(T0 + 3 * S, 4));
  assert.deepStrictEqual(kinds(ev), ['RESET']);
  assert.strictEqual(ev[0].prev, 100); assert.strictEqual(ev[0].total, 4); assert.strictEqual(ev[0].n, null);
  const ev2 = c.onValid(obs(T0 + 6 * S, 5));
  assert.deepStrictEqual(kinds(ev2), ['DETECT']);
  assert.strictEqual(ev2[0].n, 1); assert.strictEqual(ev2[0].prev, 4);   // 100 이 아니라 리셋된 값이 기준
});
ok('0 으로 리셋돼도 RESET (0 은 «기준 없음» 이 아니다)', () => {
  const c = mk({}); c.onValid(obs(T0, 9));
  assert.deepStrictEqual(kinds(c.onValid(obs(T0 + 3 * S, 0))), ['RESET']);
  const d = mk({}); d.onValid(obs(T0, 0));
  assert.deepStrictEqual(kinds(d.onValid(obs(T0 + 3 * S, 2))), ['DETECT']);
});

/* 6행: 응답 없음 → LINK_DOWN */
ok('응답 없음 ≤ downAfterMs 는 조용, 넘으면 LINK_DOWN 한 번만', () => {
  const c = mk({}); c.onValid(obs(T0, 5));
  assert.deepStrictEqual(c.onTick(T0 + DOWN), []);
  const ev = c.onTick(T0 + DOWN + 1);
  assert.deepStrictEqual(kinds(ev), ['LINK_DOWN']);
  assert.strictEqual(ev[0].t, kstIso(T0 + DOWN + 1));      // 선언 시각
  assert.strictEqual(ev[0].from, kstIso(T0));              // 마지막 유효 시각
  assert.strictEqual(ev[0].total, null); assert.strictEqual(ev[0].n, null);
  assert.deepStrictEqual(c.onTick(T0 + DOWN + 5 * S), []);  // 이미 선언 — 되풀이하지 않음
  assert.strictEqual(c.snapshot().down, true); assert.strictEqual(c.snapshot().link, 'DOWN');
});
ok('LINK_DOWN 은 마지막 유효 응답의 제품번호·채널·상태를 싣는다', () => {
  const c = mk({}); c.onValid(obs(T0, 5, { product: 7, ch1: 88, ch2: 3, flags: ['testMode'] }));
  const ev = c.onTick(T0 + DOWN + 1)[0];
  assert.strictEqual(ev.product, 7); assert.strictEqual(ev.ch1, 88); assert.strictEqual(ev.ch2, 3);
  assert.deepStrictEqual(ev.flags, ['testMode']);
});
ok('응답이 계속 오면 tick 은 아무것도 만들지 않음', () => {
  const c = mk({});
  for (let i = 0; i < 20; i++) { c.onValid(obs(T0 + i * 3 * S, 1)); assert.deepStrictEqual(c.onTick(T0 + i * 3 * S + 2 * S), []); }
});

/* 7행: 복구 */
ok('끊긴 뒤 첫 유효 응답: 증가 없음 → LINK_UP 만 (downSec = 마지막 유효~복구)', () => {
  const c = mk({}); c.onValid(obs(T0, 5));
  c.onTick(T0 + DOWN + 1);
  const ev = c.onValid(obs(T0 + 45 * S, 5));
  assert.deepStrictEqual(kinds(ev), ['LINK_UP']);
  assert.strictEqual(ev[0].downSec, 45);
  assert.strictEqual(c.snapshot().down, false); assert.strictEqual(c.snapshot().link, 'UP');
});
ok('끊긴 뒤 복구 + 증가 → LINK_UP 다음에 GAP', () => {
  const c = mk({}); c.onValid(obs(T0, 5));
  c.onTick(T0 + DOWN + 1);
  const ev = c.onValid(obs(T0 + 60 * S, 9));
  assert.deepStrictEqual(kinds(ev), ['LINK_UP', 'GAP']);
  assert.strictEqual(ev[1].n, 4); assert.strictEqual(ev[1].prev, 5); assert.strictEqual(ev[1].from, kstIso(T0));
});
ok('끊긴 뒤 복구 + 감소 → LINK_UP 다음에 RESET (증가분 없음)', () => {
  const c = mk({}); c.onValid(obs(T0, 50));
  c.onTick(T0 + DOWN + 1);
  const ev = c.onValid(obs(T0 + 60 * S, 2));
  assert.deepStrictEqual(kinds(ev), ['LINK_UP', 'RESET']);
  assert.strictEqual(ev[1].n, null);
});
ok('끊김→복구→다시 끊김 이 반복돼도 매번 한 쌍씩', () => {
  const c = mk({}); c.onValid(obs(T0, 1));
  let t = T0, all = [];
  for (let i = 0; i < 3; i++) {
    all = all.concat(c.onTick(t + DOWN + 1)); t += 40 * S; all = all.concat(c.onValid(obs(t, 1)));
  }
  assert.deepStrictEqual(kinds(all), ['LINK_DOWN', 'LINK_UP', 'LINK_DOWN', 'LINK_UP', 'LINK_DOWN', 'LINK_UP']);
});
ok('검출기가 시작부터 안 보이면(기준 없음) LINK_DOWN from=null, 복구 시 COLLECTOR_START → LINK_UP', () => {
  const c = mk({});
  const dn = c.onTick(T0 + DOWN + 1);
  assert.deepStrictEqual(kinds(dn), ['LINK_DOWN']); assert.strictEqual(dn[0].from, null);
  const up = c.onValid(obs(T0 + 50 * S, 8));
  assert.deepStrictEqual(kinds(up), ['COLLECTOR_START', 'LINK_UP']);
  assert.strictEqual(up[0].t, kstIso(T0));           // 시작 시각 — LINK_DOWN~UP 구간과 공백이 겹치지 않음
  assert.strictEqual(up[1].downSec, 50);
});

/* 8행: 수집기 프로세스 시작 */
ok('재시작: COLLECTOR_START.from = state.lastValidAt, 사이 증가분은 GAP', () => {
  const last = T0 - 10 * 60 * S;
  const c = mk({ lastTotal: 40, lastValidAt: last, seq: 12 });
  const ev = c.onValid(obs(T0 + 3 * S, 43));
  assert.deepStrictEqual(kinds(ev), ['COLLECTOR_START', 'GAP']);
  assert.strictEqual(ev[0].from, kstIso(last)); assert.strictEqual(ev[0].total, 43);
  assert.strictEqual(ev[1].n, 3); assert.strictEqual(ev[1].prev, 40); assert.strictEqual(ev[1].from, kstIso(last));
});
ok('재시작 + 증가 없음 → COLLECTOR_START 만', () => {
  const c = mk({ lastTotal: 40, lastValidAt: T0 - 600 * S, seq: 0 });
  assert.deepStrictEqual(kinds(c.onValid(obs(T0 + 3 * S, 40))), ['COLLECTOR_START']);
});
ok('재시작 + 감소(재시작 사이 검출기 리셋) → COLLECTOR_START, RESET', () => {
  const c = mk({ lastTotal: 40, lastValidAt: T0 - 600 * S, seq: 0 });
  const ev = c.onValid(obs(T0 + 3 * S, 1));
  assert.deepStrictEqual(kinds(ev), ['COLLECTOR_START', 'RESET']);
});
ok('아주 빠른 재시작(간격 ≤ downAfterMs)이면 증가분은 DETECT', () => {
  const c = mk({ lastTotal: 40, lastValidAt: T0 - 5 * S, seq: 0 });
  assert.deepStrictEqual(kinds(c.onValid(obs(T0 + 3 * S, 41))), ['COLLECTOR_START', 'DETECT']);
});
ok('저장된 down 값은 무시: 재시작 직후는 끊김이 아니다', () => {
  const c = mk({ lastTotal: 1, lastValidAt: T0 - 600 * S, down: true, downSince: T0 - 700 * S, seq: 0 });
  assert.strictEqual(c.snapshot().down, false);
  assert.deepStrictEqual(c.onTick(T0 + 1000), []);
});

/* 몰려 온 늦은 응답 */
ok('늦게 몰려 온 응답: 같은 값 반복 → 이벤트 없음', () => {
  const c = mk({}); c.onValid(obs(T0, 10));
  for (let i = 0; i < 5; i++) assert.deepStrictEqual(c.onValid(obs(T0 + 1600 + i, 10)), []);
});
ok('늦게 몰려 온 응답: 단조 증가 값이 연달아 와도 증가분 합 = 실제 증가', () => {
  const c = mk({}); c.onValid(obs(T0, 10));
  const evs = [11, 11, 12, 12, 14].flatMap((v, i) => c.onValid(obs(T0 + 1600 + i * 5, v)));
  assert.strictEqual(evs.reduce((s, e) => s + (e.n || 0), 0), 4);
  assert.ok(evs.every(e => e.kind === 'DETECT'));
  assert.deepStrictEqual(evs.map(e => e.prev), [10, 11, 12]);   // 매 이벤트가 직전 값에서 이어진다
});

/* flags */
ok('flags: 0x02·0x04·0x08·0x10 만 내보내고 예약 비트(bit0·bit5)는 제외, 순서 고정', () => {
  const c = mk({});
  const ev = c.onValid(obs(T0, 1, { flags: ['bit5', 'dualFreq', 'outError', 'bit0', 'testMode', 'balError', 'zzz'] }));
  assert.deepStrictEqual(ev[0].flags, ['outError', 'balError', 'testMode', 'dualFreq']);
  const d = mk({});
  assert.deepStrictEqual(d.onValid(obs(T0, 1, { flags: ['bit0', 'bit5'] }))[0].flags, []);
});

/* id */
ok('id: device|bootId|seq(4자리 0채움), 재시작해도 seq 이어짐, 80자 이하', () => {
  const c = mk({ seq: 6 });
  const ev = c.onValid(obs(T0, 1)).concat(c.onValid(obs(T0 + 3 * S, 2)));
  assert.deepStrictEqual(ev.map(e => e.id), ['NMD530-1|B1|0007', 'NMD530-1|B1|0008']);
  assert.ok(ev.every(e => e.id.length <= 80));
  assert.strictEqual(c.snapshot().seq, 8);
});
ok('id: 한 프로세스에서 전부 유일하고, 같은 입력이면 같은 값(안정)', () => {
  const run = () => {
    const c = mk({}); let evs = c.onValid(obs(T0, 1));
    for (let i = 1; i < 40; i++) evs = evs.concat(c.onValid(obs(T0 + i * 3 * S, i % 7 === 0 ? 0 : i)), c.onTick(T0 + i * 3 * S + DOWN + 1));
    return evs.map(e => e.id);
  };
  const a = run(), b = run();
  assert.strictEqual(new Set(a).size, a.length);
  assert.deepStrictEqual(a, b);
});
ok('bootId 기본값: KST 초 단위 20261005T100000K 형태', () => {
  assert.strictEqual(makeBootId(T0), '20261005T100000K');
  assert.strictEqual(createCounter({ now: () => T0, device: 'D' }).bootId, '20261005T100000K');
  const c = createCounter({ now: () => T0, device: 'D' });
  assert.ok(/^D\|20261005T100000K\|0001$/.test(c.onValid(obs(T0, 1))[0].id));
});

/* n 을 지어내지 않음 */
ok('n 은 DETECT·GAP 에만 있고 그 외 종류는 null', () => {
  const c = mk({}); let evs = c.onValid(obs(T0, 5));
  evs = evs.concat(c.onValid(obs(T0 + 3 * S, 2)), c.onTick(T0 + 3 * S + DOWN + 1), c.onValid(obs(T0 + 60 * S, 2)));
  assert.deepStrictEqual(kinds(evs), ['COLLECTOR_START', 'RESET', 'LINK_DOWN', 'LINK_UP']);
  assert.ok(evs.every(e => e.n === null));
});
ok('복구 후 같은 값이면 증가분 없음(끊김이 증가분을 만들지 않음)', () => {
  const c = mk({}); c.onValid(obs(T0, 5)); c.onTick(T0 + DOWN + 1);
  assert.ok(c.onValid(obs(T0 + 60 * S, 5)).every(e => e.n === null));
});

/* 이벤트 모양 */
ok('모든 이벤트가 §4 의 키를 빠짐없이 가진다', () => {
  const keys = ['id', 't', 'kind', 'n', 'total', 'prev', 'from', 'product', 'ch1', 'ch2', 'flags', 'downSec'];
  const c = mk({}); const evs = c.onValid(obs(T0, 1)).concat(c.onTick(T0 + DOWN + 1));
  for (const e of evs) assert.deepStrictEqual(Object.keys(e).sort(), keys.slice().sort());
});
ok('snapshot: state.json 에 저장할 값(lastTotal·lastValidAt·down·downSince·seq)', () => {
  const c = mk({}); c.onValid(obs(T0 + 3 * S, 9));
  const s = c.snapshot();
  assert.strictEqual(s.lastTotal, 9); assert.strictEqual(s.lastValidAt, T0 + 3 * S);
  assert.strictEqual(s.down, false); assert.strictEqual(s.downSince, null); assert.strictEqual(s.seq, 1);
  c.onTick(T0 + 3 * S + DOWN + 1);
  assert.strictEqual(c.snapshot().downSince, T0 + 3 * S);
});

/* kstIso */
ok('kstIso: 머신 시간대와 무관하게 항상 +09:00', () => {
  const want = '2026-10-05T10:20:33+09:00', ms = Date.UTC(2026, 9, 5, 1, 20, 33, 999);
  const keep = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Seoul', 'Pacific/Auckland']) {
      process.env.TZ = tz;
      assert.strictEqual(kstIso(ms), want, tz);
    }
  } finally { if (keep === undefined) delete process.env.TZ; else process.env.TZ = keep; }
  assert.strictEqual(kstIso(Date.UTC(2026, 11, 31, 16, 0, 0)), '2027-01-01T01:00:00+09:00');   // 날짜 경계
});

/* ── 수집기 결함 수정 시험 (C1·C2·C10) ── */
ok('C1 redial: 끊김 선언 뒤 downAfterMs 마다 true, 그 사이는 false — 이벤트는 늘지 않는다', () => {
  const c = mk({}); c.onValid(obs(T0, 5));
  assert.strictEqual(c.redial(T0 + 10 * S), false);                 // 끊김 아님
  const t1 = T0 + DOWN + 1;
  assert.deepStrictEqual(kinds(c.onTick(t1)), ['LINK_DOWN']);        // 선언(이때 호출자가 첫 파기)
  assert.strictEqual(c.redial(t1 + DOWN - 1), false);
  assert.strictEqual(c.redial(t1 + DOWN), true);                     // 두 번째 파기
  assert.strictEqual(c.redial(t1 + DOWN + 1), false);
  assert.strictEqual(c.redial(t1 + 2 * DOWN), true);                 // 세 번째 파기
  for (let k = 1; k < 10; k++) assert.deepStrictEqual(c.onTick(t1 + k * DOWN), []);   // LINK_DOWN 은 다시 나오지 않음
  assert.strictEqual(c.snapshot().seq, 2);                           // COLLECTOR_START 없이 LINK_DOWN 한 건만 seq 소비
  c.onValid(obs(t1 + 3 * DOWN, 5));
  assert.strictEqual(c.redial(t1 + 9 * DOWN), false);                // 복구하면 더는 파기하지 않음
});
ok('C2 시계 역행: 10분 되감은 뒤 응답이 끊기면 downAfterMs 뒤에 LINK_DOWN', () => {
  const c = mk({}); c.onValid(obs(T0, 5));
  const back = T0 - 600 * S;
  assert.deepStrictEqual(c.onTick(back), []);
  assert.deepStrictEqual(c.onTick(back + DOWN), []);
  assert.deepStrictEqual(kinds(c.onTick(back + DOWN + 1)), ['LINK_DOWN']);
});
ok('C2 시계 역행: 끊김 중 시계가 되감겨도 redial 이 멎지 않는다', () => {
  const c = mk({}); c.onValid(obs(T0, 5));
  c.onTick(T0 + DOWN + 1);
  const back = T0 - 600 * S;
  assert.strictEqual(c.redial(back), false);
  assert.strictEqual(c.redial(back + DOWN), true);
});
ok('C2 미래의 lastValidAt 로 복원된 상태에서 증가하면 DETECT 가 아니라 GAP', () => {
  const c = mk({ lastTotal: 5, lastValidAt: T0 + 600 * S, seq: 0 });
  assert.deepStrictEqual(kinds(c.onValid(obs(T0 + 3 * S, 7))), ['COLLECTOR_START', 'GAP']);
});
ok('C2 시계 역행: 끊긴 뒤 시계가 10분 되감긴 채 복구해도 LINK_UP.downSec 는 음수가 아니다', () => {
  const c = mk({}); c.onValid(obs(T0, 5));
  assert.deepStrictEqual(kinds(c.onTick(T0 + DOWN + 1)), ['LINK_DOWN']);
  const ev = c.onValid(obs(T0 - 600 * S, 5));
  const up = ev.find(e => e.kind === 'LINK_UP');
  assert.ok(up, 'LINK_UP 이 나와야 한다');
  assert.strictEqual(up.downSec, 0);
});
ok('C2 시계 역행: from 이 이벤트 시각보다 미래면 구간(from)을 만들지 않는다', () => {
  const c = mk({ lastTotal: 5, lastValidAt: T0 + 600 * S, seq: 0 });
  const ev = c.onValid(obs(T0 + 3 * S, 7));
  assert.deepStrictEqual(kinds(ev), ['COLLECTOR_START', 'GAP']);
  for (const e of ev) assert.strictEqual(e.from, null, e.kind + '.from');
});
ok('C10 비수치·음수·소수 total 은 유효 응답이 아니다 — 기준선·lastValidAt 불변, 이벤트 없음', () => {
  const c = mk({}); c.onValid(obs(T0, 5));
  const before = JSON.stringify(c.snapshot());
  for (const bad of [undefined, null, NaN, Infinity, -1, 2.5, '7']) {
    assert.deepStrictEqual(c.onValid(obs(T0 + 3 * S, bad)), []);
  }
  assert.strictEqual(JSON.stringify(c.snapshot()), before);
  assert.deepStrictEqual(kinds(c.onValid(obs(T0 + 6 * S, 6))), ['DETECT']);   // 기준선 5 가 살아 있음
  const d = mk({});
  assert.deepStrictEqual(d.onValid(obs(T0, NaN)), []);                          // 첫 응답이 비수치여도 시작하지 않음
  assert.deepStrictEqual(kinds(d.onValid(obs(T0 + 3 * S, 4))), ['COLLECTOR_START']);
});

console.log('\n통과 ' + passed + '종');
