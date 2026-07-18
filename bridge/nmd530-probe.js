'use strict';
/*
 * NMD-530 연결 확인 probe
 *   사용: node nmd530-probe.js <검출기IP> [포트]
 *   동작: TCP 접속 → 상태조회(0x33) 주기 전송 → 돌아오는 프레임 디코드 출력.
 *   목적: W610 브리지/네트워크가 뚫렸는지, 검출기가 응답하는지 눈으로 확인.
 *
 *   가짜 검출기로 자체 시험:  node nmd530-probe.js --mock
 */

const net = require('net');
const codec = require('./nmd530-codec');

function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function describe(frame) {
  const { cmd, data, ok, err } = frame;
  const hx = '0x' + cmd.toString(16);
  if (!ok) return `⚠ CMD ${hx} 프레임오류(${err}) data=${data.toString('hex')}`;
  if (cmd === codec.CMD.STATUS_RPT) {   // 0x35 상태보고
    const s = codec.decodeAP005(data);
    if (s.error) return `CMD 0x35 상태보고 (디코드실패: ${s.error})`;
    return `CMD 0x35 상태보고 · 제품#${s.productNumber} · 누적생산 ${s.productionQty} · 누적검출 ${s.detectionQty} · 상태[${s.status.active.join(',') || '정상'}] · peak(ch1=${s.ch1Peak},ch2=${s.ch2Peak})`;
  }
  return `CMD ${hx} · data=${data.toString('hex')} (${data.length}B)`;
}

function runClient(host, port) {
  console.log(`[${ts()}] 접속 시도 → ${host}:${port}`);
  let buf = Buffer.alloc(0);
  const sock = new net.Socket();
  sock.setTimeout(10000);

  sock.connect(port, host, () => {
    console.log(`[${ts()}] ✅ TCP 접속 성공 — 상태조회(0x33) 전송, 3초마다 반복 (Ctrl+C 종료)`);
    const poll = () => sock.write(codec.buildFrame(codec.CMD.STATUS_REQ));
    poll();
    sock._t = setInterval(poll, 3000);
  });

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = codec.parseFrames(buf);
    buf = rest;
    for (const f of frames) console.log(`[${ts()}] ⇐ ${describe(f)}`);
  });

  sock.on('timeout', () => {
    console.log(`[${ts()}] ⏱ 응답/연결 타임아웃 — IP·포트, 네트워크 대역, 방화벽, 클라이언트격리 확인`);
  });
  sock.on('error', (e) => {
    console.log(`[${ts()}] ❌ 접속오류: ${e.code || e.message}`);
    if (e.code === 'ECONNREFUSED') console.log('   → 포트가 다르거나 검출기 TCP 서버가 대기 중이 아님');
    if (e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH') console.log('   → 다른 네트워크 대역(이중 NAT)이거나 기기 미도달');
  });
  sock.on('close', () => { if (sock._t) clearInterval(sock._t); console.log(`[${ts()}] 연결 종료`); });

  process.on('SIGINT', () => { sock.destroy(); process.exit(0); });
}

/* ── 가짜 검출기 서버: 0x33 요청받으면 0x35 상태보고로 응답 ── */
function runMock() {
  let prod = 12000, det = 34;
  const srv = net.createServer((c) => {
    console.log(`[mock] 클라이언트 접속`);
    let b = Buffer.alloc(0);
    c.on('data', (chunk) => {
      b = Buffer.concat([b, chunk]);
      const { frames, rest } = codec.parseFrames(b); b = rest;
      for (const f of frames) {
        if (f.cmd === codec.CMD.STATUS_REQ && f.ok) {
          prod += 7; if (Math.random() < 0.3) det += 1;  // 생산 증가, 가끔 검출
          const d = Buffer.alloc(12);
          d[0] = 1; d[1] = 0x00; d[2] = 90; d[3] = 0; d[4] = 70; d[5] = 0;
          d.writeUInt32BE(prod, 6); d.writeUInt16BE(det, 10);
          c.write(codec.buildFrame(codec.CMD.STATUS_RPT, d));
        }
      }
    });
  });
  srv.listen(9600, '127.0.0.1', () => {
    console.log('[mock] 가짜 검출기 127.0.0.1:9600 대기 — 다른 터미널에서: node nmd530-probe.js 127.0.0.1 9600');
  });
}

const argv = process.argv.slice(2);
if (argv.includes('--mock')) runMock();
else if (argv[0]) runClient(argv[0], Number(argv[1]) || 9600);
else {
  console.log('사용법: node nmd530-probe.js <검출기IP> [포트]   |   자체시험: node nmd530-probe.js --mock');
  process.exit(1);
}
