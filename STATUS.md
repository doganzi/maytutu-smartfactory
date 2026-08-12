# 📊 maytutu-smartfactory — STATUS

> **갱신 책임**: PR 머지 시 작업 세션이 갱신
> **마지막 갱신**: 2026-06-12 KST (#69~#85 CCP 양식화·종이양식 1:1 PDF·동결온도 모니터링·P3 이관도구 반영; 직전 #63~#68)

---

## 📌 기본 정보

| 항목 | 값 |
|---|---|
| **도메인** | HACCP 기반 호두과자 반죽 생산 관리 + 구매주문(PO) 관리 |
| **저장소** | `doganzi/maytutu-smartfactory` (private) |
| **배포** | https://doganzi.github.io/maytutu-smartfactory/ (GitHub Pages, `.github/workflows/deploy-pages.yml` + `.nojekyll`) |
| **백엔드** | Google Sheets + Drive (OAuth) |
| **Sheets ID** | `1_koe58lReouU_ZZxzUh5SU8gUkuHjlwb1LNjZbJGSLU` |
| **앱 형태** | 단일 파일 PWA (`index.html` ~506KB, 4/28 대비 +50KB) + `manifest.json` |
| **활성도** | 매우 활발 (4/28~5/27 30일간 PR #15→#56, **+41 PR**) |
| **라이브 검증** | 2026-05-27 13:59 KST Playwright — 통합 대시보드 정상(생산 진행 2건/승인 대기 0건/발주 필요 1건/검교정 정상 0건), 발주 알림 모달(계란 부족 44판) 정상 노출, 하단 5탭(홈/생산/재고/스캔/더보기) 정상 |
| **개발 브랜치** | `main` 직접 (개별 PR 머지) |

---

## 📈 최근 PR (2026-04-28 ~ 2026-05-27)

### Wave 1 — UX 안정화 (#17~#46, 4/28~5/26)

| PR | 제목 | 카테고리 |
|---|---|---|
| #17 | 사이트 접속 복구 — GitHub Pages 배포 워크플로 + `.nojekyll` | 인프라 |
| #18 | 완제품 LOT 전체 출하(배치 출하) 기능 추가 | 출하 |
| #19 | 출하 흐름 단순화 — 거래처 선택 제거 + 자유 메모로 대체 | 출하 |
| #20 | 재고 메인 화면 완제품 LOT 카드에도 '전체 출하' 버튼 | 출하 |
| #21 | LOT 전체 출하 버튼 — 상태 검사 완화로 표시 누락 해결 | 출하 |
| #22 | 화면 튕김 방지 (LiveSync 모달 보호) + 원재료 품목 비활성화 | UX |
| #23 | 더보기에 작업지시서 PDF 모음 화면 추가 | 기능 |
| #24 | 로그인 세션 자동 유지 — 3중 안전망 | 인증 |
| #25 | DB 직접 조회·편집 화면 신설 (관리자) | 관리 |
| #26 | '작업 중 첫 화면 튕김' 해결 — popstate + per-screen params | UX |
| #27 | 중복 LOT ID 근본 차단 — Self-Healing + 기존 중복 자동 분리 | 정합성 |
| #28 | 새로고침 시 화면 튕김 해결 — overscroll 차단 + 마지막 화면 복원 | UX |
| #29 | 재고/생산 탭 자동 재렌더 시 첫 탭 튕김 해결 | UX |
| #30 | 완제품 LOT packCount 정합성 검사 추가 | 정합성 |
| #31 | 출하완료 개별 제품번호 표시 개선 | 표시 |
| #32 | LOT 상세 카드 ↔ 개별 목록 전체 수 불일치 해결 | 정합성 |
| #33 | 중복 개별 ID — 재발 방지 + 기존 중복 자동 정리 | 정합성 |
| #34 | 중복 개별 ID 처리 — soft-delete 방식(B안)으로 교체 | 정합성 |
| #35 | phantom 개별 행 정합성 검사 — WO packCount 초과 suffix 탐지 | 정합성 |
| #36 | 🚨 critical: getAll → batchUpdate sheetRowIdx off-by-one 수정 | 버그 |
| #37 | 새로고침·이탈 시 입력값·스크롤 위치 복원 (FormDraft) | UX |
| #38 | LiveSync 자동 동기화 시 스크롤 위치 보존 | UX |
| #39 | 완제품 품목 헤더에 가용 주차 표시 — 박스/주 단위 | 표시 |
| #40 | 재고관리 완제품 탭 스크롤 튕김 — renderInventoryContent await 누락 수정 | UX |
| #41 | QR 스캔 화면 — 카메라 영역 letterbox 제거 + 가이드 동적 사이즈 | UX |
| #42 | 생산관리 작업 현황 카드 — 모바일 가독성 개선 (clamp 반응형) | UX |
| #43 | 재고관리 LOT 상세 — 자동 새로고침 차단 + 출하 후 화면 유지 | UX |
| #44 | 완제품 LOT 개별 다중 선택 출하 기능 추가 | 출하 |
| #45 | 재고관리 화면 자동 새로고침 차단 — 스크롤·펼침 상태 보존 | UX |
| #46 | 런처 진입 시 OAuth 400 해결 — 정식 origin(GitHub Pages) 강제 이동 | 인증 |

### Wave 2 — 구매주문(PO) 도메인 신설 (#47~#56, 5/26~5/27)

| PR | 제목 | 카테고리 |
|---|---|---|
| #47 | 구매주문 PR #1 — 역할 헬퍼 + 거래처 메뉴 재활성화 | PO 기반 |
| #48 | 구매주문 PR #2 — 재고 화면에 발주 탭 추가 (읽기 전용) | PO 표시 |
| #49 | 구매주문 PR #3 — 등록/처리 화면 + 입고기록 자동 생성 | PO 핵심 |
| #50 | 구매주문 등록 400 에러 진단 개선 — 시트 미존재 안내 명확화 | PO DX |
| #51 | 발주 등록 — 주문 단위(포대/통/판) 표시 + 1개당 단가 명확화 | PO 입력 |
| #52 | 발주 등록 — 품목 우선 + 거래처 자동 필터(이력 기반) + 코드 숨김 | PO 입력 |
| #53 | 구매주문 시트 자동 생성 — 사전 점검 실패 시 1-click 다이얼로그 | PO 셋업 |
| #54 | PO 진행 단계 재배치 — 주문 → 세금계산서 → 입금 → 수령(종결) | PO 워크플로 |
| #55 | PO 삭제 기능 — soft delete + 미사용 LOT 입고취소 cascade | PO 워크플로 |
| #56 | 배포 버전 표시 + 강제 새로고침 — 캐시 혼란 진단 | 운영 |

### Wave 3 — CCP 모니터링 + 동결온도 자동화 (#63~#68, 6/11)

| PR | 제목 | 카테고리 |
|---|---|---|
| #63 | 완제품 출하 화면 새로고침·튕김 수정 (펼침 영속화 + 스크롤 보존) | UX |
| #64 | GIS 토큰클라이언트 전환 + iOS standalone 리다이렉트 (세션 지속) | 인증 |
| #65 | 런처 진입 무화면 silent 로그인 (재로그인 제거) | 인증 |
| #66 | CCP 금속검출 7단계 위저드 → 19칸 격자 입력 (P1) | CCP |
| #67 | CCP 금속검출 PDF 격자 기록부 출력 (P2) | CCP |
| #68 | 동결온도 Tuya 온도로거 백업 (`apps-script/`, standalone — Pages 무관) | CCP-1 |

> CCP 상세 = `docs/CCP_SPEC.md`. 동결온도 가동 런북 = `apps-script/SETUP.md`.

### Wave 4 — CCP 양식화·종이양식 1:1 PDF·동결온도 (#69~#85, 6/11~6/12)

| PR | 제목 | 카테고리 |
|---|---|---|
| #69 | 관리자 전용 역할 화면 미리보기 (작업자/생산자/회계 흐름 검증) | 검증 |
| #70 | 작업지시서 상세뷰 신 격자(`ccpGrid-v1`) 읽기 렌더 | CCP |
| #71 | P4 이관 로그 — 구 7단계 55건 → ccpGrid-v1 (검증 55/55) | CCP |
| #72 | 런처 진입 '준비 중' 버그 수정 + 역할 미리보기 안전 둘러보기 모드 | 버그 |
| #73 | 관리자, 진행 중 작업지시서도 삭제 가능 (테스트·오생성 정리) | 운영 |
| #74 | 캐시 stale 근본 수정 — forceRefresh 캐시버스트 + 새 버전 알림 배너 | 운영 |
| #75 | 냉동(CCP-1 동결온도) 투입 냉동고온도 실측 입력 + 상세/PDF | CCP-1 |
| #76 | 금속검출 PDF 안내부·결재·품명 보강 (양식화 1/n) | CCP |
| #77 | 동결온도 CCP-1 종료기록(제품온도·판정) + 부적합 출하차단 (2/n) | CCP-1 |
| #78 | 동결 PDF를 동결공정 모니터링일지 형식으로 (3/n) | CCP-1 |
| #79 | 금속검출 PDF를 종이 체크박스 격자표 레이아웃으로 (4/n) | CCP |
| #80 | 공정기록 7단계→격자 일괄변환 도구 (P3, 비파괴·관리자 1클릭) | CCP |
| #81 | 동결온도 모니터링 화면 + HACCP 기록부 PDF | CCP-1 |
| #82 | 금속검출 작업화면 — 시편 불검출 차단 + 종이양식 구성·셀 정비 | CCP |
| #83 | 냉동온도 흐름 개편 — 6h평균 알람·−부호 정규화·출하 온도 자동스탬프·백필 | CCP-1 |
| #84 | 작업지시서 금속검출 PDF를 실물 기록부 1:1 레이아웃으로 | CCP |
| #85 | 동결공정 PDF를 실물 '모니터링일지(동결공정)' 1:1 레이아웃으로 | CCP-1 |

> 양식화 = 실물 종이 HACCP 기록부와 1:1 매칭(결재칸·격자·체크박스). 동결온도 코어 = 투입실측 → 종료판정 → 부적합 출하차단 → 출하 온도 자동스탬프.

---

## ⏳ 진행 중 / 대기 작업

### 라이브 검증 대기 (코드 완료 · 노트북 로그인 필요)
- **역할 화면 미리보기** — #69·#72 머지 완료(설정 셀렉터 + 배너, `State.user.role` 오버라이드·realRole 보존). vm 파싱 + node 동작테스트 6/6 통과. 노트북 로그인 라이브 검증만 남음(GitHub Pages 프리뷰 없음).
- **CCP PDF 픽셀검증** — 금속검출(#84)·동결공정(#85) 실물 1:1 양식 머지됨. PDF 픽셀 레이아웃 육안검증만 미완(로컬 pdf.js CJK 렌더 한계 → 노트북 로그인 필요).
- **CCP P3 일괄변환 실행** — 도구 #80 머지(`data-audit` 관리자, 비파괴·원본 `_legacy` 보존·dry-run·idempotent). 배포≠실행 → **관리자가 노트북에서 dry-run 스캔 후 변환 1회 실행** 필요.

### 외부 자격증명 대기
- **동결온도(CCP-1) 실가동** — #68 Tuya 로거 + #75~#85로 투입실측·종료기록·모니터링 화면·HACCP PDF·출하차단·자동스탬프까지 완성. **사용자 Tuya 콘솔 자격증명(Access ID/Secret·Device ID) 회신 → `discoverStatus()`→`TEMP_CODE/SCALE` 확정 → 가동**만 남음. 런북 = `apps-script/SETUP.md`.

### 다음 PR 후보 (사용자 확정 필요)
- 신규 SOP 추가 (호두과자 외 다른 제품)
- maytutu-finance 연동 (생산비용·PO 입금 → 회계로 자동 전송)
- PO 도메인 추가 개선 — 가맹점별 발주 이력 통계, 정기 발주 알림
- 분석 대시보드 (생산성·발주 추세)
- DRAFT PR #16 (`claude/setup-dev-environment-8xCsf`) 정리

### maytutu-erp 연동 (양방향, 30분 주기)
- ERP → smartfactory: SKU 마스터 push (`SKU.smartfactory_link`)
- smartfactory → ERP: 원재료LOT pull (`_HQ_FACTORY` store_code)
- Apps Script 함수: `syncSmartfactory()` (ERP 측)

---

## 🎯 핵심 화면 (20+ Screens)

| 카테고리 | 화면 |
|---|---|
| **대시보드** | dashboard (4 KPI 카드 + 발주 알림 모달) |
| **품목 관리** | items-rm / items-fg / items-sp |
| **LOT 관리** | receive-form / lot-detail / qr-scan / label-print |
| **작업지시서** | wo-create / wo-execute / wo-detail |
| **출하 승인** | approval-detail / reject-modal / bulk-ship (#18/#44) |
| **자재 청구** | req-form |
| **SOP** | sop-list / sop-detail (#15 미리보기 통합) |
| **계산기** | bom-calc |
| **데이터 감사** | data-audit |
| **🆕 구매주문(PO)** | po-list / po-register / po-process / po-stage (#47~#55) |
| **🆕 관리자 DB** | db-editor (#25, Admin 전용) |
| **PDF 모음** | wo-pdf-archive (#23) |

---

## 🔧 핵심 시트

- 작업지시서 (WO)
- 원재료LOT / 원재료개별 (`_indiv_` 중복 차단 #33~#35)
- 완제품LOT / 완제품개별 (LOT ID Self-Healing #27)
- 품목 (RM/FG/SP)
- SOP / SOP레시피 / SOP공정단계 / SOP·SKU
- 🆕 구매주문 (#49~#53) — 자동 생성 가능 (#53)
- 거래처 (#47에서 메뉴 재활성화)
- 입고기록 (#49에서 PO 처리 시 자동 생성)
- HACCP

---

## 🐞 알려진 이슈

1. **DRAFT PR #16** `claude/setup-dev-environment-8xCsf` (2026-05-01 생성) — 정리 필요
2. **로컬 클론 stale 위험** — 본 STATUS.md 갱신 전까지 로컬은 PR #15(4/28)에 머물러 있었음. 새 세션은 반드시 `git pull` 먼저 실행 권장.

---

## 📚 도메인 메모

### SOP-002 (호두과자 전용반죽) 배합비
- RM001 계란: 17.65%
- RM002 물: 17.65% (수도 공급 — 재고 추적 외)
- RM011 앙브레드호두과자 전용믹스: 58.82% (10kg 단위 정수 포대만) ⚠️2026-08 RM003 마미만쥬에서 교체
- RM006 식용유: 5.88%

### 생산 단위
- 봉당 5kg (포장 고정)
- 추천 배치: 200~350kg (40~70봉)
- 최우수: 47봉 / 235kg / 14포대 (잔여 0.41kg)

### HACCP 운영
- 냉동 보관 최소 12시간 → 출하 승인
- 소비기한 = 생산일 + 6개월
- LOT ID 형식: `{prefix}-{itemNum}-{mfgYYMMDD}-{expYYMMDD}-{NNN}`
- LOT ID Atomic Claim + Self-Healing (#27): 채번 즉시 placeholder row → race condition 차단 + 기존 중복 자동 분리

### 구매주문(PO) 워크플로 (#54 기준 단계 순서)
1. 주문 (PO 등록)
2. 세금계산서 수령
3. 입금 (지급)
4. 수령 (LOT 입고기록 자동 생성)

### 핵심 기술 특징
- PDF 자동 생성 (HACCP 기록물) → 공유 드라이브 `HACCP_생산기록_PDF` (#23 PDF 모음)
- 모바일 PWA (Android 호환)
- LiveSync 입력 화면 자동 재렌더 차단 + 스크롤 보존 + FormDraft 입력값 복원 (#37, #38, #43, #45)
- 정합성 검사 다층: WO packCount(#30), phantom suffix(#35), 중복 LOT(#27/#32), 중복 개별(#33/#34)
- 배포 버전 표시 + 강제 새로고침 (#56) — 캐시 stale 직접 진단

자세한 내용은 [`CLAUDE.md`](CLAUDE.md) 참조.
