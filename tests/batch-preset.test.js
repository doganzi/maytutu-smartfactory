/* 작업지시 배치 프리셋 검증 — index.html 의 <batch-cfg>·<batch-presets> 블록을 그대로 떼어 돌린다.
   (사본을 두면 원본과 갈라져서 통과해도 의미가 없다 — prod-plan.test.js·factory-pnl.test.js 와 같은 방식)

   실행:  node tests/batch-preset.test.js

   기준선 = 2026-09-08 실측. 공정기록 4배치(WO-20260429-002 ~ 0504-001)에서 현장은 목표 무게를 달지 않고
   **믹스 12포대(120kg) · 계란 24판(36kg)** 을 통째로 넣었다(평균 투입 204.64kg). 즉 배치를 정하는 것은
   지시한 봉수가 아니라 **포대 수** 이고, 12포대는 204kg = 40.8봉을 만든다 → 40봉을 담고 **4kg 이 남는다**.
   이 숫자가 바뀌면 산식이 바뀐 것이니, 바뀐 게 의도인지부터 확인할 것.                                    */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ⚠️ 줄바꿈을 LF 로 정규화한 뒤 자른다. 작업 사본은 CRLF(core.autocrlf=true) 인데 CI 체크아웃은 LF 라,
   '\r\n}' 로 함수 끝을 찾으면 CI 에서만 indexOf 가 -1 → 빈 문자열을 잘라 와 «parseSkuUnit is not defined» 로 죽는다.
   (로컬에서만 초록이던 실제 사고 — 2026-09-08) */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
function block(name) {
  const i = SRC.indexOf(`// <${name}>`);
  const j = SRC.indexOf(`// </${name}>`);
  assert.ok(i !== -1 && j > i, `index.html 에서 <${name}> 블록을 찾지 못함`);
  return SRC.slice(i, j);
}
// parseSkuUnit 은 마커가 없는 공용 함수라 선언부만 잘라 온다
const pi = SRC.indexOf('function parseSkuUnit(sku) {');
assert.ok(pi !== -1, 'parseSkuUnit 을 찾지 못함');
const pj = SRC.indexOf('\n}', pi);
assert.ok(pj > pi, 'parseSkuUnit 의 끝을 찾지 못함 — 잘라 온 소스가 비었다');
const parseSkuSrc = SRC.slice(pi, pj + 2);
assert.ok(/return\s*\{/.test(parseSkuSrc), '잘라 온 parseSkuUnit 이 온전하지 않다');

const ctx = vm.createContext({ Math, parseFloat, console });
vm.runInContext(block('batch-cfg') + '\n' + parseSkuSrc + '\n' + block('batch-presets'), ctx);
const batchPresetCalc = vm.runInContext('batchPresetCalc', ctx);
const BATCH_CFG = vm.runInContext('BATCH_CFG', ctx);
const BATCH_PRESET_PACKS = vm.runInContext('BATCH_PRESET_PACKS', ctx);

const ok = [];
const t = (n, f) => { f(); ok.push(n); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);

/* ── 실측 픽스처 — 2026-09-08 라이브 시트에서 눈으로 읽은 값 ─────────────────────────
   SOP레시피 D8/D9/D10/D11 수식 입력줄 = 0.176470588235294 / 동 / 0.588235294117647 / 0.0588235294117647
   원재료품목 sku = 계란 30알/판 · 콩기름 18L/통 · 믹스 10kg/포대
   ⚠️ RM002(물)은 원재료품목에 **행 자체가 없다** — 수도 공급이라 품목 마스터에 안 올린다.        */
const RECIPES = [
  ['SOP-002', 'RM001', '계란', 0.176470588235294, 'kg', '1'],
  ['SOP-002', 'RM002', '물', 0.176470588235294, 'kg', '2'],
  ['SOP-002', 'RM011', '앙브레드호두과자 전용믹스', 0.588235294117647, 'kg', '3'],
  ['SOP-002', 'RM006', '콩기름(대두유)', 0.0588235294117647, 'kg', '4'],
];
// [13] = 매입단가(원/kg). 계란이 최고가라 폐기 손실의 대부분을 차지한다.
const px = (code, name, sku, won) => { const r = [code, name, '', sku, 'kg']; r[13] = won; return r; };
const RM = [
  px('RM001', '계란', '30알/판', 5600),
  px('RM006', '콩기름(대두유)', '18L/통', 2500),
  px('RM011', '앙브레드호두과자 전용믹스', '10kg/포대', 2000),
];
// 반죽 1kg 재료비 = (10×2000 + 3×5600 + 3×0 + 1×2500) / 17
const DOUGH_WON = (10 * 2000 + 3 * 5600 + 3 * 0 + 1 * 2500) / 17;   // 2311.76…
const packOf = (c, code) => c.lines.find(l => l.code === code)?.pack;
const kgOf = (c, code) => c.lines.find(l => l.code === code)?.kg;

/* ── 1. 상수 — 되돌려지면 여기서 걸린다 ─────────────────────────────────────── */
t('안전계수는 1.00 이다 (옛 1.01 은 근거 없는 관행이었고 잔량 0 조합을 지웠다)', () => {
  assert.strictEqual(BATCH_CFG.YIELD_FACTOR, 1.00);
});
t('반죽기 상한은 300kg 이다 (520L 설비. 옛 350kg 은 설비보다 컸다)', () => {
  assert.strictEqual(BATCH_CFG.MIXER_KG, 300);
});
t('프리셋은 51·54·57봉 — 반죽기 300kg 안에서 「봉수↑·폐기↓」 파레토 집합', () => {
  // vm 밖으로 나온 배열은 프로토타입이 달라 deepStrictEqual 이 실패한다 — 값으로 본다
  assert.strictEqual(Array.from(BATCH_PRESET_PACKS).join(','), '51,54,57');
});
t('프리셋 3종은 실제로 파레토다 — 반죽기 안의 어떤 포대수도 이들을 양쪽에서 이기지 못한다', () => {
  const cand = [];
  for (let u = 1; u <= 20; u++) {
    const inKg = u * 10 * 17 / 10;
    if (inKg > BATCH_CFG.MIXER_KG) break;
    cand.push({ bags: Math.floor(inKg / 5), waste: inKg - Math.floor(inKg / 5) * 5 });
  }
  const par = cand.filter(a => !cand.some(b => b !== a && b.bags >= a.bags && b.waste <= a.waste
    && (b.bags > a.bags || b.waste < a.waste))).map(x => x.bags).sort((x, y) => x - y);
  assert.strictEqual(par.join(','), '51,54,57', `실제 파레토=${par.join(',')}`);
});
t('현행 40봉은 51봉에 봉수·폐기 양쪽에서 밀린다', () => {
  const a = batchPresetCalc(40, RECIPES, RM), b = batchPresetCalc(51, RECIPES, RM);
  assert.ok(b.bags > a.bags && b.leftoverKg < a.leftoverKg,
    `40봉(${a.bags}봉/${a.leftoverKg}kg) vs 51봉(${b.bags}봉/${b.leftoverKg}kg)`);
});

/* ── 2. 현행 40봉 — 공정기록 실측과 일치해야 한다 ───────────────────────────── */
t('40봉 → 믹스 12포대 · 총 204kg · 40.8봉 · 봉에 안 담기는 양 4.0kg', () => {
  const c = batchPresetCalc(40, RECIPES, RM);
  assert.strictEqual(c.units, 12, '실측 4배치 전건이 12포대였다');
  near(c.totalIn, 204, 0.01, '총 투입');
  near(c.realBags, 40.8, 0.01, '실제 나오는 봉수');
  near(c.leftoverKg, 4.0, 0.01, '봉에 안 담기는 양');
});
t('40봉의 계란은 24판 — 실측 투입 35.98~36.72kg 과 맞는다', () => {
  const c = batchPresetCalc(40, RECIPES, RM);
  assert.strictEqual(packOf(c, 'RM001'), '24판');
  near(kgOf(c, 'RM001'), 36, 0.01, '계란 kg');
});
t('물은 품목 마스터에 없으므로 포장 표기가 없고 kg 로만 나온다', () => {
  const c = batchPresetCalc(40, RECIPES, RM);
  assert.strictEqual(packOf(c, 'RM002'), null);
  near(kgOf(c, 'RM002'), 36, 0.01, '물 kg');
});
t('콩기름 12kg 은 18L/통 의 정수배가 아니라 통 표기가 붙지 않는다', () => {
  assert.strictEqual(packOf(batchPresetCalc(40, RECIPES, RM), 'RM006'), null);
});

/* ── 3. 47봉·51봉 ──────────────────────────────────────────────────────────── */
t('47봉 → 14포대 · 238kg · 47.6봉 · 3.0kg 남음 · 계란 28판', () => {
  const c = batchPresetCalc(47, RECIPES, RM);
  assert.strictEqual(c.units, 14);
  near(c.totalIn, 238, 0.01, '총 투입');
  near(c.leftoverKg, 3.0, 0.01, '남는 양');
  assert.strictEqual(packOf(c, 'RM001'), '28판');
});
t('51봉 → 15포대 · 255kg · 정확히 51.0봉 · 남는 양 0 · 계란 30판', () => {
  const c = batchPresetCalc(51, RECIPES, RM);
  assert.strictEqual(c.units, 15);
  near(c.totalIn, 255, 0.001, '총 투입');
  near(c.realBags, 51, 0.001, '실제 봉수');
  near(c.leftoverKg, 0, 0.001, '남는 양은 0 이어야 한다');
  assert.strictEqual(packOf(c, 'RM001'), '30판');
});
t('54봉 → 16포대 · 272kg · 2.0kg 폐기 / 57봉 → 17포대 · 289kg · 4.0kg 폐기', () => {
  const a = batchPresetCalc(54, RECIPES, RM), b = batchPresetCalc(57, RECIPES, RM);
  assert.strictEqual(a.units, 16); near(a.totalIn, 272, 0.01, '54봉 투입'); near(a.leftoverKg, 2.0, 0.01, '54봉 폐기');
  assert.strictEqual(b.units, 17); near(b.totalIn, 289, 0.01, '57봉 투입'); near(b.leftoverKg, 4.0, 0.01, '57봉 폐기');
  assert.strictEqual(a.overMixer, false); assert.strictEqual(b.overMixer, false);
});
t('프리셋 3종 중 51봉만 폐기 0 이다', () => {
  const left = Array.from(BATCH_PRESET_PACKS).map(b => batchPresetCalc(b, RECIPES, RM).leftoverKg);
  assert.strictEqual(left.map(v => v < 0.05).join(','), 'true,false,false');
});

/* ── 폐기 원가 — 계란이 가장 비싸므로 이 금액이 곧 계란 손실이다 ─────────────── */
t('폐기 원가 = 폐기kg × 반죽 1kg 재료비 (2,311.8원)', () => {
  near(batchPresetCalc(40, RECIPES, RM).wasteCost, 4 * DOUGH_WON, 1, '40봉 폐기 원가');
  near(batchPresetCalc(54, RECIPES, RM).wasteCost, 2 * DOUGH_WON, 1, '54봉');
  near(batchPresetCalc(57, RECIPES, RM).wasteCost, 4 * DOUGH_WON, 1, '57봉');
  // 51봉의 폐기는 부동소수점 잔재(1e-11 수준)라 정확히 0 은 아니다 — 화면 판정선(0.05kg)보다 훨씬 작으면 된다
  near(batchPresetCalc(51, RECIPES, RM).wasteCost, 0, 1, '51봉 폐기 원가');
});
t('계란이 반죽 재료비의 43% — 폐기 손실의 최대 항목이다', () => {
  const eggShare = (3 * 5600 / 17) / DOUGH_WON;
  near(eggShare, 0.43, 0.01, '계란 비중');
  assert.ok(eggShare > (10 * 2000 / 17) / DOUGH_WON / 1.3, '계란이 단일 최고가 원료 축이어야 한다');
});
t('매입단가가 비어 있으면 hasPrice=false 로 알린다 (조용히 0원으로 속이지 않는다)', () => {
  const noPx = RM.map(r => { const c = [...r]; c[13] = ''; return c; });
  const c = batchPresetCalc(40, RECIPES, noPx);
  assert.strictEqual(c.hasPrice, false);
  assert.strictEqual(c.wasteCost, 0);
});

/* ── 4. 반죽기 한계 ────────────────────────────────────────────────────────── */
t('68봉(340kg)은 반죽기 300kg 를 넘어 overMixer 로 잡힌다', () => {
  const c = batchPresetCalc(68, RECIPES, RM);
  near(c.totalIn, 340, 0.01, '총 투입');
  assert.strictEqual(c.overMixer, true);
});
t('51봉은 반죽기 안에 들어간다 (85%)', () => {
  const c = batchPresetCalc(51, RECIPES, RM);
  assert.strictEqual(c.overMixer, false);
  near(c.fill, 0.85, 0.005, '충전율');
});

/* ── 5. 변이 검사 — 이 단언들이 실제로 무는지 확인한다 ───────────────────────
   (기능을 지워도 초록인 테스트를 여러 번 만들었다 — 여기서는 입력을 일부러 틀리게 해서
    결과가 «달라지는지» 를 본다. 안 달라지면 그 단언은 아무것도 안 보고 있는 것이다.)   */
t('변이① 배합비를 옛 «표시값» 0.588 로 낮추면 51봉의 잔량 0 이 깨진다', () => {
  const mut = RECIPES.map(r => r[1] === 'RM011' ? [...r.slice(0, 3), 0.588, ...r.slice(4)] : r);
  const c = batchPresetCalc(51, mut, RM);
  assert.ok(c.leftoverKg > 0.05,
    `0.588 로도 잔량이 0 이면 이 테스트는 배합비를 안 보고 있다 (leftover=${c.leftoverKg})`);
});
t('변이② 안전계수를 1.01 로 되돌리면 51봉이 16포대로 튀고 잔량이 커진다', () => {
  const c2 = vm.createContext({ Math, parseFloat, console });
  vm.runInContext(
    block('batch-cfg').replace('YIELD_FACTOR: 1.00', 'YIELD_FACTOR: 1.01') + '\n' + parseSkuSrc + '\n' + block('batch-presets'), c2);
  const c = vm.runInContext('batchPresetCalc', c2)(51, RECIPES, RM);
  assert.strictEqual(c.units, 16, '1.01 이면 15포대로 안 떨어진다');
  assert.ok(c.leftoverKg > 15, `잔량이 커져야 한다 (leftover=${c.leftoverKg})`);
});
t('변이③ 믹스 포장을 20kg/포대 로 바꾸면 포대 수가 바뀐다', () => {
  const mut = RM.map(i => i[0] === 'RM011' ? [...i.slice(0, 3), '20kg/포대', ...i.slice(4)] : i);
  const a = batchPresetCalc(40, RECIPES, RM).units;
  const b = batchPresetCalc(40, RECIPES, mut).units;
  assert.notStrictEqual(a, b, '포장규격을 바꿔도 포대 수가 같으면 sku 를 안 읽고 있는 것이다');
  assert.strictEqual(b, 6);
});
t('변이④ 주 자재를 코드로 박지 않았다 — 믹스 코드를 RM999 로 바꿔도 같은 답', () => {
  const mutR = RECIPES.map(r => r[1] === 'RM011' ? [r[0], 'RM999', ...r.slice(2)] : r);
  const mutI = RM.map(i => i[0] === 'RM011' ? ['RM999', ...i.slice(1)] : i);
  const c = batchPresetCalc(51, mutR, mutI);
  assert.strictEqual(c.units, 15);
  near(c.leftoverKg, 0, 0.001, '남는 양');
});

/* ── 6. 방어 ───────────────────────────────────────────────────────────────── */
t('레시피가 비었거나 주 자재 sku 가 없으면 null 을 돌려주고 안 터진다', () => {
  assert.strictEqual(batchPresetCalc(40, [], RM), null);
  assert.strictEqual(batchPresetCalc(40, RECIPES, []), null);
  assert.strictEqual(batchPresetCalc(40, [['S', 'RMX', '무비중', '', 'kg', '1']], RM), null);
});

console.log(ok.map(n => '  ✓ ' + n).join('\n'));
console.log(`\n✅ 배치 프리셋 ${ok.length}건 통과`);
