'use strict';
/*
 * NMD-530 금속검출기 프로토콜 코덱 (Ethernet TCP/IP)
 * 출처: NMD530_Packet_Define(Ethernet)_20241017.doc
 *
 * 프레임: STX(0x02) | LENGTH(2, BE) | CMD(1) | DATA(n) | ETX(0x03) | LRC(1)
 *  - LENGTH : STX~LRC 전체 바이트 수 (= 6 + dataLen)
 *  - LRC    : STX~ETX 전 바이트의 XOR
 *  - 수치 바이트 순서(host): Big-Endian  (단, 대량이력 AP.021/022 는 Little-Endian 예외 — 아래 주석)
 *
 * 이 파일은 네트워크에 의존하지 않는 순수 코덱 + 자체검증만 담는다.
 * 실제 TCP 접속/업로드는 nmd530-bridge.js 가 이 코덱을 import 해서 사용.
 */

const STX = 0x02;
const ETX = 0x03;
const ACK = 0x53; // 'S'
const NAK = 0x46; // 'F'

const CMD = {
  VERSION_REQ: 0x2a,   // PC->MD 버전정보 조회 / MD->PC 응답(AP.001)
  STATUS_REQ:  0x33,   // PC->MD 상태정보 조회
  STATUS_RPT:  0x35,   // MD->PC 상태정보 보고 (AP.005)
  HISTORY:     0x3a,   // 검출이력 조회/보고 (작업 외 시간 권장)
  HISTORY_ACK: 0x34,   // 검출이력 조회 ACK/NACK
  PRODUCT_CHG: 0x60,   // 제품변경
};

// AP.103 상태 비트 (0x01, 0x20 은 문서상 라벨 공란 → reserved 로 노출)
const STATUS_BITS = [
  { mask: 0x01, key: 'bit0',        label: '(예약0x01)' },
  { mask: 0x02, key: 'outError',    label: 'Out error' },
  { mask: 0x04, key: 'balError',    label: 'Bal error' },
  { mask: 0x08, key: 'testMode',    label: '테스트 모드' },
  { mask: 0x10, key: 'dualFreq',    label: '듀얼 주파수' },
  { mask: 0x20, key: 'bit5',        label: '(예약0x20)' },
];

function lrcOf(buf, endInclusive) {
  let x = 0;
  for (let i = 0; i <= endInclusive; i++) x ^= buf[i];
  return x;
}

/** CMD + DATA 로 완전한 프레임 버퍼 생성 */
function buildFrame(cmd, data) {
  data = data || Buffer.alloc(0);
  const total = 6 + data.length;          // STX+LEN(2)+CMD+DATA+ETX+LRC
  const buf = Buffer.alloc(total);
  buf[0] = STX;
  buf.writeUInt16BE(total, 1);
  buf[3] = cmd & 0xff;
  data.copy(buf, 4);
  const etxPos = 4 + data.length;
  buf[etxPos] = ETX;
  buf[etxPos + 1] = lrcOf(buf, etxPos);   // LRC = XOR(STX..ETX)
  return buf;
}

/**
 * 스트림 버퍼에서 완전한 프레임을 최대한 추출.
 * @returns {{frames: Array<{cmd:number,data:Buffer,ok:boolean,err?:string}>, rest: Buffer}}
 */
function parseFrames(buffer) {
  const frames = [];
  let off = 0;
  while (off < buffer.length) {
    // STX 동기화: STX 아닌 바이트는 버림(노이즈 방어)
    if (buffer[off] !== STX) { off++; continue; }
    if (buffer.length - off < 6) break;               // LENGTH 까지 못 읽음 → 대기
    const total = buffer.readUInt16BE(off + 1);
    if (total < 6 || total > 65535) { off++; continue; } // 비정상 LENGTH → 1바이트 밀고 재동기
    if (buffer.length - off < total) break;           // 프레임 미완성 → 다음 수신 대기
    const frame = buffer.subarray(off, off + total);
    const cmd = frame[3];
    const data = frame.subarray(4, total - 2);
    const etxPos = total - 2;
    let ok = true, err;
    if (frame[etxPos] !== ETX) { ok = false; err = 'ETX 불일치'; }
    else if (frame[total - 1] !== lrcOf(frame, etxPos)) { ok = false; err = 'LRC 불일치'; }
    frames.push({ cmd, data: Buffer.from(data), ok, err });
    off += total;
  }
  return { frames, rest: Buffer.from(buffer.subarray(off)) };
}

function decodeStatus(byte) {
  const flags = {};
  const active = [];
  for (const b of STATUS_BITS) {
    const on = (byte & b.mask) !== 0;
    flags[b.key] = on;
    if (on) active.push(b.label);
  }
  return { raw: byte, flags, active };
}

/** AP.005 Report content (상태 보고, Big-Endian) — 12바이트 */
function decodeAP005(data) {
  if (data.length < 12) return { error: `AP.005 길이 부족(${data.length}<12)` };
  return {
    productNumber:     data[0],
    status:            decodeStatus(data[1]),
    ch1Peak:           data[2],
    ch2Peak:           data[3],
    ch1DetectLevel:    data[4],
    ch2DetectLevel:    data[5],
    productionQty:     data.readUInt32BE(6),   // 누적 생산수량
    detectionQty:      data.readUInt16BE(10),  // 누적 검출(리젝트)수량
  };
}

const LOG_TYPE = { 0: 'detect', 1: 'reverse', 2: 'power_on' };

/** 6바이트 시각 (YY MM DD HH MM SS, 2000+YY) → KST ISO 문자열 */
function decodeTime6(d, o) {
  const yy = d[o], mm = d[o + 1], dd = d[o + 2], hh = d[o + 3], mi = d[o + 4], ss = d[o + 5];
  const pad = n => String(n).padStart(2, '0');
  return `20${pad(yy)}-${pad(mm)}-${pad(dd)} ${pad(hh)}:${pad(mi)}:${pad(ss)}`;
}

/** AP.023 Report content3 (검출 로그 1건, Big-Endian) — 17바이트 */
function decodeAP023(data) {
  if (data.length < 17) return { error: `AP.023 길이 부족(${data.length}<17)` };
  return {
    subCommand:    data[0],                       // 0x3 고정
    logType:       LOG_TYPE[data[1]] || `unknown(${data[1]})`,
    productNumber: data[2],
    detectingTime: decodeTime6(data, 3),
    detectingCount: data.readUInt16BE(9),         // 검출 카운트
    productCount:  (data[11] << 16) | (data[12] << 8) | data[13], // 3바이트 BE
    // data[14..16] = NULL
  };
}

module.exports = {
  STX, ETX, ACK, NAK, CMD, STATUS_BITS,
  lrcOf, buildFrame, parseFrames,
  decodeStatus, decodeAP005, decodeAP023, decodeTime6,
};

/* ─────────────────────────── 자체검증 ─────────────────────────── */
if (require.main === module && process.argv.includes('--selftest')) {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    const g = Buffer.isBuffer(got) ? got.toString('hex') : JSON.stringify(got);
    const w = Buffer.isBuffer(want) ? want.toString('hex') : JSON.stringify(want);
    if (g === w) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}\n     got : ${g}\n     want: ${w}`); }
  };

  console.log('── NMD-530 코덱 자체검증 ──');

  // 1) 문서의 구체 예시: 상태조회 커맨드 = 02 00 06 33 03 34
  eq('상태조회(0x33) 프레임 == 문서예시 02 00 06 33 03 34',
     buildFrame(CMD.STATUS_REQ), Buffer.from([0x02, 0x00, 0x06, 0x33, 0x03, 0x34]));

  // 2) LRC 함수 단독 검증 (02^00^06^33^03 = 0x34)
  eq('LRC(STX..ETX) = 0x34', lrcOf(Buffer.from([0x02, 0x00, 0x06, 0x33, 0x03]), 4), 0x34);

  // 3) build → parse 라운드트립 (임의 DATA)
  {
    const payload = Buffer.from([0x01, 0x02, 0xAB, 0xCD]);
    const f = buildFrame(0x35, payload);
    const { frames, rest } = parseFrames(f);
    eq('라운드트립: 프레임 1개', frames.length, 1);
    eq('라운드트립: ok', frames[0] && frames[0].ok, true);
    eq('라운드트립: cmd', frames[0] && frames[0].cmd, 0x35);
    eq('라운드트립: data', frames[0] && frames[0].data, payload);
    eq('라운드트립: 잔여 0', rest.length, 0);
  }

  // 4) 분할 수신 + 연접(2프레임) 스트림 처리
  {
    const a = buildFrame(0x33);
    const b = buildFrame(0x35, Buffer.from([9, 9, 9]));
    const stream = Buffer.concat([a, b]);
    // 4-1) 한 번에 다 옴
    eq('연접: 2프레임 추출', parseFrames(stream).frames.length, 2);
    // 4-2) 프레임 경계에서 잘려 도착 (a + b의 앞 2바이트만)
    const cut = parseFrames(Buffer.concat([a, b.subarray(0, 2)]));
    eq('분할: 완성분 1개만', cut.frames.length, 1);
    eq('분할: 잔여 = b 앞부분', cut.rest, b.subarray(0, 2));
    // 4-3) 잔여 + 나머지 이어붙이면 두번째 완성
    const cont = parseFrames(Buffer.concat([cut.rest, b.subarray(2)]));
    eq('분할이어받기: 2번째 완성', cont.frames.length, 1);
    eq('분할이어받기: data', cont.frames[0].data, Buffer.from([9, 9, 9]));
  }

  // 5) LRC 손상 프레임 검출
  {
    const f = buildFrame(0x35, Buffer.from([1, 2, 3]));
    f[f.length - 1] ^= 0xff; // LRC 훼손
    const { frames } = parseFrames(f);
    eq('LRC 손상 → ok=false', frames[0].ok, false);
    eq('LRC 손상 → err', frames[0].err, 'LRC 불일치');
  }

  // 6) 선행 노이즈 바이트 재동기화
  {
    const f = buildFrame(0x33);
    const noisy = Buffer.concat([Buffer.from([0xff, 0x00, 0x99]), f]);
    const { frames } = parseFrames(noisy);
    eq('노이즈 후 재동기: 프레임 추출', frames.length, 1);
    eq('노이즈 후 재동기: ok', frames[0].ok, true);
  }

  // 7) AP.005 상태보고 디코드 (합성 12바이트)
  {
    const d = Buffer.alloc(12);
    d[0] = 5;                    // product number
    d[1] = 0x02 | 0x08;          // Out error + 테스트모드
    d[2] = 100; d[3] = 0; d[4] = 80; d[5] = 0;
    d.writeUInt32BE(123456, 6);  // 누적 생산 (00 01 E2 40, BE)
    d.writeUInt16BE(1234, 10);   // 누적 검출 (04 D2, BE)
    const r = decodeAP005(d);
    eq('AP.005 productNumber', r.productNumber, 5);
    eq('AP.005 productionQty', r.productionQty, 123456);
    eq('AP.005 detectionQty', r.detectionQty, 1234);
    eq('AP.005 status.outError', r.status.flags.outError, true);
    eq('AP.005 status.testMode', r.status.flags.testMode, true);
    eq('AP.005 status.balError', r.status.flags.balError, false);
  }

  // 8) AP.023 검출로그 디코드 (문서 예시값: 2020/1/15 5:20:30, count 1234, product 123456)
  {
    const d = Buffer.alloc(17);
    d[0] = 0x3;                  // sub command
    d[1] = 0x0;                  // LOG TYPE detect
    d[2] = 7;                    // product number
    [0x14, 0x1, 0xF, 0x5, 0x14, 0x1E].forEach((v, i) => d[3 + i] = v); // 시각
    d.writeUInt16BE(1234, 9);    // 04 D2
    d[11] = 0x01; d[12] = 0xE2; d[13] = 0x40; // 123456 (3바이트 BE)
    const r = decodeAP023(d);
    eq('AP.023 logType', r.logType, 'detect');
    eq('AP.023 detectingTime', r.detectingTime, '2020-01-15 05:20:30');
    eq('AP.023 detectingCount', r.detectingCount, 1234);
    eq('AP.023 productCount', r.productCount, 123456);
  }

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
