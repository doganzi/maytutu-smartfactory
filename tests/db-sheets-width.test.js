/* DB_SHEETS 머리글 폭 ↔ 앱이 실제로 쓰는 열 수 계약 시험 + «투명 버튼» 가드

   실행:  node tests/db-sheets-width.test.js      실패하면 assert 로 즉시 중단
   근거:  DB_SHEETS 는 db-browser(관리자 DB 직접 조회·편집) 화면의 머리글 표다. 정의가 실제보다 짧으면 그
          화면에서 뒤 열이 통째로 안 보이고(입고기록 9/12 · 거래처 5/7), 라벨이 밀리면 값이 엉뚱한 칸 이름
          아래 뜬다(소모품LOT[6]). 앱이 쓰는 열(append 폭 · updateRow 키 · batchUpdate 열 문자)을 코드에서
          그대로 세어 정의와 대조한다 — 사본·하드코딩 표를 두지 않는다.
   방식:  index.html 을 «주석 걷어낸 사본» 으로 만들어 검사한다(주석 속 옛 정의·옛 클래스가 시험을 초록으로
          만들지 못하게). 사본이 문법적으로 온전한지(vm.Script)도 단언해, 걷어내기가 문자열 경계를 깨뜨린
          채 «통과» 하는 일을 막는다. 검출기 자체도 합성 입력으로 먼저 시험한다(아무것도 못 잡는 검출기 방지). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r/g, '');

// ── 주석 걷어내기 ─────────────────────────────────────────────
// JS: 줄·블록 주석 제거(줄바꿈은 남겨 줄 번호 유지) · 문자열/템플릿(${ } 중첩)/정규식 리터럴 안은 건드리지 않는다.
function stripJs(src) {
  let out = '';
  const st = ['code'], braces = [];
  const prevSig = () => { const t = out.replace(/\s+$/, ''); return t.slice(-1); };
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1], top = st[st.length - 1];
    if (top === 'tpl') {
      if (c === '\\') { out += c + (d === undefined ? '' : d); i++; continue; }
      if (c === '`') { st.pop(); out += c; continue; }
      if (c === '$' && d === '{') { st.push('expr'); braces.push(0); out += '${'; i++; continue; }
      out += c; continue;
    }
    if (c === '/' && d === '/') { while (i + 1 < src.length && src[i + 1] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      assert.notStrictEqual(j, -1, '닫히지 않은 블록 주석');
      out += src.slice(i, j + 2).replace(/[^\n]/g, '');
      i = j + 1; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j; continue;
    }
    if (c === '`') { st.push('tpl'); out += c; continue; }
    if (top === 'expr') {
      if (c === '{') braces[braces.length - 1]++;
      else if (c === '}') {
        if (braces[braces.length - 1] === 0) { st.pop(); braces.pop(); out += c; continue; }
        braces[braces.length - 1]--;
      }
    }
    if (c === '/') {
      const p = prevSig();
      if (p === '' || '(,=:[!&|?{};+-*%<>~^'.includes(p) || /\b(return|typeof)$/.test(out.replace(/\s+$/, ''))) {
        let j = i + 1, inCls = false;
        while (j < src.length) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inCls = true; else if (src[j] === ']') inCls = false;
          else if (src[j] === '/' && !inCls) break;
          j++;
        }
        while (/[a-z]/i.test(src[j + 1] || '')) j++;      // 플래그
        out += src.slice(i, j + 1); i = j; continue;
      }
    }
    out += c;
  }
  return out;
}
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
const stripStyle = (s) => s.replace(/<style[\s\S]*?<\/style>/g, (m) => m.replace(/[^\n]/g, ''));

const sStart = RAW.indexOf('<script>\n');
const sEnd = RAW.lastIndexOf('</script>');
assert.ok(sStart > 0 && sEnd > sStart, 'index.html 의 본 스크립트 구간(<script> … </script>)을 찾지 못함');
const MARKUP = stripHtmlComments(RAW.slice(0, sStart));                                   // 정적 마크업(스타일 포함)
// JS 주석을 먼저 걷고 HTML 주석(템플릿 문자열 속 <!-- -->)은 나중에 — 거꾸로 하면 JS 주석 속 «<!--» 가 코드를 삼킨다.
// 정규식/나눗셈 판정은 직전 글자 휴리스틱이라 틀릴 수 있다 — 그 경우 아래 vm.Script 단언이 대부분 잡는다.
const JS = stripHtmlComments(stripJs(RAW.slice(sStart + '<script>\n'.length, sEnd)));      // 주석 걷어낸 본 스크립트
assert.doesNotThrow(() => new vm.Script(JS, { filename: 'index.html#script(stripped)' }),
  '주석 걷어낸 사본이 문법적으로 온전하지 않음 — stripJs 가 문자열/템플릿 경계를 깨뜨렸다');

// ── 괄호 균형 · 최상위 쉼표 분리 ──────────────────────────────
function balanced(s, openIdx) {
  const open = s[openIdx], close = { '[': ']', '{': '}', '(': ')' }[open];
  let depth = 0, q = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}
function topSplit(body) {
  const out = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) { cur += c; if (c === '\\') { cur += body[++i]; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

// ── DB_SHEETS 정의 읽기 (식별자 참조는 같은 파일의 const 배열에서 풀어 센다) ──
function readDbSheets(js) {
  const at = js.indexOf('const DB_SHEETS = {');
  assert.notStrictEqual(at, -1, 'DB_SHEETS 정의를 찾지 못함');
  const open = js.indexOf('{', at), close = balanced(js, open);
  const defs = {};
  for (const ent of topSplit(js.slice(open + 1, close))) {
    const m = ent.match(/^'([^']+)'\s*:\s*([\s\S]+)$/);
    assert.ok(m, `DB_SHEETS 항목을 읽지 못함: ${ent.slice(0, 40)}`);
    let rhs = m[2].trim();
    if (/^[A-Z_]+$/.test(rhs)) {                                   // FG_SHEET_HEADER 등
      const d = js.match(new RegExp(`const ${rhs}\\s*=\\s*\\[`));
      assert.ok(d, `${rhs} 정의를 찾지 못함`);
      const s = d.index + d[0].length - 1;
      rhs = js.slice(s, balanced(js, s) + 1);
    }
    assert.ok(rhs.startsWith('['), `${m[1]}: 배열이 아님`);
    defs[m[1]] = topSplit(rhs.slice(1, -1)).map((x) => x.replace(/^'|'$/g, ''));
  }
  return defs;
}

// ── 앱이 실제로 쓰는 열: append 폭 · updateRow 키 · batchUpdate 열 문자 ──
function scanWrites(js) {
  const appends = [], updates = [], ranges = [];
  let m;
  const reA = /SheetsAPI\.append\(\s*'([^']+)'\s*,\s*\[/g;                // 탭이 리터럴 + 행이 배열 리터럴인 것만
  while ((m = reA.exec(js))) {
    const s = m.index + m[0].length - 1;
    const parts = topSplit(js.slice(s + 1, balanced(js, s)));
    if (parts.length && parts[0].startsWith('[')) continue;               // 다중 행 — 폭 판정 대상 아님
    appends.push({ tab: m[1], width: parts.length, line: lineOf(js, m.index) });
  }
  const reU = /SheetsAPI\.updateRow\(\s*'([^']+)'\s*,\s*\d+\s*,\s*[^,]+,\s*\{/g;
  while ((m = reU.exec(js))) {
    const s = m.index + m[0].length - 1;
    const keys = topSplit(js.slice(s + 1, balanced(js, s))).map((p) => p.split(':')[0].trim()).filter((k) => /^\d+$/.test(k)).map(Number);
    updates.push({ tab: m[1], keys, line: lineOf(js, m.index) });
  }
  const reR = /range:\s*[`']([^`'!$]+)!([A-Z]+)/g;                       // batchUpdate 의 `탭!열${행}` 범위
  while ((m = reR.exec(js))) ranges.push({ tab: m[1], col: m[2].charCodeAt(0) - 65, line: lineOf(js, m.index) });
  return { appends, updates, ranges };
}

// ── 투명 버튼 가드: .btn-outline 은 배경 투명 + 글자 흰색(.btn) → 색 modifier 없이는 흰 바탕에서 안 보인다 ──
const OUTLINE_MODS = ['btn-pri', 'btn-err', 'btn-info', 'btn-warn', 'btn-gray'];    // CSS 에 .btn-outline.X 규칙이 있는 5종
function bareOutlines(text) {
  const bare = []; let total = 0;
  // 클래스 이름 토큰만 본다 — `.btn-outline`(CSS 선택자·querySelector)은 버튼이 아니라 제외.
  // ⚠️ `class="btn btn-outline ${색}"` 처럼 색을 변수로 붙이는 조립은 잡아낼 수 없어 «없음» 으로 센다 —
  //    그런 조립이 필요해지면 삼항식으로 'btn-outline btn-pri' 를 통째로 고르게 쓰거나 이 검출기를 확장할 것.
  const re = /(?<![\w.-])btn-outline(?![\w-])/g;
  let m;
  while ((m = re.exec(text))) {
    total++;
    // 이 토큰을 감싼 «따옴표 한 칸» 이 곧 class 문자열 — 삼항식 'btn-pri':'btn-outline' 도 칸이 갈려 잡힌다
    const left = Math.max(text.lastIndexOf("'", m.index), text.lastIndexOf('"', m.index), text.lastIndexOf('`', m.index));
    const rs = ["'", '"', '`'].map((q) => text.indexOf(q, m.index + m[0].length)).filter((i) => i !== -1);
    const seg = text.slice(left + 1, Math.min(...rs));
    if (!OUTLINE_MODS.some((x) => new RegExp(`(?<![\\w-])${x}(?![\\w-])`).test(seg))) bare.push({ line: lineOf(text, m.index), seg: seg.trim() });
  }
  return { total, bare };
}

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

// ─────────────── 검출기 자기 시험 (합성 입력) ───────────────
ok('주석 걷어내기: 주석 속 옛 정의는 사라지고 문자열 속 // 는 남는다', () => {
  const s = stripJs("// '거래처': ['a']\nconst u = 'https://x';/* '입고기록': [] */const t = `a//b ${1 /* c */}`;");
  assert.ok(!s.includes("'거래처'") && !s.includes("'입고기록'"), '주석 속 문자열이 남음');
  assert.ok(s.includes("'https://x'") && s.includes('`a//b'), '문자열/템플릿 속 // 를 지워버림');
});
ok('폭 검출: 리터럴 append 는 세고, 다중 행·동적 탭은 건너뛴다', () => {
  const w = scanWrites("SheetsAPI.append('T', [a, f(1,2), 'x']); SheetsAPI.append('M', [[1,2],[3,4]]); SheetsAPI.append(tab, [1]);");
  assert.deepStrictEqual(w.appends.map((x) => [x.tab, x.width]), [['T', 3]]);
});
ok('투명 버튼 검출: 색 modifier 없는 btn-outline(삼항식 포함)만 잡는다', () => {
  assert.strictEqual(bareOutlines('<button class="btn btn-outline btn-full">').bare.length, 1);
  assert.strictEqual(bareOutlines(`<button class="btn \${a?'btn-pri':'btn-outline'}">`).bare.length, 1);
  assert.strictEqual(bareOutlines(`<button class="btn \${a?'btn-pri':'btn-outline btn-gray'}">`).bare.length, 0);
  assert.strictEqual(bareOutlines('<button class="btn btn-outline btn-pri btn-full">').bare.length, 0);
  assert.strictEqual(bareOutlines('<b class="btn-outline-x">').total, 0);
  assert.strictEqual(bareOutlines("document.querySelector('.btn-outline')").total, 0, '선택자는 버튼이 아니다');
});

// ─────────────── 본 시험 ───────────────
const DEFS = readDbSheets(JS);
const { appends, updates, ranges } = scanWrites(JS);

ok('정의-사용 열 수: 리터럴 append 폭이 정의와 같다(남는 칸은 updateRow 가 채울 때만 허용)', () => {
  const checked = new Set(), bad = [];
  for (const tab of new Set(appends.map((a) => a.tab))) {
    const def = DEFS[tab];
    if (!def) continue;                                                       // DB_SHEETS 에 없는 탭(구매주문 등)은 이 시험 범위 밖
    const ws = appends.filter((a) => a.tab === tab);
    const width = Math.max(...ws.map((a) => a.width));
    for (const a of ws) if (a.width !== width) bad.push(`${tab}: append 폭이 호출마다 다름 (L${a.line}=${a.width} vs ${width})`);
    if (width > def.length) bad.push(`${tab}: 앱은 ${width}열을 쓰는데 정의는 ${def.length}열 (정의가 짧다)`);
    const filled = new Set([...updates.filter((u) => u.tab === tab).flatMap((u) => u.keys), ...ranges.filter((r) => r.tab === tab).map((r) => r.col)]);
    for (let c = width; c < def.length; c++) if (!filled.has(c)) bad.push(`${tab}: 정의 ${def.length}열 중 [${c}] ${def[c]} 는 쓰는 곳이 없다 (정의가 길다)`);
    checked.add(tab);
  }
  assert.deepStrictEqual(bad, [], '\n' + bad.join('\n'));
  for (const must of ['입고기록', '거래처', '원재료LOT', '완제품LOT', '공정기록', '작업지시서', '출하기록']) assert.ok(checked.has(must), `${must} 가 검사 대상에서 빠짐(검출기가 못 찾음)`);
  assert.ok(checked.size >= 14, `검사한 탭이 너무 적음(${checked.size}) — 검출기가 조용히 못 잡고 있다`);
});

ok('updateRow 키·batchUpdate 열은 정의 폭 안에 있다', () => {
  const bad = [];
  for (const u of updates) { const def = DEFS[u.tab]; if (def && Math.max(...u.keys) >= def.length) bad.push(`${u.tab} L${u.line}: updateRow 키 ${Math.max(...u.keys)} ≥ 정의 ${def.length}열`); }
  for (const r of ranges) { const def = DEFS[r.tab]; if (def && r.col >= def.length) bad.push(`${r.tab} L${r.line}: batchUpdate 열 ${String.fromCharCode(65 + r.col)} ≥ 정의 ${def.length}열`); }
  assert.deepStrictEqual(bad, [], '\n' + bad.join('\n'));
  assert.ok(updates.length >= 30, `updateRow 검출 ${updates.length}건 — 너무 적음`);
  assert.ok(appends.length >= 20, `append 검출 ${appends.length}건 — 너무 적음`);
  assert.ok(ranges.length >= 4, `batchUpdate 범위 검출 ${ranges.length}건 — 너무 적음`);
});

ok('쓰기 코드가 없는 탭은 읽기 코드의 변수 이름과 라벨이 같다(거래처·소모품품목)', () => {
  const flat = JS.replace(/\s+/g, ' ');
  const tie = (tab, re, v) => {
    const m = flat.match(re);
    assert.ok(m, `${tab} 읽기 코드 모양이 바뀌었다 — 이 시험의 앵커를 갱신할 것`);
    const pairs = [...m[0].matchAll(new RegExp(`(\\w+) = (?:parseFloat\\()?${v}\\[(\\d+)\\]`, 'g'))];
    assert.ok(pairs.length >= 2, `${tab}: 읽는 인덱스를 못 찾음`);
    for (const [, name, idx] of pairs) assert.strictEqual(DEFS[tab][+idx], name, `${tab}[${idx}] 라벨 '${DEFS[tab][+idx]}' ≠ 읽기 코드 변수 '${name}'`);
    assert.ok(DEFS[tab].length > Math.max(...pairs.map((p) => +p[2])), `${tab}: 정의가 읽는 열보다 짧다`);
  };
  tie('거래처', /const code = v\[0\].{0,240}?note = v\[6\]/, 'v');
  tie('소모품품목', /const code = item\[0\].{0,200}?minStock = parseFloat\(item\[\d+\]\)/, 'item');   // code·name·spec·unit·category·minStock 6칸 전부
});

ok('라벨 순서 고정: 입고기록·소모품LOT 은 쓰기 코드의 칸 순서와 같다', () => {
  const r = DEFS['입고기록'];
  assert.deepStrictEqual([r[1], r[2], r[3], r[4], r[5], r[8], r[9], r[10], r[11]],
    ['type', 'supplier', 'itemCode', 'itemName', 'lotId', 'recvDt', 'receiver', 'status', 'photoUrl']);
  assert.strictEqual(DEFS['소모품LOT'][6], 'remain', '소모품LOT [6] 은 입고 시 잔량(qty)이 들어가는 칸');
  assert.strictEqual(DEFS['소모품LOT'][7], 'status');
});

ok('소모품품목 재고 합산: 입고 쓰기 코드가 놓는 칸(품목코드·잔량·상태)을 읽고, 실제 행으로 계산하면 재고가 나온다', () => {
  // ① 쓰기 쪽 칸 위치 — 입고 때 소모품LOT 에 append 하는 행 리터럴에서 읽는다(칸 번호를 시험에 박지 않는다)
  const lotRows = [];
  const reL = /SheetsAPI\.append\(\s*lotTab\s*,\s*\[/g;
  let m;
  while ((m = reL.exec(JS))) { const s = m.index + m[0].length - 1; lotRows.push(topSplit(JS.slice(s + 1, balanced(JS, s)))); }
  assert.ok(lotRows.length >= 2, `입고 LOT append 가 ${lotRows.length}건 — 원재료·소모품 두 갈래를 못 찾았다(앵커 갱신)`);
  const row = lotRows.reduce((a, b) => (b.length < a.length ? b : a));            // 짧은 쪽 = 소모품(8칸), 긴 쪽 = 원재료(12칸)
  assert.strictEqual(row.length, DEFS['소모품LOT'].length, '소모품LOT 입고 행 폭이 정의와 다르다');
  const qtyIdx = row.indexOf('qty'), remainIdx = row.lastIndexOf('qty');          // 입고 시 잔량 칸에는 입고 수량이 한 번 더 들어간다
  assert.ok(qtyIdx !== -1 && remainIdx > qtyIdx && row.filter((x) => x === 'qty').length === 2, `소모품LOT 입고 행에서 수량·잔량 칸을 못 찾았다: ${row.join(', ')}`);
  const codeIdx = row.indexOf('itemCode'), statusIdx = row.indexOf("'미사용'");
  assert.ok(codeIdx !== -1 && statusIdx !== -1, `소모품LOT 입고 행에서 품목코드·상태 칸을 못 찾았다: ${row.join(', ')}`);

  // ② 읽기 쪽 — 소모품품목 화면의 totalStock 계산이 읽는 칸이 위와 같다
  const from = JS.indexOf("Screens['items-sp']"), to = JS.indexOf('Screens.vendors', from);
  assert.ok(from !== -1 && to > from, "Screens['items-sp'] 구간을 찾지 못함");
  const stmt = (JS.slice(from, to).replace(/\s+/g, ' ').match(/const totalStock = [^;]+;/) || [])[0];
  assert.ok(stmt, '소모품품목 재고 합산 코드 모양이 바뀌었다 — 이 시험의 앵커를 갱신할 것');
  const idxs = (re) => [...stmt.matchAll(re)].map((x) => +x[1]);
  assert.deepStrictEqual(idxs(/l\[(\d+)\] === code/g), [codeIdx], '합산이 품목코드를 읽는 칸이 입고 쓰기와 다르다');
  assert.deepStrictEqual(idxs(/l\[(\d+)\] !== '/g), [statusIdx, statusIdx], '합산이 상태(폐기·소진 제외)를 읽는 칸이 입고 쓰기와 다르다');
  assert.deepStrictEqual(idxs(/parseFloat\(l\[(\d+)\]\)/g), [remainIdx], '합산이 잔량을 읽는 칸이 입고 쓰기와 다르다 — 옛 칸이면 단위 글자를 숫자로 읽어 재고가 늘 0');

  // ③ 동작 — 입고 쓰기 배치대로 만든 행을 합산 코드에 그대로 넣어 계산한다
  const mk = (code, qty, remain, status) => row.map((a, i) => ({ lotId: 'SP-1', itemCode: code, itemName: '장갑', unit: '개', 'formatDate()': '2026-10-05' }[a]
    ?? (i === qtyIdx ? String(qty) : i === remainIdx ? String(remain) : i === statusIdx ? status : '')));
  const rows = [
    mk('SP-A', 10, 7, '미사용'),     // 10개 입고 후 3개 사용 → 잔량 7
    mk('SP-A', 5, 5, '미사용'),
    mk('SP-A', 4, 4, '폐기'),        // 폐기 LOT 은 재고가 아니다
    mk('SP-A', 3, 3, '소진'),        // 화면 합산이 제외하는 상태
    mk('SP-B', 100, 100, '미사용'),  // 다른 품목
  ];
  const total = vm.runInNewContext(`const code = 'SP-A'; const lots = ${JSON.stringify(rows)};\n${stmt}\ntotalStock`);
  assert.strictEqual(total, 12, `소모품 SP-A 재고는 잔량 7 + 5 = 12 여야 한다(폐기·소진·다른 품목 제외) — 실제 ${total}`);
});

ok('낡은 정의가 남아 있지 않다(주석 걷어낸 사본)', () => {
  const norm = JS.replace(/\s+/g, '');
  const gone = [
    ["'입고기록':['rcvId','itemCode','lotId','qty','unit','recvDt','vendor','receiver','note']", '입고기록 9열 옛 정의'],
    ["'거래처':['code','name','type','phone','address']", '거래처 5열 옛 정의'],
    ["'소모품품목':['code','name','spec','unit','status']", '소모품품목 5열 옛 정의'],
    ["'recvDate','expDate','status']", '소모품LOT [6]=expDate 옛 라벨'],
  ];
  for (const [s, why] of gone) assert.ok(!norm.includes(s), `${why} 가 남아 있다`);
});

ok('투명 버튼: .btn-outline 은 전부 색 modifier(btn-pri/err/info/warn/gray)와 함께 쓴다', () => {
  const text = stripStyle(MARKUP) + '\n' + stripStyle(JS);
  const { total, bare } = bareOutlines(text);
  assert.ok(total >= 60, `btn-outline 검출 ${total}건 — 너무 적음(검출기 점검)`);
  assert.deepStrictEqual(bare, [], '\n색 modifier 없는 btn-outline — 흰 바탕에서 글자·테두리가 안 보인다:\n' + bare.map((b) => `  L${b.line}: "${b.seg}"`).join('\n'));
});

console.log(`\n통과 ${n}건`);
