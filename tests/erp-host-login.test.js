/* 🏭 ERP 배포 새 주소 로그인 (2026-09-24 사용자 결정 «스마트팩토리 안 2 — ERP 클라이언트로 통합»)

   ERP 배포가 maytutu-factory.vercel.app/app/factory/ 에서 이 페이지를 대신 전달한다. 그 주소에서는
   GIS(1시간 토큰 · 사파리·설치 앱은 무화면 갱신 불가) 대신 **같은 주소의 ERP 서버 세션**(/api/auth/token)으로
   토큰을 받는다 — 아이폰 홈 화면 앱도 한 번 로그인하면 90일(쓸 때마다 연장) 동안 다시 묻지 않는다.

   확인:  ① 새 주소 판정·옛 주소(github.io) → 새 주소로 넘김(옛 로그인 조각 #access_token 은 들고 가지 않음)
         ② 부팅 로그인·무화면 갱신·로그인 버튼·로그아웃이 새 주소에서는 서버 세션 창구를 쓴다
         ③ 서버 로그인에서 돌아온 #auth= 표식을 지운다

   실행:  node tests/erp-host-login.test.js                                                        */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ok = [];
const t = (n, f) => { f(); ok.push(n); };

t('① 새 주소 판정 · 옛 주소는 새 주소로', () => {
  assert.ok(SRC.includes("const ERP_HOME = 'https://maytutu-factory.vercel.app/app/factory/';"));
  assert.ok(SRC.includes("const ON_ERP_HOST = location.hostname === 'maytutu-factory.vercel.app';"));
  assert.ok(/if \(location\.hostname === 'doganzi\.github\.io'\) \{[\s\S]{0,300}location\.replace\(ERP_HOME \+ keep\);/.test(SRC), '옛 주소에서 새 주소로 넘기지 않는다');
  assert.ok(SRC.includes("/access_token|error=/.test(location.hash) ? '' : location.hash"), '옛 로그인 조각을 새 주소로 들고 간다');
});

t('② 새 주소에서는 서버 세션 — 부팅·갱신·로그인·로그아웃', () => {
  assert.ok(SRC.includes("const r = await fetch('/api/auth/token', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });"));
  assert.ok(SRC.includes('if (ON_ERP_HOST) return this._srvToken();'), '부팅 로그인이 서버 세션을 안 쓴다');
  assert.ok(/async signInSilently\(\) \{\s*if \(ON_ERP_HOST\) \{[\s\S]{0,200}const ok = await this\._srvToken\(\);/.test(SRC), '무화면 갱신이 서버 세션을 안 쓴다(사파리 건너뜀 전에 와야 한다)');
  assert.ok(SRC.includes("if (ON_ERP_HOST) { window.location.href = '/api/auth/start?app=factory'; return; }"), '로그인 버튼이 공장 서버 로그인으로 가지 않는다(드라이브 전체 범위는 app=factory 에만 붙는다)');
  assert.ok(SRC.includes("fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true })"), '로그아웃이 서버 세션을 안 지운다 — 다음 부팅이 조용히 다시 로그인한다');
});

t('③ #auth= 표식을 지운다', () => {
  assert.ok(SRC.includes("if (/^#auth=/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }"));
});


/* ④ 주소 고정 두 곳이 서로를 되돌려 보내지 않는다 (2026-09-25 사용자 신고 «공장이랑 번갈아가면서 혼선»)
   맨 위 CANONICAL ORIGIN GUARD 가 *.vercel.app 을 전부 GitHub Pages 로 보내고, github.io 는 다시 새 주소로 보내
   두 주소를 끝없이 오갔다. 두 블록을 실제로 잘라 돌려 «몇 번 안에 멈추는가» 를 본다. */
t('④ 주소 이동이 한 곳에서 멈춘다 — 무한 왕복 없음', () => {
  const guard = SRC.match(/\(function enforceCanonicalOrigin\(\) \{[\s\S]*?\n\}\)\(\);/);
  const old = SRC.match(/if \(location\.hostname === 'doganzi\.github\.io'\) \{[\s\S]*?location\.replace\(ERP_HOME \+ keep\);\n\}/);
  assert.ok(guard && old, '주소 고정 블록을 찾지 못했다');
  const ERP_HOME = 'https://maytutu-factory.vercel.app/app/factory/';
  const step = (href) => {
    const u = new URL(href);
    let next = null;
    const location = { hostname: u.hostname, hash: u.hash, replace: (to) => { if (next == null) next = to; } };
    new Function('location', 'ERP_HOME', guard[0] + '\n' + old[0])(location, ERP_HOME);
    return next;
  };
  for (const start of [
    'https://maytutu-factory.vercel.app/app/factory/#home',
    'https://doganzi.github.io/maytutu-smartfactory/#home',
    'https://maytutu-smartfactory.vercel.app/#home',
  ]) {
    let href = start, hops = 0;
    for (let n; (n = step(href)) != null; href = n) assert.ok(++hops <= 2, start + ' 에서 주소가 끝없이 오간다');
    assert.strictEqual(new URL(href).hostname, 'maytutu-factory.vercel.app', start + ' 가 새 주소에 닿지 않는다');
    assert.strictEqual(new URL(href).hash, '#home', start + ' 의 딥링크가 사라졌다');
  }
});

console.log(ok.map((n) => '✓ ' + n).join('\n') + '\n' + ok.length + '/4 통과');
