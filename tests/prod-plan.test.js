/* 주간 생산량 제안 검증 — index.html 의 <prod-plan> 블록을 그대로 떼어 돌린다.
   (사본을 두면 원본과 갈라져서 통과해도 의미가 없다 — factory-pnl.test.js 와 같은 방식)

   실행:  node tests/prod-plan.test.js
   기준선: 2026-08-21 실데이터 — 마켓봄 실판매 8주 [288,292,284,196,226,241,249,270],
           재고 760봉 + 냉동중 80봉 → 예측 소비 249.6봉/주 · 3.36주치 · 권장 0배치.
           이 숫자가 바뀌면 산식이 바뀐 것이니, 바뀐 게 의도인지부터 확인할 것.        */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = SRC.indexOf('// <prod-plan>');
const j = SRC.indexOf('// </prod-plan>');
assert.ok(i !== -1 && j > i, 'index.html 에서 <prod-plan> 블록을 찾지 못함');
const ctx = vm.createContext({ Math, Date, Map, Set, parseFloat, isFinite, console });
vm.runInContext(SRC.slice(i, j), ctx);
const { planWeekStart, planDate, planWeeklySeries, calcProductionPlan } = ctx;
const PLAN_CFG = vm.runInContext('PLAN_CFG', ctx);   // const 는 컨텍스트 객체에 안 붙는다

const ok = [];
const t = (n, f) => { f(); ok.push(n); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);

const AS_OF = new Date('2026/08/21 15:00');          // 금요일 — 진행 중인 주는 08/17 시작
const DAY = 86400000;

/* ── 1. 날짜·주 경계 ──────────────────────────────────────────────────────── */
t('시트 날짜의 한 자리 시각도 파싱된다', () => {
  assert.ok(planDate('2026-08-21 8:59'), '한 자리 시(8:59)가 버려졌다');
  assert.strictEqual(planDate('2026-08-21').getDate(), 21);
  assert.strictEqual(planDate(''), null);
  assert.strictEqual(planDate('없는날짜'), null);
});

t('주는 월요일에 시작한다', () => {
  assert.strictEqual(planWeekStart(new Date('2026/08/21')).getDay(), 1);
  assert.strictEqual(planWeekStart(new Date('2026/08/17')).getDate(), 17);
  assert.strictEqual(planWeekStart(new Date('2026/08/16')).getDate(), 10);   // 일 → 전주 월
});

/* ── 2. 주간 시계열 — 진행 주 제외 · 빈 주 0 ────────────────────────────── */
t('진행 중인 주는 빠지고, 안 판 주는 0 으로 채워진다', () => {
  const ser = planWeeklySeries([
    { date: '2026-07-29', packs: 100 },                    // 07/27 주
    { date: '2026-07-30', packs: 40 },                     // 07/27 주 (합산)
    // 08/03 주 = 판매 없음 → 0
    { date: '2026-08-11 9:30', packs: 60 },                // 08/10 주
    { date: '2026-08-19', packs: 999 },                    // 진행 주 → 제외
    { date: '없는날짜', packs: 10 },
    { date: '2026-08-11', packs: 0 },                      // 0봉 → 무시
  ], AS_OF);
  assert.deepStrictEqual([...ser].map(x => x.packs), [140, 0, 60]);
  assert.strictEqual(planWeeklySeries([], AS_OF).length, 0);
});

/* ── 3. 산식 — 2026-08-21 실데이터 기준선 ───────────────────────────────── */
const REAL = [288, 292, 284, 196, 226, 241, 249, 270];     // 마켓봄 실판매(봉) 06/22~08/10
const ser = REAL.map((packs, k) => ({ week: k, packs }));

t('실데이터 기준선 — 예측 249.6봉/주 · 3.36주치 · 권장 0배치', () => {
  const p = calcProductionPlan({ series: ser, stock: 760, pending: 80 });
  assert.strictEqual(p.weeks, 8);
  near(p.demand, 249.64, 0.01, '선형가중 예측 소비');
  near(p.mean, 255.75, 0.01, '단순평균(참고)');
  assert.ok(p.demand < p.mean, '판매가 줄고 있으면 가중평균이 단순평균보다 낮아야 한다');
  near(p.trend, -0.0698, 0.0005, '최근 4주 대 직전 4주');
  assert.strictEqual(p.avail, 840);
  near(p.weeksOnHand, 3.365, 0.001, '주치');
  near(p.target, 748.92, 0.01, '목표 = 3D');
  assert.strictEqual(p.need, 0, '재고가 목표보다 많으면 부족분 0');
  assert.strictEqual(p.batches, 0, '넘치면 0배치가 정답 — 늘 만들라고 하면 과잉재고가 굳는다');
  near(p.surplus, 91.08, 0.01, '목표 대비 여유');
  near(p.safetyLine, 499.28, 0.01, '안전재고 2주선');
  near(p.daysToSafety, 9.55, 0.01, '2주선까지 남은 일수');
  assert.strictEqual(p.balanceBatches, 6.2, '소비만큼 만들면 6.2배치');
});

t('재고가 마르면 배치 수가 나온다 (같은 수요, 재고만 300봉)', () => {
  const p = calcProductionPlan({ series: ser, stock: 300, pending: 0 });
  near(p.need, 448.92, 0.01, '부족분');
  assert.strictEqual(p.batches, 12, '448.9봉 ÷ 40봉 → 올림 12배치');
  assert.strictEqual(p.produce, 480);
  assert.ok(p.produce >= p.need, '배치 올림이 부족분을 못 덮으면 안 된다');
  assert.strictEqual(p.daysToSafety, 0, '이미 안전재고선 아래');
});

t('부족분이 배치 1개에 못 미쳐도 1배치는 나온다', () => {
  const p = calcProductionPlan({ series: ser, stock: 740, pending: 0 });
  assert.ok(p.need > 0 && p.need < PLAN_CFG.BATCH_PACKS);
  assert.strictEqual(p.batches, 1);
});

t('냉동보관중 물량은 가용재고로 친다 — 12시간 뒤 출하 가능', () => {
  const a = calcProductionPlan({ series: ser, stock: 600, pending: 0 });
  const b = calcProductionPlan({ series: ser, stock: 600, pending: 160 });
  assert.strictEqual(b.avail - a.avail, 160);
  assert.ok(b.batches < a.batches, '냉동중 물량을 빼먹으면 있는 재고를 또 만든다');
});

t('안전재고 주수·배치 크기는 밖에서 바꿀 수 있다', () => {
  const p = calcProductionPlan({ series: ser, stock: 0, pending: 0, safetyWeeks: 1, batchPacks: 100 });
  near(p.target, 499.28, 0.01, '1주 안전재고 + 다음 주 소비');
  assert.strictEqual(p.batches, 5);
  assert.strictEqual(p.produce, 500);
});

t('관측 창은 최근 8주만 — 그 앞은 계획에 끼지 않는다', () => {
  const long = [900, 900, 900, 900].concat(REAL).map((packs, k) => ({ week: k, packs }));
  const p = calcProductionPlan({ series: long, stock: 760, pending: 80 });
  assert.strictEqual(p.weeks, PLAN_CFG.WEEKS);
  near(p.demand, 249.64, 0.01, '두 달 전 성수기가 예측을 끌어올리면 안 된다');
});

t('추세는 8주가 안 되면 안 낸다 (없는 근거를 지어내지 않는다)', () => {
  const short = [200, 220, 240].map((packs, k) => ({ week: k, packs }));
  assert.strictEqual(calcProductionPlan({ series: short, stock: 0, pending: 0 }).trend, null);
});

t('판매 이력이 없으면 null — 감으로 배치를 뽑지 않는다', () => {
  assert.strictEqual(calcProductionPlan({ series: [], stock: 500, pending: 0 }), null);
  assert.strictEqual(calcProductionPlan({ series: [{ week: 1, packs: 0 }], stock: 500, pending: 0 }), null);
});

/* ── 4. 종단 — 원본 판매행에서 배치까지 ─────────────────────────────────── */
t('마켓봄 판매행에서 배치 수까지 이어진다', () => {
  const cur = planWeekStart(AS_OF).getTime();
  const rows = REAL.map((packs, k) => ({ date: new Date(cur - (8 - k) * 7 * DAY + 2 * DAY), packs }));
  const p = calcProductionPlan({ series: planWeeklySeries(rows, AS_OF), stock: 760, pending: 80 });
  assert.strictEqual(p.weeks, 8);
  near(p.demand, 249.64, 0.01, '주 귀속이 어긋나면 여기서 틀어진다');
  assert.strictEqual(p.batches, 0);
});

console.log(ok.map(n => '  ✓ ' + n).join('\n'));
console.log(`\n✅ 생산량 제안 ${ok.length}건 통과`);
