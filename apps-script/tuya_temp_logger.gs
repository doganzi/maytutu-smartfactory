/**
 * Tuya(스마트라이프) WiFi 온도센서 → smartfactory 동결온도 로그 자동 적재
 * 대상: 메이투투 HACCP 동결온도 모니터링 (KONLEN Tuya 온도센서, -40~+20℃, 상시전원)
 * 동작: 10분 주기 시간트리거가 Tuya Cloud API 를 폴링해 시트에 1행씩 append.
 *
 * ─── [1회 설정] 프로젝트 설정 → '스크립트 속성'에 아래 키 입력 ───
 *   TUYA_ENDPOINT      = https://openapi.tuyaus.com   ← 데이터센터(us/eu/cn/in)에 맞게! (m-us → us 추정)
 *   TUYA_ACCESS_ID     = <Tuya 콘솔 Access ID>
 *   TUYA_ACCESS_SECRET = <Tuya 콘솔 Access Secret>
 *   TUYA_DEVICE_IDS    = <deviceId1,deviceId2>        ← 콤마 구분(냉장고 N대)
 *   DEVICE_NAMES       = deviceId1=냉장고1,deviceId2=냉장고2   ← (선택) 사람이 읽을 이름
 *   SHEET_ID           = <smartfactory 스프레드시트 ID>
 *   SHEET_NAME         = 동결온도로그                  ← (선택, 기본값) 없으면 자동 생성
 *   TEMP_CODE          = temp_current                ← discoverStatus()로 확인 후 교정
 *   TEMP_SCALE         = 10                          ← 281→28.1℃ 이면 10 / 28→28 이면 1
 *
 * ─── [실행 순서] ───
 *   ① 위 속성 채우기  →  ② discoverStatus() 실행(로그에서 온도 code/scale 확인)
 *   →  ③ TEMP_CODE / TEMP_SCALE 교정  →  ④ logTemperatures() 1회 수동 실행(시트 적재 확인)
 *   →  ⑤ createTrigger() 실행(10분 자동화 등록)
 *
 * 필요 권한: UrlFetchApp(외부요청) + Spreadsheet. 첫 실행 시 인증 동의 1회.
 */

var TUYA = (function () {
  var SP = PropertiesService.getScriptProperties();
  function p_(k, d) { var v = SP.getProperty(k); return v == null ? d : v; }

  function toHex_(bytes, upper) {
    var s = bytes.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);   // Apps Script 는 부호있는 바이트 반환
      return v.length === 1 ? '0' + v : v;
    }).join('');
    return upper ? s.toUpperCase() : s;
  }
  function sha256Hex_(str) {
    return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str || '', Utilities.Charset.UTF_8), false);
  }
  function hmac256Hex_(str, secret) {
    return toHex_(Utilities.computeHmacSha256Signature(str, secret, Utilities.Charset.UTF_8), true); // 대문자
  }

  // Tuya v2 서명: signStr = client_id + [access_token] + t + nonce + stringToSign
  //   stringToSign = METHOD \n SHA256(body) \n (Signature-Headers, 미사용→공백) \n urlPath(+정렬된 query)
  function request_(method, path, accessToken, body) {
    var endpoint = p_('TUYA_ENDPOINT', 'https://openapi.tuyaus.com');
    var clientId = p_('TUYA_ACCESS_ID', '');
    var secret = p_('TUYA_ACCESS_SECRET', '');
    if (!clientId || !secret) throw new Error('TUYA_ACCESS_ID / TUYA_ACCESS_SECRET 스크립트 속성이 비어 있습니다.');

    var t = String(Date.now());
    var nonce = Utilities.getUuid();
    var bodyStr = body ? JSON.stringify(body) : '';
    var stringToSign = method + '\n' + sha256Hex_(bodyStr) + '\n' + '' + '\n' + path;
    var signStr = clientId + (accessToken || '') + t + nonce + stringToSign;

    var headers = {
      'client_id': clientId,
      'sign': hmac256Hex_(signStr, secret),
      't': t,
      'sign_method': 'HMAC-SHA256',
      'nonce': nonce
    };
    if (accessToken) headers['access_token'] = accessToken;

    var resp = UrlFetchApp.fetch(endpoint + path, {
      method: method.toLowerCase(),
      headers: headers,
      contentType: 'application/json',
      muteHttpExceptions: true
    });
    var json = JSON.parse(resp.getContentText());
    if (!json.success) {
      throw new Error('Tuya API 실패 [' + path + '] code=' + json.code + ' msg=' + json.msg);
    }
    return json.result;
  }

  // 액세스 토큰(≈2h) 캐시: 만료 60초 전이면 재발급
  function getToken_() {
    var cached = p_('TUYA_TOKEN', ''), exp = Number(p_('TUYA_TOKEN_EXP', '0'));
    if (cached && Date.now() < exp - 60000) return cached;
    var r = request_('GET', '/v1.0/token?grant_type=1', '', null);
    SP.setProperty('TUYA_TOKEN', r.access_token);
    SP.setProperty('TUYA_TOKEN_EXP', String(Date.now() + r.expire_time * 1000));
    return r.access_token;
  }

  function deviceStatus_(id) { return request_('GET', '/v1.0/devices/' + id + '/status', getToken_(), null); }

  function deviceIds_() {
    return (p_('TUYA_DEVICE_IDS', '') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  }
  function nameOf_(id) {
    var map = p_('DEVICE_NAMES', ''); if (!map) return '';
    var hit = ''; map.split(',').forEach(function (kv) {
      var a = kv.split('='); if (a[0] && a[0].trim() === id) hit = (a[1] || '').trim();
    });
    return hit;
  }

  return { prop: p_, deviceStatus: deviceStatus_, deviceIds: deviceIds_, nameOf: nameOf_,
           request: request_, token: getToken_ };
})();


/** ② 설정 직후 1회: 각 기기 원시 status 를 로그로 출력 → 온도 code / scale 확인용 */
function discoverStatus() {
  var ids = TUYA.deviceIds();
  if (!ids.length) { Logger.log('TUYA_DEVICE_IDS 가 비어 있습니다. 스크립트 속성을 먼저 채우세요.'); return; }
  ids.forEach(function (id) {
    try { Logger.log('● ' + id + ' status:\n' + JSON.stringify(TUYA.deviceStatus(id), null, 2)); }
    catch (e) { Logger.log('● ' + id + ' 오류: ' + e.message); }
  });
  Logger.log('↑ 온도값 code(예: temp_current) 와 scale(281이면 10, 28이면 1)을 확인해 속성에 반영하세요.');
}


/** 로그 시트 핸들(없으면 헤더와 함께 생성) */
function getLogSheet_() {
  var id = TUYA.prop('SHEET_ID', '');
  if (!id) throw new Error('SHEET_ID 스크립트 속성이 비어 있습니다.');
  var ss = SpreadsheetApp.openById(id);
  var name = TUYA.prop('SHEET_NAME', '동결온도로그');
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(['기록시각(KST)', '기기ID', '기기명', '온도(℃)', '상태', '원시값']);
    sh.setFrozenRows(1);
  }
  return sh;
}


/** ④/⑤ 10분 트리거가 호출: 모든 기기 현재 온도를 시트에 append */
function logTemperatures() {
  var ids = TUYA.deviceIds();
  if (!ids.length) return;
  var code = TUYA.prop('TEMP_CODE', 'temp_current');
  var scale = Number(TUYA.prop('TEMP_SCALE', '10')) || 1;
  var sh = getLogSheet_();
  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  var rows = [];

  ids.forEach(function (id) {
    var temp = '', raw = '', state = 'OK';
    try {
      var st = TUYA.deviceStatus(id); // [{code, value}, ...]
      var found = false;
      for (var i = 0; i < st.length; i++) {
        if (st[i].code === code) { raw = st[i].value; temp = Number(st[i].value) / scale; found = true; break; }
      }
      if (!found) state = 'NO_CODE(' + code + ')';
    } catch (e) {
      state = 'ERROR: ' + e.message;
    }
    rows.push([now, id, TUYA.nameOf(id), temp, state, raw]);
  });

  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}


/* ═══════════════════════════════════════════════════════════════════
   이력 백필 — Tuya 서버에 남은 과거 온도 이력으로 '결측' 행을 채운다.
   배경: 2026-07-11 IoT Core 구독 만료로 API가 막혀 온도칸이 빈 행이 쌓임.
        구독 복구 후, Tuya 가 서버에 보관 중인 실측 이력을 회수해 되메운다.
   원칙: ① 채우는 값은 Tuya 서버의 실측값(날조·보간 금지)
        ② ±MATCH_MIN 분 이내 매칭만 채움, 없으면 결측 그대로 둔다
        ③ 상태칸에 BACKFILL 출처를 남겨 실시간 수집분과 감사 시 구분 가능
   사용: backfillDryRun() 먼저 → 회수 가능 구간 확인 → backfillApply()
   ═══════════════════════════════════════════════════════════════════ */
var BACKFILL_MATCH_MIN = 5;      // 결측 시각 ±5분 이내 이력만 매칭
var BACKFILL_PAGE = 100;         // Tuya logs 페이지 크기
var BACKFILL_MAX_DAYS = 8;       // 이 기간보다 과거는 조회하지 않음(무료등급 보관 ≈7일)
var BACKFILL_SLEEP_MS = 1500;    // 요청 간 지연 — code=40000309(too frequent) 회피
var BACKFILL_RETRY = [5000, 12000, 25000];   // rate limit 시 백오프 재시도 간격
var BACKFILL_MAX_RUN_MS = 5 * 60 * 1000;     // Apps Script 6분 제한 대비 조기 종료선

function backfillDryRun() { backfillFromTuya_(true); }
function backfillApply()  { backfillFromTuya_(false); }

var BF_START = 0;
function bfOutOfTime_() { return BF_START && (Date.now() - BF_START) > BACKFILL_MAX_RUN_MS; }

/** 시트 시각(KST 문자열/Date) → epoch ms */
function bfParseKst_(v) {
  if (v instanceof Date) return v.getTime();
  var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +(m[6] || 0));   // KST → UTC
}
function bfFmt_(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); }

/* Tuya v2 서명 규칙: 쿼리 파라미터를 키 기준 오름차순 정렬해야 sign 이 유효하다.
   (정렬 안 하면 code=1004 sign invalid) */
function bfLogPath_(id, params) {
  var keys = Object.keys(params).filter(function (k) { return params[k] !== '' && params[k] != null; }).sort();
  var qs = keys.map(function (k) { return k + '=' + params[k]; }).join('&');
  return '/v1.0/devices/' + id + '/logs' + (qs ? '?' + qs : '');
}

/* Tuya 이력 API 는 호출빈도 제한이 있다(code=40000309 too frequent).
   요청마다 지연을 두고, 제한에 걸리면 백오프 재시도한다. 소진되면 null 반환. */
function bfRequestWithRetry_(path, label) {
  for (var a = 0; a <= BACKFILL_RETRY.length; a++) {
    try {
      var r = TUYA.request('GET', path, TUYA.token(), null);
      Utilities.sleep(BACKFILL_SLEEP_MS);            // 성공해도 다음 호출 전 간격 확보
      return r;
    } catch (err) {
      var tooFast = String(err.message).indexOf('40000309') >= 0;
      if (!tooFast || a === BACKFILL_RETRY.length) {
        Logger.log('    [' + label + '] 조회실패: ' + err.message);
        return null;
      }
      Logger.log('    [' + label + '] 속도제한 — ' + (BACKFILL_RETRY[a] / 1000) + '초 후 재시도(' + (a + 1) + ')');
      Utilities.sleep(BACKFILL_RETRY[a]);
    }
  }
  return null;
}

/** 기기 이력 조회 → [{t, raw}] 오름차순.
 *  · 조회구간을 일 단위로 쪼갠다(Tuya 이력 API 구간길이 제한 회피)
 *  · 보관기간을 넘는 과거는 애초에 조회하지 않는다(BACKFILL_MAX_DAYS) */
function bfFetchLogs_(id, startMs, endMs, code) {
  var out = [], chunk = 24 * 3600 * 1000;
  var floor = Date.now() - BACKFILL_MAX_DAYS * 24 * 3600 * 1000;
  var from = Math.max(startMs, floor);
  if (from >= endMs) return out;

  for (var s = from; s < endMs; s += chunk) {
    if (bfOutOfTime_()) { Logger.log('    ⏱ 실행시간 한계 — 이후 구간 중단(재실행하면 이어서 회수 가능)'); break; }
    var e = Math.min(s + chunk, endMs);
    var rowKey = '', guard = 0;
    while (guard++ < 100) {
      if (bfOutOfTime_()) break;
      var path = bfLogPath_(id, {
        type: 7, start_time: s, end_time: e, size: BACKFILL_PAGE,
        start_row_key: rowKey || null
      });
      var r = bfRequestWithRetry_(path, bfFmt_(s));
      if (!r) break;                                  // 재시도 소진 → 이 구간 포기하고 다음 구간
      var logs = (r && r.logs) || [];
      for (var i = 0; i < logs.length; i++) {
        if (logs[i].code !== code) continue;
        var t = Number(logs[i].event_time);
        if (isFinite(t)) out.push({ t: t, raw: logs[i].value });
      }
      if (!r || !r.has_next) break;
      rowKey = r.next_row_key || '';
      if (!rowKey) break;
    }
  }
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}

/** 정렬된 이력에서 목표시각에 가장 가까운 값(허용오차 내) 찾기 */
function bfNearest_(logs, targetMs, tolMs) {
  var lo = 0, hi = logs.length - 1, best = null, bestD = Infinity;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1, d = logs[mid].t - targetMs;
    if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = logs[mid]; }
    if (d < 0) lo = mid + 1; else hi = mid - 1;
  }
  return (best && bestD <= tolMs) ? { hit: best, diff: bestD } : null;
}

function backfillFromTuya_(dryRun) {
  BF_START = Date.now();
  var sh = getLogSheet_();
  var data = sh.getDataRange().getValues();
  if (data.length < 2) { Logger.log('데이터 없음'); return; }

  var code = TUYA.prop('TEMP_CODE', 'temp_current');
  var scale = Number(TUYA.prop('TEMP_SCALE', '10')) || 1;
  var tol = BACKFILL_MATCH_MIN * 60 * 1000;

  // 결측 행 수집 (온도칸 비어있는 행)
  var miss = [];
  for (var i = 1; i < data.length; i++) {
    var temp = data[i][3];
    if (temp === '' || temp === null || temp === undefined) {
      var ms = bfParseKst_(data[i][0]);
      if (isFinite(ms)) miss.push({ idx: i, ms: ms, id: String(data[i][1] || '') });
    }
  }
  Logger.log('결측 행: ' + miss.length + '건');
  if (!miss.length) return;

  // 기기별 구간
  var byDev = {};
  miss.forEach(function (m) {
    if (!byDev[m.id]) byDev[m.id] = { min: m.ms, max: m.ms, rows: [] };
    byDev[m.id].min = Math.min(byDev[m.id].min, m.ms);
    byDev[m.id].max = Math.max(byDev[m.id].max, m.ms);
    byDev[m.id].rows.push(m);
  });

  var stampNow = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var filled = 0, unfilled = 0, perDev = [];

  Object.keys(byDev).forEach(function (id) {
    var d = byDev[id], nm = TUYA.nameOf(id) || id;
    var logs;
    try {
      logs = bfFetchLogs_(id, d.min - tol, d.max + tol, code);
    } catch (e) {
      Logger.log('● ' + nm + ' 이력조회 실패: ' + e.message); perDev.push(nm + ': 조회실패'); return;
    }
    if (!logs.length) { Logger.log('● ' + nm + ' 회수 가능 이력 0건 (보관기간 만료 추정)'); perDev.push(nm + ': 0건'); return; }

    var f = 0, u = 0, firstHit = null, lastHit = null;
    d.rows.forEach(function (m) {
      var n = bfNearest_(logs, m.ms, tol);
      if (!n) { u++; return; }
      f++;
      if (!firstHit) firstHit = m.ms;
      lastHit = m.ms;
      if (!dryRun) {
        var val = Number(n.hit.raw) / scale;
        data[m.idx][3] = val;
        data[m.idx][4] = 'BACKFILL(Tuya이력 ' + stampNow + ' 회수, 원기록 ERROR:구독만료)';
        data[m.idx][5] = n.hit.raw;
      }
    });
    filled += f; unfilled += u;
    Logger.log('● ' + nm + ' — 이력 ' + logs.length + '건 / 채움 ' + f + ' / 미매칭 ' + u +
               (firstHit ? ' / 복구구간 ' + bfFmt_(firstHit) + ' ~ ' + bfFmt_(lastHit) : ''));
    Logger.log('    이력 실제 보유구간: ' + bfFmt_(logs[0].t) + ' ~ ' + bfFmt_(logs[logs.length - 1].t));
    perDev.push(nm + ': ' + f + '/' + (f + u));
  });

  Logger.log('──────────────────────────────');
  Logger.log((dryRun ? '[드라이런] ' : '[적용] ') + '채움 ' + filled + '건 / 미매칭 ' + unfilled + '건  (' + perDev.join(' · ') + ')');

  if (dryRun) { Logger.log('※ 시트 미변경. 실제 반영하려면 backfillApply() 실행.'); return; }
  if (!filled) { Logger.log('채울 값이 없어 시트를 변경하지 않았습니다.'); return; }
  if (unfilled) Logger.log('※ 미매칭 ' + unfilled + '건 — 속도제한/실행시간으로 못 받은 구간이 있으면 ' +
                           'backfillApply() 를 다시 실행하세요. 이미 채운 행은 건너뛰므로 이어서 회수됩니다.');

  // D:F(온도/상태/원시값) 한 번에 기록
  var out = [];
  for (var r = 1; r < data.length; r++) out.push([data[r][3], data[r][4], data[r][5]]);
  sh.getRange(2, 4, out.length, 3).setValues(out);
  Logger.log('완료: 시트 반영됨 (' + filled + '건). 앱 동결온도 모니터링에서 확인하세요.');
}


/** ⑤ 1회: 10분 주기 트리거 등록(중복 제거 후 재생성) */
function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'logTemperatures') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('logTemperatures').timeBased().everyMinutes(10).create();
  Logger.log('완료: 10분 주기로 logTemperatures() 자동 실행됩니다.');
}
