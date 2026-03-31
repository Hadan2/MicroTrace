# MicroTrace 전체 프로그램 흐름

## 전체 그림

```
[tcp_trace.bpf.c] → 컴파일 → [tcp_trace.bpf.o]
                                      ↓
                   bpftool gen skeleton → [tcp_trace.skel.h]
                                      ↓
              [tcp_trace.c] 가 skel.h 를 include 해서 사용
```

두 파일의 역할:

| 파일 | 실행 위치 | 역할 |
|------|-----------|------|
| `tcp_trace.bpf.c` | 커널 공간 | TCP 연결 감지 → Ring Buffer에 이벤트 기록 |
| `tcp_trace.c` | 유저 공간 | eBPF 로드/연결, Ring Buffer 읽어서 출력 |

---

## 빌드 타임 (실행 전)

`tcp_trace.bpf.c`는 커널용 코드라 일반 gcc로 컴파일하지 않는다.

```bash
# 1. eBPF 바이트코드 컴파일
clang -target bpf -O2 -c tcp_trace.bpf.c -o tcp_trace.bpf.o

# 2. skeleton 헤더 자동 생성
bpftool gen skeleton tcp_trace.bpf.o > tcp_trace.skel.h

# 3. 유저 공간 에이전트 컴파일
gcc tcp_trace.c -o tcp_trace -lbpf

# 4. Go collector 빌드
cd collector && go build -o collector main.go
```

### 빌드 결과물 관계

```
tcp_trace.bpf.c
    │
    │ clang -target bpf
    ▼
tcp_trace.bpf.o (eBPF 바이트코드 - ELF 형식)
    │
    │ bpftool gen skeleton
    ▼
tcp_trace.skel.h (자동 생성)
    │  - .bpf.o 의 바이트코드가 배열로 통째로 박힘
    │  - __open(), __load(), __attach(), __destroy() 래퍼 함수 포함
    │
    └── tcp_trace.c 가 include 해서 사용
            │
            │ gcc
            ▼
        tcp_trace (실행파일) ← collector 가 subprocess로 실행
            │
            │ stdout (JSON 스트림)
            ▼
        collector/main.go
            │
            │ go build
            ▼
        collector (실행파일)
```

### skeleton(skel.h)이란?

`bpftool gen skeleton`이 자동으로 생성하는 헤더 파일.
`.bpf.o`의 바이트코드가 배열로 통째로 박히고, 그걸 다루는 래퍼 함수들이 생성된다.

```c
// tcp_trace.skel.h 내부 (자동 생성)

// .bpf.o 파일의 바이트코드가 배열로 박혀있음
static const char tcp_trace_bpf_elf[] = { 0x7f, 0x45, 0x4c, 0x46, ... };

// 래퍼 함수들
struct tcp_trace_bpf { ... };
struct tcp_trace_bpf *tcp_trace_bpf__open();
int                   tcp_trace_bpf__load(struct tcp_trace_bpf *);
int                   tcp_trace_bpf__attach(struct tcp_trace_bpf *);
void                  tcp_trace_bpf__destroy(struct tcp_trace_bpf *);
```

skeleton 덕분에 유저 공간에서 `bpf()` syscall을 직접 호출하지 않아도 된다.
"`.bpf.o`를 메모리에 로드"란 이 배열에 박힌 바이트코드를 메모리에 올리는 것이다. 별도 파일을 읽는 게 아니라 skel.h 안에 이미 포함되어 있다.

---

## 실행 순서

### 1단계: `tcp_trace_bpf__open()`

```c
struct tcp_trace_bpf *skel = tcp_trace_bpf__open();
```

- skel.h 안에 박힌 바이트코드를 메모리에 파싱
- `struct tcp_trace_bpf` 구조체를 만들어 반환
- 이 구조체 안에 Map, 프로그램 정보 등이 정리됨
- **아직 커널에는 아무것도 올라가지 않은 상태**

---

### 2단계: `tcp_trace_bpf__load(skel)`

```c
int err = tcp_trace_bpf__load(skel);
```

- 파싱된 eBPF 바이트코드를 `bpf()` syscall로 커널에 전달
- **커널 Verifier** 검증: 무한루프 없는지, 메모리 범위 벗어나지 않는지 등
- 통과하면 Ring Buffer Map(`events`)을 커널 메모리에 생성
- eBPF 프로그램이 커널에 올라감 (아직 훅 연결은 안 됨)

---

### 3단계: `tcp_trace_bpf__attach(skel)`

```c
err = tcp_trace_bpf__attach(skel);
```

- `.bpf.c`에 선언된 `SEC("kprobe/tcp_connect")`를 보고
- 커널의 `tcp_connect()` 함수에 **kprobe 훅 연결**
- 이 순간부터 누군가 TCP 연결을 시도하면 `handle_tcp_connect`가 실행됨

---

### 4단계: Ring Buffer 설정

```c
struct ring_buffer *rb = ring_buffer__new(
    bpf_map__fd(skel->maps.events),  // .bpf.c 의 events Map fd
    handle_event,                     // 이벤트 올 때 호출할 콜백
    NULL, NULL
);
```

- `skel->maps.events` = `.bpf.c`에서 선언한 Ring Buffer Map
- `bpf_map__fd()`로 그 Map의 파일 디스크립터(fd)를 가져옴
- 유저 공간에서 이 fd를 통해 Ring Buffer를 읽을 준비 완료

---

### 5단계: 이벤트 루프

```c
while (running) {
    ring_buffer__poll(rb, 100); // 100ms마다 Ring Buffer 체크
}
```

누군가 TCP 연결 시도 시 전체 흐름:

```
유저 프로세스 (예: curl google.com)
  └→ 커널 내부에서 tcp_connect() 호출
       └→ kprobe 발동 → handle_tcp_connect() 실행 [커널 공간]
            ├→ IPv4 여부 확인 (family != AF_INET 이면 종료)
            ├→ bpf_ringbuf_reserve() 로 Ring Buffer 공간 확보
            ├→ PID, 프로그램명, 목적지 IP/포트 기록
            └→ bpf_ringbuf_submit() 으로 이벤트 제출
                 └→ ring_buffer__poll() 이 감지 [유저 공간]
                      └→ handle_event() 콜백 호출
                           └→ printf() 로 터미널 출력
```

---

## collector Go 파이프라인 (패키지 분리 후 현재 구조)

```
sudo go run main.go
    │
    ├── hub.New() + go hub.Run()          WebSocket 허브 시작
    ├── resolver.NewDockerResolver(ctx)   Docker API 캐시 초기화
    ├── stats.New(resolver, hub.Broadcast) Processor 생성
    ├── go proc.Run(eventCh)              이벤트 집계 goroutine 시작
    ├── agent.New("../agent/tcp_trace")
    │   └── cmd = exec.Command(binaryPath) sudo 없이 실행 (이미 root)
    │   └── cmd.Start() → tcp_trace 자식 프로세스 실행
    │   └── go func: stdout → eventCh   JSON 파싱 goroutine 시작
    └── http.ListenAndServe(":9090")     WebSocket 서버 시작
```

### 이벤트 하나의 전체 여정

```
[tcp_trace 프로세스]
  stdout: {"type":"rtt","daddr":"172.17.0.3","dport":8080,"latency_us":1234}
    │
    │ stdout 파이프
    ▼
[agent/reader.go]
  scanner.Scan() → json.Unmarshal → model.Event{Type:"rtt", DAddr:"172.17.0.3", ...}
    │
    │ eventCh <- event
    ▼
[stats/stats.go] proc.Run()
  handleEvent(e):
    ├── resolver.Resolve("172.17.0.3") → "service-b"  (Docker API 캐시)
    ├── RawEvent{Type:"rtt", SrcService:"unknown", DstService:"service-b", ...}
    ├── broadcast(OutboundMsg{MsgType:"event", Event:&raw})  즉시 전송
    └── connStats.addRTT(1234)  링버퍼에 추가

  1초 타이머마다:
    ├── 링버퍼 복사 → 정렬 → p50/p95/p99 계산
    ├── isSpike 판단
    └── broadcast(OutboundMsg{MsgType:"stats", Stats:&snap})
    │
    │ hub.Broadcast()
    ▼
[hub/hub.go] Run()
  json.Marshal(msg) → []byte
    │
    │ WebSocket
    ▼
[브라우저 localhost:9090]
  msg.msg_type === "event" → 실시간 이벤트 로그 추가
  msg.msg_type === "stats" → p50/p95/p99 통계판 업데이트
```

### 패키지 구조와 역할

```
collector/
  main.go          진입점, 각 패키지 조립만
  model/event.go   공유 타입 (Event, OutboundMsg, StatSnapshot)
  agent/reader.go  subprocess 실행 + stdout → chan model.Event
  hub/hub.go       WebSocket 클라이언트 관리 + 브로드캐스트
  resolver/        IP → 서비스명 변환
    resolver.go    ServiceResolver 인터페이스
                   DockerResolver (현재)
                   StaticResolver (테스트/EC2용)
  stats/stats.go   RTT 링버퍼 + p50/p95/p99 + spike 감지 + 1초 스냅샷
```

### 실행 방법

```bash
# collector는 root 권한 필요 (eBPF attach)
cd collector
sudo go run main.go

# 브라우저에서 확인
# http://localhost:9090
```

---

### 6단계: 종료 (`Ctrl+C`)

```c
ring_buffer__free(rb);
tcp_trace_bpf__destroy(skel);
```

- Ring Buffer 해제
- kprobe 훅 해제
- 커널에서 eBPF 프로그램 제거
- 메모리 정리

---

## 단계별 요약

| 단계 | 함수 | 위치 | 하는 일 |
|------|------|------|---------|
| 1 | `__open()` | 유저 공간 | 바이트코드 메모리에 파싱 |
| 2 | `__load()` | 커널 | Verifier 검증 + Map/프로그램 커널에 등록 |
| 3 | `__attach()` | 커널 | kprobe 훅 연결 (tcp_connect에 갈고리) |
| 4 | `ring_buffer__new()` | 유저 공간 | Ring Buffer 폴러 준비 |
| 5 | `ring_buffer__poll()` 루프 | 유저 공간 | 이벤트 감시 + 콜백 출력 |
| 6 | `__destroy()` | 커널+유저 | 훅 해제, 메모리 정리 |

---

## 핵심 개념 정리

### CO-RE (Compile Once, Run Everywhere)
`.bpf.c`에서 `BPF_CORE_READ()` 매크로를 사용하는 이유.
커널 버전마다 구조체 필드 오프셋이 다를 수 있는데, CO-RE는 런타임에 BTF 정보를 참조해서 올바른 오프셋을 자동으로 찾아준다.

```c
// 일반 포인터 역참조 (커널 버전 의존)
__u16 family = sk->__sk_common.skc_family;  // 위험

// CO-RE 방식 (커널 버전 무관)
__u16 family = BPF_CORE_READ(sk, __sk_common.skc_family);  // 안전
```

### Ring Buffer
커널 → 유저 공간 데이터 전달 통로.
- 커널: `bpf_ringbuf_reserve()` → 데이터 채움 → `bpf_ringbuf_submit()`
- 유저: `ring_buffer__poll()` → 데이터 있으면 콜백 호출
- 버퍼가 가득 차면 이벤트 드롭 (유실 가능)

### kprobe
커널 함수 앞에 갈고리를 거는 메커니즘.
`SEC("kprobe/tcp_connect")` 선언만으로 `tcp_connect()` 호출 시마다 eBPF 함수가 실행된다.

---

## 현재 완료 / 미완성

```
완료 ✓
  커널 tcp_connect 감지        (eBPF kprobe)
  Ring Buffer 로 유저공간 전달 (bpf_ringbuf)
  JSON 으로 stdout 출력        (tcp_trace.c - output_event)
  subprocess 실행 + 파이프     (collector main.go)
  JSON 파싱 → Event 구조체     (json.Unmarshal)
  터미널 출력                  (handleEvent)

미완성 ☐
  WebSocket 스트리밍           (브라우저/대시보드로 전달)
  대시보드 UI                  (실시간 그래프)
  latency 측정                 (RTT, 재전송 추적)
```
