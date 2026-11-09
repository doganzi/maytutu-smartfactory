/* 완제품품목 [20] «구분» (U열) — ERP 공장 현황 품목 묶음(P1 · 2026-11-09 승인)
   index.html 의 FG_EXT ~ <fg-group> 블록을 그대로 떼어 돌린다(사본을 두면 원본과 갈라진다).

   확인:  ① 열 위치 — FG_EXT.group = 20 · 머리 맨 끝 «구분» · 기존 [0]~[19] 그대로
         ② 값 세 개 — ERP 가 이 글자로 묶는다 · 새 품목은 필수 · 기존 품목은 빈칸·지금 값 유지 허용
         ③ 머리 U1 은 비었을 때만 채운다 · 실패해도 던지지 않는다 · 한 번만 읽는다
         ④ 화면 배선 — 등록·수정 창 고르기(16px) · 저장(새 품목 append [20] · 수정은 바뀐 때만) · 목록 카드 표시
         ⑤ 기존 품목 값을 앱이 짐작해 채우는 코드가 없다(P2 는 ERP 가 사용자 확인 뒤)

   실행:  node tests/fg-group.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
// 줄 주석만 걷는다 — 블록 주석 정규식은 accept="image/*" 같은 글자에서 코드를 통째로 삼킨다
const CODE = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const i0 = SRC.indexOf('const FG_EXT = {'), i1 = SRC.indexOf('// </fg-group>');
assert.ok(i0 !== -1 && i1 > i0, 'FG_EXT ~ </fg-group> 구간을 찾지 못함');
const fnBody = (sig, span = 8000) => {
  const i = CODE.indexOf(sig); assert.notStrictEqual(i, -1, `${sig} 없음`);
  const rest = CODE.slice(i + sig.length), m = /\n(?:async function |function |Screens[.[])/.exec(rest);
  return CODE.slice(i, i + sig.length + Math.min(m ? m.index : rest.length, span));
};

const writes = [];
let reads = 0;
const ctx = vm.createContext({
  String, Array, Object, JSON, console: { warn: () => {} },
  SheetsAPI: {
    getRange: async () => { reads++; if (ctx.__fail) throw new Error('Sheets 403'); return ctx.__range || []; },
    batchUpdate: async (d) => { writes.push(d); },
  },
});
vm.runInContext(SRC.slice(i0, i1), ctx);
const { FG_EXT, FG_SHEET_HEADER, FG_GROUP, FgGroup } = vm.runInContext('({ FG_EXT, FG_SHEET_HEADER, FG_GROUP, FgGroup })', ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);

const ok = [];
const t = async (n, f) => { await f(); ok.push(n); };

(async () => {
await t('열 위치 — [20] 구분(U열) · 기존 [0]~[19] 인덱스와 머리 그대로', () => {
  assert.strictEqual(FG_EXT.group, 20);
  assert.strictEqual(FG_SHEET_HEADER.length, 21);
  assert.strictEqual(FG_SHEET_HEADER[20], '구분');
  eq(FG_SHEET_HEADER.slice(0, 20), ['code','name','spec','unit','packUnit','shelfLife','storage','status','packsPerBox','labelImage',
    '품목보고번호','품목제조보고일','식품유형','성분배합비율','제조포장단위','라벨파일','라벨갱신일','완제품규격','공급단가','마켓봄코드']);
  eq({ ...FG_EXT, group: undefined }, { reportNo: 10, reportDate: 11, foodType: 12, recipe: 13, packSize: 14, labelFile: 15, labelUpdatedAt: 16, specNote: 17, supplyPrice: 18, mbCodes: 19 });
  assert.strictEqual(String.fromCharCode(65 + FG_EXT.group), 'U');
  assert.ok(/'완제품품목':\s*FG_SHEET_HEADER/.test(CODE), 'DB_SHEETS 가 FG_SHEET_HEADER 를 쓴다(DB 조회 화면에 «구분» 이 보인다)');
});

await t('값 세 개 — ERP 가 묶는 글자 그대로', () => {
  eq(FG_GROUP.OPTIONS, ['B2B 반죽', 'B2C 반죽', 'B2C 호두과자']);
  FG_GROUP.OPTIONS.forEach((o) => assert.ok(FG_GROUP.HINT[o], `${o} 설명 없음`));
});

await t('검사 — 새 품목은 필수 · 셋 밖의 글자는 막는다 · 앞뒤 빈칸은 걷는다', () => {
  eq(FgGroup.check('', { isNew: true }), { ok: false, msg: '구분을 고르세요 (B2B 반죽 · B2C 반죽 · B2C 호두과자)' });
  assert.strictEqual(FgGroup.check(null, { isNew: true }).ok, false);
  eq(FgGroup.check(' B2C 반죽 ', { isNew: true }), { ok: true, group: 'B2C 반죽' });
  assert.strictEqual(FgGroup.check('B2C호두과자', { isNew: true }).ok, false, '띄어쓰기 다른 글자는 ERP 가 못 묶는다');
  assert.strictEqual(FgGroup.check('b2b 반죽', { isNew: true }).ok, false);
});

await t('검사 — 기존 품목은 빈칸(그대로)·지금 값 유지 허용, 새 엉뚱한 글자는 막는다', () => {
  eq(FgGroup.check('', { isNew: false }), { ok: true, group: '' });
  eq(FgGroup.check('B2B 반죽', { isNew: false, prev: '' }), { ok: true, group: 'B2B 반죽' });
  eq(FgGroup.check('옛구분', { isNew: false, prev: '옛구분' }), { ok: true, group: '옛구분' }, '시트에 이미 있던 글자는 건드리지 않는다');
  assert.strictEqual(FgGroup.check('옛구분', { isNew: false, prev: 'B2B 반죽' }).ok, false);
  assert.strictEqual(FgGroup.check('옛구분', { isNew: true, prev: '옛구분' }).ok, false);
});

await t('행에서 읽기 — [20] · 빈칸·짧은 행·null 은 빈 글자', () => {
  const row = Array(21).fill(''); row[20] = ' B2B 반죽 ';
  assert.strictEqual(FgGroup.of(row), 'B2B 반죽');
  assert.strictEqual(FgGroup.of(Array(20).fill('x')), '', '옛 20열 행');
  assert.strictEqual(FgGroup.of(null), '');
});

await t('고르기 칸 — 16px · label for · 새 품목은 «— 선택 —» 이 기본 · 지금 값 선택 · 다른 글자 보존', () => {
  const n = FgGroup.selectHtml('', true);
  assert.ok(/<label for="fg-group">구분 \*<\/label>/.test(n));
  assert.ok(/<select id="fg-group"[^>]*font-size:16px/.test(n), 'select 글씨 16px');
  assert.ok(/<option value="" selected>— 선택 —<\/option>/.test(n));
  FG_GROUP.OPTIONS.forEach((o) => assert.ok(n.includes(`<option value="${o}">`), `${o} 없음`));
  const e = FgGroup.selectHtml('B2C 호두과자', false);
  assert.ok(e.includes('<option value="B2C 호두과자" selected>'));
  assert.ok(!e.includes('— 선택 —'), '값이 있으면 빈 칸 고르기를 두지 않는다');
  assert.ok(!/구분 \*/.test(e));
  const o = FgGroup.selectHtml('옛"구분<', false);
  assert.ok(o.includes('<option value="옛&quot;구분&lt;" selected>'), '다른 글자는 보존하되 escape');
});

await t('목록 카드 한 줄 — 값 / «구분 미지정»(숨기지 않음)', () => {
  const r = Array(21).fill(''); r[20] = 'B2C 반죽';
  assert.ok(FgGroup.lineHtml(r, false).includes('구분: <b>B2C 반죽</b>'));
  const blank = FgGroup.lineHtml(Array(20).fill(''), true);
  assert.ok(blank.includes('구분 미지정') && blank.includes('ERP 확인 뒤 채움'));
  assert.ok(!FgGroup.lineHtml(Array(20).fill(''), false).includes('ERP 확인'), '관리자만 안내');
});

await t('머리 U1 — 비었을 때만 채운다 · 사람이 고친 제목은 덮지 않는다', () => {
  eq(FgGroup.headerPatch(FG_SHEET_HEADER.slice(0, 20)), [{ range: '완제품품목!U1', values: [['구분']] }]);
  eq(FgGroup.headerPatch([...FG_SHEET_HEADER.slice(0, 20), '  ']), [{ range: '완제품품목!U1', values: [['구분']] }]);
  eq(FgGroup.headerPatch([...FG_SHEET_HEADER.slice(0, 20), '품목구분']), []);
  eq(FgGroup.headerPatch(undefined), [{ range: '완제품품목!U1', values: [['구분']] }]);
});

await t('머리 채우기 — 실패해도 던지지 않고 다음에 다시 · 성공하면 다시 읽지 않는다', async () => {
  ctx.__fail = true; writes.length = 0; reads = 0;
  await FgGroup.ensureHeader();
  assert.strictEqual(writes.length, 0); assert.strictEqual(FgGroup._hdrDone, false);
  ctx.__fail = false; ctx.__range = [FG_SHEET_HEADER.slice(0, 20)];
  await FgGroup.ensureHeader();
  eq(writes, [[{ range: '완제품품목!U1', values: [['구분']] }]]);
  await FgGroup.ensureHeader();
  assert.strictEqual(reads, 2, '성공 뒤에는 시트를 다시 읽지 않는다');
});

await t('등록·수정 창 배선 — 제품명 아래 고르기 칸', () => {
  const b = fnBody('async function openFgSpecEditor(');
  assert.ok(/FgGroup\.selectHtml\(FgGroup\.of\(item\), isNew\)/.test(b));
  assert.ok(b.indexOf('id="fg-name"') < b.indexOf('FgGroup.selectHtml'), '제품명 다음에 둔다');
  // 창 높이가 폰 화면보다 길다 — 높이를 묶고 창 안에서 스크롤하지 않으면 맨 위(품목코드·구분)에 손이 닿지 않는다
  assert.ok(/<div class="dialog" style="[^"]*max-height:calc\(100dvh - 32px\);overflow-y:auto/.test(b), '등록 창 높이 제한·스크롤');
});

await t('저장 배선 — 검사 먼저 · 새 품목 append 의 [20] · 수정은 바뀐 때만 [20]', () => {
  const b = fnBody('async function saveFgSpec(');
  assert.ok(/FgGroup\.check\(\$id\('fg-group'\)\?\.value, \{ isNew, prev: prevGroup \}\)/.test(b));
  assert.ok(b.indexOf('FgGroup.check(') < b.indexOf("acquireLock('saveFgSpec')"), '검사는 잠그기 전에(막히면 잠금이 남지 않게)');
  assert.ok(/row\[FG_EXT\.supplyPrice\] = ''; row\[FG_EXT\.mbCodes\] = ''; row\[FG_EXT\.group\] = grp\.group;/.test(b), '새 행 [18][19] 빈칸 · [20] 구분 (구멍 없는 21칸)');
  assert.ok(b.indexOf('row[FG_EXT.group]') < b.indexOf("SheetsAPI.append('완제품품목', row)"));
  assert.ok(/const grpPatch = grp\.group !== prevGroup \? \{ \[FG_EXT\.group\]: grp\.group \} : \{\};/.test(b), '안 바뀌면 [20] 을 쓰지 않는다(ERP 가 채우는 중일 수 있다)');
  assert.ok(/\.\.\.reg, \.\.\.grpPatch/.test(b));
});

await t('목록 화면 배선 — 카드마다 구분 줄 · 관리자만 머리 채우기', () => {
  const b = fnBody("Screens['items-fg'] = async", 7000);
  assert.ok(/FgGroup\.lineHtml\(item, isAdmin\)/.test(b));
  assert.ok(/if \(isAdmin\) FgGroup\.ensureHeader\(\);/.test(b));
});

await t('앙버터 SOP 생성 — 새로 만드는 완제품에도 구분(B2C 호두과자)', () => {
  const b = fnBody('async function hsSeedAngbutterSop(', 9000);
  const m = b.match(/row\[FG_EXT\.group\] = '([^']+)'/);
  assert.ok(m, '앙버터 완제품 행에 구분이 없음');
  assert.ok(FG_GROUP.OPTIONS.includes(m[1]), `${m[1]} 은 세 값 중 하나가 아님`);
});

await t('기존 품목 값을 앱이 짐작해 채우지 않는다 — [20] 을 쓰는 곳은 세 군데뿐', () => {
  const hits = CODE.match(/FG_EXT\.group\]\s*(?:=(?!=)|:)/g) || [];   // 대입·객체 키만(== 비교 제외)
  assert.strictEqual(hits.length, 3, `[20] 쓰기 ${hits.length}곳 — 새 품목 저장 · 수정(바뀐 때) · 앙버터 생성 외에 생겼다`);
  assert.ok(!/updateCell\('완제품품목',[^)]*FG_EXT\.group/.test(CODE));
});

console.log(ok.map((n) => '  ✓ ' + n).join('\n'));
console.log(`\n통과 ${ok.length}건`);
})().catch((e) => { console.error(e); process.exit(1); });
