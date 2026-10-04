/**
 * NMD-530 금속검출기 수집기 → 스마트팩토리 시트 수신부 (웹앱)
 * 계약: docs/NMD530_PIPELINE.md §4~§7 (정본). 설치: apps-script/SETUP_NMD530.md
 * Tuya 로거와는 별도 Apps Script 프로젝트로 배포한다(자격증명·배포 분리).
 *
 * ─── 스크립트 속성 ───
 *   NMD530_TOKEN   = <공유 비밀>                 (필수)
 *   SHEET_ID       = <smartfactory 스프레드시트 ID> (필수)
 *   NMD530_DEVICES = NMD530-1,NMD530-2           (선택 · 비면 기기 검사 안 함)
 */

var NMD530_LOG_SHEET = '금속검출로그';
var NMD530_STATUS_SHEET = '금속검출상태';
var NMD530_TZ = 'Asia/Seoul';
var NMD530_MAX_EVENTS = 200;
var NMD530_STALE_WINDOW_MS = 10 * 60 * 1000;   // 늦게 도착한 «옛 요청» 으로 볼 최대 시각 차 — 이보다 크게 과거면 시계가 바로잡힌 것으로 보고 덮어쓴다
var NMD530_DEDUP_ROWS = 5000;

var NMD530_LOG_HEADER = ['기록시각(KST)', '구분', '증가분', '누적검출', '이전값', '구간시작', '제품번호',
  '설비상태', 'Ch1신호', 'Ch2신호', '끊김(초)', '기기', '수집PC', '서버수신시각', '이벤트ID'];
var NMD530_STATUS_HEADER = ['기기', '서버수신시각', '수집PC시각', '통신', '누적검출', '마지막유효관측',
  '제품번호', '설비상태', '대기큐', '수집PC', '수집기버전', '끊김시작', '가동시작'];

// 텍스트 서식 '@' 를 줄 열(1부터) — 자동 날짜 변환·수식 해석 방지
var NMD530_LOG_TEXT_COLS = [1, 6, 12, 13, 14, 15];
// 문자열이 들어가는 열 전부(D 통신 포함). 숫자 열 E·G·I 는 제외
var NMD530_STATUS_TEXT_COLS = [1, 2, 3, 4, 6, 10, 11, 12, 13];

var NMD530_KIND_KO = {
  DETECT: '검출', GAP: '미관측구간', RESET: '리셋',
  LINK_DOWN: '통신끊김', LINK_UP: '통신복구', COLLECTOR_START: '수집기시작'
};
var NMD530_FLAG_KO = {
  outError: 'Out error', balError: 'Bal error', testMode: '테스트 모드', dualFreq: '듀얼 주파수'
};


function nmd530_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function nmd530_fail_(code) { return nmd530_json_({ ok: false, error: code }); }

/** 길이가 달라도 끝까지 비교하는 문자열 비교(타이밍으로 토큰 길이·접두를 흘리지 않기) */
function nmd530_safeEq_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

function nmd530_kst_(d) { return Utilities.formatDate(d, NMD530_TZ, 'yyyy-MM-dd HH:mm:ss'); }

/** ISO 8601(오프셋 포함) 문자열 → KST 문자열. 파싱 불가·존재하지 않는 날짜/시각(2월 30일·24시)이면 null */
function nmd530_time_(s) {
  var m = typeof s === 'string' &&
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(s);
  if (!m) return null;
  var d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // 입력 오프셋 기준 시계 값으로 되돌려 입력과 한 칸이라도 다르면(롤오버) 거부
  var offMin = m[7] === 'Z' ? 0 : (m[8] === '-' ? -1 : 1) * (Number(m[9]) * 60 + Number(m[10]));
  var L = new Date(d.getTime() + offMin * 60000);
  var got = [L.getUTCFullYear(), L.getUTCMonth() + 1, L.getUTCDate(), L.getUTCHours(), L.getUTCMinutes(), L.getUTCSeconds()];
  for (var i = 0; i < 6; i++) { if (got[i] !== Number(m[i + 1])) return null; }
  return nmd530_kst_(d);
}

/** 숫자 칸: null/undefined → '' , 유한한 0 이상의 정수 → 값, 그 밖(소수·음수·문자열) → undefined(형식 오류) */
function nmd530_num_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v) return v;
  return undefined;
}

/** flags 배열 → 한글 '·' 연결. 배열이 아니면 undefined(형식 오류), 모르는 값은 버린다 */
function nmd530_flags_(f) {
  if (f === null || f === undefined) return '';
  if (!Array.isArray(f)) return undefined;
  var out = [];
  f.forEach(function (k) { if (NMD530_FLAG_KO[k]) out.push(NMD530_FLAG_KO[k]); });
  return out.join('·');
}

/** 이벤트 1건 → 로그 1행(15칸). 형식 오류면 null — why.code 에 사유코드(shape·id·kind·time·from·num·detect_n) */
function nmd530_row_(ev, device, host, recvAt, why) {
  why = why || {};
  if (!ev || typeof ev !== 'object') { why.code = 'shape'; return null; }
  if (typeof ev.id !== 'string' || ev.id.length < 1 || ev.id.length > 80) { why.code = 'id'; return null; }
  if (!Object.prototype.hasOwnProperty.call(NMD530_KIND_KO, ev.kind)) { why.code = 'kind'; return null; }
  var t = nmd530_time_(ev.t);
  if (t === null) { why.code = 'time'; return null; }
  var from = '';
  if (ev.from !== null && ev.from !== undefined) {
    from = nmd530_time_(ev.from);
    if (from === null) { why.code = 'from'; return null; }
  }
  var n = nmd530_num_(ev.n), total = nmd530_num_(ev.total), prev = nmd530_num_(ev.prev);
  var product = nmd530_num_(ev.product), ch1 = nmd530_num_(ev.ch1), ch2 = nmd530_num_(ev.ch2);
  var down = nmd530_num_(ev.downSec), flags = nmd530_flags_(ev.flags);
  if ([n, total, prev, product, ch1, ch2, down, flags].indexOf(undefined) !== -1) { why.code = 'num'; return null; }
  if ((ev.kind === 'DETECT' || ev.kind === 'GAP') && !(n >= 1)) { why.code = 'detect_n'; return null; }
  return [t, NMD530_KIND_KO[ev.kind], n, total, prev, from, product, flags, ch1, ch2, down,
    device, host, recvAt, ev.id];
}

function nmd530_str_(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).substring(0, max);
}

/** 상태 → 상태 시트 1행(13칸) */
function nmd530_statusRow_(st, device, host, collector, sentAt, recvAt) {
  if (!st || typeof st !== 'object') return null;
  var flags = nmd530_flags_(st.flags);
  return [device, recvAt, nmd530_str_(sentAt, 40), nmd530_str_(st.link, 8),
    typeof st.total === 'number' && isFinite(st.total) ? st.total : '',
    nmd530_str_(st.lastValidAt, 40),
    typeof st.product === 'number' && isFinite(st.product) ? st.product : '',
    flags === undefined ? '' : flags,
    typeof st.spool === 'number' && isFinite(st.spool) ? st.spool : '',
    host, nmd530_str_(collector, 60), nmd530_str_(st.downSince, 40), nmd530_str_(st.bootAt, 40)];
}

/** 시트 확보(없으면 헤더 1줄과 함께 생성 + 첫 줄 고정) */
function nmd530_sheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function nmd530_setText_(sh, row, numRows, cols) {
  cols.forEach(function (c) { sh.getRange(row, c, numRows, 1).setNumberFormat('@'); });
}

/** 끝에서 NMD530_DEDUP_ROWS 행의 O열(이벤트ID) 집합 — 프로토타입 없는 객체(id 가 constructor 여도 안전) */
function nmd530_recentIds_(sh) {
  var set = Object.create(null);
  var last = sh.getLastRow();
  if (last < 2) return set;
  var start = Math.max(2, last - NMD530_DEDUP_ROWS + 1);
  sh.getRange(start, 15, last - start + 1, 1).getValues().forEach(function (r) { set[String(r[0])] = true; });
  return set;
}

function nmd530_upsertStatus_(sh, row) {
  var last = sh.getLastRow();
  var target = last + 1;
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === row[0]) { target = i + 2; break; }
    }
  }
  if (target <= last) {
    // 기존 행의 수집PC시각(C)이 이번 요청보다 10분 안으로 미래면 늦게 도착한 옛 요청 — 덮어쓰지 않는다.
    // 10분을 넘게 미래면 수집 PC 시계가 앞서 있다가 바로잡힌 것이므로 덮어쓴다(안 그러면 그 시간만큼 상태가 얼어붙는다). 해석 불가면 덮어쓴다
    var oldT = new Date(String(sh.getRange(target, 3, 1, 1).getValues()[0][0])).getTime();
    var newT = new Date(String(row[2])).getTime();
    if (!isNaN(oldT) && !isNaN(newT) && oldT > newT && oldT - newT <= NMD530_STALE_WINDOW_MS) return;
  }
  nmd530_setText_(sh, target, 1, NMD530_STATUS_TEXT_COLS);
  sh.getRange(target, 1, 1, row.length).setValues([row]);
}

function doPost(e) {
  var props, body, lock = null, locked = false;
  try {
    try { body = JSON.parse(e.postData.contents); } catch (x) { return nmd530_fail_('bad_request'); }
    if (!body || typeof body !== 'object' || body.v !== 1) return nmd530_fail_('bad_request');

    props = PropertiesService.getScriptProperties();
    var token = props.getProperty('NMD530_TOKEN');
    // 토큰이 틀리면(또는 서버에 없으면) 어떤 정보도 주지 않고 시트도 열지 않는다
    if (!token || typeof body.token !== 'string' || !nmd530_safeEq_(body.token, token)) return nmd530_fail_('auth');

    if (!Array.isArray(body.events) || body.events.length > NMD530_MAX_EVENTS) return nmd530_fail_('bad_request');
    var device = body.device;
    if (typeof device !== 'string' || device.length < 1 || device.length > 40) return nmd530_fail_('bad_request');
    var allow = (props.getProperty('NMD530_DEVICES') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
    if (allow.length && allow.indexOf(device) === -1) return nmd530_fail_('bad_request');
    var host = nmd530_str_(body.host, 80);

    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    locked = true;

    var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
    var log = nmd530_sheet_(ss, NMD530_LOG_SHEET, NMD530_LOG_HEADER);
    var stSheet = nmd530_sheet_(ss, NMD530_STATUS_SHEET, NMD530_STATUS_HEADER);
    var recvAt = nmd530_kst_(new Date());

    var seen = nmd530_recentIds_(log);
    var rows = [], dup = 0, badIdx = [], badWhy = [];
    body.events.forEach(function (ev, idx) {
      var why = {};
      var row = nmd530_row_(ev, device, host, recvAt, why);
      if (!row) { badIdx.push(idx); badWhy.push(idx + ':' + why.code); return; }
      if (seen[row[14]]) { dup++; return; }
      seen[row[14]] = true;     // 같은 묶음 안의 중복도 거른다
      rows.push(row);
    });

    if (rows.length) {
      var first = log.getLastRow() + 1;
      nmd530_setText_(log, first, rows.length, NMD530_LOG_TEXT_COLS);   // 쓰기 전에 서식 먼저
      log.getRange(first, 1, rows.length, NMD530_LOG_HEADER.length).setValues(rows);
    }

    // 이벤트 내용·토큰·시각 원문은 남기지 않는다 — 위치와 사유코드만
    if (badIdx.length) Logger.log('nmd530 bad idx=' + badWhy.join(','));

    var stRow = nmd530_statusRow_(body.status, device, host, body.collector, body.sentAt, recvAt);
    if (stRow) nmd530_upsertStatus_(stSheet, stRow);

    return nmd530_json_({ ok: true, v: 1, saved: rows.length, dup: dup, bad: badIdx.length, badIdx: badIdx });
  } catch (err) {
    // 내부 값은 응답에 싣지 않는다. 토큰은 메시지에 들어갈 일이 없다(본문을 그대로 찍지 않음)
    Logger.log('nmd530 doPost 오류: ' + (err && err.message ? err.message : 'unknown'));
    return nmd530_fail_('server');
  } finally {
    if (locked) {
      try { SpreadsheetApp.flush(); } catch (x3) { /* 반영 강제 실패는 응답을 막지 않는다 */ }   // 락을 놓기 전에 쓴 값을 확정해 다음 요청이 옛 값을 읽지 않게 한다
      try { lock.releaseLock(); } catch (x2) { /* 해제 실패는 응답을 막지 않는다 */ }
    }
  }
}

/**
 * 편집기에서 직접 실행하는 중복 방지 시험(SETUP 21단계). 이름 끝에 밑줄(_)이 없어야 편집기 «실행» 목록에 나온다. 같은 본문(같은 이벤트ID 2건)을 doPost 로 두 번 보낸다.
 * 합격 = 1차 saved:2 · 2차 saved:0, dup:2 (실행 로그에 찍힌다). 시트에 SELFTEST| 행 2건이 남는다 — 지워도 된다.
 */
function nmd530_selfTest() {
  var props = PropertiesService.getScriptProperties();
  var allow = (props.getProperty('NMD530_DEVICES') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  var now = nmd530_kst_(new Date());
  var t = now.replace(' ', 'T') + '+09:00';
  var stamp = now.replace(/\D/g, '');
  var body = JSON.stringify({ v: 1, token: props.getProperty('NMD530_TOKEN'), device: allow[0] || 'NMD530-1',
    host: 'SELFTEST', collector: 'selftest', sentAt: t, status: null, events: [
      { id: 'SELFTEST|' + stamp + '|0001', t: t, kind: 'COLLECTOR_START' },
      { id: 'SELFTEST|' + stamp + '|0002', t: t, kind: 'COLLECTOR_START' }] });
  var r1 = doPost({ postData: { contents: body } }).getContent();
  var r2 = doPost({ postData: { contents: body } }).getContent();
  Logger.log('nmd530 selfTest 1차=' + r1);
  Logger.log('nmd530 selfTest 2차=' + r2);
  return [r1, r2];
}

function doGet(e) {
  return nmd530_json_({ service: 'nmd530_receiver', ok: true });
}
