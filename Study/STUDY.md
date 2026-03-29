# MicroTrace 진행 기록

> 구현 진행 상황 요약. 상세 개념은 `Study/` 폴더 참고.

---

## Study 폴더 구조

```
Study/
├── kernel/         ← eBPF, C 언어, Go
│   ├── ebpf.md     ← kprobe, tracepoint, Map, Ring Buffer, Verifier, Skeleton, CO-RE, sock_ops
│   ├── c_language.md
│   └── go.md
├── network/        ← TCP, MSA, Netsim
│   ├── tcp.md      ← 3-way handshake, RTT, 재전송, Keep-Alive
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

### 🔲 kprobe → sock_ops 전환
- 소켓 단위 TCP latency 측정
- Keep-Alive 연결 위의 요청 단위 추적
- cgroup 기반 서비스 선택적 적용
- 개념: `Study/kernel/ebpf.md` → sock_ops 섹션

### 🔲 Go collector WebSocket 서버 추가
- `collector/main.go`의 `handleEvent()` → WebSocket 전송으로 교체
- agent → collector 통신: JSON → 바이너리 직렬화로 교체 예정

---

## Phase 3 - 동적 kprobe 활성화 + 대시보드 🔲 미착수

- spike 감지 시 kprobe 자동 활성화 (tcp_transmit_skb, finish_task_switch, vfs_write)
- Wails + React 대시보드 (실시간 latency 그래프, p50/p95/p99)

---

## Phase 4 - uprobe + 클라우드 검증 🔲 미착수

- uprobe 언어별 지원 (Go 런타임부터)
- EC2 + Google Microservices Demo + wrk 부하 테스트
