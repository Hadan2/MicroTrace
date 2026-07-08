# MicroTrace — 코드맵

> 역할: **코드맵(CodeMap)**. "기능 → 파일/심볼" 매핑. AI/사람이 **코드를 수정·탐색할 때만** 본다.
> 개념·자연어 설명은 [`../guide/overview.md`](../guide/overview.md). 빌드·eBPF 로드 순서는 이 문서 부록 A.
> 줄번호는 빨리 썩으니 **파일+심볼**로 찾는다. ★=핵심, ⚠️=함정/교차영향.

---

## 1. 패키지 배치 + 필드 추가 전파 지도 ★

local 모드에서는 프로세스 3개가 stdout 파이프로 연결된다. collector가 부모, 나머지 둘은 subprocess.
EC2 모드에서는 edge collector가 subprocess 출력을 읽고 central collector로 gRPC stream 전송한다.

| 프로세스 | 언어 | 위치 | 역할 |
|---|---|---|---|
| `tcp_trace` | C/eBPF | `agent/` | sock_ops로 TCP RTT/재전송 수집 → JSON/Protobuf stdout |
| `resource_agent` | Go | `resource_agent/` | cgroup v2 자원 수집 → JSON stdout |
| `collector` | Go | `collector/` | 두 stream 집계 + spike/cause 판별 + WebSocket 서버 |
| `frontend` | React/TS | `frontend/` | WebSocket 구독 → 토폴로지·차트 |

collector 내부 패키지 (역할 단위, 인터페이스로 변경 경계 격리):
`agent/`(이벤트 공급) · `resource/`(자원 공급) · `resolver/`(IP→이름) · `stats/`(집계·spike·cause) · `hub/`(WebSocket) · `store/`(SQLite) · `model/`(공유 타입) · `main.go`(배선만).

### ⚠️ 필드 추가 시 전파 지도 (한 곳만 고치면 깨진다)
같은 데이터가 프로세스 경계마다 **별도 struct로 중복 선언**돼 있다. 필드 하나 추가 시 아래 전부를 동시에 고쳐야 한다.

| 추가하려는 필드 | 고쳐야 할 모든 곳 |
|---|---|
| **TCP 이벤트 필드** (`Event`) | ① `agent/tcp_trace_common.h` `struct event` ② `agent/tcp_trace.bpf.c` `fill_event` ③ `agent/tcp_trace.c` `output_event`(printf JSON) ④ `collector/model/event.go` `Event` |
| **자원 필드** (`ResourceSnapshot`) | ① `resource_agent/main.go` `ResourceSnapshot`+`readSnapshot` ② `collector/model/event.go` `ResourceSnapshot` ③ `frontend/src/types.ts` `ResourceMsg` ④ `frontend/src/hooks/useWebSocket.ts`(resource 분기) |
| **집계 결과 필드** (`StatSnapshot`) | ① `collector/model/event.go` `StatSnapshot` ② `collector/stats/stats.go` `publishSnapshots` ③ (영속화 시) `collector/store/store.go` `migrate`+`flush`+`QueryHistory`+`HistoryRow` ④ `frontend/src/types.ts` `StatSnapshot` ⑤ `frontend/src/hooks/useWebSocket.ts` |

> `struct event`는 필드를 크기 내림차순 배치(패딩 제거) — clang(bpf.c)과 gcc(trace.c)가 같은 레이아웃으로 읽도록. 순서 바꾸면 깨진다.

---

## 2. 전체 데이터 흐름 (의사코드)

```
[kernel] sock_ops 이벤트 → fill_event → ringbuf
  → agent/tcp_trace.c output_event/output_event_pb: JSON 또는 Protobuf stdout
  → collector/agent/reader.go SubprocessProvider: 파싱 → chan model.Event
  → stats.Processor.Run: handleEvent (즉시 RawEvent 브로드캐스트 + 링버퍼 누적)
  → 1초 ticker → publishSnapshots: percentiles + isSpike + (spike면)detectCause
       → hub.Broadcast(StatSnapshot) + store.WriteConn
  → hub.Run: 모든 WS 클라이언트로 전송
  → frontend useWebSocket: msg_type별 분기 → snapshots/history/services/events 상태
  → App.tsx → TopoGraph / DetailPanel / SpikeLog

[resource_agent] cgroup 파일 → JSON stdout
  → collector/resource/reader.go → chan model.ResourceSnapshot
  → stats.ForwardResource: p.resources[svc] 갱신 + hub.Broadcast(resource) + store.WriteResource

[EC2 edge mode]
  agent/resource_agent subprocess
  → collector/remote.Client: gRPC StreamEvents/StreamResources
  → central collector/remote.Server: chan Event/ResourceSnapshot
  → 기존 stats/hub/store 파이프라인
```

핵심 키 규약: 연결 식별 키는 **`"<src>→<dst>"`** (U+2192 화살표). backend `stats.publishSnapshots`/`sweepExpired`(`key.Src+"→"+key.Dst`), `GetHistory`, frontend `useWebSocket`(``${src}→${dst}``)가 **모두 이 문자열로 일치**해야 remove/history 매칭이 된다. ⚠️ 구분자 바꾸면 노드 제거·히스토리 머지가 깨진다.

---

## 3. latency 수집 (eBPF → collector 진입)

| 단계 | 파일 / 심볼 |
|---|---|
| sock_ops 프로그램(cgroup attach) | `agent/tcp_trace.bpf.c` `handle_sock_ops` (`SEC("sockops")`) |
| 이벤트 공통 필드 채우기 | `agent/tcp_trace.bpf.c` `fill_event` |
| ringbuf map (256KB) | `agent/tcp_trace.bpf.c` `events` |
| 로더: load→attach→poll | `agent/tcp_trace.c` `main` (cgroup=`/sys/fs/cgroup`, `BPF_CGROUP_SOCK_OPS`) |
| ringbuf→JSON stdout | `agent/tcp_trace.c` `output_event`, `handle_event` |
| subprocess 실행→`chan Event` | `collector/agent/reader.go` `SubprocessProvider.Start` (버퍼 1024) |
| 인터페이스 경계 | `collector/agent/reader.go` `EventProvider` |

3가지 이벤트(`skops->op`): `BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB`→connect, `BPF_SOCK_OPS_RTT_CB`→rtt, `BPF_SOCK_OPS_RETRANS_CB`→retransmit.
- ★ **RTT_CB는 ESTABLISHED 시점에 `bpf_sock_ops_cb_flags_set(... | BPF_SOCK_OPS_RTT_CB_FLAG)`로 켜야** Keep-Alive 연결의 요청 단위 RTT가 들어온다. 안 켜면 첫 연결 RTT만 잡힘.
- ⚠️ **sock_ops 제약**: `pid`/`comm` 헬퍼 사용 불가. `e->pid`엔 실제로 `skops->local_port`가 들어간다. `e->saddr`=`local_ip4`(이 소켓의 컨테이너 IP). `comm`은 항상 빈 문자열.
- RTT 단위: 커널 `srtt_us`는 ×8 고정소수점 → `>> 3`으로 실 마이크로초. IPv4만 처리(`family != 2` 무시).
- ⚠️ 종료 시 `bpf_prog_detach` 필수. 안 하면 cgroup에 hook 잔류 → 다음 실행 attach 에러.

---

## 4. 집계 · spike · jitter (stats 코어)

중심: `collector/stats/stats.go` `Processor`. 상태 맵 3개(`conns map[ConnKey]*connStats`, `flows map[FlowKey]*flowState`, `resources map[string]*ResourceSnapshot`), 단일 `sync.Mutex`.

| 기능 | 심볼 |
|---|---|
| 이벤트 루프(1s ticker + 10s sweeper) | `Processor.Run` |
| 이벤트 1건 처리(즉시 RawEvent 송출 + 누적) | `Processor.handleEvent` |
| 1초 스냅샷 발행 | `Processor.publishSnapshots` |
| TTL 만료 연결 제거 + remove 송출 | `Processor.sweepExpired` |
| RTT 링버퍼(고정 1000) | `connStats.addRTT` / `percentiles` / `percentileIdx` |
| flow별 mdev(jitter) EWMA | `Processor.updateFlowMdev` |
| 안정 기준선 | `connStats.updateStableP99` / `isSpike` |

상수: `rttRingSize=1000`, `spikeMultiplier=3`, `snapshotInterval=1s`, `connTTL=30s`, `ttlSweepInterval=10s`, `maxHistory=3600`.

- **키 두 종류**: `ConnKey{Src,Dst}`=서비스 간 집계 단위. `FlowKey{SockID(=local_port),SAddr,DAddr,DPort}`=소켓별 mdev 계산 단위. ⚠️ 섞으면 안 됨(mdev는 소켓 상태).
- ★ **jitter 출처 함정**: eBPF가 `Event.JitterUs`를 계산해 보내지만 **stats는 이걸 안 쓴다.** `handleEvent`가 `e.LatencyUs`로 `updateFlowMdev`를 돌려 **Go에서 mdev를 재계산**(`mdev=(3*mdev+err)/4`, `srtt=(7*srtt+rtt)/8`)하고 그 값을 jitter로 쓴다. eBPF의 `jitter_us` 필드는 현재 **데드 데이터**(파이프라인 미사용).
- ★ **stableP99 (Shadowing Effect 방지)**: `updateStableP99`는 `jitter <= p50/2`(안정 구간)일 때만 `stableP99=p99` 갱신. spike 진행 중엔 기준선이 안 올라간다. `isSpike`: `latestUs > stableP99 × 3`. `latestUs`=링버퍼 최신값(`(head-1)`).
- ⚠️ `percentiles`는 링버퍼를 **복사 후 정렬**(원본 정렬 시 순서 깨짐). 샘플 0이면 전부 0.
- ⚠️ **lock 규약**: `publishSnapshots`는 스냅샷 계산+히스토리 append를 **한 lock 안**에서 한다(이전엔 unlock 사이 `sweepExpired`가 connStats를 삭제하는 race가 있었음). `broadcast`/`store`는 lock 밖에서 호출(느린 hub가 집계를 막지 않게).

---

## 5. cause_kind 자동 판별

`collector/stats/stats.go` `detectCause(dstType, *ResourceSnapshot) (kind, signal)`. **spike일 때만** `publishSnapshots`에서 호출(`p.resources[key.Dst]` 조회).

우선순위(신호 품질 순):
1. `dstType=="external"` → `("external","external_dst")`
2. `res==nil` → `("network","none")`
3. `OOMKillCount>0` → `("memory","oom_kill")`
4. `CPUThrottlePct>25` → `("cpu","cpu_throttle_high")`
5. `CPUThrottlePct>1 && CPUPct>60` → `("cpu","cpu_throttle_burst")`
6. `MemPressurePct>20` → `("memory","mem_pressure")`
7. else → `("network","none")`

- ⚠️ **`io_wait`는 cause 판별에 안 쓴다** (호스트 전체 기준이라 컨테이너 원인으로 부적합). 그래서 **`kind`로 `"io"`는 절대 안 나온다** — 가능한 값은 `cpu|memory|network|external` 4개뿐. (프론트 타입 불일치는 §11 참조)
- spike 시 `DstCPUPct/DstCPUThrottlePct/DstMemPressurePct/DstIOWaitPct`를 스냅샷에 함께 실어 프론트 Evidence Chip에 쓴다.

---

## 6. resource 수집 (cgroup v2)

| 단계 | 파일 / 심볼 |
|---|---|
| 컨테이너 순회 + delta 계산 | `resource_agent/main.go` `collect` / `readSnapshot` |
| cgroup 경로 동적 탐색 | `resolveCgroupPath` (`/proc/<pid>/cgroup`의 `0::` 라인) |
| 파서 | `readCPUStat`(cpu.stat) `readMemoryEvents`(memory.events) `readIOStat`(io.stat) `readUint64File`(memory.current/max) `readIOWaitPct`(/proc/stat) `readPSIMemory`(memory.pressure) |
| 점수화 | `memPressureScore`(high 이벤트→0~100), `clamp100`, `safeDeltaU64` |
| subprocess→`chan ResourceSnapshot` | `collector/resource/reader.go` `SubprocessProvider.Start` (버퍼 64) |
| 인터페이스 경계 | `collector/resource/provider.go` `ResourceProvider` |
| collector 수신 | `collector/stats/stats.go` `Processor.ForwardResource` |
| EC2 서비스명 override | `resource_agent/main.go` `MICROTRACE_SERVICE_NAME` |

- ★ **첫 tick은 출력 안 함**: 누적 카운터(usage_usec 등)는 delta가 필요. `containerState.hasPrev=false`면 기준값만 저장하고 `nil` 반환.
- `cpu_pct`=delta usage/interval, `cpu_throttle_pct`=delta throttled/interval. `safeDeltaU64`로 카운터 리셋 시 음수 방지.
- 주기: `COLLECT_INTERVAL_MS` 환경변수(기본 1000ms). `mem_pressure_pct`는 high 이벤트 delta의 로그 스케일 점수.
- ⚠️ `ForwardResource`가 `p.resources[svc]`를 갱신 → §5 cause 판별이 이걸 읽는다. **이름 키 일치 필수**: resource_agent의 `service_name`과 resolver가 만든 `ConnKey.Dst`가 같아야 dst 자원이 매칭된다. 로컬 Docker는 컨테이너명으로 일치하고, EC2 edge는 `MICROTRACE_SERVICE_NAME`을 hosts.yaml 서비스명과 맞춘다.

---

## 7. resolver (IP → 서비스 이름)

`collector/resolver/`. 인터페이스 `ServiceResolver{ Resolve(ip)string; IsInternal(ip)bool }`.

| 구현체 | 심볼 | 용도 |
|---|---|---|
| Docker | `resolver.go` `DockerResolver` | IP→컨테이너명. 시작 시 `refreshAll`, 이후 `watchEvents`(start/die)로 캐시 갱신 |
| Enrich | `enrich.go` `EnrichResolver` | base resolver 미스 IP를 rDNS(`lookupAndParse`, eTLD+1)로 보완. 결과 캐시 |
| Static | `resolver.go` `StaticResolver` + `static.go` `LoadStaticTable` | YAML 설정 파일/맵 기반(EC2/테스트). Docker 없는 환경 또는 명시 static 모드 |

- 선택: `main.go` `buildResolver`가 `MICROTRACE_RESOLVER=auto|docker|static`과 `MICROTRACE_HOSTS_FILE`로 선택. `auto`에서 hosts 파일이 있으면 static, 없으면 Docker. Docker 성공→`NewEnrichResolver(docker)`, Docker 실패(auto)→`NewStaticResolver(nil)`, static→`LoadStaticTable`→`NewEnrichResolver(static)`.
- static 설정 파일 예시는 `collector/hosts.example.yaml`. 지원 형식: `hosts: {IP: service}` 또는 `services: {service: [IP...]}`.
- 실행 편의: 로컬 Docker는 `make dev`, static 모드는 `make dev-static HOSTS=collector/hosts.example.yaml` 또는 `make dev HOSTS=...`. Makefile은 `HOSTS`를 절대경로로 넘기며, `main.go`는 collector cwd와 repo root 기준 상대경로를 모두 허용한다.
- ⚠️ `IsInternal`은 **base resolver 기준**(Docker 캐시 또는 StaticResolver 설정 파일, rDNS 변환과 무관). external/internal 오판 방지용 — `stats.nodeType`이 이걸로 `dstType` 결정 → §5 cause의 `external` 분기에 직접 영향.
- `Resolve`는 미스 시 **IP 문자열 그대로 반환**(에러 안 냄 — 이벤트 처리를 막지 않으려고).

---

## 8. SQLite 영속성 + history API

`collector/store/store.go` `Store`. 실시간 경로와 분리(`WriteConn`/`WriteResource`는 버퍼에 넣고 즉시 반환).

| 기능 | 심볼 |
|---|---|
| 초기화(WAL+migrate) | `New` / `migrate` (테이블 `conn_stats`, `resource_stats`) |
| 배치 flush(60s) + TTL(1h, 7일 보존) | `Run` / `flush` / `deleteExpired` |
| 과거 조회 | `QueryHistory(src,dst,from)` → `[]HistoryRow` |
| HTTP 핸들러 | `collector/main.go` `makeHistoryHandler` (`GET /api/history?src=&dst=&range=1h|6h|24h|7d`) |

- stats는 store를 직접 import 안 함 — `StoreFn{Conn,Resource}` 함수 포인터만 받음(`main.go`에서 주입). ⚠️ DB 초기화 실패해도 `storeFn`이 nil이라 저장만 비활성, 나머지는 정상.
- 실시간 history(WebSocket)와 과거 history(`/api/history`)는 **다른 경로**: 전자는 `stats.GetHistory`(메모리 `connStats.history`, 최대 3600), 후자는 SQLite.
- `range`(1h/6h/24h/7d/**all**)는 `makeHistoryHandler`가 `from` 하한을 정한다(`QueryHistory`의 `ts >= from`). `all`이면 `from`을 제로값(먼 과거)으로 둬 보관된 전체를 반환. 나머지는 `rangeMap`으로 `from=now-dur`. **상한·개수 제한 없음** — 데이터가 적으면 여러 range가 같은 결과(정상).
- **실측(2026-07-06)**: `all`로 약 50일치를 조회·렌더해도 버벅임 없었음 → 다운샘플링은 당장 불필요. 데이터가 훨씬 커지면 그때 분 단위 집계 등 도입 검토.
- 프론트 x축 라벨은 보이는 범위(span)에 따라 적응(`chartShared.timeAxisValues`): ≥2일이면 날짜(M/D) 위주, 미만이면 시:분 위주. 최소 줌 폭은 절대 10초(`MIN_ZOOM_SEC`)라 넓게 봐도 초 단위까지 확대 가능.

---

## 9. hub (WebSocket)

`collector/hub/hub.go` `Hub`.

| 기능 | 심볼 |
|---|---|
| 직렬화+큐잉(non-blocking) | `Broadcast` (버퍼 512, 가득 차면 **드롭**) |
| 단일 writer 루프 | `Run` (★ gorilla/websocket은 동시 WriteMessage 불가 → `h.mu` 락 보유 중에만 write) |
| 업그레이드+등록+히스토리 전송 | `ServeWs` (`SetHistoryFn`으로 받은 `GetHistory` 호출, **`h.mu` 락 안에서** WriteMessage — `Run`과 동일 락으로 직렬화) |
| 끊김 감지 | `ServeWs` 내부 ReadMessage goroutine → `client.close`(`sync.Once`) |

- ⚠️ `Broadcast`는 버퍼 풀이면 메시지를 **버린다**(느린 클라이언트가 collector를 막지 않게). 고로 WS는 best-effort, 영속 보장은 SQLite가 담당.

---

## 10. frontend (WebSocket → 상태 → 컴포넌트)

진입: `frontend/src/App.tsx`. 데이터: `hooks/useWebSocket.ts` `useWebSocket(url)` → `{snapshots, services, history, events, connected}`.

| msg_type | useWebSocket 처리 | 상태 |
|---|---|---|
| `stats` | 키 `src→dst`로 저장 + history point append(3600) + **is_spike false→true면 SpikeEvent 생성** | `snapshots`, `history`, `events` |
| `history` | 신규 연결 시 초기 시계열 | `history` |
| `resource` | 서비스별 상태 + 5분 history(300) | `services` |
| `remove` | 해당 키 snapshots/history 삭제 | — |

UI 컴포넌트(전부 `frontend/src/components/`, props는 `App.tsx` 참조):

| 컴포넌트 | 역할 |
|---|---|
| `TopBar` / `GlobalMetrics` | 상단 연결 상태·전역 지표 |
| `ViewSwitcher` | graph/list/matrix 토글 (`App.tsx` `viewMode`) |
| `TopoGraph` | 토폴로지 그래프(노드=서비스, 엣지=연결). 레이아웃 상수 `constants/topology.ts` `NODE_POS` |
| `ConnectionListView` / `HeatmapMatrixView` | 리스트·히트맵 뷰 |
| `DetailPanel` | 선택 엣지/노드 상세 + `LatencyChart` + `ResourceChart` |
| `LatencyChart` | p50/p95/p99 시계열 (uPlot). 줌/팬·축은 `chartShared.ts` 공유. Live: 줌 중이면 스케일 유지, 완전 줌아웃 시 자동 추적 재개 |
| `ResourceChart` | CPU/IO/Mem pressure 시계열 (uPlot, y축 0~100% 고정 + 70% 위험 점선). LatencyChart와 **동일 룩앤필** — `chartShared.ts` 공유 |
| `chartShared.ts` | ★두 차트 공유 uPlot 로직: `panZoomPlugin`(경계를 `dataBounds`로 매번 data에서 읽어 range 전환에도 안 어긋남), `PanZoomState`, `applyData`(줌 유지 setData), `timeAxisValues`/`axisBase`(공통 축) |
| `SpikeLog` | spike 이벤트 로그. cause 메타 `constants/causes.ts` `CAUSE_META` |

- mock 모드: `VITE_MOCK=true`면 `useMockData`로 대체(`App.tsx`). mock 서비스명(api-gateway 등)은 `constants/topology.ts`에 있음.

---

## 11. ⚠️ 함정 · 교차영향 · 동기화 깨진 곳 모음

> 작성 시점(2026-06-19) 코드 기준. 고치면 이 줄도 갱신할 것.

1. **eBPF `jitter_us` 데드 데이터** (§4): 커널이 계산·전송하지만 collector가 무시(Go가 mdev 재계산). 커널 jitter를 쓰려면 `handleEvent`를 바꿔야 함.
2. **프론트 `CauseKind`에 백엔드가 안 보내는 `'io'` 존재**: `frontend/src/types.ts` `CauseKind = 'network'|'cpu'|'io'|'memory'|'external'` + `constants/causes.ts` `CAUSE_META.io`. 그러나 backend `detectCause`는 `'io'`를 **절대 반환 안 함**(§5). io UI는 dead path.
3. **백엔드가 보내는데 프론트 타입에 없는 필드**: `StatSnapshot.CauseSignal`, `DstCPUThrottlePct`를 backend는 전송하나 `frontend/src/types.ts` `StatSnapshot`엔 없음(`cause_kind`/`dst_cpu_pct`/`dst_io_wait_pct`/`dst_mem_pressure_pct`만 있음). 프론트에서 쓰려면 타입 추가 필요.
4. **`NODE_POS`는 mock 이름 전용**: `constants/topology.ts`의 노드 좌표 키(`api-gateway` 등)는 mockup용. 실제 testenv 컨테이너명(`testenv-service-a-1` 등)과 안 맞음 → 실데이터 토폴로지 레이아웃은 별도 처리 필요.
5. **키 문자열 `"src→dst"` 의존** (§2): backend 3곳 + frontend가 U+2192로 일치해야 함.
6. **이름 키 일치**(§6): resource_agent `service_name` = resolver `ConnKey.Dst` 여야 cause가 dst 자원을 찾는다. EC2(StaticResolver)로 가면 `MICROTRACE_SERVICE_NAME`과 hosts.yaml 서비스명을 일관되게 둬야 함.

---

## 12. 확장 지점 (인터페이스로 격리됨)

| 변경 | 건드리는 곳 | 안 건드리는 곳 |
|---|---|---|
| gRPC 전환(EC2 멀티호스트) | `collector/remote` + `main.go` `MICROTRACE_MODE=edge|central` | stats, hub, store |
| EC2 IP 매핑 | `main.go`에서 `StaticResolver(table)` 선택 | resolver 인터페이스, stats |
| k8s 지원 | `resolver/`에 `K8sResolver` 추가 + `main.go` 선택 | stats, hub |
| spike 민감도 | `stats/stats.go` `spikeMultiplier` | 나머지 전부 |
| cause 규칙 | `stats/stats.go` `detectCause` | 나머지 전부 |

상세 계획은 `docs/agents/output/plan/<timestamp>/`에 PRD/SPEC/PLAN으로 남긴다(워크플로우 도입 예정). 진행 현황은 [`../analysis/progress.md`](../analysis/progress.md).

---

## 13. 코드 → 문서 역방향 매핑 (문서화 시 이 표를 본다)

> 코드를 고친 뒤 **어떤 문서를 갱신해야 하는가**. (정방향 "상황→읽을 문서"는 `.claude/CLAUDE.md`.)
> 규칙: 코드 변경이 **동작/구조/규약을 바꿨으면** 갱신, 오타·리네임·포맷팅만이면 생략 가능.
> 연관 엣지/소유권/식별키를 건드렸으면 [`microtrace.edges.md`](microtrace.edges.md)도 함께 갱신한다.
> 절차는 `/update-docs` 스킬(`.claude/skills/update-docs/SKILL.md`).

| 수정한 코드(경로/심볼) | 갱신할 문서 |
|---|---|
| `agent/*`(eBPF 이벤트/수집) | 이 파일 §3 + (필드면) §1 + `edges.md` A·B |
| `collector/stats/stats.go`(집계·spike·cause) | 이 파일 §4·§5 + `edges.md` A·C + (개념) `learning/infra/cause_detection.md` |
| `collector/resource/*`, `resource_agent/*` | 이 파일 §6 + (필드면) §1 + `edges.md` C(이름 키) |
| `collector/remote/*`, `collector/model/pb/telemetry.proto` | 이 파일 §2·§12 + `edges.md` B/C(이름 키) |
| `collector/resolver/*` | 이 파일 §7 + `edges.md` B(IsInternal→cause) |
| `collector/store/*`, `main.go` history 핸들러 | 이 파일 §8 |
| `collector/hub/*` | 이 파일 §9 |
| `frontend/*` | 이 파일 §10 + (타입 불일치면) §11 / `edges.md` C |
| 공유 타입 필드 추가(`model/event.go` 등) | 이 파일 §1 필드 전파 지도 + `edges.md` B |
| 함정/교차영향 새로 발견 | 이 파일 §11 + `edges.md` C |
| 인터페이스 확장 지점 변경 | 이 파일 §12 + `coding-rules.md` |
| 진행 단계(Phase·기능 완료) | `../analysis/progress.md` |

> 표에 대응 행이 없는 **신규 기능**이면: `guide/`에 개념 문서 신설 + 이 파일에 새 §추가 +
> 이 표에 행 추가 + `.claude/CLAUDE.md` 정방향 표에도 행 추가.

---

## 부록 A. 빌드 · eBPF 로드 순서

평소엔 `make dev` 한 번으로 빌드+실행된다(상세는 `scripts/dev.sh`). 수동 빌드 순서:

```bash
clang -target bpf -O2 -c agent/tcp_trace.bpf.c -o agent/tcp_trace.bpf.o   # 1. eBPF 바이트코드
bpftool gen skeleton agent/tcp_trace.bpf.o > agent/tcp_trace.skel.h        # 2. skeleton 헤더 생성
gcc agent/tcp_trace.c -o agent/tcp_trace -lbpf                            # 3. 유저 공간 로더
cd resource_agent && go build -o resource_agent .                          # 4. 리소스 에이전트
cd collector && go build -o collector .                                    # 5. collector
```

- **skeleton(`tcp_trace.skel.h`)**: `bpftool gen skeleton`이 `.bpf.o` 바이트코드를 배열로 박고 래퍼 함수를 생성 → 유저 공간이 `bpf()` syscall을 직접 안 쓴다. 자동 생성물이라 커밋 제외 대상(현재는 추적 중).
- `make dev`/`scripts/dev.sh`는 collector attach 뒤 testenv를 `up --build --force-recreate`로 띄운다. 기존 service-a Keep-Alive 소켓이 재사용되면 sock_ops RTT callback 설정 시점을 놓쳐 service-a→service-b edge가 안 보일 수 있기 때문이다.

### eBPF 로드 라이프사이클 (`agent/tcp_trace.c` `main` 내부)
| 단계 | 호출 | 공간 | 하는 일 |
|---|---|---|---|
| 1 | `tcp_trace_bpf__open` | user | 바이트코드 메모리 파싱 |
| 2 | `tcp_trace_bpf__load` | kernel | Verifier 검증 + Map/프로그램 등록 |
| 3 | `bpf_prog_attach(..., BPF_CGROUP_SOCK_OPS)` | kernel | `/sys/fs/cgroup`에 sock_ops 훅 연결 (★수동 attach — skeleton 자동 attach는 kprobe/tracepoint만) |
| 4 | `ring_buffer__new` | user | ringbuf 폴러 준비 |
| 5 | `ring_buffer__poll`(100ms 루프) | user | 이벤트 감시 → `output_event` JSON stdout |
| 6 | `bpf_prog_detach` + `__destroy` | kernel+user | ⚠️ 훅 해제 필수(안 하면 cgroup 잔류) |
