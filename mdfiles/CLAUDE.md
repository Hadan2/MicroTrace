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
- **프론트엔드/데스크톱:** Wails v2/v3 (Go + React/TS)
- **환경:** Linux (Ubuntu 22.04+ / eBPF 활성화된 WSL2 커널)

## 📚 학습 및 문서화 (핵심 지침)
- **개념 우선:** 새로운 기능 구현 전, 반드시 관련 개념을 먼저 설명할 것
- **Study 폴더:** 상세 개념 설명은 `Study/` 하위 주제별 파일에 작성 (ebpf.md, tcp.md, linux.md, go.md 등)
- **STUDY.md 역할 축소:** `mdfiles/STUDY.md`는 구현 진행 상황을 간략히 기록하는 용도로만 사용
  - 구현한 내용 한줄 요약
  - 관련 Study 파일 링크 (예: 자세한 내용은 `Study/ebpf.md` 참고)
  - 트러블슈팅 메모

## 💻 코딩 스타일 및 규칙
- **eBPF (C):** 리눅스 커널 코딩 스타일 준수. CO-RE(Compile Once – Run Everywhere) 방식 지향. eBPF 검증기(Verifier) 제약 조건을 고려한 메모리 안전성 확보.
- **Backend (Go):** Idiomatic Go 스타일. 스트리밍 데이터 처리에 채널(Channel) 활용. 철저한 에러 처리.
- **Frontend (TS/React):** 함수형 컴포넌트 사용. 고빈도 데이터 처리를 위한 성능 최적화(Canvas 등).

## 📋 주요 명령어
- **에이전트 빌드:** `make build-ebpf`
- **백엔드 실행:** `go run main.go`
- **Wails 개발 모드:** `wails dev`

