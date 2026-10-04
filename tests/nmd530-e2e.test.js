/* NMD-530 종단(end-to-end) 시험 — 수집기 → Apps Script 수신부 → 웹 화면 순수 함수를 «실제로 이어 붙여» 본다.
   세 갈래(bridge/nmd530-bridge.js · apps-script/nmd530_receiver.gs · index.html 의 metal* 함수)는 따로 만들어져
   각자의 단위 시험은 초록이지만, 이어 붙이면 필드 이름·열 위치·구분 문구·시간 표기·단위가 어긋날 수 있다. 그것을 잡는다.
   정본 계약: docs/NMD530_PIPELINE.md (§3·§4·§5·§6·§7·§9). 시험은 계약서가 요구하는 동작을 단언한다 —
   어긋나면 시험이 빨개지는 게 맞고, 어느 갈래를 고칠지는 사람이 정한다.

   구성: 가짜 검출기(TCP, 받은 바이트 전부 기록) → 실제 수집기 → 가짜 웹앱(HTTP) → 실제 doPost(.gs 를 vm 에 로드, 메모리 시트)
         → 시트 값을 SheetsAPI.getAll(탭,false) 모양(헤더 제외·전 셀 문자열)으로 바꿔 → 실제 화면 함수(index.html 마커 구간)
   서버는 전부 포트 0. 시나리오는 서로 독립(자기 stateDir·시트·가짜 서버)이라 동시에 돌려 시간을 줄인다.
   토큰·주소·시트 ID 는 시험용 가짜 값뿐(public 저장소).

   실행:  node tests/nmd530-e2e.test.js      실패가 있으면 전부 보여 주고 종료 코드 1 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const { createBridge } = require(path.join(ROOT, 'bridge', 'nmd530-bridge.js'));
const codec = require(path.join(ROOT, 'bridge', 'nmd530-codec.js'));
const RECEIVER_SRC = fs.readFileSync(path.join(ROOT, 'apps-script', 'nmd530_receiver.gs'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const TOKEN = 'test-token-xyz';
const DEVICE = 'NMD530-E2E';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) { if (fn()) return true; await sleep(15); }
  return !!fn();
}
const kstStr = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

/* ───────────────── 화면 함수 (index.html 마커 구간을 vm 으로) ───────────────── */
function loadScreen() {
  const slice = (a, b) => {
    const i = INDEX_SRC.indexOf(a); if (i < 0) throw new Error('시작 마커 없음: ' + a);
    const j = INDEX_SRC.indexOf(b, i); if (j < 0) throw new Error('종료 마커 없음: ' + b);
    return INDEX_SRC.slice(i, j);
  };
  const END = '/* ── 끝: 금속검출 실시간현황 ── */';
  const code = slice('function tempPeriodStart', 'const tempLogName') + '\n' +
    slice('/* ── 금속검출 실시간현황 (NMD-530) ──', END) + END +
    '\n;({ METAL_STALE_MS, metalParseLog, metalParseStatus, metalConnState, metalSummarize, parseLogTs })';
  // 앱 전역은 구간이 최상위에서 참조하는 만큼만(State·Screens) 스텁
  return vm.runInNewContext(code, { State: {}, Screens: {}, Date, Math, Number, String, isNaN, JSON }, { filename: 'index.html#metal-live' });
}
const M = loadScreen();

/* ───────────────── 수신부 (실제 .gs + 메모리 시트) ───────────────── */
function makeReceiver(props) {
  const sheets = {};
  function makeSheet(name) {
    const sh = {
      name, rows: [], fmt: {},                       // fmt['행,열'] = 서식
      getLastRow() { return this.rows.length; },
      setFrozenRows() {},
      getRange(r, c, nr, nc) {
        const self = this; nr = nr || 1; nc = nc || 1;
        return {
          setValues(v) {
            for (let i = 0; i < v.length; i++) {
              const row = self.rows[r - 1 + i] || (self.rows[r - 1 + i] = []);
              for (let j = 0; j < v[i].length; j++) row[c - 1 + j] = v[i][j];
            }
          },
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = self.rows[r - 1 + i] || [], o = [];
              for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
              out.push(o);
            }
            return out;
          },
          setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) self.fmt[(r + i) + ',' + (c + j)] = f; },
        };
      },
    };
    return sh;
  }
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)) };
  const ctx = {
    SpreadsheetApp: { openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: d => kstStr(d.getTime()) },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }),
    },
    Logger: { log() {} },
    Date, JSON, Array, Object, Math, String, Number, isNaN, isFinite, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(RECEIVER_SRC, ctx, { filename: 'nmd530_receiver.gs' });
  return {
    sheets,
    post: bodyText => ctx.doPost({ postData: { contents: bodyText } }).getContent(),
    /** 시트 → SheetsAPI.getAll(탭, false) 모양: 헤더 1행 제외 · 모든 셀 문자열(FORMATTED_VALUE) · 뒤쪽 빈 칸은 잘림 */
    getAll(name) {
      const sh = sheets[name]; if (!sh) return [];
      return sh.rows.slice(1).map(r => {
        const a = Array.from(r, v => (v === undefined || v === null ? '' : String(v)));
        while (a.length && a[a.length - 1] === '') a.pop();
        return a;
      });
    },
    header(name) { return sheets[name] ? sheets[name].rows[0] : null; },
    count(name) { return sheets[name] ? Math.max(0, sheets[name].rows.length - 1) : 0; },
  };
}

/* ───────────────── 가짜 검출기 (받은 모든 바이트를 기록) ───────────────── */
function createDetector() {
  let count = 0, product = 1, statusByte = 0, ch1 = 90, ch2 = 70, muted = false, refuse = false, client = null;
  const rx = [];
  const srv = net.createServer(c => {
    if (refuse) { c.destroy(); return; }
    if (client) client.destroy();                     // 실제 장비처럼 접속 1개만
    client = c;
    let b = Buffer.alloc(0);
    c.on('data', ch => {
      rx.push(Buffer.from(ch));                       // 와이어에 올라온 원시 바이트
      b = Buffer.concat([b, ch]);
      const r = codec.parseFrames(b); b = r.rest;
      for (const f of r.frames) {
        if (f.cmd !== codec.CMD.STATUS_REQ || muted) continue;
        const d = Buffer.alloc(12);
        d[0] = product; d[1] = statusByte; d[2] = ch1; d[3] = ch2; d[4] = 70;
        d.writeUInt16BE(count, 10);
        if (!c.destroyed) c.write(codec.buildFrame(codec.CMD.STATUS_RPT, d));
      }
    });
    c.on('error', () => {});
    c.on('close', () => { if (client === c) client = null; });
  });
  const api = {
    port: 0, rawRx: () => Buffer.concat(rx),
    listen: () => new Promise(res => srv.listen(0, '127.0.0.1', () => { api.port = srv.address().port; res(api); })),
    inc: n => { count += n; }, setCount: n => { count = n; }, getCount: () => count,
    setStatusByte: v => { statusByte = v; },
    refuse: b => { refuse = b; if (b && client) client.destroy(); },
    close: () => new Promise(res => { if (client) client.destroy(); srv.close(() => res()); }),
  };
  return api;
}

/* ───────────────── 가짜 웹앱 (POST 본문을 실제 doPost 에 그대로 넘긴다) ─────────────────
   mode: direct(200 JSON) | echo(302, Location 의 «첫 GET» 만 JSON) | echoHtml(302, 항상 HTML) */
function createWebapp(rcv) {
  const st = { mode: 'direct', responses: [], sent: new Map(), idPosts: new Map(), echoGets: 0, echoMaxGets: 0, url: '', port: 0 };
  const echo = new Map(); let seq = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET') {
      const m = /^\/echo\/(\d+)/.exec(req.url), e = m && echo.get(Number(m[1]));
      if (!e) { res.writeHead(404); return res.end('nf'); }
      e.gets++; st.echoGets++; st.echoMaxGets = Math.max(st.echoMaxGets, e.gets);
      if (e.html || e.gets > 1) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body>Sign in</body></html>'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(e.text);
    }
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      let parsed = null; try { parsed = JSON.parse(b); } catch (x) {}
      if (parsed && Array.isArray(parsed.events)) {
        for (const ev of parsed.events) {
          if (!ev || typeof ev.id !== 'string') continue;
          st.sent.set(ev.id, ev); st.idPosts.set(ev.id, (st.idPosts.get(ev.id) || 0) + 1);
        }
      }
      const text = rcv.post(b);                       // 서버가 «실행» 된 뒤에야 응답이 나간다(Apps Script 와 같은 순서)
      try { st.responses.push(JSON.parse(text)); } catch (x) {}
      if (st.mode === 'direct') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(text); }
      const id = ++seq; echo.set(id, { text, gets: 0, html: st.mode === 'echoHtml' });
      res.writeHead(302, { Location: 'http://127.0.0.1:' + st.port + '/echo/' + id }); res.end();
    });
  });
  st.listen = () => new Promise(res => srv.listen(0, '127.0.0.1', () => {
    st.port = srv.address().port; st.url = 'http://127.0.0.1:' + st.port + '/exec'; res(st);
  }));
  st.close = () => new Promise(res => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(() => res()); });
  return st;
}

/* ───────────────── 시나리오 한 벌 ───────────────── */
const allDetectors = [];            // 9번(와이어) 단언용
async function createRig(o) {
  o = o || {};
  const det = await createDetector().listen(); allDetectors.push(det);
  det.setCount(o.count == null ? 10 : o.count);
  const rcv = makeReceiver({ NMD530_TOKEN: TOKEN, SHEET_ID: 'test-sheet-id' });
  const web = await createWebapp(rcv).listen();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmd530-e2e-'));
  const bridges = [];
  return {
    det, rcv, web, stateDir,
    mk: extra => {
      const b = createBridge(Object.assign({
        host: '127.0.0.1', port: det.port, endpoint: web.url, token: TOKEN, device: DEVICE,
        intervalMs: 50, heartbeatMs: 200, downAfterMs: 500, reconnectMinMs: 50, reconnectMaxMs: 150,
        sendRetryMinMs: 60, sendRetryMaxMs: 200, postTimeoutMs: 1500, echoTimeoutMs: 1500, stateDir, quiet: true,
      }, extra));
      bridges.push(b); return b;
    },
    close: async () => {
      for (const b of bridges) { try { await b.stop(); } catch (e) {} }
      await det.close(); await web.close();
      try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (e) {}
    },
  };
}

/* 계약서 §6 의 글자 그대로 (수신부 소스를 읽지 않고 계약서에서 옮겨 적었다) */
const LOG_HEADER = ['기록시각(KST)', '구분', '증가분', '누적검출', '이전값', '구간시작', '제품번호', '설비상태', 'Ch1신호', 'Ch2신호', '끊김(초)', '기기', '수집PC', '서버수신시각', '이벤트ID'];
const STATUS_HEADER = ['기기', '서버수신시각', '수집PC시각', '통신', '누적검출', '마지막유효관측', '제품번호', '설비상태', '대기큐', '수집PC', '수집기버전', '끊김시작', '가동시작'];
const KIND_KO = { DETECT: '검출', GAP: '미관측구간', RESET: '리셋', LINK_DOWN: '통신끊김', LINK_UP: '통신복구', COLLECTOR_START: '수집기시작' };
const FLAG_KO = { outError: 'Out error', balError: 'Bal error', testMode: '테스트 모드', dualFreq: '듀얼 주파수' };
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const isoToKst = s => s.slice(0, 19).replace('T', ' ');            // 이벤트 t 는 이미 +09:00 이므로 글자만 바꾸면 KST

/* 시나리오 공통 도우미: 시트에서 구분별 행 / 화면 파서 */
const logRows = (rcv, kindKo) => rcv.getAll('금속검출로그').filter(r => !kindKo || r[1] === kindKo);
const screenEvents = rcv => M.metalParseLog(rcv.getAll('금속검출로그'));
const screenStatus = (rcv, device) => M.metalParseStatus(rcv.getAll('금속검출상태'), device || DEVICE);
const sumN = (rows) => rows.reduce((s, r) => s + Number(r[2] || 0), 0);

/* 모든 로그 행 ↔ 수집기가 «실제로 보낸» 이벤트를 열 단위로 대조 (필드 이름·열 위치·구분 문구·시간 표기·단위) */
function crossCheck(rcv, web) {
  const bad = [];
  const rows = rcv.getAll('금속검출로그');
  for (const r of rows) {
    const ev = web.sent.get(r[14]);
    if (!ev) { bad.push('보낸 적 없는 id: ' + r[14]); continue; }
    const s = v => (v === null || v === undefined ? '' : String(v));
    const flags = (ev.flags || []).map(k => FLAG_KO[k]).filter(Boolean).join('·');
    const want = [isoToKst(ev.t), KIND_KO[ev.kind], s(ev.n), s(ev.total), s(ev.prev), ev.from ? isoToKst(ev.from) : '',
      s(ev.product), flags, s(ev.ch1), s(ev.ch2), s(ev.downSec), undefined, undefined, undefined, ev.id];
    for (let i = 0; i < 15; i++) {
      if (want[i] === undefined) continue;
      if ((r[i] || '') !== want[i]) bad.push('열 ' + 'ABCDEFGHIJKLMNO'[i] + ' [' + ev.kind + ' ' + ev.id + '] 시트=' + JSON.stringify(r[i] || '') + ' 수집기=' + JSON.stringify(want[i]));
    }
    if (!TS_RE.test(r[0] || '') || (r[5] && !TS_RE.test(r[5])) || !TS_RE.test(r[13] || '')) bad.push('시각 서식 불일치 ' + r[14]);
  }
  return bad;
}

/* ───────────────── 시나리오들 ───────────────── */
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('1 정상', async (chk) => {
  const r = await createRig({ count: 10 });
  try {
    r.det.setStatusByte(0x08);                                         // testMode 비트
    const b = r.mk().start();
    chk('시작 → 로그 시트에 수집기시작 1행', await waitFor(() => logRows(r.rcv, '수집기시작').length === 1));
    chk('로그 시트 헤더가 계약 §6 과 글자까지 같다', JSON.stringify(r.rcv.header('금속검출로그')) === JSON.stringify(LOG_HEADER),
      JSON.stringify(r.rcv.header('금속검출로그')));
    chk('상태 시트 헤더가 계약 §6 과 글자까지 같다', JSON.stringify(r.rcv.header('금속검출상태')) === JSON.stringify(STATUS_HEADER),
      JSON.stringify(r.rcv.header('금속검출상태')));
    for (let k = 1; k <= 3; k++) {                                     // 한 번씩 올리고 시트에 앉을 때까지 기다려 합쳐지지 않게
      r.det.inc(1);
      await waitFor(() => logRows(r.rcv, '검출').length === k);
      await sleep(60);
    }
    const det = logRows(r.rcv, '검출');
    chk('검출 3행(간격이 충분하면 합쳐지지 않는다)', det.length === 3, 'rows=' + det.length);
    chk('증가분 합 == 실제 증가분 3', sumN(det) === 3, String(sumN(det)));
    chk('열 위치: 누적검출(D) 11·12·13 / 이전값(E) 10·11·12', det.map(x => x[3]).join() === '11,12,13' && det.map(x => x[4]).join() === '10,11,12',
      JSON.stringify(det));
    chk('열 위치: 제품번호(G)=1 · 설비상태(H)=테스트 모드 · Ch1(I)=90 · Ch2(J)=70 · 기기(L)', det.every(x => x[6] === '1' && x[7] === '테스트 모드' && x[8] === '90' && x[9] === '70' && x[11] === DEVICE),
      JSON.stringify(det[0]));
    chk('이벤트ID(O) 형식 `기기|부팅|순번`', det.every(x => /^NMD530-E2E\|\d{8}T\d{6}K\|\d{4}$/.test(x[14])), det[0] && det[0][14]);
    chk('모든 행이 수집기가 보낸 이벤트와 열 단위로 일치(시각 표기·구분 문구·단위)', crossCheck(r.rcv, r.web).length === 0, crossCheck(r.rcv, r.web).join('\n     '));
    const ev = screenEvents(r.rcv);
    const S = M.metalSummarize(ev, 0, 0, Date.now());
    chk('화면: 구분 한글이 코드로 읽힌다(수집기시작 1 · 검출 3)', ev.filter(e => e.kind === 'COLLECTOR_START').length === 1 && ev.filter(e => e.kind === 'DETECT').length === 3,
      JSON.stringify(ev.map(e => e.kind)));
    chk('화면: detectTimed == 실제 증가분 3 · detectGap 0 · 리셋 0', S.detectTimed === 3 && S.detectGap === 0 && S.resets === 0, JSON.stringify(S));
    chk('화면: 열이 어긋나지 않는다(total·prev·product·flags·ch1·ch2)',
      ev.filter(e => e.kind === 'DETECT').every((e, i) => e.n === 1 && e.total === 11 + i && e.prev === 10 + i && e.product === 1 && e.flags === '테스트 모드' && e.ch1 === 90 && e.ch2 === 70 && e.device === DEVICE),
      JSON.stringify(ev.filter(e => e.kind === 'DETECT')[0]));
    const d0 = ev.filter(e => e.kind === 'DETECT')[0];
    chk('화면: 구간시작(F) ≤ 기록시각(A) 이고 간격이 폴링 수준(<3초)', d0.from > 0 && d0.from <= d0.t && d0.t - d0.from < 3000, d0.fromAt + ' → ' + d0.at);
    chk('화면: 마지막 검출 시각 == 마지막 DETECT 행 A열', S.lastDetectAt === M.parseLogTs(det[2][0]));
    await b.stop();
  } finally { await r.close(); }
});

scenario('2 통신 끊김', async (chk) => {
  const r = await createRig({ count: 10 });
  try {
    const b = r.mk().start();
    await waitFor(() => logRows(r.rcv, '수집기시작').length === 1);
    await waitFor(() => !!screenStatus(r.rcv));
    const tDrop = Date.now();
    r.det.refuse(true); r.det.inc(2);                                  // 끊긴 동안 누적이 2 오른다
    chk('통신끊김 행이 시트에 생긴다', await waitFor(() => logRows(r.rcv, '통신끊김').length === 1));
    chk('상태 시트 통신(D) 가 DOWN 으로 갱신', await waitFor(() => { const s = screenStatus(r.rcv); return !!s && s.link === 'DOWN'; }));
    const st = screenStatus(r.rcv);
    const cs = M.metalConnState(st, st.recv + 1000);
    chk('끊김 진행 중: metalConnState = linkdown «통신 끊김 — 수집기는 동작 중»', cs.key === 'linkdown' && /통신 끊김.*수집기는 동작 중/.test(cs.label), JSON.stringify(cs));
    const ld = screenEvents(r.rcv).find(e => e.kind === 'LINK_DOWN');
    chk('화면: 통신끊김 행의 증가분·누적·끊김초는 비어 있다(null, 0 아님)', ld && ld.n === null && ld.total === null && ld.downSec === null, JSON.stringify(ld));
    await sleep(Math.max(0, 1300 - (Date.now() - tDrop)));
    const tOpen = Date.now();
    r.det.refuse(false);
    chk('통신복구 행', await waitFor(() => logRows(r.rcv, '통신복구').length === 1));
    chk('미관측구간 행 n=2 이전값 10 누적 12', await waitFor(() => logRows(r.rcv, '미관측구간').length === 1));
    const gap = logRows(r.rcv, '미관측구간')[0], up = logRows(r.rcv, '통신복구')[0];
    chk('GAP 행 열 위치: C=2 D=12 E=10', gap[2] === '2' && gap[3] === '12' && gap[4] === '10', JSON.stringify(gap));
    chk('LINK_UP 행 끊김(초) K 열이 숫자', /^\d+$/.test(up[10]), JSON.stringify(up));
    chk('모든 행이 수집기가 보낸 이벤트와 열 단위로 일치', crossCheck(r.rcv, r.web).length === 0, crossCheck(r.rcv, r.web).join('\n     '));
    const S = M.metalSummarize(screenEvents(r.rcv), 0, 0, Date.now());
    chk('화면: detectGap == 끊긴 동안 증가분 2 · detectTimed 0', S.detectGap === 2 && S.detectTimed === 0, JSON.stringify(S));
    chk('화면: 공백 초(downSec) ≈ 실제 끊긴 시간(±1초)', Math.abs(S.downSec * 1000 - (tOpen - tDrop)) <= 1000, S.downSec + 's vs ' + (tOpen - tDrop) + 'ms');
    chk('화면: 공백 분 = 1 (짧아도 0분으로 감추지 않는다)', S.gapMinutes === 1, JSON.stringify(S));
    await b.stop();
  } finally { await r.close(); }
});

scenario('3 리셋', async (chk) => {
  const r = await createRig({ count: 10 });
  try {
    const b = r.mk().start();
    await waitFor(() => logRows(r.rcv, '수집기시작').length === 1);
    r.det.inc(1);
    await waitFor(() => sumN(logRows(r.rcv, '검출')) === 1);
    r.det.setCount(3);                                                 // 전원 사이클처럼 카운터가 줄어든다
    chk('리셋 행 생성', await waitFor(() => logRows(r.rcv, '리셋').length === 1));
    const rs = logRows(r.rcv, '리셋')[0];
    chk('리셋 행: 증가분(C) 빈칸 · 누적(D)=3 · 이전값(E)=11', rs[2] === '' && rs[3] === '3' && rs[4] === '11', JSON.stringify(rs));
    await sleep(120);
    chk('리셋은 검출 합계를 바꾸지 않는다(시트 검출 1건 그대로, 미관측구간 0)', sumN(logRows(r.rcv, '검출')) === 1 && logRows(r.rcv, '미관측구간').length === 0);
    r.det.inc(2);
    chk('리셋 뒤 새 기준으로 정상 계수(증가분 2, 이전값 3)', await waitFor(() => logRows(r.rcv, '검출').some(x => x[2] === '2' && x[4] === '3' && x[3] === '5')));
    const S = M.metalSummarize(screenEvents(r.rcv), 0, 0, Date.now());
    chk('화면: 리셋 횟수 1', S.resets === 1, JSON.stringify(S));
    chk('화면: 검출 합계 = 1 + 2 = 3 (리셋 때문에 늘거나 줄지 않음)', S.detectTimed === 3 && S.detectGap === 0, JSON.stringify(S));
    chk('모든 행이 수집기가 보낸 이벤트와 열 단위로 일치', crossCheck(r.rcv, r.web).length === 0, crossCheck(r.rcv, r.web).join('\n     '));
    await b.stop();
  } finally { await r.close(); }
});

scenario('4 전달 보증', async (chk) => {
  const r = await createRig({ count: 10 });
  try {
    r.web.mode = 'echoHtml';                                           // 서버는 실행되지만 수집기는 확인을 못 읽는다
    const b = r.mk().start();
    await waitFor(() => logRows(r.rcv, '수집기시작').length === 1);
    r.det.inc(1);
    await waitFor(() => logRows(r.rcv, '검출').length === 1);
    chk('HTML 응답을 확인으로 오인하지 않는다: 스풀 유지(2건)', await waitFor(() => b.snapshot().spool >= 2, 2000), 'spool=' + b.snapshot().spool);
    const startId = logRows(r.rcv, '수집기시작')[0][14];
    chk('같은 이벤트ID 로 재전송한다', await waitFor(() => (r.web.idPosts.get(startId) || 0) >= 2, 3000), 'posts=' + r.web.idPosts.get(startId));
    const spoolFile = path.join(r.stateDir, 'spool.jsonl');
    chk('스풀 파일에도 그대로 남아 있다', fs.readFileSync(spoolFile, 'utf8').includes(startId));
    chk('재전송했는데도 시트 행은 늘지 않는다(서버 dup)', logRows(r.rcv, '수집기시작').length === 1 && new Set(logRows(r.rcv).map(x => x[14])).size === logRows(r.rcv).length && r.web.responses.some(x => x.dup > 0),
      'rows=' + logRows(r.rcv).length);
    r.web.mode = 'echo';                                               // 이제 첫 GET 이 JSON
    chk('echo 에서 첫 GET 이 JSON → 확인되어 스풀이 빈다', await waitFor(() => b.snapshot().spool === 0, 3000));
    await sleep(100);
    chk('스풀 파일도 빈다', fs.readFileSync(spoolFile, 'utf8') === '');
    r.det.inc(1);
    chk('이후 이벤트도 echo 로 정확히 한 번 적재', await waitFor(() => logRows(r.rcv, '검출').length === 2) && await waitFor(() => b.snapshot().spool === 0, 3000));
    await sleep(250);
    const ids = logRows(r.rcv).map(x => x[14]);
    chk('시트의 고유 id 수 == 수집기가 만든 이벤트 수 (중복 행 0)', new Set(ids).size === ids.length && ids.length === b.stats.emitted, ids.length + ' rows / ' + new Set(ids).size + ' uniq / emitted ' + b.stats.emitted);
    chk('결과 주소(Location)는 요청당 GET 한 번만', r.web.echoMaxGets === 1, 'max=' + r.web.echoMaxGets);
    chk('모든 행이 수집기가 보낸 이벤트와 열 단위로 일치', crossCheck(r.rcv, r.web).length === 0, crossCheck(r.rcv, r.web).join('\n     '));
    await b.stop();
  } finally { await r.close(); }
});

scenario('5 재시작', async (chk) => {
  /* 5a: 끊김→복구를 겪은 수집기를 껐다 켠다 */
  const r = await createRig({ count: 10 });
  try {
    let a = r.mk().start();
    await waitFor(() => logRows(r.rcv, '수집기시작').length === 1);
    r.det.inc(1);
    await waitFor(() => logRows(r.rcv, '검출').length === 1);
    const tDrop = Date.now();
    r.det.refuse(true);
    await sleep(1100);
    const tOpen = Date.now();
    r.det.refuse(false);
    await waitFor(() => logRows(r.rcv, '통신복구').length === 1);
    await waitFor(() => a.snapshot().spool === 0, 3000);
    await sleep(200);
    await a.stop();
    const tStop = Date.now();
    const saved = JSON.parse(fs.readFileSync(path.join(r.stateDir, 'state.json'), 'utf8'));
    r.det.inc(2);                                                      // 꺼져 있는 동안 증가
    await sleep(700);
    const tStart = Date.now();
    a = r.mk().start();
    chk('재시작 → 수집기시작 2행', await waitFor(() => logRows(r.rcv, '수집기시작').length === 2));
    const cs2 = logRows(r.rcv, '수집기시작')[1];
    chk('수집기시작.구간시작(F) == 직전 마지막 유효 관측(state.json)', cs2[5] === kstStr(saved.lastValidAt), cs2[5] + ' vs ' + kstStr(saved.lastValidAt));
    chk('꺼진 동안 증가분 → 미관측구간 n=2', await waitFor(() => logRows(r.rcv, '미관측구간').some(x => x[2] === '2')));
    chk('모든 행이 수집기가 보낸 이벤트와 열 단위로 일치', crossCheck(r.rcv, r.web).length === 0, crossCheck(r.rcv, r.web).join('\n     '));
    const ev = screenEvents(r.rcv);
    const S = M.metalSummarize(ev, 0, 0, Date.now());
    const up = ev.find(e => e.kind === 'LINK_UP'), cs = ev.filter(e => e.kind === 'COLLECTOR_START')[1];
    chk('화면: 끊김 구간(downSec)과 재시작 공백(collectorGapSec)이 따로 합산', S.downSec === up.downSec && S.collectorGapSec === Math.round((cs.t - cs.from) / 1000), JSON.stringify(S));
    chk('화면: downSec ≈ 실제 끊긴 시간(±1초)', Math.abs(S.downSec * 1000 - (tOpen - tDrop)) <= 1000, S.downSec + 's vs ' + (tOpen - tDrop) + 'ms');
    chk('화면: 재시작 공백 ≈ 꺼져 있던 시간(±1.5초)', Math.abs(S.collectorGapSec * 1000 - (tStart - tStop)) <= 1500, S.collectorGapSec + 's vs ' + (tStart - tStop) + 'ms');
    chk('화면: 두 공백 구간이 겹치지 않는다(재시작 구간시작 ≥ 통신복구 시각)', cs.from >= up.t, cs.fromAt + ' vs ' + up.at);
    chk('화면: 공백 분 합산 = round((downSec + 재시작공백)/60), 이중 가산 없음', S.gapMinutes === Math.max(1, Math.round((S.downSec + S.collectorGapSec) / 60)));
    chk('화면: detectGap 2 (재시작 사이 증가분) · detectTimed 1', S.detectGap === 2 && S.detectTimed === 1, JSON.stringify(S));
    await a.stop();
  } finally { await r.close(); }

  /* 5b: 끊김이 «진행 중인 채로» 수집기가 꺼졌다 켜진다 → 끊김 구간은 재시작 공백 하나가 덮는다(두 번 세지 않는다) */
  const q = await createRig({ count: 10 });
  try {
    let a = q.mk().start();
    await waitFor(() => logRows(q.rcv, '수집기시작').length === 1);
    const tDrop = Date.now();
    q.det.refuse(true); q.det.inc(1);
    await waitFor(() => logRows(q.rcv, '통신끊김').length === 1);
    await sleep(200);
    await a.stop();
    q.det.refuse(false);
    await sleep(300);
    const tStart = Date.now();
    a = q.mk().start();
    chk('끊김 중 재시작 → 수집기시작 2행', await waitFor(() => logRows(q.rcv, '수집기시작').length === 2));
    chk('끊김 중 재시작 → 미관측구간 n=1', await waitFor(() => logRows(q.rcv, '미관측구간').some(x => x[2] === '1')));
    const ev = screenEvents(q.rcv);
    const S = M.metalSummarize(ev, 0, 0, Date.now());
    chk('화면: 통신복구가 없으니 downSec 0 (통신끊김 행은 공백에 더하지 않는다)', S.downSec === 0 && ev.filter(e => e.kind === 'LINK_UP').length === 0, JSON.stringify(S));
    chk('화면: 전체 공백 ≈ 마지막 유효 관측 ~ 재시작 시각 한 구간(±1.5초)', Math.abs(S.collectorGapSec * 1000 - (tStart - tDrop)) <= 1500, S.collectorGapSec + 's vs ' + (tStart - tDrop) + 'ms');
    await a.stop();
  } finally { await q.close(); }
});

scenario('6 인증', async (chk) => {
  const r = await createRig({ count: 5 });
  try {
    let a = r.mk({ token: 'wrong-token' }).start();
    chk('토큰 불일치 → 서버 auth 응답이 2번 이상(재전송)', await waitFor(() => r.web.responses.filter(x => x.error === 'auth').length >= 2));
    chk('시트에 행 0 (탭도 만들지 않는다)', r.rcv.count('금속검출로그') === 0 && r.rcv.count('금속검출상태') === 0 && Object.keys(r.rcv.sheets).length === 0,
      Object.keys(r.rcv.sheets).join());
    chk('수집기 스풀에 이벤트가 남아 있다', a.snapshot().spool >= 1);
    const spoolFile = path.join(r.stateDir, 'spool.jsonl');
    const oldId = JSON.parse(fs.readFileSync(spoolFile, 'utf8').split('\n')[0]).id;
    await a.stop();
    a = r.mk().start();                                                // 같은 stateDir, 올바른 토큰
    chk('토큰을 맞춘 새 수집기가 같은 스풀을 보내면 적재된다(옛 id 포함)', await waitFor(() => logRows(r.rcv).some(x => x[14] === oldId)), oldId);
    chk('옛 스풀의 수집기시작 + 새 수집기시작 = 2행', await waitFor(() => logRows(r.rcv, '수집기시작').length === 2));
    chk('확인되어 스풀이 빈다', await waitFor(() => a.snapshot().spool === 0, 3000));
    chk('모든 행이 수집기가 보낸 이벤트와 열 단위로 일치', crossCheck(r.rcv, r.web).length === 0, crossCheck(r.rcv, r.web).join('\n     '));
    await a.stop();
  } finally { await r.close(); }
});

scenario('7 상태 시트', async (chk) => {
  const r = await createRig({ count: 10 });
  try {
    const b = r.mk().start();
    chk('상태 시트에 행이 생긴다', await waitFor(() => r.rcv.count('금속검출상태') === 1));
    const posts0 = r.web.responses.length;
    r.det.inc(1);
    chk('계속 보내는 동안(heartbeat 4회 이상) 행 수 1 유지', await waitFor(() => r.web.responses.length >= posts0 + 4, 3000) && r.rcv.count('금속검출상태') === 1);
    await waitFor(() => { const x = r.rcv.getAll('금속검출상태')[0]; return x && x[4] === '11'; }, 3000);
    const row = r.rcv.getAll('금속검출상태')[0];
    chk('열 위치: A 기기 · D 통신 UP · E 누적 11 · G 제품 1 · J 수집PC · K 수집기버전',
      row[0] === DEVICE && row[3] === 'UP' && row[4] === '11' && row[6] === '1' && row[9] === os.hostname() && /^nmd530-bridge\/\d/.test(row[10]), JSON.stringify(row));
    chk('열 위치: 서버수신시각(B) 은 KST 문자열 · 마지막유효관측(F)·가동시작(M) 시각 파싱 가능',
      TS_RE.test(row[1]) && M.parseLogTs(row[5]) > 0 && M.parseLogTs(row[12]) > 0 && M.parseLogTs(row[12]) <= M.parseLogTs(row[5]), JSON.stringify(row));
    // 기기별 upsert: 다른 기기가 오면 2행, 같은 기기가 또 오면 그대로
    const direct = dev => JSON.parse(r.rcv.post(JSON.stringify({ v: 1, token: TOKEN, device: dev, host: 'PC-2', collector: 'x/1', sentAt: '2026-10-05T10:21:00+09:00', events: [],
      status: { link: 'DOWN', total: 7, product: 2, flags: ['balError'], lastValidAt: '2026-10-05T10:20:00+09:00', downSince: null, spool: 0, bootAt: '2026-10-05T09:00:00+09:00' } })));
    direct('NMD530-OTHER'); direct('NMD530-OTHER');
    chk('다른 기기는 별도 1행(기기 기준 upsert) — 같은 기기 두 번은 그대로', r.rcv.count('금속검출상태') === 2);
    const st = screenStatus(r.rcv);
    chk('화면: 기기를 지정하면 그 기기 행을 읽는다', st && st.device === DEVICE && st.total === 11 && M.metalParseStatus(r.rcv.getAll('금속검출상태'), 'NMD530-OTHER').flags === 'Bal error');
    const base = st.recv;
    chk('metalConnState: 수신 직후 UP → 정상', M.metalConnState(st, base + 1000).key === 'ok');
    chk('metalConnState: 정확히 3분 → 정상 · 3분+1ms → 수집기 응답 없음', M.metalConnState(st, base + 180000).key === 'ok' && M.metalConnState(st, base + 180001).key === 'stale');
    chk('metalConnState: 상태 행 없음 → 가동 전', M.metalConnState(M.metalParseStatus([], DEVICE), base).key === 'idle' && M.metalConnState(M.metalParseStatus(r.rcv.getAll('금속검출상태'), 'NO-SUCH'), base).key === 'idle');
    if (new Date().getTimezoneOffset() === -540) {                     // 브라우저가 KST 일 때만 «지금» 기준 비교가 의미 있다
      chk('화면(KST 환경): 서버수신시각과 실제 지금의 차이 < 1분(시간대 어긋남 없음) → 실시간 판정이 «정상»', Math.abs(Date.now() - base) < 60000 && M.metalConnState(st, Date.now()).key === 'ok', String(Date.now() - base));
    }
    await b.stop();
  } finally { await r.close(); }
});

scenario('8 수식 주입', async (chk) => {
  const r = await createRig({ count: 10 });
  try {
    const EVIL = '=1+1';
    const b = r.mk({ device: EVIL }).start();                          // 기기 이름(설정)이 수집기 → 시트로 흘러가는 유일한 문자열 경로
    chk('기기 이름이 «=1+1» 인 수집기의 이벤트가 적재된다', await waitFor(() => logRows(r.rcv, '수집기시작').length === 1 && r.rcv.count('금속검출상태') === 1));
    await b.stop();                                                    // 이후는 직접 POST 만 — 수집기 heartbeat 가 덮어쓰는 경쟁을 없앤다
    const send = (events, extra) => JSON.parse(r.rcv.post(JSON.stringify(Object.assign({ v: 1, token: TOKEN, device: EVIL, host: '=HYPERLINK("x")', collector: '=c', sentAt: '+x', events,
      status: { link: '=UP', total: '=1+1', product: '@x', flags: ['-1'], lastValidAt: '=now()', downSince: '+1', spool: '=1', bootAt: '-1' } }, extra))));
    const nowIso = kstStr(Date.now() - 1000).replace(' ', 'T') + '+09:00';         // 화면 요약은 «지금» 까지만 세므로 과거 시각이어야 한다
    const ok = send([{ id: '=id|1', t: nowIso, kind: 'RESET', total: 3, prev: 9, from: null, product: null, ch1: null, ch2: null, flags: [], downSec: null }]);
    chk('직접 POST: 수식처럼 보이는 id·host 도 적재(saved 1)', ok.ok === true && ok.saved === 1, JSON.stringify(ok));
    const badN = send([{ id: 'n1', t: '2026-10-05T10:20:33+09:00', kind: 'DETECT', n: '=1+1', total: 3, prev: 1 },
      { id: 'n2', t: '2026-10-05T10:20:33+09:00', kind: 'RESET', total: '=1+1' }, { id: 'n3', t: '=NOW()', kind: 'RESET' }]);
    chk('숫자 칸·시각 칸에 수식 문자열 → 전부 bad, 시트에 안 들어간다', badN.saved === 0 && badN.bad === 3 && !logRows(r.rcv).some(x => /^n[123]$/.test(x[14])), JSON.stringify(badN));
    await sleep(200);
    const sheetVal = (name, pred) => r.rcv.sheets[name].rows.some((row, ri) => ri > 0 && row.some(pred));
    chk('값은 글자 그대로 남는다(로그 L열 «=1+1» · 이벤트ID · host)',
      logRows(r.rcv).some(x => x[11] === EVIL) && sheetVal('금속검출로그', v => v === '=id|1') && sheetVal('금속검출로그', v => v === '=HYPERLINK("x")'));
    // 수식 시작 문자(= + - @) 로 시작하는 모든 문자열 셀은 텍스트 서식 '@' 안에 있어야 시트가 수식으로 해석하지 않는다
    const risky = name => {
      const sh = r.rcv.sheets[name], out = [];
      sh.rows.forEach((row, ri) => {
        if (ri === 0) return;
        row.forEach((v, ci) => { if (typeof v === 'string' && /^[=+\-@]/.test(v) && sh.fmt[(ri + 1) + ',' + (ci + 1)] !== '@') out.push(name + ' ' + (ri + 1) + '행 ' + 'ABCDEFGHIJKLMNO'[ci] + '열 ' + JSON.stringify(v)); });
      });
      return out;
    };
    chk('로그 시트: 수식 시작 문자열 셀은 모두 텍스트 서식(@)', risky('금속검출로그').length === 0, risky('금속검출로그').join('\n     '));
    chk('상태 시트: 수식 시작 문자열 셀은 모두 텍스트 서식(@) — 수식으로 해석되지 않는다', risky('금속검출상태').length === 0 && sheetVal('금속검출상태', v => v === '=1+1'), risky('금속검출상태').join('\n     '));
    let parsed = null, perr = null;
    try {
      parsed = { ev: screenEvents(r.rcv), st: screenStatus(r.rcv, EVIL), S: null };
      parsed.S = M.metalSummarize(parsed.ev, 0, 0, Date.now());
      M.metalConnState(parsed.st, Date.now());
    } catch (e) { perr = e; }
    chk('화면 파서가 깨지지 않는다(예외 없음)', !perr, perr && perr.message);
    chk('화면: 기기·id 가 글자 그대로 읽히고 요약이 계산된다', !!parsed && parsed.ev.some(e => e.device === EVIL) && parsed.ev.some(e => e.id === '=id|1') && parsed.st && parsed.st.device === EVIL && parsed.S.resets === 1,
      parsed && JSON.stringify(parsed.S));
  } finally { await r.close(); }
});

/* ───────────────── 실행 ───────────────── */
(async () => {
  const t0 = Date.now();
  const watchdog = setTimeout(() => { console.log('❌ 전체 제한시간(25초) 초과'); process.exit(1); }, 25000);
  watchdog.unref();
  console.log('── nmd530 종단 시험 (수집기 → 수신부 → 화면) ──');

  const todo = scenarios;
  const results = [];
  let next = 0;
  // 동시에 도는 시나리오 수를 제한한다: 수집기는 폴링마다 state.json 을 임시파일→rename 으로 쓰는데,
  // 윈도우에서 여럿이 동시에 쓰면 디스크 지연이 수 초로 번져 «통신끊김» 이 가짜로 터진다(수집기 결함이 아니라 시험 부하).
  const POOL = 3;
  const worker = async () => { while (next < todo.length) { const sc = todo[next++]; results.push(await runOne(sc)); } };
  /* 시험 프로세스 자체가 OS 때문에 0.3초 넘게 멈추면(다른 프로세스가 CPU·디스크를 잡을 때) 수집기는 규칙대로 «통신끊김» 을
     선언한다 — 수집기 결함이 아니라 시험 환경 정지다. 정지가 관측된 구간에서 실패한 시나리오만 최대 2번 다시 돌린다.
     정지가 없었던 실패(진짜 어긋남)는 재시도하지 않고, 정지가 있어도 결정적인 실패는 재시도해도 똑같이 남는다. */
  const stalls = []; let lastTick = Date.now();
  const lagTimer = setInterval(() => { const n = Date.now(); if (n - lastTick > 300) stalls.push({ to: n, ms: n - lastTick }); lastTick = n; }, 20);
  lagTimer.unref();
  async function runOne(sc) {
    const notes = [];
    for (let attempt = 0; ; attempt++) {
      const res = { name: sc.name, lines: [], pass: 0, fail: 0 };
      const chk = (name, cond, detail) => {
        if (cond) { res.pass++; res.lines.push('  ✅ ' + name); }
        else { res.fail++; res.lines.push('  ❌ ' + name + (detail ? '\n     ' + detail : '')); }
      };
      const startedAt = Date.now();
      try { await sc.fn(chk); }
      catch (e) { res.fail++; res.lines.push('  ❌ 시나리오 중 예외: ' + (e && e.stack || e)); }
      const hit = stalls.filter(x => x.to >= startedAt);
      if (res.fail && hit.length && attempt < 2) {
        notes.push('  ⚠ 시험 프로세스 정지 ' + hit.length + '회(최대 ' + Math.max(...hit.map(x => x.ms)) + 'ms) 중 실패 ' + res.fail + '건 → 시나리오 재시도');
        continue;
      }
      res.lines = notes.concat(res.lines);
      return res;
    }
  }
  await Promise.all(Array.from({ length: POOL }, worker));

  /* 9 와이어: 모든 시나리오의 가짜 검출기가 받은 바이트는 전부 02 00 06 33 03 34 뿐 */
  const w = { name: '9 와이어', lines: [], pass: 0, fail: 0 };
  {
    const want = codec.buildFrame(0x33), expectHex = '020006330334';
    let bytes = 0, frames = 0, badFrames = 0, odd = 0;
    for (const d of allDetectors) {
      const raw = d.rawRx(); bytes += raw.length;
      if (raw.length % 6) odd++;
      for (let i = 0; i + 6 <= raw.length; i += 6) { frames++; if (!raw.subarray(i, i + 6).equals(want)) badFrames++; }
    }
    const put = (name, cond, detail) => { if (cond) { w.pass++; w.lines.push('  ✅ ' + name); } else { w.fail++; w.lines.push('  ❌ ' + name + (detail ? '\n     ' + detail : '')); } };
    put('상태조회 프레임 계약값 == 02 00 06 33 03 34', want.toString('hex') === expectHex, want.toString('hex'));
    put('가짜 검출기 ' + allDetectors.length + '대가 받은 ' + bytes + '바이트(' + frames + '프레임)를 6바이트씩 자르면 전부 02 00 06 33 03 34', bytes > 0 && badFrames === 0 && odd === 0, 'bad=' + badFrames + ' odd=' + odd);
    const all = Buffer.concat(allDetectors.map(d => d.rawRx()));
    let has60 = false, has3a = false;
    for (let i = 0; i + 6 <= all.length; i += 6) { if (all[i + 3] === 0x60) has60 = true; if (all[i + 3] === 0x3a) has3a = true; }
    put('제품변경(0x60)·대량이력(0x3A) 프레임 0건', !has60 && !has3a);
  }
  results.push(w);

  let pass = 0, fail = 0;
  for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log('\n[' + r.name + ']  단언 ' + (r.pass + r.fail) + '개');
    r.lines.forEach(l => console.log(l));
    pass += r.pass; fail += r.fail;
  }
  console.log('\n시나리오별 단언 수: ' + results.map(r => r.name + '=' + (r.pass + r.fail)).join(' · '));
  console.log('결과: ' + pass + ' passed, ' + fail + ' failed (' + ((Date.now() - t0) / 1000).toFixed(1) + '초)');
  process.exitCode = fail ? 1 : 0;       // process.exit 를 쓰지 않는다 — 남는 핸들이 있으면 프로세스가 안 끝나서 드러난다
})().catch(e => { console.log('❌ 시험 중 예외: ' + (e && e.stack || e)); process.exitCode = 1; });
