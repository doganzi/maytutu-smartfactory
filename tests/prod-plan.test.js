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
const { planWeekStart, planDate, planPacksPerBox, planSalesEvents, planWeeklySeries, calcProductionPlan, buildPlanChartSeries } = ctx;
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

/* ── 1-2. 마켓봄 연결 — 코드로만, 봉수는 규격 표기 우선 ─────────────────── */
t('봉수/박스 — 품명 규격 표기가 있으면 그걸 쓴다', () => {
  assert.strictEqual(planPacksPerBox({ name: '앙호두 전용반죽(5kg*3ea)', qty: 3, supply: 196365 }), 3);
  assert.strictEqual(planPacksPerBox({ name: '앙호두 전용반죽 (5kg x 4)', qty: 1, supply: 0 }), 4);
});

t('봉수/박스 — 규격 표기가 없는 옛 SKU 는 공급가로 역산한다', () => {
  assert.strictEqual(planPacksPerBox({ name: '앙호두 전용반죽', qty: 1, supply: 86364 }), 4);   // ANG00266
  assert.strictEqual(planPacksPerBox({ name: '앙호두 전용반죽', qty: 1, supply: 94546 }), 4);   // ANG00002(옛 단가)
  assert.strictEqual(planPacksPerBox({ name: '알 수 없음' }), 1, '근거가 없으면 1봉 — 부풀리지 않는다');
});

t('연결은 마켓봄코드로만 — 품명이 비슷한 굿즈가 딸려오지 않는다', () => {
  const rows = [
    { date: '2026-08-10', code: 'ANG00276', name: '앙호두 전용반죽(5kg*3ea)', qty: 2, supply: 130910 },
    { date: '2026-08-10', code: 'ANG00266', name: '앙호두 전용반죽', qty: 1, supply: 86364 },
    { date: '2026-08-10', code: 'ANG00300', name: '앙호두 앞치마', qty: 5, supply: 50000 },
    { date: '2026-08-10', code: 'ANG00223', name: '앙붕어빵 반죽', qty: 3, supply: 240000 },
  ];
  const ev = planSalesEvents(rows, ['ANG00002', 'ANG00266', 'ANG00276']);
  assert.strictEqual(ev.length, 2, '반죽 2행만 잡혀야 한다 — 앞치마·앙붕어빵은 우리 수요가 아니다');
  assert.strictEqual(ev.reduce((s, e) => s + e.packs, 0), 2 * 3 + 1 * 4);
  assert.deepStrictEqual([...planSalesEvents(rows, [])], [], '연결이 비면 아무것도 잡지 않는다(출하로 폴백)');
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

/* ── 3-2. 그래프 시계열 — 과거 역산 + 향후 시뮬레이션 ───────────────────── */
const wkTime = n => planWeekStart(AS_OF).getTime() - n * 7 * DAY;   // n주 전 주 시작
const ev = (weekAgo, packs, dayOffset = 2) => ({ date: new Date(wkTime(weekAgo) + dayOffset * DAY), packs });

t('과거 재고는 현재고에서 역산한다 (재고ᵢ₋₁ = 재고ᵢ − 생산ᵢ + 출하ᵢ)', () => {
  const s = buildPlanChartSeries({
    useEvents: [ev(0, 200), ev(1, 272), ev(2, 248)],       // ev(0)=이번 주 진행분
    prodEvents: [ev(1, 240), ev(2, 320)],
    stockNow: 840, demand: 250, asOf: AS_OF, weeksBack: 2, weeksAhead: 3,
  });
  assert.strictEqual(s.splitIndex, 2, '「지금」 은 과거 2주 뒤');
  // 라벨은 「M월 D일주차」 — 그 주가 시작하는 월요일 날짜(2026-08-03·10·17·24·31·09-07)
  assert.deepStrictEqual([...s.labels], ['8월 3일주차', '8월 10일주차', '8월 17일주차', '8월 24일주차', '8월 31일주차', '9월 7일주차']);
  // 마지막 완결주말 = 840 + 이번주출하 200 − 이번주생산 0 = 1040 · 그 전주 = 1040 − 240 + 272 = 1072
  assert.deepStrictEqual([...s.stock].slice(0, 3), [1072, 1040, 840]);
  assert.deepStrictEqual([...s.use].slice(0, 3), [248, 272, 200], '「지금」 칸에도 진행 중인 주 실적이 들어간다');
  assert.deepStrictEqual([...s.prod].slice(0, 3), [320, 240, 0], '이번 주 생산은 0 — 값이 없을 뿐 null 이 아니다');
});

t('향후 계획 — 목표를 채우는 배치만 만들고, 넘치면 0을 낸다', () => {
  const s = buildPlanChartSeries({
    useEvents: [], prodEvents: [], stockNow: 840, demand: 249.6389,
    asOf: AS_OF, weeksBack: 8, weeksAhead: 6,
  });
  assert.strictEqual(s.labels.length, 15, '과거 8 + 지금 1 + 미래 6');
  assert.strictEqual(s.splitIndex, 8);
  assert.deepStrictEqual([...s.prod].slice(9), [40, 240, 240, 280, 240, 240], '이번 주 남은 소비까지 반영한 계획');
  assert.deepStrictEqual([...s.stock].slice(9), [523, 514, 504, 534, 525, 515]);
  assert.strictEqual(s.safety[0], 499, '안전재고 2주선(봉)');
  assert.strictEqual(s.recBatches, 0, '이번 주 권장 배치');
  assert.strictEqual(s.steadyBatches, 6.2, '안정 구간 배치/주');
  assert.ok(s.stock.slice(10).every(v => v >= s.safety[0]), '계획대로면 안전재고선 아래로 안 떨어진다');
  assert.deepStrictEqual([...s.use].slice(9), [250, 250, 250, 250, 250, 250], '미래 사용량 = 예측 소비');
  assert.strictEqual(s.use[s.splitIndex], 0, '진행 중인 주에 실적이 없으면 0');
});

t('재고가 마른 상태에서 시작하면 첫 주부터 배치가 나온다', () => {
  const s = buildPlanChartSeries({
    useEvents: [], prodEvents: [], stockNow: 200, demand: 250,
    asOf: AS_OF, weeksBack: 4, weeksAhead: 2,
  });
  assert.strictEqual(s.recBatches, 14, '(250×3 − 200) ÷ 40 → 올림 14배치');
  assert.strictEqual(s.recPacks, 560, '화면에 크게 띄우는 값은 «봉»이다');
  assert.ok(s.stock[s.splitIndex + 1] >= s.safety[0], '한 주 만에 안전재고선 위로 올라온다');
});

t('기본 구간은 앞뒤 4주씩 — 예측 관측창(8주)과 별개다', () => {
  const s = buildPlanChartSeries({ useEvents: [], prodEvents: [], stockNow: 840, demand: 249.6389, asOf: AS_OF });
  assert.strictEqual(PLAN_CFG.CHART_BACK, 4);
  assert.strictEqual(PLAN_CFG.CHART_AHEAD, 4);
  assert.strictEqual(s.labels.length, 9, '과거 4 + 지금 1 + 미래 4');
  assert.strictEqual(s.splitIndex, 4);
  assert.strictEqual(s.labels[s.splitIndex], '8월 17일주차', '진행 중인 주(2026-08-17 시작)');
  // 「바로 다음 주」 = 강조 칸. 관측창이 8주 그대로라 예측값은 안 흔들린다.
  assert.strictEqual(s.recIndex, s.splitIndex, '권장은 «이번 주» 칸에 붙는다');
  assert.strictEqual(s.labels[s.recIndex], '8월 17일주차', '권장 칸 = 진행 중인 주');
  assert.strictEqual(s.recPacks, 0, '지금은 재고가 넘쳐 0봉');
  assert.strictEqual(s.prod[s.recIndex], 0, '권장 칸의 막대는 «실적» — 권장은 밴드 수치로 따로 보여준다');
  assert.deepStrictEqual([...s.prod].slice(5), [40, 240, 240, 280], '이번 주 권장(0봉) + 남은 소비를 반영한 4주 계획');
});

t('과거 재고 역산은 0 밑으로 안 내려간다', () => {
  const s = buildPlanChartSeries({
    useEvents: [], prodEvents: [ev(1, 5000)], stockNow: 10, demand: 100,
    asOf: AS_OF, weeksBack: 3, weeksAhead: 1,
  });
  assert.ok(s.stock.every(v => v >= 0), '음수 재고는 그리지 않는다');
});

t('수요가 0이면 그래프를 만들지 않는다 (0으로 나누지 않는다)', () => {
  assert.strictEqual(buildPlanChartSeries({ useEvents: [], prodEvents: [], stockNow: 500, demand: 0, asOf: AS_OF }), null);
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
