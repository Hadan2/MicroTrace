# MicroTrace TODO

다음에 할 작업을 여기에 기록한다.
완료된 항목은 GitHub Issue close로 관리한다. 이 파일은 "지금 하고 있는 작업 하나"만 담는다.

---

## 지금 하고 있는 작업

**Issue #3: cause_kind 자동 판별**

### 왜
spike 발생 시 원인을 자동으로 좁혀주는 것이 MicroTrace의 핵심 목표.
현재 `cause_kind`는 `StatSnapshot` 구조체에 있지만 collector가 채우지 않아 항상 비어있음.
프론트엔드 `DetailPanel`의 CauseCandidate Banner와 `ConnectionListView`의 CausePill이 실제로 뜨지 않음.

### 판별 로직 (확정)

단순 사용률 비교가 아닌, 신호 품질에 따른 우선순위 기반 판별:

| 우선순위 | 조건 | cause_kind | cause_signal | 근거 |
|---|---|---|---|---|
| 1 | `dst_type == "external"` | `external` | `external_dst` | 리소스와 무관, 외부 의존성 |
| 2 | `oom_kill_count > 0` | `memory` | `oom_kill` | 프로세스 강제 종료 = 결정적 증거 |
| 3 | `cpu_throttle_pct > 25%` | `cpu` | `cpu_throttle_high` | CFS 스케줄러가 컨테이너를 실제로 멈춤 |
| 4 | `cpu_throttle_pct > 1% AND cpu_pct > 60%` | `cpu` | `cpu_throttle_burst` | throttle 발생 + 사용률 높음 = 버스트 패턴 |
| 5 | `mem_pressure_pct > 20%` | `memory` | `mem_pressure` | memory.events.high 기반 stall 신호 |
| 6 | 위 조건 없음 | `network` | `none` | TCP 레이어 문제가 기본값 |

**io_wait_pct는 단독 cause 판단에서 제외**: 호스트 전체 기준이라 특정 컨테이너 원인으로 쓸 수 없음.

### 건드리는 파일
- `collector/model/event.go` — `StatSnapshot`에 `CauseKind`, `CauseSignal` 필드 추가
- `collector/stats/stats.go` — `Processor`에 resource 상태 맵 + 판별 로직 추가
- `resource_agent/main.go` — `memory.pressure` (PSI) 파일 추가 수집

### 완료 기준
testenv에서 service_b에 CPU 부하를 주었을 때 DetailPanel CauseCandidate Banner에 "CPU Pressure"가 표시된다.
