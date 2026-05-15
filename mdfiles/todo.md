# MicroTrace TODO

다음에 할 작업을 여기에 기록한다.
완료된 항목은 삭제하지 않고 ✅로 표시한다.

---

## 진행 방식

- 작업 시작 전: 이 파일에 "무엇을, 왜" 적는다
- 작업 완료 후: ✅ 표시하고 완료 기준 충족 여부 확인
- 다음 작업: 바로 다음 한 단계만 명확하게 적는다 (전체 로드맵은 `microtrace.md` 참고)

---

## ✅ 완료

### Resource Snapshot 수집 파이프라인
- `resource_agent/main.go` — cgroup v2 CPU/IO/Memory 수집, 1초 ticker, stdout JSON
- `collector/resource/provider.go` — `ResourceProvider` 인터페이스
- `collector/resource/reader.go` — subprocess 실행 + `chan ResourceSnapshot`
- `collector/model/event.go` — `ResourceSnapshot` 구조체, `OutboundMsg.Resource` 필드
- `collector/main.go` — resource_agent wiring, WebSocket `msg_type: "resource"` 전송
- Frontend `useWebSocket.ts` — `msg_type: "resource"` 수신 → `services` 상태 갱신
- Frontend `DetailPanel.tsx` — 노드 클릭 → `NodePanel` (CPU/IO/Mem 카드 + ResourceChart)

---

## 다음 작업

### CauseCandidate 자동 판별 (`cause_kind` 채우기)

**목표:** spike 발생 시 collector가 `cause_kind`를 자동으로 판단해서 `StatSnapshot`에 채운다.

현재 상태: `cause_kind`는 `StatSnapshot` 구조체에 있지만 collector가 채우지 않아 항상 비어있음.
프론트엔드 `DetailPanel`의 CauseCandidate Banner와 ConnectionListView의 CausePill이 실제로 뜨지 않음.

**판별 규칙 (draft):**

| cause_kind | 조건 |
|---|---|
| `cpu`      | dst 서비스 CPU > 70% 이고 spike 발생 |
| `io`       | dst 서비스 IO wait > 30% 이고 spike 발생 |
| `memory`   | dst 서비스 Mem pressure > 70% 이고 spike 발생 |
| `network`  | 위 조건 없이 spike 발생 (기본값) |
| `external` | dst_type == "external" 이고 spike 발생 |

**구현 위치:**
- `collector/stats/stats.go` — `publishSnapshots()` 내부에서 resource 상태 참조
- resource 데이터를 stats 패키지에서 접근할 방법 필요 (공유 맵 or 채널)

**완료 기준:**
- testenv에서 service_b에 CPU 부하를 주었을 때 CauseCandidate Banner에 "CPU Pressure"가 표시된다
