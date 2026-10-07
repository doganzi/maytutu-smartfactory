/* 송도 직배 — 봉 라벨을 찍어 담고 «저장» (2026-10-07 «박스 출하 롤백, 송도 직배만 남긴다»)
   index.html 의 <songdo-ship> 블록과 그 화면·저장 함수를 그대로 떼어 돌린다(사본을 두면 원본과 갈라진다).
   박스 출하(#169 — 택배 겉 라벨 + 한진 송장 · 콜로 픽업 · 봉 라벨 2장)는 되돌렸다(#183) — 이 시험은 그 되돌림이 유지되는지도 지킨다.

   확인:  ① 찍은 코드 가르기 — FG-… 봉 라벨만 받는다(송장 번호는 안 받는다)
         ② 봉 담기 — 중복·미등록·출하완료·폐기·냉동보관중은 거절, 출하가능만 담는다
         ③ 저장 계획 — 세 번에 나눠 쓰다 끊겨도 같은 봉이 두 번 출하되지 않는다 · 어제 끊긴 전표는 이어 쓴다
         ④ shipId 연속 채번 · 출하기록 15열(전표 / 직배 / 송도직영점)
         ⑤ 연결 — 옛 출하 창(선택 출하·LOT 전체·봉 하나)이 살아 있고, 박스 출하 잔재가 없고, 이 화면이 라우터·메뉴에 붙어 있다
         ⑥ 안내 흐름 — 단계 표시·다음에 할 일·오늘 수·소리·끝내기
         ⑦ 저장(진짜 코드·가짜 시트) · 카메라 · 불러오기

   실행:  node tests/songdo-ship.test.js                                                      */
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
const ctx = vm.createContext({ Math, Date, JSON, Map, Set, Array, String, parseInt, console });
vm.runInContext(slice('// <songdo-ship>', '// </songdo-ship>'), ctx);
// const 선언은 컨텍스트 객체에 안 붙는다 — 값으로 꺼낸다
const { SongdoShip, SONGDO_SHIP_CFG } = vm.runInContext('({ SongdoShip, SONGDO_SHIP_CFG })', ctx);

const ok = [];
const t = (n, f) => { f(); ok.push(n); };
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ── ① 가르기 ─────────────────────────────────────────── */
t('봉 라벨은 FG- 로 시작 — 대소문자·앞뒤 공백 무시하고 대문자로', () => {
  assert.deepStrictEqual(plain(SongdoShip.classify('  fg-260930-001-03 ')), { kind: 'fg', code: 'FG-260930-001-03' });
});
t('그 밖의 코드는 전부 unknown — 숫자 12자리(택배 송장)도 이 화면은 받지 않는다', () => {
  ['501234567890', '5012-3456-7890', 'LOT-260930-001', 'RM-011-01', '', null, undefined].forEach((v) => assert.strictEqual(SongdoShip.classify(v).kind, 'unknown', String(v)));
  assert.strictEqual(SongdoShip.classify('501234567890').code, '501234567890', '코드는 그대로 돌려준다(안내문에 보여 줄 값)');
});

/* ── ② 봉 담기 ────────────────────────────────────────── */
t('출하가능 봉만 담는다 — 그 밖은 이유를 단다', () => {
  const bags = [{ indivId: 'FG-A' }];
  assert.strictEqual(SongdoShip.checkBag(bags, 'FG-B', { status: '출하가능' }).ok, true);
  assert.strictEqual(SongdoShip.checkBag(bags, 'FG-A', { status: '출하가능' }).reason, 'dup');
  assert.strictEqual(SongdoShip.checkBag(bags, 'FG-C', undefined).reason, 'notfound');
  assert.strictEqual(SongdoShip.checkBag(bags, 'FG-C', { status: '출하완료' }).reason, 'shipped');
  assert.deepStrictEqual(plain(SongdoShip.checkBag(bags, 'FG-C', { status: '폐기' })), { ok: false, reason: 'blocked', status: '폐기' });
  assert.deepStrictEqual(plain(SongdoShip.checkBag(bags, 'FG-C', { status: '' })), { ok: false, reason: 'notready', status: '냉동보관중' });
  assert.deepStrictEqual(plain(SongdoShip.checkBag(bags, 'FG-C', { status: '냉동보관중' })), { ok: false, reason: 'notready', status: '냉동보관중' });
  ['소진', '입고취소', '삭제'].forEach((s) => assert.strictEqual(SongdoShip.checkBag(bags, 'FG-C', { status: s }).reason, 'blocked', s));
});
t('거절 이유마다 한국어 문구가 있다', () => {
  ['dup', 'notfound', 'shipped'].forEach((r) => assert.notStrictEqual(SongdoShip.message({ reason: r }), '처리할 수 없습니다', r));
  assert.ok(SongdoShip.message({ reason: 'blocked', status: '폐기' }).includes('폐기'));
  assert.ok(SongdoShip.message({ reason: 'notready', status: '냉동보관중' }).includes('냉동보관중'));
  assert.strictEqual(SongdoShip.message({ reason: '없는이유' }), '처리할 수 없습니다');
  assert.strictEqual(SongdoShip.message({ reason: 'shipped', info: '10/3 송도직영점 직배' }), '이미 출하된 봉입니다 (10/3 송도직영점 직배) — 넣지 않았습니다');
  assert.strictEqual(SongdoShip.message({ reason: 'shipped', info: '' }), '이미 출하된 봉입니다 — 넣지 않았습니다');
  assert.strictEqual(SongdoShip.message({ reason: 'shipped' }), '이미 출하된 봉입니다 — 넣지 않았습니다');
});

/* ── ③ 저장 계획 — 세 번에 나눠 쓰다 끊겨도 같은 봉이 두 번 출하되지 않는다 ── */
const shipRow = (p) => Object.assign(Array(15).fill(''), p);
t('저장 계획 — 처음 저장 · 남이 처리한 봉 · 끊긴 저장 이어 쓰기 · 같은 전표를 여러 번 써도 거절하지 않는다', () => {
  const bags = [{ indivId: 'FG-1' }, { indivId: 'FG-2' }, { indivId: 'FG-3' }];
  const ids = (a) => a.map((x) => x.indivId);
  const st = (m) => (id) => m[id];
  const UP3 = st({ 'FG-1': '출하가능', 'FG-2': '출하가능', 'FG-3': '출하가능' });
  const fresh = SongdoShip.planSave(bags, UP3, []);
  assert.deepStrictEqual([ids(fresh.toAppend), ids(fresh.toMark), fresh.gone.length], [['FG-1', 'FG-2', 'FG-3'], ['FG-1', 'FG-2', 'FG-3'], 0]);
  const gone = SongdoShip.planSave(bags, st({ 'FG-1': '출하가능', 'FG-2': '출하완료', 'FG-3': '폐기' }), []);
  assert.deepStrictEqual(ids(gone.gone), ['FG-2', 'FG-3'], '이 전표로 적힌 적 없는 출하완료·폐기 = 남이 처리');
  assert.strictEqual(gone.toAppend, undefined, '남이 처리한 봉이 있으면 아무것도 쓰지 않는다');
  // 출하기록만 적고 끊김 → 봉은 아직 출하가능: 행은 다시 쓰지 않고 상태만
  const r1 = SongdoShip.planSave(bags, UP3, [['S1', 'L', 'FG-1'], ['S2', 'L', 'FG-2'], ['S3', 'L', 'FG-3']]);
  assert.deepStrictEqual([ids(r1.toAppend), ids(r1.toMark)], [[], ['FG-1', 'FG-2', 'FG-3']]);
  // 상태까지 쓰고 끊김 → 출하완료 + 이미 적힘: 남이 처리한 것으로 보지 않고 LOT 만 맞춘다
  const r2 = SongdoShip.planSave(bags, st({ 'FG-1': '출하완료', 'FG-2': '출하완료', 'FG-3': '출하완료' }), [['S1', 'L', 'FG-1'], ['S2', 'L', 'FG-2'], ['S3', 'L', 'FG-3']]);
  assert.deepStrictEqual([r2.gone.length, ids(r2.toAppend), ids(r2.toMark)], [0, [], []]);
  // 직배 전표는 하루 여러 번 쓰인다 — 다른 봉이 같은 전표에 있어도 거절하지 않는다
  const d = SongdoShip.planSave(bags, UP3, [['S', 'L', 'FG-7']]);
  assert.deepStrictEqual([d.reject, ids(d.toAppend)], [undefined, ['FG-1', 'FG-2', 'FG-3']]);
});
t('저장 계획 — 다른 전표(옛 출하 창 포함)로 이미 적힌 봉이 아직 출하가능이면 막는다(끊긴 저장의 봉을 또 적지 않게)', () => {
  const bags = [{ indivId: 'FG-1' }, { indivId: 'FG-2' }, { indivId: 'FG-3' }];
  const up = () => '출하가능';
  const other = [{ indivId: 'FG-1', ref: 'D-20261003-송도' }, { indivId: 'FG-1', ref: 'D-20261002-송도' }];
  assert.deepStrictEqual(plain(SongdoShip.planSave(bags, up, [], other)), { gone: [], limbo: [{ indivId: 'FG-1', ref: 'D-20261003-송도' }] }, '한 봉은 한 번만(첫 기록)');
  assert.strictEqual(SongdoShip.planSave(bags, up, [shipRow({ 2: 'FG-1' })], other).limbo, undefined, '같은 전표에 이미 적힌 봉은 이어 쓰기');
  assert.deepStrictEqual(plain(SongdoShip.planSave(bags, (id) => (id === 'FG-1' ? '출하완료' : '출하가능'), [], other).gone.map((b) => b.indivId)), ['FG-1'], '이미 나간 봉은 목록에서 뺀다');
  assert.strictEqual(SongdoShip.planSave(bags, up, [], undefined).toAppend.length, 3, '다른 기록이 없으면 그대로 새로 적는다');
  assert.strictEqual(SongdoShip.planSave(bags, up, [], [{ indivId: 'FG-9', ref: 'D-20261003-송도' }]).toAppend.length, 3, '이 목록에 없는 봉의 기록은 상관없다');
  const oldWin = SongdoShip.planSave(bags, up, [], [{ indivId: 'FG-2', ref: '' }]);
  assert.deepStrictEqual(plain(oldWin.limbo), [{ indivId: 'FG-2', ref: '' }], '옛 출하 창이 행만 적고 끊긴 봉(전표 없음)도 같은 길로 막는다');
});
t('이어 쓸 전표 — 목록의 봉이 전부 같은 옛 송도 전표로 끊겼을 때만', () => {
  const L = (...refs) => refs.map((ref, i) => ({ indivId: `FG-${i}`, ref }));
  const T = 'D-20261004-송도';
  assert.strictEqual(SongdoShip.resumeRef(L('D-20261003-송도', 'D-20261003-송도'), 2, T), 'D-20261003-송도');
  assert.strictEqual(SongdoShip.resumeRef(L('D-20261003-송도'), 2, T), null, '일부만 끊김');
  assert.strictEqual(SongdoShip.resumeRef(L('D-20261003-송도', 'D-20261002-송도'), 2, T), null, '전표 둘');
  assert.strictEqual(SongdoShip.resumeRef(L('D-20261003-콜로'), 1, T), null, '다른 받는 곳(박스 출하 시절 콜로 전표)');
  assert.strictEqual(SongdoShip.resumeRef(L("'501234567890"), 1, T), null, '택배 송장(박스 출하 시절)');
  assert.strictEqual(SongdoShip.resumeRef(L(''), 1, T), null, '옛 출하 창 행(전표 없음)');
  assert.strictEqual(SongdoShip.resumeRef(L(T), 1, T), null, '오늘 전표면 이어 쓸 게 없다');
  assert.strictEqual(SongdoShip.resumeRef(L('D-20261003-송도'), 1, '501234567890'), null, '오늘 값이 전표가 아니면');
  assert.strictEqual(SongdoShip.resumeRef(L('D-20260927-송도'), 1, T), 'D-20260927-송도', '7일 전(월 경계 포함)까지는 이어 쓴다');
  assert.strictEqual(SongdoShip.resumeRef(L('D-20260926-송도'), 1, T), null, '8일 전 전표는 사람이 시트를 본다');
  assert.strictEqual(SongdoShip.resumeRef(L('D-20261005-송도'), 1, T), null, '미래 전표(기기 시계 어긋남)는 이어 쓰지 않는다');
  assert.strictEqual(SongdoShip.resumeRef(null, 1, T), null);
  assert.strictEqual(SongdoShip.resumeRef([], 0, T), null);
});

/* ── ④ shipId · 출하기록 행 ───────────────────────────── */
t('shipId 는 그날 최대 번호 다음부터 연속 · 서로 다르다 · 다른 날 번호는 무시', () => {
  const ids = SongdoShip.nextShipIds(['SHP-20261004-007', 'SHP-20261004-002', 'SHP-20261003-099', '', null], '2026-10-04', 4);
  assert.deepStrictEqual(plain(ids), ['SHP-20261004-008', 'SHP-20261004-009', 'SHP-20261004-010', 'SHP-20261004-011']);
  assert.strictEqual(new Set(ids).size, 4);
  assert.deepStrictEqual(plain(SongdoShip.nextShipIds([], '2026-10-04', 1)), ['SHP-20261004-001']);
});
const bags3 = [{ indivId: 'FG-1', lotId: 'LOT-A' }, { indivId: 'FG-2', lotId: 'LOT-A' }, { indivId: 'FG-3', lotId: 'LOT-B' }];
const temp = { temp: '-21.0', at: '2026-10-04 08:00', productTemp: '-21.0', method: '냉동창고와 동일' };
t('송도 직배 행 — 15열 · 앞 12열은 옛 출하 창과 같은 모양 · 전표 / 직배 / 송도직영점 · 온도 없으면 빈칸', () => {
  const ref = SongdoShip.directRef('2026-10-04');
  assert.strictEqual(ref, 'D-20261004-송도');
  const rows = plain(SongdoShip.buildRows(bags3, { ref, shipTime: '2026-10-04 09:10', shipper: 'a@b', temp, shipIds: ['S1', 'S2', 'S3'] }));
  assert.strictEqual(rows.length, 3);
  rows.forEach((r) => assert.strictEqual(r.length, 15));
  assert.deepStrictEqual(rows[2], ['S3', 'LOT-B', 'FG-3', '송도직영점', '1', 'ea', '2026-10-04 09:10', 'a@b', '-21.0°C', '2026-10-04 08:00', '-21.0°C', '냉동창고와 동일', 'D-20261004-송도', '직배', '송도직영점']);
  const s = plain(SongdoShip.buildRows(bags3.slice(0, 1), { ref, shipTime: 'x', shipper: '', temp: null, shipIds: ['S1'] }))[0];
  assert.deepStrictEqual(s.slice(8, 12), ['', '', '', ''], '온도 없으면 네 칸 모두 빈칸');
  assert.deepStrictEqual(s.slice(12), ['D-20261004-송도', '직배', '송도직영점']);
});
t('전표 이름 — D-날짜-송도 (날짜는 하이픈이 있든 없든)', () => {
  assert.strictEqual(SongdoShip.directRef('2026-10-04'), 'D-20261004-송도');
  assert.strictEqual(SongdoShip.directRef('20261004'), 'D-20261004-송도');
});
t('LOT 잔량 — 출하완료·폐기·입고취소·삭제는 빼고 센다', () => {
  const iv = [['FG-1', 'LOT-A', '', '출하가능'], ['FG-2', 'LOT-A', '', '출하완료'], ['FG-3', 'LOT-A', '', '냉동보관중'], ['FG-4', 'LOT-A', '', '폐기'], ['FG-5', 'LOT-B', '', '출하가능']];
  assert.strictEqual(SongdoShip.remainOf(iv, 'LOT-A'), 2);
  assert.strictEqual(SongdoShip.remainOf(iv, 'LOT-C'), 0);
});
t('설정 — 송도직영점 직배 하나뿐 · «…으로» 가 맞는 받는 곳(받침이 있고 ㄹ 이 아님)', () => {
  assert.deepStrictEqual(plain(SONGDO_SHIP_CFG).CUSTOMER, '송도직영점');
  assert.deepStrictEqual([SONGDO_SHIP_CFG.METHOD, SONGDO_SHIP_CFG.TAG], ['직배', '송도']);
  assert.deepStrictEqual(Object.keys(SONGDO_SHIP_CFG).sort(), ['CUSTOMER', 'DEBOUNCE_MS', 'HUSH_MS', 'METHOD', 'RESUME_DAYS', 'TAG'], '택배·콜로·상자 봉 수 같은 박스 출하 설정이 없다');
  const code = SONGDO_SHIP_CFG.CUSTOMER.charCodeAt(SONGDO_SHIP_CFG.CUSTOMER.length - 1) - 0xAC00, jong = code % 28;
  assert.ok(code >= 0 && code < 11172 && jong !== 0 && jong !== 8, '안내문이 받는 곳 뒤에 «으로» 를 직접 붙인다 — 받침이 없거나 ㄹ 받침이면 «로» 라 틀린다');
  assert.ok(CODE.includes('${SONGDO_SHIP_CFG.CUSTOMER}으로'), '코드가 더는 받는 곳 뒤에 «으로» 를 직접 붙이지 않는다 — 위 검사를 지운다');
});

/* ── ⑤ 연결 ───────────────────────────────────────────── */
t('롤백이 유지된다 — 박스 출하 식별자가 파일 어디에도(주석 포함) 없고, 택배·콜로·겉 라벨 문구가 코드에 없다', () => {
  ['BoxShip', 'BOX_SHIP', 'box-ship', 'boxShip', 'openBoxShip', 'LabelDup', 'lbl-box-copy', 'label-dup', 'WAYBILL_RE', 'BOX_PACKS'].forEach((g) => assert.ok(!SRC.includes(g), `박스 출하 잔재가 남았다: ${g}`));
  // 문구는 «되돌렸다» 를 적은 설명 주석에는 나온다 — 줄 끝 주석(`   // …`)까지 걷어낸 코드에서만 없으면 된다
  const bare = CODE.split('\n').map((l) => l.replace(/\s+\/\/\s.*$/, '')).join('\n');
  ['겉 라벨', '한진 송장', '콜로 픽업', '송장 찍기', '박스 출하'].forEach((g) => assert.ok(!bare.includes(g), `박스 출하 문구가 코드에 남았다: ${g}`));
});
t('옛 출하 창이 살아 있다 — 선택 출하(여러 봉을 눌러 고르기) · LOT 전체 출하 · 봉 하나 출하 · 출하 메모', () => {
  // 함수는 «정의» 로 확인한다 — 이름만 찾으면 단추의 onclick 호출이 남아 정의를 지워도 초록이 된다
  ['showSelectedShipmentPopup', 'executeSelectedShipment', 'toggleShipSelection', 'toggleShipSelectAll', 'updateShipSelectionUI',
    'showLotShipmentPopup', 'executeLotShipment', 'showShipmentPopup', 'executeShipment', 'processShipment', 'refreshAfterShipment'].forEach((g) =>
    assert.ok(new RegExp(`function ${g}\\(`).test(CODE), `옛 출하 창 함수 정의가 사라졌다: ${g}`));
  ['_selectedShipIds', 'ship-note', 'sel-ship-note', 'lot-ship-note', '직접 출하'].forEach((g) => assert.ok(CODE.includes(g) || SRC.includes(g), `옛 출하 창 조각이 사라졌다: ${g}`));
  assert.ok(CODE.includes('🚚 선택 출하 ('), '«🚚 선택 출하 (N개)» 단추가 사라졌다');
  assert.ok(/id="ship-selected-btn-/.test(CODE), '선택 출하 단추가 사라졌다');
});
t('송도 직배 화면이 라우터에 붙었다 — 화면 등록 · 탭 매핑 · 떠나면 카메라 끄기 · 입력 보존 화면', () => {
  assert.ok(/Screens\['songdo-ship'\]\s*=\s*async/.test(CODE), '화면 등록 없음');
  assert.ok(CODE.includes("'songdo-ship': 'inv'"), '탭 매핑 없음');
  const r = CODE.indexOf('render(params = {}) {');
  assert.ok(/if \(s !== 'songdo-ship' && window\._songdoShipScanner\) stopSongdoShipScan\(\);/.test(CODE.slice(r, r + 300)), 'render 첫머리에 카메라 끄기 없음');
  assert.ok(/inputPreservedScreens = \[[^\]]*'songdo-ship'\]/.test(CODE), '입력 보존 화면에 없음');
});
t('들어오는 길 — 더보기 메뉴 맨 앞 «🏪 송도 직배»', () => {
  const m = CODE.indexOf('Screens.more = () => {');
  const items = CODE.slice(m, m + 700);
  assert.ok(/label: '송도 직배'[^}]*target: 'songdo-ship'/.test(items), '더보기 메뉴 없음');
  assert.ok(items.indexOf("target: 'songdo-ship'") < items.indexOf("target: 'haccp'"), '메뉴 맨 앞이 아니다');
});
t('출하기록 쓰기 — 이 화면의 append 는 한 곳(행을 SongdoShip.buildRows 가 만든다) · 정의 12열은 옛 출하 창 폭 검사와 맞춰 둔다', () => {
  const calls = CODE.match(/SheetsAPI\.append\(\s*['"`]출하기록['"`],\s*rows\s*\)/g) || [];
  assert.strictEqual(calls.length, 1, `행 목록(rows)을 넘기는 출하기록 append 가 ${calls.length}곳이다 — 송도 직배 저장 한 곳뿐이어야 한다`);
  const m = CODE.match(/'출하기록': \[([^\]]*)\]/);
  assert.ok(m, 'DB_SHEETS 출하기록 줄 없음');
  assert.strictEqual(m[1].split(',').length, 12, 'DB 조회 정의는 12열이다 — 15열로 늘리려면 옛 출하 창의 12열 literal append 와 tests/db-sheets-width 폭 검사를 같이 손봐야 한다');
});
t('저장 — 직전 재조회(실패 시 중단) · 저장 계획 · 연속 shipId · 온도 · D/E/F · LOT I/J · 작업지시서 · 잠금 해제', () => {
  const a = CODE.indexOf('async function songdoShipSave(ref) {');
  const body = CODE.slice(a, CODE.indexOf('\n}\n', a));
  assert.ok(body.includes("SheetsAPI.getAll('완제품개별', false),") && /SheetsAPI\.getAll\('출하기록', false\),\n/.test(body), '저장 직전 재조회 없음');
  assert.ok(!/getAll\('출하기록', false\)\.catch/.test(body), '저장 직전 출하기록 읽기 실패를 삼킨다');
  assert.ok(body.includes('SongdoShip.planSave(sd.bags, id => st.get(id), same, others)'), '저장 계획 없음');
  assert.ok(body.includes('SongdoShip.resumeRef(plan.limbo, sd.bags.length, ref)'), '끊긴 저장 이어 쓰기 없음');
  assert.ok(body.includes('SongdoShip.nextShipIds(ships.map(r => r[0]), formatDate(), plan.toAppend.length)'), '연속 채번 없음');
  assert.ok(body.includes('SongdoShip.buildRows(plan.toAppend, { ref,'), '행이 저장 계획을 안 따른다');
  assert.ok(body.includes('temp = await getShipFreezerStamp()'), '냉동창고 온도 스탬프 없음');
  assert.ok(body.includes("SheetsAPI.append('출하기록', rows)"), '출하기록 쓰기 없음');
  assert.ok(body.includes('for (const b of plan.toMark)'), '상태 쓰기가 저장 계획을 안 따른다');
  ['D', 'E', 'F'].forEach((c) => assert.ok(body.includes('`완제품개별!' + c + '${idx}`'), `완제품개별 ${c} 쓰기 없음`));
  assert.ok(body.includes('`완제품LOT!I${li}`') && body.includes('`완제품LOT!J${li}`'), 'LOT 잔량·상태 쓰기 없음');
  assert.ok(body.includes("SheetsAPI.updateCell('작업지시서', 0, wo[0], 12, '출하완료')"), '작업지시서 출하완료 전환 없음');
  assert.ok(/finally \{[\s\S]*releaseLock\('songdoShipSave'\)/.test(body), 'finally 에서 잠금 해제 없음');
});
t('찍기 — 다른 화면에선 무시 · 저장 중엔 담지 않는다', () => {
  const a = CODE.indexOf('async function songdoShipAccept(raw, opt = {}) {');
  const body = CODE.slice(a, CODE.indexOf('\n}\n', a));
  assert.ok(body.includes("if (!sd || !sd.ready || State.currentScreen !== 'songdo-ship') return;"), '다른 화면 가드 없음');
  assert.ok(body.includes('if (sd.busy) {'), '저장 중 가드 없음');
});

/* ── ⑥ 안내 흐름 — 다음에 할 일 · 오늘 수 · 소리 · 끝내기 ───────── */
const fnText = (head) => {
  const a = SRC.indexOf(head);
  assert.ok(a !== -1, `index.html 에서 ${head} 를 찾지 못함`);
  assert.strictEqual(SRC.indexOf(head, a + 1), -1, `${head} 가 둘 이상`);
  return SRC.slice(a, SRC.indexOf('\n}\n', a) + 2);
};
t('날짜 읽기 — 시트가 어떤 서식으로 줘도 앞의 날짜만 YYYY-MM-DD', () => {
  ['2026-10-04 09:10', '2026-10-4 9:10:00', '2026. 10. 4 오전 9:10:00', '2026/10/04', ' 2026.10.04 '].forEach((v) => assert.strictEqual(SongdoShip.ymdOf(v), '2026-10-04', v));
  ['', null, undefined, '10/04', '오전 9:10', 'abc', '2026'].forEach((v) => assert.strictEqual(SongdoShip.ymdOf(v), '', String(v)));
});
t('이미 나간 봉 안내 — 송도는 날짜+받는 곳+방식 · 옛 출하 창은 날짜+출하 메모 · 박스 출하 시절 택배는 날짜+송장 · 행이 없으면 빈 글자', () => {
  assert.strictEqual(SongdoShip.shippedInfo(shipRow({ 6: '2026-10-03 09:10', 12: 'D-20261003-송도', 13: '직배', 14: '송도직영점' })), '10/3 송도직영점 직배');
  assert.strictEqual(SongdoShip.shippedInfo(shipRow({ 3: '직접 출하', 6: '2026-10-06 16:39' })), '10/6 직접 출하', '옛 출하 창 행 — 출하 메모(거래처 칸)를 보여 준다');
  assert.strictEqual(SongdoShip.shippedInfo(shipRow({ 6: '2026-10-03 09:10', 12: "'501234567890", 13: '택배' })), '10/3 송장 501234567890');
  assert.strictEqual(SongdoShip.shippedInfo(shipRow({ 6: '2026-10-03 09:10', 13: '택배' })), '10/3 택배');
  assert.strictEqual(SongdoShip.shippedInfo(shipRow({ 6: '2026-10-03 09:10' })), '10/3', '메모도 방식도 없으면 날짜만');
  assert.strictEqual(SongdoShip.shippedInfo(undefined), '');
});
t('오늘 수 — 오늘 저장한 송도 직배 봉만(전표 없는 옛 출하 창 행 · 박스 출하 시절 택배 · 다른 날은 뺀다)', () => {
  const R = (dt, ref, method, id) => shipRow({ 2: id, 6: dt, 12: ref, 13: method });
  const rows = [
    R('2026-10-04 10:00', 'D-20261004-송도', '직배', 'a'), R('2026-10-04 10:00', 'D-20261004-송도', '직배', 'b'),
    R('2026-10-04 10:10', '', '', 'c'),
    R('2026-10-04 09:00', "'111111111111", '택배', 'd'),
    R('2026-10-03 17:00', 'D-20261003-송도', '직배', 'e'),
  ];
  assert.strictEqual(SongdoShip.todayCount(rows, '2026-10-04'), 2);
  assert.strictEqual(SongdoShip.todayCount([], '2026-10-04'), 0);
  assert.strictEqual(SongdoShip.todayCount(null, '2026-10-04'), 0);
  assert.strictEqual(SongdoShip.todayText(2), '오늘 송도 직배 2봉');
  assert.strictEqual(SongdoShip.todayText(0), '오늘 저장한 송도 직배 없음');
});
t('다음에 할 일 — 0봉=봉 라벨 · 1봉↑=저장 단추 · 방금 저장한 뒤엔 «저장했습니다»', () => {
  const s = (n, f) => plain(SongdoShip.stepOf(n, !!f));
  assert.deepStrictEqual([0, 1, 7].map((n) => s(n).step), [1, 2, 2]);
  assert.ok(s(0).text.includes('송도직영점으로') && s(0).text.includes('봉 라벨'));
  assert.ok(s(2).text.startsWith('2봉') && s(2).text.includes('저장'));
  assert.ok(s(0, true).text.includes('저장했습니다'));
  assert.ok(!s(0).text.includes('저장했습니다'), '처음엔 «저장했습니다» 라고 하지 않는다');
  assert.deepStrictEqual(plain(SongdoShip.STEPS), ['봉 라벨 찍기', '저장']);
});
t('소리 계획 — 맞으면 높게 한 번 · 틀리면 낮게 두 번', () => {
  const good = plain(SongdoShip.beepPlan(true)), bad = plain(SongdoShip.beepPlan(false));
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
  const play = (win, ok) => vm.runInContext(fnText('function songdoShipBeep(ok) {') + `; songdoShipBeep(${ok})`, vm.createContext({ window: win, SongdoShip, Math }));
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
t('화면 — 단계 표시 · 지금 할 일 · 오늘 수 · 방금 저장 · 저장 단추(sd-save 로 아래에 붙는다)', () => {
  const render = (sd) => {
    const els = { 'sd-guide': { innerHTML: '' }, 'sd-panel': { innerHTML: '' } };
    const c = vm.createContext({ State: { _songdoShip: sd }, SongdoShip, SONGDO_SHIP_CFG, $id: (id) => els[id], HS_ESC: (x) => String(x), formatDate: () => '2026-10-04', Object, Set, Array, Map, String });
    vm.runInContext(fnText('function renderSongdoShip() {') + '; renderSongdoShip()', c);
    return els['sd-guide'].innerHTML + els['sd-panel'].innerHTML;   // 지금 할 일(#sd-guide·카메라와 함께 붙는다) + 목록(#sd-panel)
  };
  const base = (n) => ({ bags: Array.from({ length: n }, (_, i) => ({ indivId: 'FG-' + i, lotId: 'LOT-A' })), fresh: false, lastSaved: '', shipRows: [], shipsOk: true });
  const h0 = render(base(0));
  assert.ok(h0.includes('● 1. 봉 라벨 찍기') && h0.includes('○ 2. 저장') && h0.includes('송도직영점으로 가는 봉 라벨을 찍으세요') && h0.includes('아직 담은 봉이 없습니다'));
  assert.ok(/<button[^>]*disabled[^>]*songdoShipSaveDirect/.test(h0), '0봉이면 저장 단추가 잠긴다');
  const h2 = render(base(2));
  assert.ok(h2.includes('● 2. 저장') && h2.includes('저장 · 2봉 → 송도직영점') && h2.includes('songdoShipRemove(1)') && h2.includes('LOT LOT-A') && h2.includes('송도직영점 직배 · 2봉'));
  assert.ok(/<button class="[^"]*\bsd-save\b[^"]*"[^>]*onclick="songdoShipSaveDirect\(\)">저장 · 2봉 → 송도직영점/.test(h2), '저장 단추에 sd-save 가 없다 — 봉이 쌓이면 단추가 화면 밖으로 밀려 맨 아래까지 내려가야 눌린다');
  assert.ok(!/<button[^>]*disabled[^>]*songdoShipSaveDirect/.test(h2), '봉이 있으면 저장 단추가 풀린다');
  const b = base(0);
  b.shipRows = [shipRow({ 6: '2026-10-04 09:00', 12: 'D-20261004-송도', 13: '직배' }), shipRow({ 6: '2026-10-03 09:00', 12: 'D-20261003-송도', 13: '직배' })];
  b.lastSaved = '3봉 · D-20261004-송도';
  b.fresh = true;
  const hf = render(b);
  assert.ok(hf.includes('오늘 송도 직배 1봉') && hf.includes('✔ 방금 저장: 3봉 · D-20261004-송도') && hf.includes('다음 봉 라벨'));
  b.shipsOk = false;
  const hn = render(b);
  assert.ok(!hn.includes('오늘 송도 직배') && !hn.includes('오늘 저장한 송도 직배 없음'), '출하기록을 못 읽었으면 오늘 수 줄을 감춘다 — «없다» 고 거짓말하지 않는다');
});
t('저장 뒤 — 다음 묶음 표시를 켜고 · 오늘 수에 바로 더한다 · 불러올 때 출하기록을 보관한다', () => {
  const a = CODE.indexOf('async function songdoShipSave(ref) {');
  const body = CODE.slice(a, CODE.indexOf('\n}\n', a));
  const iClear = body.indexOf('sd.bags = [];'), iFresh = body.indexOf('sd.fresh = true;');
  assert.ok(iClear !== -1 && iFresh > iClear, '비운 뒤에 다음 묶음 표시');
  assert.ok(/SheetsAPI\.append\('출하기록', rows\);\n\s*rows\.forEach\(r => \{ sd\.shipRows\.push\(r\); sd\.shipByIndiv\.set\(/.test(body), '쓴 행을 곧바로 화면 쪽 목록에 더한다');
  assert.ok(CODE.includes('sd.shipRows = ships.slice();') && CODE.includes('sd.shipByIndiv.set(String(r[2]).trim().toUpperCase(), r)'), '불러올 때 출하기록 보관 없음');
  assert.ok(/function songdoShipRemove\(i\) \{[\s\S]*?sd\.fresh = false;/.test(CODE) && /function songdoShipClear\(\) \{[\s\S]*?sd\.fresh = false;/.test(CODE), '빼기·비우기가 다음 묶음 표시를 끈다');
});
t('머리 단추 «끝내기» 가 있다', () => {
  const a = CODE.indexOf("renderHeader('🏪 송도 직배'");
  assert.ok(a !== -1 && CODE.slice(a, a + 500).includes('onclick="songdoShipFinish()"'), '머리에 끝내기 단추 없음');
});
t('확인창 — 단추 이름을 받는다(기본 취소·저장)', () => {
  const f = fnText('function songdoShipConfirm(title, sub, labels) {');
  assert.ok(f.includes("Object.assign({ no: '취소', yes: '저장' }, labels)"), '단추 이름 기본값·덮어쓰기 없음');
  assert.ok(f.includes('data-a="no">${HS_ESC(L.no)}</button>') && f.includes('data-a="yes">${HS_ESC(L.yes)}</button>'), '단추가 받은 이름을 안 쓴다');
});

/* ── ⑦ 알림 상자 — 오류 안내가 안 읽히면 소리만 남는다 ───────── */
const noComment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const cssProps = (body) => new Map(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));

t('알림 상자 — 송도 직배가 내는 알림 종류마다 배경 규칙이 있다(warn 은 규칙이 없어 흰 글씨가 머리글에 묻혔었다)', () => {
  const a = CODE.indexOf("Screens['songdo-ship'] = async");
  const b = CODE.indexOf('\n}\n', CODE.indexOf('async function songdoShipSave('));
  assert.ok(a !== -1 && b > a, '송도 직배 화면 구역을 찾지 못함');
  const kinds = new Set();
  CODE.slice(a, b).split('\n').filter((l) => l.includes('toast(')).forEach((l) => { for (const m of l.matchAll(/[,?:]\s*'([a-z]+)'/g)) kinds.add(m[1]); });   // 종류 자리 = 쉼표·삼항 뒤의 작은따옴표 낱말(=== 'dup' 같은 비교는 걸리지 않는다)
  assert.ok(['warn', 'info', 'err', 'suc'].every((k) => kinds.has(k)), '구역에서 알림 종류를 못 모았다(' + [...kinds] + ') — 이 시험이 아무것도 안 지킨다');
  kinds.forEach((k) => assert.ok(new RegExp('\\.toast\\.' + k + '\\s*\\{[^}]*background\\s*:').test(CODE), '.toast.' + k + ' 에 배경이 없다 — 흰 글씨만 떠서 머리글에 묻힌다'));
});
t('알림 상자 — 글 길이만큼 펴고 화면 안에서만 접는다(left:50% 만 쓰면 폭이 화면 절반으로 줄어 긴 안내가 여러 줄로 접혔다)', () => {
  const p = [...CODE.matchAll(/\.toast\s*\{([^}]*)\}/g)].map((m) => cssProps(m[1])).find((r) => r.get('position') === 'fixed');
  assert.ok(p, '위치를 잡는 .toast 규칙(position:fixed)을 찾지 못함');
  assert.strictEqual(p.get('left'), '50%', '가운데 정렬 기준이 바뀌었다');
  assert.strictEqual(p.get('width'), 'max-content', '글 길이만큼 펴지 않는다 — 폭이 화면 절반으로 줄어 긴 안내가 접힌다');
  assert.strictEqual(p.get('max-width'), 'calc(100vw - 32px)', '화면 밖으로 넘치지 않게 하는 상한이 없다');
});
t('저장 단추 — 봉이 쌓여 화면 밖으로 밀려도 아래에 붙는다(.sd-save: sticky · 아래 여백 · 목록 위로)', () => {
  const m = /\.sd-save\s*\{([^}]*)\}/.exec(CODE);
  assert.ok(m, '.sd-save 규칙을 찾지 못함');
  const p = cssProps(m[1]);
  assert.strictEqual(p.get('position'), 'sticky', '아래에 붙지 않는다');
  assert.strictEqual(p.get('bottom'), '8px', '아래 여백이 없으면 화면 가장자리에 붙어 눌리지 않는다');
  assert.ok(Number(p.get('z-index')) >= 2, '목록 글 위로 올라오지 않으면 가려진다');
});
t('카메라 — 목록을 내려도 맨 위에 붙는다(#sd-sticky) · 창(#sd-cam) 가운데에 읽는 칸 · 낮은 화면·키보드에서는 푼다', () => {
  const a = CODE.indexOf("Screens['songdo-ship'] = async"), tpl = CODE.slice(a, CODE.indexOf('renderSongdoShip();', a));
  const iSticky = tpl.indexOf('id="sd-sticky"'), iCam = tpl.indexOf('id="sd-cam"'), iReader = tpl.indexOf('id="sd-reader"'), iGuide = tpl.indexOf('id="sd-guide"'), iPanel = tpl.indexOf('id="sd-panel"');
  assert.ok(iSticky !== -1 && iSticky < iCam && iCam < iReader && iReader < iGuide && iGuide < iPanel, '틀 순서: 붙는 칸 { 카메라 창 { 읽는 칸 } · 안내 } → 번호 입력 → 목록(카메라가 맨 위)');
  assert.ok(tpl.indexOf('id="sd-manual"') > tpl.indexOf('id="sd-guide"') && tpl.indexOf('id="sd-manual"') < iPanel, '번호 입력칸은 붙는 칸 바로 아래 — 목록을 안 내려도 보인다');
  const cam = /<div id="sd-cam" style="([^"]*)">/.exec(tpl);
  assert.ok(cam, '#sd-cam 을 찾지 못함');
  const cp = cssProps(cam[1]);
  assert.ok(/^clamp\(/.test(cp.get('height')) && cp.get('overflow') === 'hidden' && cp.get('position') === 'relative', '카메라 창은 clamp 높이 · overflow:hidden · position:relative');
  const rd = cssProps(/<div id="sd-reader" style="([^"]*)">/.exec(tpl)[1]);
  assert.ok(rd.get('top') === '50%' && rd.get('transform') === 'translateY(-50%)' && rd.get('position') === 'absolute', '읽는 칸을 창 가운데에 두지 않으면 영상 위쪽만 보여 읽는 칸이 아래로 밀려 잘린다(2026-10-06 «라벨이 안 읽힌다»)');
  assert.ok(!/height:min\(42vh/.test(tpl), '예전 고정 높이 창으로 되돌아갔다');
  const sticky = cssProps(/#sd-sticky\s*\{([^}]*)\}/.exec(CODE)[1]);
  assert.strictEqual(sticky.get('position'), 'sticky');
  assert.strictEqual(sticky.get('top'), '0', '맨 위에 붙지 않는다');
  assert.ok(/^var\(--(white|bg)\)$/.test(sticky.get('background')), '바탕이 비면 아래로 지나가는 목록이 카메라 뒤로 비친다');
  assert.ok(Number(sticky.get('z-index')) > Number(cssProps(/\.sd-save\s*\{([^}]*)\}/.exec(CODE)[1]).get('z-index')), '저장 단추(.sd-save)보다 위에 있어야 카메라가 가려지지 않는다');
  // 낮은 화면(키보드가 올라와 줄어든 화면 포함)에서는 붙은 카메라를 푼다 — 안 풀면 붙은 칸이 보이는 영역을 다 먹어 번호 입력칸이 안 보인다.
  const low = /@media \(max-height:(\d+)px\)\s*\{\s*#sd-sticky\s*\{([^}]*)\}/.exec(CODE);
  assert.ok(low && cssProps(low[2]).get('position') === 'static', '낮은 화면에서 붙은 카메라를 풀지 않는다');
  assert.ok(Number(low[1]) >= 520 && Number(low[1]) < 640, `낮은 화면 기준 ${low[1]}px — 키보드가 올라온 화면(≈350)은 걸리고 보통 화면(≥640)은 안 걸려야 한다`);
});
t('안내 글·확인창 — 낱말 중간에서 줄이 꺾이지 않는다(word-break:keep-all)', () => {
  const g = noComment(fnText('function renderSongdoShip() {'));
  assert.ok(/<div class="fs-15 fw-7" style="[^"]*word-break:keep-all[^"]*">\$\{HS_ESC\(guide\.text\)\}<\/div>/.test(g), '안내 글에 keep-all 이 없다 — «있/으면» 처럼 낱말 중간에서 꺾인다');
  const c = noComment(fnText('function songdoShipConfirm(title, sub, labels) {'));
  assert.ok(/<div class="dialog" style="[^"]*word-break:keep-all[^"]*">/.test(c), '확인창에 keep-all 이 없다 — «저/장할까요» 처럼 낱말 중간에서 꺾인다');
});
t('카메라는 봉 라벨(QR)만 읽는다 — 1차원 바코드(택배 송장 스티커)는 형식에서 뺀다', () => {
  const f = noComment(fnText('async function startSongdoShipScan() {'));
  assert.ok(f.includes('formatsToSupport: [F.QR_CODE]'), 'QR 만 읽도록 형식을 좁히지 않았다');
  assert.ok(!/CODE_128|CODE_39|ITF|CODABAR|EAN_13/.test(f), '1차원 바코드 형식이 남았다 — 스티커가 화면에 걸리면 오류음이 울린다');
});

let asyncDone = false;
process.on('exit', () => { if (!asyncDone) { console.error('✗ 비동기 시험이 끝까지 못 갔다(끝나지 않는 await)'); process.exitCode = 1; } });

(async () => {
  const at = async (n, f) => { await f(); ok.push(n); };
  const UP = '출하가능', DONE = '출하완료';

  /* 찍기 — 담기 · 같은 봉 재스캔 · 이미 나간 봉 안내 · 엉뚱한 코드 */
  await at('찍기 흐름 — 봉 담기 · 같은 봉 재스캔은 조용히 · 이미 나간 봉은 언제 어디로 · 엉뚱한 코드는 한 번만 경고', async () => {
    let clock = 1000;
    const log = { toasts: [], buzz: [] };
    const state = { currentScreen: 'songdo-ship', _songdoShip: null };
    const sd = state._songdoShip = { bags: [], indiv: new Map(), ready: true, busy: false, last: { code: '', at: 0 }, lastSaved: '', shipRows: [], shipByIndiv: new Map(), fresh: true };
    ['FG-1', 'FG-2', 'FG-3', 'FG-4', 'FG-5'].forEach((id) => sd.indiv.set(id, { indivId: id, lotId: 'LOT-A', status: UP, itemName: '호두과자' }));
    sd.indiv.set('FG-9', { indivId: 'FG-9', lotId: 'LOT-A', status: DONE, itemName: '호두과자' });
    sd.shipByIndiv.set('FG-9', shipRow({ 2: 'FG-9', 3: '직접 출하', 6: '2026-10-03 09:10' }));
    sd.indiv.set('FG-8', { indivId: 'FG-8', lotId: 'LOT-A', status: '냉동보관중', itemName: '호두과자' });
    const c = vm.createContext({
      State: state, SongdoShip, SONGDO_SHIP_CFG, Date: { now: () => clock }, String, Object,
      toast: (m, kind) => log.toasts.push([m, kind]),
      songdoShipBuzz: (good) => log.buzz.push(good),
      renderSongdoShip: () => {},
    });
    const accept = vm.runInContext(fnText('async function songdoShipAccept(raw, opt = {}) {') + '; songdoShipAccept', c);
    const next = async (raw, opt) => { clock += 3000; await accept(raw, opt); };

    for (const id of ['FG-1', 'FG-2', 'FG-3']) await next(id);
    assert.deepStrictEqual([sd.bags.length, sd.fresh, plain(log.buzz)], [3, false, [true, true, true]], '봉 3개 — 다음 묶음 표시가 꺼지고 «삑» 세 번');
    await next('fg-1');
    assert.strictEqual(log.toasts.length, 0, '카메라가 같은 봉을 또 읽은 것은 조용히 넘어간다');
    assert.strictEqual(log.buzz.length, 3, '같은 봉 재스캔은 소리도 없다');
    await next('fg-1', { manual: true });
    assert.deepStrictEqual(plain(log.toasts), [['이미 이 목록에 담은 봉입니다', 'info']], '손으로 넣은 같은 봉은 알려 준다');
    log.toasts.length = 0; log.buzz.length = 0;
    await next('FG-9');
    assert.deepStrictEqual(plain(log.toasts), [['이미 출하된 봉입니다 (10/3 직접 출하) — 넣지 않았습니다', 'warn']], '옛 출하 창으로 나간 봉 — 날짜와 출하 메모');
    assert.deepStrictEqual(plain(log.buzz), [false]);
    assert.strictEqual(sd.bags.length, 3, '나간 봉은 담기지 않는다');
    log.toasts.length = 0; log.buzz.length = 0;
    await next('FG-8');
    assert.ok(log.toasts[0][0].includes('냉동보관중'), '냉동 12시간 전 봉은 아직 출하할 수 없다');
    log.toasts.length = 0; log.buzz.length = 0;
    await next('501234567890');
    assert.deepStrictEqual(plain(log.toasts), [['봉 라벨(FG-…)이 아닙니다: 501234567890', 'warn']], '송장 번호는 이 화면이 받지 않는다');
    assert.deepStrictEqual(plain(log.buzz), [false]);
    clock += 3000;                                     // 디바운스(2.5초)는 지났지만 거절한 코드는 8초 동안 더 조용히
    await accept('501234567890');
    assert.strictEqual(log.toasts.length, 1, '엉뚱한 코드가 계속 화면에 있어도 경고가 되풀이되지 않는다');
    clock += 9000;
    await accept('501234567890');
    assert.strictEqual(log.toasts.length, 2, '조용히 하는 시간이 지나면 다시 알려 준다');
    sd.busy = true;
    log.toasts.length = 0;
    await next('FG-4');
    assert.ok(log.toasts[0][0].includes('저장 중입니다') && sd.bags.length === 3, '저장 중에는 담지 않는다');
  });

  /* 끝내기 */
  const finish = async (sd, o = {}) => {
    const calls = [];
    calls.busy = {};   // 확인창·카메라 끄기가 도는 동안 잠금이 켜져 있었나
    const state = { _songdoShip: sd, currentScreen: 'songdo-ship' };
    const c = vm.createContext({
      State: state, SongdoShip, formatDate: () => '2026-10-04', Object,
      songdoShipConfirm: async (title, sub, labels) => { calls.push(['confirm', title, sub, plain(labels)]); calls.busy.confirm = sd.busy; if (o.leave) state.currentScreen = 'inventory'; return o.yes !== false; },
      stopSongdoShipScan: async () => { calls.push(['stop']); calls.busy.stop = sd.busy; if (o.leaveOnStop) state.currentScreen = 'inventory'; if (o.replaceOnStop) state._songdoShip = { bags: [] }; },
      toast: (m) => calls.push(['toast', m]),
      Router: { go: (s) => calls.push(['go', s]) },
    });
    await vm.runInContext(fnText('async function songdoShipFinish() {') + '; songdoShipFinish', c)();
    return calls;
  };
  const rows1 = [shipRow({ 6: '2026-10-04 09:00', 12: 'D-20261004-송도', 13: '직배' })];
  await at('끝내기 — 봉이 없으면 바로: 카메라 끄기 → 오늘 합계 → 재고로', async () => {
    const calls = await finish({ bags: [], busy: false, shipRows: rows1, shipsOk: true });
    assert.deepStrictEqual(plain(calls), [['stop'], ['toast', '🏪 송도 직배를 끝냅니다 — 오늘 송도 직배 1봉'], ['go', 'inventory']]);
    assert.strictEqual(calls.busy.stop, true, '카메라를 끄는 동안 잠금 — 그 사이 읽힌 봉으로 저장이 새로 시작되면 안 된다');
  });
  await at('끝내기 — 카메라를 끄는 사이 화면을 떠났으면 이동·안내를 하지 않는다(새 화면을 덮지 않는다)', async () => {
    const sd = { bags: [], busy: false, shipRows: rows1, shipsOk: true };
    const calls = await finish(sd, { leaveOnStop: true });
    assert.deepStrictEqual(plain(calls), [['stop']]);
    assert.strictEqual(sd.busy, false, '잠금을 남기지 않는다');
  });
  await at('끝내기 — 카메라를 끄는 사이 나갔다 돌아와 새 화면이 열렸어도 이동·안내를 하지 않는다', async () => {
    const sd = { bags: [], busy: false, shipRows: rows1, shipsOk: true };
    const calls = await finish(sd, { replaceOnStop: true });
    assert.deepStrictEqual(plain(calls), [['stop']]);
    assert.strictEqual(sd.busy, false);
  });
  await at('끝내기 — 출하기록을 못 읽었으면 합계를 말하지 않는다(«0봉» 이라고 거짓말하지 않는다)', async () => {
    const calls = await finish({ bags: [], busy: false, shipRows: [], shipsOk: false });
    assert.deepStrictEqual(plain(calls), [['stop'], ['toast', '🏪 송도 직배를 끝냅니다'], ['go', 'inventory']]);
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

  /* 저장 — 진짜 songdoShipSave 를 가짜 시트로 돌린다(문자열 포함 검사가 아니라 동작으로) */
  const tick = () => new Promise((r) => setImmediate(r));
  const lineOf = (head) => { const a = SRC.indexOf(head); assert.ok(a !== -1, `${head} 없음`); return SRC.slice(a, SRC.indexOf('\n', a)); };
  const saveWorld = () => {
    const tabs = {
      '완제품개별': ['FG-1', 'FG-2', 'FG-3', 'FG-4'].map((id) => [id, 'LOT-A', 'FG001', '출하가능', '', '', '']),
      '출하기록': [],
      '완제품LOT': [['LOT-A', '2026-10-04', '호두과자', '', '', '', '', '', '4', '출하가능']],
      '작업지시서': [],
    };
    const fail = { batch: false, ships: false };
    const toasts = [], buzz = [], wo = [];
    const state = { currentScreen: 'songdo-ship', user: { email: 'w@x' }, _songdoShip: null };
    const sd = state._songdoShip = { bags: [], indiv: new Map(), ready: true, busy: false, last: { code: '', at: 0 }, lastSaved: '', shipRows: [], shipByIndiv: new Map(), fresh: false, shipsOk: true };
    tabs['완제품개별'].forEach((r) => sd.indiv.set(r[0], { indivId: r[0], lotId: r[1], status: r[3], itemName: '호두과자' }));
    const sheets = {
      invalidateCache() {},
      getAll: async (tab) => { if (tab === '출하기록' && fail.ships) throw new Error('읽기 실패'); return tabs[tab].map((r) => r.slice()); },
      append: async (tab, rows) => { tabs[tab].push(...rows.map((r) => r.slice())); },
      findRowIndex: async (tab, col, id) => { const i = tabs[tab].findIndex((r) => r[col] === id); return i === -1 ? -1 : i + 2; },
      batchUpdate: async (upd) => {
        if (fail.batch) throw new Error('끊김');
        upd.forEach((u) => { const m = u.range.match(/^(.+)!([A-Z])(\d+)$/); tabs[m[1]][Number(m[3]) - 2][m[2].charCodeAt(0) - 65] = u.values[0][0]; });
      },
      updateCell: async (...a) => { wo.push(a); },
    };
    const c = vm.createContext({
      State: state, SheetsAPI: sheets, SongdoShip, SONGDO_SHIP_CFG, console: { error() {}, warn() {} },
      acquireLock: () => true, releaseLock() {}, showLoading() {}, hideLoading() {},
      formatDate: () => '2026-10-04', formatDateTime: () => '2026-10-04 10:00',
      getShipFreezerStamp: async () => null, warnShipStamp() {}, songdoShipEnsureHeader: async () => {},
      toast: (m, k) => toasts.push([m, k]), songdoShipBuzz: (good) => buzz.push(good), renderSongdoShip() {},
    });
    vm.runInContext([lineOf('function songdoShipRef(r) {'), fnText('async function songdoShipSave(ref) {')].join('\n'), c);
    return {
      tabs, fail, toasts, buzz, sd, wo,
      save: (ref) => vm.runInContext(`songdoShipSave(${JSON.stringify(ref)})`, c),
      put: (...ids) => ids.forEach((id) => sd.bags.push({ indivId: id, lotId: 'LOT-A', itemName: '호두과자' })),
      status: () => tabs['완제품개별'].map((r) => r[3]),
      last: () => toasts[toasts.length - 1],
    };
  };
  const T0 = 'D-20261004-송도';
  const oldRow = (n, id, ref, method = '직배') => shipRow({ 0: `SHP-20261003-00${n}`, 2: id, 12: ref, 13: method });

  await at('저장(진짜 코드·가짜 시트) — 3봉: 행 3(15열·전표·직배·송도직영점) · 봉 출하완료 · LOT 잔량 1 · 목록 비우고 다음 묶음 표시 · «삑» 한 번', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2', 'FG-3');
    await w.save(T0);
    assert.strictEqual(w.tabs['출하기록'].length, 3);
    w.tabs['출하기록'].forEach((r) => { assert.strictEqual(r.length, 15); assert.deepStrictEqual([r[3], r[12], r[13], r[14]], ['송도직영점', T0, '직배', '송도직영점']); });
    assert.strictEqual(new Set(w.tabs['출하기록'].map((r) => r[0])).size, 3, '봉마다 shipId 가 다르다');
    assert.deepStrictEqual(w.status(), [DONE, DONE, DONE, UP]);
    assert.deepStrictEqual(w.tabs['완제품개별'].slice(0, 3).map((r) => [r[4], r[5]]), [['2026-10-04 10:00', 'w@x'], ['2026-10-04 10:00', 'w@x'], ['2026-10-04 10:00', 'w@x']], '출하시각·출하자 (E·F)');
    assert.strictEqual(w.tabs['완제품LOT'][0][8], '1', 'LOT 잔량');
    assert.strictEqual(w.tabs['완제품LOT'][0][9], '출하가능', '남았으면 LOT 상태는 그대로');
    assert.deepStrictEqual([w.sd.bags.length, w.sd.fresh, w.sd.busy, w.sd.shipRows.length], [0, true, false, 3]);
    assert.deepStrictEqual(plain(w.buzz), [true], '성공은 높은 «삑» 정확히 한 번(«저장» 단추를 누른 결과를 소리로도 알린다)');
    assert.strictEqual(w.last()[1], 'suc');
    assert.ok(w.sd.lastSaved.includes(T0) && !w.sd.lastSaved.includes('끊긴'), w.sd.lastSaved);
  });
  await at('저장 — LOT 이 다 나가면 LOT «출하완료» + 작업지시서 «출하완료»', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2', 'FG-3', 'FG-4');
    w.tabs['작업지시서'].push(Object.assign(Array(15).fill(''), { 0: 'WO-1', 12: '출하가능', 14: 'LOT-A' }));
    await w.save(T0);
    assert.strictEqual(w.tabs['완제품LOT'][0][8], '0');
    assert.strictEqual(w.tabs['완제품LOT'][0][9], '출하완료');
    assert.deepStrictEqual(plain(w.wo), [['작업지시서', 0, 'WO-1', 12, '출하완료']]);
  });
  await at('저장 — 상태 쓰기가 끊겨도 같은 전표로 다시 저장하면 행을 두 번 쓰지 않고 이어 쓴다', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2', 'FG-3');
    w.fail.batch = true;
    await w.save(T0);
    assert.strictEqual(w.tabs['출하기록'].length, 3, '행은 먼저 적혔다');
    assert.deepStrictEqual(w.status(), [UP, UP, UP, UP], '상태는 아직');
    assert.strictEqual(w.last()[1], 'err');
    assert.deepStrictEqual(plain(w.buzz), [false], '끊기면 낮은 소리');
    assert.deepStrictEqual([w.sd.bags.length, w.sd.busy], [3, false], '목록은 그대로 · 잠금은 풀린다');
    w.fail.batch = false; w.buzz.length = 0;
    await w.save(T0);
    assert.strictEqual(w.tabs['출하기록'].length, 3, '중복 행 없음');
    assert.deepStrictEqual(w.status(), [DONE, DONE, DONE, UP]);
    assert.ok(w.sd.lastSaved.includes('끊긴 저장 이어 쓰기'));
    assert.deepStrictEqual(plain(w.buzz), [true]);
  });
  await at('저장 — 어제 끊긴 전표의 봉만 담았으면 그 전표로 이어 써서 끝낸다(오늘 전표로 또 적지 않는다)', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2');
    w.tabs['출하기록'].push(oldRow(1, 'FG-1', 'D-20261003-송도'), oldRow(2, 'FG-2', 'D-20261003-송도'));
    await w.save(T0);
    assert.strictEqual(w.tabs['출하기록'].length, 2, '행을 더하지 않는다');
    assert.deepStrictEqual(w.status(), [DONE, DONE, UP, UP], '끊긴 상태 쓰기가 끝난다');
    assert.deepStrictEqual([w.sd.bags.length, w.sd.fresh, w.sd.busy], [0, true, false]);
    assert.ok(w.sd.lastSaved.includes('D-20261003-송도') && w.sd.lastSaved.includes('끊긴 저장 이어 쓰기'), w.sd.lastSaved);
    assert.ok(!w.sd.lastSaved.includes('D-20261004'), '오늘 전표로 적히지 않는다');
    assert.strictEqual(w.last()[1], 'suc');
    assert.strictEqual(w.tabs['완제품LOT'][0][8], '2', 'LOT 잔량도 맞춘다');
  });
  await at('저장 — 끊긴 봉이 새 봉과 섞였으면 이어 쓰지 않고 끊긴 봉만 뺀다 → 그 봉만 따로 담으면 끝낼 수 있다(막다른 길 없음)', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2');
    w.tabs['출하기록'].push(oldRow(1, 'FG-1', 'D-20261003-송도'));
    await w.save(T0);
    assert.strictEqual(w.tabs['출하기록'].length, 1, '같은 봉을 오늘 전표로 또 적지 않는다');
    assert.deepStrictEqual(w.status(), [UP, UP, UP, UP]);
    assert.deepStrictEqual(plain(w.sd.bags.map((b) => b.indivId)), ['FG-2'], '끊긴 봉만 목록에서 빠진다');
    assert.ok(w.last()[1] === 'err' && w.last()[0].includes('D-20261003-송도') && w.last()[0].includes('그 봉만 따로 담아'), w.last()[0]);
    w.sd.bags = []; w.put('FG-1');                    // 작업자가 끊긴 그 봉만 다시 담는다
    await w.save(T0);
    assert.deepStrictEqual(w.status(), [DONE, UP, UP, UP], '끝낼 수 있다');
    assert.strictEqual(w.tabs['출하기록'].length, 1);
    assert.ok(w.sd.lastSaved.includes('D-20261003-송도'));
  });
  await at('저장 — 박스 출하 시절 콜로 전표·택배 송장 · 8일 전 전표 · 전표 둘로 끊긴 봉은 이어 쓰지 않고 막는다', async () => {
    const cases = [
      [['FG-1'], [oldRow(1, 'FG-1', 'D-20261003-콜로')]],
      [['FG-1'], [oldRow(1, 'FG-1', "'501234567890", '택배')]],
      [['FG-1'], [oldRow(1, 'FG-1', 'D-20260926-송도')]],
      [['FG-1', 'FG-2'], [oldRow(1, 'FG-1', 'D-20261003-송도'), oldRow(2, 'FG-2', 'D-20261002-송도')]],
    ];
    for (const [ids, rows] of cases) {
      const w = saveWorld(); w.put(...ids);
      w.tabs['출하기록'].push(...rows);
      await w.save(T0);
      assert.strictEqual(w.tabs['출하기록'].length, rows.length, '행을 더하지 않는다');
      assert.deepStrictEqual(w.status(), [UP, UP, UP, UP], '상태도 바꾸지 않는다');
      assert.strictEqual(w.sd.bags.length, 0, '끊긴 봉은 목록에서 뺀다');
      assert.strictEqual(w.last()[1], 'err');
      assert.deepStrictEqual(plain(w.buzz), [false], '낮은 소리 한 번');
    }
  });
  await at('저장 — 옛 출하 창이 행만 적고 끊긴 봉(전표 없음)도 또 적지 않는다 · 안내는 «옛 출하 기록»', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2');
    w.tabs['출하기록'].push(shipRow({ 0: 'SHP-20261006-001', 2: 'FG-1', 3: '직접 출하', 6: '2026-10-06 16:39' }));
    await w.save(T0);
    assert.strictEqual(w.tabs['출하기록'].length, 1, '같은 봉이 출하기록에 두 번 적히지 않는다');
    assert.deepStrictEqual(w.status(), [UP, UP, UP, UP]);
    assert.ok(w.last()[0].includes('옛 출하 기록') && w.last()[1] === 'err', w.last()[0]);
    assert.deepStrictEqual(plain(w.sd.bags.map((b) => b.indivId)), ['FG-2']);
  });
  await at('저장 — 그 사이 다른 곳(옛 선택 출하 포함)에서 처리된 봉은 목록에서 빼고 아무것도 쓰지 않는다', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2', 'FG-3');
    w.tabs['완제품개별'][0][3] = DONE;                // 시트에선 이미 출하완료(출하기록 행은 없다 — 옛 창이 중간에 끊긴 모양)
    await w.save(T0);
    assert.strictEqual(w.tabs['출하기록'].length, 0, '아무것도 쓰지 않는다');
    assert.deepStrictEqual(plain(w.sd.bags.map((b) => b.indivId)), ['FG-2', 'FG-3']);
    assert.strictEqual(w.sd.indiv.get('FG-1').status, DONE, '화면 쪽 상태도 맞춘다');
    assert.ok(w.last()[0].includes('1봉은 그 사이 다른 곳에서 처리돼') && w.last()[1] === 'err');
    assert.deepStrictEqual(plain(w.buzz), [false]);
  });
  await at('저장 — 출하기록을 못 읽으면 아무것도 쓰지 않고 멈춘다(빈 목록으로 넘기면 shipId 가 겹치고 끊긴 저장을 못 알아본다)', async () => {
    const w = saveWorld(); w.put('FG-1', 'FG-2');
    w.fail.ships = true;
    await w.save(T0);
    assert.strictEqual(w.tabs['출하기록'].length, 0);
    assert.deepStrictEqual(w.status(), [UP, UP, UP, UP]);
    assert.ok(w.last()[0].includes('송도 직배 실패') && w.last()[1] === 'err', w.last()[0]);
    assert.deepStrictEqual(plain(w.buzz), [false]);
    assert.deepStrictEqual([w.sd.bags.length, w.sd.busy], [2, false], '목록은 그대로 · 잠금은 풀린다');
  });
  await at('저장 — 빈 목록이면 아무 일도 없다', async () => {
    const w = saveWorld();
    await w.save(T0);
    assert.deepStrictEqual([w.tabs['출하기록'].length, w.toasts.length, w.buzz.length], [0, 0, 0]);
  });
  await at('저장 소리 — 성공은 높은 «삑» 한 번 · 안 되면(그 사이 처리됨 · 끊긴 봉이 섞임 · 끊김 · 출하기록 못 읽음) «삑삑» 한 번씩', async () => {
    const cases = [   // [이름, 알림 종류, 시트 준비, 저장 뒤 출하기록 행 수]
      ['그 사이 다른 곳에서 처리됨', 'err', (w) => { w.tabs['완제품개별'][0][3] = DONE; }, 0],
      ['끊긴 봉이 새 봉과 섞임', 'err', (w) => { w.tabs['출하기록'].push(oldRow(1, 'FG-1', 'D-20261003-송도')); }, 1],
      ['저장 중 끊김', 'err', (w) => { w.fail.batch = true; }, 2],
      ['출하기록 못 읽음', 'err', (w) => { w.fail.ships = true; }, 0],
    ];
    for (const [name, kind, setup, rows] of cases) {
      const w = saveWorld(); w.put('FG-1', 'FG-2');
      setup(w);
      await w.save(T0);
      assert.deepStrictEqual(plain(w.buzz), [false], `${name} — 낮은 소리가 정확히 한 번 울려야 한다`);
      assert.strictEqual(w.last()[1], kind, `${name} — 알림 종류`);
      assert.strictEqual(w.tabs['출하기록'].length, rows, `${name} — 출하기록 행 수(성공 경로가 아니다)`);
    }
    const done = saveWorld(); done.put('FG-1', 'FG-2');
    await done.save(T0);
    assert.deepStrictEqual(plain(done.buzz), [true], '성공은 높은 «삑» 정확히 한 번');
    assert.strictEqual(done.last()[1], 'suc');
  });
  await at('저장 — 눌러서 시작: «저장» 단추(songdoShipSaveDirect)는 오늘 전표로 저장하고 빈 목록이면 아무것도 안 한다', async () => {
    const calls = [];
    const state = { _songdoShip: { bags: [] } };
    const c = vm.createContext({ State: state, SongdoShip, formatDate: () => '2026-10-04', songdoShipSave: (ref) => calls.push(ref) });
    const run = vm.runInContext(fnText('function songdoShipSaveDirect() {') + '; songdoShipSaveDirect', c);
    run();
    assert.deepStrictEqual(calls, [], '빈 목록');
    state._songdoShip.bags.push({ indivId: 'FG-1' });
    run();
    assert.deepStrictEqual(calls, [T0]);
    state._songdoShip = null;
    run();
    assert.deepStrictEqual(calls, [T0], '화면 상태가 없으면 무시');
  });

  /* 카메라 — 켜는 사이 화면을 떠나면 켜진 카메라를 직접 끈다(라우터는 전역만 비우고, 아직 안 켜진 것을 끄다 만다) */
  const scanWorld = (state) => {
    const log = [];
    const holder = {};
    holder.rel = []; holder.rej = []; holder.stopped = [];
    holder.release = () => holder.rel.splice(0).forEach((f) => f());   // 켜는 중인 스캐너를 모두 켜진 것으로
    class FakeScanner {
      constructor(id, cfg) { if (holder.ctorFail) throw new Error('생성 실패'); (holder.ctorArgs = holder.ctorArgs || []).push([id, cfg]); this.on = false; this.id = holder.n = (holder.n || 0) + 1; }
      start(cam, cfg) { (holder.startArgs = holder.startArgs || []).push([cam, cfg]); return new Promise((r, j) => { holder.rel.push(() => { this.on = true; r(); }); holder.rej.push(j); }); }
      stop() { if (!this.on) return Promise.reject(new Error('not running')); log.push('stop'); holder.stopped.push(this.id); this.on = false; return Promise.resolve(); }
      clear() { log.push('clear'); }
    }
    const win = { Html5QrcodeSupportedFormats: { QR_CODE: 0, CODE_128: 3, EAN_13: 9 } };
    const el = { clientWidth: 300, clientHeight: 200, innerHTML: '' };
    const els = { cam: null };   // 카메라 창(#sd-cam) — 없으면 읽는 칸 높이로 본다
    const c = vm.createContext({ window: win, State: state, Html5Qrcode: FakeScanner, $id: (id) => (id === 'sd-cam' ? els.cam : el), HS_ESC: String, songdoShipAccept() {}, Math });
    vm.runInContext(fnText('async function stopSongdoShipScan() {') + '\n' + fnText('async function startSongdoShipScan() {'), c);
    return { log, win, holder, el, els, run: (js) => vm.runInContext(js, c) };
  };
  await at('카메라 — 켜는 사이 화면을 떠나면 켜진 카메라를 끈다(라우터가 전역을 먼저 비워도)', async () => {
    const state = { currentScreen: 'songdo-ship' };
    const s = scanWorld(state);
    const p = s.run('startSongdoShipScan()');
    await tick();
    state.currentScreen = 'inventory';
    await s.run('stopSongdoShipScan()');               // 라우터가 하는 일 — 아직 안 켜져서 stop 이 던진다
    s.holder.release();
    await p;
    assert.ok(s.log.includes('stop'), '켜진 카메라가 꺼지지 않았다');
    assert.strictEqual(s.win._songdoShipScanner, null);
  });
  await at('카메라 — QR 만 읽도록 열고 · 읽는 칸은 카메라 창 안에 들어간다(위아래 24px 여유) · 높이 상한 150 · 창 높이가 모자라도 80 이상', async () => {
    const boxOf = async (cam) => {
      const s = scanWorld({ currentScreen: 'songdo-ship' });
      s.els.cam = cam;
      const p = s.run('startSongdoShipScan()');
      await tick();
      s.holder.release();
      await p;
      return { qrbox: s.holder.startArgs[0][1].qrbox, ctor: s.holder.ctorArgs[0] };
    };
    const a = await boxOf({ clientWidth: 328, clientHeight: 194 });
    assert.deepStrictEqual(plain(a.ctor), ['sd-reader', { formatsToSupport: [0] }], 'QR_CODE 하나만 연다');
    assert.deepStrictEqual([a.qrbox.width, a.qrbox.height], [255, 146], '창 194 → 높이 146, 가로는 읽는 칸(300) 폭의 85%');
    assert.ok(a.qrbox.height + 48 <= 194, '읽는 칸이 창 밖으로 나간다 — 보이지 않는 곳을 읽는다');
    assert.strictEqual((await boxOf({ clientWidth: 328, clientHeight: 236 })).qrbox.height, 150, '높이 상한');
    assert.strictEqual((await boxOf({ clientWidth: 328, clientHeight: 100 })).qrbox.height, 80, '아주 낮은 창에서도 80');
    assert.strictEqual((await boxOf(null)).qrbox.height, 150, '창이 없으면 읽는 칸 높이(200)에서 구한다');
  });
  await at('카메라 — 형식 목록을 못 얻으면(라이브러리 변경) 기본 설정으로 연다', async () => {
    const s = scanWorld({ currentScreen: 'songdo-ship' });
    s.win.Html5QrcodeSupportedFormats = undefined;
    const p = s.run('startSongdoShipScan()');
    await tick();
    s.holder.release();
    await p;
    assert.strictEqual(s.holder.ctorArgs[0][1], undefined);
  });
  await at('카메라 — 화면에 머물면 끄지 않는다', async () => {
    const s = scanWorld({ currentScreen: 'songdo-ship' });
    const p = s.run('startSongdoShipScan()');
    await tick();
    s.holder.release();
    await p;
    assert.deepStrictEqual(s.log, [], '머무는데 끄면 안 된다');
    assert.ok(s.win._songdoShipScanner, '전역 스캐너는 남는다');
  });
  await at('소리 — 닫힌 오디오는 새로 열고 · 깨우기가 거절돼도 처리 안 된 오류가 새지 않는다', async () => {
    let made = 0, rejected = 0;
    const AC = function AC() { made++; this.state = 'running'; this.currentTime = 0; this.destination = {}; this.createGain = () => ({ gain: {}, connect() {} }); this.createOscillator = () => ({ frequency: {}, connect() {}, start() {}, stop() {} }); this.resume = () => Promise.reject(new Error('막힘')); };
    const win = { AudioContext: AC };
    const run = () => vm.runInContext(fnText('function songdoShipBeep(ok) {') + '; songdoShipBeep(true)', vm.createContext({ window: win, SongdoShip, Math }));
    const onRej = () => { rejected++; };
    process.on('unhandledRejection', onRej);
    run();
    win._songdoShipAudio.state = 'closed';
    run();
    assert.strictEqual(made, 2, '닫힌 오디오는 새로 만든다');
    win._songdoShipAudio.state = 'suspended';
    run();
    await tick(); await tick();
    process.off('unhandledRejection', onRej);
    assert.strictEqual(rejected, 0, '깨우기 거절이 처리되지 않은 오류로 샌다');
  });
  await at('카메라 — 켜는 사이 화면만 떠나고 전역은 그대로면 직접 끄고 전역도 비운다', async () => {
    const state = { currentScreen: 'songdo-ship' };
    const s = scanWorld(state);
    const p = s.run('startSongdoShipScan()');
    await tick();
    state.currentScreen = 'inventory';                // 라우터가 stopSongdoShipScan 을 아직 안 불렀다
    s.holder.release();
    await p;
    assert.deepStrictEqual(s.holder.stopped, [1], '켜진 카메라를 끈다');
    assert.strictEqual(s.win._songdoShipScanner, null, '끈 스캐너를 전역에 남기지 않는다');
    assert.ok(s.log.includes('clear'), '화면을 떠났으니 비춘 화면도 치운다');
  });
  await at('카메라 — 켜는 사이 같은 화면에서 다시 시작되면 먼저 켠 것만 끈다', async () => {
    const s = scanWorld({ currentScreen: 'songdo-ship' });
    const a = s.run('startSongdoShipScan()');
    await tick();
    const b = s.run('startSongdoShipScan()');         // B 가 A 를 끄려 하지만 A 는 아직 안 켜져 stop 이 던진다
    await tick();
    s.holder.release();
    await Promise.all([a, b]);
    assert.deepStrictEqual(s.holder.stopped, [1], '먼저 켠 A 만 끈다(둘 다 켜져 남으면 카메라가 겹친다)');
    assert.ok(s.win._songdoShipScanner, '나중 것 B 는 남는다');
    assert.strictEqual(s.log.filter((x) => x === 'clear').length, 1, 'B 가 시작할 때 한 번뿐 — 밀려난 A 가 같은 화면을 또 지우면 B 의 영상이 사라진다');
  });
  await at('카메라 — 더 새로 켠 스캐너가 있으면 먼저 켜던 것이 뒤늦게 실패해도 그 화면에 오류 문구를 덮지 않는다', async () => {
    const s = scanWorld({ currentScreen: 'songdo-ship' });
    const a = s.run('startSongdoShipScan()');
    await tick();
    const b = s.run('startSongdoShipScan()');
    await tick();
    s.holder.rej[0](new Error('끊김'));               // A 가 뒤늦게 실패
    s.holder.rel[1]();                                 // B 는 켜진다
    await Promise.all([a, b]);
    assert.strictEqual(s.el.innerHTML, '', 'B 가 쓰는 화면에 A 의 오류가 덮였다');
    assert.ok(s.win._songdoShipScanner, 'B 의 스캐너는 남는다');
  });
  await at('카메라 — 내 시작이 실패하면 오류 문구를 보이고 전역을 비운다', async () => {
    const s = scanWorld({ currentScreen: 'songdo-ship' });
    const a = s.run('startSongdoShipScan()');
    await tick();
    s.holder.rej[0](new Error('권한 없음'));
    await a;
    assert.ok(s.el.innerHTML.includes('카메라를 쓸 수 없습니다') && s.el.innerHTML.includes('권한 없음'));
    assert.strictEqual(s.win._songdoShipScanner, null);
  });
  await at('카메라 — 스캐너를 만들지도 못하면 오류 문구를 보인다(전역이 비어 있어도)', async () => {
    const s = scanWorld({ currentScreen: 'songdo-ship' });
    s.holder.ctorFail = true;
    await s.run('startSongdoShipScan()');
    assert.ok(s.el.innerHTML.includes('카메라를 쓸 수 없습니다') && s.el.innerHTML.includes('생성 실패'));
    assert.ok(!s.win._songdoShipScanner);
  });

  /* 불러오기(출하기록을 못 읽은 표시) */
  const loadWorld = async (shipsFail) => {
    const state = { currentScreen: 'songdo-ship', _songdoShip: null };
    const el = { innerHTML: '' };
    const data = { '완제품개별': [['FG-1', 'LOT-A', 'FG001', UP]], '완제품LOT': [['LOT-A', '2026-10-04', '호두과자']], '출하기록': [shipRow({ 0: 'SHP-20261004-001', 2: 'FG-9', 12: T0, 13: '직배' })] };
    const sheets = { invalidateCache() {}, getAll: async (tab) => { if (tab === '출하기록' && shipsFail) throw new Error('읽기 실패'); return data[tab].map((r) => r.slice()); } };
    const calls = [];
    const c = vm.createContext({ State: state, Screens: {}, SheetsAPI: sheets, renderHeader: (...a) => calls.push(['header', a[0]]), $id: () => el, HS_ESC: String, renderSongdoShip: () => calls.push(['render']), startSongdoShipScan: () => calls.push(['scan']), console });
    const a = SRC.indexOf("Screens['songdo-ship'] = async () => {");
    assert.ok(a !== -1);
    vm.runInContext(SRC.slice(a, SRC.indexOf('\n};\n', a) + 3), c);
    await vm.runInContext("Screens['songdo-ship']()", c);
    return { sd: state._songdoShip, calls, el };
  };
  await at('불러오기 — 출하기록을 읽으면 오늘 수·이미 나간 봉 안내가 채워지고 카메라가 켜진다', async () => {
    const { sd, calls } = await loadWorld(false);
    assert.deepStrictEqual([sd.ready, sd.shipsOk, sd.shipRows.length, sd.indiv.has('FG-1'), sd.shipByIndiv.has('FG-9')], [true, true, 1, true, true]);
    assert.strictEqual(sd.indiv.get('FG-1').itemName, '호두과자');
    assert.deepStrictEqual(plain(calls), [['header', '🏪 송도 직배'], ['render'], ['scan']]);
  });
  await at('불러오기 — 출하기록을 못 읽어도 화면은 열되 «못 읽음» 으로 표시한다(오늘 수를 말하지 않게)', async () => {
    const { sd } = await loadWorld(true);
    assert.deepStrictEqual([sd.ready, sd.shipsOk, sd.shipRows.length], [true, false, 0]);
  });

  asyncDone = true;
  console.log(ok.map((n) => '✓ ' + n).join('\n'));
  console.log(`\n${ok.length}건 통과`);
})().catch((e) => { console.error(e); process.exit(1); });
