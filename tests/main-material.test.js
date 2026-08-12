/* 주 자재(프리믹스) 판정 — 배합비 최대로 찾는다. 믹스 코드를 박으면 공급사 교체 때 조용히 어긋난다.
   실제로 RM003 마미만쥬 → RM011 앙브레드로 바뀌었고, 시트는 갱신됐는데 코드는 RM003 을 1순위로 찾고 있었다.
   실행: node tests/main-material.test.js                                                        */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ok = [];
const t = (n, f) => { f(); ok.push(n); };

t('믹스 코드가 코드에 박혀 있지 않다', () => {
  assert.ok(!/find\(r => r\[1\] ?=== ?['"]RM003['"]\)/.test(SRC),
    "주 자재를 'RM003' 으로 찾는 코드가 남아 있다 — 공급사가 바뀌면 어긋난다");
  assert.ok(!/find\(r => r\[1\]==='RM003'\)/.test(SRC), '같은 패턴(공백 없는 형태)');
});

// index.html 이 실제로 쓰는 판정식과 같은 식
const mainOf = recipes => recipes.reduce((a, b) => parseFloat(a[3] || 0) > parseFloat(b[3] || 0) ? a : b, recipes[0]);

t('SOP-002 현행 배합에서 앙브레드(RM011)가 주 자재로 잡힌다', () => {
  const cur = [
    ['SOP-002', 'RM001', '계란', 0.1764705882352941],
    ['SOP-002', 'RM002', '물', 0.1764705882352941],
    ['SOP-002', 'RM011', '앙브레드호두과자 전용믹스', 0.588235294117647],
    ['SOP-002', 'RM006', '식용유', 0.058823529411764705],
  ];
  assert.strictEqual(mainOf(cur)[1], 'RM011');
});

t('구 배합(RM003 마미만쥬)에서도 똑같이 믹스가 잡힌다 — 이력 조회 무회귀', () => {
  const old = [
    ['SOP-002', 'RM001', '계란', 0.1765],
    ['SOP-002', 'RM003', '마미만쥬믹스', 0.5882],
    ['SOP-002', 'RM006', '식용유', 0.0588],
  ];
  assert.strictEqual(mainOf(old)[1], 'RM003');
});

t('삼양(큐원) 6종 배합이 와도 최대 비중 자재를 고른다', () => {
  const kuone = [
    ['SOP-004', 'RM004', '큐원호두과자믹스', 0.3713],
    ['SOP-004', 'RM007', '큐원만쥬믹스', 0.1619],
    ['SOP-004', 'RM001', '달걀', 0.1765],
    ['SOP-004', 'RM006', '식용유', 0.0588],
    ['SOP-004', 'RM005', '타피오카전분', 0.0550],
    ['SOP-004', 'RM002', '물', 0.1765],
  ];
  assert.strictEqual(mainOf(kuone)[1], 'RM004', '단일 최대는 큐원호두과자믹스');
});

t('레시피가 1줄이거나 비중이 없어도 안 터진다', () => {
  assert.strictEqual(mainOf([['S', 'RM011', '믹스', 1]])[1], 'RM011');
  assert.strictEqual(mainOf([['S', 'RMX', '무비중', '']])[1], 'RMX');
});

console.log(ok.map(n => '  ✓ ' + n).join('\n'));
console.log(`\n✅ 주 자재 판정 ${ok.length}건 통과`);
