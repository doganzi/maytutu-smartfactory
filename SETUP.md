# 데스크톱 개발 환경 셋업 — maytutu-smartfactory

## 사전 요구사항

- git 2.40+
- Python 3.10+ (정적 서빙)
- 브라우저

빌드 없음 — `index.html` 단일 파일 PWA (~430KB).

## 클론·실행

```bash
git clone https://github.com/doganzi/maytutu-smartfactory.git
cd maytutu-smartfactory
./scripts/setup-dev.sh
# → http://localhost:8080
```

## 작업 브랜치

- `claude/continue-smart-factory-eiuWj` — 진행 중 작업 브랜치 (필요시 cherry-pick)
- `claude/setup-dev-environment-8xCsf` — 본 셋업 브랜치 (현재)

## 도메인 메모리

`CLAUDE.md` 자동 로드 — SOP-002 배합비, RM002 물(추적 외), 마미만쥬믹스 10kg 단위, 시트 컬럼 인덱스, 상태값, LOT ID 규칙.

## CONFIG

`index.html` 내 OAuth + Sheets ID
- 운영 시트: `1_koe58lReouU_ZZxzUh5SU8gUkuHjlwb1LNjZbJGSLU`
- Claude Code 환경에서 시트 직접 접근 불가 (OAuth 자격증명 없음) → 데이터 확인 시 사용자 붙여넣기 필요

## 작업 원칙 (CLAUDE.md 발췌)

- 머지: PR → squash merge (선형 히스토리)
- 모든 변경 전 진행중 작업 영향 점검 — wo-execute / 진행중 WO 데이터 보존 우선
- LiveSync 자동 재렌더는 입력 화면(`wo-create`, `bom-calc`, `req-form`, `data-audit`)에서 스킵
