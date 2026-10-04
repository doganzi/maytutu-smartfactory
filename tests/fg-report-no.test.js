/* 품목제조보고번호 병기 — «번호는 완제품품목 마스터 한 곳, 화면은 제품코드로 찾아 보여 준다».
   배경: 성적서 3건이 전부 같은 줄로 보였고(이름 «image»), 번호는 편집창 안에서만 보였다(2026-10-04).
   index.html 의 실제 FgReportNo 를 떼어 돌리고, 호출 자리는 «주석을 걷어낸 사본» 에서 호출 형태로 센다.
   실행: node tests/fg-report-no.test.js                                                          */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
// 주석을 걷어낸 사본 — 내 주석이 내 시험을 초록으로 만들지 않게(블록 주석 · 줄머리/공백 뒤 // 주석)
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

const line = (name) => { const i = SRC.indexOf(name); assert.notStrictEqual(i, -1, `${name} 을 찾지 못함`); return SRC.slice(i, SRC.indexOf('\n', i)); };
const block = (name) => { const i = SRC.indexOf(name); assert.notStrictEqual(i, -1, `${name} 을 찾지 못함`); return SRC.slice(i, SRC.indexOf('\n};\n', i) + 3); };
const ctx = vm.createContext({});
vm.runInContext(line('const FG_EXT = {'), ctx);
vm.runInContext(line('const HS_ESC = '), ctx);
vm.runInContext(block('const FgReportNo = {') + '\nthis.FgReportNo = FgReportNo; this.FG_EXT = FG_EXT;', ctx);
const { FgReportNo, FG_EXT } = ctx;

// 완제품품목 행 모양 — [0]~[9] 기본 + [10] 품목보고번호
const row = (code, name, no) => { const r = new Array(20).fill(''); r[0] = code; r[1] = name; r[FG_EXT.reportNo] = no; return r; };
const FG = [
  row('FG002', '앙호두', '202602733083'),
  row('FG003', '앙버터 호두과자', ' 202602733082 '),   // 앞뒤 공백도 시트에 들어올 수 있다
  row('FG004', '팥 호두과자', ''),
  null, [],                                            // 빈 행·짧은 행
];
const ok = [];
const t = (n, f) => { f(); ok.push(n); };

t('map — 번호가 있는 품목만, 공백은 다듬어서', () => {
  const m = FgReportNo.map(FG);
  assert.strictEqual(m.get('FG003'), '202602733082');
  assert.strictEqual(m.get('FG002'), '202602733083');
  assert.strictEqual(m.has('FG004'), false, '번호 빈 품목은 넣지 않는다');
  assert.strictEqual(m.size, 2);
  assert.strictEqual(FgReportNo.map(undefined).size, 0);
  assert.strictEqual(FgReportNo.map([[]]).size, 0);
});

t('of — 완제품인데 번호 없음=null(미등록) · 원·부재료=빈 문자열(해당 없음)', () => {
  const m = FgReportNo.map(FG);
  assert.strictEqual(FgReportNo.of(m, 'FG003'), '202602733082');
  assert.strictEqual(FgReportNo.of(m, 'FG004'), null);
  assert.strictEqual(FgReportNo.of(m, 'FG999'), null, '마스터에 아예 없는 완제품 코드도 미등록');
  assert.strictEqual(FgReportNo.of(m, 'RM001'), '');
  assert.strictEqual(FgReportNo.of(m, ''), '');
  assert.strictEqual(FgReportNo.of(m, undefined), '');
});

t('html — 번호는 굵게 · 미등록은 경고색 · 해당 없음은 비움', () => {
  const m = FgReportNo.map(FG);
  assert.strictEqual(FgReportNo.html(m, 'FG003'), '품목제조보고번호 <b>202602733082</b>');
  assert.match(FgReportNo.html(m, 'FG004'), /c-warn.*품목제조보고번호 미등록/);
  assert.strictEqual(FgReportNo.html(m, 'RM001'), '');
});

t('html — 번호에 섞인 태그는 이스케이프', () => {
  const m = FgReportNo.map([row('FG010', 'x', '<img src=x onerror=1>')]);
  assert.ok(!FgReportNo.html(m, 'FG010').includes('<img'), '이스케이프 안 됨');
});

t('text — 글줄용(토스트·점검 설명)', () => {
  const m = FgReportNo.map(FG);
  assert.strictEqual(FgReportNo.text(m, 'FG003'), '품목제조보고번호 202602733082');
  assert.strictEqual(FgReportNo.text(m, 'FG004'), '품목제조보고번호 미등록');
  assert.strictEqual(FgReportNo.text(m, 'RM001'), '');
});

// ── 호출 자리 — 주석 걷어낸 사본에서 호출 형태로 ──
const around = (anchor, span = 700) => { const i = CODE.indexOf(anchor); assert.notStrictEqual(i, -1, `${anchor} 없음`); return CODE.slice(i, i + span); };

t('홈 — 완제품품목을 같이 읽어 알림에 번호·성적서번호를 싣는다', () => {
  // 같은 호출이 완제품 품목 화면에도 있으니, 홈 로드 묶음(Promise.all) 안에서만 센다
  const load = around('const [woData, rmItems, rmLots, eqData, certData, devData, fgMaster]', 900);
  assert.ok(load.includes("SheetsAPI.getAll('완제품품목').catch(() => [])"), '홈 로드에 완제품품목 없음: ' + load);
  assert.ok(CODE.includes('const fgNo = FgReportNo.map(fgMaster);'));
  const push = around('certAlerts.push(', 400);
  assert.ok(push.includes('FgReportNo.html(fgNo, c[2])') && push.includes('certNo: c[5]'), push);
});

t('홈 카드 — 제품코드 줄에 번호 · 별도 줄에 기관·성적서번호·유효기한', () => {
  const card = around('${a.rnHtml', 400);
  assert.ok(CODE.includes('${a.code}${a.rnHtml'), '제품코드 줄에 번호가 없다');
  assert.ok(CODE.includes('${HS_ESC(a.certNo)}'), '같은 이름 3줄을 가르는 성적서번호가 카드에 없다: ' + card);
});

t('홈 토스트 — 같은 이름이 세 번 반복되지 않는다', () => {
  assert.ok(CODE.includes('[...new Set(expired.map(a => a.name + (a.rnText'), '중복 제거 없음');
});

t('점검 항목 — 성적서 만료·임박·규제정보 누락 설명에 번호', () => {
  assert.ok(CODE.includes('const fgNo = FgReportNo.map(fgItems);\n    const rnPart = '), 'compliance 맵 없음');
  assert.strictEqual((CODE.match(/\$\{rnPart\(c\[2\]\)\}/g) || []).length, 2, '만료·임박 두 줄 모두');
  assert.ok(CODE.includes('${i[FG_EXT.reportNo] ? rnPart(i[0]) : \'\'}'), '규제정보 누락 설명');
});

t('성적서 탭 — 등록된 성적서 카드에 번호 줄', () => {
  // 홈 알림에도 같은 호출이 있으니 hsCertTab 함수 몸통 안에서만 센다
  const i = CODE.indexOf('function hsCertTab(');
  assert.notStrictEqual(i, -1);
  const body = CODE.slice(i, CODE.indexOf('\n}\n', i));
  assert.ok(body.includes('const fgNo = FgReportNo.map(fgItems);'), '성적서 탭에 맵 없음');
  assert.ok(body.includes('FgReportNo.html(fgNo, c[2])'), '성적서 카드에 번호 줄 없음');
});

t('완제품 품목 카드 — 이름 아래에 번호(미등록이면 ✏️ 안내)', () => {
  assert.ok(CODE.includes('const fgNoMap = FgReportNo.map(items);'));
  assert.ok(CODE.includes('FgReportNo.html(fgNoMap, code)'));
});

t('번호는 성적서에 복사하지 않는다 — 시험성적서 시트에 번호 칸이 없고 저장 함수도 안 쓴다', () => {
  assert.ok(!/CERT_SHEET_HEADER\s*=\s*\[[^\]]*보고번호/.test(CODE), '성적서 헤더에 번호 칸이 생겼다');
  for (const fn of ['async function hsSaveCert', 'async function hsRegisterCertAfterUpload']) {
    const i = CODE.indexOf(fn);
    if (i === -1) continue;                       // 함수 이름이 바뀌었으면 건너뛴다(아래 전체 검사가 지킨다)
    const body = CODE.slice(i, CODE.indexOf('\n}\n', i));
    assert.ok(!/reportNo|FgReportNo/.test(body), `${fn} 가 번호를 만진다`);
  }
});

t('지운 것 — 옛 홈 카드 줄·옛 토스트 식이 없다', () => {
  assert.ok(!CODE.includes('${a.code} ${a.lab} · 유효기한: ${a.until}'), '옛 카드 줄이 남았다');
  assert.ok(!CODE.includes("expired.map(a=>a.name).join(', ')"), '옛 토스트 식이 남았다');
});

console.log(`✅ fg-report-no ${ok.length}건 통과`);
ok.forEach(n => console.log('  ·', n));
