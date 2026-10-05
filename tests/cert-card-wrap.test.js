/* 성적서 카드 줄바꿈 — «발행 2…» 에서 끊겨 유효기한이 안 보이던 것을 고친다 (2026-10-05 PM75 실측).
   원인: 전역 CSS `.card .fs-11.c-txt-l` 이 카드 안 작은 글줄을 한 줄(nowrap)+말줄임으로 자른다.
         성적서 카드의 «기관·번호 · 발행 → 유효» 한 줄은 폰(360px)에서 208px 밖에 안 돼 «발행 2…» 로 끊겼다.
   고침: ① `.cert-card` 안에서만 줄바꿈을 허용(다른 카드의 한 줄 말줄임은 그대로)
         ② «기관·번호» 와 «발행 → 유효기한» 을 두 줄로 나누고(중간점 «·» 이어붙임 삭제) 유효기한은 한 덩어리로 묶는다.
   방식: index.html 의 hsCertTab 을 원본 그대로 떼어 vm 에서 돌려 «나온 HTML» 을 세고,
         CSS 는 «주석을 걷어낸 사본» 에서 규칙 모양·순서·범위를 센다(내 주석이 내 시험을 초록으로 만들지 않게).
   한계: 실제 줄바꿈 결과(잘림 0줄)는 브라우저에서만 보인다 — 헤드리스 Edge 측정은 PR 본문에 있다.
   실행: node tests/cert-card-wrap.test.js                                                          */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
// 주석을 걷어낸 사본 — 블록 주석(줄머리·공백·구분 기호 뒤) · 줄 주석(문자열 속 https:// 는 남긴다)
const strip = (code) => code
  .replace(/(^|[\s;{}(,])\/\*[\s\S]*?\*\//g, '$1')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const CODE = strip(SRC);

const line = (name) => { const i = SRC.indexOf(name); assert.notStrictEqual(i, -1, `${name} 을 찾지 못함`); return SRC.slice(i, SRC.indexOf('\n', i)); };
const block = (name, end) => { const i = SRC.indexOf(name); assert.notStrictEqual(i, -1, `${name} 을 찾지 못함`); const j = SRC.indexOf(end, i); assert.notStrictEqual(j, -1, `${end} 을 찾지 못함`); return SRC.slice(i, j + end.length); };

// ── 원본 그대로 떼어 돌린다: HS_ESC · FgReportNo · hsCertTab ──
const ctx = vm.createContext({});
vm.runInContext(line('const FG_EXT = {'), ctx);
vm.runInContext(line('const HS_ESC = '), ctx);
vm.runInContext(block('const FgReportNo = {', '\n};\n') + '\nthis.FgReportNo = FgReportNo;', ctx);
// 바깥 세계만 가짜: 만료 판정 · 늦게 채우는 칸 · 로그인 사용자 · 오늘 날짜
vm.runInContext(`
  const HaccpStd = { certStatus: (d) => (String(d) < '2026-10-05' ? { badge: 'err', label: '만료' } : { badge: 'ok', label: '유효' }) };
  const LiveSync = { lateSlot: () => '' };
  const State = { user: { role: 'admin' } };
  const formatDate = () => '2026-10-05';
`, ctx);
vm.runInContext(block('function hsCertTab(', '\n}\n') + '\nthis.hsCertTab = hsCertTab;', ctx);
const { hsCertTab } = ctx;

// 시험성적서 행 — [0]id [1]구분 [2]품목코드 [3]품목명 [4]발행기관 [5]번호 [6]발행일 [7]유효기한 [8]판정 [9]링크 [10]등록자 [11]등록시각 [12]상태
const cert = (id, org, no, issued, until, who) => [id, '완제품', '', 'image', org, no, issued, until, '적합', '', who, '2026-08-07 10:02:11', '유효', ''];
const CERTS = [
  cert('C1', '디아이분석센터', 'R20260521-0009', '2026-05-21', '2026-08-19', 'sh_lee@example.com'),
  cert('C2', '', '', '2026-09-01', '2027-08-31', 'a_very_long_unbreakable_identifier_1234567890@example.com'),   // 기관·번호가 빈 카드
];
const html = hsCertTab(CERTS, [], []);
// 카드 하나씩 자른다 — «<div class="card cert-card"» 로 시작하는 조각
const cards = html.split('<div class="card cert-card"').slice(1);
const ok = [];
const t = (n, f) => { f(); ok.push(n); };

t('모든 성적서 카드에 cert-card 이름표가 붙는다', () => {
  assert.strictEqual(cards.length, CERTS.length, `카드 ${CERTS.length}장인데 cert-card 는 ${cards.length}장`);
  assert.strictEqual((html.match(/<div class="card"/g) || []).length, 0, 'cert-card 없는 카드가 남아 있다');
});

t('기관·번호 줄과 «발행 → 유효» 줄이 따로 나온다 — 유효기한은 한 덩어리', () => {
  assert.ok(cards[0].includes('<div class="fs-11 c-txt-l mt-2">디아이분석센터 R20260521-0009</div>'), '기관·번호 줄이 없다');
  assert.ok(cards[0].includes('<div class="fs-11 c-txt-l">발행 2026-05-21 <span style="white-space:nowrap">→ 유효 2026-08-19</span></div>'), '발행 → 유효 줄이 없거나 유효기한이 한 덩어리가 아니다');
  // 기관·번호가 비어도 «발행 → 유효» 줄은 그대로 나온다(앞에 중간점 «·» 이 매달리지 않는다)
  assert.ok(cards[1].includes('<div class="fs-11 c-txt-l">발행 2026-09-01 <span style="white-space:nowrap">→ 유효 2027-08-31</span></div>'));
  assert.ok(!cards[1].includes('· 발행'), '기관·번호가 비었는데 «· 발행» 이 남았다');
});

t('지운 것 — 한 줄에 «·» 로 이어 붙이던 옛 줄이 없다', () => {
  const body = block('function hsCertTab(', '\n}\n');
  assert.ok(!strip(body).includes("· 발행 ${HS_ESC(c[6] || '-')} → 유효"), '옛 이어붙임 줄이 남았다');
  assert.ok(!html.includes('· 발행'), '출력에 «· 발행» 이 남았다');
});

t('CSS — .cert-card 안 작은 글줄은 줄바꿈을 허용한다', () => {
  const m = CODE.match(/\.cert-card \.fs-11\.c-txt-l \{([^}]*)\}/);
  assert.ok(m, '.cert-card .fs-11.c-txt-l 규칙이 없다');
  const decl = m[1];
  assert.ok(/white-space:\s*normal/.test(decl), 'white-space:normal 이 없다');
  assert.ok(/overflow:\s*visible/.test(decl), 'overflow:visible 이 없다');
  assert.ok(/text-overflow:\s*clip/.test(decl), 'text-overflow:clip 이 없다');
  assert.ok(/word-break:\s*keep-all/.test(decl), '한글 단어 중간에서 끊기지 않게 keep-all 이어야 한다');
  assert.ok(/overflow-wrap:\s*anywhere/.test(decl), '끊을 곳 없이 긴 아이디는 마지막 수단으로 끊어야 한다(anywhere)');
});

t('CSS — 전역 규칙보다 «뒤» 에 있어야 이긴다(같은 우선순위는 나중 것이 이긴다)', () => {
  const g = CODE.indexOf('.card .fs-11.c-txt-l,');
  const c = CODE.indexOf('.cert-card .fs-11.c-txt-l {');
  assert.ok(g !== -1 && c !== -1, '규칙을 찾지 못함');
  assert.ok(c > g, '.cert-card 규칙이 전역 규칙보다 앞에 있어 덮이지 못한다');
});

t('범위 한정 — 전역 규칙은 그대로이고, 다른 카드는 풀리지 않았다', () => {
  // 전역 묶음 규칙이 여전히 한 줄 말줄임이다(다른 카드 보호)
  const m = CODE.match(/\.card > \.fs-11\.c-txt-l,[^{]*\{([^}]*)\}/);
  assert.ok(m, '전역 묶음 규칙이 사라졌다');
  assert.ok(/white-space:\s*nowrap/.test(m[1]) && /text-overflow:\s*ellipsis/.test(m[1]), '전역 규칙의 한 줄 말줄임이 바뀌었다');
  // 이 풀기는 .cert-card 로만 걸린다 — 넓은 선택자(.card 만, 또는 아무 앞머리 없이)로 번지지 않았다
  const releases = CODE.split('\n').filter((l) => /\.fs-11\.c-txt-l[^{]*\{[^}]*overflow-wrap:\s*anywhere/.test(l));
  assert.strictEqual(releases.length, 1, `overflow-wrap:anywhere 로 푸는 규칙이 ${releases.length}개다`);
  assert.ok(releases[0].trim().startsWith('.cert-card '), '푸는 규칙이 .cert-card 로 한정되지 않았다');
});

console.log(`✅ cert-card-wrap ${ok.length}건 통과`);
ok.forEach((n) => console.log('  ·', n));
