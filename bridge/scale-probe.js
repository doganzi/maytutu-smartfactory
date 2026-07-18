'use strict';
/*
 * 저울 연결 확인 probe
 *   사용: node scale-probe.js <W610_IP> [포트]        (기본 포트 8899)
 *   동작: W610(시리얼서버)에 TCP 접속 → 저울이 뿌리는 원문 수신 → 파싱 결과 실시간 출력.
 *         Ctrl+C 종료 시 **포맷 추정 요약**을 출력한다(= 이 저울의 출력형식 확정용).
 *   목적: ① 배선·W610 설정이 맞는지 ② 저울 출력 포맷이 무엇인지 를 한 번에 확인.
 *
 *   장비 없이 자체 시험:  node scale-probe.js --mock      (다른 터미널에서 접속)
 *   옵션: --raw           수신 원문(hex 포함)까지 전부 출력
 *         --unit=g        단위를 출력하지 않는 저울의 기본단위 지정
 */

const net = require('net');
const codec = require('./scale-codec');

function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function runClient(host, port, opt) {
  console.log(`[${ts()}] 접속 시도 → ${host}:${port}   (Ctrl+C 로 종료하면 포맷요약 출력)`);
  const sp = codec.LineSplitter();
  const seen = [];
  let lastKg = null, stableCount = 0, lineCount = 0;

  const sock = new net.Socket();
  sock.setTimeout(30000);   // 저울은 계량 없을 때 조용할 수 있어 넉넉히

  sock.connect(port, host, () => {
    console.log(`[${ts()}] ✅ TCP 접속 성공 — 저울에 물건을 올렸다 내려보세요.`);
    console.log(`[${ts()}]    (데이터가 전혀 안 오면: 저울 '연속출력(스트림)' 설정 / 배선 TX-RX 교차 / 통신속도 확인)`);
  });

  sock.on('data', (chunk) => {
    if (opt.raw) console.log(`[${ts()}] RAW ${JSON.stringify(chunk.toString())}  hex=${chunk.toString('hex')}`);
    const lines = sp.push(chunk.toString('binary'));
    for (const ln of lines) {
      lineCount++;
      if (seen.length < 200) seen.push(ln);
      const p = codec.parseLine(ln, { defaultUnit: opt.unit });
      if (!p.ok) {
        console.log(`[${ts()}] ⚠ 해석실패(${p.reason}) : ${JSON.stringify(ln)}`);
        continue;
      }
      const st = p.stable === true ? '안정' : p.stable === false ? '불안정' : '상태?';
      const md = p.mode ? `/${p.mode === 'NT' ? '순중량' : '총중량'}` : '';
      const warn = p.unitAssumed ? ' ⚠단위가정' : '';
      // 안정값이 바뀔 때만 강조 출력(스팸 방지)
      const changed = p.stable === true && p.kg !== lastKg;
      if (p.stable === true) { stableCount++; if (changed) lastKg = p.kg; }
      const mark = changed ? ' ★확정후보' : '';
      console.log(`[${ts()}] ${st}${md} ${p.kg} kg${warn}${mark}   ← ${JSON.stringify(ln)}`);
    }
  });

  sock.on('timeout', () => {
    console.log(`[${ts()}] ⏱ 30초간 수신 없음 — 저울이 '요청시 출력' 모드일 수 있음(연속출력으로 변경) / 배선·통신속도 확인`);
  });
  sock.on('error', (e) => {
    console.log(`[${ts()}] ❌ 접속오류: ${e.code || e.message}`);
    if (e.code === 'ECONNREFUSED') console.log('   → W610 Socket 설정이 TCP Server 인지, 포트(기본 8899)가 맞는지 확인');
    if (e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH') console.log('   → IP 대역 불일치(이중NAT) / AP 클라이언트격리 ON / W610 미접속');
  });
  sock.on('close', () => console.log(`[${ts()}] 연결 종료`));

  function summary() {
    console.log('\n──────── 수신 요약 (이 저울의 출력 포맷) ────────');
    console.log(`총 수신 줄: ${lineCount} · 안정값: ${stableCount}`);
    const s = codec.sniff(seen);
    Object.keys(s).forEach(k => {
      const v = s[k];
      if (v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) return;
      console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    });
    if (s.경고) console.log(`  ⚠ ${s.경고} → scale-bridge 설정에 기본단위를 명시하세요.`);
    console.log('  ※ 이 요약을 그대로 전달하면 브리지(scale-bridge.js) 설정을 확정할 수 있습니다.');
  }

  process.on('SIGINT', () => { summary(); sock.destroy(); process.exit(0); });
}

/* ── 가짜 저울: CAS 형식으로 연속 출력. 원료 투입 시나리오를 흉내낸다. ── */
function runMock(port) {
  const srv = net.createServer((c) => {
    console.log('[mock] 클라이언트 접속 — 계량 시나리오 시작');
    // 앙호두 실제 배합: 마미만쥬믹스 14포대(140kg) 투입 → 안정
    const targets = [0, 10, 30, 60, 95, 128, 140, 140, 140];
    let i = 0, settle = 0;
    const t = setInterval(() => {
      let kg, stable;
      if (i < targets.length - 1) {                 // 투입 중 = 불안정
        kg = targets[i] + (Math.random() * 2 - 1);  // 흔들림
        stable = false; i++;
      } else {                                       // 안착 = 안정
        kg = 140.00; stable = true; settle++;
        if (settle > 6) { i = 0; settle = 0; }       // 다음 배치 반복
      }
      const sign = kg < 0 ? '-' : '+';
      const body = Math.abs(kg).toFixed(2).padStart(7, '0');
      c.write(`${stable ? 'ST' : 'US'},GS,${sign}  ${body}kg\r\n`);
    }, 400);
    c.on('close', () => clearInterval(t));
    c.on('error', () => clearInterval(t));
  });
  srv.listen(port, '127.0.0.1', () => {
    console.log(`[mock] 가짜 저울 127.0.0.1:${port} 대기`);
    console.log(`[mock] 다른 터미널에서:  node scale-probe.js 127.0.0.1 ${port}`);
  });
}

const argv = process.argv.slice(2);
const opt = {
  raw: argv.includes('--raw'),
  unit: (argv.find(a => a.startsWith('--unit=')) || '--unit=kg').split('=')[1],
};
const pos = argv.filter(a => !a.startsWith('--'));

if (argv.includes('--mock')) runMock(Number(pos[0]) || 8899);
else if (pos[0]) runClient(pos[0], Number(pos[1]) || 8899, opt);
else {
  console.log('사용법: node scale-probe.js <W610_IP> [포트]   [--raw] [--unit=g]');
  console.log('자체시험: node scale-probe.js --mock');
  process.exit(1);
}
