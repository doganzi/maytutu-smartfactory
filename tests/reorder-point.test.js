/* 발주점(안전재고) 산식 검증 — index.html 에 실려 있는 블록을 그대로 떼어 돌린다.
   (사본을 두면 원본과 갈라져서 통과해도 의미가 없다 — factory-pnl.test.js 와 같은 방식)

   실행:  node tests/reorder-point.test.js
   범위:  집계·산식만. 시트 쓰기·모달 렌더는 라이브 검수 대상.
   기준선: 2026-08-21 실데이터로 산출해 시트에 반영한 값 — RM001 144kg · RM006 162kg · RM011 800kg.
           이 숫자가 바뀌면 산식이 바뀐 것이니, 바뀐 게 의도인지부터 확인할 것.               */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = SRC.indexOf('// <reorder-calc>');
const j = SRC.indexOf('// </reorder-calc>');
assert.ok(i !== -1 && j > i, 'index.html 에서 <reorder-calc> 블록을 찾지 못함');
const ctx = vm.createContext({ Math, Date, JSON, Map, Set, parseFloat, isFinite, console });
vm.runInContext(SRC.slice(i, j), ctx);
const { rpDate, rpWeekStart, rpPercentile, rpWeeklyUse, rpUseSeries, rpReceiptGaps, calcReorderPoint } = ctx;
// const 선언은 컨텍스트 객체에 안 붙는다(함수 선언만 붙음) — 값으로 꺼낸다
const RP_CFG = vm.runInContext('RP_CFG', ctx);

const ok = [];
const t = (n, f) => { f(); ok.push(n); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);

// 관측 기준일 — 2026-08-21(금). 진행 중인 주는 2026-08-17(월) 시작.
const AS_OF = new Date('2026/08/21 23:59:59');

/* ── 1. 날짜 파싱 — 한 자리 시(8:59) 가 살아 있어야 한다 ───────────────────── */
t('시트 날짜: 한 자리 시각도 파싱된다 (ISO 흉내 금지)', () => {
  assert.ok(rpDate('2026-08-21 8:59'), '"2026-08-21 8:59" 가 버려졌다 — 입고 9건이 이 함정으로 실종됐었다');
  assert.strictEqual(rpDate('2026-08-21 8:59').getHours(), 8);
  assert.strictEqual(rpDate('2026-08-12 16:56').getDate(), 12);
  assert.strictEqual(rpDate(''), null);
  assert.strictEqual(rpDate('없는날짜'), null);
  // 옛 방식이 왜 위험했는지 — 회귀 방지용 대조군
  assert.ok(isNaN(new Date('2026-08-21T8:59')), 'ISO 로 바꾸면 한 자리 시는 Invalid Date 다');
});

/* ── 2. 주 경계 — 월요일 시작 ─────────────────────────────────────────────── */
t('주는 월요일에 시작한다', () => {
  assert.strictEqual(rpWeekStart(new Date('2026/08/21')).getDay(), 1);           // 금 → 그 주 월
  assert.strictEqual(rpWeekStart(new Date('2026/08/17')).getDate(), 17);         // 월 → 자기 자신
  assert.strictEqual(rpWeekStart(new Date('2026/08/16')).getDate(), 10);         // 일 → 전주 월
});

/* ── 3. 백분위 ───────────────────────────────────────────────────────────── */
t('75퍼센타일은 나쁜 쪽 간격을 잡는다', () => {
  assert.strictEqual(rpPercentile([1, 1, 1, 4], 0.75), 1.75);            // 선형보간
  assert.strictEqual(rpPercentile([1, 1, 4, 4], 0.75), 4);
  assert.strictEqual(rpPercentile([7], 0.75), 7);
  assert.strictEqual(rpPercentile([], 0.75), null);
  // 중앙값이었다면 1일 — 주말마다 벌어지는 4일 간격을 못 덮는다
  assert.ok(rpPercentile([1, 1, 1, 4, 1, 1, 1, 4, 1, 4], 0.75) > rpPercentile([1, 1, 1, 4, 1, 1, 1, 4, 1, 4], 0.5));
});

/* ── 4. 사용량 집계 — QR 개별 strip · 진행 주 제외 · LOT 미매칭 제외 ────────── */
const LOTS = [
  ['RM-001-260812-260911-001', 'RM001'],
  ['RM-011-260810-270810-001', 'RM011'],
];
const proc = (used, qty, at, type = 'input') =>
  ['WO-X', '2', '투입', type, used, JSON.stringify({ inputQty: String(qty) }), '', '', '', '', '', at, ''];

t('공정기록 input 을 품목별 주간 사용량으로 모은다', () => {
  const rows = [
    proc('RM-001-260812-260911-001-42,RM-001-260812-260911-001-41', 36.38, '2026-08-13 11:03'), // 8/10 주
    proc('RM-001-260812-260911-001-01', 30, '2026-08-14 9:20'),                                  // 8/10 주(한 자리 시)
    proc('RM-001-260812-260911-001-03', 99, '2026-08-19 10:00'),                                 // 진행 주 → 제외
    proc('RM-011-260810-270810-001-92', 240, '2026-08-13 12:00'),
    proc('없는LOT-001', 500, '2026-08-13 12:00'),                                                // 귀속 불가 → 제외
    proc('RM-001-260812-260911-001-05', 77, '2026-08-13 12:00', 'ccp'),                          // input 아님 → 제외
    proc('RM-001-260812-260911-001-06', 0, '2026-08-13 12:00'),                                  // 0kg → 제외
  ];
  const m = rpWeeklyUse(rows, LOTS, AS_OF);
  const wk = rpWeekStart(new Date('2026/08/13')).getTime();
  near(m.get('RM001').get(wk), 66.38, 0.001, '8/10 주 계란 사용량(36.38+30)');
  assert.strictEqual(m.get('RM001').size, 1, '진행 중인 주가 섞였다');
  near(m.get('RM011').get(wk), 240, 0.001, '믹스 사용량');
  assert.ok(!m.has('없는LOT'), 'LOT 미매칭이 품목으로 새어 들어갔다');
});

t('자재 교체 직후에도 평균이 반토막 나지 않는다 (첫 사용주 이전을 0으로 깔지 않는다)', () => {
  const DAY = 86400000, cur = rpWeekStart(AS_OF).getTime();
  const wm = new Map([[cur - 2 * 7 * DAY, 900], [cur - 1 * 7 * DAY, 960]]);       // 2주 전 첫 사용
  assert.deepStrictEqual([...rpUseSeries(wm, AS_OF)], [900, 960]);
  assert.strictEqual(rpUseSeries(new Map(), AS_OF).length, 0);
});

t('쉰 주는 0으로 채워 평균에 반영된다', () => {
  const DAY = 86400000, cur = rpWeekStart(AS_OF).getTime();
  const wm = new Map([[cur - 3 * 7 * DAY, 300], [cur - 1 * 7 * DAY, 300]]);
  assert.deepStrictEqual([...rpUseSeries(wm, AS_OF)], [300, 0, 300]);
});

/* ── 5. 입고 간격 — 같은 날 여러 건 = 한 번의 보충 ────────────────────────── */
const rcv = (code, at) => ['RCV-X', '원재료', 'V007', code, '계란', 'LOT', '66', 'kg', at, '', '완료'];

t('같은 날 입고 2건은 간격 0 을 만들지 않는다', () => {
  const rows = [
    rcv('RM001', '2026-08-10 9:10'), rcv('RM001', '2026-08-10 15:40'),
    rcv('RM001', '2026-08-11 8:59'), rcv('RM001', '2026-08-14 10:00'),
    rcv('RM006', '2026-08-12 10:00'),                                   // 다른 품목 → 제외
    ['RCV-Y', '소모품', 'V001', 'RM001', '', '', '1', 'kg', '2026-08-13 10:00'],  // 원재료 아님 → 제외
  ];
  assert.deepStrictEqual([...rpReceiptGaps(rows, 'RM001', AS_OF)], [1, 3]);
});

t('관측 창(180일) 밖 입고는 빠진다', () => {
  const rows = [rcv('RM001', '2025-01-02 10:00'), rcv('RM001', '2026-08-10 10:00'), rcv('RM001', '2026-08-17 10:00')];
  assert.deepStrictEqual([...rpReceiptGaps(rows, 'RM001', AS_OF)], [7]);
});

/* ── 6. 산식 — 2026-08-21 실데이터 기준선 ────────────────────────────────── */
const CASES = [
  { code: 'RM001', name: '계란', perUnit: 1.5, leadDays: 1, series:
      [216.98, 180.86, 325.08, 252.48, 252.52, 288.58, 288.66, 144.36, 288.44, 289.06, 289.04, 216.74],
    gaps: [7, 2, 2, 3, 1, 1, 1, 4, 2, 1, 1, 4, 1, 1, 1, 3, 1, 1, 6, 1, 1, 1, 3, 3, 1, 3, 1, 1, 2, 4, 1,
           1, 4, 1, 1, 1, 4, 1, 1, 1, 4, 1, 1, 1, 4, 1, 6, 1, 1, 1, 4, 1, 1, 1, 4, 1, 1, 1, 4, 1, 1, 9],
    expectR: 3, expect: 144, expectUnits: 96 },
  { code: 'RM006', name: '콩기름', perUnit: 18, leadDays: 3, series:
      [73.1, 60.44, 109.98, 85.9, 97.68, 97.84, 97.54, 48.84, 97.8, 97.62, 98.1, 72.96],
    gaps: [13, 13, 8, 2, 11, 34], expectR: 13, expect: 162, expectUnits: 9 },
  { code: 'RM011', name: '전용믹스', perUnit: 10, leadDays: 1, series:
      [480, 960, 840, 960, 960, 960, 480, 960, 960, 960, 720],
    gaps: [1, 6, 11, 7, 7, 7, 8, 6, 7, 7], expectR: 7, expect: 800, expectUnits: 80 },
];

for (const c of CASES) {
  t(`${c.code} ${c.name} → 발주점 ${c.expect}kg (${c.expectUnits}단위)`, () => {
    const r = calcReorderPoint({ series: c.series, gaps: c.gaps, leadDays: c.leadDays, orderCycle: '', perUnit: c.perUnit });
    assert.strictEqual(r.cycleDays, c.expectR, '실측 발주주기(75퍼센타일)');
    assert.strictEqual(r.rounded, c.expect, '포장단위로 올린 발주점');
    assert.strictEqual(Math.round(r.rounded / c.perUnit), c.expectUnits, '포장 개수');
    assert.ok(r.rounded >= r.rop, '올림이 원값보다 작아졌다');
    assert.ok(r.rop > r.daily * r.leadDays, '리드타임 소요량조차 못 덮는 발주점은 알람이 늦는다');
  });
}

t('보호기간 = 리드타임 + 발주주기/2', () => {
  const r = calcReorderPoint({ series: [700, 700, 700, 700], gaps: [7, 7, 7], leadDays: 2, perUnit: 0 });
  assert.strictEqual(r.cycleDays, 7);
  assert.strictEqual(r.protectDays, 5.5);
  assert.strictEqual(r.safety, 0, '변동이 없으면 안전여유도 0');
  assert.strictEqual(r.rounded, Math.ceil(100 * 5.5), '일 100kg × 5.5일');
});

t('실측 간격이 3회 미만이면 마스터 주문주기로 떨어진다', () => {
  const base = { series: [700, 700, 700, 700], leadDays: 1, perUnit: 0 };
  assert.strictEqual(calcReorderPoint({ ...base, gaps: [30, 30], orderCycle: '격일' }).cycleDays, 2);
  assert.strictEqual(calcReorderPoint({ ...base, gaps: [], orderCycle: '격주' }).cycleDays, 14);
  assert.strictEqual(calcReorderPoint({ ...base, gaps: [], orderCycle: '아무거나' }).cycleDays, 7, '모르는 주기는 주간으로');
  assert.strictEqual(calcReorderPoint({ ...base, gaps: [30, 30, 30], orderCycle: '격일' }).cycleDays, 30, '3회 이상이면 실측이 이긴다');
});

t('리드타임 미설정이면 기본 3일', () => {
  assert.strictEqual(calcReorderPoint({ series: [700], gaps: [], leadDays: '', perUnit: 0 }).leadDays, RP_CFG.LEAD_DEFAULT);
  assert.strictEqual(calcReorderPoint({ series: [700], gaps: [], leadDays: 0, perUnit: 0 }).leadDays, RP_CFG.LEAD_DEFAULT);
});

t('사용 이력이 없으면 null — 근거 없는 숫자를 심지 않는다', () => {
  assert.strictEqual(calcReorderPoint({ series: [], gaps: [7, 7, 7], leadDays: 1, perUnit: 10 }), null);
  assert.strictEqual(calcReorderPoint({ series: [0, 0, 0], gaps: [7, 7, 7], leadDays: 1, perUnit: 10 }), null);
});

/* ── 7. 종단 — 원장 행에서 발주점까지 한 번에 ────────────────────────────── */
t('공정기록·입고기록 원본에서 발주점까지 이어진다', () => {
  const DAY = 86400000, cur = rpWeekStart(AS_OF).getTime();
  const wkAgo = n => new Date(cur - n * 7 * DAY + 2 * DAY);                      // 그 주 수요일
  const rows = [1, 2, 3, 4].map(n => proc('RM-011-260810-270810-001-01', 840, `${wkAgo(n).getFullYear()}/${wkAgo(n).getMonth() + 1}/${wkAgo(n).getDate()} 9:30`));
  const rcvRows = [7, 14, 21, 28].map(n => rcv('RM011', new Date(AS_OF - n * DAY).toISOString().slice(0, 10) + ' 8:00'));
  const res = calcReorderPoint({
    series: rpUseSeries(rpWeeklyUse(rows, LOTS, AS_OF).get('RM011'), AS_OF),
    gaps: rpReceiptGaps(rcvRows, 'RM011', AS_OF),
    leadDays: 1, orderCycle: '주간', perUnit: 10,
  });
  assert.strictEqual(res.weeks, 4, '4주가 잡혀야 한다');
  near(res.mu, 840, 0.01, '주 평균');
  assert.strictEqual(res.cycleDays, 7, '실측 주간 납품');
  assert.strictEqual(res.rounded, 540, '일 120kg × 4.5일, 변동 0 → 540kg(54포대)');
});

console.log(ok.map(n => '  ✓ ' + n).join('\n'));
console.log(`\n✅ 발주점 산식 ${ok.length}건 통과`);
