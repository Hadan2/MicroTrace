# MicroTrace 프로젝트 가이드 (CLAUDE.md)

## 👤 사용자 배경
- Linux 처음 사용. 기본 명령어(ls, cd, mkdir 등)도 모를 수 있음
- 명령어 실행 시 역할과 옵션 의미를 항상 함께 설명할 것
- 처음 보는 개념은 비유나 그림(ASCII)으로 자세히 설명할 것. 한줄 요약 금지
- 개념 설명 시 ① 이게 뭔지 ② 왜 필요한지 ③ 어떻게 동작하는지 순서로 설명
- 한글로 설명할 것.

## 📖 Study 폴더 관리 규칙
- 프로젝트 루트의 `Study/` 폴더 하위에 주제별 `.md` 파일을 생성/관리
- 새로운 개념이 등장할 때마다 해당 주제의 파일에 추가. 파일이 없으면 새로 생성
- 파일 분류 기준:
  - `Study/linux.md` ← Linux 명령어, 파일시스템, 권한 등
  - `Study/ebpf.md` ← eBPF 개념, kprobe, Map, Ring Buffer, Verifier 등
  - `Study/tcp.md` ← TCP 연결 흐름, RTT, 재전송, 3-way handshake 등
  - `Study/go.md` ← Go 언어 문법, goroutine, channel 등
  - 새 주제 등장 시 새 파일 생성
- 설명은 비유/흐름도를 포함하여 자세하게 작성

## 🎯 프로젝트 개요
MicroTrace는 MSA 환경에서 1ms 미만의 지연 시간(Latency Spike)과 TCP 재전송을 추적하는 eBPF 기반 실시간 네트워크 프로파일러입니다.
개발 기획서는 **README.md** 를 참고하세요.

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

## 🖥 개발 환경 세팅 (WSL2 기준)

### 설치 명령어 및 역할 설명

```bash
sudo apt update && sudo apt upgrade -y
```
- `apt update`: 설치 가능한 패키지 목록을 최신으로 갱신 (실제 설치 X)
- `apt upgrade -y`: 현재 설치된 패키지들을 최신 버전으로 업그레이드. `-y`는 중간에 "계속할까요?" 질문을 자동으로 yes 처리

```bash
sudo apt install -y clang llvm libbpf-dev gcc make git
```
- `clang`: eBPF C 코드를 BPF 바이트코드로 컴파일하는 컴파일러. gcc는 `-target bpf` 미지원이라 clang 필수
- `llvm`: clang의 백엔드. 실제 BPF 바이트코드를 생성하는 엔진
- `libbpf-dev`: eBPF 프로그램을 커널에 로드하고 Map을 다루는 C 라이브러리. CO-RE 지원
- `gcc`: 일반 C 코드 컴파일용 (libbpf 빌드 등 보조 역할)
- `make`: Makefile 기반 빌드 자동화 도구
- `git`: 버전 관리

```bash
sudo apt install -y linux-tools-common linux-tools-generic
```
- `linux-tools-common`: bpftool 등 Linux 커널 디버깅 도구 모음
- `linux-tools-generic`: 현재 커널에 맞는 perf, bpftool 바이너리 제공
- `bpftool`: 로드된 eBPF 프로그램/Map 조회, 디버깅용 CLI 도구

```bash
# Go 설치
wget https://go.dev/dl/go1.22.3.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.22.3.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc
```
- `wget`: Go 공식 바이너리 tarball 다운로드
- `tar -C /usr/local -xzf`: `/usr/local`에 압축 해제 (`-x`: 압축 해제, `-z`: gzip, `-f`: 파일 지정)
- `echo ... >> ~/.bashrc`: PATH에 Go 바이너리 경로 영구 추가
- `source ~/.bashrc`: 변경된 PATH를 현재 세션에 즉시 적용

### 설치 검증
```bash
uname -r        # 커널 버전 확인 (5.15+ 권장)
clang --version # clang 확인
go version      # Go 확인
```

### WSL2 특이사항
- WSL2는 Microsoft 커스텀 커널을 사용하므로 `linux-headers-$(uname -r)` 패키지가 apt에 없는 경우가 있음
- 이 경우 `linux-headers-generic`으로 대체 가능
- eBPF CO-RE 방식을 사용하면 커널 헤더 없이도 동작 가능 (BTF 활용)