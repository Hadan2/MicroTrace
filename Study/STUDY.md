# MicroTrace 진행 기록

> 구현 진행 상황 요약. 상세 개념은 `Study/` 폴더 참고.

---

## Study 폴더 구조

```
Study/
├── kernel/         ← eBPF, C 언어, Go
│   ├── ebpf.md     ← kprobe, tracepoint, Map, Ring Buffer, Verifier, Skeleton, CO-RE, sock_ops
│   ├── c_language.md
│   └── go.md       ← 기본 문법, goroutine, channel, select, sync.Mutex, context, HTTP
├── network/        ← TCP, MSA, Netsim, WebSocket
│   ├── tcp.md      ← 3-way handshake, RTT, 재전송, Keep-Alive
│   ├── websocket.md ← WebSocket 프로토콜, gorilla/websocket, Hub 패턴, 브로드캐스트
│   ├── microservices.md
│   └── Netsim.md
├── infra/          ← Linux, Docker
│   ├── linux.md
│   └── docker.md
├── project/        ← MicroTrace 전체 흐름
│   └── flow.md     ← 빌드 타임/실행 순서/데이터 흐름
└── Errors/         ← 날짜별 트러블슈팅
    ├── 03.13_errors.md
    ├── 03.15_errors.md
    └── 03.27_errors.md
```

---

## Phase 1 - Agent 뼈대 구축 ✅ 완료

### ✅ [2026-03-13] 개발 환경 세팅
- WSL2 + VS Code Remote 연결
- clang, llvm, libbpf-dev, gcc, make, git 설치
- Go 1.22.3 설치 (`/usr/local/go`)
- bpftool v7.7.0 소스 빌드 (WSL2 커스텀 커널 이슈)
- 상세: `Study/infra/linux.md`, `Study/kernel/ebpf.md`

### ✅ [2026-03-13] 첫 eBPF 프로그램
- kprobe/tcp_connect 훅 → Ring Buffer → 터미널 출력
- 수집: PID, comm, 목적지 IP/포트
- 상세: `Study/kernel/ebpf.md`, `Study/network/tcp.md`

### ✅ [2026-03-xx] latency 측정 추가
- kprobe/tcp_connect에서 Hash Map에 타임스탬프 저장
- kprobe/tcp_rcv_state_process에서 SYN-ACK 수신 시 latency 계산 (마이크로초)
- 공통 헤더 `tcp_trace_common.h` 분리 (패딩 없는 struct event)

### ✅ [2026-03-xx] TCP 재전송 감지
- tracepoint/tcp/tcp_retransmit_skb 훅 추가
- format 파일 런타임 파싱 → Array Map에 offset 저장 → eBPF가 lookup
- 상세: `Study/kernel/ebpf.md` → tracepoint 섹션

### ✅ [2026-03-xx] Go collector 파이프라인
- `collector/main.go`: agent subprocess 실행 → JSON stdout 파이프 → 파싱 → 출력
- 상세: `Study/project/flow.md` → collector 파이프라인 섹션

### ✅ [2026-03-27] testenv Keep-Alive 검증
- service_a → service_b HTTP Keep-Alive 동작 확인
- 트러블슈팅: resp.Body 미읽음 + IdleTimeout 미설정 → 연결 재사용 안 됨
- 해결 후 kprobe의 한계 확인: 연결 재사용 시 요청 단위 추적 불가
- 상세: `Study/Errors/03.27_errors.md`, `Study/network/tcp.md` → Keep-Alive 섹션

---

## Phase 2 - sock_ops 전환 + 실시간 스트리밍 🔲 진행 중

### ✅ kprobe → sock_ops 전환
- ACTIVE_ESTABLISHED_CB: 연결 수립 시 RTT 측정 + RTT_CB 플래그 활성화
- RTT_CB: Keep-Alive 연결 위 요청별 RTT 갱신 (핵심)
- RETRANS_CB: 재전송 발생 감지
- 루트 cgroup(/sys/fs/cgroup)에 수동 attach
- 개념: `Study/kernel/ebpf.md` → sock_ops 섹션

### ✅ Go collector 패키지 분리 + WebSocket + DockerResolver
- 패키지 분리: agent / stats / hub / resolver / model
- DockerResolver: Docker API로 IP → 컨테이너명 자동 매핑 (시작 시 캐시 + 이벤트 스트림 실시간 갱신)
- WebSocket 브로드캐스트: StatSnapshot(P50/P95/P99, 재전송, spike) 1초마다 전송
- 프론트엔드 방향 확정: **React Web (TypeScript)** — Wails 아님
  - 이유: EC2/K8s 환경에서 팀원이 브라우저로 접속해야 함. Wails는 단일 머신 데스크톱 앱이라 불가.

### ✅ [2026-04-03] saddr(출발지 IP) 수집 추가
- `struct event`에 `saddr` 필드 추가 (`skops->local_ip4`)
- Go `Event` 구조체에 `SAddr` 필드 추가
- `stats.go`: `srcService = resolver.Resolve(e.SAddr)` → "unknown" 제거
- 수정 파일: `tcp_trace_common.h`, `tcp_trace.bpf.c`, `tcp_trace.c`, `model/event.go`, `stats/stats.go`

### ✅ [2026-04-03] testenv 컨테이너화
- `service_a/Dockerfile`, `service_b/Dockerfile` 작성
- `docker-compose.yml` 작성 (service-a, service-b)
- `service_a/main.go`: `localhost:8080` → `service-b:8080`
- `docker-compose up` 으로 정상 동작 확인

### ✅ [2026-04-03] Step 3: 토폴로지 데이터 검증
- collector + docker-compose up 동시 실행으로 확인
- `testenv_service-a_1 → testenv_service-b_1` 이름 매핑 성공
- P50/P95/P99 퍼센타일 집계 정상 출력
- 참고: 루트 cgroup 특성상 호스트 외부 트래픽도 같이 잡힘 → 나중에 Docker 네트워크 필터링으로 제거 가능

### ✅ [2026-04-09] Step 4: React Web 대시보드 구현
- Vite + React + TypeScript + Tailwind CSS + ReactFlow + Recharts 세팅
- WebSocket 연결 + StatSnapshot 실시간 수신 (`useWebSocket` 훅)
- 토폴로지 화면: 노드(서비스), 엣지(연결), 색상(레이턴시 수준) — ReactFlow
- 레이아웃: 상단 그래프 패널 / 하단 토폴로지 (가로 분할)
- 엣지 클릭 → 상단 패널에 P50/P95/P99 실시간 시계열 그래프 (최근 60초, Recharts)
- spike threshold 기준선 표시
- 트러블슈팅: `StrictMode` 제거 → WebSocket 이중 연결 문제 해결
- 트러블슈팅: `vite.config.ts`에 `host: true` 추가 → WSL2 외부 접근 가능
- 상세: `Study/Errors/04.09_errors.md`

### ✅ [2026-04-23] Snapshot TTL — 오래된 연결 자동 제거
- `connStats`에 `lastSeen` 타임스탬프 추가, 이벤트마다 갱신
- 10초마다 `sweepExpired()` 실행 → 30초 동안 이벤트 없는 연결 삭제
- TTL 만료 시 `"remove"` 메시지를 프론트로 전송
- 프론트: `"remove"` 수신 시 snapshots/history에서 해당 key 삭제 → 노드/엣지 자동 제거
- 수정 파일: `collector/stats/stats.go`, `collector/model/event.go`, `frontend/src/hooks/useWebSocket.ts`

### ✅ [2026-04-23] EnrichResolver — 외부 IP → 도메인명 변환
- `resolver/enrich.go` 신규 추가
- DockerResolver가 모르는 외부 IP → `net.LookupAddr()` rDNS 조회
- `golang.org/x/net/publicsuffix`로 등록 도메인 파싱 (`lb-140-82-112-21.github.com` → `github.com`)
- 결과 캐시로 반복 DNS 조회 없음
- 같은 회사 여러 IP → 같은 노드로 자동 통합
- 수정 파일: `collector/resolver/enrich.go` (신규), `collector/main.go`

### ✅ [2026-04-23] 내부/외부 노드 구분
- `StatSnapshot`에 `src_type`, `dst_type` 필드 추가 (`"internal"` | `"external"`)
- DockerResolver 결과가 원본 IP와 같으면 external, 다르면 internal로 판단
- 토폴로지: 내부 노드(실선), 외부 노드(점선 + 흐린 색)로 시각적 구분
- 내부 노드: 상단 원형 배치 / 외부 노드: 하단 가로 나열
- 수정 파일: `collector/model/event.go`, `collector/stats/stats.go`, `frontend/src/types.ts`, `frontend/src/components/TopologyGraph.tsx`

### ✅ [2026-04-23] 그래프 라이브러리 교체 — Recharts → Lightweight Charts
- Recharts 한계: 실시간 데이터 유입 시 Brush 상태 리셋, 드래그 패닝 미지원
- **TradingView Lightweight Charts v5** 로 교체 (Apache 2.0, 무료)
- 드래그 패닝 / 휠 줌 기본 내장
- **Live/Pause 모드** 구현
  - 기본: LIVE 표시와 함께 그래프가 우방향으로 실시간 흐름
  - 사용자가 드래그 시작하는 순간 자동으로 Pause 모드 전환
  - "▶ Live 복귀" 버튼 클릭 시 최신 데이터로 즉시 이동
- y축 단위 포맷터 (`412µs`, `1.1ms`)
- 시간 포맷 로컬 시간 기준 (`04/23 02:16:20`)
- 오른쪽 끝 라벨 제거 (`lastValueVisible: false`) — 헤더 뱃지로 대체
- 워터마크 CSS로 숨김 (Apache 2.0 라이선스상 의무 없음)
- 수정 파일: `frontend/src/components/LatencyChart.tsx`

---

## Phase 3 - 동적 kprobe 활성화 🔲 미착수

- spike 감지 시 kprobe 자동 활성화 (tcp_transmit_skb, finish_task_switch, vfs_write)
- 커널 레벨 원인 후보 자동 판별 (네트워크 문제 vs CPU/디스크 문제)

---

## Phase 4 - uprobe + 클라우드 검증 🔲 미착수

- uprobe 언어별 지원 (Go 런타임부터)
- EC2 + Google Microservices Demo + wrk 부하 테스트
