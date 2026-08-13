/* 🔕 시험성적서 알림 끄기 — 시뮬레이션 검증 (건의 FR-20260813-3ZC)

   실행:  node tests/cert-notif.test.js      실패하면 assert 로 즉시 중단
   범위:  ① CertNotif 판정 로직(index.html 원본을 그대로 떼어 돌린다)
          ② **끄기가 실제로 꽂혀 있는 자리** — 판정 함수만 있고 호출이 빠지면
             "껐는데 계속 뜬다"가 되는데 로직 테스트만으로는 초록이다. 그래서 배선까지 본다.
          ③ 끈 상태에서도 **다시 켤 길이 남아 있는지**(홈 배너 + 설정) — 이게 건의의 절반이다. */
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
  return SRC.slice(i, j + endMark.length);
}

// ── ① 판정 로직 ──────────────────────────────────────────────────────────────
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};
const { CertNotif } = vm.runInThisContext(
  slice('// <cert-notif>', '// </cert-notif>') + '\n;({ CertNotif })',
  { filename: 'index.html#CertNotif' });

assert.strictEqual(CertNotif.off(), false, '기본값 = 켜짐(알림 나옴). 전 직원 기기에서 조용해지면 안 된다');

CertNotif.set(true);
assert.strictEqual(CertNotif.off(), true, '껐으면 꺼진 것으로 읽혀야 한다');
assert.strictEqual(store[CertNotif.KEY], '1', '저장은 localStorage 한 칸 — 시트를 건드리지 않는다');

CertNotif.set(false);
assert.strictEqual(CertNotif.off(), false, '다시 켤 수 있어야 한다 — 건의의 절반이 이것이다');
assert.strictEqual(store[CertNotif.KEY], undefined, '켜면 키를 지운다(빈 값 잔재 금지)');

// 껐다 켰다를 반복해도 상태가 엉키지 않는다
for (let i = 0; i < 5; i++) {
  CertNotif.set(i % 2 === 0);
  assert.strictEqual(CertNotif.off(), i % 2 === 0, `${i}회차 토글`);
}
CertNotif.set(false);

// 알 수 없는 값이 들어와도 '켜짐'으로 떨어진다 — 애매하면 알리는 쪽(HACCP 안전측)
store[CertNotif.KEY] = 'yes';
assert.strictEqual(CertNotif.off(), false, "'1' 이 아닌 값은 켜짐으로 본다");
delete store[CertNotif.KEY];

// localStorage 가 막힌 브라우저(사파리 사생활 보호 등)에서도 죽지 않고 켜짐으로 떨어진다
const realLS = global.localStorage;
global.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
assert.strictEqual(CertNotif.off(), false, 'localStorage 차단 시 켜짐(알림 나옴)으로 폴백');
assert.doesNotThrow(() => CertNotif.set(true), 'localStorage 차단 시에도 예외를 던지지 않는다');
global.localStorage = realLS;

// ── ② 배선 — 끄기가 실제로 꽂혀 있는가 ────────────────────────────────────────
assert.ok(/certAlerts\.length > 0 && !CertNotif\.off\(\)\) \{/.test(SRC),
  '홈 토스트(🧪 만료/갱신 임박)가 CertNotif.off() 를 보지 않는다 — 껐는데 계속 뜬다');
assert.ok(SRC.includes('${certAlerts.length > 0 && !CertNotif.off() ? `'),
  '홈 🧪 알림 목록이 CertNotif.off() 를 보지 않는다');
assert.ok(SRC.includes('${certAlerts.length > 0 && CertNotif.off() ? `'),
  '꺼진 상태의 홈 배너가 없다 — 껐다는 사실도, 켤 길도 화면에서 사라진다');

// 만료 판정 자체는 끄지 않는다 — 성적서 탭·현황 카드는 그대로 남아야 한다(HACCP 근거)
const certStatusBlock = slice('  certStatus(validUntil) {', '\n  },');
assert.ok(!certStatusBlock.includes('CertNotif'),
  '만료 판정(certStatus)이 알림 설정을 보면 안 된다 — 끄기는 표시만 멈추는 것이다');
const statCard = SRC.slice(SRC.indexOf("'성적서 알림' : '성적서 정상'") - 900, SRC.indexOf("'성적서 알림' : '성적서 정상'"));
assert.ok(!statCard.includes('CertNotif'),
  '홈 상태 카드(🧪 N건)까지 숨기면 안 된다 — 만료 사실을 감추는 것이 된다');

// ── ③ 다시 켜는 길 ───────────────────────────────────────────────────────────
assert.ok(SRC.includes('function setCertAlertOff('), 'on/off 진입 함수가 없다');
assert.ok(SRC.includes('setCertAlertOff(false)'), '홈 배너에 «🔔 켜기» 가 없다');
assert.ok(SRC.includes('setCertAlertOff(true)'), '홈 목록에 «🔕 끄기» 가 없다');
assert.ok(SRC.includes('setCertAlertOff(${!CertNotif.off()})'), '설정 › 알림 토글이 없다 — 홈에 알림이 0건이면 켤 자리가 사라진다');
assert.ok(/toast\(off \?[^\n]*설정 › 알림에서 다시 켤 수 있어요/.test(SRC),
  '끌 때 어디서 다시 켜는지 알려주지 않는다');

// `.btn-outline` 단독 금지(CLAUDE.md UI 함정) — 흰 카드 위에서 버튼이 안 보인다
['setCertAlertOff(false)', 'setCertAlertOff(true)'].forEach(hook => {
  const line = SRC.split('\n').find(l => l.includes(hook) && l.includes('<button'));
  assert.ok(line, `${hook} 버튼 줄을 찾지 못함`);
  if (line.includes('btn-outline')) {
    assert.ok(/btn-outline (btn-pri|btn-gray|btn-info|btn-warn|btn-err)/.test(line),
      `.btn-outline 은 색상 modifier 와 짝지어야 한다: ${hook}`);
  }
});

console.log('✅ cert-notif 검증 통과 — 판정 · 배선(토스트·목록) · 재활성 경로(홈·설정) · 안전 폴백');
