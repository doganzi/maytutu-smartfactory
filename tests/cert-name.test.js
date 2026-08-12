/* 성적서 등록 시 품목명 기본값 — index.html 의 실제 판정식을 그대로 떼어 돌린다.
   실사고: 클립보드/카톡 사진의 파일명이 전부 `image.jpg` 라 「image」라는 성적서가 3건 등록됐다(2026-08-07).
   실행: node tests/cert-name.test.js                                                     */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = SRC.indexOf('const CERT_JUNK_NAME');
assert.notStrictEqual(i, -1, 'CERT_JUNK_NAME 을 찾지 못함');
vm.runInThisContext(SRC.slice(i, SRC.indexOf('\n', i)), { filename: 'index.html#CERT_JUNK_NAME' });

// scan 이 넘겨주는 slot·product 모양 그대로
const guess = (slot, product, fileName) => {
  const fromFile = (fileName || '').replace(/\.[^.]+$/, '').trim();
  return slot.key === 'fg' ? String(product.name || '').replace(/^\s*\d+\s*\.\s*/, '').trim()
       : (CERT_JUNK_NAME.test(fromFile) ? '' : fromFile);
};
const FG = { key: 'fg' }, RM = { key: 'rm' }, P = { name: '2.앙버터 호두과자' };
const ok = [];
const t = (n, f) => { f(); ok.push(n); };

t('완제품 성적서는 제품명이 기본값 — 파일명을 보지 않는다', () => {
  assert.strictEqual(guess(FG, P, 'image.jpg'), '앙버터 호두과자');
  assert.strictEqual(guess(FG, P, '아무거나.pdf'), '앙버터 호두과자');
  assert.strictEqual(guess(FG, { name: '1.물반죽' }, 'image (2).jpg'), '물반죽');
});

t('쓸모없는 파일명은 비워 둔다 — 실제로 등록됐던 image 3건이 여기 걸린다', () => {
  ['image.jpg', 'image (1).jpg', 'image (2).png', 'IMG_1234.jpg', 'Screenshot 2026-08-07.png',
   '사진.jpg', '무제.pdf', 'KakaoTalk_20260807.jpg', 'TalkFile_.pdf', 'scan001.pdf']
    .forEach(n => assert.strictEqual(guess(RM, P, n), '', `${n} 이 품목명으로 새면 안 된다`));
});

t('뜻이 있는 파일명은 그대로 살린다', () => {
  assert.strictEqual(guess(RM, P, '앙브레드전용믹스 시험성적서 26.07.14.png'), '앙브레드전용믹스 시험성적서 26.07.14');
  assert.strictEqual(guess(RM, P, '계란 시험성적서.pdf'), '계란 시험성적서');
  assert.strictEqual(guess(RM, P, '버터 — 앵커버터 수입면장 260521.pdf'), '버터 — 앵커버터 수입면장 260521');
});

console.log(ok.map(n => '  ✓ ' + n).join('\n'));
console.log(`\n✅ 성적서 품목명 ${ok.length}건 통과`);
