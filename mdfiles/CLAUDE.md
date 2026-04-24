# MicroTrace 프로젝트 가이드 (CLAUDE.md)

## 👤 사용자 배경
- Linux 처음 사용. 기본 명령어(ls, cd, mkdir 등)도 모를 수 있음
- 명령어 실행 시 역할과 옵션 의미를 항상 함께 설명할 것
- 처음 보는 개념은 비유나 그림(ASCII)으로 자세히 설명할 것. 한줄 요약 금지
- 개념 설명 시 ① 이게 뭔지 ② 왜 필요한지 ③ 어떻게 동작하는지 순서로 설명
- 한글로 설명할 것.

## 📖 Study 폴더 관리 규칙
- 프로젝트 루트의 `Study/` 폴더 하위에 **카테고리 폴더**로 분류하여 관리
- 새로운 개념이 등장할 때마다 해당 파일에 추가. 파일이 없으면 새로 생성
- 폴더/파일 분류 기준:
  - `Study/kernel/ebpf.md` ← eBPF 개념, kprobe, tracepoint, Map, Ring Buffer, Verifier, Skeleton, CO-RE, sock_ops
  - `Study/kernel/c_language.md` ← C 언어 문법, 포인터, 구조체 등
  - `Study/kernel/go.md` ← Go 언어 문법, goroutine, channel 등
  - `Study/network/tcp.md` ← TCP 연결 흐름, RTT, 재전송, Keep-Alive 등
  - `Study/network/microservices.md` ← MSA 개념
  - `Study/network/Netsim.md` ← tc netem 패킷 지연/손실 주입
  - `Study/infra/linux.md` ← Linux 명령어, 파일시스템, 권한 등
  - `Study/infra/docker.md` ← Docker, 컨테이너 등
  - `Study/project/flow.md` ← MicroTrace 전체 빌드/실행 흐름
  - `Study/Errors/` ← 날짜별 트러블슈팅 (03.13_errors.md 형식)
  - 새 주제 등장 시 적절한 폴더에 새 파일 생성
- 설명은 비유/흐름도를 포함하여 자세하게 작성

## 🎯 프로젝트 개요
MicroTrace는 MSA 환경에서 1ms 미만의 지연 시간(Latency Spike)과 TCP 재전송을 추적하는 eBPF 기반 실시간 네트워크 프로파일러입니다.
개발 기획서는  **README.md , integration.md, microtrace.md, netsim.md ** 를 참고하세요.

## 🛠 기술 스택
- **커널/에이전트:** C, eBPF (libbpf / cilium/ebpf 사용)
- **백엔드:** Go (Goroutines, gRPC/IPC 기반 스트리밍)
- **프론트엔드:** React Web (TypeScript) — Wails 아님. 브라우저로 접속하는 웹 UI. 로컬/EC2/K8s 모든 환경에서 URL 하나로 공유 가능.
- **환경:** Linux (Ubuntu 22.04+ / eBPF 활성화된 WSL2 커널)

## 📚 학습 및 문서화 
- **개념 우선:** 새로운 기능 구현 전, 반드시 관련 개념을 먼저 설명할 것
- **Study 폴더:** 상세 개념 설명은 `Study/` 하위 주제별 파일에 작성 (ebpf.md, tcp.md, linux.md, go.md 등)
- **STUDY.md 역할 축소:** `mdfiles/STUDY.md`는 구현 진행 상황을 간략히 기록하는 용도로만 사용
  - 구현한 내용 한줄 요약
  - 관련 Study 파일 링크 (예: 자세한 내용은 `Study/ebpf.md` 참고)
  - 트러블슈팅 메모

## 💻 코딩 스타일 및 규칙(핵심 지침)
- **eBPF (C):** 리눅스 커널 코딩 스타일 준수. CO-RE(Compile Once – Run Everywhere) 방식 지향. eBPF 검증기(Verifier) 제약 조건을 고려한 메모리 안전성 확보.
- **Backend (Go):** Idiomatic Go 스타일. 스트리밍 데이터 처리에 채널(Channel) 활용. 철저한 에러 처리.
- **Frontend (TS/React):** 함수형 컴포넌트 사용. 고빈도 데이터 처리를 위한 성능 최적화(Canvas 등).
- **철저한 모듈화 (구체 규칙):**
  - **인터페이스로 변경 경계를 격리한다.**
    단계별로 교체가 예정된 구현체는 반드시 인터페이스 뒤에 숨긴다.
    예: `ServiceResolver` 인터페이스 → `DockerResolver` (1단계) / `StaticResolver` (2단계) / `K8sResolver` (3단계).
    호출 측(stats, hub)은 인터페이스만 보고, 구현체가 무엇인지 몰라야 한다.
  - **패키지는 역할 단위로 나눈다. 파일 단위가 아니다.**
    `agent/` (subprocess 실행·읽기), `hub/` (WebSocket 관리), `stats/` (집계·spike 감지), `resolver/` (IP→이름), `model/` (공유 타입) 으로 분리.
    기능이 추가될 때 기존 패키지 내부를 수정하지, 다른 패키지가 서로 침범하지 않는다.
  - **공유 타입은 model/ 한 곳에만 정의한다.**
    `Event`, `StatSnapshot`, WebSocket 메시지 구조체 등을 여러 패키지가 각자 정의하지 않는다.
    구조체 필드가 바뀌면 `model/event.go` 한 파일만 수정하면 전파된다.
  - **통신 방식(transport)을 비즈니스 로직과 분리한다.**
    stats 집계 로직은 "어떻게 데이터가 오는지" 몰라야 한다. agent/reader가 파이프든 gRPC든 상관없이 `chan model.Event` 하나만 넘긴다.
    나중에 gRPC로 바꿔도 stats, hub 코드는 건드리지 않아도 된다.
  - **새 단계 추가 시 기존 코드를 고치지 않고 구현체를 추가하는 방향으로 설계한다.**
    새 환경(EC2, k8s) 지원은 새 파일(resolver 구현체, reader 구현체)을 추가하는 것으로 끝나야 한다.

## 🗺 단계별 변경 파일 지도

단계가 올라갈 때 **어느 파일만 건드리면 되는지** 미리 정리해둔다.
나머지 파일(stats, hub, model)은 어느 단계에서도 수정하지 않는다.

| 변경 시점 | 건드리는 파일 | 건드리지 않는 파일 |
|---|---|---|
| **2단계: gRPC 전환** (EC2 멀티호스트) | `agent/reader.go` 만 교체 | stats, hub, model, resolver 전부 무관 |
| **2단계: EC2 IP 매핑** | `resolver/` 에 `StaticResolver` 이미 구현됨. `main.go` 에서 선택만 변경 | stats, hub 무관 |
| **3단계: k8s 지원** | `resolver/k8s_resolver.go` 파일 추가. `main.go` 에서 선택만 변경 | stats, hub 무관 |
| **spike 임계값 조정** | `stats/stats.go` 의 `spikeMultiplier` 상수만 변경 | 나머지 전부 무관 |
| **이벤트 필드 추가** (jitter, cwnd 등) | `model/event.go` + `agent/tcp_trace_common.h` 두 곳만 | 나머지는 새 필드를 그냥 통과시킴 |

## 📋 주요 명령어
- **에이전트 빌드:** `make build-ebpf`
- **백엔드 실행:** `go run main.go`
- **프론트엔드 개발 서버:** `npm run dev` (React Web, Vite 기반)

## 기타 AI 가 명시해야 할 것
- 사용자의 단어 구분 : 
  토폴로지 - Web UI 에서 컨테이너들을 시각화한 것을 말함
  그래프 - Web UI 에서 p99, p95 등 측정 지표를 선 그래프로 나타낸 것을 말함
  둘이 헷갈리지 말 것

