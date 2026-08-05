/* HaccpStd 시뮬레이션 검증 — index.html 에 실제로 실려 있는 코드를 그대로 떼어 돌린다.
   (별도 사본을 두면 원본과 갈라져서 통과해도 의미가 없다)

   실행:  node tests/haccp-std.test.js      실패하면 assert 로 즉시 중단
   범위:  순수 판정 로직만 — DOM·Sheets·Drive 를 타는 화면은 라이브 검수 대상       */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── 앱 전역 스텁 (모듈이 참조하는 것만) ──
const FIXED_TODAY = '2026-08-05';
global.formatDate = (d) => d ? new Date(d).toISOString().slice(0, 10) : FIXED_TODAY;
global.formatDateTime = () => FIXED_TODAY + ' 10:00';
global.localStorage = {
  _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); },
};
global.State = { user: { email: 't@anghodu.biz', role: 'admin' }, token: 'x' };
global.SheetsAPI = { getAll: async () => [], append: async () => {}, createSheet: async () => {}, invalidateCache: () => {} };
global.generateSeqId = async () => 'DEV-20260805-001';

// ── index.html 에서 대상 코드 구간을 그대로 떼어 평가 ──
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function slice(startMark, endMark) {
  const i = SRC.indexOf(startMark);
  assert.notStrictEqual(i, -1, `index.html 에서 시작 마커를 찾지 못함: ${startMark}`);
  const j = SRC.indexOf(endMark, i);
  assert.notStrictEqual(j, -1, `index.html 에서 종료 마커를 찾지 못함: ${endMark}`);
  return SRC.slice(i, j);
}
const code = slice('const CCP = {', 'const DB_SHEETS = {')       // 기준 상수
           + '\n' + slice('const HS_ESC =', '/* ── 화면 ')        // HaccpStd 모듈
           + '\n' + slice('const HEAT_PHASES =', 'function collectStepData')  // 가열 CCP-3B 판정
           + '\n;({ CCP, HACCP_DOC, FG_EXT, HaccpStd, heatJudge, HEAT_PHASES })';
const { CCP, HACCP_DOC, FG_EXT, HaccpStd, heatJudge, HEAT_PHASES } = vm.runInThisContext(code, { filename: 'index.html#HaccpStd' });

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('\n[1] certStatus — 경계값');
ok('빈 값 → 기한없음/warn', () => {
  assert.strictEqual(HaccpStd.certStatus('').badge, 'warn');
  assert.strictEqual(HaccpStd.certStatus(null).badge, 'warn');
  assert.strictEqual(HaccpStd.certStatus(undefined).badge, 'warn');
});
ok('과거 → err (경과일수 표시)', () => {
  const r = HaccpStd.certStatus('2026-08-04');
  assert.strictEqual(r.badge, 'err'); assert.strictEqual(r.days, -1);
  assert.match(r.label, /만료 1일 경과/);
});
ok('오늘 → warn "오늘 만료"', () => {
  const r = HaccpStd.certStatus('2026-08-05');
  assert.strictEqual(r.badge, 'warn'); assert.strictEqual(r.days, 0);
  assert.strictEqual(r.label, '오늘 만료');
});
ok('D+30 = 경계 안쪽 → warn', () => assert.strictEqual(HaccpStd.certStatus('2026-09-04').badge, 'warn'));
ok('D+31 = 경계 바깥 → suc', () => assert.strictEqual(HaccpStd.certStatus('2026-09-05').badge, 'suc'));
ok('잘못된 날짜 → 기한오류/warn (crash 아님)', () => {
  assert.strictEqual(HaccpStd.certStatus('아무말').badge, 'warn');
});

console.log('\n[2] seedRows → parse 왕복 — 기준값 불일치 오탐 방지');
ok('시드 7행 (CCP 3 + 검증 4)', () => {
  const rows = HaccpStd.seedRows();
  assert.strictEqual(rows.length, 7);
  assert.strictEqual(rows.filter(r => r[1] === 'CCP').length, 3);
  assert.strictEqual(rows.filter(r => r[1] === '검증').length, 4);
});
ok('CCP 번호가 기준서 26.08.05 배정과 일치', () => {
  const ids = HaccpStd.seedRows().filter(r => r[1] === 'CCP').map(r => r[0]);
  assert.deepStrictEqual(ids, ['CCP-1P', 'CCP-2B', 'CCP-3B']);
  assert.strictEqual(CCP.METAL.no, 'CCP-1P');   // 금속 = 1P
  assert.strictEqual(CCP.FREEZE.no, 'CCP-2B');  // 동결 = 2B
  assert.strictEqual(CCP.HEAT.no, 'CCP-3B');    // 가열 = 3B
});
ok('한계기준 JSON 왕복이 정확히 보존 (오탐 0건)', () => {
  const std = HaccpStd.parse(HaccpStd.seedRows());
  const findings = HaccpStd.compliance({ std, certs: [], fgItems: [], rmItems: [], devs: [] });
  assert.strictEqual(findings.filter(f => f.kind === '기준불일치').length, 0);
});
ok('시트가 비면 코드 상수로 fallback + _fallback 표시', () => {
  const std = HaccpStd.parse([]);
  assert.strictEqual(std.length, 7);
  assert.strictEqual(std[0]._fallback, true);
});

console.log('\n[3] compliance — 기준 불일치 탐지');
const seedStd = () => HaccpStd.parse(HaccpStd.seedRows());
ok('시트 한계기준이 바뀌면 err 로 잡는다', () => {
  const rows = HaccpStd.seedRows();
  rows[1][5] = JSON.stringify({ tempC: -15, hours: 12 });   // 동결 -18 → -15 로 변조
  const f = HaccpStd.compliance({ std: HaccpStd.parse(rows), certs: [], fgItems: [], rmItems: [], devs: [] });
  const hit = f.find(x => x.kind === '기준불일치' && x.title.includes('CCP-2B'));
  assert.ok(hit && hit.sev === 'err', '동결 기준 변조를 못 잡음');
});
ok('CCP 행이 통째로 없으면 미등록 err', () => {
  const rows = HaccpStd.seedRows().filter(r => r[0] !== 'CCP-3B');
  const f = HaccpStd.compliance({ std: HaccpStd.parse(rows), certs: [], fgItems: [], rmItems: [], devs: [] });
  assert.ok(f.some(x => x.title === 'CCP-3B 기준 미등록'));
});
ok('깨진 JSON 이어도 죽지 않고 불일치로 보고', () => {
  const rows = HaccpStd.seedRows();
  rows[0][5] = '{망가진';
  const f = HaccpStd.compliance({ std: HaccpStd.parse(rows), certs: [], fgItems: [], rmItems: [], devs: [] });
  assert.ok(f.some(x => x.kind === '기준불일치' && x.title.includes('CCP-1P')));
});

console.log('\n[4] compliance — 시험성적서');
const rmCols = (code, name, status) => { const a = new Array(14).fill(''); a[0] = code; a[1] = name; a[12] = status || ''; return a; };
const cert = (code, name, until, state) => { const a = new Array(14).fill(''); a[2] = code; a[3] = name; a[7] = until; a[12] = state || '유효'; return a; };
ok('만료 성적서 → err', () => {
  const f = HaccpStd.compliance({ std: seedStd(), certs: [cert('RM003', '마미만쥬믹스', '2026-07-01')], fgItems: [], rmItems: [], devs: [] });
  assert.ok(f.some(x => x.kind === '성적서만료' && x.sev === 'err'));
});
ok('폐기된 성적서는 만료 알림에서 제외', () => {
  const f = HaccpStd.compliance({ std: seedStd(), certs: [cert('RM003', '마미만쥬믹스', '2026-07-01', '폐기')], fgItems: [], rmItems: [], devs: [] });
  assert.strictEqual(f.filter(x => x.kind === '성적서만료').length, 0);
});
ok('유효 성적서 없는 활성 원재료 → 성적서없음 warn', () => {
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [rmCols('RM001', '계란')], devs: [] });
  assert.ok(f.some(x => x.kind === '성적서없음' && x.title.includes('계란')));
});
ok('RM002 물 · 비활성 품목은 성적서 요구 대상 아님', () => {
  const f = HaccpStd.compliance({
    std: seedStd(), certs: [], fgItems: [],
    rmItems: [rmCols('RM002', '물'), rmCols('RM009', '단종자재', '비활성')], devs: [],
  });
  assert.strictEqual(f.filter(x => x.kind === '성적서없음').length, 0);
});
ok('만료된 성적서는 "유효"로 쳐주지 않는다 (만료 + 없음 둘 다 뜸)', () => {
  const f = HaccpStd.compliance({
    std: seedStd(), certs: [cert('RM003', '마미만쥬믹스', '2026-01-01')], fgItems: [],
    rmItems: [rmCols('RM003', '마미만쥬믹스')], devs: [],
  });
  assert.ok(f.some(x => x.kind === '성적서만료'));
  assert.ok(f.some(x => x.kind === '성적서없음'));
});

console.log('\n[5] compliance — 완제품 규제정보 · 라벨');
const fg = (o = {}) => {
  const a = new Array(18).fill('');
  a[0] = o.code || 'FG002'; a[1] = o.name || '앙호두 (호두과자 전용반죽)';
  a[5] = o.shelfLife ?? '180'; a[7] = o.status || '';
  a[9] = o.labelImage || '';
  a[FG_EXT.reportNo] = o.reportNo ?? '202602733081';
  a[FG_EXT.reportDate] = o.reportDate ?? '2026-03-10';
  a[FG_EXT.foodType] = o.foodType ?? '빵류';
  a[FG_EXT.packSize] = o.packSize ?? '5kg';
  a[FG_EXT.labelFile] = o.labelFile || '';
  return a;
};
ok('규제정보 완비 + 라벨 있으면 지적 없음', () => {
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [fg({ labelFile: 'https://drive/x' })], rmItems: [], devs: [] });
  assert.strictEqual(f.filter(x => x.kind === '완제품정보' || x.kind === '라벨').length, 0);
});
ok('품목보고번호·보고일 누락 → 항목명까지 짚어준다', () => {
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [fg({ reportNo: '', reportDate: '', labelFile: 'u' })], rmItems: [], devs: [] });
  const hit = f.find(x => x.kind === '완제품정보');
  assert.ok(hit); assert.match(hit.detail, /품목보고번호/); assert.match(hit.detail, /품목제조보고일/);
});
ok('라벨 이미지·링크 둘 다 없을 때만 라벨 지적', () => {
  const none = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [fg()], rmItems: [], devs: [] });
  assert.ok(none.some(x => x.kind === '라벨'));
  const img = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [fg({ labelImage: 'https://img' })], rmItems: [], devs: [] });
  assert.strictEqual(img.filter(x => x.kind === '라벨').length, 0);
});
ok('비활성 완제품은 점검 대상 아님', () => {
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [fg({ status: '비활성', reportNo: '' })], rmItems: [], devs: [] });
  assert.strictEqual(f.filter(x => x.kind === '완제품정보' || x.kind === '라벨').length, 0);
});

console.log('\n[6] compliance — 기준서 개정 감지 + 편차 중복 억제');
ok('확인 이력 없으면 warn', () => {
  global.localStorage._m = {};
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [], devs: [] });
  assert.ok(f.some(x => x.title === '기준서 개정 확인 이력 없음'));
});
ok('확인 후 30일 이내면 조용', () => {
  global.localStorage._m = { haccpDocCheckedAt: '2026-07-20' };
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [], devs: [] });
  assert.strictEqual(f.filter(x => x.kind === '기준서').length, 0);
});
ok('31일 지나면 재확인 warn', () => {
  global.localStorage._m = { haccpDocCheckedAt: '2026-07-04' };
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [], devs: [] });
  assert.ok(f.some(x => x.title.includes('일 초과')));
});
ok('Drive 최신본이 앱 반영본보다 새로우면 err (미반영)', () => {
  global.localStorage._m = { haccpDocCheckedAt: FIXED_TODAY, haccpDocNewest: '2026-09-01|메이투투 해썹관리기준서 26.09.01.hwp' };
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [], devs: [] });
  const hit = f.find(x => x.title === '기준서 개정 미반영');
  assert.ok(hit && hit.sev === 'err');
});
ok('같은 날짜면 미반영 아님', () => {
  global.localStorage._m = { haccpDocCheckedAt: FIXED_TODAY, haccpDocNewest: HACCP_DOC.revisedAt + '|현행본.hwp' };
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [], devs: [] });
  assert.strictEqual(f.filter(x => x.title === '기준서 개정 미반영').length, 0);
});
ok('이미 편차로 등록된 건은 tracked=true (중복 등록 버튼 숨김)', () => {
  global.localStorage._m = { haccpDocCheckedAt: FIXED_TODAY };
  const base = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [rmCols('RM001', '계란')], devs: [] });
  const title = base.find(x => x.kind === '성적서없음').title;
  const dev = new Array(14).fill(''); dev[3] = title; dev[7] = '조치중';
  const after = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [rmCols('RM001', '계란')], devs: [dev] });
  assert.strictEqual(after.find(x => x.title === title).tracked, true);
  const doneDev = new Array(14).fill(''); doneDev[3] = title; doneDev[7] = '완료';
  const reopened = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [rmCols('RM001', '계란')], devs: [doneDev] });
  assert.strictEqual(reopened.find(x => x.title === title).tracked, false, '완료된 편차는 다시 뜨는 게 맞다');
});

console.log('\n[7] 빈 공장 (데이터 0건) — 크래시 없이 동작');
ok('모든 입력이 빈 배열이어도 findings 반환', () => {
  global.localStorage._m = { haccpDocCheckedAt: FIXED_TODAY };
  const f = HaccpStd.compliance({ std: seedStd(), certs: [], fgItems: [], rmItems: [], devs: [] });
  assert.ok(Array.isArray(f));
  assert.strictEqual(f.length, 0, '정상 상태에서는 지적 0건이어야 한다');
});

console.log('\n[8] 가열공정 CCP-3B 판정 — 175~190℃ · 150~180초 · 품온 90℃↑');
const heat = (o = {}) => heatJudge({ startC: 180, endC: 185, coreC: 92, sec: 165, ...o });
ok('한계기준 안쪽 전부 충족 → 적합', () => {
  const v = heat();
  assert.strictEqual(v.ok, true); assert.deepStrictEqual(v.bad, []);
});
ok('경계값 포함 (175/190 · 150/180초 · 정확히 90℃) → 적합', () => {
  assert.strictEqual(heat({ startC: 175, endC: 190, sec: 150, coreC: 90 }).ok, true);
  assert.strictEqual(heat({ startC: 190, endC: 175, sec: 180 }).ok, true);
});
ok('가열온도 미달/초과 → 부적합 + 항목명', () => {
  assert.deepStrictEqual(heat({ startC: 174.9 }).bad, ['시작온도']);
  assert.deepStrictEqual(heat({ endC: 190.1 }).bad, ['종료온도']);
});
ok('가열시간 2분29초 → 부적합', () => assert.deepStrictEqual(heat({ sec: 149 }).bad, ['가열시간']));
ok('가열시간 3분1초 → 부적합', () => assert.deepStrictEqual(heat({ sec: 181 }).bad, ['가열시간']));
ok('품온 89.9℃ → 부적합 (병원성 미생물 잔존 위험)', () => {
  assert.deepStrictEqual(heat({ coreC: 89.9 }).bad, ['가열후품온']);
});
ok('빈칸은 적합으로 넘어가지 않는다 (4항목 모두 이탈)', () => {
  const v = heatJudge({ startC: '', endC: '', coreC: '', sec: '' });
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.bad, ['시작온도', '종료온도', '가열시간', '가열후품온']);
});
ok('여러 항목 동시 이탈이면 전부 열거', () => {
  assert.deepStrictEqual(heat({ startC: 160, coreC: 80 }).bad, ['시작온도', '가열후품온']);
});
ok('기본 측정 시점 = 매 작업 전 · 작업 종료 (기준서 주기)', () => {
  assert.deepStrictEqual(HEAT_PHASES, ['작업 전', '작업 종료']);
});

console.log(`\n✅ ${pass}개 통과\n`);
