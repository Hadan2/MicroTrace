# MicroTrace 전체 프로그램 흐름

## 전체 그림

```
[tcp_trace.bpf.c] → 컴파일 → [tcp_trace.bpf.o]
                                      ↓
                   bpftool gen skeleton → [tcp_trace.skel.h]
                                      ↓
              [tcp_trace.c] 가 skel.h 를 include 해서 사용
```

| 파일 | 실행 위치 | 역할 |
|------|-----------|------|
| `tcp_trace.bpf.c` | 커널 공간 | TCP 소켓 이벤트 감지 → Ring Buffer에 이벤트 기록 |
| `tcp_trace.c` | 유저 공간 | eBPF 로드/연결, Ring Buffer 읽어서 JSON stdout 출력 |
| `resource_agent/main.go` | 유저 공간 | cgroup v2 파일 읽기 → 리소스 지표 JSON stdout 출력 |
| `collector/` | 유저 공간 | 두 subprocess 파이프 수신 + 집계 + WebSocket 발행 |

---

## 빌드 타임 (실행 전)

```bash
# 1. eBPF 바이트코드 컴파일
clang -target bpf -O2 -c tcp_trace.bpf.c -o tcp_trace.bpf.o

# 2. skeleton 헤더 자동 생성
bpftool gen skeleton tcp_trace.bpf.o > tcp_trace.skel.h

# 3. 유저 공간 에이전트 컴파일
gcc tcp_trace.c -o tcp_trace -lbpf

# 4. resource_agent 빌드
cd resource_agent && go build -o resource_agent .

# 5. collector 빌드 (개발 중엔 go run 으로 실행)
cd collector && go build -o collector .
```

### skeleton(skel.h)이란?

`bpftool gen skeleton`이 자동으로 생성하는 헤더 파일.
`.bpf.o`의 바이트코드가 배열로 통째로 박히고, 그걸 다루는 래퍼 함수들이 생성된다.

```c
// 래퍼 함수들 (skel.h 내부, 자동 생성)
struct tcp_trace_bpf *tcp_trace_bpf__open();
int                   tcp_trace_bpf__load(struct tcp_trace_bpf *);
int                   tcp_trace_bpf__attach(struct tcp_trace_bpf *);
void                  tcp_trace_bpf__destroy(struct tcp_trace_bpf *);
```

skeleton 덕분에 유저 공간에서 `bpf()` syscall을 직접 호출하지 않아도 된다.

---

## eBPF 실행 순서 (tcp_trace.c 내부)

| 단계 | 함수 | 위치 | 하는 일 |
|------|------|------|---------|
| 1 | `__open()` | 유저 공간 | 바이트코드 메모리에 파싱 |
| 2 | `__load()` | 커널 | Verifier 검증 + Map/프로그램 커널에 등록 |
| 3 | `__attach()` | 커널 | sock_ops 훅 연결 (루트 cgroup에 BPF_PROG_ATTACH) |
| 4 | `ring_buffer__new()` | 유저 공간 | Ring Buffer 폴러 준비 |
| 5 | `ring_buffer__poll()` 루프 | 유저 공간 | 이벤트 감시 + JSON stdout 출력 |
| 6 | `__destroy()` | 커널+유저 | 훅 해제, 메모리 정리 |

### sock_ops 이벤트 흐름

```
TCP 소켓에서 RTT 업데이트 발생
  └→ 커널이 sock_ops 프로그램 호출 [커널 공간]
       └→ BPF_SOCK_OPS_RTT_CB 분기
            ├→ saddr, daddr, dport, srtt_us 수집
            ├→ bpf_ringbuf_reserve() 로 Ring Buffer 공간 확보
            └→ bpf_ringbuf_submit() 으로 이벤트 제출
                 └→ ring_buffer__poll() 이 감지 [유저 공간]
                      └→ handle_event() 콜백 호출
                           └→ JSON 형식으로 stdout 출력
```

sock_ops를 사용하는 이유: kprobe(`tcp_connect`)는 새 연결 시에만 동작한다.
Keep-Alive 연결 위에서 반복되는 HTTP 요청의 RTT를 측정하려면 TCP 소켓 레벨에서
매 RTT 업데이트마다 콜백이 발생하는 sock_ops가 필요하다.

---

## collector Go 파이프라인

```
sudo go run .  (collector/)
    │
    ├── hub.New() + go hub.Run()
    │       WebSocket 클라이언트 관리 + broadcast 채널 소비
    │
    ├── resolver.NewDockerResolver(ctx)
    │       Docker API → IP→컨테이너명 캐시, 이벤트 스트림으로 실시간 갱신
    │   └── resolver.NewEnrichResolver(dockerResolver)
    │           Docker 캐시에 없는 외부 IP → rDNS + publicsuffix 로 도메인명
    │
    ├── stats.New(svcResolver, hub.Broadcast)
    │       Processor 생성. hub를 직접 임포트하지 않고 함수 포인터로만 받음
    │
    ├── h.SetHistoryFn(proc.GetHistory)
    │       신규 WebSocket 클라이언트 접속 시 히스토리 1회 전송용
    │
    ├── var agentProvider agent.EventProvider
    │   = agent.NewSubprocessProvider("../agent/tcp_trace")
    │       exec.CommandContext 로 tcp_trace 자식 프로세스 실행
    │       stdout → JSON 파싱 → chan model.Event
    │
    ├── go proc.Run(eventCh)
    │       이벤트 집계 goroutine 시작
    │
    ├── var resProvider resource.ResourceProvider
    │   = resource.NewSubprocessProvider("../resource_agent/resource_agent")
    │       exec.CommandContext 로 resource_agent 자식 프로세스 실행
    │       stdout → JSON 파싱 → chan model.ResourceSnapshot
    │
    ├── proc.ForwardResource(resCh)
    │       resource 스냅샷을 받아 hub.Broadcast("resource") 로 전달
    │       resource_agent 바이너리 없으면 경고만, latency 추적은 정상 동작
    │
    └── http.ListenAndServe(":9090")
            /ws  → hub.ServeWs (WebSocket 업그레이드)
            /    → 브라우저 테스트용 HTML
```

---

## 데이터 흐름 상세

### latency 이벤트 경로

```
[tcp_trace 프로세스] stdout
  {"type":"rtt","saddr":"172.17.0.2","daddr":"172.17.0.3","dport":8080,"latency_us":1234}
    │
    │ stdout 파이프
    ▼
[agent/reader.go]
  scanner.Bytes() → json.Unmarshal → model.Event
    │
    │ eventCh <- event
    ▼
[stats/stats.go] proc.Run()
  handleEvent(e):
    ├── resolver.Resolve(daddr) → "service-b"      (DockerResolver 캐시)
    ├── resolver.Resolve(saddr) → "service-a"
    ├── FlowKey{Src:"service-a", Dst:"service-b", DPort:8080}
    ├── flowStats.addRTT(1234)                      (링버퍼에 추가)
    ├── mdev = (3*mdev + |rtt-srtt|) / 4           (flow별 jitter 계산)
    └── broadcast(OutboundMsg{MsgType:"event", Event:&raw})   즉시 전송

  1초 타이머마다 (publishSnapshots):
    ├── 링버퍼 복사 → 정렬 → p50/p95/p99 계산
    ├── stableP99 갱신 (jitter 낮은 구간에서만 baseline 업데이트)
    ├── isSpike = p99 > stableP99 * spikeMultiplier
    ├── connHistory에 최대 3600포인트 보관 (1시간)
    └── broadcast(OutboundMsg{MsgType:"stats", Stats:&snap})
    │
    │ hub.Broadcast()
    ▼
[hub/hub.go] Run()
  json.Marshal(msg) → []byte → WebSocket.WriteMessage
    │
    │ WebSocket
    ▼
[프론트엔드 localhost:5173]
  msg_type === "event" → 실시간 이벤트 로그
  msg_type === "stats" → TopoGraph 엣지 색상 + DetailPanel latency 차트
  msg_type === "history" → 신규 접속 클라이언트에 1회 전송 (최근 1시간 데이터)
  msg_type === "remove" → ConnTTL 만료(30초) 시 연결 삭제 알림
```

### resource 이벤트 경로

```
[resource_agent 프로세스] stdout
  {"service_name":"service-a","cpu_pct":12.5,"mem_current_bytes":52428800,...}
    │
    │ stdout 파이프
    ▼
[resource/reader.go]
  scanner.Bytes() → json.Unmarshal → model.ResourceSnapshot
    │
    │ resCh <- snapshot
    ▼
[stats/stats.go] ForwardResource()
  broadcast(OutboundMsg{MsgType:"resource", Resource:&snap})
    │
    │ hub.Broadcast()
    ▼
[프론트엔드 localhost:5173]
  msg_type === "resource" → 노드 클릭 시 ResourceChart (CPU/IO/Mem pressure 시계열)
```

---

## 패키지 구조와 역할

```
collector/
  main.go                진입점. 배선(wiring)만. 비즈니스 로직 없음.
  model/event.go         공유 타입 (Event, StatSnapshot, ResourceSnapshot, OutboundMsg)
  agent/
    reader.go            EventProvider 인터페이스 + SubprocessProvider (tcp_trace subprocess)
  resource/
    provider.go          ResourceProvider 인터페이스
    reader.go            SubprocessProvider (resource_agent subprocess)
  hub/hub.go             WebSocket 클라이언트 관리 + broadcast (client struct + sync.Once)
  resolver/
    resolver.go          ServiceResolver 인터페이스, DockerResolver, StaticResolver
    enrich.go            EnrichResolver (rDNS로 외부 IP → 도메인명)
  stats/stats.go         RTT 링버퍼, p50/p95/p99, jitter(mdev), spike 감지, 1초 스냅샷

resource_agent/
  main.go                Docker inspect → PID → cgroup v2 경로 탐색
                         cpu.stat / memory.current / memory.events / io.stat 수집
                         1초 ticker, 누적 카운터 delta → 초당 비율 변환
                         stdout JSON 스트림

agent/
  tcp_trace.bpf.c        커널 공간: sock_ops RTT 이벤트 → Ring Buffer
  tcp_trace.c            유저 공간: Ring Buffer → JSON stdout
  tcp_trace_common.h     커널/유저 공유 이벤트 구조체 정의

frontend/
  src/
    components/
      TopoGraph           SVG 토폴로지. 노드 드래그/팬/줌. 골든앵글 자동 배치
      ConnectionListView  연결 목록. 필터(all/spiking/stressed), 정렬
      HeatmapMatrixView   서비스 간 latency 히트맵
      DetailPanel         엣지 클릭 → latency 분석 / 노드 클릭 → 리소스
      LatencyChart        Canvas 기반 시계열 그래프. DPR 적용
      ResourceChart       CPU/IO/Mem pressure 시계열
```

---

## 핵심 개념 정리

### CO-RE (Compile Once, Run Everywhere)

커널 버전마다 구조체 필드 오프셋이 다를 수 있다.
`BPF_CORE_READ()` 매크로는 런타임에 BTF 정보를 참조해서 올바른 오프셋을 자동으로 찾아준다.

```c
// CO-RE 방식 (커널 버전 무관)
__u32 srtt = BPF_CORE_READ(sk, tcp_sk.srtt_us);
```

### Ring Buffer

커널 → 유저 공간 데이터 전달 통로.
- 커널: `bpf_ringbuf_reserve()` → 데이터 채움 → `bpf_ringbuf_submit()`
- 유저: `ring_buffer__poll()` → 데이터 있으면 콜백 호출
- 버퍼가 가득 차면 이벤트 드롭 (유실 가능)

### stableP99 (Shadowing Effect 방지)

spike 중에는 baseline을 갱신하지 않는다.
jitter(mdev)가 낮은 안정 구간에서만 `stableP99`를 업데이트해서
"spike 중 threshold가 치솟아 spike를 놓치는" Shadowing Effect를 방지한다.

### EnrichResolver

DockerResolver가 모르는 IP(외부 IP)에 대해 rDNS(역방향 DNS) 조회 후
`publicsuffix` 라이브러리로 등록 도메인명을 추출한다. 결과는 캐시한다.
`IsInternal(ip)` 판단은 DockerResolver 캐시 기준으로만 하므로
rDNS로 이름이 붙은 외부 IP를 내부 서비스로 오판하지 않는다.
