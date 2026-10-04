'use strict';
/*
 * NMD-530 금속검출기 → 스마트팩토리 상시 수집기 (계약서 docs/NMD530_PIPELINE.md §3~§5·§8·§11)
 *   경로: 검출기 TCP(192.168.0.5:8000) → [이 프로그램] → Apps Script doPost → 시트
 *
 *   사용:
 *     node nmd530-bridge.js --endpoint <URL> [--host 192.168.0.5] [--port 8000] [--device NMD530-1]
 *     토큰은 환경변수 NMD530_TOKEN 또는 --config JSON 으로만 준다(플래그 금지: 프로세스 목록에 노출).
 *     node nmd530-bridge.js --dry ...        전송 대신 표준출력(스풀·상태 파일을 쓰지 않음)
 *     node nmd530-bridge.js --selftest       가짜 검출기 + 가짜 웹앱으로 종단 자체검증(약 15초)
 *
 * ⚠️ 검출기로는 상태조회(0x33)·버전조회(0x2A)만 보낸다. 제품변경(0x60)·대량이력(0x3A) 등은
 *    sendCmd 가 예외로 막는다 — 가동 중인 검출기의 설정·이력을 건드리지 않기 위해서다.
 *    검출기는 TCP 접속이 1개뿐이므로 nmd530-probe.js 와 동시에 돌리지 않는다.
 */

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const codec = require('./nmd530-codec');
const { createCounter, kstIso } = require('./nmd530-counter');

const VERSION = '1.0.0';
const COLLECTOR = 'nmd530-bridge/' + VERSION;
const ALLOWED_CMDS = new Set([0x33, 0x2A]); // 허용 명령은 리터럴 — codec 상수와 어긋나면 start() 가 throw
const MAX_PENDING = 3;       // 미응답 요청 상한
const BATCH_MAX = 50;        // 한 번에 보낼 이벤트 수 (계약서 §5)
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_KEEP = 3;          // bridge.log, .1, .2

/** codec 의 상태조회·버전조회 상수가 허용 목록 리터럴과 같은지 단언한다(다르면 throw) */
function checkCmdConstants(cmd) {
  if (!cmd || cmd.STATUS_REQ !== 0x33 || cmd.VERSION_REQ !== 0x2A) throw new Error('codec 명령 상수가 허용 목록 {0x33, 0x2A} 와 다르다');
}

/* ───────────────── 설정 ───────────────── */
const DEFAULTS = {
  host: '192.168.0.5', port: 8000, device: 'NMD530-1',
  intervalMs: 3000, heartbeatMs: 60000, downAfterMs: 30000,
  stateDir: path.join(__dirname, 'nmd530-data'), endpoint: '', token: '',
};
const VALUE_FLAGS = {
  '--config': 'config', '--host': 'host', '--port': 'port', '--endpoint': 'endpoint', '--device': 'device',
  '--interval': 'intervalMs', '--heartbeat': 'heartbeatMs', '--down-after': 'downAfterMs', '--state-dir': 'stateDir',
};
const BOOL_FLAGS = { '--dry': 'dry', '--selftest': 'selftest', '--version': 'version' };
const NUM_KEYS = ['port', 'intervalMs', 'heartbeatMs', 'downAfterMs'];

/** 우선순위: 플래그 > 환경변수(NMD530_ENDPOINT·NMD530_TOKEN) > --config JSON > 기본값. 알 수 없는 플래그(--token 포함)는 거부. */
/** 이벤트 id(device|bootId|seq)가 80자를 넘지 않게 device 는 1~40자·공백 없는 문자열 */
function checkDevice(device) {
  if (typeof device !== 'string' || !/^\S{1,40}$/.test(device)) throw new Error('device 는 공백 없는 1~40자 문자열이어야 한다(--device)');
}

function parseConfig(argv, env, readFile) {
  env = env || {};
  readFile = readFile || (p => fs.readFileSync(p, 'utf8'));
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.indexOf('=');
    const name = eq > 0 ? raw.slice(0, eq) : raw;       // 오류 메시지에 값은 싣지 않는다(토큰 노출 방지)
    if (BOOL_FLAGS[name]) { flags[BOOL_FLAGS[name]] = true; continue; }
    if (VALUE_FLAGS[name]) {
      let v;
      if (eq > 0) v = raw.slice(eq + 1);
      else { v = argv[++i]; if (v === undefined) throw new Error('값이 없는 플래그: ' + name); }
      flags[VALUE_FLAGS[name]] = v;
      continue;
    }
    throw new Error('알 수 없는 플래그: ' + name + (name === '--token' ? ' (토큰은 환경변수 NMD530_TOKEN 또는 --config 로만 받는다)' : ''));
  }
  let file = {};
  if (flags.config) {
    // 오류 메시지에 파일 내용·JSON 조각을 싣지 않는다(토큰 노출 방지) — 원인 코드만
    let text;
    try { text = readFile(flags.config); } catch (e) { throw new Error('--config 를 읽지 못함: ' + (e && e.code ? e.code : '읽기 오류')); }
    try { file = JSON.parse(text); } catch (e) { throw new Error('--config 를 읽지 못함: JSON 해석 실패'); }
    if (!file || typeof file !== 'object') file = {};
  }
  const cfg = Object.assign({}, DEFAULTS);
  const layers = [file, { endpoint: env.NMD530_ENDPOINT, token: env.NMD530_TOKEN }, flags];
  for (const layer of layers) {
    for (const k of Object.keys(DEFAULTS)) {
      if (layer[k] !== undefined && layer[k] !== null && layer[k] !== '') cfg[k] = layer[k];
    }
  }
  for (const k of NUM_KEYS) {
    cfg[k] = Number(cfg[k]);
    if (!isFinite(cfg[k]) || cfg[k] <= 0) throw new Error('숫자 설정 오류: ' + k);
  }
  checkDevice(cfg.device);
  cfg.dry = !!flags.dry; cfg.selftest = !!flags.selftest; cfg.version = !!flags.version;
  return cfg;
}

/* ───────────────── 수집기 본체 ───────────────── */
function createBridge(o) {
  const cfg = Object.assign({}, DEFAULTS, o);
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const out = o.out || (s => process.stdout.write(s + '\n'));
  const reconnectMinMs = o.reconnectMinMs || 1000, reconnectMaxMs = o.reconnectMaxMs || 30000;
  const sendRetryMinMs = o.sendRetryMinMs || 5000, sendRetryMaxMs = o.sendRetryMaxMs || 300000;
  const postTimeoutMs = o.postTimeoutMs || 20000, echoTimeoutMs = o.echoTimeoutMs || 20000;
  const dry = !!o.dry;

  checkDevice(cfg.device);
  if (!dry) {
    if (!cfg.endpoint) throw new Error('endpoint 가 필요하다(--endpoint 또는 NMD530_ENDPOINT)');
    if (!cfg.token) throw new Error('token 이 필요하다(NMD530_TOKEN 또는 --config)');
  }

  const stateDir = path.resolve(cfg.stateDir);
  const P = {
    state: path.join(stateDir, 'state.json'), spool: path.join(stateDir, 'spool.jsonl'),
    rejected: path.join(stateDir, 'rejected.jsonl'),
    log: path.join(stateDir, 'bridge.log'), lock: path.join(stateDir, 'bridge.lock'),
  };
  const stats = { emitted: 0, sent: 0, failures: 0 };
  const active = new Set();               // 진행 중인 HTTP 요청(종료 때 끊는다)
  let counter = null, spool = [], dryPrinted = new Set();
  let sock = null, connected = false, rxbuf = Buffer.alloc(0), pending = 0;
  let pollTimer = null, hbTimer = null, reconnectTimer = null, retryTimer = null, connectTimer = null;
  let reconnectDelay = 0, retryDelay = 0, sending = false, stopped = false, started = false, logSize = 0;

  /* ── 로그 (1 MB × 3 회전) ── */
  function log(msg) {
    const line = '[' + kstIso(now()) + '] ' + msg;
    if (!o.quiet) out(line);
    try {
      const buf = line + '\n';
      fs.appendFileSync(P.log, buf);
      logSize += Buffer.byteLength(buf);
      if (logSize >= LOG_MAX_BYTES) rotateLog();
    } catch (e) { /* 로그 실패로 수집을 멈추지 않는다 */ }
  }
  function rotateLog() {
    try {
      for (let i = LOG_KEEP - 1; i >= 1; i--) {
        const from = i === 1 ? P.log : P.log + '.' + (i - 1), to = P.log + '.' + i;
        if (i === LOG_KEEP - 1) { try { fs.unlinkSync(to); } catch (e) {} }
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      logSize = 0;
    } catch (e) { /* 회전 실패는 다음 기회에 */ }
  }

  /* ── 잠금 (PID) ── */
  function pidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }
  function acquireLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(P.lock, String(process.pid), { flag: 'wx' });
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let pid = NaN, mtime = 0;
        try { pid = parseInt(fs.readFileSync(P.lock, 'utf8'), 10); mtime = fs.statSync(P.lock).mtimeMs; } catch (e2) {}
        // 재부팅 전에 만들어진 잠금은 PID 가 다른 프로세스에 재사용됐을 수 있어 낡은 것으로 본다
        const beforeBoot = mtime && mtime < Date.now() - os.uptime() * 1000;
        if (pid > 0 && pidAlive(pid) && !beforeBoot) {
          const err = new Error('이미 다른 수집기가 실행 중(PID ' + pid + ') — 종료한다');
          err.code = 'ELOCKED';
          throw err;
        }
        try { fs.unlinkSync(P.lock); } catch (e3) {}
      }
    }
    const err = new Error('잠금을 얻지 못함'); err.code = 'ELOCKED'; throw err;
  }
  function releaseLock() {
    try {
      if (parseInt(fs.readFileSync(P.lock, 'utf8'), 10) === process.pid) fs.unlinkSync(P.lock);
    } catch (e) {}
  }

  /* ── 상태·스풀 파일 (원자 저장 / 쓰기 선행) ── */
  function atomicWrite(file, text) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }
  function saveState() {
    if (!counter || dry) return;   // --dry 는 상태 파일을 쓰지 않는다
    const s = counter.snapshot();
    try {
      atomicWrite(P.state, JSON.stringify({
        lastTotal: s.lastTotal, lastValidAt: s.lastValidAt, seq: s.seq, down: s.down, downSince: s.downSince,
      }));
    } catch (e) { log('⚠ state.json 저장 실패: ' + e.message); }
  }
  const numOrNull = v => v === undefined || v === null || (typeof v === 'number' && isFinite(v));
  /** 상태 파일이 없으면 {} (첫 실행). 깨졌으면 state.json.corrupt-<KST 시각> 으로 보존하고 크게 알린 뒤 {} */
  function loadState() {
    let text;
    try { text = fs.readFileSync(P.state, 'utf8'); } catch (e) { return {}; }
    let st = null;
    try { st = JSON.parse(text); } catch (e) { st = null; }
    const valid = st && typeof st === 'object' && !Array.isArray(st) &&
      numOrNull(st.lastTotal) && numOrNull(st.lastValidAt) && numOrNull(st.seq) && !(typeof st.seq === 'number' && st.seq < 0);
    if (valid) return st;
    const keep = P.state + '.corrupt-' + kstIso(now()).slice(0, 19).replace(/[-:]/g, '');
    let moved = '';
    if (!dry) { try { fs.renameSync(P.state, keep); moved = ' → ' + path.basename(keep) + ' 로 보존'; } catch (e) { moved = ' (보존 실패: ' + (e.code || e.message) + ')'; } }
    log('⚠⚠ state.json 이 깨져 있다' + moved + ' — 첫 관측으로 시작한다(그 사이 검출은 미관측)');
    return {};
  }
  function loadSpool() {
    let text = '';
    try {
      const buf = fs.readFileSync(P.spool);
      // 마지막 바이트가 줄바꿈이 아니면(전원 차단으로 잘림) 줄바꿈을 붙여, 이후 append 가 그 줄에 이어붙지 않게 한다
      if (buf.length && buf[buf.length - 1] !== 0x0a) {
        if (!dry) fs.appendFileSync(P.spool, '\n');
        log('⚠ 스풀 마지막 줄이 줄바꿈 없이 끝나 있어 줄바꿈을 붙여 복구');
      }
      text = buf.toString('utf8');
    } catch (e) { return []; }
    const list = [];
    for (const l of text.split('\n')) {
      if (!l) continue;
      try { list.push(JSON.parse(l)); } catch (e) { log('⚠ 스풀의 깨진 줄 건너뜀(전원 차단 중 쓰던 줄)'); }
    }
    return list;
  }
  function rewriteSpool() {
    atomicWrite(P.spool, spool.map(e => JSON.stringify(e)).join('\n') + (spool.length ? '\n' : ''));
  }

  /** 비정상 종료 복구: 스풀 끝 이벤트가 상태보다 앞서 있으면(seq 가 더 크면) 상태를 스풀 기준으로 끌어올린다 */
  function reconcileState(st, list) {
    const ev = list[list.length - 1];
    if (!ev || typeof ev.id !== 'string') return st;
    const evSeq = parseInt(ev.id.split('|').pop(), 10);
    const stSeq = typeof st.seq === 'number' ? st.seq : 0;
    if (!(evSeq > stSeq)) return st;
    const next = Object.assign({}, st, { seq: evSeq });
    if (typeof ev.total === 'number' && isFinite(ev.total)) {
      next.lastTotal = ev.total;
      const at = Date.parse(ev.t);
      if (isFinite(at) && !(typeof st.lastValidAt === 'number' && st.lastValidAt > at)) next.lastValidAt = at;
    }
    log('⚠ 상태가 스풀보다 뒤처져 있어 스풀 기준으로 맞춤(seq ' + stSeq + ' → ' + evSeq + ')');
    return next;
  }

  /** 이벤트를 스풀에 먼저 적고(쓰기 선행) 그 다음에 상태를 저장한다 */
  function emit(events) {
    if (!events.length) return;
    if (!dry) fs.appendFileSync(P.spool, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    for (const e of events) {
      spool.push(e); stats.emitted++;
      log('이벤트 ' + e.kind + (e.n != null ? ' n=' + e.n : '') + (e.total != null ? ' total=' + e.total : '') + ' id=' + e.id);
    }
    saveState();
  }

  /* ── 검출기 TCP ── */
  /** 허용 목록 {0x33, 0x2A} 밖이면 예외. 접속 중이 아니면 false */
  function sendCmd(cmd) {
    if (!ALLOWED_CMDS.has(cmd)) throw new Error('허용되지 않은 검출기 명령: 0x' + Number(cmd).toString(16));
    if (!sock || !connected) return false;
    sock.write(codec.buildFrame(cmd));
    return true;
  }
  function sendPoll() {
    if (!connected || pending >= MAX_PENDING) return;
    if (sendCmd(codec.CMD.STATUS_REQ)) pending++;
  }
  function connect() {
    if (stopped || sock) return;
    const s = new net.Socket();
    sock = s; connected = false; rxbuf = Buffer.alloc(0); pending = 0;
    s.setNoDelay(true);
    connectTimer = setTimeout(() => s.destroy(new Error('접속 시간 초과')), 5000);
    s.on('connect', () => {
      clearTimeout(connectTimer); connected = true;   // 백오프는 여기서 되돌리지 않는다 — TCP 만 붙고 침묵하는 장비에 1초 간격으로 매달리지 않게 첫 유효 응답에서 되돌린다
      log('✅ 검출기 접속 ' + cfg.host + ':' + cfg.port);
      sendPoll();
    });
    s.on('data', onData);
    s.on('error', e => log('❌ 소켓 오류: ' + (e.code || e.message)));
    s.on('close', () => {
      clearTimeout(connectTimer);
      if (sock === s) { sock = null; connected = false; }
      scheduleReconnect();
    });
    s.connect(cfg.port, cfg.host);
  }
  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectDelay = reconnectDelay ? Math.min(reconnectDelay * 2, reconnectMaxMs) : reconnectMinMs;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, reconnectDelay);
  }
  function onData(chunk) {
    rxbuf = Buffer.concat([rxbuf, chunk]);
    const r = codec.parseFrames(rxbuf);
    rxbuf = r.rest.length > 4096 ? Buffer.alloc(0) : r.rest;
    for (const f of r.frames) {
      pending = Math.max(0, pending - 1);   // 깨진·낯선 프레임도 무언가에 대한 답이다 — 세지 않으면 미응답이 쌓여 폴링이 영영 멎는다
      if (!f.ok) { log('⚠ 프레임 오류(' + f.err + ')'); continue; }
      if (f.cmd !== codec.CMD.STATUS_RPT) continue;
      const d = codec.decodeAP005(f.data);
      if (d.error) { log('⚠ 0x35 해석 실패: ' + d.error); continue; }
      reconnectDelay = 0;                   // 첫 유효 응답: 재접속 백오프를 처음으로
      // 어느 요청의 응답인지 가리지 않고 모든 유효 프레임을 같은 규칙으로 처리한다(누적값은 단조 증가)
      const evs = counter.onValid({
        t: now(), total: d.detectionQty, product: d.productNumber, ch1: d.ch1Peak, ch2: d.ch2Peak,
        flags: Object.keys(d.status.flags).filter(k => d.status.flags[k]),
      });
      if (evs.length) emit(evs); else saveState();
    }
  }
  function tick() {
    const evs = counter.onTick(now());
    if (evs.length) {
      emit(evs);
      if (sock) { log('유효 응답 없음 — 연결을 끊고 재접속'); sock.destroy(); }
    } else if (counter.redial(now()) && sock) {
      // 끊김이 이어지는 동안 downAfterMs 마다 다시 파기 — 재접속한 소켓이 TCP 만 붙고 침묵해도 머물지 않는다(이벤트는 늘지 않는다)
      log('끊김 지속 — 연결을 다시 끊고 재접속'); sock.destroy();
    }
    sendPoll();
  }

  /* ── 전송 ── */
  function httpOnce(urlStr, opt) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(urlStr); } catch (e) { return reject(new Error('주소 형식 오류')); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('http/https 주소만 쓴다'));
      const lib = u.protocol === 'http:' ? http : https;
      const headers = opt.body != null
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(opt.body) } : {};
      let done = false, timer = null;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
      const req = lib.request({
        method: opt.method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers,
      }, res => {                                  // 리다이렉트를 따라가지 않는다 — 호출자가 직접 처리
        const chunks = []; let size = 0;
        res.on('data', c => { size += c.length; if (size > 1048576) req.destroy(new Error('응답이 너무 큼')); else chunks.push(c); });
        res.on('end', () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', e => finish(reject, e));
        res.on('close', () => finish(reject, new Error('응답 도중 끊김')));
      });
      active.add(req);
      req.on('close', () => active.delete(req));
      req.on('error', e => finish(reject, e));
      timer = setTimeout(() => req.destroy(new Error('시간 초과')), opt.timeoutMs);
      if (opt.body != null) req.write(opt.body);
      req.end();
    });
  }
  /** 확인됨(JSON ok:true)일 때만 응답 객체를 돌려주고, 그 밖에는 예외 */
  async function transmit(payload) {
    const r = await httpOnce(cfg.endpoint, { method: 'POST', body: JSON.stringify(payload), timeoutMs: postTimeoutMs });
    let text;
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      // Apps Script 는 doPost 가 끝난 뒤 302 를 준다 — Location 을 GET 한 번만 읽는다(두 번째부터는 읽히지 않는다)
      let loc;
      try { loc = new URL(r.headers.location, cfg.endpoint).href; } catch (e) { throw new Error('Location 형식 오류'); }
      const g = await httpOnce(loc, { method: 'GET', timeoutMs: echoTimeoutMs });
      if (g.status !== 200) throw new Error('결과 주소 HTTP ' + g.status);
      text = g.body;
    } else if (r.status === 200) {
      text = r.body;
    } else {
      throw new Error('HTTP ' + r.status);
    }
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error('응답이 JSON 이 아님(확인 실패)'); }
    if (!j || j.ok !== true) throw new Error('서버 거부: ' + (j && typeof j.error === 'string' ? j.error.slice(0, 40) : '알 수 없음'));
    return j;
  }
  function status() {
    const s = counter.snapshot();
    return {
      link: s.link, total: s.lastTotal, product: s.product, flags: s.flags,
      lastValidAt: s.lastValidAt == null ? null : kstIso(s.lastValidAt),
      downSince: s.downSince == null ? null : kstIso(s.downSince),
      spool: spool.length, bootAt: kstIso(s.startedAt),
    };
  }
  function scheduleRetry() {
    retryDelay = retryDelay ? Math.min(retryDelay * 2, sendRetryMaxMs) : sendRetryMinMs;
    retryTimer = setTimeout(() => { retryTimer = null; flush(); }, retryDelay);
  }
  /** heartbeat: status 와 대기 이벤트(≤50)를 함께 보낸다. 실패하면 스풀 유지 + 백오프 */
  async function flush() {
    if (stopped || sending || retryTimer) return;
    sending = true;
    try {
      for (;;) {
        const batch = spool.slice(0, BATCH_MAX);
        const payload = {
          v: 1, token: cfg.token, device: cfg.device, host: os.hostname(), collector: COLLECTOR,
          sentAt: kstIso(now()), events: batch, status: status(),
        };
        if (dry) {
          const fresh = batch.filter(e => !dryPrinted.has(e.id));
          fresh.forEach(e => dryPrinted.add(e.id));
          out('[DRY] ' + JSON.stringify(Object.assign({}, payload, { token: '<생략>', events: fresh })));
          return;
        }
        let res;
        try { res = await transmit(payload); }
        catch (e) {
          if (stopped) return;
          stats.failures++;
          log('⚠ 전송 미확인(스풀 유지 ' + spool.length + '건, 같은 ID 로 재전송): ' + e.message);
          scheduleRetry();
          return;
        }
        retryDelay = 0;
        // 서버가 형식 오류로 거른 이벤트(badIdx)는 재전송해도 소용없다 — 죽은 편지함에 보관하고 스풀에서 뺀다(범위 밖 위치는 무시)
        const badAt = Array.isArray(res.badIdx)
          ? [...new Set(res.badIdx.filter(i => Number.isInteger(i) && i >= 0 && i < batch.length))] : [];
        if (badAt.length) {
          try {
            const at = kstIso(now());
            fs.appendFileSync(P.rejected, badAt.map(i => JSON.stringify({ at, ev: batch[i] })).join('\n') + '\n');
          } catch (e) {
            log('⚠ rejected.jsonl 쓰기 실패(스풀 유지): ' + (e.code || e.message));
            scheduleRetry();
            return;
          }
          log('⚠ 서버가 거른 이벤트 ' + badAt.length + '건 → rejected.jsonl');
        }
        stats.sent += batch.length - badAt.length;
        const gone = new Set(batch.map(e => e.id));
        spool = spool.filter(e => !gone.has(e.id));
        try { rewriteSpool(); } catch (e) { log('⚠ 스풀 정리 실패: ' + e.message); }
        if (batch.length) log('→ 전송 확인 ' + batch.length + '건 (saved=' + res.saved + ' dup=' + res.dup + ' bad=' + res.bad + ')');
        const unlocated = (Number.isInteger(res.bad) ? res.bad : 0) - badAt.length;
        if (unlocated > 0) log('⚠ 서버가 형식 오류로 거른 이벤트 중 위치(badIdx)를 모르는 것 ' + unlocated + '건 — rejected.jsonl 에 남기지 못함');
        if (!spool.length) return;
      }
    } finally { sending = false; }
  }

  /* ── 수명 ── */
  function start() {
    if (started) throw new Error('이미 시작됨');
    fs.mkdirSync(stateDir, { recursive: true });
    acquireLock();
    try { checkCmdConstants(codec.CMD); } catch (e) { releaseLock(); throw e; }
    started = true;
    try { logSize = fs.statSync(P.log).size; } catch (e) { logSize = 0; }
    const t0 = now();
    spool = loadSpool();
    counter = createCounter({ downAfterMs: cfg.downAfterMs, state: reconcileState(loadState(), spool), device: cfg.device, now });
    log('수집기 ' + VERSION + ' 시작 · 기기=' + cfg.device + ' · 검출기=' + cfg.host + ':' + cfg.port +
      ' · 대기 이벤트 ' + spool.length + '건' + (dry ? ' · DRY' : ''));
    connect();
    pollTimer = setInterval(tick, cfg.intervalMs);
    hbTimer = setInterval(flush, cfg.heartbeatMs);
    flush();
    return api;
  }
  async function stop() {
    if (stopped || !started) { stopped = true; return; }
    stopped = true;
    clearInterval(pollTimer); clearInterval(hbTimer);
    clearTimeout(reconnectTimer); clearTimeout(retryTimer); clearTimeout(connectTimer);
    for (const r of active) r.destroy();
    if (sock) sock.destroy();
    saveState();
    log('수집기 종료');
    releaseLock();
  }

  const api = {
    start, stop, sendCmd, flush, stats,
    snapshot: () => Object.assign(counter ? counter.snapshot() : {}, { spool: spool.length }),
    config: Object.assign({}, cfg, { token: cfg.token ? '***' : '' }),
    paths: P,
  };
  return api;
}

/* ───────────────── 시험 도구 (--selftest · tests/nmd530-bridge.test.js 가 쓴다) ───────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(15); }
  return !!fn();
}

/** 가짜 검출기: 받은 바이트를 전부 기록하고, 지연·몰아서 보내기·무응답·끊기를 제어한다 */
function createFakeDetector() {
  let count = 0, client = null, muted = false, hold = false, corrupt = false, delay = 0, conns = 0;
  const queue = [];
  const rx = [];                       // 받은 원시 바이트(모든 청크)
  const cmds = [];                     // 받은 프레임의 CMD 바이트
  const srv = net.createServer(c => {
    conns++;
    if (client) client.destroy();      // 실제 장비처럼 접속 1개만
    client = c;
    let b = Buffer.alloc(0);
    c.on('data', ch => {
      rx.push(Buffer.from(ch));
      b = Buffer.concat([b, ch]);
      const r = codec.parseFrames(b); b = r.rest;
      for (const f of r.frames) {
        cmds.push(f.cmd);
        if (f.cmd !== codec.CMD.STATUS_REQ || muted) continue;
        const d = Buffer.alloc(12);
        d[0] = 1; d[2] = 90; d[4] = 70; d.writeUInt16BE(count, 10);
        const buf = codec.buildFrame(codec.CMD.STATUS_RPT, d);
        if (corrupt) buf[buf.length - 1] ^= 0xFF;   // LRC 만 깨뜨린 응답(명령·데이터는 정상 모양)
        if (hold) queue.push({ c, buf });
        else if (delay) setTimeout(() => { if (!c.destroyed) c.write(buf); }, delay);
        else c.write(buf);
      }
    });
    c.on('error', () => {});
    c.on('close', () => { if (client === c) client = null; });
  });
  const api = {
    port: 0, cmds, conns: () => conns,
    rawRx: () => Buffer.concat(rx),
    listen: () => new Promise(res => srv.listen(0, '127.0.0.1', () => { api.port = srv.address().port; res(api); })),
    inc: n => { count += n; }, setCount: n => { count = n; },
    mute: b => { muted = b; }, corrupt: b => { corrupt = b; }, setDelay: ms => { delay = ms; },
    hold: b => { hold = b; if (!b) { while (queue.length) { const q = queue.shift(); if (!q.c.destroyed) q.c.write(q.buf); } } },
    dropClients: () => { if (client) client.destroy(); },
    close: () => new Promise(res => { if (client) client.destroy(); srv.close(() => res()); }),
  };
  return api;
}

/** 가짜 웹앱: mode = direct(200 JSON) | echo(302→첫 GET 만 JSON) | echoHtml(302→항상 HTML) | down(연결 끊음) */
function createFakeWebapp(o) {
  const token = (o && o.token) || 'T';
  const st = {
    mode: 'direct', ids: new Set(), events: [], batchSizes: [], posts: 0, auths: 0, dupTotal: 0, echoGets: 0,
    lastStatus: null, idPosts: new Map(), url: '', port: 0,
  };
  const echo = new Map(); let echoSeq = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET') {
      const m = /^\/echo\/(\d+)/.exec(req.url);
      const e = m && echo.get(Number(m[1]));
      if (!e) { res.writeHead(404); return res.end('nf'); }
      e.gets++; st.echoGets++;
      if (e.html || e.gets > 1) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body>Sign in</body></html>'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(e.result));
    }
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      if (st.mode === 'down') return req.socket.destroy();
      let body = null, result;
      try { body = JSON.parse(b); } catch (e) {}
      if (!body || body.token !== token) { st.auths++; result = { ok: false, error: 'auth' }; }
      else {
        let saved = 0, dup = 0;
        const badIdx = [];
        st.batchSizes.push((body.events || []).length);
        (body.events || []).forEach((ev, i) => {
          st.idPosts.set(ev.id, (st.idPosts.get(ev.id) || 0) + 1);
          if (st.rejectPred && st.rejectPred(ev)) { badIdx.push(i); return; }
          if (st.ids.has(ev.id)) dup++; else { st.ids.add(ev.id); st.events.push(ev); saved++; }
        });
        st.dupTotal += dup; st.lastStatus = body.status;
        result = { ok: true, v: 1, saved, dup, bad: badIdx.length + (st.extraBad || 0), badIdx: badIdx.concat(st.junkBadIdx || []) };
      }
      st.posts++;
      if (st.mode === 'direct') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(result)); }
      const id = ++echoSeq; echo.set(id, { result, gets: 0, html: st.mode === 'echoHtml' });
      res.writeHead(302, { Location: 'http://127.0.0.1:' + st.port + '/echo/' + id }); res.end();
    });
  });
  st.listen = () => new Promise(res => srv.listen(0, '127.0.0.1', () => {
    st.port = srv.address().port; st.url = 'http://127.0.0.1:' + st.port + '/exec'; res(st);
  }));
  st.close = () => new Promise(res => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(() => res()); });
  st.has = pred => st.events.some(pred);
  return st;
}

/** 시험용 한 벌: 검출기 + 웹앱 + 짧은 간격의 수집기 생성기 */
async function createRig(o) {
  o = o || {};
  const det = await createFakeDetector().listen();
  const web = await createFakeWebapp({ token: 'T' }).listen();
  det.setCount(o.count == null ? 10 : o.count);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmd530-'));
  const rig = {
    det, web, stateDir,
    mk: extra => createBridge(Object.assign({
      host: '127.0.0.1', port: det.port, endpoint: web.url, token: o.token || 'T', device: 'NMD530-T',
      intervalMs: 25, heartbeatMs: 80, downAfterMs: 250, reconnectMinMs: 50, reconnectMaxMs: 200,
      sendRetryMinMs: 60, sendRetryMaxMs: 200, postTimeoutMs: 1500, echoTimeoutMs: 1500, stateDir, quiet: true,
    }, extra)),
    close: async () => {
      await det.close(); await web.close();
      try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (e) {}
    },
  };
  return rig;
}

/** 와이어에 나간 바이트가 전부 상태조회(02 00 06 33 03 34)인가 */
function wireIsOnly33(det) {
  const raw = det.rawRx(), f = Buffer.from('020006330334', 'hex');   // 리터럴 — codec.buildFrame 이 틀려도 같이 틀리지 않게
  if (!f.equals(codec.buildFrame(0x33))) return false;
  if (!raw.length || raw.length % f.length) return false;
  for (let i = 0; i < raw.length; i += f.length) if (!raw.subarray(i, i + f.length).equals(f)) return false;
  return det.cmds.length > 0 && det.cmds.every(c => c === 0x33);
}

/** 계약서 §11 시나리오 종단 시험. check(이름, 참/거짓, 상세?) */
async function runScenarios(check) {
  const kinds = (web, k) => web.events.filter(e => e.kind === k);

  // 1~5, 7, 8: 한 벌로 이어서 (검출 → 리셋 → 끊김/복구 → 확인 실패 재전송 → 재시작 → 잠금)
  const r = await createRig({ count: 10 });
  let b = r.mk().start();
  check('시작 시 COLLECTOR_START 적재', await waitFor(() => r.web.has(e => e.kind === 'COLLECTOR_START'), 3000));
  r.det.inc(2);
  check('검출 +2 → DETECT n=2 prev=10 total=12',
    await waitFor(() => r.web.has(e => e.kind === 'DETECT' && e.n === 2 && e.prev === 10 && e.total === 12), 3000));
  check('heartbeat status 가 UP·total=12 로 도착',
    await waitFor(() => r.web.lastStatus && r.web.lastStatus.link === 'UP' && r.web.lastStatus.total === 12, 3000));

  r.det.setCount(3);
  check('카운터 감소 → RESET prev=12 total=3', await waitFor(() => r.web.has(e => e.kind === 'RESET' && e.prev === 12 && e.total === 3), 3000));
  await sleep(150);
  check('RESET 은 증가분을 만들지 않음(DETECT 는 여전히 1건)', kinds(r.web, 'DETECT').length === 1 && kinds(r.web, 'GAP').length === 0);
  r.det.inc(1);
  check('리셋 뒤 정상 계수 DETECT n=1 prev=3', await waitFor(() => r.web.has(e => e.kind === 'DETECT' && e.n === 1 && e.prev === 3), 3000));

  r.det.mute(true); r.det.inc(2); r.det.dropClients();
  check('응답 없음 → LINK_DOWN', await waitFor(() => r.web.has(e => e.kind === 'LINK_DOWN'), 3000));
  r.det.mute(false);
  check('복구 → LINK_UP(끊김초 숫자)', await waitFor(() => r.web.has(e => e.kind === 'LINK_UP' && typeof e.downSec === 'number'), 3000));
  check('끊긴 동안 증가분 → GAP n=2 prev=4 total=6',
    await waitFor(() => r.web.has(e => e.kind === 'GAP' && e.n === 2 && e.prev === 4 && e.total === 6), 3000));

  r.web.mode = 'echo';
  r.det.inc(1);
  check('302→echo 첫 GET JSON → 확인되어 스풀이 빔',
    await waitFor(() => r.web.has(e => e.kind === 'DETECT' && e.prev === 6), 3000) && await waitFor(() => b.snapshot().spool === 0, 3000));

  r.web.mode = 'echoHtml';
  r.det.inc(1);
  check('echo 가 HTML → 서버는 받았지만 수집기는 확인 실패(스풀 유지)',
    await waitFor(() => r.web.has(e => e.kind === 'DETECT' && e.prev === 7), 3000) && await waitFor(() => b.snapshot().spool >= 1, 1000));
  check('확인 실패 이벤트를 같은 ID 로 재전송', await waitFor(() => Math.max(...r.web.idPosts.values()) >= 2, 3000));
  r.web.mode = 'echo';
  check('확인되면 스풀이 비고, 서버 쪽 dup 으로 셈', await waitFor(() => b.snapshot().spool === 0, 3000) && r.web.dupTotal > 0);
  check('서버 고유 id 수 == 수집기가 만든 이벤트 수(중복 적재 없음)', r.web.ids.size === b.stats.emitted, r.web.ids.size + ' vs ' + b.stats.emitted);

  // 재시작: 같은 stateDir 로 새 수집기
  r.web.mode = 'direct';
  await sleep(120);
  await b.stop();
  const saved = JSON.parse(fs.readFileSync(path.join(r.stateDir, 'state.json'), 'utf8'));
  r.det.inc(3);
  await sleep(350);
  b = r.mk().start();
  check('재시작 → COLLECTOR_START.from 이 직전 마지막 유효 관측',
    await waitFor(() => kinds(r.web, 'COLLECTOR_START').length === 2, 3000) &&
    kinds(r.web, 'COLLECTOR_START')[1].from === kstIso(saved.lastValidAt),
    JSON.stringify(kinds(r.web, 'COLLECTOR_START').map(e => e.from)) + ' want ' + kstIso(saved.lastValidAt));
  check('재시작 사이 증가분 → GAP n=3', await waitFor(() => r.web.has(e => e.kind === 'GAP' && e.n === 3), 3000));
  check('재시작 뒤에도 id 유일', r.web.ids.size === b.snapshot().seq);

  let lockCode = null;
  try { r.mk().start(); } catch (e) { lockCode = e.code; }
  check('잠금: 이중 실행 거부(ELOCKED)', lockCode === 'ELOCKED');
  await b.stop();
  let again = null;
  try { again = r.mk().start(); } catch (e) {}
  check('종료하면 잠금이 풀려 다시 시작 가능', !!again);
  if (again) await again.stop();
  check('와이어에 나간 명령은 0x33 뿐', wireIsOnly33(r.det), 'cmds=' + [...new Set(r.det.cmds)].map(c => c.toString(16)));
  await r.close();

  // 6: 토큰 불일치 → 서버 auth, 수집기는 스풀 유지
  const a = await createRig({ count: 5, token: 'WRONG' });
  const ba = a.mk().start();
  check('토큰 불일치 → 서버 auth 거부(적재 0)', await waitFor(() => a.web.auths >= 2, 3000) && a.web.ids.size === 0);
  check('토큰 불일치 → 수집기는 스풀 유지', ba.snapshot().spool >= 1);
  await ba.stop();
  await a.close();

  // 몰아서 보내기: 응답을 쥐고 있다가 한꺼번에 풀어도 증가분이 중복 계수되지 않는다
  const h = await createRig({ count: 20 });
  const bh = h.mk().start();
  await waitFor(() => h.web.has(e => e.kind === 'COLLECTOR_START'), 3000);
  h.det.hold(true); h.det.inc(1); await sleep(100); h.det.inc(1); await sleep(100);
  h.det.hold(false);
  await sleep(300);
  const detSum = kinds(h.web, 'DETECT').reduce((s, e) => s + e.n, 0) + kinds(h.web, 'GAP').reduce((s, e) => s + e.n, 0);
  check('늦게 몰려 온 응답 → 실제 증가 +2 가 정확히 +2 로 계수(중복·누락 없음)', detSum === 2, 'sum=' + detSum);
  await bh.stop();
  await h.close();
}

/* ───────────────── 실행 ───────────────── */
module.exports = {
  createBridge, parseConfig, ALLOWED_CMDS, DEFAULTS, VERSION, checkCmdConstants,
  testKit: { createFakeDetector, createFakeWebapp, createRig, runScenarios, wireIsOnly33, waitFor, sleep },
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  let cfg;
  try { cfg = parseConfig(argv, process.env); } catch (e) { console.error(e.message); process.exit(2); }

  if (cfg.version) { console.log(COLLECTOR); process.exit(0); }

  if (cfg.selftest) {
    let pass = 0, fail = 0;
    const t0 = Date.now();
    console.log('── nmd530-bridge 종단 자체검증 ──');
    runScenarios((name, ok, detail) => {
      if (ok) { pass++; console.log('  ✅ ' + name); }
      else { fail++; console.log('  ❌ ' + name + (detail ? '\n     ' + detail : '')); }
    }).then(() => {
      console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed (' + ((Date.now() - t0) / 1000).toFixed(1) + '초)');
      process.exit(fail ? 1 : 0);
    }).catch(e => { console.log('❌ 시험 중 예외: ' + (e && e.stack || e)); process.exit(1); });
  } else {
    let bridge;
    try { bridge = createBridge(Object.assign({}, cfg, { dry: cfg.dry })).start(); }
    catch (e) { console.error(e.message); process.exit(e.code === 'ELOCKED' ? 3 : 2); }
    const bye = () => { bridge.stop().then(() => process.exit(0)); };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  }
}
