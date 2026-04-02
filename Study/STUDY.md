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

### ✅ kprobe → sock_ops 전환 완료
- ACTIVE_ESTABLISHED_CB: 연결 수립 시 RTT 측정 + RTT_CB 플래그 활성화
- RTT_CB: Keep-Alive 연결 위 요청별 RTT 갱신 (핵심)
- RETRANS_CB: 재전송 발생 감지
- 루트 cgroup(/sys/fs/cgroup)에 수동 attach
- 개념: `Study/kernel/ebpf.md` → sock_ops 섹션

### ✅ Go collector WebSocket 서버 추가
- `collector/main.go`의 `handleEvent()` → WebSocket 브로드캐스트로 교체 완료
- DockerResolver로 IP → 컨테이너명 자동 매핑 완료
- agent → collector 통신: JSON → 바이너리 직렬화로 교체 예정 (지표 확정 후)

### 🔲 saddr(출발지 IP) 수집 추가
- 현재 `src_service`가 "unknown" — 토폴로지 구성 불가
- `tcp_trace_common.h` + `model/event.go` 에 `saddr` 필드 추가 필요
- 추가 후: DockerResolver가 saddr도 서비스명으로 변환 → `service-a → service-b` 토폴로지 완성

### 🔲 React Web 대시보드 구현
- **프론트엔드 방향 확정: React Web (TypeScript)** — Wails 아님
- 이유: 타겟 2(EC2), 타겟 3(K8s)에서 팀원 브라우저 접속 필요. Wails는 단일 머신 데스크톱 앱이라 불가.
- WebSocket 연결 → StatSnapshot 수신 → 토폴로지 그래프 렌더링

---

## Phase 2 남은 작업 — 순서대로

### Step 1: saddr 추가 🔲
> 목표: src_service가 "unknown"에서 실제 서비스명으로 바뀌어야 토폴로지 구성 가능

수정 파일:
- `agent/tcp_trace_common.h` — `struct event`에 `saddr(__u32)` 필드 추가
- `agent/tcp_trace.bpf.c` — `e->saddr = skops->local_ip4` 수집
- `collector/model/event.go` — `Event` 구조체에 `SAddr string` 필드 추가
- `collector/stats/stats.go` — `srcService = p.resolver.Resolve(e.SAddr)` 로 변경

### Step 2: testenv 컨테이너화 🔲
> 목표: service_a/b를 Docker 컨테이너로 올려야 DockerResolver가 IP→이름 매핑 가능

현재 문제:
- `service_a/main.go` 에 `localhost:8080` 하드코딩 → 컨테이너 간 통신 불가
- `docker-compose.yml` 없음

작업:
- `testenv/service_a/Dockerfile` 신규 작성
- `testenv/service_b/Dockerfile` 신규 작성
- `testenv/docker-compose.yml` 신규 작성
- `service_a/main.go`: `"http://localhost:8080"` → `"http://service-b:8080"` 변경

컨테이너화 후 DockerResolver 동작:
```
Docker API 응답:
  testenv-service-a-1 → 172.18.0.2
  testenv-service-b-1 → 172.18.0.3

cache:
  "172.18.0.2" → "testenv-service-a-1"
  "172.18.0.3" → "testenv-service-b-1"
```

### Step 3: 토폴로지 데이터 검증 🔲
> 목표: React 개발 전에 데이터가 올바르게 나오는지 확인

방법: 브라우저 콘솔에서 기존 HTML 임시 대시보드 WebSocket 메시지 확인
```
확인 항목:
  src_service = "testenv-service-a-1"  (unknown 아님)
  dst_service = "testenv-service-b-1"
  p99_us, is_spike 등 StatSnapshot 필드 정상 여부
```

### Step 4: React Web 대시보드 구현 🔲
> 목표: 검증된 데이터를 토폴로지로 시각화

작업:
- `frontend/` 디렉토리에 Vite + React + TypeScript 세팅
- WebSocket 연결 + StatSnapshot 수신
- 토폴로지 화면: 노드(서비스), 엣지(연결), 색상(레이턴시 수준) — ReactFlow 또는 D3.js
- 상세 화면: 엣지 클릭 → RTT 시계열 그래프, P50/P95/P99, 재전송 횟수 — Recharts

---

## Phase 3 - 동적 kprobe 활성화 + 대시보드 🔲 미착수

- spike 감지 시 kprobe 자동 활성화 (tcp_transmit_skb, finish_task_switch, vfs_write)
- React Web 대시보드 상세 화면 (실시간 latency 그래프, p50/p95/p99)

---

## Phase 4 - uprobe + 클라우드 검증 🔲 미착수

- uprobe 언어별 지원 (Go 런타임부터)
- EC2 + Google Microservices Demo + wrk 부하 테스트
