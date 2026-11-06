/* 공장 도메인 개편 3단계 — 공장 앱 쪽 세 가지(2026-11-06 이종훈 본부장 인터뷰 결정 D13 · D15 · D16)
   index.html 의 <ship-dest> · <rcv-price> · <erp-adj> · <reorder-calc> 블록을 그대로 떼어 돌린다(사본을 두면 원본과 갈라진다).

   확인:  ① 출하 «받는 곳» — 값 네 개(ERP 가 이 글자로 출고를 나눈다) · 기본 가맹점 · R&D 시험·B2B 샘플은 메모 필수 · «테스트» 낱말 없음
            · 출하 창 셋(봉 하나 · 선택 · LOT 전체)이 받는 곳을 O열 · 메모를 P열에 16열로 쓴다 · 머리 M~P 는 빈 칸만 채운다
         ② 입고 «단가» — 숫자 검사 · 지난 입고 단가(입고기록 M열 · 날짜순 마지막 · 없으면 품목 매입단가) · % 차이
            · 입고기록 13열(M=단가) · 원재료품목 [13] 매입단가 갱신 · 입력칸 16px
         ③ ERP 보정 — 같은 (kind,item,key) 나중 줄이 이김 · 취소 무시 · 그날 생산/출하 덮기 · LOT 잔량 · 원재료 재고 · 날짜별 입고/사용
            · 화면 배선(홈 생산계획 · 재고관리 · 홈 발주 알림 · 원재료 품목 · LOT 상세 · 발주점 제안)
         ④ (선택) ERP 원본 함수와 같은 답 — 환경변수 ERP_FACTORY_MODEL 에 maytutu-erp app/factory-board-model.mjs 경로를 주면 대조한다

   실행:  node tests/factory-stage3.test.js
          ERP_FACTORY_MODEL=../erp/app/factory-board-model.mjs node tests/factory-stage3.test.js   (ERP 대조까지)      */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
// 있음 검사는 주석을 걷어낸 사본으로 — 설명 주석에 같은 글자가 있으면 코드가 없어도 초록이 된다
const CODE = SRC.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const block = (name) => {
  const i = SRC.indexOf(`// <${name}>`), j = SRC.indexOf(`// </${name}>`);
  assert.ok(i !== -1 && j > i, `index.html 에서 <${name}> 블록을 찾지 못함`);
  return SRC.slice(i, j);
};
//  함수 하나만 — 다음 최상위 선언(줄 첫머리의 function · async function · Screens)에서 끊는다(이웃 함수의 글자가 섞여 초록이 되지 않게)
const fnBody = (sig, span = 6000) => {
  const i = CODE.indexOf(sig); assert.notStrictEqual(i, -1, `${sig} 없음`);
  const rest = CODE.slice(i + sig.length), m = /\n(?:async function |function |Screens[.[])/.exec(rest);
  return CODE.slice(i, i + sig.length + Math.min(m ? m.index : rest.length, span));
};

const writes = [];
const ctx = vm.createContext({
  Math, Date, JSON, Map, Set, Array, String, Number, Object, parseFloat, parseInt, isFinite, isNaN, console,
  parseSkuUnit: (sku) => { const m = String(sku || '').match(/^(\d+)(kg|L|알)\/(통|판|포대|봉)/); if (!m) return null; const n = +m[1]; return m[2] === '알' ? { perUnit: n * 0.05, unitName: m[3] } : { perUnit: n, unitName: m[3] }; },
  toast: () => {},
  SheetsAPI: {
    getAll: async (tab) => (ctx.__tabs[tab] || (() => { throw new Error('Sheets GET ' + tab + ': 400'); })()),
    getRange: async () => ctx.__range || [],
    batchUpdate: async (d) => { writes.push(['batch', d]); },
    updateCell: async (...a) => { writes.push(['cell', a]); if (ctx.__failCell) throw new Error('x'); },
    invalidateCache: () => {},
  },
});
ctx.__tabs = {};
['ship-dest', 'rcv-price', 'erp-adj', 'reorder-calc'].forEach((b) => vm.runInContext(block(b), ctx));
const { SHIP_DEST, ShipDest, RCV_PRICE, RcvPrice, ERP_ADJ, ErpAdj } = vm.runInContext('({ SHIP_DEST, ShipDest, RCV_PRICE, RcvPrice, ERP_ADJ, ErpAdj })', ctx);
const { rpWeeklyUse, rpUseSeries, rpReceiptGaps } = ctx;

const ok = [];
const t = async (n, f) => { await f(); ok.push(n); };
const plain = (v) => JSON.parse(JSON.stringify(v));
//  vm 안에서 만든 배열·객체는 다른 realm 이라 deepStrictEqual 이 «같은 모양, 다른 참조» 로 떨어진다 — JSON 으로 옮겨 비교한다
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);

(async () => {
/* ── ① 받는 곳 ─────────────────────────────────────────── */
await t('받는 곳 값 네 개 — ERP shipDest 가 가르는 글자 그대로 · 기본 가맹점 · «테스트» 낱말 없음', () => {
  eq(plain(SHIP_DEST.OPTIONS), ['가맹점', '송도 직영', 'R&D 시험', 'B2B 샘플']);
  assert.strictEqual(SHIP_DEST.DEFAULT, '가맹점');
  SHIP_DEST.OPTIONS.concat(SHIP_DEST.METHODS).forEach((v) => assert.ok(!/테스트|E2E/i.test(v), `ERP 가 시험 데이터로 거르는 낱말: ${v}`));
  eq(plain(SHIP_DEST.METHODS), ['직접 출하', '택배'], 'C열(customer)은 옛 출하 창과 같은 배송 방식 글자');
});
await t('검사 — R&D 시험·B2B 샘플은 메모 필수 · 가맹점·송도 직영은 메모 없이도 된다 · 모르는 값은 막는다', () => {
  eq(plain(ShipDest.check('가맹점', '', '직접 출하')), { ok: true, to: '가맹점', memo: '', method: '직접 출하' });
  assert.strictEqual(ShipDest.check('송도 직영', '  ', '택배').ok, true);
  assert.strictEqual(ShipDest.check('R&D 시험', '', '직접 출하').ok, false);
  assert.strictEqual(ShipDest.check('B2B 샘플', '   ', '직접 출하').ok, false, '빈칸만 있는 메모도 없는 것');
  eq(plain(ShipDest.check('B2B 샘플', ' 카페  A   샘플 ', '택배')), { ok: true, to: 'B2B 샘플', memo: '카페 A 샘플', method: '택배' });
  ['', '송도직영점', '테스트', null, undefined].forEach((v) => assert.strictEqual(ShipDest.check(v, 'x', '직접 출하').ok, false, String(v)));
  assert.strictEqual(ShipDest.check('가맹점', '', '이상한 방식').method, '직접 출하', '받는 방식은 모르는 값이면 기본값');
  assert.strictEqual(ShipDest.check('가맹점', 'x'.repeat(500), '').memo.length, SHIP_DEST.MEMO_MAX);
});
await t('ERP shipDest 와 맞물림 — 이 앱이 쓰는 값이 ERP 에서 의도한 갈래로 간다(ERP 규칙 사본 · 원본 대조는 ④)', () => {
  //  maytutu-erp factory-board-model.mjs shipDest (3단계 PR #5004) 의 판정 그대로
  const shipDest = (row) => { const to = String((row && row[14]) || '').replace(/\s+/g, ''); if (/송도직영/.test(to)) return 'sd'; if (/R&D|시험/i.test(to)) return 'etc'; if (/샘플|B2B/i.test(to)) return 'etc'; return 'fr'; };
  const row = (v) => Object.assign(Array(16).fill(''), { 14: v });
  eq(plain(SHIP_DEST.OPTIONS.map((v) => shipDest(row(v)))), ['fr', 'sd', 'etc', 'etc']);
  assert.strictEqual(shipDest(row('')), 'fr', '옛 줄(O열 빈칸)은 가맹 출하');
  assert.strictEqual(ShipDest.of(row('')), '가맹점');
  assert.strictEqual(ShipDest.of(row('B2B 샘플')), 'B2B 샘플');
});
await t('메모가 수식으로 읽히지 않게 — = + - @ 로 시작하면 작은따옴표', () => {
  assert.strictEqual(ShipDest.cell('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(ShipDest.cell('-10봉 반품'), "'-10봉 반품");
  assert.strictEqual(ShipDest.cell('신규 반죽 배합 비교'), '신규 반죽 배합 비교');
  assert.strictEqual(ShipDest.cell(''), '');
});
await t('출하기록 머리 M~P — 빈 칸만 채운다(사람이 고친 제목·송도 직배가 쓴 제목은 그대로)', async () => {
  eq(plain(ShipDest.headerPatch(['송장·전표번호', '받는 방식', '받는 곳'])), [{ range: '출하기록!P1', values: [['메모']] }]);
  eq(plain(ShipDest.headerPatch([])).map((x) => x.range), ['출하기록!M1', '출하기록!N1', '출하기록!O1', '출하기록!P1']);
  eq(plain(ShipDest.headerPatch(['전표', '방식', '도착지', '비고'])), []);
  eq(plain(SHIP_DEST.HDR).slice(2), ['받는 곳', '메모']);
  writes.length = 0; ctx.__range = [['송장·전표번호', '받는 방식', '받는 곳']];
  await ShipDest.ensureHeader(); await ShipDest.ensureHeader();
  assert.strictEqual(writes.length, 1, '한 세션에 한 번만 쓴다');
});
await t('출하 창 셋 — 받는 곳 칸을 띄우고, 읽어 검사하고, O·P 열까지 16열로 쓴다', () => {
  for (const [pop, exe, p] of [['async function showShipmentPopup(', 'async function executeShipment(', 'ship-note'],
    ['async function showSelectedShipmentPopup(', 'async function executeSelectedShipment(', 'sel-ship-note'],
    ['async function showLotShipmentPopup(', 'async function executeLotShipment(', 'lot-ship-note']]) {
    const ui = fnBody(pop, 2600);
    assert.ok(ui.includes(`ShipDest.fieldsHtml('${p}')`) && ui.includes(`ShipDest.bind(overlay, '${p}')`) && ui.includes(`ShipDest.read(overlay, '${p}')`), `${pop}: 받는 곳 칸 배선 없음`);
    assert.ok(/if \(!d\.ok\) \{ toast\(d\.msg/.test(ui), `${pop}: 메모 없으면 막는 분기 없음`);
    const body = fnBody(exe, 5000);
    assert.ok(body.includes('ShipDest.ensureHeader()'), `${exe}: 머리 채우기 없음`);
    const rows = body.match(/'', '', to\.to, ShipDest\.cell\(to\.memo\)/g) || [];
    assert.strictEqual(rows.length, 1, `${exe}: 출하기록 행 끝에 M·N 빈칸 + O 받는 곳 + P 메모가 없다`);
  }
  // LOT 잔량 차감 흐름은 그대로 — 남은 개별 수로 LOT [8](I열) · 다 나가면 출하완료
  ['async function executeShipment(', 'async function executeSelectedShipment(', 'async function executeLotShipment('].forEach((s) => {
    const b = fnBody(s, 5000);
    assert.ok(/완제품LOT!I\$\{/.test(b) && /완제품LOT!J\$\{/.test(b) && b.includes("'출하완료'"), `${s}: LOT 잔량·상태 갱신이 사라졌다`);
  });
  assert.ok(/'출하기록': \['shipId'[^\]]*'ref','method','dest','memo'\]/.test(CODE), 'DB 조회 정의 출하기록 16열(M~P)');
});
await t('출하 창 입력칸 — 글자 16px(아이폰이 눌렀을 때 확대하지 않게) · label for 로 묶음', () => {
  const html = ShipDest.fieldsHtml('x');
  assert.strictEqual((html.match(/font-size:16px/g) || []).length, 3, '받는 곳 · 받는 방식 · 메모 세 칸');
  ['x-dest', 'x-method', 'x-memo'].forEach((id) => assert.ok(html.includes(`for="${id}"`) && html.includes(`id="${id}"`), id));
  assert.ok(/<option value="가맹점" selected>/.test(html), '기본 선택 = 가맹점');
});

/* ── ② 입고 단가 ───────────────────────────────────────── */
await t('단가 읽기·검사 — 빈칸은 «없음», 0·음수·글자는 막고, 정수 원으로', () => {
  assert.strictEqual(RcvPrice.num('1,234원'), 1234);
  assert.strictEqual(RcvPrice.num(''), null);
  eq(plain(RcvPrice.check('')), { ok: true, price: null });
  eq(plain(RcvPrice.check(' 228.4 ')), { ok: true, price: 228 });
  ['0', '-5', 'abc', '1e9'].forEach((v) => assert.strictEqual(RcvPrice.check(v).ok, false, v));
});
await t('날짜 — 시트 서식 셋을 다 읽는다(한 자리 시 · 오전/오후 · 슬래시)', () => {
  assert.strictEqual(RcvPrice.day('2026-11-06 8:57'), '2026-11-06');
  assert.strictEqual(RcvPrice.day('2026. 11. 6 오전 8:57:00'), '2026-11-06');
  assert.strictEqual(RcvPrice.day('2026/11/6'), '2026-11-06');
  assert.strictEqual(RcvPrice.day(''), '');
});
const R = (rcv, code, day, price, st = '완료', type = '원재료') => [rcv, type, 'V001', code, 'x', 'L', '10', 'kg', day, 'a@b', st, '', price];
await t('지난 입고 단가 — 같은 품목 · 원재료 · 취소 아님 · 단가 있는 줄 중 날짜순 마지막(같은 날은 시트 순서) · 없으면 품목 매입단가', () => {
  const rows = [R('1', 'RM001', '2026-11-04 9:00', '205'), R('2', 'RM001', '2026-11-05 8:00', '210', '입고취소'), R('3', 'RM001', '2026-11-03 9:00', '199'),
    R('4', 'RM006', '2026-11-06 9:00', '3000'), R('5', 'RM001', '2026-11-05 9:00', ''), R('6', 'RM001', '2026-11-05 10:00', '9', '완료', '소모품')];
  eq(plain(RcvPrice.last(rows, ['RM001', '계란'])), { price: 205, day: '2026-11-04', src: '입고' });
  const sameDay = [R('a', 'RM011', '2026-11-04 9:00', '1000'), R('b', 'RM011', '2026-11-04 8:00', '1100')];
  assert.strictEqual(RcvPrice.last(sameDay, ['RM011']).price, 1100, '같은 날은 시트 순서(나중 줄)');
  const item = Object.assign(Array(14).fill(''), { 0: 'RM009', 13: '4,560' });
  eq(plain(RcvPrice.last([], item)), { price: 4560, day: '', src: '품목' });
  assert.strictEqual(RcvPrice.last([], ['RM010']), null);
});
await t('% 차이 · 크게 다르면 묻기(50% 넘게) — 목업 예시 205 → 228 = +11%', () => {
  assert.strictEqual(RcvPrice.chg(228, 205), 11);
  assert.strictEqual(RcvPrice.chg(100, 0), null);
  assert.strictEqual(RcvPrice.bigJump(228, 205), false);
  assert.strictEqual(RcvPrice.bigJump(2280, 228), true, '포대 단가를 kg 칸에 넣은 실수');
  assert.strictEqual(RcvPrice.bigJump(100, 200), false, '정확히 −50% 는 묻지 않는다');
  assert.strictEqual(RcvPrice.bigJump(99, 200), false, '−50.5% 는 정수 % 로 −50% — 묻지 않는다(화면에 보이는 % 와 같은 값으로 판단)');
  assert.strictEqual(RcvPrice.bigJump(90, 200), true, '−55%');
  assert.strictEqual(RCV_PRICE.JUMP_PCT, 50);
});
await t('안내 글 — 지난 단가 · % · 포장 단위 환산 · 합계 · 매입단가가 바뀐다는 말', () => {
  const h = RcvPrice.hintHtml({ price: 228, last: { price: 205, day: '2026-11-04', src: '입고' }, unit: 'kg', sku: '10kg/포대', qtyKg: 150 });
  ['지난 단가 205원/kg (11/04 입고)', '+11%', '포대당 ≈ 2,280원', '이번 입고 ≈ 34,200원', '매입단가도'].forEach((s) => assert.ok(h.includes(s), `${s} 없음: ${h}`));
  assert.ok(RcvPrice.hintHtml({ price: 0, last: null, unit: 'kg' }).includes('지난 입고 단가 없음'));
  assert.ok(RcvPrice.hintHtml({ price: 205, last: { price: 205, day: '', src: '품목' }, unit: 'kg' }).includes('변동 없음'));
});
await t('매입단가 갱신 — 원재료품목 [13] · 실패해도 입고는 막지 않는다', async () => {
  writes.length = 0;
  assert.strictEqual(await RcvPrice.saveItemPrice('RM001', 228), true);
  eq(plain(writes), [['cell', ['원재료품목', 0, 'RM001', 13, '228']]]);
  ctx.__failCell = true; assert.strictEqual(await RcvPrice.saveItemPrice('RM001', 228), false); ctx.__failCell = false;
  writes.length = 0; assert.strictEqual(await RcvPrice.saveItemPrice('RM001', null), true); assert.strictEqual(writes.length, 0, '단가 없으면 안 건드린다');
});
await t('입고 화면 배선 — 단가 칸(16px · 원재료만) · 입고기록 13열 M=단가 · 매입단가 갱신 · 큰 차이는 확인 · 구매주문 수령도 같은 열', () => {
  const form = fnBody("Screens['receive-form'] = async () => {", 6000);
  assert.ok(/id="rcv-price" inputmode="decimal"[^>]*font-size:16px/.test(form), '단가 입력칸(16px · 숫자 자판) 없음');
  assert.ok(form.includes("SheetsAPI.getAll('입고기록')") && form.includes('window._rcvRecs = rcvRecs'), '지난 단가용 입고기록 읽기 없음');
  assert.ok(/priceGroup\.style\.display = type === '소모품' \? 'none' : ''/.test(CODE), '소모품이면 단가 칸 숨김 없음');
  const sub = fnBody('async function submitReceiving(priceConfirmed = false) {', 6000);
  assert.ok(sub.indexOf('RcvPrice.check(') < sub.indexOf("acquireLock('submitReceiving')"), '잠금 전에 단가를 검사해야 확인 창에서 돌아올 수 있다');
  assert.ok(sub.includes('RcvPrice.bigJump(') && sub.includes('submitReceiving(true)'), '큰 차이 확인 없음');
  assert.ok(/'완료', photoUrl, type === '원재료' && rcvPrice \? String\(rcvPrice\) : ''\s*\]\);/.test(sub), '입고기록 M열 단가 없음');
  assert.ok(sub.includes('RcvPrice.saveItemPrice(itemCode, rcvPrice)'), '매입단가 갱신 없음');
  const po = fnBody('async function savePOReceive(poId) {', 3500);
  assert.ok(/'완료', '', pr\.price \? String\(pr\.price\) : ''\s*\]\);/.test(po) && po.includes('RcvPrice.saveItemPrice(itemCode, pr.price)'), '구매주문 수령: M열 단가·매입단가 갱신 없음');
  assert.ok(/id="po-recv-price" inputmode="decimal"[^>]*font-size:16px/.test(CODE), '구매주문 수령 단가 칸 없음');
  assert.ok(/'입고기록': \[[^\]]*'photoUrl','unitPrice'\]/.test(CODE), 'DB 조회 정의 입고기록 13열(M=단가)');
});

/* ── ③ ERP 보정 ────────────────────────────────────────── */
//  열: id, at, by, kind, item, key, label, scope, before, after, memo, report, status
const A = (o) => ERP_ADJ.COLS.map((c) => (o[c] == null ? '' : o[c]));
await t('살아 있는 보정 — 같은 대상은 나중 줄이 이김 · 취소 무시 · 숫자 아닌 after·음수 무시 · 모르는 kind·빈 key 무시', () => {
  const rows = [
    A({ id: 'a1', kind: 'lot', item: 'FG002', key: 'FG-002-A', before: '40', after: '30', memo: '실사' }),
    A({ id: 'a2', kind: 'lot', item: 'FG002', key: 'FG-002-A', before: '40', after: '28', memo: '재실사' }),   // 나중 줄이 이김
    A({ id: 'a3', kind: 'rm', key: 'RM001', after: '1,234.5' }),                                              // 쉼표 숫자
    A({ id: 'a4', kind: 'rm', key: 'RM006', after: '50' }), A({ id: 'a5', kind: 'rm', key: 'RM006', after: '60', status: '취소' }),   // 마지막 줄이 취소 → 없다
    A({ id: 'a6', kind: 'ship', item: 'FG002', key: '2026-11-04', after: '' }),                               // after 빈칸 → 없다
    A({ id: 'a7', kind: 'ship', item: 'FG002', key: '2026-11-03', after: '-1' }),
    A({ id: 'a8', kind: 'xxx', key: 'k', after: '1' }), A({ id: 'a9', kind: 'rm', key: '', after: '1' }), null, 'junk',
  ];
  const act = ErpAdj.active(rows);
  eq(act.map((a) => [a.id, a.after]), [['a2', 28], ['a3', 1234.5]]);
  assert.strictEqual(act[0].memo, '재실사');
});
await t('그날 생산/출하 덮기 — 그 품목 · 그 날의 이벤트를 걷고 보정값 하나(0 이면 그날 없음) · 다른 품목은 그대로 · 원본 배열 보존', () => {
  const ev = [{ date: '2026-11-03 09:00', packs: 1 }, { date: '2026-11-03 10:00', packs: 1 }, { date: '2026-11-04', packs: 5 }];
  const adjs = ErpAdj.active([A({ kind: 'ship', item: 'FG002', key: '2026-11-03', after: '6' }), A({ kind: 'ship', item: 'FG002', key: '2026-11-04', after: '0' }),
    A({ kind: 'ship', item: 'FG009', key: '2026-11-03', after: '99' }), A({ kind: 'prod', item: 'FG002', key: '2026-11-03', after: '40' })]);
  const r = ErpAdj.applyDay(ev, adjs, 'ship', 'FG002');
  eq(plain(r.events), [{ date: '2026-11-03', packs: 6 }]);
  eq([...r.days].sort(), ['2026-11-03', '2026-11-04']);
  assert.strictEqual(ev.length, 3, '원본 배열을 건드렸다');
  const none = ErpAdj.applyDay(ev, adjs, 'ship', 'FG777');
  assert.strictEqual(none.events, ev); assert.strictEqual(none.days.size, 0);
  eq(plain(ErpAdj.applyDay([], adjs, 'prod', 'FG002').events), [{ date: '2026-11-03', packs: 40 }], '없던 날은 새로 생긴다');
});
await t('LOT 잔량 · 원재료 재고 · 날짜별 수불 지도 + 고른 값(pick)', () => {
  const adjs = ErpAdj.active([A({ kind: 'lot', item: 'FG002', key: 'FG-002-A', after: '30' }), A({ kind: 'rm', key: 'RM001', after: '75' }),
    A({ kind: 'rmin', key: 'RM001|2026-11-04', after: '0' }), A({ kind: 'rmout', key: 'RM001|2026. 11. 5', after: '48' }), A({ kind: 'rmout', key: '날짜없음', after: '1' })]);
  assert.strictEqual(ErpAdj.lotMap(adjs).get('FG-002-A').after, 30);
  eq(plain(ErpAdj.pick(ErpAdj.rmMap(adjs), 'RM001', 90)), { value: 75, adj: plain(ErpAdj.rmMap(adjs).get('RM001')), base: 90 });
  eq(plain(ErpAdj.pick(ErpAdj.rmMap(adjs), 'RM006', 12)), { value: 12, adj: null, base: 12 });
  eq([...ErpAdj.flowMap(adjs, 'rmin')], [['RM001|2026-11-04', 0]]);
  eq([...ErpAdj.flowMap(adjs, 'rmout')], [['RM001|2026-11-05', 48]], '날짜 글자 정규화 · 키 모양이 틀린 줄은 버린다');
});
await t('«ERP 보정» 딱지 — 앞뒤 값·사유·수정자를 담고 글자를 이스케이프', () => {
  const [a] = ErpAdj.active([A({ kind: 'rm', key: 'RM001', before: '90', after: '75', memo: '<b>실사</b>', by: 'x@y', at: '2026-11-06 10:00' })]);
  const b = ErpAdj.badge(a, 90);
  assert.ok(b.includes('>ERP 보정</span>') && b.includes('90 → 75') && b.includes('&lt;b>실사') && !b.includes('<b>실사'), b);   // 따옴표 안 속성값 — < & " 만 막으면 태그·속성 탈출이 안 된다
  assert.strictEqual(ErpAdj.badge(null), '');
});
await t('보정 탭 읽기 — 없거나 못 읽으면 빈 목록(화면은 원본 숫자로)', async () => {
  eq(plain(await ErpAdj.load()), [], '탭 없음(400)');
  ctx.__tabs[ERP_ADJ.TAB] = [A({ kind: 'rm', key: 'RM001', after: '5' })];
  eq(await ErpAdj.load(), [], '탭이 없다고 안 뒤 5분은 다시 묻지 않는다(화면마다 400 요청이 쌓이지 않게)');
  ErpAdj._missUntil = 0;
  assert.strictEqual((await ErpAdj.load()).length, 1);
  delete ctx.__tabs[ERP_ADJ.TAB];
});
await t('발주점 제안 — ERP 가 고친 날짜별 사용(rmout)·입고(rmin)를 반영 · 보정 없으면 예전과 같은 값', () => {
  const asOf = new Date('2026/11/06 12:00');
  const lots = [['RM-001-A', 'RM001']];
  const proc = (day, q) => ['WO', '1', 'x', 'input', 'RM-001-A-01', JSON.stringify({ inputQty: q }), '', '', '', '', '', day];
  const P = [proc('2026-10-27 9:00', 10), proc('2026-10-28 9:00', 10), proc('2026-10-29 9:00', 5)];   // 10/26 주 = 25
  const base = rpWeeklyUse(P, lots, asOf).get('RM001');
  const same = rpWeeklyUse(P, lots, asOf, new Map([['RM006|2026-10-28', 99]])).get('RM001');
  eq([...same], [...base], '다른 품목 보정은 이 품목 값을 바꾸지 않는다(하루 단위로 모아도 주 합은 같다)');
  const ov = rpWeeklyUse(P, lots, asOf, new Map([['RM001|2026-10-28', 30], ['RM001|2026-10-29', 0], ['RM001|2026-11-06', 50]])).get('RM001');
  eq([...ov.values()], [40], '10 + 30(고친 날) + 0(없앤 날) · 진행 중인 주(11/06)는 빼고');
  const R2 = (d) => ['r', '원재료', 'V', 'RM001', 'x', 'L', '1', 'kg', d, '', '완료', '', ''];
  const rc = [R2('2026-11-02 9:00'), R2('2026-11-04 9:00')];
  eq(rpReceiptGaps(rc, 'RM001', asOf), [2]);
  eq(rpReceiptGaps(rc, 'RM001', asOf, new Map([['RM001|2026-11-03', 20], ['RM001|2026-11-04', 0], ['RM006|2026-11-05', 3]])), [1], '11/03 입고 생김 · 11/04 입고 없앰');
  assert.ok(rpUseSeries(ov, asOf).length >= 1);
});
await t('화면 배선 — 보정을 읽는 곳 여섯(홈 생산계획 · 재고관리 · 홈 발주 알림 · 원재료 품목 · LOT 상세 · 발주점 제안) · 원본 시트에 쓰지 않는다', () => {
  const plan = fnBody('async function loadHomeProdPlan() {', 7000);
  assert.ok(plan.includes('ErpAdj.load()') && plan.includes("ErpAdj.applyDay(") && /'ship', code\)/.test(plan) && /'prod', code\)/.test(plan) && plan.includes('lotAdj.has(l[0]) ? lotAdj.get(l[0]).after'), '홈 생산계획: LOT·생산·출하 보정');
  assert.ok(plan.includes('${ERP_ADJ.LABEL} ${c.adjN}건'), '홈 생산계획: 보정 표시');
  const inv = fnBody('Screens.inventory = async () => {', 1500);
  assert.ok(inv.includes('ErpAdj.load()') && inv.includes('State.erpAdj = erpAdj'), '재고관리: 보정 읽기');
  const tab = fnBody('async function renderInventoryContent(activeTab) {', 12000);
  assert.ok(tab.includes('ErpAdj.rmMap(State.erpAdj)') && tab.includes('ErpAdj.badge(rmPick.adj, lotSum)'), '재고관리 원재료: 재고 보정·표시');
  assert.ok(tab.includes('ErpAdj.lotMap(State.erpAdj)') && tab.includes('ErpAdj.badge(l._adj, l._appCount)'), '재고관리 완제품: LOT 잔량 보정·표시');
  const dash = fnBody('Screens.dashboard = async () => {', 5000);
  assert.ok(dash.includes('ErpAdj.load()') && dash.includes('ErpAdj.pick(rmAdj, code,') && dash.includes('adj: rmAdj.get(code) || null'), '홈 발주 알림: 재고 보정');
  assert.strictEqual((CODE.match(/\$\{item\.adj \? " " \+ ErpAdj\.badge\(item\.adj\) : ""\}/g) || []).length, 2, '홈 발주 알림 두 곳에 보정 표시');
  const rm = fnBody("Screens['items-rm'] = async () => {", 4000);
  assert.ok(rm.includes('ErpAdj.load()') && rm.includes('ErpAdj.badge(rmPick.adj, lotSum)'), '원재료 품목: 재고 보정·표시');
  const lot = fnBody("Screens['lot-detail'] = async (params = {}) => {", 9000);
  assert.ok(lot.includes('ErpAdj.load()') && lot.includes('ErpAdj.lotMap(erpAdj)') && lot.includes('ErpAdj.rmMap(erpAdj)') && lot.includes('ErpAdj.badge(fgLotAdj.get(l[0])'), 'LOT 상세: 보정·표시');
  const rp = fnBody('async function rpRenderSuggestion(', 3000);
  assert.ok(rp.includes("ErpAdj.flowMap(adjs, 'rmout')") && rp.includes("ErpAdj.flowMap(adjs, 'rmin')") && rp.includes('rpWeeklyUse(proc, lots, asOf, useOv)') && rp.includes('rpReceiptGaps(rcv, code, asOf, rcvOv)'), '발주점 제안: 수불 보정');
  //  읽기만 한다 — 보정 탭·원본 탭을 이 블록이 쓰지 않는다
  const adjBlock = block('erp-adj').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/SheetsAPI\.(append|update|batchUpdate|updateCell|updateRow)/.test(adjBlock), '<erp-adj> 가 시트에 쓴다');
  assert.ok(!new RegExp(`(append|update)\\(\\s*['"\`]${ERP_ADJ.TAB}`).test(CODE), 'ERP_실적보정 탭에 쓰는 코드가 있다');
});

/* ── ④ ERP 원본 함수와 같은 답(선택) ─────────────────────── */
const erpPath = process.env.ERP_FACTORY_MODEL;
if (erpPath) {
  const M = await import(require('url').pathToFileURL(path.resolve(erpPath)).href);
  await t('ERP 대조 — activeAdjustments · applyDayAdjust · shipDest 와 같은 답', () => {
    const rows = [
      A({ id: '1', kind: 'lot', item: 'FG002', key: 'L1', after: '30' }), A({ id: '2', kind: 'lot', item: 'FG002', key: 'L1', after: '28' }),
      A({ id: '3', kind: 'ship', item: 'FG002', key: '2026-11-03', after: '6' }), A({ id: '4', kind: 'ship', item: 'FG002', key: '2026-11-04', after: '0' }),
      A({ id: '5', kind: 'rm', key: 'RM006', after: '50' }), A({ id: '6', kind: 'rm', key: 'RM006', after: '60', status: '취소' }),
      A({ id: '7', kind: 'prod', item: 'FG002', key: '2026-11-02', after: '-3' }), A({ id: '8', kind: 'rmout', key: 'RM001|2026-11-05', after: '48' }),
    ];
    const objs = rows.map((r) => Object.fromEntries(ERP_ADJ.COLS.map((c, i) => [c, r[i]])));
    const erp = M.activeAdjustments(objs).map((a) => [a.kind, a.item, a.key, a.after]).sort();
    const app = ErpAdj.active(rows).map((a) => [a.kind, a.item, a.key, a.after]).sort();
    eq(app, erp);
    const ev = [{ date: '2026-11-03 09:00', packs: 1 }, { date: '2026-11-04', packs: 5 }, { date: '2026-11-05', packs: 2 }];
    const e1 = M.applyDayAdjust(ev, M.activeAdjustments(objs).filter((a) => a.item === 'FG002'), 'ship');
    const a1 = ErpAdj.applyDay(ev, ErpAdj.active(rows), 'ship', 'FG002');
    eq(plain(a1.events).map((e) => [String(e.date).slice(0, 10), e.packs]).sort(), plain(e1.events).map((e) => [String(e.date).slice(0, 10), e.packs]).sort());
    eq([...a1.days].sort(), [...e1.days].sort());
    if (M.shipDest) eq(plain(SHIP_DEST.OPTIONS).map((v) => M.shipDest(Object.assign(Array(16).fill(''), { 14: v })).label), ['가맹 출하', '송도 직영', 'R&D 시험', 'B2B 샘플']);
  });
} else console.log('  (ERP 대조 건너뜀 — ERP_FACTORY_MODEL 환경변수 없음)');

console.log(ok.map((n) => '  ✓ ' + n).join('\n'));
console.log(`factory-stage3: ${ok.length}건 통과`);
})().catch((e) => { console.error(e); process.exit(1); });
