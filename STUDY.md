# MicroTrace 학습 노트

> 공부하면서 진행하는 eBPF 기반 네트워크 프로파일러 프로젝트 학습 기록

---

## 목차
1. [개발 환경 세팅](#1-개발-환경-세팅)
2. [Linux 커널 기초](#2-linux-커널-기초)
3. [eBPF 핵심 개념](#3-ebpf-핵심-개념)
4. [Go 언어 기초](#4-go-언어-기초)
5. [gRPC / WebSocket](#5-grpc--websocket)

---

## 1. 개발 환경 세팅

### 왜 Linux가 필요한가?
eBPF는 Linux 커널 기술이므로 반드시 Linux 환경에서 개발/실행해야 함.
Windows에서는 WSL2 또는 Linux VM을 사용.

### WSL2 세팅 (권장)

WSL2는 Windows 위에서 실제 Linux 커널을 실행하는 가상화 기술.
eBPF 개발에 필요한 커널 기능을 대부분 지원함.

**설치 순서:**

```powershell
# 1. PowerShell (관리자)에서 WSL2 설치
wsl --install

# 2. 재부팅 후 Ubuntu 설치 확인
wsl --list --verbose

# 3. Ubuntu로 진입
wsl
```

**WSL2 진입 후 eBPF 개발 패키지 설치:**

```bash
sudo apt update && sudo apt upgrade -y

# 핵심 패키지
sudo apt install -y \
    clang \          # C/eBPF 컴파일러
    llvm \           # LLVM 백엔드 (clang 의존)
    libbpf-dev \     # libbpf 라이브러리 (eBPF 로더)
    linux-headers-$(uname -r) \  # 현재 커널 헤더
    bpftool \        # eBPF 디버그 도구
    gcc \
    make \
    git \
    golang-go        # Go 언어
```

**설치 검증:**
```bash
uname -r          # 커널 버전 확인 (5.15+ 권장)
clang --version   # clang 확인
bpftool version   # bpftool 확인
go version        # Go 확인
```

---

## 2. Linux 커널 기초

### 유저 공간 vs 커널 공간

```
┌─────────────────────────────────┐
│       User Space (유저 공간)      │
│  앱, 쉘, 라이브러리 (glibc 등)    │
│  - 직접 하드웨어 접근 불가         │
│  - 메모리 보호됨                  │
├─────────────────────────────────┤
│         System Call Interface   │  ← 이 경계를 넘어야 커널 기능 사용
├─────────────────────────────────┤
│       Kernel Space (커널 공간)    │
│  TCP/IP 스택, 파일시스템,          │
│  프로세스 스케줄러, 드라이버 등     │
│  - 하드웨어 직접 접근 가능          │
└─────────────────────────────────┘
```

**핵심 개념:**
- **Syscall**: 유저 공간 → 커널 공간으로 진입하는 유일한 공식 경로
  - `connect()`, `send()`, `recv()`, `close()` 등이 모두 syscall
  - TCP 연결이 맺어질 때 내부적으로 여러 syscall이 호출됨
- **Context Switch**: 유저↔커널 전환 시 CPU 상태 저장/복원 → 비용 발생

### TCP 연결의 흐름 (간략)

```
Client                          Server
  │                               │
  │──── SYN ─────────────────────▶│   (connect() 호출)
  │◀─── SYN-ACK ──────────────────│
  │──── ACK ─────────────────────▶│   (3-way handshake 완료)
  │                               │
  │──── DATA ────────────────────▶│   (send() 호출)
  │◀─── ACK ──────────────────────│
  │                               │
  │  RTT = DATA 전송 ~ ACK 수신    │   ← MicroTrace가 측정하는 것
```

**RTT (Round Trip Time)**: 패킷을 보내고 응답을 받기까지의 시간 → 네트워크 지연의 핵심 지표

---

## 3. eBPF 핵심 개념

### eBPF란?

> "커널 소스를 수정하지 않고, 커널 안에서 안전하게 코드를 실행하는 기술"

기존 방식 (커널 모듈) vs eBPF:

| 항목 | 커널 모듈 | eBPF |
|------|-----------|------|
| 안전성 | 버그 시 커널 패닉 가능 | Verifier가 사전 검증 |
| 배포 | 재부팅 필요할 수 있음 | 런타임에 로드/언로드 |
| 오버헤드 | 상대적으로 높음 | JIT 컴파일로 낮음 |
| 난이도 | 매우 높음 | 상대적으로 낮음 |

### eBPF 동작 원리

```
1. 작성: eBPF 프로그램 (C 문법 서브셋으로 작성)
         ↓
2. 컴파일: clang -target bpf → .o (BPF 바이트코드)
         ↓
3. 로드: 유저 공간 앱이 bpf() syscall로 커널에 로드
         ↓
4. 검증: 커널 Verifier가 안전성 검사
         (무한루프 없는지, 메모리 범위 초과 없는지 등)
         ↓
5. JIT: Just-In-Time 컴파일 → x86 네이티브 코드
         ↓
6. 실행: 지정한 커널 이벤트(훅)가 발생할 때마다 자동 실행
```

### eBPF 프로그램 타입 (주요)

| 타입 | 훅 위치 | MicroTrace 활용 |
|------|---------|----------------|
| `kprobe` | 커널 함수 진입 시 | TCP 함수 호출 추적 |
| `kretprobe` | 커널 함수 리턴 시 | 함수 실행 시간 측정 |
| `tracepoint` | 정적으로 정의된 추적점 | TCP 재전송 이벤트 |
| `socket filter` | 소켓 수신 패킷 | 패킷 필터링 |

### eBPF Maps - 커널↔유저 공간 통신

eBPF 프로그램은 직접 유저 공간으로 데이터를 보낼 수 없음.
대신 **Map**이라는 공유 데이터 구조를 사용:

```
Kernel Space                    User Space
┌──────────────┐                ┌──────────────┐
│ eBPF Program │                │   Go 앱       │
│              │                │              │
│  측정한 RTT  │──▶ BPF Map ◀──│  데이터 읽기  │
│  값을 저장   │   (공유 메모리) │              │
└──────────────┘                └──────────────┘
```

**주요 Map 타입:**
- `BPF_MAP_TYPE_HASH`: key-value 해시맵 (연결별 타임스탬프 저장)
- `BPF_MAP_TYPE_RINGBUF`: Ring Buffer (이벤트 스트리밍, 가장 효율적)
- `BPF_MAP_TYPE_ARRAY`: 고정 크기 배열

### Ring Buffer (핵심!)

MicroTrace의 핵심 데이터 전달 경로:

```
eBPF (Kernel)
  │
  │  bpf_ringbuf_output() 호출
  ▼
Ring Buffer (커널 메모리)
  │
  │  poll / epoll 로 이벤트 감지
  ▼
Go 앱 (User Space)
  │
  │  채널로 전달
  ▼
gRPC 스트리밍 → 대시보드
```

**왜 Ring Buffer인가?**
- **zero-copy**: 커널→유저 불필요한 메모리 복사 없음
- **lock-free**: 락 없이 다중 CPU 동시 쓰기 지원
- **overflow 감지**: 가득 찼을 때 드롭 카운팅 가능

---

## 4. Go 언어 기초

*(Phase 2 시작 시 채워질 예정)*

---

## 5. gRPC / WebSocket

*(Phase 2 시작 시 채워질 예정)*

---

## 참고 자료

- [Cilium eBPF Go 라이브러리](https://github.com/cilium/ebpf)
- [libbpf 공식 문서](https://libbpf.readthedocs.io/)
- [BPF Performance Tools (Brendan Gregg)](http://www.brendangregg.com/bpf-performance-tools-book.html)
- [Linux Kernel eBPF 문서](https://www.kernel.org/doc/html/latest/bpf/)
