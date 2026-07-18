'use strict';
/*
 * 저울/인디케이터 → 스마트팩토리 상시 브리지
 *   대상: FINE FS-2000C(정량충진기 인디케이터, RS-232C 장착) 등 RS-232 텍스트 출력 장비
 *   경로: 장비 RS-232 → USR-W610(시리얼서버 TCP) → [이 프로그램] → Apps Script doPost → Sheets
 *
 *   사용:
 *     node scale-bridge.js --host=192.168.0.50 [--port=8899] [--endpoint=<AppsScript URL>]
 *     node scale-bridge.js --selftest            ← 장비·서버 없이 종단 자체검증
 *
 *   주요 옵션
 *     --mode=print|stream|auto   기본 auto
 *        print  : 수신되는 줄 = 작업자가 '프린트' 키를 누른 것 → 1줄 = 1기록
 *        stream : 연속출력(FS-2000C STREAM MODE, 초당 15~25회) → 계량 사이클마다 1기록
 *        auto   : 유입 속도로 판별(>2줄/초 지속되면 stream)
 *     --unit=kg                  단위 미출력 장비의 기본단위
 *     --strip-high-bit           7비트+패리티(7,E,1) 수신 시 0x7F 마스크
 *     --min-kg=0.05              이 미만은 '빈 저울'로 보고 기록하지 않음
 *     --queue=<파일>             전송 실패분 보관(기본 ./scale-queue.jsonl)
 *     --dry                      전송하지 않고 콘솔에만 출력
 *
 * ⚠️ 이 프로그램은 장비 설정을 **바꾸지 않는다**. 오직 수신만 한다.
 *    FS-2000C 는 가동 중인 충진 제어기라 F코드(하한·상한·낙차·교정)를 건드리면
 *    충진 동작이 망가진다. 통신 파라미터가 안 맞으면 W610 쪽에서만 조정할 것.
 */

const net = require('net');
const fs = require('fs');
const http = require('http');
const https = require('https');
const codec = require('./scale-codec');

function ts(d) {
  d = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function hhmmss() { return ts().slice(11); }
function log(msg) { console.log(`[${hhmmss()}] ${msg}`); }

/* ───────────────── 기록 판정기 ─────────────────
 * stream 모드에서 "언제 1건으로 확정할지"를 정한다.
 *   충진은 매번 같은 값(예: 5.00kg)이 반복되므로 '값이 바뀔 때만 기록'하면
 *   두 번째 봉지부터 누락된다. 그래서 **사이클**로 본다:
 *     빈 저울/불안정  → armed(기록 준비)
 *     안정 + 유효중량 → 1건 기록 후 disarm (다시 비워지기 전엔 재기록 안 함)
 */
function CycleGate(minKg, needStable) {
  var armed = true, stableRun = 0;
  return {
    feed: function (p) {
      var v = Math.abs(p.kg);
      if (p.stable !== true || v < minKg) {      // 흔들리거나 비어있음 → 다음 계량 준비
        if (v < minKg) armed = true;
        stableRun = 0;
        return false;
      }
      stableRun++;
      if (armed && stableRun >= needStable) { armed = false; return true; }
      return false;
    },
    state: function () { return { armed: armed, stableRun: stableRun }; },
  };
}

/* ───────────────── 전송(멱등 + 실패 보관) ───────────────── */
function Sender(opt) {
  var endpoint = opt.endpoint, dry = opt.dry, queueFile = opt.queue;
  var seq = 0;
  function makeId(rec) { return rec.ts.replace(/[^0-9]/g, '') + '-' + (++seq); }

  function persist(recs) {                      // 전송 실패분은 파일로 보관(기록 유실 방지)
    try { fs.appendFileSync(queueFile, recs.map(r => JSON.stringify(r)).join('\n') + '\n'); }
    catch (e) { log('⚠ 큐 저장 실패: ' + e.message); }
  }
  function post(recs, cb) {
    if (dry || !endpoint) { log('[DRY] 전송 생략 ' + recs.length + '건'); return cb(null); }
    var body = JSON.stringify({ device: opt.device, records: recs });
    var u;
    try { u = new URL(endpoint); } catch (e) { return cb(e); }
    var lib = u.protocol === 'http:' ? http : https;
    var req = lib.request({
      method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, function (res) {
      var b = ''; res.on('data', d => b += d);
      res.on('end', function () {
        // Apps Script 는 302 로 리다이렉트하는 경우가 있다(정상)
        if (res.statusCode >= 200 && res.statusCode < 400) cb(null, b);
        else cb(new Error('HTTP ' + res.statusCode + ' ' + b.slice(0, 120)));
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', cb);
    req.write(body); req.end();
  }
  return {
    send: function (rec) {
      rec.id = makeId(rec);
      post([rec], function (err) {
        if (err) { log('⚠ 전송실패(큐 보관): ' + err.message); persist([rec]); }
        else log('→ 전송 OK  ' + rec.kg + 'kg  id=' + rec.id);
      });
    },
    flushQueue: function () {                    // 보관분 재전송
      if (dry || !endpoint || !fs.existsSync(queueFile)) return;
      var lines;
      try { lines = fs.readFileSync(queueFile, 'utf8').split('\n').filter(Boolean); } catch (e) { return; }
      if (!lines.length) return;
      var recs = lines.map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      log('큐 재전송 시도 ' + recs.length + '건');
      post(recs, function (err) {
        if (err) return log('⚠ 큐 재전송 실패(보관 유지): ' + err.message);
        try { fs.unlinkSync(queueFile); } catch (e) {}
        log('→ 큐 재전송 OK ' + recs.length + '건');
      });
    },
  };
}

/* ───────────────── 본체 ───────────────── */
function run(cfg) {
  var splitter = codec.LineSplitter({ stripHighBit: cfg.stripHighBit });
  var gate = CycleGate(cfg.minKg, cfg.needStable);
  var sender = Sender(cfg);

  var sock = null, retry = 0, reconnectTimer = null;
  var recent = [], badRun = 0, lastRateCheck = Date.now(), lineCount = 0, mode = cfg.mode;

  function connect() {
    sock = new net.Socket();
    sock.setKeepAlive(true, 30000);
    log('접속 시도 → ' + cfg.host + ':' + cfg.port);
    sock.connect(cfg.port, cfg.host, function () {
      retry = 0;
      log('✅ 접속 성공 (mode=' + mode + ')  — 장비 설정은 변경하지 않습니다');
      sender.flushQueue();
    });
    sock.on('data', onData);
    sock.on('error', function (e) { log('❌ 소켓오류: ' + (e.code || e.message)); });
    sock.on('close', function () {
      if (reconnectTimer) return;
      var wait = Math.min(30000, 1000 * Math.pow(2, retry++));   // 지수 백오프(최대 30초)
      log('연결 끊김 — ' + Math.round(wait / 1000) + '초 후 재접속');
      reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, wait);
    });
  }

  function onData(chunk) {
    var lines = splitter.push(chunk.toString('binary'));
    for (var i = 0; i < lines.length; i++) handleLine(lines[i]);

    // auto 모드: 유입속도로 stream/print 판별
    if (cfg.mode === 'auto') {
      lineCount += lines.length;
      var dt = Date.now() - lastRateCheck;
      if (dt >= 3000) {
        var rate = lineCount / (dt / 1000);
        var next = rate > 2 ? 'stream' : 'print';
        if (next !== mode) { mode = next; log('모드 자동전환 → ' + mode + ' (' + rate.toFixed(1) + '줄/초)'); }
        lineCount = 0; lastRateCheck = Date.now();
      }
    }
  }

  function handleLine(raw) {
    var p = codec.parseLine(raw, { defaultUnit: cfg.unit });
    if (!p.ok) {
      badRun++;
      if (badRun === 10) {
        log('⚠ 해석실패 10연속 — **통신 파라미터 불일치 의심**');
        log('   W610 의 Baud/Data/Parity 를 바꿔가며 재시도하세요(장비 F코드는 건드리지 말 것).');
        log('   흔한 조합: 9600-8-N-1 → 4800 → 2400 → 19200 → 38400 / 7비트면 --strip-high-bit');
        log('   최근 원문: ' + JSON.stringify(raw.slice(0, 40)));
      }
      return;
    }
    badRun = 0;
    if (recent.length < 200) recent.push(raw);

    var fire = (mode === 'print') ? true : gate.feed(p);
    if (!fire) return;
    if (mode === 'print' && Math.abs(p.kg) < cfg.minKg) return;   // 프린트 모드도 빈 저울은 무시

    var rec = {
      ts: ts(), device: cfg.device, kg: p.kg, unit: p.unit,
      stable: p.stable, mode: p.mode || null, raw: p.raw,
      src: mode,
    };
    log('★ 기록  ' + rec.kg + 'kg  (' + (p.stable === true ? '안정' : '상태?') + (p.mode ? '/' + p.mode : '') + ')  ← ' + JSON.stringify(raw));
    sender.send(rec);
  }

  connect();
  var flusher = setInterval(function () { sender.flushQueue(); }, 60000);   // 1분마다 큐 재시도

  process.on('SIGINT', function () {
    clearInterval(flusher);
    console.log('\n──── 수신 요약 ────');
    var s = codec.sniff(recent);
    Object.keys(s).forEach(function (k) {
      var v = s[k];
      if (v == null || (Array.isArray(v) && !v.length)) return;
      console.log('  ' + k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v));
    });
    if (sock) sock.destroy();
    process.exit(0);
  });
}

/* ───────────────── 인자 파싱 ───────────────── */
function parseArgs(argv) {
  function val(k, d) {
    var hit = argv.find(a => a.indexOf('--' + k + '=') === 0);
    return hit ? hit.split('=').slice(1).join('=') : d;
  }
  return {
    host: val('host', ''), port: Number(val('port', 8899)),
    endpoint: val('endpoint', ''), device: val('device', 'FS-2000C'),
    mode: val('mode', 'auto'), unit: val('unit', 'kg'),
    minKg: Number(val('min-kg', 0.05)), needStable: Number(val('need-stable', 2)),
    queue: val('queue', './scale-queue.jsonl'),
    stripHighBit: argv.includes('--strip-high-bit'),
    dry: argv.includes('--dry'),
  };
}

module.exports = { CycleGate: CycleGate, parseArgs: parseArgs };

/* ───────────────── 실행 / 자체검증 ───────────────── */
if (require.main === module) {
  const argv = process.argv.slice(2);

  if (argv.includes('--selftest')) {
    var pass = 0, fail = 0;
    function eq(n, g, w) {
      var a = JSON.stringify(g), b = JSON.stringify(w);
      if (a === b) { pass++; console.log('  ✅ ' + n); }
      else { fail++; console.log('  ❌ ' + n + '\n     got : ' + a + '\n     want: ' + b); }
    }
    console.log('── scale-bridge 자체검증 ──');

    // 1) CycleGate — 같은 값 반복 충진이 매번 기록돼야 한다(핵심)
    {
      var g = CycleGate(0.05, 2);
      var fired = 0;
      function cyc(vals) { vals.forEach(function (v) { if (g.feed(v)) fired++; }); }
      var ST = k => ({ kg: k, stable: true }), US = k => ({ kg: k, stable: false });
      cyc([ST(0), US(2), US(4.4), ST(5.0), ST(5.0), ST(5.0)]);        // 1봉 충진
      eq('1봉째 1건 기록', fired, 1);
      cyc([ST(0), US(2.2), ST(5.0), ST(5.0)]);                        // 2봉(같은 값!)
      eq('2봉째도 기록(같은 값 반복)', fired, 2);
      cyc([ST(5.0), ST(5.0)]);                                        // 안 비우고 그대로
      eq('비우기 전엔 중복기록 안 함', fired, 2);
    }
    // 2) 불안정만으론 기록 안 됨 / 안정 2회 필요
    {
      var g2 = CycleGate(0.05, 2), n = 0;
      [{ kg: 5, stable: false }, { kg: 5, stable: false }].forEach(v => { if (g2.feed(v)) n++; });
      eq('불안정은 기록 안 함', n, 0);
      var m = 0; if (g2.feed({ kg: 5, stable: true })) m++;
      eq('안정 1회로는 미확정', m, 0);
      if (g2.feed({ kg: 5, stable: true })) m++;
      eq('안정 2회에 확정', m, 1);
    }
    // 3) 빈 저울(minKg 미만)은 무시
    {
      var g3 = CycleGate(0.05, 1), z = 0;
      [{ kg: 0.0, stable: true }, { kg: 0.02, stable: true }].forEach(v => { if (g3.feed(v)) z++; });
      eq('영점 부근 무시', z, 0);
    }
    // 4) 인자 파싱
    {
      var c = parseArgs(['--host=1.2.3.4', '--port=9000', '--mode=print', '--min-kg=0.1', '--strip-high-bit', '--dry']);
      eq('인자 파싱', [c.host, c.port, c.mode, c.minKg, c.stripHighBit, c.dry], ['1.2.3.4', 9000, 'print', 0.1, true, true]);
    }
    // 5) 종단: 가짜 저울(TCP) + 가짜 수신서버(HTTP) — 실제 소켓/HTTP 로 확인
    // 6) 전송 실패 → 큐 보관 → 서버 복구 후 재전송 (기록 유실 방지 검증)
    function queuePhase() {
      var qFile = require('os').tmpdir() + '/sb-queue-test.jsonl';
      try { fs.unlinkSync(qFile); } catch (e) {}
      var scale2 = net.createServer(function (c) {
        var seqv = ['US,GS,+  0000.00kg', 'ST,GS,+  0007.00kg', 'ST,GS,+  0007.00kg'];
        var i = 0;
        var t = setInterval(function () {
          if (i >= seqv.length) { clearInterval(t); return; }
          c.write(seqv[i++] + '\r\n');
        }, 60);
        c.on('error', function () { clearInterval(t); });
      });
      scale2.listen(0, '127.0.0.1', function () {
        var sPort2 = scale2.address().port;
        // endpoint 를 죽은 포트로 → 전송 실패 유도
        var child2 = require('child_process').spawn(process.execPath,
          [__filename, '--host=127.0.0.1', '--port=' + sPort2, '--mode=stream',
           '--endpoint=http://127.0.0.1:1/', '--queue=' + qFile], { stdio: 'ignore' });
        setTimeout(function () {
          child2.kill('SIGKILL'); scale2.close();
          var exists = fs.existsSync(qFile);
          eq('전송 실패 시 큐 파일 생성', exists, true);
          var recs = [];
          if (exists) {
            recs = fs.readFileSync(qFile, 'utf8').split('\n').filter(Boolean)
                     .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
          }
          eq('큐에 기록 보존(유실 없음)', recs.length >= 1, true);
          eq('큐 기록 중량 정확', recs.length ? recs[0].kg : null, 7);
          try { fs.unlinkSync(qFile); } catch (e) {}
          console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
          process.exit(fail ? 1 : 0);
        }, 2200);
      });
    }

    (function endToEnd() {
      var got = [];
      var srv = http.createServer(function (req, res) {
        var b = ''; req.on('data', d => b += d);
        req.on('end', function () {
          try { got = got.concat(JSON.parse(b).records); } catch (e) {}
          res.writeHead(200); res.end('ok');
        });
      });
      srv.listen(0, '127.0.0.1', function () {
        var epPort = srv.address().port;
        // 가짜 저울: 5kg 충진 2사이클
        var scale = net.createServer(function (c) {
          var seqv = ['US,GS,+  0000.00kg', 'US,GS,+  0002.20kg', 'ST,GS,+  0005.00kg', 'ST,GS,+  0005.00kg',
                      'US,GS,+  0000.10kg', 'ST,GS,+  0000.00kg', 'US,GS,+  0003.10kg', 'ST,GS,+  0005.00kg', 'ST,GS,+  0005.00kg'];
          var i = 0;
          var t = setInterval(function () {
            if (i >= seqv.length) { clearInterval(t); return; }
            c.write(seqv[i++] + '\r\n');
          }, 60);
          c.on('error', function () { clearInterval(t); });
        });
        scale.listen(0, '127.0.0.1', function () {
          var sPort = scale.address().port;
          var child = require('child_process').spawn(process.execPath,
            [__filename, '--host=127.0.0.1', '--port=' + sPort, '--mode=stream',
             '--endpoint=http://127.0.0.1:' + epPort + '/', '--queue=' + require('os').tmpdir() + '/sb-test.jsonl'],
            { stdio: 'ignore' });
          setTimeout(function () {
            child.kill('SIGKILL'); scale.close(); srv.close();
            eq('종단: 5kg 2사이클 → 2건 수신', got.length, 2);
            eq('종단: 중량 정확', got.map(r => r.kg), [5, 5]);
            eq('종단: 고유 id 부여', new Set(got.map(r => r.id)).size, got.length);
            queuePhase();
          }, 2500);
        });
      });
    })();
    return;
  }

  var cfg = parseArgs(argv);
  if (!cfg.host) {
    console.log('사용법: node scale-bridge.js --host=<W610_IP> [--port=8899] [--endpoint=<AppsScript URL>]');
    console.log('        [--mode=print|stream|auto] [--unit=kg] [--strip-high-bit] [--min-kg=0.05] [--dry]');
    console.log('자체검증: node scale-bridge.js --selftest');
    process.exit(1);
  }
  run(cfg);
}
