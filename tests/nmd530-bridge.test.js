/* NMD-530 수집기(bridge/nmd530-bridge.js) 시험 — 가짜 검출기(TCP) + 가짜 웹앱(HTTP)을 같은 프로세스에 띄워
   계약서 §8·§11 을 짧은 간격(poll 25ms · 끊김 판정 250ms · heartbeat 80ms)으로 확인한다.
   서버는 모두 포트 0(임시 포트)이라 다른 시험과 동시에 돌아도 겹치지 않는다.

   실행:  node tests/nmd530-bridge.test.js      실패하면 assert 로 즉시 중단 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BRIDGE = path.join(__dirname, '..', 'bridge', 'nmd530-bridge.js');
const { createBridge, parseConfig, ALLOWED_CMDS, checkCmdConstants, testKit } = require(BRIDGE);
const { kstIso } = require(path.join(__dirname, '..', 'bridge', 'nmd530-counter.js'));
const { runScenarios, createRig, waitFor, sleep } = testKit;

let passed = 0;
function ok(name, cond, detail) {
  if (!cond) { console.log('  ❌ ' + name + (detail ? '\n     ' + detail : '')); process.exit(1); }
  passed++; console.log('  ✅ ' + name);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nmd530-t-'));

(async () => {
  const t0 = Date.now();
  console.log('── nmd530-bridge 시험 ──');

  /* 1) §11 시나리오 전체 (selftest 와 같은 시나리오 함수) */
  await runScenarios((name, cond, detail) => ok(name, cond, detail));

  /* 2) 송신 허용 목록 */
  {
    const b = createBridge({ endpoint: 'http://127.0.0.1:1/', token: 'x', stateDir: tmp(), quiet: true });
    ok('허용 목록은 정확히 {0x33, 0x2A}', ALLOWED_CMDS.size === 2 && ALLOWED_CMDS.has(0x33) && ALLOWED_CMDS.has(0x2a));
    for (const cmd of [0x60, 0x3a, 0x34, 0x35, 0x00, 0xff, 0x133, NaN, undefined]) {
      let err = null;
      try { b.sendCmd(cmd); } catch (e) { err = e; }
      ok('sendCmd(' + (typeof cmd === 'number' ? '0x' + cmd.toString(16) : cmd) + ') 는 예외', !!err);
    }
    ok('허용 명령(0x33·0x2A)은 접속 전이라 false (예외 아님)', b.sendCmd(0x33) === false && b.sendCmd(0x2a) === false);
  }
  {
    // 소스에 제품변경·대량이력 명령이 «호출 형태로» 없는지 (주석 제거 사본)
    const src = fs.readFileSync(BRIDGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    ok('수집기 소스에 CMD.PRODUCT_CHG / CMD.HISTORY 참조가 없다', !/CMD\.(PRODUCT_CHG|HISTORY)/.test(src));
    ok('수집기 소스에 0x60 / 0x3a 리터럴이 없다', !/0x60\b|0x3a\b/i.test(src));
  }

  /* 3) 설정 우선순위 · 토큰은 플래그로 받지 않는다 */
  {
    let err = null;
    try { parseConfig(['--token', 'SECRET', '--endpoint', 'http://x/']); } catch (e) { err = e; }
    ok('--token 플래그는 거부', !!err && /알 수 없는 플래그/.test(err.message));
    ok('거부 메시지에 토큰 값이 새지 않는다', !err.message.includes('SECRET'));
    err = null;
    try { parseConfig(['--token=SECRET']); } catch (e) { err = e; }
    ok('--token=값 형태도 거부(값 비노출)', !!err && !err.message.includes('SECRET'));
    err = null;
    try { parseConfig(['--nonsense']); } catch (e) { err = e; }
    ok('알 수 없는 플래그 거부', !!err);

    const file = JSON.stringify({ host: '10.0.0.1', port: 7000, endpoint: 'http://file/', token: 'FILE', device: 'FILE-DEV' });
    const rd = () => file;
    let c = parseConfig([], {}, rd);
    ok('기본값', c.host === '192.168.0.5' && c.port === 8000 && c.device === 'NMD530-1' && c.intervalMs === 3000 &&
      c.heartbeatMs === 60000 && c.downAfterMs === 30000 && c.stateDir === path.join(path.dirname(BRIDGE), 'nmd530-data') && c.token === '');
    ok('C8 기본 stateDir 은 스크립트 폴더 기준 절대경로(cwd 와 무관)', path.isAbsolute(c.stateDir));
    c = parseConfig(['--config', 'x.json'], {}, rd);
    ok('--config JSON 이 기본값을 덮음', c.host === '10.0.0.1' && c.port === 7000 && c.token === 'FILE' && c.endpoint === 'http://file/');
    c = parseConfig(['--config', 'x.json'], { NMD530_ENDPOINT: 'http://env/', NMD530_TOKEN: 'ENV' }, rd);
    ok('환경변수가 --config 를 덮음(토큰 포함)', c.endpoint === 'http://env/' && c.token === 'ENV' && c.host === '10.0.0.1');
    c = parseConfig(['--config=x.json', '--endpoint', 'http://flag/', '--host=1.2.3.4', '--port', '9', '--device', 'D9',
      '--interval', '100', '--heartbeat', '200', '--down-after', '300', '--state-dir', 'sd', '--dry'],
      { NMD530_ENDPOINT: 'http://env/', NMD530_TOKEN: 'ENV' }, rd);
    ok('플래그가 환경변수·--config 를 덮음', c.endpoint === 'http://flag/' && c.host === '1.2.3.4' && c.port === 9 && c.device === 'D9' &&
      c.intervalMs === 100 && c.heartbeatMs === 200 && c.downAfterMs === 300 && c.stateDir === 'sd' && c.dry === true && c.token === 'ENV');
    const b = createBridge({ endpoint: 'http://e/', token: 'SECRET', stateDir: tmp(), quiet: true });
    ok('수집기 객체의 노출용 설정에 토큰 원문이 없다', !JSON.stringify(b.config).includes('SECRET'));
    let e2 = null;
    try { createBridge({ endpoint: '', token: 'x', stateDir: tmp() }); } catch (e) { e2 = e; }
    ok('전송 모드에서 endpoint 없으면 시작 거부', !!e2);
  }

  /* 4) --dry: 네트워크 전송이 없다 */
  {
    const r = await createRig({ count: 3 });
    const lines = [];
    const b = r.mk({ dry: true, endpoint: '', token: '', out: s => lines.push(s) }).start();
    ok('dry: 표준출력으로 payload 를 낸다(COLLECTOR_START 포함, 토큰 생략)',
      await waitFor(() => lines.some(l => l.includes('COLLECTOR_START')), 3000) && !lines.some(l => l.includes('"token":"T"')));
    r.det.inc(1);
    ok('dry: 검출 이벤트도 출력', await waitFor(() => lines.some(l => l.includes('"kind":"DETECT"')), 3000));
    await sleep(250);
    ok('dry: 같은 이벤트를 되풀이 출력하지 않는다', lines.filter(l => l.includes('COLLECTOR_START')).length === 1);
    ok('dry: 웹앱으로 가는 전송이 0건', r.web.posts === 0 && r.web.echoGets === 0);
    await b.stop();
    ok('C11 dry: 스풀·상태 파일을 쓰지 않는다(출력만)',
      !fs.existsSync(path.join(r.stateDir, 'spool.jsonl')) && !fs.existsSync(path.join(r.stateDir, 'state.json')));
    await r.close();
  }

  /* 4b) --dry 는 이미 있는 스풀·상태 파일도 고치지 않는다 (줄바꿈 없는 스풀 끝 · 깨진 state.json) */
  {
    const r = await createRig({ count: 3 });
    const spoolFile = path.join(r.stateDir, 'spool.jsonl');
    const stateFile = path.join(r.stateDir, 'state.json');
    const spoolText = JSON.stringify({ id: 'NMD530-T|old|0001', t: '2026-10-05T10:00:00+09:00', kind: 'DETECT', n: 1, total: 2 });  // 끝에 줄바꿈 없음
    const stateText = '{"lastTotal": 3, "seq":';                                                                                  // 잘린 JSON
    fs.writeFileSync(spoolFile, spoolText);
    fs.writeFileSync(stateFile, stateText);
    const lines = [];
    const b = r.mk({ dry: true, endpoint: '', token: '', out: s => lines.push(s) }).start();
    ok('dry(기존 파일): 시작해 첫 관측을 출력한다', await waitFor(() => lines.some(l => l.includes('COLLECTOR_START')), 3000));
    await b.stop();
    ok('dry: 기존 파일을 건드리지 않는다 — 스풀 끝에 줄바꿈을 붙이지 않고 깨진 state.json 도 그대로',
      fs.readFileSync(spoolFile, 'utf8') === spoolText && fs.readFileSync(stateFile, 'utf8') === stateText &&
      !fs.readdirSync(r.stateDir).some(n => /\.corrupt-/.test(n)));
    await r.close();
  }

  /* 5) 스풀: 쓰기 선행 · 웹앱 불통 중에도 폴링 계속 · 복구 뒤 전송 · 깨진 줄 무시 */
  {
    const r = await createRig({ count: 1 });
    r.web.mode = 'down';
    let b = r.mk().start();
    const spoolFile = path.join(r.stateDir, 'spool.jsonl');
    await waitFor(() => fs.existsSync(spoolFile) && /COLLECTOR_START/.test(fs.readFileSync(spoolFile, 'utf8')), 3000);
    r.det.inc(1);
    ok('웹앱 불통: 이벤트가 스풀 파일에 먼저 쌓인다',
      await waitFor(() => fs.existsSync(spoolFile) && /DETECT/.test(fs.readFileSync(spoolFile, 'utf8')), 3000));
    r.det.inc(1);
    ok('웹앱 불통: 폴링은 계속돼 다음 검출도 계수', await waitFor(() => b.snapshot().lastTotal === 3, 3000));
    ok('웹앱 불통: 서버에는 아무것도 적재되지 않음', r.web.ids.size === 0);
    await b.stop();
    fs.appendFileSync(spoolFile, '{"id":"끊긴 줄');       // 전원 차단 중 쓰던 줄 흉내
    r.web.mode = 'direct';
    b = r.mk().start();
    ok('복구 뒤 스풀 이벤트가 순서대로 전송되고 깨진 줄은 무시',
      await waitFor(() => r.web.events.filter(e => e.kind === 'DETECT').length === 2, 3000) && await waitFor(() => b.snapshot().spool === 0, 3000));
    const ids = r.web.events.map(e => e.id);
    ok('전송 순서 = 발생 순서(seq 오름차순)', ids.length === 4 && ids.every((id, i) => i === 0 || id.split('|')[2] > ids[i - 1].split('|')[2]));
    await b.stop();
    await r.close();
  }

  /* ── 수집기 결함 수정 시험 (C1·C3~C9·C12) ── */

  /* C1) 끊김이 이어지는 동안 소켓을 계속 다시 파기 — 침묵하는 재접속 소켓에 영구히 머물지 않는다 */
  {
    const r = await createRig({ count: 5 });
    r.det.mute(true);                                  // TCP 는 붙지만 응답이 없는 검출기
    const b = r.mk().start();
    ok('C1 응답이 없으면 LINK_DOWN 선언', await waitFor(() => r.web.has(e => e.kind === 'LINK_DOWN'), 3000));
    const c0 = r.det.conns();
    ok('C1 재접속한 소켓이 침묵해도 downAfterMs 마다 또 파기·재접속(접속 +3 이상)',
      await waitFor(() => r.det.conns() >= c0 + 3, 4000), 'conns ' + c0 + ' → ' + r.det.conns());
    await sleep(120);
    ok('C1 LINK_DOWN 이벤트는 한 번만(중복 없음)', r.web.events.filter(e => e.kind === 'LINK_DOWN').length === 1);
    await b.stop();
    await r.close();
  }

  /* C12) 미응답 요청 상한 3 */
  {
    const r = await createRig({ count: 5 });
    r.det.mute(true);
    const b = r.mk({ downAfterMs: 60000 }).start();    // 재접속이 끼지 않게 끊김 판정을 늦춘다
    await sleep(500);                                  // 폴링 약 20번 분량
    const n33 = r.det.cmds.filter(c => c === 0x33).length;
    ok('C12 응답이 없으면 0x33 요청이 3개를 넘어 나가지 않는다', n33 >= 1 && n33 <= 3, 'n33=' + n33);
    await b.stop();
    await r.close();
  }

  /* C4) 비정상 종료 복구 — 스풀에만 있는 DETECT 가 GAP 으로 또 세어지지 않는다 */
  {
    const r = await createRig({ count: 7 });
    const nowMs = Date.now();
    fs.writeFileSync(path.join(r.stateDir, 'state.json'), JSON.stringify({ lastTotal: 5, lastValidAt: nowMs - 60000, seq: 2 }));
    const ev = { id: 'NMD530-T|B0|0003', t: kstIso(nowMs - 1000), kind: 'DETECT', n: 2, total: 7, prev: 5, from: kstIso(nowMs - 4000),
      product: 1, ch1: 90, ch2: 0, flags: [], downSec: null };
    fs.writeFileSync(path.join(r.stateDir, 'spool.jsonl'), JSON.stringify(ev) + '\n');
    const b = r.mk().start();
    ok('C4 시작 시 스풀 이벤트가 전송된다', await waitFor(() => r.web.has(e => e.id === ev.id), 3000));
    ok('C4 시작 이벤트 적재', await waitFor(() => r.web.has(e => e.kind === 'COLLECTOR_START'), 3000));
    await sleep(150);
    ok('C4 스풀 total=7 이 상태보다 앞서 있으면 끌어올려 GAP 이 또 생기지 않는다', !r.web.has(e => e.kind === 'GAP'));
    ok('C4 seq 도 스풀 기준으로 이어진다(COLLECTOR_START 가 0004)',
      r.web.events.find(e => e.kind === 'COLLECTOR_START').id.endsWith('|0004'));
    ok('C3 멀쩡한 상태 파일은 corrupt 로 옮기지 않는다', !fs.readdirSync(r.stateDir).some(n => n.startsWith('state.json.corrupt-')));
    await b.stop();
    await r.close();
  }

  /* C3) 상태 파일 손상 — 조용히 무시하지 않고 보존 + 크게 알림 */
  for (const [label, content] of [['JSON 깨짐', '{"lastTotal":'], ['필수 필드 이상', '{"lastTotal":"abc","seq":1}'], ['0바이트', '']]) {
    const r = await createRig({ count: 5 });
    fs.writeFileSync(path.join(r.stateDir, 'state.json'), content);
    const b = r.mk().start();
    await waitFor(() => r.web.has(e => e.kind === 'COLLECTOR_START'), 3000);
    const kept = fs.readdirSync(r.stateDir).filter(n => n.startsWith('state.json.corrupt-'));
    ok('C3 ' + label + ': state.json.corrupt-<KST시각> 으로 원본 보존',
      kept.length === 1 && /^state\.json\.corrupt-\d{8}T\d{6}$/.test(kept[0]) && fs.readFileSync(path.join(r.stateDir, kept[0]), 'utf8') === content, kept.join(','));
    ok('C3 ' + label + ': 로그에 ⚠⚠ 로 크게 남김', fs.readFileSync(path.join(r.stateDir, 'bridge.log'), 'utf8').includes('⚠⚠ state.json'));
    ok('C3 ' + label + ': 첫 관측으로 시작(COLLECTOR_START.from 없음)', r.web.events.find(e => e.kind === 'COLLECTOR_START').from === null);
    await b.stop();
    await r.close();
  }

  /* C5) 서버가 거른 이벤트(badIdx) → rejected.jsonl */
  {
    const r = await createRig({ count: 5 });
    r.web.rejectPred = e => e.kind === 'DETECT';
    const b = r.mk().start();
    await waitFor(() => r.web.has(e => e.kind === 'COLLECTOR_START'), 3000);
    r.det.inc(1);
    const rej = path.join(r.stateDir, 'rejected.jsonl');
    ok('C5 badIdx 이벤트가 rejected.jsonl 에 {at, ev} 로 보관', await waitFor(() => fs.existsSync(rej) && fs.readFileSync(rej, 'utf8').includes('"DETECT"'), 3000));
    const line = JSON.parse(fs.readFileSync(rej, 'utf8').trim().split('\n')[0]);
    ok('C5 rejected 줄 모양 {at: 문자열, ev: 이벤트}', typeof line.at === 'string' && line.ev && line.ev.kind === 'DETECT' && typeof line.ev.id === 'string');
    ok('C5 나머지는 확인 처리되어 스풀이 빈다', await waitFor(() => b.snapshot().spool === 0, 3000));
    await sleep(250);
    ok('C5 거른 이벤트는 재전송하지 않는다(한 번만 POST)', r.web.idPosts.get(line.ev.id) === 1, String(r.web.idPosts.get(line.ev.id)));
    ok('C5 나머지(COLLECTOR_START)는 적재됨, 거른 건 적재 안 됨', r.web.has(e => e.kind === 'COLLECTOR_START') && !r.web.ids.has(line.ev.id));
    ok('C5 로그에 «서버가 거른 이벤트 1건 → rejected.jsonl»',
      fs.readFileSync(path.join(r.stateDir, 'bridge.log'), 'utf8').includes('⚠ 서버가 거른 이벤트 1건 → rejected.jsonl'));
    await b.stop();
    await r.close();
  }
  {
    const r = await createRig({ count: 5 });
    r.web.junkBadIdx = [99, -1, 1.5, 'x'];             // 범위 밖·비정수 위치는 무시(예외 금지)
    const b = r.mk().start();
    ok('C5 범위 밖 badIdx 는 무시하고 평소처럼 확인 처리', await waitFor(() => r.web.has(e => e.kind === 'COLLECTOR_START'), 3000) && await waitFor(() => b.snapshot().spool === 0, 3000));
    ok('C5 범위 밖 badIdx 로는 rejected.jsonl 이 생기지 않는다', !fs.existsSync(path.join(r.stateDir, 'rejected.jsonl')));
    await b.stop();
    await r.close();
  }

  /* C6) 스풀 마지막 줄이 줄바꿈 없이 잘렸으면 줄바꿈을 붙여 복구 — 새 이벤트가 이어붙지 않는다 */
  {
    const r = await createRig({ count: 5 });
    r.web.mode = 'down';                               // 스풀이 비워지지 않게
    const spoolFile = path.join(r.stateDir, 'spool.jsonl');
    fs.writeFileSync(spoolFile, '{"id":"끊긴 줄');
    const b = r.mk().start();
    await waitFor(() => /COLLECTOR_START/.test(fs.readFileSync(spoolFile, 'utf8')), 3000);
    await b.stop();
    const lines = fs.readFileSync(spoolFile, 'utf8').split('\n');
    ok('C6 잘린 조각은 제 줄에 그대로 남는다', lines[0] === '{"id":"끊긴 줄');
    ok('C6 새 이벤트는 따로 한 줄로 읽힌다', lines.some(l => { try { return JSON.parse(l).kind === 'COLLECTOR_START'; } catch (e) { return false; } }));
    await r.close();
  }

  /* C7·C8) 설정: 오류 메시지 비노출 · device 검증 · stateDir */
  {
    let err = null;
    try { parseConfig(['--config', 'x.json'], {}, () => 'token=SECRETTOKEN123'); } catch (e) { err = e; }
    ok('C7 깨진 설정 JSON 오류에 파일 내용(토큰)이 없다', !!err && !err.message.includes('SECRETTOKEN123') && !err.message.includes('token='), err && err.message);
    err = null;
    try { parseConfig(['--config', 'x.json'], {}, () => '{"token":"SECRETTOKEN123",'); } catch (e) { err = e; }
    ok('C7 잘린 JSON 도 마찬가지', !!err && !err.message.includes('SECRETTOKEN123'), err && err.message);
    err = null;
    try { parseConfig(['--config', 'x.json'], {}, () => { const e = new Error('boom SECRETTOKEN123'); e.code = 'ENOENT'; throw e; }); } catch (e) { err = e; }
    ok('C7 읽기 실패는 원인 코드만 싣는다', !!err && err.message.includes('ENOENT') && !err.message.includes('SECRETTOKEN123'), err && err.message);

    for (const bad of ['a b', 'x'.repeat(41), 'tab\tx']) {
      err = null;
      try { parseConfig(['--device', bad]); } catch (e) { err = e; }
      ok('C8 device 검증 거부: ' + JSON.stringify(bad.length > 10 ? bad.length + '자' : bad), !!err && /device/.test(err.message));
    }
    err = null;
    try { parseConfig(['--config', 'x.json'], {}, () => '{"device":123}'); } catch (e) { err = e; }
    ok('C8 device 가 문자열이 아니면 거부', !!err);
    ok('C8 device 40자·공백 없음은 허용', parseConfig(['--device', 'x'.repeat(40)]).device.length === 40);
    const cp = require('child_process').spawnSync(process.execPath, [BRIDGE, '--device', 'a b'], { encoding: 'utf8' });
    ok('C8 잘못된 device 로 실행하면 종료코드 2 + 안내', cp.status === 2 && /device/.test(cp.stderr), 'status=' + cp.status + ' ' + cp.stderr);
    const rel = createBridge({ endpoint: 'http://e/', token: 'x', stateDir: 'rel-sd-nonexistent', quiet: true });
    ok('C8 상대 stateDir 은 cwd 기준 절대경로로 푼다', rel.paths.state === path.resolve('rel-sd-nonexistent', 'state.json'));
  }

  /* C9) 허용 명령은 리터럴 + codec 상수 단언 */
  {
    const codec = require(path.join(__dirname, '..', 'bridge', 'nmd530-codec.js'));
    const src = fs.readFileSync(BRIDGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    ok('C9 허용 명령 집합은 new Set([0x33, 0x2A]) 리터럴', /ALLOWED_CMDS\s*=\s*new Set\(\[0x33,\s*0x2A\]\)/.test(src));
    ok('C9 ALLOWED_CMDS 는 정확히 {0x33, 0x2A}', [...ALLOWED_CMDS].sort().join() === '42,51');
    let threw = 0;
    checkCmdConstants(codec.CMD);                      // 정상이면 조용
    for (const bad of [{ STATUS_REQ: 0x34, VERSION_REQ: 0x2a }, { STATUS_REQ: 0x33 }, {}, null]) {
      try { checkCmdConstants(bad); } catch (e) { threw++; }
    }
    ok('C9 상수가 어긋나면 checkCmdConstants 가 throw', threw === 4, 'threw=' + threw);
    const r = await createRig({ count: 1 });
    const keep = codec.CMD.VERSION_REQ;
    let err = null;
    try { codec.CMD.VERSION_REQ = 0x2b; r.mk().start(); } catch (e) { err = e; } finally { codec.CMD.VERSION_REQ = keep; }
    ok('C9 start() 가 어긋난 codec 상수를 만나면 throw(잠금도 풀림)', !!err && !fs.existsSync(path.join(r.stateDir, 'bridge.lock')));
    await r.close();
  }

  /* 6) 낡은 잠금(죽은 PID)은 인수 · 로그 회전 */
  {
    const r = await createRig({ count: 1 });
    fs.writeFileSync(path.join(r.stateDir, 'bridge.lock'), '99999999');
    let b = null, err = null;
    try { b = r.mk().start(); } catch (e) { err = e; }
    ok('죽은 PID 의 낡은 잠금은 넘겨받는다', !err && !!b);
    await b.stop();
    ok('종료하면 잠금 파일이 지워진다', !fs.existsSync(path.join(r.stateDir, 'bridge.lock')));
    // 로그 회전: 1 MB 직전인 로그에서 시작 → 회전, 최대 3개 유지
    const lg = path.join(r.stateDir, 'bridge.log');
    fs.writeFileSync(lg, 'x'.repeat(1048560) + '\n'); fs.writeFileSync(lg + '.1', 'old1'); fs.writeFileSync(lg + '.2', 'old2');
    b = r.mk().start();
    await sleep(200);
    await b.stop();
    ok('로그 1MB 도달 시 회전(.1 생성, 새 로그는 작다)', fs.existsSync(lg + '.1') && fs.statSync(lg).size < 100000 && fs.readFileSync(lg + '.1', 'utf8').startsWith('xxxx'));
    ok('로그는 최대 3개(.3 은 만들지 않음)', !fs.existsSync(lg + '.3'));
    await r.close();
  }

  /* 7) 깨진 프레임(LRC 불일치)은 «유효 응답» 이 아니다 — 명령·데이터가 정상 모양이어도 계수하지 않는다 */
  {
    const r = await createRig({ count: 3 });
    const b = r.mk().start();
    await waitFor(() => r.web.has(e => e.kind === 'COLLECTOR_START'), 3000);
    r.det.corrupt(true);
    r.det.inc(2);                                      // 깨진 응답이 실어 나르는 누적값은 5
    ok('프레임 오류만 오면 끊김 판정 (깨진 응답은 생존 신호가 아니다)', await waitFor(() => r.web.has(e => e.kind === 'LINK_DOWN'), 3000));
    ok('깨진 응답의 누적값(5)은 검출로 세지 않는다', !r.web.has(e => e.kind === 'DETECT') && b.snapshot().lastTotal === 3, 'lastTotal=' + b.snapshot().lastTotal);
    r.det.corrupt(false);
    ok('정상 응답이 돌아오면 그때 복구 + 증가분은 시각 미상(GAP)으로 한 번만',
      await waitFor(() => r.web.has(e => e.kind === 'LINK_UP') && r.web.events.filter(e => e.kind === 'GAP').length === 1, 3000) &&
      r.web.events.find(e => e.kind === 'GAP').n === 2);
    await b.stop();
    await r.close();
  }

  /* 7b) 간헐적으로 깨진 응답이 미응답 요청을 쌓아 폴링을 멎게 하지 않는다 */
  {
    const r = await createRig({ count: 3 });
    const b = r.mk({ downAfterMs: 60000 }).start();    // 끊김 판정·재접속이 끼지 않게 늦춘다
    await waitFor(() => r.web.has(e => e.kind === 'COLLECTOR_START'), 3000);
    r.det.corrupt(true);
    await sleep(300);                                  // 깨진 응답이 미응답 상한(3)을 넘겨 오도록
    r.det.corrupt(false);
    r.det.inc(1);
    ok('7b 깨진 응답이 여러 번 온 뒤에도 폴링이 이어져 다음 검출을 DETECT 로 센다',
      await waitFor(() => r.web.has(e => e.kind === 'DETECT' && e.n === 1 && e.total === 4), 3000), 'lastTotal=' + b.snapshot().lastTotal);
    await b.stop();
    await r.close();
  }

  /* 7c) 재접속 백오프는 TCP 가 붙었다고 되돌리지 않는다 — 붙었다 곧 끊기는(응답 없는) 장비에 매달리지 않는다 */
  {
    const r = await createRig({ count: 3 });
    r.det.mute(true);
    const b = r.mk({ downAfterMs: 60000 }).start();
    const t0 = Date.now(), c0 = r.det.conns();
    while (Date.now() - t0 < 1200) { r.det.dropClients(); await sleep(8); }
    const n = r.det.conns() - c0;
    ok('7c 응답 없이 끊기는 장비에는 백오프가 커져 재접속이 드물다(1.2초 동안 12회 미만)', n < 12, 'conns=' + n);
    await b.stop();
    await r.close();
  }

  /* 7d) 서버가 거른 건수가 badIdx 로 설명되는 건수보다 크면 따로 경고 */
  {
    const r = await createRig({ count: 3 });
    r.web.extraBad = 2;                                // bad=2 인데 위치는 모름
    const b = r.mk().start();
    await waitFor(() => r.web.has(e => e.kind === 'COLLECTOR_START'), 3000);
    await waitFor(() => b.snapshot().spool === 0, 3000);
    ok('7d 위치를 모르는 bad 가 있으면 로그에 경고',
      fs.readFileSync(path.join(r.stateDir, 'bridge.log'), 'utf8').includes('위치(badIdx)를 모르는 것 2건'));
    await b.stop();
    await r.close();
  }

  /* 8) 전송 배치는 50건 이하 — 밀린 스풀을 한 요청에 통째로 보내지 않는다 (계약서 §5) */
  {
    const r = await createRig({ count: 1 });
    const spoolFile = path.join(r.stateDir, 'spool.jsonl');
    const seed = [];
    for (let i = 1; i <= 120; i++) seed.push(JSON.stringify({ id: 'NMD530-T|seed|' + String(i).padStart(4, '0'), t: '2026-10-05T10:00:00+09:00', kind: 'DETECT', n: 1, total: 1 + i }));
    fs.writeFileSync(spoolFile, seed.join('\n') + '\n');
    const b = r.mk().start();
    ok('밀린 스풀 120건이 모두 적재된다', await waitFor(() => r.web.events.filter(e => /\|seed\|/.test(e.id)).length === 120, 5000), 'saved=' + r.web.events.length);
    ok('한 요청의 이벤트는 50건 이하 (배치 ' + r.web.batchSizes.join(',') + ')', r.web.batchSizes.length >= 3 && Math.max.apply(null, r.web.batchSizes) <= 50);
    await b.stop();
    await r.close();
  }


  console.log('\n통과 ' + passed + '종 (' + ((Date.now() - t0) / 1000).toFixed(1) + '초)');
  process.exit(0);
})().catch(e => { console.log('❌ 시험 중 예외: ' + (e && e.stack || e)); process.exit(1); });
