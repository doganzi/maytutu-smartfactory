/* 유틸리티 클래스 정합성 — 「화면에서 쓰는 fs-N · mt-N · mb-N · ml-N 이 CSS 에 전부 정의돼 있는가」

   왜 있나 (2026-09-08): `.fs-10` 이 **정의 없이 25곳에서 쓰이고** 있었다. 정의가 없으면 오류가 안 나고
   부모 글씨 크기를 그대로 물려받기 때문에, 「작게」 의도한 각주가 본문 크기로 커져도 아무도 모른다.
   전수로 훑어보니 `.mt-2`(26곳)·`.mb-6`(7곳)·`.ml-4`·`.fs-15`·`.fs-18`·`.fs-22`·`.mt-6`·`.mb-2`
   까지 **8종 42곳**이 같은 상태였다. 눈으로는 «좀 이상한데» 로만 보이고 콘솔에도 안 찍힌다.

   실행:  node tests/css-utilities.test.js                                                         */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 줄바꿈은 LF 로 정규화한다 — 작업 사본은 CRLF, CI 체크아웃은 LF 라 자르기가 갈린다
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const STYLE = (SRC.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
assert.ok(STYLE.length > 5000, `<style> 을 못 찾았거나 너무 작다 (${STYLE.length}자)`);

/** CSS 에 정의된 클래스 이름 (선택자 안의 `.foo`) */
function definedClasses(css) {
  const out = new Set(); let m;
  const re = /\.([a-z][a-z0-9-]*)\s*(?=[{,:])/g;
  while ((m = re.exec(css))) out.add(m[1]);
  return out;
}
/** class="..." 에서 실제로 쓰인 클래스. 템플릿 보간(`${...}`)이 섞인 토큰은 정적으로 못 읽으니 뺀다 */
function usedClasses(src) {
  const out = new Map(); let m;
  const re = /class="([^"]*)"/g;
  while ((m = re.exec(src))) {
    for (const c of m[1].split(/\s+/)) {
      if (!c || c.includes('$') || c.includes('{')) continue;
      out.set(c, (out.get(c) || 0) + 1);
    }
  }
  return out;
}
const UTIL = /^(fs|mt|mb|ml|mr|pt|pb|pl|pr|gap)-\d+$/;   // 숫자 접미 유틸리티 계열만 본다

const ok = [];
const t = (n, f) => { f(); ok.push(n); };

t('쓰이는 유틸리티 클래스가 CSS 에 전부 정의돼 있다', () => {
  const def = definedClasses(STYLE);
  const miss = [...usedClasses(SRC)].filter(([c]) => UTIL.test(c) && !def.has(c))
    .sort((a, b) => b[1] - a[1]).map(([c, n]) => `.${c}(${n}곳)`);
  assert.strictEqual(miss.length, 0,
    `정의 없이 쓰이는 유틸리티: ${miss.join(', ')}\n` +
    '  → 정의가 없으면 오류 없이 «부모 값 상속» 으로 조용히 어긋난다. CSS 유틸리티 줄에 추가할 것.');
});

t('fs-N 의 기본 글자 크기는 N px 이다 (스케일 규약)', () => {
  // 미디어쿼리 밖(기본)만 본다 — 소형 화면은 일부러 키운다(fs-11: 11→12→13px)
  const base = STYLE.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  const bad = [];
  let m; const re = /\.fs-(\d+)\s*\{[^}]*font-size:\s*(\d+)px/g;
  while ((m = re.exec(base))) if (m[1] !== m[2]) bad.push(`.fs-${m[1]} = ${m[2]}px`);
  assert.strictEqual(bad.length, 0, `fs-N ≠ Npx: ${bad.join(', ')}`);
});

t('mt-N / mb-N / ml-N 의 여백은 N px 이다', () => {
  const base = STYLE.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  const bad = [];
  let m; const re = /\.(mt|mb|ml|mr)-(\d+)\s*\{[^}]*margin-(top|bottom|left|right):\s*(\d+)px/g;
  while ((m = re.exec(base))) if (m[2] !== m[4]) bad.push(`.${m[1]}-${m[2]} = ${m[4]}px`);
  assert.strictEqual(bad.length, 0, `여백 N ≠ Npx: ${bad.join(', ')}`);
});

t('2026-09-08 에 채운 8종이 실제로 정의돼 있다', () => {
  const def = definedClasses(STYLE);
  const added = ['fs-10', 'fs-15', 'fs-18', 'fs-22', 'mt-2', 'mt-6', 'mb-2', 'mb-6', 'ml-4'];
  const miss = added.filter(c => !def.has(c));
  assert.strictEqual(miss.length, 0, `사라진 정의: ${miss.join(', ')}`);
});

/* ── 변이 검사 — 이 테스트가 실제로 무는지 확인한다 ────────────────────────── */
t('변이① 정의를 지우면 1번 검사가 실패한다', () => {
  // ⚠️ 한 줄만 지우면 안 된다 — fs-10 은 미디어쿼리에도 정의돼 있어 여전히 «정의됨» 으로 잡힌다.
  //    (이 변이를 약하게 짰다가 여기서 걸렸다 — 변이 검사는 이런 걸 잡으라고 있는 것이다.)
  const mutStyle = STYLE.replace(/\.fs-10\s*\{[^}]*\}/g, '');
  assert.ok(!/\.fs-10\s*\{/.test(mutStyle), '변이가 실제로 적용돼야 한다');
  const def = definedClasses(mutStyle);
  const miss = [...usedClasses(SRC)].filter(([c]) => UTIL.test(c) && !def.has(c));
  assert.ok(miss.length > 0, '정의를 지웠는데도 «전부 정의됨» 이면 이 검사는 아무것도 안 보고 있다');
});

t('변이② 크기를 규약과 다르게 바꾸면 2번 검사가 실패한다', () => {
  const mutStyle = STYLE.replace('.fs-10 { font-size:10px; }', '.fs-10 { font-size:9px; }');
  const base = mutStyle.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  const bad = []; let m; const re = /\.fs-(\d+)\s*\{[^}]*font-size:\s*(\d+)px/g;
  while ((m = re.exec(base))) if (m[1] !== m[2]) bad.push(m[1]);
  assert.ok(bad.includes('10'), '규약 위반을 못 잡으면 2번 검사는 무의미하다');
});

t('변이③ 클래스 추출기가 템플릿 보간을 정말로 걸러낸다', () => {
  const u = usedClasses('<div class="fs-11 badge-${type} c-txt-l">x</div>');
  assert.ok(u.has('fs-11') && u.has('c-txt-l'), '정적 클래스는 잡아야 한다');
  assert.ok(![...u.keys()].some(c => c.includes('$')), '보간 토큰은 빼야 한다');
});

console.log(ok.map(n => '  ✓ ' + n).join('\n'));
console.log(`\n✅ CSS 유틸리티 정합성 ${ok.length}건 통과`);
