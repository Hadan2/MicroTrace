# eBPF 기초

## eBPF란?

> "커널 소스를 수정하지 않고, 커널 안에서 안전하게 코드를 실행하는 기술"

### 왜 필요한가?

원래 커널 안에서 코드를 실행하려면 **커널 모듈**을 만들어야 했음.
커널 모듈은 버그 하나가 전체 시스템을 다운시킬 수 있는 위험한 방식.

eBPF는 이 문제를 해결:

| 항목 | 커널 모듈 | eBPF |
|------|-----------|------|
| 안전성 | 버그 시 커널 패닉(블루스크린) 가능 | Verifier가 사전에 안전성 검증 |
| 배포 | 재부팅 필요할 수 있음 | 런타임에 로드/언로드 |
| 오버헤드 | 상대적으로 높음 | JIT 컴파일로 낮음 |

---

## eBPF 동작 원리

```
1. 작성: eBPF 프로그램을 C 문법 서브셋으로 작성
         ↓
2. 컴파일: clang -target bpf → .o 파일 (BPF 바이트코드)
         ↓
3. 로드: 유저 공간 프로그램이 bpf() syscall로 커널에 로드
         ↓
4. 검증: 커널 Verifier가 안전성 검사
         - 무한루프 없는지?
         - 메모리 범위 초과 없는지?
         - 허용된 함수만 쓰는지?
         ↓
5. JIT: Just-In-Time 컴파일 → x86 네이티브 코드로 변환
         ↓
6. 실행: 지정한 커널 이벤트(훅)가 발생할 때마다 자동 실행
```

---

## kprobe - 커널 함수에 갈고리 걸기

### 이게 뭔지
커널 함수 진입 시점에 우리 코드를 자동으로 실행시키는 방법.

### 왜 필요한가
TCP 연결이 발생하는 시점을 감지하려면, 커널 내부의 `tcp_connect()` 함수가
호출되는 순간을 포착해야 함. kprobe가 그 역할을 함.

### 어떻게 동작하는가

```
kprobe 없을 때:
  앱의 connect() 호출 → 커널 tcp_connect() 실행 → TCP 연결 처리

kprobe 있을 때:
  앱의 connect() 호출 → 🪝 우리 eBPF 코드 실행! → 커널 tcp_connect() 실행
                         (여기서 PID, IP 등 수집)
```

```c
// eBPF 코드에서 kprobe 선언 방법
SEC("kprobe/tcp_connect")        // tcp_connect 함수에 갈고리 걸기
int BPF_KPROBE(handle_tcp_connect, struct sock *sk) {
    // tcp_connect가 호출될 때마다 여기가 실행됨
}
```

### kretprobe
- `kprobe`: 함수 **진입** 시점에 실행
- `kretprobe`: 함수 **리턴** 시점에 실행 → 함수 실행 시간 측정에 활용

## kprobe vs tracepoint (커널 감시 지점)

eBPF 프로그램을 커널 어디에 붙일지 결정하는 두 가지 주요 방법입니다.

| 구분 | kprobe | tracepoint |
|------|:---:|:---:|
| **개념** | 커널의 **거의 모든 함수**에 설치 가능 | 커널 개발자가 **미리 정해둔** 감시 지점 |
| **유연성** | 매우 높음 (어디든 찌를 수 있음) | 낮음 (정해진 곳만 가능) |
| **안정성** | 낮음 (커널 버전마다 함수명이 바뀔 수 있음) | 높음 (버전이 바뀌어도 이름이 유지됨) |
| **성능** | 약간의 오버헤드 있음 | 매우 빠름 (최적화되어 있음) |

### 결론
- **가급적 `tracepoint`를 먼저 찾아서 사용**하세요. (더 튼튼하고 안전합니다.)
- `tracepoint`가 없는 깊숙한 커널 내부를 보고 싶을 때만 `kprobe`를 사용합니다.


---

## eBPF Maps - 커널↔유저 공간 데이터 공유

### 이게 뭔지
eBPF 프로그램(커널)과 유저 공간 프로그램이 데이터를 주고받는 **공유 저장소**.

### 왜 필요한가
eBPF 프로그램은 커널 안에서 실행되므로 직접 `printf()`를 할 수 없음.
데이터를 Map에 저장하면 유저 공간에서 읽어갈 수 있음.

### 어떻게 동작하는가

```
Kernel Space                    User Space
┌──────────────┐                ┌──────────────┐
│ eBPF Program │                │   우리 앱     │
│              │                │              │
│  측정한 RTT  │──▶ BPF Map ◀──│  데이터 읽기  │
│  값을 저장   │   (공유 메모리) │  터미널 출력  │
└──────────────┘                └──────────────┘
```

### 주요 Map 타입

| 타입 | 특징 | MicroTrace 활용 |
|------|------|----------------|
| `BPF_MAP_TYPE_HASH` | key-value 해시맵 | 연결별 타임스탬프 저장 |
| `BPF_MAP_TYPE_RINGBUF` | 링 버퍼, 이벤트 스트리밍 | 이벤트를 유저로 전달 |
| `BPF_MAP_TYPE_ARRAY` | 고정 크기 배열 | 통계 카운터 |

---

## Ring Buffer (핵심!)

### 이게 뭔지
커널에서 유저 공간으로 **이벤트를 실시간 스트리밍**하는 특수 Map.

### 왜 Ring Buffer인가 (일반 Map 대비 장점)

```
일반 Hash Map 방식:
  eBPF → Map에 저장 → 유저가 주기적으로 폴링(계속 확인)
  단점: 유저가 읽기 전에 덮어쓰일 수 있음, 실시간성 떨어짐

Ring Buffer 방식:
  eBPF → Ring Buffer에 추가 → 유저에게 즉시 알림(epoll)
  장점: zero-copy, lock-free, 실시간 이벤트 처리
```

- **zero-copy**: 커널→유저 불필요한 메모리 복사 없음 → 성능 향상
- **lock-free**: 여러 CPU가 동시에 써도 충돌 없음
- **overflow 감지**: 버퍼가 가득 찼을 때 드롭 카운팅 가능

### MicroTrace의 데이터 흐름

```
eBPF (Kernel)
  │
  │  bpf_ringbuf_reserve() → 공간 예약
  │  데이터 채움
  │  bpf_ringbuf_submit() → 전송
  ▼
Ring Buffer (커널 메모리)
  │
  │  epoll로 이벤트 감지 (블로킹 없이 대기)
  ▼
유저 공간 C 프로그램
  │
  │  터미널 출력
  ▼
(Phase 2에서) Go 앱 → gRPC → 대시보드
```

---

## bpftool - eBPF 디버깅 도구

### 이게 뭔지
현재 커널에 로드된 eBPF 프로그램과 Map을 조회/디버깅하는 CLI 도구.
마치 `ps` 명령어로 프로세스를 보듯이, 로드된 eBPF 프로그램을 볼 수 있음.

### 주요 사용법
```bash
/usr/local/sbin/bpftool prog list      # 로드된 eBPF 프로그램 목록
/usr/local/sbin/bpftool map list       # 존재하는 eBPF Map 목록
/usr/local/sbin/bpftool map dump id <id>  # 특정 Map 내용 조회
```

### MicroTrace에서 언제 쓰나?
- eBPF 프로그램이 제대로 로드됐는지 확인
- Ring Buffer Map에 데이터가 쌓이는지 확인
- 프로그램이 예상대로 동작 안 할 때 디버깅

### WSL2 설치 방법 (apt 불가)
WSL2는 Microsoft 커스텀 커널이라 apt의 bpftool이 커널 버전과 불일치.
소스에서 직접 빌드해야 함:
```bash
git clone --depth 1 https://github.com/libbpf/bpftool.git
cd bpftool
git submodule update --init   # 의존하는 libbpf 서브모듈 받기
cd src
make
sudo make install
# → /usr/local/sbin/bpftool 에 설치됨 (v7.7.0 확인)
```

---

## Verifier - eBPF 안전장치

### ① 이게 뭔지
eBPF 프로그램을 커널에 로드할 때 **커널이 직접 코드를 사전 검사하는 안전장치**.
코드를 실제로 실행하지 않고, 모든 가능한 실행 경로를 정적 분석함.

### ② 왜 필요한지
커널은 운영체제의 핵심. 여기서 코드가 잘못 실행되면 시스템 전체가 다운됨.
```
Verifier 없다면:
  while(1) { }  → 무한루프 → 커널 멈춤 → 시스템 다운
  *ptr = 1234   → 잘못된 메모리 접근 → 커널 패닉
```

### ③ 어떻게 동작하는가
```
유저 공간                    커널
    │  bpf() syscall로 로드  │
    │ ──────────────────────▶│
    │                   ┌────┴────┐
    │                   │Verifier │ ← 모든 실행 경로 정적 분석
    │                   └────┬────┘
    │              통과 ✅   │  실패 ❌
    │                        │
    │                  JIT 컴파일       에러 반환
    │                  → 실행 허가      → 로드 거부
```

**검사 항목:**
1. **무한루프 없는지** → 루프 횟수 제한 필요
2. **메모리 범위 초과 없는지** → 배열 접근 시 반드시 범위 체크
3. **NULL 포인터 역참조 없는지** → 포인터 사용 전 NULL 체크 필수
4. **허용된 함수만 쓰는지** → bpf_*() 헬퍼 함수만 호출 가능
5. **스택 512바이트 이하인지** → eBPF 스택 크기 제한

**실제 코드에서 Verifier를 위한 패턴:**
```c
struct event *e = bpf_ringbuf_reserve(...);
if (!e)       // ← 이 NULL 체크가 없으면 Verifier가 로드 자체를 거부!
    return 0;
```

---

## Skeleton - eBPF 유저 공간 래퍼

### 이게 뭔지
`bpftool gen skeleton` 명령이 `.bpf.o` 파일로부터 **자동 생성하는 C 헤더 파일**.
`tcp_trace.bpf.o` → `tcp_trace.skel.h`

### 왜 필요한가
eBPF 프로그램을 유저 공간에서 다루려면 원래 `bpf()` syscall을 직접 호출해야 함.
Skeleton은 이 과정을 **자동 생성된 래퍼 함수**로 감싸서 단순하게 만들어 줌.

```
bpf() syscall (raw)     skeleton 래퍼
───────────────────     ────────────────────────────
직접 fd 관리           tcp_trace_bpf__open()
직접 로드/검증          tcp_trace_bpf__load()
직접 attach 처리        tcp_trace_bpf__attach()
직접 정리               tcp_trace_bpf__destroy()
Map fd를 직접 조회       skel->maps.events  (직접 접근)
```

### tcp_trace.c 에서 skeleton 사용 흐름

```c
#include "tcp_trace.skel.h"   // bpftool이 자동 생성한 헤더

// 1. .bpf.o 를 메모리에 로드하고 구조체로 감싸줌
struct tcp_trace_bpf *skel = tcp_trace_bpf__open();

// 2. Verifier 검증 후 커널에 로드
tcp_trace_bpf__load(skel);

// 3. kprobe 훅 연결
tcp_trace_bpf__attach(skel);

// 4. Map에 직접 접근 (fd를 직접 찾을 필요 없음)
ring_buffer__new(bpf_map__fd(skel->maps.events), ...);

// 5. 리소스 해제
tcp_trace_bpf__destroy(skel);
```

### skeleton 생성 방법
```bash
# .bpf.o → .skel.h 자동 생성
bpftool gen skeleton tcp_trace.bpf.o > tcp_trace.skel.h
```

> 보통 Makefile에서 컴파일 단계에 자동으로 포함됨.

---

## CO-RE (Compile Once - Run Everywhere)

### 이게 뭔지
eBPF 프로그램을 한 번만 컴파일해도 다른 버전의 Linux 커널에서도 동작하게 하는 기술.

### 왜 필요한가
원래 eBPF는 커널 내부 구조체(예: `struct sock`)의 필드 위치가 커널 버전마다 달라서,
버전마다 다시 컴파일해야 했음.

CO-RE는 **BTF(BPF Type Format)** 라는 타입 정보를 활용해서
런타임에 필드 위치를 자동으로 맞춰줌.

```
CO-RE 없이:
  커널 5.15용 빌드 → 커널 6.1에서 실행 → 필드 위치 달라서 오작동

CO-RE 있이:
  한 번 빌드 → 어떤 커널에서도 BTF로 자동 조정 → 정상 동작
```

MicroTrace는 CO-RE 방식을 사용 → WSL2, EC2, 다양한 환경에서 재컴파일 없이 배포 가능.

