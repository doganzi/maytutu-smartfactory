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

  return { prop: p_, deviceStatus: deviceStatus_, deviceIds: deviceIds_, nameOf: nameOf_ };
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


/** ⑤ 1회: 10분 주기 트리거 등록(중복 제거 후 재생성) */
function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'logTemperatures') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('logTemperatures').timeBased().everyMinutes(10).create();
  Logger.log('완료: 10분 주기로 logTemperatures() 자동 실행됩니다.');
}
