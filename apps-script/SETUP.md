# Tuya 동결온도 로거 — 배포 런북

KONLEN Tuya WiFi 온도센서 → smartfactory 동결온도 로그 자동 적재(10분 주기).
코드: [`tuya_temp_logger.gs`](./tuya_temp_logger.gs) · 비용: 2대 무료(월 26,000 호출 한도의 ~35%).

> 진행: **A·B(사용자 실행)** → **C(나에게 회신)** → **D(가동)**. 비밀값(Access Secret)은 채팅에 붙이지 말 것.

---

## PART A — Tuya IoT Platform  (https://iot.tuya.com)

1. 가입/로그인.
2. **Cloud → Development → Create Cloud Project**
   - Development Method: **Smart Home PaaS**
   - Data Center: **Western America** (공유링크 `m-us` 기준 추정) ⚠️ *틀리면 API가 빈 결과 → 디바이스 안 보이면 다른 센터로 재생성*
   - → **Create**
3. 생성 직후 화면(또는 **Overview**)에서 **Access ID** / **Access Secret** 복사해 안전한 곳에 보관.
4. **서비스 활성화** — 프로젝트 → **Service API**(또는 Cloud→Development→프로젝트→API)에서 아래가 켜져 있는지 확인/추가:
   - **IoT Core** · **Smart Home Basic Service** · **Device Status Notification**
5. **앱 계정 연동** — 프로젝트 → **Devices → Link App Account → Add App Account** → QR 표시
   - 휴대폰 **Smart Life 앱** → **나(Me) → 우상단 스캔(⊞)** → QR 스캔 → 확인
   - ⚠️ **'냉장고1/2'를 소유한 계정**으로 스캔. (단일기기 공유만 받았다면 같은 **'홈(Home)'** 에 멤버로 초대받은 뒤 스캔)
6. **Devices → All Devices** 에서 온도계 2대 확인 → 각 **Device ID** 복사 (예: `eb…` 20자).

데이터센터별 Endpoint:
`us` https://openapi.tuyaus.com · `eu` https://openapi.tuyaeu.com · `cn` https://openapi.tuyacn.com · `in` https://openapi.tuyain.com

---

## PART B — Google Apps Script  (https://script.google.com)

7. **새 프로젝트** 생성(이름 예: `Tuya 동결온도 로거`).
8. 기본 `Code.gs` 내용 삭제 → **`tuya_temp_logger.gs` 전체 붙여넣기** → 저장(💾).
9. **프로젝트 설정(⚙️) → 스크립트 속성 → 속성 추가**:

   | 속성 | 값 |
   |---|---|
   | `TUYA_ENDPOINT` | https://openapi.tuyaus.com *(데이터센터에 맞게)* |
   | `TUYA_ACCESS_ID` | (A-3) |
   | `TUYA_ACCESS_SECRET` | (A-3) |
   | `TUYA_DEVICE_IDS` | `id1,id2` (A-6, 콤마구분) |
   | `DEVICE_NAMES` | `id1=냉장고1,id2=냉장고2` *(선택)* |
   | `SHEET_ID` | smartfactory 스프레드시트 ID (URL `/d/` 와 `/edit` 사이) |

   *(`TEMP_CODE`/`TEMP_SCALE`/`SHEET_NAME`은 비워두면 기본값)*
10. 함수 드롭다운 **`discoverStatus`** 선택 → **실행(▶)** → 첫 권한동의: *고급 → 안전하지 않음(이동) → 허용*.
11. **실행 로그**(Ctrl+Enter)의 status JSON 전체 복사.

---

## PART C — 나에게 회신 (이 3개)

1. **데이터센터 region** (예: Western America)
2. **`discoverStatus` 로그의 status JSON** — 온도 code·값 확인용 (예: `temp_current: -185`)
3. **SHEET_ID** 정상 여부 / 새 탭 `동결온도로그` 자동생성 OK 여부

→ 내가 **`TEMP_CODE`/`TEMP_SCALE` 확정 + 상·하한 알람 임계값 매핑** 후 "최종 OK".

---

## PART D — 가동 (내 OK 후)

12. **`logTemperatures`** 1회 수동 실행 → `동결온도로그` 탭에 행이 들어오는지 확인.
13. **`createTrigger`** 1회 실행 → 이후 **10분마다 자동 적재** 시작. ✅

---

## 트러블슈팅

| 증상 | 원인/조치 |
|---|---|
| Devices 목록에 기기 안 뜸 | **데이터센터 region 불일치**(최빈) 또는 소유/홈 문제 → 프로젝트 region 변경 후 재연동 |
| `code=1004 sign invalid` | `TUYA_ENDPOINT`가 실제 데이터센터와 불일치, 또는 Access Secret 오타 |
| `code=28841105 / 1106 no permission` | IoT Core/Smart Home Basic Service 미구독 → A-4 다시 |
| `code=1010/1011 token invalid` | 스크립트 속성 `TUYA_TOKEN` 한 줄 삭제 후 재실행 |
| status에 온도 code 없음 | 기기 첫 보고 전 → 수 분 후 재실행 |

> 비용 운영: Trial은 6개월마다 **Cloud → My Services → Extend Trial Period** 무료 연장. 가동 안정화 후 만료 알림용 함수도 추가 예정.
