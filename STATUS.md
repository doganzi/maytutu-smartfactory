# 📊 maytutu-smartfactory — STATUS

> **갱신 책임**: PR 머지 시 작업 세션이 갱신
> **마지막 갱신**: 2026-05-27 14:00 KST (라이브 검증 + #16~#56 41 PR 일괄 반영, 직전 갱신 4/28 이후 stale 제거)

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

---

## ⏳ 진행 중 / 대기 작업

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
- RM003 마미만쥬믹스: 58.82% (10kg 단위 정수 포대만)
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
