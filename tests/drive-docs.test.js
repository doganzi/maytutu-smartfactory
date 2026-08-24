/* DriveDocs.scan() 통합 검증 — 2026-08-24 실측한 `07_공장` 트리를 픽스처로 고정해 돌린다.
   haccp-std.test.js 가 판정(docFindings)만 본다면, 여기서는 그 앞단인 **트리 해석**을 본다:
   배치 조회·소속 귀속·슬롯 분류·회차 폴더 한 겹 더 들어가기.

   실행:  node tests/drive-docs.test.js
   ⚠️ Drive 폴더 구조를 바꾸면 이 픽스처도 같이 고쳐야 한다 — 실물과 갈라지면 통과해도 의미가 없다.

   🚨 **픽스처는 «앱 화면» 이 아니라 «Drive» 를 보고 적어야 한다.** (2026-08-24 · 건의 FR-20260824-71S)
      옛 픽스처는 회차 폴더를 전부 비워 두고 「2026-08-07 실측 · 전부 비어 있음」이라고 적어 뒀는데,
      실제 Drive 에는 그때도 기기 13대에 검교정 사진이 **전부 들어 있었다**(파일 날짜 26.03~26.06).
      비어 보였던 건 아래 `fetch` 스텁이 흉내 내는 Drive API 함정 때문이고, 그 잘못된 관측이
      픽스처에 박히면서 테스트가 **버그를 정답으로 고정**했다.

   그래서 스텁은 «잘 되는 API» 가 아니라 **실측한 API 그대로** 흉내 낸다:
     · 부모를 둘 이상 OR 한 질의에 `corpora=` 가 없으면 → 200 OK + **빈 목록**(오류가 아니다)
     · pageSize 는 힌트라 nextPageToken 이 붙을 수 있다 → 안 따라가면 뒷장을 잃는다
   둘 중 하나라도 앱에서 빠지면 이 테스트가 «없음» 으로 무너진다. */
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const D = 'application/vnd.google-apps.folder';
const dir  = (id, name, parent) => ({ id, name, mimeType: D, parents: [parent] });
const file = (id, name, parent, mime) => ({ id, name, mimeType: mime || 'application/pdf', parents: [parent] });
const jpg  = (id, name, parent) => file(id, name, parent, 'image/jpeg');

const FG = '1EsNGO4CZA8ABqOZDBudUJkEv3UeLUaHJ', CALIB = '10OINvKBh7rRxHL-xgUDeJxHlLYut-dNf';
const NODES = [
  // 완제품 > 제품
  dir('mul', '1.물반죽', FG), dir('ang', '2.앙버터 호두과자', FG),
  // 물반죽 > 슬롯
  dir('m1', '1.품목제조보고번호', 'mul'), dir('m2', '2.원재료 시험성적서', 'mul'),
  dir('m3', '3.부재료 시험성적서', 'mul'), dir('m4', '4.물반죽 시험성적서', 'mul'),
  file('f1', '식품.식품첨가물 품목제조보고서_202602733083.pdf', 'm1'),
  // 물반죽 원재료 — 자재 폴더 5개 (2026-08-24 실측: 골드후라잉·마미만쥬믹스가 늘었다)
  dir('rm1', '계란', 'm2'), dir('rm2', '골드후라잉(식용유)', 'm2'), dir('rm3', '마미만쥬믹스', 'm2'),
  dir('rm4', '앙브레드전용믹스', 'm2'), dir('rm5', '콩기름', 'm2'),
  jpg('f6', '계란 시험성적서 (1).jpg', 'rm1'), jpg('f7', '계란 시험성적서 (2).jpg', 'rm1'),
  jpg('f8', '계란 시험성적서 ~26년 06 14까지.jpg', 'rm1'),
  jpg('f9', '골드후라잉 시험성적서.jpg', 'rm2'),
  file('f10', '마미만쥬믹스 시험성적서.png', 'rm3', 'image/png'),
  file('f11', '앙브레드전용믹스 시험성적서 26.07.14', 'rm4'),
  jpg('f12', '콩식용유 시험성적서 24.08.08.jpg', 'rm5'), jpg('f13', '콩식용유 시험성적서.jpg', 'rm5'),
  file('f14', '콩기름 시험성적서 26.07.20', 'rm5'),
  file('f2', 'NYLON KCL 시험성적서 2026.pdf', 'm3'), file('f3', '비닐 시험성적서 26.01.05', 'm3'),
  file('f4', '시험성적서 26.06.19~26.09.19', 'm4'),
  // 앙버터 > 슬롯 4개. 원재료는 자재 폴더로 갈라졌고, 완제품 성적서 폴더는 **있는데 비어 있다**
  dir('a1', '1.품목제조보고번호', 'ang'), dir('a2', '2.원재료 시험성적서', 'ang'),
  dir('a3', '3.부재료 시험성적서', 'ang'), dir('a4', '4.완제품 시험성적서', 'ang'),
  file('f5', '식품.식품첨가물 품목제조보고서_202602733082.pdf', 'a1'),
  dir('ar1', '1.버터', 'a2'), dir('ar2', '2.팥', 'a2'), dir('ar3', '3.호두', 'a2'),
  file('f15', '버터 — 앵커버터 수입면장 260521.pdf', 'ar1'),
  file('f16', '팥 — (굿모닝서울)적팥앙금S 시험성적서.pdf', 'ar2'),
  file('f17', '호두 — 프리마베라 수입서류.pdf', 'ar3'),
  file('f18', '비닐 시험성적서 26.01.05', 'a3'),
];
// 기계 검교정 > 기기 13 > 회차 폴더 1 > 성적서 사진 1  (2026-08-24 Drive 직접 조회)
const DEVS = ['1.표준온도계','2.적외선온도계','3.표준분동','4.냉동실 데이터로거','5.냉장실 데이터로거',
  '6.저울(1)','7.저울(2)','8.계랑기 저울','9.냉동고 판넬온도계','10.타이머1','11.타이머2','12.타이머3','13.타이머4'];
const ROUND = ['1.공인기관 검/교정 일자 26.03.25','1.공인기관 검/교정 일자 26.05.11','1.공인기관 검/교정 일자 26.03.27',
  '1.자체 검/교정 일자 26.04.01','1.자체 검/교정 일자 26.04.01','1.자체 검/교정 일자 26.04.01',
  '1.자체 검/교정 일자 26.04.01','1.자체 검/교정 일자 26.04.01','1.자체 검/교정 일자 26.04.01',
  '1.자체 검/교정 일자 26.05.29','1.자체 검/교정 일자 26.06.02','1.자체 검/교정 일자 26.06.02','1.자체 검/교정 일자 26.06.02'];
const SHOT = ['표준온도계_공인기관검교정_260325.jpg','적외선온도계_공인기관검교정_260511.jpg','표준분동_공인기관검교정_260327.jpg',
  '냉동실 데이터로거_자체검교정_260401.jpg','냉장실 데이터로거_자체검교정_260401.jpg','저울(1)_자체검교정_260401.jpg',
  '저울(2)_자체검교정_260401.jpg','계랑기 저울_자체검교정_260401.jpg','냉동고 판넬온도계_자체검교정_260401.jpg',
  '타이머1_자체검교정_260529.jpg','타이머2_자체검교정_260602.jpg','타이머3_자체검교정_260602.jpg','타이머4_자체검교정_260602.jpg'];
DEVS.forEach((n, i) => {
  NODES.push(dir('d' + i, n, CALIB));
  NODES.push(dir(`d${i}r1`, ROUND[i], 'd' + i));
  NODES.push(jpg(`d${i}s`, SHOT[i], `d${i}r1`));
});

// ── 스텁: 실측한 Drive API 를 흉내 낸다 ────────────────────────────────────────
//   ① 부모 2개 이상 OR + corpora 없음 → 200 OK + 빈 목록 (2026-08-24 실측: 0건, 또는 13개 중 2건)
//   ② pageSize 는 힌트일 뿐 — PAGE 개씩 끊어 nextPageToken 을 붙인다
let calls = 0, PAGE = 1e9;
const urls = [];
global.fetch = async (url) => {
  calls++; urls.push(url);
  const q = decodeURIComponent(/[?&]q=([^&]*)/.exec(url)[1]);
  const parents = [...q.matchAll(/'([^']+)' in parents/g)].map(m => m[1]);
  if (parents.length > 1 && !/[?&]corpora=/.test(url)) return { ok: true, json: async () => ({ files: [] }) };
  const all = NODES.filter(n => parents.includes(n.parents[0]));
  const from = +((/[?&]pageToken=(\d+)/.exec(url) || [0, 0])[1]);
  const next = from + PAGE < all.length ? String(from + PAGE) : undefined;
  return { ok: true, json: async () => ({ files: all.slice(from, from + PAGE), nextPageToken: next }) };
};
global.State = { token: 'x' };
global.DRIVE = { FG, CALIB };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const slice = (a, b) => SRC.slice(SRC.indexOf(a), SRC.indexOf(b, SRC.indexOf(a)));
const { DriveDocs, HaccpStd, docSlotFolderName, _sfAcceptsFile } = vm.runInThisContext(
  slice('const CCP = {', 'const DB_SHEETS = {')
  + '\n' + slice('const DOC_SLOTS = [', 'const HS_ESC =')
  + '\n' + slice('const HS_ESC =', '/* ── 화면 ')
  + '\n' + slice('function _sfAcceptsFile', '// 정규화한 File 목록')   // 업로드 수용 판정
  + '\n;({ DriveDocs, HaccpStd, docSlotFolderName, _sfAcceptsFile })', { filename: 'index.html' });

(async () => {
  const scan = await DriveDocs.scan(true);
  const P = Object.fromEntries(scan.products.map(p => [p.name, p]));
  const S = (p, k) => P[p].slots.find(s => s.key === k);
  const ok = (n, f) => { f(); console.log('  ✓ ' + n); };

  console.log('\n[실측 트리] DriveDocs.scan()');
  ok(`Drive 왕복 ${calls}회 — 폴더 50여개를 개별 조회하지 않는다`, () => assert.ok(calls <= 8, `${calls}회`));
  ok('제품 2개 · 번호순', () => assert.deepStrictEqual(scan.products.map(p => p.name), ['1.물반죽', '2.앙버터 호두과자']));

  ok('물반죽 — 4슬롯 전부 보유', () => {
    ['report', 'rm', 'sub', 'fg'].forEach(k => assert.strictEqual(S('1.물반죽', k).state, 'ok', k));
  });
  ok('물반죽 원재료 = 자재 5폴더의 파일 9건이 한 슬롯으로 모인다', () =>
    assert.strictEqual(S('1.물반죽', 'rm').files.length, 9));
  ok('물반죽 부재료 = 슬롯 바로 밑 파일 2건', () =>
    assert.strictEqual(S('1.물반죽', 'sub').files.length, 2));
  ok('빈 자재폴더 없음 (계란·골드후라잉·마미만쥬·앙브레드·콩기름 모두 채워짐)', () =>
    assert.deepStrictEqual(S('1.물반죽', 'rm').emptySubs, []));

  ok('앙버터 원재료 — 버터·팥·호두 3폴더가 «보유» 로 잡힌다 (건의 FR-20260824-71S)', () => {
    const rm = S('2.앙버터 호두과자', 'rm');
    assert.strictEqual(rm.state, 'ok');
    assert.strictEqual(rm.files.length, 3);                    // 버터·팥·호두
    assert.deepStrictEqual(rm.emptySubs, []);                  // «비어 있음» 오탐이 없어야 한다
    assert.deepStrictEqual(rm.subs.map(s => s.name), ['1.버터', '2.팥', '3.호두']);
  });
  ok('앙버터 — 품목보고·원재료·부재료는 보유, 완제품 성적서만 폴더가 비어 있다', () => {
    ['report', 'rm', 'sub'].forEach(k => assert.strictEqual(S('2.앙버터 호두과자', k).state, 'ok', k));
    assert.strictEqual(S('2.앙버터 호두과자', 'fg').state, 'empty');   // 폴더는 있고 파일이 없다
  });

  console.log('\n[실측 트리] 기기 13대');
  ok('13대 번호순 — 10번이 2번 앞에 오지 않는다', () =>
    assert.deepStrictEqual(scan.devices.map(d => d.name).slice(0, 3), ['1.표준온도계', '2.적외선온도계', '3.표준분동']));
  ok('회차 폴더 안의 성적서를 13대 전부 찾는다 — 0/13 이 아니라 13/13 (건의 FR-20260824-71S)', () => {
    assert.strictEqual(scan.devices.filter(d => d.state === 'ok').length, 13);
    assert.ok(scan.devices.every(d => d.files.length === 1), '기기마다 성적서 1건');
    assert.strictEqual(scan.devices[0].files[0].name, '표준온도계_공인기관검교정_260325.jpg');
  });
  ok('「차기 예정」 폴더가 없는 지금은 nextDue 를 지어내지 않는다 (기한 SSOT = 「기기관리」 시트)', () =>
    assert.ok(scan.devices.every(d => d.nextDue === '')));

  console.log('\n[Drive API 함정] corpora 를 빼면 조용히 «없음» 이 된다');
  ok('부모를 둘 이상 묶는 질의엔 corpora 가 반드시 붙는다', () => {
    const multi = urls.filter(u => [...decodeURIComponent(/[?&]q=([^&]*)/.exec(u)[1])
      .matchAll(/' in parents/g)].length > 1);
    assert.ok(multi.length >= 2, `부모를 묶어 조회하는 호출이 있어야 한다 (${multi.length}건)`);
    multi.forEach(u => assert.ok(/[?&]corpora=/.test(u), 'corpora 누락: ' + u.slice(0, 140)));
  });

  console.log('\n[Drive API 함정] pageSize 는 힌트다 — nextPageToken 을 따라가야 한다');
  PAGE = 3;                                   // 한 장에 3건씩만 준다
  const paged = await DriveDocs.scan(true);
  PAGE = 1e9;
  ok('한 장에 다 안 와도 기기 13대·성적서 13건을 전부 모은다', () => {
    assert.strictEqual(paged.devices.length, 13);
    assert.strictEqual(paged.devices.filter(d => d.state === 'ok').length, 13);
    assert.strictEqual(paged.products.find(p => p.name === '1.물반죽').slots.find(s => s.key === 'rm').files.length, 9);
  });

  console.log('\n[실측 트리] docFindings — 실제로 무엇이 뜨는가');
  const f = HaccpStd.docFindings({ scan, certs: [], equip: [] });
  const by = k => f.filter(x => x.kind === k).length;
  console.log(`  · 총 ${f.length}건 — 서류없음 ${by('서류없음')} · 폴더없음 ${by('폴더없음')} · 검교정성적서 ${by('검교정성적서')} · 기기미등록 ${by('기기미등록')}`);
  ok('앙버터 완제품 성적서 1건만 «서류없음» 으로 지적된다', () => {
    assert.strictEqual(by('서류없음'), 1);
    assert.ok(f.some(x => x.title.includes('앙버터') && x.title.includes('완제품 시험성적서')));
  });
  ok('폴더 자체가 없는 슬롯은 이제 없다', () => assert.strictEqual(by('폴더없음'), 0));
  ok('검교정 성적서 미보관 오탐이 사라진다 (종전 13건 → 0건)', () => assert.strictEqual(by('검교정성적서'), 0));
  ok('시트가 비면 13대 모두 미등록으로 뜬다 (Drive 가 아니라 「기기관리」 시트 문제)', () =>
    assert.strictEqual(by('기기미등록'), 13));
  ok('물반죽은 지적 없음 (오탐 없음)', () =>
    assert.strictEqual(f.filter(x => x.title.includes('물반죽')).length, 0));

  console.log('\n[업로드] 올릴 자리 결정');
  ok('자재 하위폴더 id 를 들고 있어야 자재별 업로드가 된다', () => {
    const subs = S('1.물반죽', 'rm').subs;
    // 번호 접두어가 없는 자재 폴더는 한글 가나다순으로 떨어진다
    assert.deepStrictEqual(subs.map(s => s.name), ['계란', '골드후라잉(식용유)', '마미만쥬믹스', '앙브레드전용믹스', '콩기름']);
    assert.ok(subs.every(s => s.id), '업로드 대상 폴더 id 가 있어야 한다');
  });
  ok('기기 회차 폴더도 id·이름을 함께 들고 있다', () => {
    const r = scan.devices[0].rounds;
    assert.strictEqual(r.length, 1);
    assert.ok(r.every(x => x.id && x.name));
  });
  ok('없는 슬롯 폴더 이름 — 기존 번호 체계를 따른다', () => {
    const slot = k => S('1.물반죽', k);
    assert.strictEqual(docSlotFolderName(slot('rm'), '2.앙버터 호두과자'), '2.원재료 시험성적서');
    assert.strictEqual(docSlotFolderName(slot('sub'), '2.앙버터 호두과자'), '3.부재료 시험성적서');
    // 완제품 성적서만 제품명이 들어간다 (`4.물반죽 시험성적서` 규칙)
    assert.strictEqual(docSlotFolderName(slot('fg'), '2.앙버터 호두과자'), '4.앙버터 호두과자 시험성적서');
  });
  ok('성적서 슬롯만 시트 등록으로 이어진다 (품목보고서는 유효기한이 없다)', () => {
    assert.strictEqual(S('1.물반죽', 'report').cert, false);
    ['rm', 'sub', 'fg'].forEach(k => assert.strictEqual(S('1.물반죽', k).cert, true, k));
    assert.strictEqual(S('1.물반죽', 'fg').kind, '완제품');
  });

  console.log('\n[업로드] accept 판정 — PDF 성적서가 조용히 버려지지 않는다');
  const F = (name, type) => ({ name, type });
  const IN = accept => ({ accept });
  ok('image/*,application/pdf 는 PDF·JPEG 둘 다 받는다', () => {
    const i = IN('image/*,application/pdf');
    assert.strictEqual(_sfAcceptsFile(i, F('성적서.pdf', 'application/pdf')), true);
    assert.strictEqual(_sfAcceptsFile(i, F('사진.jpg', 'image/jpeg')), true);
    assert.strictEqual(_sfAcceptsFile(i, F('사진.heic', 'image/heic')), true);
  });
  ok('기존 image/* 전용 input 의 동작은 그대로 (PDF 거부)', () => {
    assert.strictEqual(_sfAcceptsFile(IN('image/*'), F('성적서.pdf', 'application/pdf')), false);
    assert.strictEqual(_sfAcceptsFile(IN('image/*'), F('사진.png', 'image/png')), true);
  });
  ok('확장자 규칙(.pdf)과 accept 없음도 처리', () => {
    assert.strictEqual(_sfAcceptsFile(IN('.pdf'), F('성적서.PDF', '')), true);
    assert.strictEqual(_sfAcceptsFile(IN(''), F('무엇이든', '')), true);
  });

  console.log('\n✅ 실측 트리 통합 검증 통과\n');
})();
