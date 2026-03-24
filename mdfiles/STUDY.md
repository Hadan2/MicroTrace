# MicroTrace 진행 기록

> 구현 진행 상황 요약. 상세 개념은 `Study/` 폴더 참고.

---

## Phase 1 - Agent 뼈대 구축

### ✅ [2026-03-13] 개발 환경 세팅 완료
- WSL2 + VS Code Remote 연결
- clang, llvm, libbpf-dev, gcc, make, git 설치
- Go 1.22.3 설치 (`/usr/local/go`)
- bpftool v7.7.0 설치 (WSL2 커스텀 커널 이슈로 소스 빌드)
- 프로젝트 폴더 구조 생성: `agent/`, `collector/`, `dashboard/`
- 상세 내용: `Study/linux.md`, `Study/ebpf.md`

### ✅ [2026-03-13] 첫 eBPF 프로그램 작성 및 실행 확인
- 구현 파일: `agent/tcp_trace.bpf.c`, `agent/tcp_trace.c`, `agent/Makefile`
- kprobe/tcp_connect 훅 → Ring Buffer → 터미널 출력 동작 확인
- 출력 예시: `PID: 2444  COMM: node  ->  140.82.114.22:443`
- 수집 데이터: PID, 프로세스명(comm), 목적지 IP, 목적지 포트
- 상세 개념: `Study/ebpf.md`, `Study/tcp.md`, `Study/c_language.md`
- 트러블슈팅 상세: `Study/errors.md`

### 🔲 다음 할 일 (Phase 1 계속)

**[1순위] RTT(지연 시간) 측정 추가**
- 목표: TCP 연결마다 ms 단위 왕복 시간 출력
- 방법:
  1. `kprobe/tcp_connect` 에서 연결 시작 타임스탬프를 Hash Map에 저장
  2. `kprobe/tcp_rcv_established` 에서 타임스탬프 꺼내 차이 계산
  3. RTT(ns) → Ring Buffer → 터미널 출력
- 예상 출력: `PID: 1234  curl  ->  142.250.196.78:443  RTT: 12.3ms`
- 상세 개념 추가 필요: Hash Map 사용법, bpf_ktime_get_ns()

**[2순위] TCP 재전송 감지**
- `tracepoint/tcp/tcp_retransmit_skb` 훅 추가
- 재전송 발생 시 별도 출력

---

## Phase 2 - Go 스트리밍 서버 연동
*(미구현)*
- eBPF 에이전트와 Go 앱 연동
- Ring Buffer 이벤트를 Go 채널로 전달
- WebSocket/gRPC 스트리밍 파이프라인 구축

## Phase 3 - 클라우드 테스트 및 시각화
*(미구현)*
- EC2에 Google Microservices Demo 배포
- wrk 부하 테스트
- 대시보드 latency spike 시각화
