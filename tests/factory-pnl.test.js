/* FactoryPnl 시뮬레이션 검증 — index.html 에 실제로 실려 있는 집계 코드를 그대로 떼어 돌린다.
   (사본을 따로 두면 원본과 갈라져서 통과해도 의미가 없다 — haccp-std.test.js 와 같은 방식)

   실행:  node tests/factory-pnl.test.js      실패하면 assert 로 즉시 중단
   범위:  순수 집계 로직만 — 화면·Sheets 쓰기는 라이브 검수 대상                        */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function slice(startMark, endMark) {
  const i = SRC.indexOf(startMark);
  assert.notStrictEqual(i, -1, `index.html 에서 시작 마커를 찾지 못함: ${startMark}`);
  const j = SRC.indexOf(endMark, i);
  assert.notStrictEqual(j, -1, `index.html 에서 종료 마커를 찾지 못함: ${endMark}`);
  return SRC.slice(i, j);
}
// ── 화면 코드가 참조하는 앱 전역 스텁 (렌더 스모크용) ──
const _dom = {};
global.Screens = {};
global.State = { user: { email: 'admin@anghodu.biz', role: 'admin' } };
global.$id = (id) => _dom[id] || (_dom[id] = { innerHTML: '', value: '', classList: { add() {}, remove() {} } });
global.document = {
  getElementById: (id) => global.$id(id),
  createElement: () => ({ className: '', innerHTML: '', appendChild() {}, remove() {},
    addEventListener() {}, querySelector: () => ({ onclick: null, addEventListener() {}, value: '', textContent: '' }) }),
  body: { appendChild() {} },
};
global.window = global;
global.renderHeader = () => {};
global.showLoading = () => {}; global.hideLoading = () => {};
global.toast = (m, t) => { _dom._toasts = (_dom._toasts || []).concat([[m, t]]); };
global.Router = { go: (s) => { _dom._went = s; } };
global.acquireLock = () => true; global.releaseLock = () => {};
global.formatDateTime = () => '2026-08-12 10:00:00';
global.SheetsAPI = { getAll: async () => [], append: async () => {}, createSheet: async () => {},
                     updateCell: async () => {}, updateRowByIndex: async () => {}, invalidateCache: () => {} };

const code = slice('const FG_EXT = {', 'const FG_SHEET_HEADER')          // 완제품 확장 컬럼 인덱스
           + '\n' + slice("const PNL_SHEET = '공장손익';", '/* ─── 공장 손익 화면')
           + '\n' + slice('/* ─── 공장 손익 화면', "Screens['bom-calc'] = async () => {");
vm.runInThisContext(code, { filename: 'index.html#FactoryPnl' });

const ok = [];
const t = (name, fn) => { fn(); ok.push(name); };

/* ── 단위 환산 — 여기가 틀리면 손익이 배수로 어긋난다 ── */
t('toPacks: 봉/kg/박스 환산', () => {
  assert.strictEqual(FactoryPnl.toPacks(10, '봉', 3), 10);
  assert.strictEqual(FactoryPnl.toPacks(10, '', 3), 10);          // 단위 공란 = 이미 봉
  assert.strictEqual(FactoryPnl.toPacks(20, 'kg', 3), 4);         // 20kg ÷ 5 = 4봉
  assert.strictEqual(FactoryPnl.toPacks(2, 'box', 3), 6);         // 2박스 × 3봉
  assert.strictEqual(FactoryPnl.toPacks(2, '박스', 4), 8);
  assert.strictEqual(FactoryPnl.toPacks(2, '박스', 0), 2);        // packsPerBox 미설정 → 1로 방어
  assert.strictEqual(FactoryPnl.toPacks('', 'kg', 3), 0);
  assert.strictEqual(FactoryPnl.toPacks('1,200', 'kg', 1), 240);  // 천단위 콤마
});

t('ym: 문자열·시리얼·쓰레기값', () => {
  assert.strictEqual(FactoryPnl.ym('2026-06-05'), '2026-06');
  assert.strictEqual(FactoryPnl.ym('2026-06-05 13:20:11'), '2026-06');
  assert.strictEqual(FactoryPnl.ym('2026/6/5'), '2026-06');       // 한 자리 월 zero-pad
  assert.strictEqual(FactoryPnl.ym(''), '');
  assert.strictEqual(FactoryPnl.ym(null), '');
  assert.strictEqual(FactoryPnl.ym('없음'), '');
  const serial = Math.round((Date.UTC(2026, 5, 5) - Date.UTC(1899, 11, 30)) / 86400000);
  assert.strictEqual(FactoryPnl.ym(serial), '2026-06');           // 구글 시트 날짜 시리얼
  assert.strictEqual(FactoryPnl.ym(String(serial)), '2026-06');   // 숫자가 문자열로 온 경우
});

t('matOf: QR 개별ID → LOT 매칭', () => {
  const m = new Map([['RM-003-A', 'RM003'], ['RM-001-A', 'RM001']]);
  assert.strictEqual(FactoryPnl.matOf('RM-003-A', m), 'RM003');
  assert.strictEqual(FactoryPnl.matOf('RM-001-A-01', m), 'RM001');       // -NN 떼고 매칭
  assert.strictEqual(FactoryPnl.matOf('UNKNOWN, RM-003-A', m), 'RM003'); // 첫 해석되는 LOT
  assert.strictEqual(FactoryPnl.matOf('', m), '');
  assert.strictEqual(FactoryPnl.matOf('NOPE', m), '');
});

/* ── 종단 집계 — 대표 한 달을 손으로 계산한 값과 대조 ── */
const PRICE = 21591;   // 원/봉 (VAT 제외 공급가)
const fixture = {
  fgItems: [
    // [0]code [1]name … [7]status [8]packsPerBox … [18]공급단가
    ['FG002', '앙호두 전용반죽', '5kg', '봉', 'PE', 6, '냉동', '', 3, '', '', '', '', '', '', '', '', '', PRICE],
    ['FG009', '단종품', '', '봉', '', 12, '', '비활성', 3, '', '', '', '', '', '', '', '', '', ''],
  ],
  fgLots: [
    // [0]lotId [1]itemCode [3]qty [4]unit [5]prodDate [9]status
    ['FG-002-1', 'FG002', '앙호두', 100, '봉', '2026-06-05', '2026-12-05', 'WO1', 100, '출하가능'],
    ['FG-002-2', 'FG002', '앙호두', 20, 'kg', '2026-06-10', '2026-12-10', 'WO2', 20, '냉동보관중'],   // = 4봉
    ['FG-002-3', 'FG002', '앙호두', 50, '봉', '2026-06-12', '2026-12-12', 'WO3', 0, '폐기'],          // 제외
    ['FG-002-4', 'FG002', '앙호두', 60, '봉', '2026-07-03', '2027-01-03', 'WO4', 60, '출하완료'],     // 출하완료도 생산량
  ],
  ships: [
    // [0]shipId [1]lotId [4]qty [5]unit [6]shipDt
    ['SHP-1', 'FG-002-1', '', '광주풍암점', 40, '봉', '2026-06-20'],
    ['SHP-2', 'FG-002-1', '', '광주수완점', 30, '', '2026-06-25'],
    ['SHP-3', 'FG-002-9', '', '미등록LOT', 10, '봉', '2026-06-28'],    // 품목 불명 → 단가 없음
  ],
  pos: [
    // [0]poId [1]orderDt [6]qty [8]unitPrice [9]totalAmt [10]recvDt [18]status
    ['PO-1', '2026-05-28', 'a@b', 'V1', 'RM003', '믹스', 500, 'kg', 2000, 1000000, '2026-06-02', '', '', '', '', '', '', '', '수령완료'],
    ['PO-2', '2026-06-15', 'a@b', 'V1', 'RM001', '계란', 100, 'kg', 5000, 500000, '', '', '', '', '', '', '', '', '주문완료'],
    ['PO-3', '2026-06-18', 'a@b', 'V1', 'RM003', '믹스', 999, 'kg', 2000, 9999999, '2026-06-19', '', '', '', '', '', '', '', '삭제'],
  ],
  procs: [
    // [3]stepType [4]usedLotIds [5]stepData [11]completedAt
    ['WO1', '1', '계량', 'input', 'RM-003-A', '{"inputQty":300}', '', '', '', '', '완료', '2026-06-08', 'w@a'],
    ['WO1', '2', '계량', 'input', 'RM-001-A-01', '{"inputQty":90}', '', '', '', '', '완료', '2026-06-08', 'w@a'],
    ['WO1', '3', '가열', 'heat', '', '{"temp":180}', '', '', '', '', '완료', '2026-06-08', 'w@a'],       // input 아님
    ['WO1', '4', '계량', 'input', 'LOT-없음', '{"inputQty":50}', '', '', '', '', '완료', '2026-06-08', 'w@a'], // 미해석
    ['WO1', '5', '계량', 'input', 'RM-003-A', '깨진JSON{', '', '', '', '', '완료', '2026-06-08', 'w@a'],   // 파싱 실패
  ],
  rmItems: [
    // [0]code [1]name [4]unit [13]매입단가
    ['RM003', '마미만쥬믹스', '', '10kg/포대', 'kg', '식자재', '', '', '', '', '', '', '', 2000],
    ['RM001', '계란', '', '30알/판', 'kg', '식자재', '', '', '', '', '', '', '', ''],                     // 단가 미입력
  ],
  rmLots: [['RM-003-A', 'RM003'], ['RM-001-A', 'RM001']],
  manual: [
    ['2026-06', '노무비', 9525688, '4인'],
    ['2026-06', '제조경비', '3,135,250', '임차료+관리비'],   // 콤마 포함도 읽힌다
    ['2026-06', '기타', 100000, ''],
  ],
};

const rows = FactoryPnl.build(fixture);
const jun = rows.find(r => r.ym === '2026-06');
const jul = rows.find(r => r.ym === '2026-07');

t('월 버킷은 오름차순, 데이터 있는 달만', () => {
  assert.deepStrictEqual(rows.map(r => r.ym), ['2026-06', '2026-07']);
});

t('생산량 = 유효 LOT(폐기·삭제 제외), kg 은 봉 환산', () => {
  assert.strictEqual(jun.prodPacks, 104);          // 100봉 + 20kg(=4봉), 폐기 50봉 제외
  assert.strictEqual(jun.prodKg, 520);
  assert.strictEqual(jul.prodPacks, 60);           // 출하완료도 '그 달에 만든 것'
});

t('매출 = 출하봉수 × 공급단가 · 단가 없는 물량은 매출에서 빠지고 경고로 남는다', () => {
  assert.strictEqual(jun.shipPacks, 80);           // 40 + 30 + 10
  assert.strictEqual(jun.revenue, 70 * PRICE);     // 미등록 LOT 10봉은 제외
  assert.strictEqual(jun.noPricePacks, 10);
  assert.strictEqual(Math.round(jun.unitPrice), Math.round(70 * PRICE / 80));
});

t('재료비 = 실투입 kg × 매입단가 · 미해석/비-input/깨진JSON 제외', () => {
  assert.strictEqual(jun.matUsed, 300 * 2000);     // 계란 90kg 은 단가 0 → 0원
  assert.strictEqual(jun.noCostKg, 90);
  assert.strictEqual(jun.mats.length, 2);
  const mix = jun.mats.find(m => m.code === 'RM003');
  assert.strictEqual(mix.qty, 300);                // 깨진 JSON 행은 안 더해졌다
  assert.strictEqual(mix.amount, 600000);
});

t('실매입 = 구매주문 totalAmt · 귀속은 수령일 우선 · 삭제 제외', () => {
  assert.strictEqual(jun.matBuy, 1500000);         // PO-1(수령 6/2) + PO-2(주문 6/15), PO-3 삭제
  assert.strictEqual(rows.find(r => r.ym === '2026-05'), undefined);   // 주문일 5/28 은 수령일에 밀렸다
});

t('노무비·제조경비·기타 = 수기 시트, 원가·이익 합산', () => {
  assert.strictEqual(jun.labor, 9525688);
  assert.strictEqual(jun.overhead, 3135250);
  assert.strictEqual(jun.other, 100000);
  const cost = 600000 + 9525688 + 3135250 + 100000;
  assert.strictEqual(jun.cost, cost);
  assert.strictEqual(jun.profit, 70 * PRICE - cost);
  assert.strictEqual(Math.round(jun.marginPct * 10) / 10, Math.round(jun.profit / jun.revenue * 1000) / 10);
  assert.strictEqual(Math.round(jun.unitCost), Math.round(cost / 104));
});

t('매출 0인 달은 이익률 null (0으로 나누지 않는다)', () => {
  assert.strictEqual(jul.revenue, 0);
  assert.strictEqual(jul.marginPct, null);
  assert.strictEqual(jul.unitPrice, null);         // 출하 0
});

/* ── 빈 입력·방어 ── */
t('빈 입력·null 행에도 안 터진다', () => {
  assert.deepStrictEqual(FactoryPnl.build({}), []);
  assert.deepStrictEqual(FactoryPnl.build(), []);
  assert.deepStrictEqual(FactoryPnl.build({ fgLots: [null, [], ['x']], ships: [null], procs: [null], pos: [null], manual: [null] }), []);
});

t('recent: 최근 N개월 절단, 0 이면 전체', () => {
  assert.deepStrictEqual(FactoryPnl.recent(rows, 1).map(r => r.ym), ['2026-07']);
  assert.deepStrictEqual(FactoryPnl.recent(rows, 0).map(r => r.ym), ['2026-06', '2026-07']);
});

/* ── 화면 렌더 스모크 — 렌더 중 예외는 '버튼이 안 눌린다'로만 보여서 잡기 어렵다 ── */
t('renderPnlBody: 데이터 있을 때 예외 없이 그려지고 핵심 숫자가 찍힌다', () => {
  State._pnl = { fgItems: fixture.fgItems, rows };
  window._pnlSel = '2026-06'; window._pnlRange = 12;
  renderPnlBody();
  const html = $id('content').innerHTML;
  assert.ok(html.includes('2026.06'), '선택 월 라벨');
  assert.ok(html.includes('제조손익'), '요약 카드');
  assert.ok(html.includes('마미만쥬믹스'), '자재별 재료비');
  assert.ok(html.includes('공급단가 미입력'), '단가 미입력 경고');
  assert.ok(html.includes('이 숫자는 어디서 왔나'), '출처 각주');
  assert.ok(!/undefined|NaN/.test(html), 'undefined·NaN 이 화면에 새어나오면 안 된다');
});

t('renderPnlBody: 데이터가 없어도 빈 화면이 뜬다', () => {
  State._pnl = { fgItems: [], rows: [] };
  renderPnlBody();
  assert.ok($id('content').innerHTML.includes('집계할 데이터가 없습니다'));
});

t('관리자 전용 게이트 — 작업자는 홈으로 튕긴다', async () => {
  State.user = { email: 'w@anghodu.biz', role: 'worker' };
  _dom._went = null;
  Screens['pnl']();                       // 게이트는 await 전에 동기로 걸린다
  assert.strictEqual(_dom._went, 'home');
  State.user = { email: 'admin@anghodu.biz', role: 'admin' };
});

console.log(ok.map(n => '  ✓ ' + n).join('\n'));
console.log(`\n✅ FactoryPnl ${ok.length}건 통과`);
