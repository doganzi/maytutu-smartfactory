/* 박스 출하 1단계 — 봉 라벨 2장 + 겉 라벨·송장 찍기 (2026-10-04 결정)
   index.html 의 <box-ship>·<label-dup> 블록을 그대로 떼어 돌린다(사본을 두면 원본과 갈라진다).

   확인:  ① 찍은 코드 가르기 — FG-… 봉 라벨 / 숫자 송장 / 그 밖
         ② 봉 담기 — 중복·미등록·출하완료·폐기·냉동보관중은 거절, 출하가능만 담는다
         ③ 송장 — 봉이 먼저 · 같은 송장 두 번 금지 · 3·4봉이 아니면 확인
         ④ shipId 연속 채번 — 한 상자 n봉이 서로 다른 번호(옛 일괄 출하는 같은 번호를 받았다)
         ⑤ 출하기록 15열 — 송장·전표번호 / 받는 방식 / 받는 곳 · 송도·콜로는 받는 곳이 바로 찬다
         ⑥ 라벨 사본 — 봉 라벨만 바로 다음 장에(A A B B)
         ⑦ 연결 — 옛 출하 창·선택 출하가 없고, 새 화면이 라우터·스캔 결과·인쇄·스키마에 붙어 있다
         ⑧ 안내 흐름 — 단계 표시·다음에 할 일·오늘 수·소리·끝내기, 저장 직후 같은 송장 재스캔은 «이미 저장»

   실행:  node tests/box-ship.test.js                                                         */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
// 있음 검사는 주석을 걷어낸 사본으로 — 설명 주석에 같은 글자가 있으면 코드가 없어도 초록이 된다. 없음 검사는 주석까지 본다(SRC).
const CODE = SRC.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

function slice(a, b) {
  const i = SRC.indexOf(a), j = SRC.indexOf(b);
  assert.ok(i !== -1 && j > i, `index.html 에서 ${a} 블록을 찾지 못함`);
  return SRC.slice(i, j);
}
const store = new Map();
const ctx = vm.createContext({
  Math, Date, JSON, Map, Set, Array, String, parseInt, console,
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});
vm.runInContext(slice('// <box-ship>', '// </box-ship>') + slice('// <label-dup>', '// </label-dup>'), ctx);
// const 선언은 컨텍스트 객체에 안 붙는다 — 값으로 꺼낸다
const { BoxShip, BOX_SHIP_CFG, LabelDup } = vm.runInContext('({ BoxShip, BOX_SHIP_CFG, LabelDup })', ctx);

const ok = [];
const t = (n, f) => { f(); ok.push(n); };
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ── ① 가르기 ─────────────────────────────────────────── */
t('봉 라벨은 FG- 로 시작 — 대소문자·앞뒤 공백 무시하고 대문자로', () => {
  assert.deepStrictEqual(plain(BoxShip.classify('  fg-260930-001-03 ')), { kind: 'fg', code: 'FG-260930-001-03' });
});
t('송장은 숫자 10~14자리 — 공백·하이픈은 걷어낸다', () => {
  assert.deepStrictEqual(plain(BoxShip.classify('5012-3456-7890')), { kind: 'waybill', code: '501234567890' });
  assert.strictEqual(BoxShip.classify('123456789').kind, 'unknown', '9자리는 송장이 아니다');
  assert.strictEqual(BoxShip.classify('123456789012345').kind, 'unknown', '15자리는 송장이 아니다');
  assert.strictEqual(BoxShip.classify('LOT-260930-001').kind, 'unknown');
  assert.strictEqual(BoxShip.classify(null).kind, 'unknown');
});

/* ── ② 봉 담기 ────────────────────────────────────────── */
t('출하가능 봉만 담는다 — 그 밖은 이유를 단다', () => {
  const bags = [{ indivId: 'FG-A' }];
  assert.strictEqual(BoxShip.checkBag(bags, 'FG-B', { status: '출하가능' }).ok, true);
  assert.strictEqual(BoxShip.checkBag(bags, 'FG-A', { status: '출하가능' }).reason, 'dup');
  assert.strictEqual(BoxShip.checkBag(bags, 'FG-C', undefined).reason, 'notfound');
  assert.strictEqual(BoxShip.checkBag(bags, 'FG-C', { status: '출하완료' }).reason, 'shipped');
  assert.deepStrictEqual(plain(BoxShip.checkBag(bags, 'FG-C', { status: '폐기' })), { ok: false, reason: 'blocked', status: '폐기' });
  assert.deepStrictEqual(plain(BoxShip.checkBag(bags, 'FG-C', { status: '' })), { ok: false, reason: 'notready', status: '냉동보관중' });
  assert.deepStrictEqual(plain(BoxShip.checkBag(bags, 'FG-C', { status: '냉동보관중' })), { ok: false, reason: 'notready', status: '냉동보관중' });
});
t('거절 이유마다 한국어 문구가 있다', () => {
  ['dup', 'notfound', 'shipped', 'nobags', 'usedWaybill', 'saved'].forEach((r) => assert.notStrictEqual(BoxShip.message({ reason: r }), '처리할 수 없습니다', r));
  assert.ok(BoxShip.message({ reason: 'blocked', status: '폐기' }).includes('폐기'));
});

/* ── ③ 송장 ───────────────────────────────────────────── */
t('송장은 봉이 먼저 · 다른 상자가 쓴 송장 거절 · 끊긴 저장(같은 봉)은 이어서 · 3·4봉이 아니면 확인', () => {
  const b = (n) => Array.from({ length: n }, (_, i) => ({ indivId: 'FG-' + i }));
  const W = '501234567890';
  assert.strictEqual(BoxShip.checkWaybill([], W, new Map()).reason, 'nobags');
  assert.strictEqual(BoxShip.checkWaybill(b(3), W, new Map([[W, ['FG-0', 'FG-9']]])).reason, 'usedWaybill', '다른 봉이 적힌 송장');
  assert.deepStrictEqual(plain(BoxShip.checkWaybill(b(3), W, new Map([[W, ['FG-0', 'FG-1']]]))), { ok: true, confirm: false }, '같은 봉 = 이어 쓰기');
  assert.deepStrictEqual(plain(BoxShip.checkWaybill(b(3), W, new Map())), { ok: true, confirm: false });
  assert.deepStrictEqual(plain(BoxShip.checkWaybill(b(4), W, new Map())), { ok: true, confirm: false });
  assert.strictEqual(BoxShip.checkWaybill(b(2), W, new Map()).confirm, true);
  assert.strictEqual(BoxShip.checkWaybill(b(5), W, new Map()).confirm, true);
});

/* ── ③-2 저장 계획 — 세 번에 나눠 쓰다 끊겨도 같은 봉이 두 번 출하되지 않는다 ── */
t('저장 계획 — 처음 저장 · 남이 처리한 봉 · 다른 상자 송장 · 끊긴 저장 이어 쓰기', () => {
  const bags = [{ indivId: 'FG-1' }, { indivId: 'FG-2' }, { indivId: 'FG-3' }];
  const ids = (a) => a.map((x) => x.indivId);
  const st = (m) => (id) => m[id];
  const fresh = BoxShip.planSave(bags, st({ 'FG-1': '출하가능', 'FG-2': '출하가능', 'FG-3': '출하가능' }), [], true);
  assert.deepStrictEqual([ids(fresh.toAppend), ids(fresh.toMark), fresh.gone.length], [['FG-1', 'FG-2', 'FG-3'], ['FG-1', 'FG-2', 'FG-3'], 0]);
  const gone = BoxShip.planSave(bags, st({ 'FG-1': '출하가능', 'FG-2': '출하완료', 'FG-3': '폐기' }), [], true);
  assert.deepStrictEqual(ids(gone.gone), ['FG-2', 'FG-3'], '이 송장으로 적힌 적 없는 출하완료·폐기 = 남이 처리');
  assert.strictEqual(BoxShip.planSave(bags, st({ 'FG-1': '출하가능', 'FG-2': '출하가능', 'FG-3': '출하가능' }), [['S', 'L', 'FG-7']], true).reject, 'usedWaybill');
  // 출하기록만 적고 끊김 → 봉은 아직 출하가능: 행은 다시 쓰지 않고 상태만
  const r1 = BoxShip.planSave(bags, st({ 'FG-1': '출하가능', 'FG-2': '출하가능', 'FG-3': '출하가능' }), [['S1', 'L', 'FG-1'], ['S2', 'L', 'FG-2'], ['S3', 'L', 'FG-3']], true);
  assert.deepStrictEqual([ids(r1.toAppend), ids(r1.toMark)], [[], ['FG-1', 'FG-2', 'FG-3']]);
  // 상태까지 쓰고 끊김 → 출하완료 + 이미 적힘: 남이 처리한 것으로 보지 않고 LOT 만 맞춘다
  const r2 = BoxShip.planSave(bags, st({ 'FG-1': '출하완료', 'FG-2': '출하완료', 'FG-3': '출하완료' }), [['S1', 'L', 'FG-1'], ['S2', 'L', 'FG-2'], ['S3', 'L', 'FG-3']], true);
  assert.deepStrictEqual([r2.gone.length, ids(r2.toAppend), ids(r2.toMark)], [0, [], []]);
  // 직배 전표는 하루 여러 번 쓰인다 — 다른 봉이 같은 전표에 있어도 거절하지 않는다
  const d = BoxShip.planSave(bags, st({ 'FG-1': '출하가능', 'FG-2': '출하가능', 'FG-3': '출하가능' }), [['S', 'L', 'FG-7']], false);
  assert.deepStrictEqual([d.reject, ids(d.toAppend)], [undefined, ['FG-1', 'FG-2', 'FG-3']]);
});

/* ── ④ shipId ─────────────────────────────────────────── */
t('shipId 는 그날 최대 번호 다음부터 연속 · 서로 다르다 · 다른 날 번호는 무시', () => {
  const ids = BoxShip.nextShipIds(['SHP-20261004-007', 'SHP-20261004-002', 'SHP-20261003-099', '', null], '2026-10-04', 4);
  assert.deepStrictEqual(plain(ids), ['SHP-20261004-008', 'SHP-20261004-009', 'SHP-20261004-010', 'SHP-20261004-011']);
  assert.strictEqual(new Set(ids).size, 4);
  assert.deepStrictEqual(plain(BoxShip.nextShipIds([], '2026-10-04', 1)), ['SHP-20261004-001']);
});

/* ── ⑤ 출하기록 행 ────────────────────────────────────── */
const bags3 = [
  { indivId: 'FG-1', lotId: 'LOT-A' }, { indivId: 'FG-2', lotId: 'LOT-A' }, { indivId: 'FG-3', lotId: 'LOT-B' },
];
const temp = { temp: '-21.0', at: '2026-10-04 08:00', productTemp: '-21.0', method: '냉동창고와 동일' };
t('택배 — 15열 · 앞 12열은 옛 형식 · 송장(작은따옴표로 글자 고정) / 택배 / 받는 곳은 비워 둔다(2단계가 채움)', () => {
  const rows = plain(BoxShip.buildRows(bags3, { mode: 'parcel', ref: '012345678901', shipTime: '2026-10-04 09:10', shipper: 'a@b', temp, shipIds: ['S1', 'S2', 'S3'] }));
  assert.strictEqual(rows.length, 3);
  rows.forEach((r) => assert.strictEqual(r.length, 15));
  assert.deepStrictEqual(rows[2], ['S3', 'LOT-B', 'FG-3', '택배', '1', 'ea', '2026-10-04 09:10', 'a@b', '-21.0°C', '2026-10-04 08:00', '-21.0°C', '냉동창고와 동일', "'012345678901", '택배', '']);
});
t('송도 직배·콜로 픽업 — 전표번호 + 받는 곳이 바로 찬다 · 온도 없으면 빈칸', () => {
  const ref = BoxShip.directRef('송도', '2026-10-04');
  assert.strictEqual(ref, 'D-20261004-송도');
  const s = plain(BoxShip.buildRows(bags3.slice(0, 1), { mode: 'songdo', ref, shipTime: 'x', shipper: '', temp: null, shipIds: ['S1'] }))[0];
  assert.deepStrictEqual(s.slice(3, 4).concat(s.slice(8)), ['송도직영점', '', '', '', '', 'D-20261004-송도', '직배', '송도직영점']);
  const c = plain(BoxShip.buildRows(bags3.slice(0, 1), { mode: 'colo', ref: BoxShip.directRef('콜로', '2026-10-04'), shipTime: 'x', shipIds: ['S1'] }))[0];
  assert.deepStrictEqual([c[3], c[12], c[13], c[14]], ['신제주점', 'D-20261004-콜로', '콜로픽업', '신제주점']);
});
t('LOT 잔량 — 출하완료·폐기·입고취소·삭제는 빼고 센다', () => {
  const iv = [['FG-1', 'LOT-A', '', '출하가능'], ['FG-2', 'LOT-A', '', '출하완료'], ['FG-3', 'LOT-A', '', '냉동보관중'], ['FG-4', 'LOT-A', '', '폐기'], ['FG-5', 'LOT-B', '', '출하가능']];
  assert.strictEqual(BoxShip.remainOf(iv, 'LOT-A'), 2);
  assert.strictEqual(BoxShip.remainOf(iv, 'LOT-C'), 0);
});
t('설정 — 모드 3개 · 택배만 송장을 받는다 · 한 상자 3·4봉', () => {
  assert.deepStrictEqual(Object.keys(BOX_SHIP_CFG.MODES), ['parcel', 'songdo', 'colo']);
  assert.deepStrictEqual(Object.values(BOX_SHIP_CFG.MODES).map((m) => m.waybill), [true, false, false]);
  assert.deepStrictEqual(plain(BOX_SHIP_CFG.BOX_PACKS), [3, 4]);
});

/* ── ⑥ 라벨 사본 ──────────────────────────────────────── */
t('사본은 봉 라벨만, 바로 다음 장에 — A A B B · 끄면 그대로(복사본)', () => {
  const A = { indivId: 'FG-A' }, B = { indivId: 'FG-B' }, R = { indivId: 'RM-1' }, N = {};
  const on = LabelDup.expand([A, R, B, N], true);
  assert.deepStrictEqual(on, [A, A, R, B, B, N]);
  const src = [A, B];
  const off = LabelDup.expand(src, false);
  assert.deepStrictEqual(off, [A, B]);
  assert.notStrictEqual(off, src, '끈 경우에도 원본 배열을 그대로 돌려주지 않는다');
});
t('사본 켜짐이 기본 · 끄면 이 기기에만 기억 · 다시 켜면 지운다', () => {
  store.clear();
  assert.strictEqual(LabelDup.on(), true);
  LabelDup.set(false);
  assert.strictEqual(store.get(LabelDup.KEY), '0');
  assert.strictEqual(LabelDup.on(), false);
  LabelDup.set(true);
  assert.strictEqual(store.has(LabelDup.KEY), false);
  assert.strictEqual(LabelDup.on(), true);
});

/* ── ⑦ 연결 ───────────────────────────────────────────── */
t('옛 출하 창·선택 출하·출하 메모가 파일 어디에도(주석 포함) 없다', () => {
  ['showShipmentPopup', 'showLotShipmentPopup', 'showSelectedShipmentPopup', 'executeLotShipment', 'executeSelectedShipment',
    'executeShipment', 'processShipment', 'toggleShipSelection', 'toggleShipSelectAll', 'updateShipSelectionUI', '_selectedShipIds',
    'refreshAfterShipment', 'ship-select-cb', 'ship-note', '직접 출하'].forEach((g) => assert.ok(!SRC.includes(g), `낡은 것이 남았다: ${g}`));
});
t('박스 출하 화면이 라우터에 붙었다 — 화면 등록 · 탭 매핑 · 떠나면 카메라 끄기 · 입력 보존 화면', () => {
  assert.ok(/Screens\['box-ship'\]\s*=\s*async/.test(CODE), '화면 등록 없음');
  assert.ok(CODE.includes("'box-ship': 'inv'"), '탭 매핑 없음');
  const r = CODE.indexOf('render(params = {}) {');
  assert.ok(/if \(s !== 'box-ship' && window\._boxShipScanner\) stopBoxShipScan\(\);/.test(CODE.slice(r, r + 300)), 'render 첫머리에 카메라 끄기 없음');
  assert.ok(/inputPreservedScreens = \[[^\]]*'box-ship'\]/.test(CODE), '입력 보존 화면에 없음');
});
t('들어오는 길 — 더보기 메뉴 · LOT 카드 2곳 · 스캔 결과가 openBoxShip 을 부른다', () => {
  assert.ok(CODE.includes("label: '박스 출하'") && CODE.includes("target: 'box-ship'"), '더보기 메뉴 없음');
  assert.strictEqual((CODE.match(/onclick="event\.stopPropagation\(\);openBoxShip\(\)"/g) || []).length, 2, 'LOT 카드 단추 2곳');
  assert.ok(/fgStatus === '출하가능'\s*\?\s*`<button[^`]*onclick="openBoxShip\('\$\{data\.id\}'\)"/.test(CODE), '스캔 결과 단추 없음');
});
t('라벨 인쇄가 사본을 펼친다 · 미리보기에 «박스용 1장 더» 칸', () => {
  const p = CODE.indexOf('function printLabels() {');
  assert.ok(/LabelDup\.expand\(window\._currentLabels \|\| \[\], boxCopy \? boxCopy\.checked : LabelDup\.on\(\)\)/.test(CODE.slice(p, p + 300)), 'printLabels 가 사본을 안 펼침(칸이 없으면 기기 기본값)');
  assert.ok(CODE.includes('id="lbl-box-copy"') && CODE.includes('onchange="LabelDup.set(this.checked)"'), '미리보기 토글 없음');
});
t('출하기록 스키마 15열 — 뒤 3열 waybill·shipMethod·receiver', () => {
  const m = CODE.match(/'출하기록': \[([^\]]*)\]/);
  assert.ok(m, '스키마 줄 없음');
  const cols = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.strictEqual(cols.length, 15);
  assert.deepStrictEqual(cols.slice(12), ['waybill', 'shipMethod', 'receiver']);
});
t('저장 — 직전 재조회(실패 시 중단) · 저장 계획 · 연속 shipId · 온도 · D/E/F · LOT I/J · 작업지시서 · 잠금 해제', () => {
  const a = CODE.indexOf('async function boxShipSave(ref) {');
  const body = CODE.slice(a, CODE.indexOf('\n}\n', a));
  assert.ok(body.includes("SheetsAPI.getAll('완제품개별', false),") && /SheetsAPI\.getAll\('출하기록', false\),\n/.test(body), '저장 직전 재조회 없음');
  assert.ok(!/getAll\('출하기록', false\)\.catch/.test(body), '저장 직전 출하기록 읽기 실패를 삼킨다');
  assert.ok(body.includes('BoxShip.planSave(bs.bags, id => st.get(id), same, mode.waybill, others)'), '저장 계획 없음');
  assert.ok(body.includes('BoxShip.resumeRef(plan.limbo, bs.bags.length, ref)'), '직배 끊긴 저장 이어 쓰기 없음');
  assert.ok(body.includes('BoxShip.nextShipIds(ships.map(r => r[0]), formatDate(), plan.toAppend.length)'), '연속 채번 없음');
  assert.ok(body.includes('BoxShip.buildRows(plan.toAppend, { mode: modeKey,'), '행이 저장 계획·고정 방식을 안 따른다');
  assert.ok(body.includes('temp = await getShipFreezerStamp()'), '냉동창고 온도 스탬프 없음');
  assert.ok(body.includes("SheetsAPI.append('출하기록', rows)"), '출하기록 쓰기 없음');
  assert.ok(body.includes('for (const b of plan.toMark)'), '상태 쓰기가 저장 계획을 안 따른다');
  ['D', 'E', 'F'].forEach((c) => assert.ok(body.includes('`완제품개별!' + c + '${idx}`'), `완제품개별 ${c} 쓰기 없음`));
  assert.ok(body.includes('`완제품LOT!I${li}`') && body.includes('`완제품LOT!J${li}`'), 'LOT 잔량·상태 쓰기 없음');
  assert.ok(body.includes("SheetsAPI.updateCell('작업지시서', 0, wo[0], 12, '출하완료')"), '작업지시서 출하완료 전환 없음');
  assert.ok(/finally \{[\s\S]*releaseLock\('boxShipSave'\)/.test(body), 'finally 에서 잠금 해제 없음');
});
t('찍기 — 다른 화면에선 무시 · 확인창 사이 화면을 떠나면 저장 안 함 · 저장 중엔 방식 못 바꿈', () => {
  const a = CODE.indexOf('async function boxShipAccept(raw, opt = {}) {');
  const body = CODE.slice(a, CODE.indexOf('\n}\n', a));
  assert.ok(body.includes("if (!bs || !bs.ready || State.currentScreen !== 'box-ship') return;"), '다른 화면 가드 없음');
  assert.ok(body.includes("if (!yes || State._boxShip !== bs || State.currentScreen !== 'box-ship') { hush(); return; }"), '확인창 뒤 화면 가드 없음');
  const m = CODE.indexOf('function boxShipSetMode(k) {');
  assert.ok(CODE.slice(m, m + 200).includes('if (!bs || bs.busy || !BOX_SHIP_CFG.MODES[k]) return;'), '저장 중 방식 변경 가드 없음');
});

/* ── ⑧ 안내 흐름 — 다음에 할 일 · 오늘 수 · 소리 · 끝내기 (2026-10-04 «따라 하기만 하면 끝나게») ───────── */
const MODE = BOX_SHIP_CFG.MODES;
const fnText = (head) => {
  const a = SRC.indexOf(head);
  assert.ok(a !== -1, `index.html 에서 ${head} 를 찾지 못함`);
  assert.strictEqual(SRC.indexOf(head, a + 1), -1, `${head} 가 둘 이상`);
  return SRC.slice(a, SRC.indexOf('\n}\n', a) + 2);
};
const shipRow = (p) => Object.assign(Array(15).fill(''), p);

t('송장 — 봉이 없을 때: 방금 저장한 송장이면 «이미 저장» · 처음 보는 송장이면 «봉부터»', () => {
  const W = '501234567890';
  assert.strictEqual(BoxShip.checkWaybill([], W, new Map([[W, ['FG-0']]])).reason, 'saved');
  assert.strictEqual(BoxShip.checkWaybill([], W, new Map()).reason, 'nobags');
  assert.strictEqual(BoxShip.checkWaybill([], W, undefined).reason, 'nobags');
  assert.strictEqual(BoxShip.checkWaybill([{ indivId: 'FG-1' }], W, new Map([[W, ['FG-0']]])).reason, 'usedWaybill', '봉이 있으면 옛 규칙 그대로');
});
t('송장 — 봉이 없는데 적힌 봉이 아직 출하가능이면 «끊긴 저장» · 다 출하완료거나 상태를 모르면 «이미 저장»', () => {
  const W = '501234567890';
  const used = new Map([[W, ['FG-1', 'FG-2']]]);
  assert.strictEqual(BoxShip.checkWaybill([], W, used, (id) => (id === 'FG-1' ? '출하완료' : '출하가능')).reason, 'resume');
  assert.strictEqual(BoxShip.checkWaybill([], W, used, () => '출하완료').reason, 'saved');
  assert.strictEqual(BoxShip.checkWaybill([], W, used).reason, 'saved', '상태를 안 넘기면 옛 동작 그대로');
  assert.ok(BoxShip.message({ reason: 'resume' }).includes('끊긴 저장') && BoxShip.message({ reason: 'resume' }).includes('봉 라벨'));
});
t('저장 계획 — 다른 송장·전표로 이미 적힌 봉이 아직 출하가능이면 막는다(끊긴 저장의 봉을 또 적지 않게)', () => {
  const bags = [{ indivId: 'FG-1' }, { indivId: 'FG-2' }, { indivId: 'FG-3' }];
  const up = () => '출하가능';
  const other = [{ indivId: 'FG-1', ref: 'W1' }, { indivId: 'FG-1', ref: 'W0' }];
  assert.deepStrictEqual(plain(BoxShip.planSave(bags, up, [], true, other)), { gone: [], limbo: [{ indivId: 'FG-1', ref: 'W1' }] }, '한 봉은 한 번만(첫 기록)');
  assert.strictEqual(BoxShip.planSave(bags, up, [shipRow({ 2: 'FG-1' })], true, other).limbo, undefined, '같은 송장에 이미 적힌 봉은 이어 쓰기');
  assert.deepStrictEqual(plain(BoxShip.planSave(bags, (id) => (id === 'FG-1' ? '출하완료' : '출하가능'), [], true, other).gone.map((b) => b.indivId)), ['FG-1'], '이미 나간 봉은 옛 규칙(상자에서 뺀다)');
  assert.strictEqual(BoxShip.planSave(bags, up, [], true).toAppend.length, 3, '다른 기록이 없으면 그대로 새로 적는다');
  assert.strictEqual(BoxShip.planSave(bags, up, [], true, [{ indivId: 'FG-9', ref: 'W1' }]).toAppend.length, 3, '이 상자에 없는 봉의 기록은 상관없다');
});
t('문구 — 저장됨 · 겉 라벨 먼저 · 이미 나간 봉은 «언제 어디로» 를 붙인다(정보가 없으면 짧은 문구)', () => {
  assert.ok(BoxShip.message({ reason: 'saved' }).includes('이미 저장한 상자'));
  assert.ok(BoxShip.message({ reason: 'nobags' }).includes('겉 라벨을 먼저'));
  assert.strictEqual(BoxShip.message({ reason: 'shipped', info: '10/3 송장 501234567890' }), '이미 출하된 봉입니다 (10/3 송장 501234567890) — 넣지 않았습니다');
  assert.strictEqual(BoxShip.message({ reason: 'shipped', info: '' }), '이미 출하된 봉입니다 — 넣지 않았습니다');
  assert.strictEqual(BoxShip.message({ reason: 'shipped' }), '이미 출하된 봉입니다 — 넣지 않았습니다');
});
t('날짜 읽기 — 시트가 어떤 서식으로 줘도 앞의 날짜만 YYYY-MM-DD', () => {
  ['2026-10-04 09:10', '2026-10-4 9:10:00', '2026. 10. 4 오전 9:10:00', '2026/10/04', ' 2026.10.04 '].forEach((v) => assert.strictEqual(BoxShip.ymdOf(v), '2026-10-04', v));
  ['', null, undefined, '10/04', '오전 9:10', 'abc', '2026'].forEach((v) => assert.strictEqual(BoxShip.ymdOf(v), '', String(v)));
});
t('이미 나간 봉 안내 — 택배는 날짜+송장 · 직배는 날짜+받는 곳+방식 · 옛 출하는 날짜만 · 행이 없으면 빈 글자', () => {
  assert.strictEqual(BoxShip.shippedInfo(shipRow({ 6: '2026-10-03 09:10', 12: "'501234567890", 13: '택배' })), '10/3 송장 501234567890');
  assert.strictEqual(BoxShip.shippedInfo(shipRow({ 6: '2026-10-03 09:10', 12: 'D-20261003-송도', 13: '직배', 14: '송도직영점' })), '10/3 송도직영점 직배');
  assert.strictEqual(BoxShip.shippedInfo(shipRow({ 6: '2026-10-03 09:10', 13: '택배' })), '10/3 택배');
  assert.strictEqual(BoxShip.shippedInfo(shipRow({ 6: '2026-10-03 09:10' })), '10/3');
  assert.strictEqual(BoxShip.shippedInfo(undefined), '');
});
t('오늘 수 — 택배는 송장 가짓수=상자·행 수=봉 · 직배·픽업은 봉만 · 옛 행(송장 없음)·다른 날은 뺀다', () => {
  const R = (dt, ref, method, id) => shipRow({ 2: id, 6: dt, 12: ref, 13: method });
  const rows = [
    R('2026-10-04 09:00', "'111111111111", '택배', 'a'), R('2026-10-04 09:00', "'111111111111", '택배', 'b'), R('2026-10-04 09:00', "'111111111111", '택배', 'c'),
    R('2026-10-04 09:30', "'222222222222", '택배', 'd'), R('2026-10-04 09:30', "'222222222222", '택배', 'e'),
    R('2026-10-04 10:00', 'D-20261004-송도', '직배', 'f'),
    R('2026-10-04 10:10', '', '', 'g'),
    R('2026-10-03 17:00', "'333333333333", '택배', 'h'),
  ];
  assert.deepStrictEqual(plain(BoxShip.todayCount(rows, '2026-10-04')), { boxes: 2, bags: 5, direct: 1 });
  assert.deepStrictEqual(plain(BoxShip.todayCount([], '2026-10-04')), { boxes: 0, bags: 0, direct: 0 });
  assert.deepStrictEqual(plain(BoxShip.todayCount(null, '2026-10-04')), { boxes: 0, bags: 0, direct: 0 });
  assert.strictEqual(BoxShip.todayText({ boxes: 2, bags: 5, direct: 1 }), '오늘 택배 2상자 5봉 · 직배·픽업 1봉');
  assert.strictEqual(BoxShip.todayText({ boxes: 0, bags: 0, direct: 3 }), '오늘 직배·픽업 3봉');
  assert.strictEqual(BoxShip.todayText({ boxes: 1, bags: 4, direct: 0 }), '오늘 택배 1상자 4봉');
  assert.strictEqual(BoxShip.todayText({ boxes: 0, bags: 0, direct: 0 }), '오늘 저장한 상자 없음');
});
t('다음에 할 일 — 택배: 0봉=겉 라벨 · 1~2봉=더 · 3~4봉=송장 · 5봉↑=경고 / 직배·픽업: 0봉=봉 라벨 · 1봉↑=저장 단추', () => {
  const P = MODE.parcel, S = MODE.songdo;
  const s = (m, n, f) => plain(BoxShip.stepOf(m, n, !!f));
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((n) => s(P, n).step), [1, 1, 1, 2, 2, 2]);
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((n) => s(P, n).tone), ['go', 'go', 'go', 'go', 'go', 'warn']);
  assert.ok(s(P, 0).text.includes('겉 라벨'));
  assert.ok(s(P, 0, true).text.includes('다음 상자'), '방금 저장한 뒤');
  assert.ok(!s(P, 0).text.includes('다음 상자'), '처음엔 «다음 상자» 라고 하지 않는다');
  assert.ok(s(P, 2).text.startsWith('2봉') && s(P, 2).text.includes('더 찍으세요'));
  assert.ok(s(P, 3).text.includes('송장') && s(P, 3).text.includes('4봉째'), '3봉 = 송장 또는 4봉째');
  assert.ok(s(P, 4).text.includes('송장') && !s(P, 4).text.includes('봉째'), '4봉 = 송장만');
  assert.ok(s(P, 5).text.includes('3~4봉') && s(P, 5).text.includes('확인'));
  assert.deepStrictEqual([s(S, 0).step, s(S, 1).step, s(S, 7).step], [1, 2, 2]);
  assert.ok(s(S, 0).text.includes('송도직영점') && s(MODE.colo, 0).text.includes('신제주점'));
  assert.ok(s(S, 2).text.includes('저장'));
  assert.ok(s(S, 0, true).text.includes('저장했습니다'));
  assert.deepStrictEqual(plain(BoxShip.STEPS), { parcel: ['겉 라벨 찍기', '송장 찍기'], direct: ['봉 라벨 찍기', '저장'] });
});
t('소리 계획 — 맞으면 높게 한 번 · 틀리면 낮게 두 번', () => {
  const good = plain(BoxShip.beepPlan(true)), bad = plain(BoxShip.beepPlan(false));
  assert.strictEqual(good.length, 1);
  assert.strictEqual(bad.length, 2);
  assert.ok(good[0].hz > bad[0].hz, '맞는 소리가 더 높다');
  [...good, ...bad].forEach((b) => assert.ok(b.hz > 0 && b.ms > 0 && b.gap >= 0));
});
t('소리 재생 — 계획대로 울린다 · 멈춘 오디오는 깨운다 · 한 번 만든 걸 다시 쓴다 · 없거나 던져도 조용히 넘어간다', () => {
  const log = [];
  let made = 0;
  const mkAC = (state) => function AC() {
    made++;
    this.state = state || 'running'; this.currentTime = 10; this.destination = {};
    this.resume = () => log.push('resume');
    this.createGain = () => ({ gain: {}, connect() {} });
    this.createOscillator = () => { const o = { frequency: {}, connect() {}, start: (at) => log.push(['start', o.frequency.value, at]), stop: (at) => log.push(['stop', at]) }; return o; };
  };
  const play = (win, ok) => vm.runInContext(fnText('function boxShipBeep(ok) {') + `; boxShipBeep(${ok})`, vm.createContext({ window: win, BoxShip, Math }));
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const w1 = { AudioContext: mkAC() };
  play(w1, true);
  assert.deepStrictEqual(plain(log), [['start', 880, 10], ['stop', 10.09]], '맞는 소리');
  log.length = 0;
  play(w1, false);
  const starts = log.filter((e) => e[0] === 'start');
  assert.strictEqual(starts.length, 2);
  assert.ok(starts.every((e) => e[1] === 220) && near(starts[0][2], 10) && near(starts[1][2], 10 + 0.15 + 0.09), '틀린 소리 = 낮게 두 번, 사이를 띄운다');
  assert.strictEqual(made, 1, '오디오 장치는 한 번만 만든다');
  log.length = 0;
  play({ webkitAudioContext: mkAC('suspended') }, true);
  assert.strictEqual(log[0], 'resume', '멈춘 오디오는 먼저 깨운다');
  play({}, true);
  play({ AudioContext: function Boom() { throw new Error('오디오 막힘'); } }, false);
});
t('주제 조사 «은/는» — 마지막 글자의 받침에 맞춘다(직배는 · 픽업은), 한글이 아니면 «은(는)»', () => {
  assert.strictEqual(BoxShip.topic(BOX_SHIP_CFG.MODES.songdo.label), '🏪 송도 직배는', '받침 없는 «배»');
  assert.strictEqual(BoxShip.topic(BOX_SHIP_CFG.MODES.colo.label), '🛻 콜로 픽업은', '받침 있는 «업»');
  assert.strictEqual(BoxShip.topic('  택배 '), '택배는', '앞뒤 공백은 걷는다');
  // 한글 음절 11172자 전부를 «받침 유무» 를 따로 센 답과 대조한다 — NFD 로 풀면 받침이 있는 글자만 3조각이다
  let bad = 0;
  for (let c = 0xAC00; c <= 0xD7A3; c++) {
    const ch = String.fromCharCode(c);
    const want = ch.normalize('NFD').length === 3 ? '은' : '는';
    if (BoxShip.topic('가' + ch) !== '가' + ch + want) bad++;
  }
  assert.strictEqual(bad, 0, '받침 판정이 틀린 글자 수');
  for (const w of ['ABC', '3', '직배!']) assert.strictEqual(BoxShip.topic(w), `${w}은(는)`, `${w} — 한글로 끝나지 않으면 은(는)`);
  for (const w of ['', null, undefined]) assert.strictEqual(BoxShip.topic(w), '은(는)', '빈 값도 깨지지 않는다');
  assert.ok(!SRC.includes('${mode.label} 은 송장 없이'), '«직배 은» 처럼 받침을 안 보고 «은» 을 붙인 옛 문구가 남아 있다');
});

t('받는 곳 뒤 «으로» — 받침이 있고 ㄹ 이 아닐 때만 맞다(새 받는 곳을 더하면 이 시험이 조사 도우미가 필요하다고 알려 준다)', () => {
  assert.ok(CODE.includes('${mode.receiver}으로'), '코드가 더는 받는 곳 뒤에 «으로» 를 직접 붙이지 않는다 — 이 시험을 지운다');
  let n = 0;
  for (const [k, m] of Object.entries(BOX_SHIP_CFG.MODES)) {
    if (!m.receiver) continue;   // 택배는 받는 곳이 없다
    const code = m.receiver.charCodeAt(m.receiver.length - 1) - 0xAC00, jong = code % 28;
    assert.ok(code >= 0 && code < 11172 && jong !== 0 && jong !== 8, `${k}: «${m.receiver}» 뒤에는 «으로» 가 맞지 않는다(받침이 없거나 ㄹ 받침 — «로») — 조사 도우미가 필요하다`);
    n++;
  }
  assert.ok(n >= 2, '받는 곳이 있는 방식을 못 찾았다 — 이 시험이 아무것도 안 지킨다');
});

t('옛 안내문이 파일 어디에도(주석 포함) 없다 — 단계 안내가 대신한다', () => {
  ['봉 라벨을 먼저 찍어 주세요', '마지막으로 <b>송장</b>을 찍으면', '송장은 봉을 다 찍은 뒤 마지막에', '봉 라벨 → 송장 순서로 찍기',
    '한 상자는 보통 3봉 또는 4봉입니다', '속 봉을 찍어도 같습니다'].forEach((g) => assert.ok(!SRC.includes(g), `낡은 안내가 남았다: ${g}`));
  assert.ok(!/const hint = mode\.waybill/.test(CODE), '옛 안내 변수 hint 가 남았다');
});
t('화면 — 단계 표시 · 지금 할 일 · 오늘 수 · 방금 저장 · 직배는 저장 단추(택배는 없음 · 단추는 bs-save 로 아래에 붙는다)', () => {
  const render = (bs) => {
    const els = { 'bs-modes': { innerHTML: '' }, 'bs-panel': { innerHTML: '' } };
    const c = vm.createContext({ State: { _boxShip: bs }, BoxShip, BOX_SHIP_CFG, $id: (id) => els[id], HS_ESC: (x) => String(x), formatDate: () => '2026-10-04', Object, Set, Array, Map, String });
    vm.runInContext(fnText('function renderBoxShip() {') + '; renderBoxShip()', c);
    return els['bs-panel'].innerHTML;
  };
  const base = (mode, n) => ({ mode, bags: Array.from({ length: n }, (_, i) => ({ indivId: 'FG-' + i, lotId: 'LOT-A' })), fresh: false, lastSaved: '', shipRows: [], shipsOk: true });
  const h0 = render(base('parcel', 0));
  assert.ok(h0.includes('● 1. 겉 라벨 찍기') && h0.includes('○ 2. 송장 찍기') && h0.includes('박스 겉 라벨을 찍으세요') && h0.includes('아직 담은 봉이 없습니다'));
  assert.ok(!h0.includes('boxShipSaveDirect'), '택배에는 저장 단추가 없다 — 송장이 저장이다');
  const h3 = render(base('parcel', 3));
  assert.ok(h3.includes('● 2. 송장 찍기') && h3.includes('이제 송장 바코드') && h3.includes('boxShipRemove(2)') && h3.includes('LOT LOT-A') && h3.includes('var(--suc)') && !h3.includes('c-warn'));
  const h5 = render(base('parcel', 5));
  assert.ok(h5.includes('var(--warn)') && h5.includes('c-warn'), '5봉은 경고색');
  const hs = render(base('songdo', 2));
  assert.ok(hs.includes('boxShipSaveDirect()') && hs.includes('저장 · 2봉 → 송도직영점') && hs.includes('● 2. 저장'));
  assert.ok(/<button[^>]*disabled[^>]*boxShipSaveDirect/.test(render(base('songdo', 0))), '0봉이면 저장 단추가 잠긴다');
  assert.ok(/<button class="[^"]*\bbs-save\b[^"]*"[^>]*onclick="boxShipSaveDirect\(\)"/.test(hs), '송도 저장 단추에 bs-save 가 없다 — 봉이 쌓이면 단추가 화면 밖으로 밀려 맨 아래까지 내려가야 눌린다');
  assert.ok(/<button class="[^"]*\bbs-save\b[^"]*"[^>]*onclick="boxShipSaveDirect\(\)">저장 · 2봉 → 신제주점/.test(render(base('colo', 2))), '콜로 저장 단추도 bs-save 로 아래에 붙는다');
  assert.ok(!h0.includes('bs-save') && !h3.includes('bs-save'), '택배에는 저장 단추가 없다 — 고정할 단추도 없다');
  const b = base('parcel', 0);
  b.shipRows = [shipRow({ 6: '2026-10-04 09:00', 12: "'111111111111", 13: '택배' }), shipRow({ 6: '2026-10-03 09:00', 12: "'222222222222", 13: '택배' })];
  b.lastSaved = '3봉 · 송장 111111111111';
  b.fresh = true;
  const hf = render(b);
  assert.ok(hf.includes('오늘 택배 1상자 1봉') && hf.includes('✔ 방금 저장: 3봉 · 송장 111111111111') && hf.includes('다음 상자 — 겉 라벨부터'));
  b.shipsOk = false;
  const hn = render(b);
  assert.ok(!hn.includes('오늘 택배') && !hn.includes('오늘 저장한 상자 없음'), '출하기록을 못 읽었으면 오늘 수 줄을 감춘다 — «없다» 고 거짓말하지 않는다');
});
t('저장 뒤 — 송장을 «저장됨» 으로 적고 · 다음 상자 표시를 켜고 · 오늘 수에 바로 더한다 · 불러올 때 출하기록을 보관한다', () => {
  const a = CODE.indexOf('async function boxShipSave(ref) {');
  const body = CODE.slice(a, CODE.indexOf('\n}\n', a));
  const iUsed = body.indexOf('if (mode.waybill) bs.used.set(ref, bs.bags.map(b => b.indivId));'), iClear = body.indexOf('bs.bags = [];'), iFresh = body.indexOf('bs.fresh = true;');
  assert.ok(iUsed !== -1 && iUsed < iClear, '송장 사용 기록은 상자를 비우기 전에');
  assert.ok(iFresh > iClear, '비운 뒤에 다음 상자 표시');
  assert.ok(/SheetsAPI\.append\('출하기록', rows\);\n\s*rows\.forEach\(r => \{ bs\.shipRows\.push\(r\); bs\.shipByIndiv\.set\(/.test(body), '쓴 행을 곧바로 화면 쪽 목록에 더한다');
  assert.ok(CODE.includes('bs.shipRows = ships.slice();') && CODE.includes('bs.shipByIndiv.set(String(r[2]).trim().toUpperCase(), r)'), '불러올 때 출하기록 보관 없음');
  assert.ok(/function boxShipRemove\(i\) \{[\s\S]*?bs\.fresh = false;/.test(CODE) && /function boxShipClear\(\) \{[\s\S]*?bs\.fresh = false;/.test(CODE), '빼기·비우기가 다음 상자 표시를 끈다');
});
t('머리 단추 «끝내기» 가 있다', () => {
  const a = CODE.indexOf("renderHeader('📦 박스 출하'");
  assert.ok(a !== -1 && CODE.slice(a, a + 500).includes('onclick="boxShipFinish()"'), '머리에 끝내기 단추 없음');
});

t('확인창 — 단추 이름을 받는다(기본 취소·저장)', () => {
  const f = fnText('function boxShipConfirm(title, sub, labels) {');
  assert.ok(f.includes("Object.assign({ no: '취소', yes: '저장' }, labels)"), '단추 이름 기본값·덮어쓰기 없음');
  assert.ok(f.includes('data-a="no">${HS_ESC(L.no)}</button>') && f.includes('data-a="yes">${HS_ESC(L.yes)}</button>'), '단추가 받은 이름을 안 쓴다');
});

/* ── ⑨ 알림 상자 — 오류 안내가 안 읽히면 소리만 남는다 (2026-10-05 목업 촬영에서 발견: warn 에만 배경 규칙이 없었다) ───────── */
const noComment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

t('알림 상자 — 박스 출하가 내는 알림 종류마다 배경 규칙이 있다(warn 은 규칙이 없어 흰 글씨가 머리글에 묻혔었다)', () => {
  const a = CODE.indexOf("Screens['box-ship'] = async");
  const b = CODE.indexOf('\n}\n', CODE.indexOf('async function boxShipSave('));
  assert.ok(a !== -1 && b > a, '박스 출하 화면 구역을 찾지 못함');
  const kinds = new Set();
  CODE.slice(a, b).split('\n').filter((l) => l.includes('toast(')).forEach((l) => { for (const m of l.matchAll(/[,?:]\s*'([a-z]+)'/g)) kinds.add(m[1]); });   // 종류 자리 = 쉼표·삼항 뒤의 작은따옴표 낱말(=== 'dup' 같은 비교는 걸리지 않는다)
  assert.ok(['warn', 'info', 'err', 'suc'].every((k) => kinds.has(k)), '구역에서 알림 종류를 못 모았다(' + [...kinds] + ') — 이 시험이 아무것도 안 지킨다');
  kinds.forEach((k) => assert.ok(new RegExp('\\.toast\\.' + k + '\\s*\\{[^}]*background\\s*:').test(CODE), '.toast.' + k + ' 에 배경이 없다 — 흰 글씨만 떠서 머리글에 묻힌다'));
});

const cssProps = (body) => new Map(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));

t('알림 상자 — 글 길이만큼 펴고 화면 안에서만 접는다(left:50% 만 쓰면 폭이 화면 절반으로 줄어 긴 안내가 여러 줄로 접혔다)', () => {
  // .toast 규칙은 둘이다(작은 화면 글자 크기 · 위치를 잡는 본 규칙) — 위치를 잡는 쪽을 고른다
  const p = [...CODE.matchAll(/\.toast\s*\{([^}]*)\}/g)].map((m) => cssProps(m[1])).find((r) => r.get('position') === 'fixed');
  assert.ok(p, '위치를 잡는 .toast 규칙(position:fixed)을 찾지 못함');
  assert.strictEqual(p.get('left'), '50%', '가운데 정렬 기준이 바뀌었다');
  assert.strictEqual(p.get('width'), 'max-content', '글 길이만큼 펴지 않는다 — 폭이 화면 절반으로 줄어 긴 안내가 접힌다');
  assert.strictEqual(p.get('max-width'), 'calc(100vw - 32px)', '화면 밖으로 넘치지 않게 하는 상한이 없다');
});

t('저장 단추 — 봉이 쌓여 화면 밖으로 밀려도 아래에 붙는다(.bs-save: sticky · 아래 여백 · 목록 위로)', () => {
  const m = /\.bs-save\s*\{([^}]*)\}/.exec(CODE);
  assert.ok(m, '.bs-save 규칙을 찾지 못함');
  const p = cssProps(m[1]);
  assert.strictEqual(p.get('position'), 'sticky', '아래에 붙지 않는다');
  assert.strictEqual(p.get('bottom'), '8px', '아래 여백이 없으면 화면 가장자리에 붙어 눌리지 않는다');
  assert.ok(Number(p.get('z-index')) >= 2, '목록 글 위로 올라오지 않으면 가려진다');
});

t('안내 글·확인창 — 낱말 중간에서 줄이 꺾이지 않는다(word-break:keep-all)', () => {
  const g = noComment(fnText('function renderBoxShip() {'));
  assert.ok(/<div class="fs-15 fw-7 \$\{[^}]*\}" style="[^"]*word-break:keep-all[^"]*">\$\{HS_ESC\(guide\.text\)\}<\/div>/.test(g), '안내 글에 keep-all 이 없다 — «있/으면» 처럼 낱말 중간에서 꺾인다');
  const c = noComment(fnText('function boxShipConfirm(title, sub, labels) {'));
  assert.ok(/<div class="dialog" style="[^"]*word-break:keep-all[^"]*">/.test(c), '확인창에 keep-all 이 없다 — «저/장할까요» 처럼 낱말 중간에서 꺾인다');
});

let asyncDone = false;
process.on('exit', () => { if (!asyncDone) { console.error('✗ 비동기 시험이 끝까지 못 갔다(끝나지 않는 await)'); process.exitCode = 1; } });

(async () => {
  const at = async (n, f) => { await f(); ok.push(n); };

  /* 찍기 — 저장 직후 같은 송장을 카메라가 또 읽어도 «봉부터» 가 아니라 «이미 저장» */
  await at('찍기 흐름 — 봉 3 → 송장 저장 → 같은 송장 재스캔은 «이미 저장» · 이미 나간 봉은 언제 어디로 · 확인창 문구', async () => {
    let clock = 1000;
    const log = { toasts: [], buzz: [], saved: [], confirms: [], confirmBusy: [] };
    const state = { currentScreen: 'box-ship', _boxShip: null };
    const bs = state._boxShip = { mode: 'parcel', bags: [], indiv: new Map(), used: new Map(), ready: true, busy: false, last: { code: '', at: 0 }, lastSaved: '', shipRows: [], shipByIndiv: new Map(), fresh: true };
    ['FG-1', 'FG-2', 'FG-3', 'FG-4', 'FG-5'].forEach((id) => bs.indiv.set(id, { indivId: id, lotId: 'LOT-A', status: '출하가능', itemName: '호두과자' }));
    bs.indiv.set('FG-9', { indivId: 'FG-9', lotId: 'LOT-A', status: '출하완료', itemName: '호두과자' });
    bs.shipByIndiv.set('FG-9', shipRow({ 2: 'FG-9', 6: '2026-10-03 09:10', 12: "'999999999999", 13: '택배' }));
    let yes = true;
    const c = vm.createContext({
      State: state, BoxShip, BOX_SHIP_CFG, Date: { now: () => clock }, String, Object,
      toast: (m, kind) => log.toasts.push([m, kind]),
      boxShipBuzz: (good) => log.buzz.push(good),
      renderBoxShip: () => {},
      boxShipConfirm: async (title, sub) => { log.confirms.push([title, sub]); log.confirmBusy.push(bs.busy); return yes; },
      boxShipSave: async (ref) => { log.saved.push([ref, bs.bags.map((b) => b.indivId)]); bs.bags.forEach((b) => { bs.indiv.get(b.indivId).status = '출하완료'; }); bs.used.set(ref, bs.bags.map((b) => b.indivId)); bs.bags = []; bs.fresh = true; },
    });
    const accept = vm.runInContext(fnText('async function boxShipAccept(raw, opt = {}) {') + '; boxShipAccept', c);
    const next = async (raw, opt) => { clock += 3000; await accept(raw, opt); };

    for (const id of ['FG-1', 'FG-2', 'FG-3']) await next(id);
    assert.deepStrictEqual([bs.bags.length, bs.fresh, log.buzz.length], [3, false, 3], '봉 3개 — 다음 상자 표시가 꺼진다');
    await next('fg-1');
    assert.strictEqual(log.toasts.length, 0, '카메라가 같은 봉을 또 읽은 것은 조용히 넘어간다');
    await next('FG-9');
    assert.strictEqual(log.toasts[0][0], '이미 출하된 봉입니다 (10/3 송장 999999999999) — 넣지 않았습니다');
    assert.strictEqual(bs.bags.length, 3, '나간 봉은 담기지 않는다');
    log.toasts.length = 0;
    await next('501234567890');
    assert.deepStrictEqual([log.saved.length, log.saved[0][0], log.confirms.length, bs.bags.length, bs.fresh], [1, '501234567890', 0, 0, true], '3봉 = 확인창 없이 저장');
    const buzzed = log.buzz.length;
    await next('501234567890');
    assert.deepStrictEqual(plain(log.toasts), [['이미 저장한 상자입니다 — 다음 상자의 겉 라벨을 찍으세요', 'info']], '저장 직후 재스캔 = «이미 저장»(안내만)');
    assert.strictEqual(log.buzz.length, buzzed, '이미 저장한 상자를 또 읽은 것은 틀린 소리를 내지 않는다');
    log.toasts.length = 0;
    await next('FG-4');
    await next('FG-5');
    await next('501234567891');
    assert.ok(log.confirms[0][1].includes('3·4봉인데 2봉입니다'), `확인창 문구: ${log.confirms[0][1]}`);
    assert.deepStrictEqual(log.confirmBusy, [true], '확인창이 떠 있는 동안 잠금 — 그 사이 카메라가 읽은 봉을 담지 않는다');
    assert.strictEqual(log.saved.length, 2, '확인 → 저장');
    bs.bags = []; bs.used.clear(); log.saved.length = 0; log.confirms.length = 0;
    ['FG-4', 'FG-5'].forEach((id) => { bs.indiv.get(id).status = '출하가능'; });   // 위에서 저장돼 출하완료가 된 두 봉을 다시 담을 수 있게 되돌린다
    await next('FG-4'); await next('FG-5');
    yes = false;
    await next('501234567892');
    assert.deepStrictEqual([log.confirms.length, log.saved.length, bs.busy], [1, 0, false], '확인창에서 취소 = 저장 안 함 · 잠금 풂');
    bs.mode = 'songdo';
    log.toasts.length = 0;
    await next('501234567893');
    assert.deepStrictEqual(plain(log.toasts), [['🏪 송도 직배는 송장 없이 «저장» 을 누릅니다', 'info']], '직배는 송장을 받지 않는다 — 받침 없는 «배» 라 «는»');
    bs.mode = 'colo';
    log.toasts.length = 0;
    await next('501234567894');
    assert.deepStrictEqual(plain(log.toasts), [['🛻 콜로 픽업은 송장 없이 «저장» 을 누릅니다', 'info']], '픽업도 송장을 받지 않는다 — 받침 있는 «업» 이라 «은»');
    bs.mode = 'songdo';
    bs.busy = true;
    log.toasts.length = 0;
    await next('FG-1');
    assert.ok(log.toasts[0][0].includes('저장 중입니다'));
  });

  /* 끝내기 */
  const finish = async (bs, o = {}) => {
    const calls = [];
    calls.busy = {};   // 확인창·카메라 끄기가 도는 동안 잠금이 켜져 있었나
    const state = { _boxShip: bs, currentScreen: 'box-ship' };
    const c = vm.createContext({
      State: state, BoxShip, formatDate: () => '2026-10-04', Object,
      boxShipConfirm: async (title, sub, labels) => { calls.push(['confirm', title, sub, plain(labels)]); calls.busy.confirm = bs.busy; if (o.leave) state.currentScreen = 'inventory'; return o.yes !== false; },
      stopBoxShipScan: async () => { calls.push(['stop']); calls.busy.stop = bs.busy; if (o.leaveOnStop) state.currentScreen = 'inventory'; if (o.replaceOnStop) state._boxShip = { bags: [] }; },
      toast: (m) => calls.push(['toast', m]),
      Router: { go: (s) => calls.push(['go', s]) },
    });
    await vm.runInContext(fnText('async function boxShipFinish() {') + '; boxShipFinish', c)();
    return calls;
  };
  const rows1 = [shipRow({ 6: '2026-10-04 09:00', 12: "'111111111111", 13: '택배' })];
  await at('끝내기 — 봉이 없으면 바로: 카메라 끄기 → 오늘 합계 → 재고로', async () => {
    const calls = await finish({ bags: [], busy: false, shipRows: rows1, shipsOk: true });
    assert.deepStrictEqual(plain(calls), [['stop'], ['toast', '📦 박스 출하를 끝냅니다 — 오늘 택배 1상자 1봉'], ['go', 'inventory']]);
    assert.strictEqual(calls.busy.stop, true, '카메라를 끄는 동안 잠금 — 그 사이 읽힌 송장으로 저장이 새로 시작되면 안 된다');
  });
  await at('끝내기 — 카메라를 끄는 사이 화면을 떠났으면 이동·안내를 하지 않는다(새 화면을 덮지 않는다)', async () => {
    const bs = { bags: [], busy: false, shipRows: rows1, shipsOk: true };
    const calls = await finish(bs, { leaveOnStop: true });
    assert.deepStrictEqual(plain(calls), [['stop']]);
    assert.strictEqual(bs.busy, false, '잠금을 남기지 않는다');
  });
  await at('끝내기 — 카메라를 끄는 사이 나갔다 돌아와 새 상자 화면이 열렸어도 이동·안내를 하지 않는다', async () => {
    const bs = { bags: [], busy: false, shipRows: rows1, shipsOk: true };
    const calls = await finish(bs, { replaceOnStop: true });
    assert.deepStrictEqual(plain(calls), [['stop']]);
    assert.strictEqual(bs.busy, false);
  });
  await at('끝내기 — 출하기록을 못 읽었으면 합계를 말하지 않는다(«0상자» 라고 거짓말하지 않는다)', async () => {
    const calls = await finish({ bags: [], busy: false, shipRows: [], shipsOk: false });
    assert.deepStrictEqual(plain(calls), [['stop'], ['toast', '📦 박스 출하를 끝냅니다'], ['go', 'inventory']]);
  });
  await at('끝내기 — 담아 둔 봉이 있으면 한 번 묻는다: 계속 찍기=머문다 · 끝내기=나간다 · 묻는 사이 화면을 떠났으면 아무것도 안 한다', async () => {
    const bag = { indivId: 'FG-1' };
    const stay = { bags: [bag, bag], busy: false, shipRows: rows1, shipsOk: true };
    const c1 = await finish(stay, { yes: false });
    assert.deepStrictEqual(plain(c1.map((x) => x[0])), ['confirm'], '취소 = 아무것도 안 함');
    assert.deepStrictEqual(c1[0].slice(3), [{ no: '계속 찍기', yes: '끝내기' }]);
    assert.ok(c1[0][1].includes('2개'));
    assert.strictEqual(stay.busy, false, '묻고 나면 잠금을 푼다');
    assert.strictEqual(c1.busy.confirm, true, '확인창이 떠 있는 동안 카메라가 읽은 봉을 담지 않는다(잠금)');
    const c2 = await finish({ bags: [bag], busy: false, shipRows: rows1, shipsOk: true }, { yes: true });
    assert.deepStrictEqual(plain(c2.map((x) => x[0])), ['confirm', 'stop', 'toast', 'go']);
    assert.deepStrictEqual(plain(c2.busy), { confirm: true, stop: true }, '확인창에서도 카메라를 끄는 동안에도 잠금');
    const gone = { bags: [bag], busy: false, shipRows: rows1, shipsOk: true };
    const c3 = await finish(gone, { yes: true, leave: true });
    assert.deepStrictEqual(plain(c3.map((x) => x[0])), ['confirm'], '화면을 떠났으면 나가기·카메라 끄기를 또 하지 않는다');
    assert.strictEqual(gone.busy, false, '떠난 뒤에도 잠금을 남기지 않는다');
  });
  await at('끝내기 — 저장 중이거나 화면 상태가 없으면 무시', async () => {
    assert.deepStrictEqual(plain(await finish({ bags: [], busy: true, shipRows: [] })), []);
    assert.deepStrictEqual(plain(await finish(null)), []);
  });

  /* 저장 — 진짜 boxShipSave 를 가짜 시트로 돌린다(문자열 포함 검사가 아니라 동작으로) */
  const tick = () => new Promise((r) => setImmediate(r));
  const lineOf = (head) => { const a = SRC.indexOf(head); assert.ok(a !== -1, `${head} 없음`); return SRC.slice(a, SRC.indexOf('\n', a)); };
  const saveWorld = () => {
    const tabs = {
      '완제품개별': ['FG-1', 'FG-2', 'FG-3', 'FG-4'].map((id) => [id, 'LOT-A', 'FG001', '출하가능', '', '', '']),
      '출하기록': [],
      '완제품LOT': [['LOT-A', '2026-10-04', '호두과자', '', '', '', '', '', '4', '출하가능']],
      '작업지시서': [],
    };
    const fail = { batch: false };
    const toasts = [], buzz = [];
    const state = { currentScreen: 'box-ship', user: { email: 'w@x' }, _boxShip: null };
    const bs = state._boxShip = { mode: 'parcel', bags: [], indiv: new Map(), used: new Map(), ready: true, busy: false, last: { code: '', at: 0 }, lastSaved: '', shipRows: [], shipByIndiv: new Map(), fresh: false, shipsOk: true };
    tabs['완제품개별'].forEach((r) => bs.indiv.set(r[0], { indivId: r[0], lotId: r[1], status: r[3], itemName: '호두과자' }));
    const sheets = {
      invalidateCache() {},
      getAll: async (tab) => tabs[tab].map((r) => r.slice()),
      append: async (tab, rows) => { tabs[tab].push(...rows.map((r) => r.slice())); },
      findRowIndex: async (tab, col, id) => { const i = tabs[tab].findIndex((r) => r[col] === id); return i === -1 ? -1 : i + 2; },
      batchUpdate: async (upd) => {
        if (fail.batch) throw new Error('끊김');
        upd.forEach((u) => { const m = u.range.match(/^(.+)!([A-Z])(\d+)$/); tabs[m[1]][Number(m[3]) - 2][m[2].charCodeAt(0) - 65] = u.values[0][0]; });
      },
      updateCell: async () => {},
    };
    const c = vm.createContext({
      State: state, SheetsAPI: sheets, BoxShip, BOX_SHIP_CFG, console: { error() {}, warn() {} },
      acquireLock: () => true, releaseLock() {}, showLoading() {}, hideLoading() {},
      formatDate: () => '2026-10-04', formatDateTime: () => '2026-10-04 10:00',
      getShipFreezerStamp: async () => null, warnShipStamp() {}, boxShipEnsureHeader: async () => {},
      toast: (m, k) => toasts.push([m, k]), boxShipBuzz: (good) => buzz.push(good), renderBoxShip() {}, boxShipConfirm: async () => true,
    });
    vm.runInContext([lineOf('function boxShipRef(r) {'), fnText('function boxShipUsedMap(ships) {'), fnText('async function boxShipSave(ref) {'), fnText('async function boxShipAccept(raw, opt = {}) {')].join('\n'), c);
    return {
      tabs, fail, toasts, buzz, bs,
      save: (ref) => vm.runInContext(`boxShipSave(${JSON.stringify(ref)})`, c), accept: (raw, opt) => vm.runInContext(`boxShipAccept(${JSON.stringify(raw)}, ${JSON.stringify(opt || {})})`, c),
      put: (...ids) => ids.forEach((id) => bs.bags.push({ indivId: id, lotId: 'LOT-A', itemName: '호두과자' })),
      status: () => tabs['완제품개별'].map((r) => r[3]),
      last: () => toasts[toasts.length - 1],
    };
  };
  const W1 = '501234567890', W2 = '501234567999';
  const UP = '출하가능', DONE = '출하완료';

  await at('저장(진짜 코드·가짜 시트) — 택배 3봉: 행 3 · 봉 출하완료 · LOT 잔량 1 · 상자 비우고 다음 상자 표시', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2', 'FG-3');
    await w.save(W1);
    assert.strictEqual(w.tabs['출하기록'].length, 3);
    assert.ok(w.tabs['출하기록'].every((r) => r[12] === `'${W1}` && r[13] === '택배'), '송장은 작은따옴표로 글자 고정 · 방식 택배');
    assert.strictEqual(new Set(w.tabs['출하기록'].map((r) => r[0])).size, 3, '봉마다 shipId 가 다르다');
    assert.deepStrictEqual(w.status(), [DONE, DONE, DONE, UP]);
    assert.strictEqual(w.tabs['완제품LOT'][0][8], '1', 'LOT 잔량');
    assert.deepStrictEqual([w.bs.bags.length, w.bs.fresh, w.bs.busy, w.bs.shipRows.length], [0, true, false, 3]);
    assert.deepStrictEqual(plain(w.bs.used.get(W1)), ['FG-1', 'FG-2', 'FG-3']);
  });
  await at('저장 — 상태 쓰기가 끊겨도 같은 송장으로 다시 저장하면 행을 두 번 쓰지 않고 이어 쓴다', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2', 'FG-3');
    w.fail.batch = true;
    await w.save(W1);
    assert.strictEqual(w.tabs['출하기록'].length, 3, '행은 먼저 적혔다');
    assert.deepStrictEqual(w.status(), [UP, UP, UP, UP], '상태는 아직');
    assert.strictEqual(w.last()[1], 'err');
    assert.deepStrictEqual([w.bs.bags.length, w.bs.busy], [3, false], '상자는 그대로 · 잠금은 풀린다');
    w.fail.batch = false;
    await w.save(W1);
    assert.strictEqual(w.tabs['출하기록'].length, 3, '중복 행 없음');
    assert.deepStrictEqual(w.status(), [DONE, DONE, DONE, UP]);
    assert.ok(w.bs.lastSaved.includes('끊긴 저장 이어 쓰기'));
  });
  await at('저장 — 끊긴 저장의 봉을 다른 송장으로 다시 담아도 두 번 적지 않는다 · 처음 송장으로 마저 저장하면 끝난다', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2', 'FG-3');
    w.fail.batch = true; await w.save(W1); w.fail.batch = false;
    w.bs.bags = [];                                   // 작업자가 포기하고 비웠다
    w.put('FG-1', 'FG-2', 'FG-3');
    await w.save(W2);                                 // 같은 봉을 다른 송장 상자로
    assert.strictEqual(w.tabs['출하기록'].length, 3, '같은 봉이 출하기록에 두 번 적히지 않는다');
    assert.deepStrictEqual(w.status(), [UP, UP, UP, UP], '아무것도 바꾸지 않는다');
    assert.strictEqual(w.bs.bags.length, 0, '다른 송장에 이미 적힌 봉은 상자에서 뺀다');
    assert.ok(w.last()[0].includes(W1) && w.last()[1] === 'err', '처음 송장을 알려 준다');
    assert.ok(w.last()[0].includes('다시 저장해 끝내거나'), '택배는 그 송장을 다시 찍어 끝낼 수 있다');
    assert.deepStrictEqual(plain(w.bs.used.get(W1)), ['FG-1', 'FG-2', 'FG-3'], '그 송장으로 마저 저장할 수 있게 기억한다');
    const st = (id) => w.bs.indiv.get(id).status;
    assert.strictEqual(BoxShip.checkWaybill([], W1, w.bs.used, st).reason, 'resume', '상자가 빈 채 그 송장을 찍으면 «끊긴 저장»');
    w.put('FG-1', 'FG-2', 'FG-3');
    assert.strictEqual(BoxShip.checkWaybill(w.bs.bags, W1, w.bs.used, st).ok, true, '봉을 다시 담고 찍으면 이어 쓴다');
    await w.save(W1);
    assert.strictEqual(w.tabs['출하기록'].length, 3);
    assert.deepStrictEqual(w.status(), [DONE, DONE, DONE, UP]);
  });
  const oldRow = (n, id, ref, method = '직배') => shipRow({ 0: `SHP-20261003-00${n}`, 2: id, 12: ref, 13: method });
  await at('저장 — 직배: 어제 끊긴 전표의 봉만 담았으면 그 전표로 이어 써서 끝낸다(오늘 전표로 또 적지 않는다)', async () => {
    const w = saveWorld(); w.bs.mode = 'songdo'; w.put('FG-1', 'FG-2');
    w.tabs['출하기록'].push(oldRow(1, 'FG-1', 'D-20261003-송도'), oldRow(2, 'FG-2', 'D-20261003-송도'));
    await w.save('D-20261004-송도');
    assert.strictEqual(w.tabs['출하기록'].length, 2, '행을 더하지 않는다');
    assert.deepStrictEqual(w.status(), [DONE, DONE, UP, UP], '끊긴 상태 쓰기가 끝난다');
    assert.deepStrictEqual([w.bs.bags.length, w.bs.fresh, w.bs.busy], [0, true, false]);
    assert.ok(w.bs.lastSaved.includes('D-20261003-송도') && w.bs.lastSaved.includes('끊긴 저장 이어 쓰기'), w.bs.lastSaved);
    assert.ok(!w.bs.lastSaved.includes('D-20261004'), '오늘 전표로 적히지 않는다');
    assert.strictEqual(w.last()[1], 'suc');
    assert.strictEqual(w.tabs['완제품LOT'][0][8], '2', 'LOT 잔량도 맞춘다');
  });
  await at('저장 — 직배: 끊긴 봉이 새 봉과 섞였으면 이어 쓰지 않고 끊긴 봉만 뺀다 → 그 봉만 따로 담으면 끝낼 수 있다(막다른 길 없음)', async () => {
    const w = saveWorld(); w.bs.mode = 'songdo'; w.put('FG-1', 'FG-2');
    w.tabs['출하기록'].push(oldRow(1, 'FG-1', 'D-20261003-송도'));
    await w.save('D-20261004-송도');
    assert.strictEqual(w.tabs['출하기록'].length, 1, '같은 봉을 오늘 전표로 또 적지 않는다');
    assert.deepStrictEqual(w.status(), [UP, UP, UP, UP]);
    assert.deepStrictEqual(plain(w.bs.bags.map((b) => b.indivId)), ['FG-2'], '끊긴 봉만 상자에서 빠진다');
    assert.ok(w.last()[1] === 'err' && w.last()[0].includes('D-20261003-송도') && w.last()[0].includes('그 봉만 따로 담아'), w.last()[0]);
    w.bs.bags = []; w.put('FG-1');                    // 작업자가 끊긴 그 봉만 다시 담는다
    await w.save('D-20261004-송도');
    assert.deepStrictEqual(w.status(), [DONE, UP, UP, UP], '끝낼 수 있다');
    assert.strictEqual(w.tabs['출하기록'].length, 1);
    assert.ok(w.bs.lastSaved.includes('D-20261003-송도'));
  });
  await at('저장 — 직배: 다른 받는 곳 전표 · 택배 송장 · 전표 둘 이상으로 끊긴 봉은 이어 쓰지 않고 막는다', async () => {
    const cases = [
      [['FG-1'], [oldRow(1, 'FG-1', 'D-20261003-콜로')]],
      [['FG-1'], [oldRow(1, 'FG-1', `'${W1}`, '택배')]],
      [['FG-1'], [oldRow(1, 'FG-1', 'D-20260926-송도')]],
      [['FG-1', 'FG-2'], [oldRow(1, 'FG-1', 'D-20261003-송도'), oldRow(2, 'FG-2', 'D-20261002-송도')]],
    ];
    for (const [ids, rows] of cases) {
      const w = saveWorld(); w.bs.mode = 'songdo'; w.put(...ids);
      w.tabs['출하기록'].push(...rows);
      await w.save('D-20261004-송도');
      assert.strictEqual(w.tabs['출하기록'].length, rows.length, '행을 더하지 않는다');
      assert.deepStrictEqual(w.status(), [UP, UP, UP, UP], '상태도 바꾸지 않는다');
      assert.strictEqual(w.bs.bags.length, 0, '끊긴 봉은 상자에서 뺀다');
      assert.strictEqual(w.last()[1], 'err');
    }
  });
  await at('저장이 안 되면 낮은 소리 — 막힘·그 사이 처리됨·다른 송장으로 이미 적힘·끊김은 «삑삑» 한 번씩, 성공은 조용(송장을 읽을 때 이미 울렸다)', async () => {
    const cases = [   // [이름, 알림 종류, 시트 준비, 저장 뒤 출하기록 행 수]
      ['송장 재사용으로 막힘', 'warn', (w) => { w.tabs['출하기록'].push(oldRow(1, 'FG-4', `'${W1}`, '택배')); }, 1],
      ['그 사이 다른 곳에서 처리됨', 'err', (w) => { w.tabs['완제품개별'][0][3] = DONE; }, 0],
      ['다른 송장으로 이미 적힘', 'err', (w) => { w.tabs['출하기록'].push(oldRow(1, 'FG-1', `'${W2}`, '택배')); }, 1],
      ['저장 중 끊김', 'err', (w) => { w.fail.batch = true; }, 3],
    ];
    for (const [name, kind, setup, rows] of cases) {
      const w = saveWorld(); w.put('FG-1', 'FG-2', 'FG-3');
      setup(w);
      await w.save(W1);
      assert.deepStrictEqual(plain(w.buzz), [false], `${name} — 낮은 소리가 정확히 한 번 울려야 한다`);
      assert.strictEqual(w.last()[1], kind, `${name} — 알림 종류`);
      assert.strictEqual(w.tabs['출하기록'].length, rows, `${name} — 출하기록 행 수(성공 경로가 아니다)`);
    }
    const ok = saveWorld(); ok.put('FG-1', 'FG-2', 'FG-3');
    await ok.save(W1);
    assert.deepStrictEqual(plain(ok.buzz), [], '성공은 조용하다 — 송장을 읽을 때 이미 «삑» 하고 울렸다');
    assert.strictEqual(ok.last()[1], 'suc');
  });
  await at('저장이 안 되면 낮은 소리 — 송도 직배·콜로 픽업도 같다(그 사이 처리됨 · 끊긴 봉이 섞임 · 끊김은 «삑삑» 한 번씩) · 성공은 소리 없이 알림·«방금 저장» 으로만', async () => {
    for (const mode of ['songdo', 'colo']) {
      const tag = BOX_SHIP_CFG.MODES[mode].tag;
      const ref = `D-20261004-${tag}`;
      const cases = [   // [이름, 알림 종류, 시트 준비, 저장 뒤 출하기록 행 수] — 택배의 «송장 재사용 막힘» 은 직배·픽업에 없다
        ['그 사이 다른 곳에서 처리됨', 'err', (w) => { w.tabs['완제품개별'][0][3] = DONE; }, 0],
        ['끊긴 봉이 새 봉과 섞임', 'err', (w) => { w.tabs['출하기록'].push(oldRow(1, 'FG-1', `D-20261003-${tag}`)); }, 1],
        ['저장 중 끊김', 'err', (w) => { w.fail.batch = true; }, 2],
      ];
      for (const [name, kind, setup, rows] of cases) {
        const w = saveWorld(); w.bs.mode = mode; w.put('FG-1', 'FG-2');
        setup(w);
        await w.save(ref);
        assert.deepStrictEqual(plain(w.buzz), [false], `${mode} · ${name} — 낮은 소리가 정확히 한 번 울려야 한다`);
        assert.strictEqual(w.last()[1], kind, `${mode} · ${name} — 알림 종류`);
        assert.strictEqual(w.tabs['출하기록'].length, rows, `${mode} · ${name} — 출하기록 행 수(성공 경로가 아니다)`);
      }
      const done = saveWorld(); done.bs.mode = mode; done.put('FG-1', 'FG-2');
      await done.save(ref);
      assert.deepStrictEqual(plain(done.buzz), [], `${mode} — 성공은 소리가 없다(«저장» 단추를 눌러 부르므로 화면 알림·«방금 저장» 으로 알린다)`);
      assert.strictEqual(done.last()[1], 'suc');
      assert.ok(done.bs.lastSaved.includes(ref), done.bs.lastSaved);
    }
  });
  await at('찍어서 저장까지(진짜 찍기 + 진짜 저장) — 송장을 읽으면 높은 소리 → 저장이 끊기면 이어서 낮은 소리 · 성공이면 높은 소리 하나뿐', async () => {
    const cut = saveWorld(); cut.put('FG-1', 'FG-2', 'FG-3'); cut.fail.batch = true;
    await cut.accept(W1);
    assert.deepStrictEqual(plain(cut.buzz), [true, false], '읽자마자 높은 소리 · 저장이 끊기면 이어서 낮은 소리(이 순서)');
    assert.strictEqual(cut.last()[1], 'err');
    assert.deepStrictEqual([cut.bs.bags.length, cut.bs.busy], [3, false], '끊겨도 상자는 그대로 · 잠금은 풀린다');
    const done = saveWorld(); done.put('FG-1', 'FG-2', 'FG-3');
    await done.accept(W1);
    assert.deepStrictEqual(plain(done.buzz), [true], '성공 = 읽을 때의 높은 소리 하나(저장은 조용)');
    assert.strictEqual(done.last()[1], 'suc');
  });
  await at('이어 쓸 전표 — 상자의 봉이 전부 같은 받는 곳의 옛 전표로 끊겼을 때만', async () => {
    const L = (...refs) => refs.map((ref, i) => ({ indivId: `FG-${i}`, ref }));
    const T = 'D-20261004-송도';
    assert.strictEqual(BoxShip.resumeRef(L('D-20261003-송도', 'D-20261003-송도'), 2, T), 'D-20261003-송도');
    assert.strictEqual(BoxShip.resumeRef(L('D-20261003-송도'), 2, T), null, '일부만 끊김');
    assert.strictEqual(BoxShip.resumeRef(L('D-20261003-송도', 'D-20261002-송도'), 2, T), null, '전표 둘');
    assert.strictEqual(BoxShip.resumeRef(L('D-20261003-콜로'), 1, T), null, '다른 받는 곳');
    assert.strictEqual(BoxShip.resumeRef(L(W1), 1, T), null, '택배 송장');
    assert.strictEqual(BoxShip.resumeRef(L(T), 1, T), null, '오늘 전표면 이어 쓸 게 없다');
    assert.strictEqual(BoxShip.resumeRef(L('D-20261003-송도'), 1, W1), null, '오늘 값이 직배 전표가 아니면(택배 송장)');
    assert.strictEqual(BoxShip.resumeRef(L('D-20260927-송도'), 1, T), 'D-20260927-송도', '7일 전(월 경계 포함)까지는 이어 쓴다');
    assert.strictEqual(BoxShip.resumeRef(L('D-20260926-송도'), 1, T), null, '8일 전 전표는 사람이 시트를 본다');
    assert.strictEqual(BoxShip.resumeRef(L('D-20261005-송도'), 1, T), null, '미래 전표(기기 시계 어긋남)는 이어 쓰지 않는다');
    assert.strictEqual(BoxShip.resumeRef(null, 1, T), null);
    assert.strictEqual(BoxShip.resumeRef([], 0, T), null);
  });

  /* 카메라 — 켜는 사이 화면을 떠나면 켜진 카메라를 직접 끈다(라우터는 전역만 비우고, 아직 안 켜진 것을 끄다 만다) */
  const scanWorld = (state) => {
    const log = [];
    const holder = {};
    holder.rel = []; holder.rej = []; holder.stopped = [];
    holder.release = () => holder.rel.splice(0).forEach((f) => f());   // 켜는 중인 스캐너를 모두 켜진 것으로
    class FakeScanner {
      constructor() { if (holder.ctorFail) throw new Error('생성 실패'); this.on = false; this.id = holder.n = (holder.n || 0) + 1; }
      start() { return new Promise((r, j) => { holder.rel.push(() => { this.on = true; r(); }); holder.rej.push(j); }); }
      stop() { if (!this.on) return Promise.reject(new Error('not running')); log.push('stop'); holder.stopped.push(this.id); this.on = false; return Promise.resolve(); }
      clear() { log.push('clear'); }
    }
    const win = {};
    const el = { clientWidth: 300, clientHeight: 200, innerHTML: '' };
    const c = vm.createContext({ window: win, State: state, Html5Qrcode: FakeScanner, $id: () => el, HS_ESC: String, boxShipAccept() {}, Math });
    vm.runInContext(fnText('async function stopBoxShipScan() {') + '\n' + fnText('async function startBoxShipScan() {'), c);
    return { log, win, holder, el, run: (js) => vm.runInContext(js, c) };
  };
  await at('카메라 — 켜는 사이 화면을 떠나면 켜진 카메라를 끈다(라우터가 전역을 먼저 비워도)', async () => {
    const state = { currentScreen: 'box-ship' };
    const s = scanWorld(state);
    const p = s.run('startBoxShipScan()');
    await tick();
    state.currentScreen = 'inventory';
    await s.run('stopBoxShipScan()');                 // 라우터가 하는 일 — 아직 안 켜져서 stop 이 던진다
    s.holder.release();
    await p;
    assert.ok(s.log.includes('stop'), '켜진 카메라가 꺼지지 않았다');
    assert.strictEqual(s.win._boxShipScanner, null);
  });
  await at('카메라 — 화면에 머물면 끄지 않는다', async () => {
    const s = scanWorld({ currentScreen: 'box-ship' });
    const p = s.run('startBoxShipScan()');
    await tick();
    s.holder.release();
    await p;
    assert.deepStrictEqual(s.log, [], '머무는데 끄면 안 된다');
    assert.ok(s.win._boxShipScanner, '전역 스캐너는 남는다');
  });

  /* 소리 — 위 «소리 재생» 시험이 못 본 둘: 닫힌 오디오는 새로 열고 · 깨우기가 거절돼도 오류가 새지 않는다 */
  await at('소리 — 닫힌 오디오는 새로 열고 · 깨우기가 거절돼도 처리 안 된 오류가 새지 않는다', async () => {
    let made = 0, rejected = 0;
    const AC = function AC() { made++; this.state = 'running'; this.currentTime = 0; this.destination = {}; this.createGain = () => ({ gain: {}, connect() {} }); this.createOscillator = () => ({ frequency: {}, connect() {}, start() {}, stop() {} }); this.resume = () => Promise.reject(new Error('막힘')); };
    const win = { AudioContext: AC };
    const run = () => vm.runInContext(fnText('function boxShipBeep(ok) {') + '; boxShipBeep(true)', vm.createContext({ window: win, BoxShip, Math }));
    const onRej = () => { rejected++; };
    process.on('unhandledRejection', onRej);
    run();
    win._boxShipAudio.state = 'closed';
    run();
    assert.strictEqual(made, 2, '닫힌 오디오는 새로 만든다');
    win._boxShipAudio.state = 'suspended';
    run();
    await tick(); await tick();
    process.off('unhandledRejection', onRej);
    assert.strictEqual(rejected, 0, '깨우기 거절이 처리되지 않은 오류로 샌다');
  });

  await at('카메라 — 켜는 사이 화면만 떠나고 전역은 그대로면 직접 끄고 전역도 비운다', async () => {
    const state = { currentScreen: 'box-ship' };
    const s = scanWorld(state);
    const p = s.run('startBoxShipScan()');
    await tick();
    state.currentScreen = 'inventory';                // 라우터가 stopBoxShipScan 을 아직 안 불렀다
    s.holder.release();
    await p;
    assert.deepStrictEqual(s.holder.stopped, [1], '켜진 카메라를 끈다');
    assert.strictEqual(s.win._boxShipScanner, null, '끈 스캐너를 전역에 남기지 않는다');
    assert.ok(s.log.includes('clear'), '화면을 떠났으니 비춘 화면도 치운다');
  });
  await at('카메라 — 켜는 사이 같은 화면에서 다시 시작되면 먼저 켠 것만 끈다', async () => {
    const s = scanWorld({ currentScreen: 'box-ship' });
    const a = s.run('startBoxShipScan()');
    await tick();
    const b = s.run('startBoxShipScan()');            // B 가 A 를 끄려 하지만 A 는 아직 안 켜져 stop 이 던진다
    await tick();
    s.holder.release();
    await Promise.all([a, b]);
    assert.deepStrictEqual(s.holder.stopped, [1], '먼저 켠 A 만 끈다(둘 다 켜져 남으면 카메라가 겹친다)');
    assert.ok(s.win._boxShipScanner, '나중 것 B 는 남는다');
    assert.strictEqual(s.log.filter((x) => x === 'clear').length, 1, 'B 가 시작할 때 한 번뿐 — 밀려난 A 가 같은 화면을 또 지우면 B 의 영상이 사라진다');
  });
  await at('카메라 — 더 새로 켠 스캐너가 있으면 먼저 켜던 것이 뒤늦게 실패해도 그 화면에 오류 문구를 덮지 않는다', async () => {
    const s = scanWorld({ currentScreen: 'box-ship' });
    const a = s.run('startBoxShipScan()');
    await tick();
    const b = s.run('startBoxShipScan()');
    await tick();
    s.holder.rej[0](new Error('끊김'));               // A 가 뒤늦게 실패
    s.holder.rel[1]();                                 // B 는 켜진다
    await Promise.all([a, b]);
    assert.strictEqual(s.el.innerHTML, '', 'B 가 쓰는 화면에 A 의 오류가 덮였다');
    assert.ok(s.win._boxShipScanner, 'B 의 스캐너는 남는다');
  });
  await at('카메라 — 내 시작이 실패하면 오류 문구를 보이고 전역을 비운다', async () => {
    const s = scanWorld({ currentScreen: 'box-ship' });
    const a = s.run('startBoxShipScan()');
    await tick();
    s.holder.rej[0](new Error('권한 없음'));
    await a;
    assert.ok(s.el.innerHTML.includes('카메라를 쓸 수 없습니다') && s.el.innerHTML.includes('권한 없음'));
    assert.strictEqual(s.win._boxShipScanner, null);
  });

  await at('카메라 — 스캐너를 만들지도 못하면 오류 문구를 보인다(전역이 비어 있어도)', async () => {
    const s = scanWorld({ currentScreen: 'box-ship' });
    s.holder.ctorFail = true;
    await s.run('startBoxShipScan()');
    assert.ok(s.el.innerHTML.includes('카메라를 쓸 수 없습니다') && s.el.innerHTML.includes('생성 실패'));
    assert.ok(!s.win._boxShipScanner);
  });

  /* 송장 기억 · 끊긴 저장 안내 · 불러오기(출하기록을 못 읽은 표시) */
  await at('송장 기억 — 택배 행만 모은다(직배·픽업 전표는 안 넣는다) · 글자 고정 따옴표는 뗀다', async () => {
    const c = vm.createContext({});
    vm.runInContext(lineOf('function boxShipRef(r) {') + '\n' + fnText('function boxShipUsedMap(ships) {'), c);
    const m = vm.runInContext('boxShipUsedMap', c)([shipRow({ 2: 'FG-1', 12: `'${W1}`, 13: '택배' }), shipRow({ 2: 'FG-2', 12: `'${W1}`, 13: '택배' }), shipRow({ 2: 'FG-3', 12: 'D-20261004-송도', 13: '직배' }), shipRow({ 2: 'FG-4', 12: '', 13: '택배' })]);
    assert.deepStrictEqual(plain([...m]), [[W1, ['FG-1', 'FG-2']]]);
  });
  await at('찍기 — 빈 상자에 끊긴 저장의 송장을 찍으면 «끊긴 저장» · 봉이 다 나갔으면 «이미 저장»(소리 없이)', async () => {
    const log = { toasts: [], buzz: [] };
    const bs = { mode: 'parcel', bags: [], indiv: new Map(), used: new Map([[W1, ['FG-1']]]), ready: true, busy: false, last: { code: '', at: 0 }, shipRows: [], shipByIndiv: new Map(), fresh: false, shipsOk: true };
    bs.indiv.set('FG-1', { indivId: 'FG-1', lotId: 'LOT-A', status: UP, itemName: '호두과자' });
    const c = vm.createContext({ State: { currentScreen: 'box-ship', _boxShip: bs }, BoxShip, BOX_SHIP_CFG, Date: { now: () => 5000 }, String, Object, toast: (m, k) => log.toasts.push([m, k]), boxShipBuzz: (g) => log.buzz.push(g), renderBoxShip() {}, boxShipConfirm: async () => true, boxShipSave: async () => {} });
    const accept = vm.runInContext(fnText('async function boxShipAccept(raw, opt = {}) {') + '; boxShipAccept', c);
    await accept(W1, { manual: true });
    assert.deepStrictEqual(plain(log.toasts[0]), [BoxShip.message({ reason: 'resume' }), 'warn']);
    assert.deepStrictEqual(log.buzz, [false], '끊긴 저장은 실수 소리');
    bs.indiv.get('FG-1').status = DONE;
    await accept(W1, { manual: true });
    assert.deepStrictEqual(plain(log.toasts[1]), [BoxShip.message({ reason: 'saved' }), 'info']);
    assert.deepStrictEqual(log.buzz, [false], '이미 저장은 소리를 더하지 않는다');
  });
  const loadWorld = async (shipsFail) => {
    const state = { currentScreen: 'box-ship', _boxShip: null };
    const el = { innerHTML: '' };
    const data = { '완제품개별': [['FG-1', 'LOT-A', 'FG001', UP]], '완제품LOT': [['LOT-A', '2026-10-04', '호두과자']], '출하기록': [shipRow({ 0: 'SHP-20261004-001', 2: 'FG-9', 12: `'${W1}`, 13: '택배' })] };
    const sheets = { invalidateCache() {}, getAll: async (tab) => { if (tab === '출하기록' && shipsFail) throw new Error('읽기 실패'); return data[tab].map((r) => r.slice()); } };
    const c = vm.createContext({ State: state, Screens: {}, BOX_SHIP_CFG, BoxShip, SheetsAPI: sheets, renderHeader() {}, $id: () => el, HS_ESC: String, renderBoxShip() {}, startBoxShipScan() {}, boxShipAccept: async () => {}, console });
    const a = SRC.indexOf("Screens['box-ship'] = async (params = {}) => {");
    assert.ok(a !== -1);
    vm.runInContext([lineOf('function boxShipRef(r) {'), fnText('function boxShipUsedMap(ships) {'), SRC.slice(a, SRC.indexOf('\n};\n', a) + 3)].join('\n'), c);
    await vm.runInContext("Screens['box-ship']({})", c);
    return state._boxShip;
  };
  await at('불러오기 — 출하기록을 읽으면 오늘 수·이미 나간 봉·송장 기억이 채워진다', async () => {
    const bs = await loadWorld(false);
    assert.deepStrictEqual([bs.ready, bs.shipsOk, bs.shipRows.length, bs.indiv.has('FG-1'), bs.shipByIndiv.has('FG-9')], [true, true, 1, true, true]);
    assert.deepStrictEqual(plain(bs.used.get(W1)), ['FG-9']);
  });
  await at('불러오기 — 출하기록을 못 읽어도 화면은 열되 «못 읽음» 으로 표시한다(오늘 수를 말하지 않게)', async () => {
    const bs = await loadWorld(true);
    assert.deepStrictEqual([bs.ready, bs.shipsOk, bs.shipRows.length, bs.used.size], [true, false, 0, 0]);
  });

  asyncDone = true;
  console.log(ok.map((n) => '✓ ' + n).join('\n'));
  console.log(`\n${ok.length}건 통과`);
})().catch((e) => { console.error(e); process.exit(1); });
