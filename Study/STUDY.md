# MicroTrace 진행 기록

> 구현 진행 상황 요약. 상세 개념은 `Study/` 폴더 참고.

---

## Study 폴더 구조

```
Study/
├── kernel/
│   ├── ebpf.md        ← kprobe, sock_ops, Ring Buffer, Verifier, CO-RE, skeleton
│   ├── c_language.md
│   └── go.md          ← goroutine, channel, select, sync, context, HTTP
├── network/
│   ├── tcp.md         ← RTT, 재전송, Keep-Alive, EWMA, jitter(mdev)
│   ├── websocket.md   ← WebSocket 프로토콜, Hub 패턴, 브로드캐스트
│   ├── microservices.md
│   └── Netsim.md
├── infra/
│   ├── linux.md       ← cgroup v2, /proc/stat, /sys/fs/cgroup
│   └── docker.md
├── project/
│   └── flow.md        ← 빌드/실행/데이터 흐름 (상세)
└── Errors/            ← 날짜별 트러블슈팅
```

---

## Phase 1 — Agent 뼈대 ✅ 완료

- WSL2 + eBPF 개발환경 구축
- kprobe/tcp_connect → RTT 측정, tracepoint/tcp_retransmit_skb → 재전송 감지
- Go collector: subprocess 실행 → JSON stdout 파이프 → 파싱
- testenv 검증으로 kprobe의 Keep-Alive 한계 확인 → sock_ops 전환 결정

---

## Phase 2 — sock_ops 전환 + 대시보드 ✅ 완료

### eBPF

- kprobe → sock_ops 전환: Keep-Alive 연결 위 요청별 RTT 갱신 가능
- saddr(출발지 IP) 수집 추가 (`skops->local_ip4`)

### collector 패키지 구조

```
collector/
  main.go              진입점. 배선(wiring)만. 비즈니스 로직 없음
  model/event.go       공유 타입 (Event, StatSnapshot, ResourceSnapshot, OutboundMsg)
  agent/reader.go      EventProvider 인터페이스 + SubprocessProvider (tcp_trace subprocess)
  resource/
    provider.go        ResourceProvider 인터페이스
    reader.go          SubprocessProvider (resource_agent subprocess)
  hub/hub.go           WebSocket 클라이언트 관리 + 브로드캐스트 (client struct + sync.Once)
  resolver/
    resolver.go        ServiceResolver 인터페이스, DockerResolver, StaticResolver
    enrich.go          EnrichResolver (rDNS로 외부 IP → 도메인명)
  stats/stats.go       RTT 링버퍼, p50/p95/p99, jitter(mdev), spike 감지, 1초 스냅샷
```

### 주요 구현 항목

| 항목 | 내용 |
|---|---|
| DockerResolver | Docker API → IP→컨테이너명 캐시. 이벤트 스트림으로 실시간 갱신 |
| EnrichResolver | rDNS(net.LookupAddr) + publicsuffix로 외부 IP → 도메인명 변환. 결과 캐시 |
| IsInternal() | DockerResolver 캐시 기준으로 내부/외부 판단. rDNS 변환된 외부 IP 오판 방지 |
| flow-level mdev | FlowKey별로 Go에서 직접 mdev 계산. eBPF srtt 의존 없음. `jitter_us` 필드로 전송 |
| stableP99 | jitter 낮은 안정 구간에서만 baseline 갱신 → spike 중 threshold가 치솟는 Shadowing Effect 방지 |
| 히스토리 보관 | connStats에 최대 3600포인트(1시간). 신규 클라이언트에 `"history"` 메시지로 한 번에 전송 |
| ConnTTL | 30초 이벤트 없으면 연결 삭제. `"remove"` 메시지로 프론트에 알림 |

### resource_agent

- 별도 Go 바이너리 (`resource_agent/main.go`)
- Docker inspect → PID → `/proc/<pid>/cgroup` → cgroup v2 경로 동적 탐색
- 수집: `cpu.stat`, `memory.current`, `memory.events`, `io.stat` (4파일/컨테이너)
- 1초 ticker, 누적 카운터는 delta 계산 후 초당 비율로 변환
- collector subprocess로 실행 → stdout JSON → `chan model.ResourceSnapshot`

### 프론트엔드 (React Web)

| 컴포넌트 | 역할 |
|---|---|
| TopoGraph | SVG 토폴로지. 노드 드래그, 팬, 줌. 골든앵글 자동 배치 |
| ConnectionListView | 연결 목록. 필터(all/spiking/stressed), 정렬 |
| HeatmapMatrixView | 서비스 간 latency 히트맵 |
| DetailPanel | 엣지 클릭 → latency 분석 / 노드 클릭 → 서비스 리소스 |
| LatencyChart | Canvas 기반 시계열 그래프. DPR 적용으로 선명한 렌더링 |
| ResourceChart | CPU/IO/Mem pressure 시계열 |

WebSocket 메시지 타입: `stats` / `event` / `resource` / `remove` / `history`

---

## 현재 상태 (2026-05-15 기준)

- **완료:** 전체 수집 파이프라인 (latency + resource), 대시보드 UI, EXT 배지 분류, 백엔드 리팩토링
- **다음:** `cause_kind` 자동 판별 — spike 발생 시 CPU/IO/Memory/Network 중 원인 후보 자동 분류
- 상세: `mdfiles/todo.md`

---

## Phase 3 — 동적 kprobe + 클라우드 검증 🔲 미착수

- spike 감지 시 kprobe 자동 활성화 (tcp_transmit_skb, finish_task_switch, vfs_write)
- EC2 + Google Microservices Demo + wrk 부하 테스트
- uprobe (Go 런타임 goroutine 스케줄러 추적)
