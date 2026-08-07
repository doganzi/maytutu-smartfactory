/* DriveDocs.scan() 통합 검증 — 2026-08-07 실측한 `07_공장` 트리를 픽스처로 고정해 돌린다.
   haccp-std.test.js 가 판정(docFindings)만 본다면, 여기서는 그 앞단인 **트리 해석**을 본다:
   배치 조회·소속 귀속·슬롯 분류·회차 폴더 한 겹 더 들어가기.

   실행:  node tests/drive-docs.test.js
   ⚠️ Drive 폴더 구조를 바꾸면 이 픽스처도 같이 고쳐야 한다 — 실물과 갈라지면 통과해도 의미가 없다. */
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const D = 'application/vnd.google-apps.folder';
const dir  = (id, name, parent) => ({ id, name, mimeType: D, parents: [parent] });
const file = (id, name, parent) => ({ id, name, mimeType: 'application/pdf', parents: [parent] });

const FG = '1EsNGO4CZA8ABqOZDBudUJkEv3UeLUaHJ', CALIB = '10OINvKBh7rRxHL-xgUDeJxHlLYut-dNf';
const NODES = [
  // 완제품 > 제품
  dir('mul', '1.물반죽', FG), dir('ang', '2.앙버터 호두과자', FG),
  // 물반죽 > 슬롯
  dir('m1', '1.품목제조보고번호', 'mul'), dir('m2', '2.원재료 시험성적서', 'mul'),
  dir('m3', '3.부재료 시험성적서', 'mul'), dir('m4', '4.물반죽 시험성적서', 'mul'),
  dir('a1', '1.품목제조보고번호', 'ang'),
  // 슬롯 > 파일 / 자재폴더
  file('f1', '식품.식품첨가물 품목제조보고서_202602733083.pdf', 'm1'),
  dir('rm1', '계란', 'm2'), dir('rm2', '콩기름', 'm2'), dir('rm3', '앙브레드전용믹스', 'm2'),
  file('f2', '비닐 시험성적서 26.01.05', 'm3'), file('f3', 'NYLON KCL 시험성적서 2026.pdf', 'm3'),
  file('f4', '시험성적서 26.06.19~26.09.19', 'm4'),
  file('f5', '식품.식품첨가물 품목제조보고서_202602733082.pdf', 'a1'),
  // 자재폴더 > 파일
  file('f6', '계란 시험성적서 ~26년 06 14까지', 'rm1'),
  file('f7', '계란 시험성적서 (1)', 'rm1'), file('f8', '계란 시험성적서 (2)', 'rm1'),
  file('f9', '콩식용유 시험성적서 24.08.08', 'rm2'), file('f10', '콩식용유 시험성적서', 'rm2'),
  file('f11', '앙브레드전용믹스 시험성적서 26.07.14', 'rm3'),
];
// 기계 검교정 > 기기 13 > 회차 2 (회차 폴더는 전부 비어 있음 — 2026-08-07 실측)
const DEVS = ['1.표준온도계','2.적외선온도계','3.표준분동','4.냉동실 데이터로거','5.냉장실 데이터로거',
  '6.저울(1)','7.저울(2)','8.계랑기 저울','9.냉동고 판넬온도계','10.타이머1','11.타이머2','12.타이머3','13.타이머4'];
const DUE = ['27.03.24','27.05.10','28.03.26','27.03.31','27.03.31','27.03.31','27.03.31','27.03.31','27.03.31','27.05.28','27.06.01','27.06.01','27.06.01'];
DEVS.forEach((n, i) => {
  NODES.push(dir('d' + i, n, CALIB));
  NODES.push(dir(`d${i}r1`, '1.자체 검/교정 일자 26.04.01', 'd' + i));
  NODES.push(dir(`d${i}r2`, `2.차기 검/교정 예정 일자 ${DUE[i]}`, 'd' + i));
});

// ── 스텁: q 에서 부모 id 를 뽑아 자식을 돌려준다 ──
let calls = 0;
global.fetch = async (url) => {
  calls++;
  const q = decodeURIComponent(/[?&]q=([^&]*)/.exec(url)[1]);
  const parents = [...q.matchAll(/'([^']+)' in parents/g)].map(m => m[1]);
  return { ok: true, json: async () => ({ files: NODES.filter(n => parents.includes(n.parents[0])) }) };
};
global.State = { token: 'x' };
global.DRIVE = { FG, CALIB };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const slice = (a, b) => SRC.slice(SRC.indexOf(a), SRC.indexOf(b, SRC.indexOf(a)));
const { DriveDocs, HaccpStd } = vm.runInThisContext(
  slice('const CCP = {', 'const DB_SHEETS = {')
  + '\n' + slice('const DOC_SLOTS = [', 'const HS_ESC =')
  + '\n' + slice('const HS_ESC =', '/* ── 화면 ')
  + '\n;({ DriveDocs, HaccpStd })', { filename: 'index.html' });

(async () => {
  const scan = await DriveDocs.scan(true);
  const P = Object.fromEntries(scan.products.map(p => [p.name, p]));
  const S = (p, k) => P[p].slots.find(s => s.key === k);
  const ok = (n, f) => { f(); console.log('  ✓ ' + n); };

  console.log('\n[실측 트리] DriveDocs.scan()');
  ok(`Drive 왕복 ${calls}회 — 폴더 44개를 개별 조회하지 않는다`, () => assert.ok(calls <= 8, `${calls}회`));
  ok('제품 2개 · 번호순', () => assert.deepStrictEqual(scan.products.map(p => p.name), ['1.물반죽', '2.앙버터 호두과자']));

  ok('물반죽 — 4슬롯 전부 보유', () => {
    ['report', 'rm', 'sub', 'fg'].forEach(k => assert.strictEqual(S('1.물반죽', k).state, 'ok', k));
  });
  ok('물반죽 원재료 = 자재 3폴더의 파일 6건이 한 슬롯으로 모인다', () =>
    assert.strictEqual(S('1.물반죽', 'rm').files.length, 6));
  ok('물반죽 부재료 = 슬롯 바로 밑 파일 2건', () =>
    assert.strictEqual(S('1.물반죽', 'sub').files.length, 2));
  ok('빈 자재폴더 없음 (계란·콩기름·앙브레드 모두 채워짐)', () =>
    assert.deepStrictEqual(S('1.물반죽', 'rm').emptySubs, []));

  ok('앙버터 — 품목보고서만 있고 성적서 3슬롯은 폴더 자체가 없음', () => {
    assert.strictEqual(S('2.앙버터 호두과자', 'report').state, 'ok');
    ['rm', 'sub', 'fg'].forEach(k => assert.strictEqual(S('2.앙버터 호두과자', k).state, 'missing', k));
  });

  console.log('\n[실측 트리] 기기 13대');
  ok('13대 번호순 — 10번이 2번 앞에 오지 않는다', () =>
    assert.deepStrictEqual(scan.devices.map(d => d.name).slice(0, 3), ['1.표준온도계', '2.적외선온도계', '3.표준분동']));
  ok('회차 폴더가 한 겹 더 있어도 파일 유무를 정확히 본다 (지금은 전부 비어 있음)', () =>
    assert.ok(scan.devices.every(d => d.state === 'empty')));
  ok('회차 폴더명에서 차기 검교정일을 읽는다', () => {
    assert.strictEqual(scan.devices[0].nextDue, '2027-03-24');
    assert.strictEqual(scan.devices[2].nextDue, '2028-03-26');
  });

  console.log('\n[실측 트리] docFindings — 실제로 무엇이 뜨는가');
  const f = HaccpStd.docFindings({ scan, certs: [], equip: [] });
  const by = k => f.filter(x => x.kind === k).length;
  console.log(`  · 총 ${f.length}건 — 폴더없음 ${by('폴더없음')} · 검교정성적서 ${by('검교정성적서')} · 기기미등록 ${by('기기미등록')}`);
  ok('앙버터 성적서 3슬롯이 지적된다', () => assert.strictEqual(by('폴더없음'), 3));
  ok('기기 13대 성적서 미보관이 전부 지적된다', () => assert.strictEqual(by('검교정성적서'), 13));
  ok('시트가 비면 13대 모두 미등록으로 뜬다', () => assert.strictEqual(by('기기미등록'), 13));
  ok('물반죽은 지적 없음 (오탐 없음)', () =>
    assert.strictEqual(f.filter(x => x.title.includes('물반죽')).length, 0));

  console.log('\n✅ 실측 트리 통합 검증 통과\n');
})();
