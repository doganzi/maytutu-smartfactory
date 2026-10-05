'use strict';
/*
 * NMD-530 카운터 엔진 — 누적 검출 카운터의 관측열을 이벤트로 바꾼다 (계약서 §3·§4)
 *
 * 순수 함수 모듈: 네트워크·파일·시계를 직접 만지지 않는다(시각은 호출자가 넘긴다).
 * 그래서 표 기반으로 모든 상황을 단위시험할 수 있다.
 *
 *   const c = createCounter({ downAfterMs, state, device, bootId, now });
 *   c.onValid(obs)   유효한 0x35 응답 1건 → 이벤트 배열
 *   c.onTick(nowMs)  «응답 없음» 시계 눈금 → 이벤트 배열(LINK_DOWN)
 *   c.redial(nowMs)  끊김이 이어지는 동안 downAfterMs 마다 true — 호출자가 소켓을 다시 파기·재접속한다
 *   c.snapshot()     state.json 에 저장할 상태 + 화면용 요약
 *
 * obs = { t(ms), total, product, ch1, ch2, flags[] }
 */

const FLAG_KEYS = ['outError', 'balError', 'testMode', 'dualFreq']; // bit0·bit5 는 예약이라 내보내지 않는다
const KST_OFFSET_MS = 9 * 3600 * 1000;

/** 머신 시간대와 무관하게 항상 +09:00 ISO (밀리초 없음). 계약서 §4 */
function kstIso(ms) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 19) + '+09:00';
}

/** 기동 식별자 20261005T102030K (KST 초 단위). 이벤트 id 의 가운데 칸 */
function makeBootId(ms) {
  return kstIso(ms).slice(0, 19).replace(/[-:]/g, '') + 'K';
}

function isNum(v) { return typeof v === 'number' && isFinite(v); }
function pad4(n) { return String(n).padStart(4, '0'); }
function cleanFlags(list) {
  const set = new Set(Array.isArray(list) ? list : []);
  return FLAG_KEYS.filter(k => set.has(k));
}

function createCounter(opts) {
  opts = opts || {};
  const downAfterMs = isNum(opts.downAfterMs) ? opts.downAfterMs : 30000;
  const device = opts.device || 'NMD530-1';
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const startedAt = now();
  const bootId = opts.bootId || makeBootId(startedAt);
  const st = opts.state || {};

  let lastTotal = isNum(st.lastTotal) ? st.lastTotal : null;
  let lastValidAt = isNum(st.lastValidAt) ? st.lastValidAt : null; // 재시작 전 값도 포함 — COLLECTOR_START.from 의 근원
  let seq = isNum(st.seq) ? st.seq : 0;
  // 끊김 상태는 프로세스 안에서만 의미가 있다. 재시작 사이의 공백은 COLLECTOR_START 가 드러낸다.
  let down = false, downSince = null;
  let seen = false;       // 이 프로세스에서 유효 응답을 받은 적이 있는가
  let refAt = startedAt;  // 끊김 판정 기준 시각(시작 또는 이 프로세스의 마지막 유효 시각). 시계가 되감기면 당겨진다
  let redialAt = null;    // 끊김 중 마지막으로 소켓을 파기한 시각(선언 시각이 처음)
  let started = false;
  let last = { product: null, ch1: null, ch2: null, flags: [] };

  function mk(kind, tMs, f) {
    f = f || {};
    seq += 1;
    return {
      id: `${device}|${bootId}|${pad4(seq)}`,
      t: kstIso(tMs),
      kind,
      n: isNum(f.n) ? f.n : null,
      total: isNum(f.total) ? f.total : null,
      prev: isNum(f.prev) ? f.prev : null,
      from: isNum(f.from) && f.from <= tMs ? kstIso(f.from) : null, // 시계 역행으로 from > t 면 구간을 만들지 않는다
      product: last.product, ch1: last.ch1, ch2: last.ch2,
      flags: last.flags.slice(),
      downSec: isNum(f.downSec) ? f.downSec : null,
    };
  }

  function onValid(obs) {
    const out = [];
    // 비수치 total 은 유효 응답이 아니다 — 기준선·lastValidAt 을 건드리지 않는다
    if (!isNum(obs.total) || !Number.isInteger(obs.total) || obs.total < 0) return out;
    const t = obs.t;
    const prevAt = lastValidAt, prevTotal = lastTotal;
    last = {
      product: isNum(obs.product) ? obs.product : null,
      ch1: isNum(obs.ch1) ? obs.ch1 : null,
      ch2: isNum(obs.ch2) ? obs.ch2 : null,
      flags: cleanFlags(obs.flags),
    };

    if (!started) {
      started = true;
      // t 는 프로세스 시작 시각: LINK_DOWN~LINK_UP 구간과 겹쳐 공백이 이중 집계되지 않게 한다.
      out.push(mk('COLLECTOR_START', startedAt, { total: obs.total, from: prevAt }));
    }
    if (down) {
      out.push(mk('LINK_UP', t, { total: obs.total, downSec: Math.max(0, Math.round((t - downSince) / 1000)) }));
      down = false; downSince = null;
    }
    if (prevTotal !== null) {
      if (obs.total > prevTotal) {
        const gap = prevAt === null || (t - prevAt) < 0 || (t - prevAt) > downAfterMs; // 간격이 음수(시계 역행)면 시각 미상
        out.push(mk(gap ? 'GAP' : 'DETECT', t, { n: obs.total - prevTotal, prev: prevTotal, total: obs.total, from: prevAt }));
      } else if (obs.total < prevTotal) {
        // 리셋: 리셋 전 구간은 알 수 없으므로 증가분을 만들지 않는다
        out.push(mk('RESET', t, { prev: prevTotal, total: obs.total, from: prevAt }));
      }
    }
    lastTotal = obs.total; lastValidAt = t; refAt = t; seen = true;
    return out;
  }

  function onTick(nowMs) {
    if (down) return [];
    if (nowMs < refAt) refAt = nowMs; // 시계 역행: 기준을 당겨 끊김 판정이 멎지 않게 한다
    const ref = refAt;
    if (nowMs - ref <= downAfterMs) return [];
    down = true; downSince = ref; redialAt = nowMs;
    return [mk('LINK_DOWN', nowMs, { from: lastValidAt })];
  }

  /** 끊김이 이어지는 동안 downAfterMs 마다 true(이벤트는 만들지 않는다). 재접속한 소켓이 침묵해도 영구히 머물지 않게 한다 */
  function redial(nowMs) {
    if (!down) return false;
    if (nowMs < redialAt) redialAt = nowMs;
    if (nowMs - redialAt < downAfterMs) return false;
    redialAt = nowMs;
    return true;
  }

  function snapshot() {
    return {
      lastTotal, lastValidAt, down, downSince, seq,
      bootId, startedAt,
      link: seen && !down ? 'UP' : 'DOWN',
      product: last.product, flags: last.flags.slice(),
    };
  }

  return { onValid, onTick, redial, snapshot, bootId };
}

module.exports = { createCounter, kstIso, makeBootId, FLAG_KEYS };
