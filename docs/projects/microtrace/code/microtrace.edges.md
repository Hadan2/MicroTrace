# MicroTrace — 연관 엣지 & 데이터 소유권 (Edges & Ownership)

> 역할: **엣지맵(EdgeMap)**. 코드맵(`microtrace.code.md`)이 "기능 = 무엇인가(노드)"를 적는다면,
> 여기는 **"기능들이 어떻게 엮이고(엣지), 무엇이 외부 소유라 손대면 안 되는가(경계)"**를 적는다.
> **코드 수정 전에 이 문서의 해당 행을 먼저 확인**한다(연쇄 충돌·금지 영역 사전 차단).
> 근거는 모두 실제 코드. 줄번호 대신 파일+심볼로 표기. ★=핵심.
>
> ── 이 문서가 워크플로우의 핵심이다. AI가 매번 재탐색하던 "연관/경계"를 1회 적어두면 재설명이 사라진다. ──
> 작성 기준: `microtrace.code.md` §1·§5·§6·§7·§11 (2026-06-19 코드). 새 연관을 발견하면 한 행씩 추가한다.

---

## A. 데이터 소유권 표 — "이건 외부 소유, 수정 금지" ★최우선 확인★

> **판단 규칙**: 외부(커널 sock_ops / cgroup v2 / Docker API / rDNS)가 만든 값은 **불변 진실**이다.
> 버그가 나도 그 원시값을 고쳐 증상을 덮지 말고, 우리 코드의 **해석/파생값**을 의심한다.

| 데이터 | 소유자 | 가변성 | 코드 근거 | 규칙 |
|---|---|---|---|---|
| TCP RTT (`srtt_us`) | 커널 sock_ops | read-only | `agent/tcp_trace.bpf.c` `fill_event` | 커널이 ×8 고정소수점으로 준 값. `>>3`으로 해석만. 원시값 수정 금지 |
| `e->pid`/`e->saddr`/`comm` | 커널 sock_ops | read-only | `agent/tcp_trace.bpf.c` | ⚠️ sock_ops 제약: `pid`엔 실제로 `local_port`가 들어감, `comm`은 항상 빈 문자열. 이름과 내용이 다르다 — 해석 시 주의 |
| cgroup 카운터 (usage_usec, throttled, memory.events…) | cgroup v2 | read-only | `resource_agent/main.go` `readSnapshot` | 누적 카운터. 첫 tick은 delta 불가라 출력 안 함(`hasPrev=false`). delta는 우리 파생 |
| 컨테이너 IP→이름 매핑 | Docker API | read-only(캐시) | `collector/resolver/resolver.go` `DockerResolver` | Docker가 준 진실. `watchEvents`로 갱신만. 임의 수정 금지 |
| eBPF `jitter_us` 필드 | 커널이 계산해 전송 | **데드 데이터** | `agent/tcp_trace.c` → `model/event.go` | ★ collector가 **안 씀**. Go가 mdev 재계산. "값이 이상하다"고 여길 고치지 말 것 — 애초에 파이프라인 미사용 |
| RTT 링버퍼 percentiles(p50/p95/p99) | 우리 코드 | 가변(파생) | `collector/stats/stats.go` `percentiles` | 버그 시 여기를 의심. 원시 RTT가 아니라 우리 계산 |
| `cause_kind`/`signal` | 우리 코드 | 가변(파생) | `collector/stats/stats.go` `detectCause` | 판별 규칙은 우리 것. 규칙 바꾸면 여기만 |
| Go mdev(jitter) | 우리 코드 | 가변(파생) | `collector/stats/stats.go` `updateFlowMdev` | `mdev=(3*mdev+err)/4`. 커널 jitter 아님(위 데드 데이터 참조) |

---

## B. 연관 엣지 표 — "X를 건드리면 Y를 봐라"

> "직접 호출"뿐 아니라 **같은 식별키/필드/포맷을 공유해 의미론적으로 결합된 엣지**까지 적는다
> (컴파일러가 안 잡아주는 것이 핵심).

| 건드리는 기능 | 같이 봐야 할 기능 | 엣지 종류 | 왜 (코드 근거) |
|---|---|---|---|
| **TCP 이벤트 필드 추가** (`Event`) | ①`tcp_trace_common.h` `struct event` ②`tcp_trace.bpf.c` `fill_event` ③`tcp_trace.c` `output_event`(JSON) ④`model/event.go` `Event` | 필드 전파(중복 struct) | 프로세스 경계마다 별도 struct. 한 곳만 고치면 파싱 깨짐 (code §1) |
| **자원 필드 추가** (`ResourceSnapshot`) | ①`resource_agent/main.go` ②`model/event.go` ③`frontend/src/types.ts` `ResourceMsg` ④`useWebSocket.ts` resource 분기 | 필드 전파 | 위와 동일 구조 (code §1) |
| **집계 결과 필드 추가** (`StatSnapshot`) | ①`model/event.go` ②`stats.go` `publishSnapshots` ③(영속화 시)`store.go` migrate/flush/QueryHistory ④`types.ts` ⑤`useWebSocket.ts` | 필드 전파 | 위와 동일 (code §1) |
| **연결 식별 키 `"src→dst"`** | backend `stats.publishSnapshots`/`sweepExpired`/`GetHistory` + frontend `useWebSocket` | 포맷 공유(U+2192) | 4곳이 같은 문자열이라야 remove/history 매칭 (code §2) |
| **`detectCause` 판별 규칙** | `resource_agent` 컨테이너명 = resolver `ConnKey.Dst` | 이름 키 일치 | dst 자원을 찾으려면 양쪽 이름이 같아야 함. EC2(StaticResolver)면 매핑표를 양쪽 일관되게 (code §6) |
| **`resolver.IsInternal`** | `stats.nodeType` → `detectCause`의 `external` 분기 | 데이터 공급 | internal/external 오판이 cause를 바꾼다 (code §7) |
| **spike 판정 `isSpike`/`updateStableP99`** | frontend `is_spike false→true` → SpikeEvent 생성 | 이벤트 결합 | 백엔드 spike 플래그가 프론트 이벤트 로그를 만든다 (code §4·§10) |
| **`Broadcast` 큐(512)** | SQLite `store` | 신뢰성 분담 | WS는 버퍼 풀이면 **드롭**(best-effort), 영속 보장은 store가 담당 (code §9) |

---

## C. 의미론적 충돌 주의 지점 (빌드는 통과하지만 깨지는 곳) ★수정 시 반대편 확인★

> 컴파일러가 **안 잡아주는** 결합. 타입이 안 바뀌어도 의미가 깨진다.

1. **`"src→dst"` 키 구분자(U+2192)** — 포맷을 바꾸면 backend/frontend 조회가 조용히 빗나가 노드 제거·히스토리 머지가 깨진다.
2. **`struct event` 필드 순서** — 크기 내림차순 배치라야 clang(bpf.c)·gcc(trace.c)가 같은 레이아웃으로 읽는다. 순서만 바꿔도 파싱이 깨진다.
3. **RTT 단위 해석** — 커널 `srtt_us`는 ×8 고정소수점. `>>3`을 빠뜨리면 값이 8배로 나오지만 컴파일은 통과.
4. **`ConnKey` vs `FlowKey`** — 전자는 서비스 간 집계 단위, 후자는 소켓별 mdev 단위. 섞으면 jitter가 엉킨다(mdev는 소켓 상태).
5. **이름 키 일치**(§6) — resource_agent 컨테이너명 ≠ resolver `ConnKey.Dst`면 cause가 dst 자원을 못 찾는다. 로컬 Docker는 일치, EC2는 수동 정합 필요.
6. **프론트 `CauseKind`에 dead `'io'`** — `types.ts`/`CAUSE_META`에 `'io'`가 있으나 `detectCause`는 절대 반환 안 함. io UI는 dead path.
7. **백엔드가 보내는데 프론트 타입에 없는 필드** — `CauseSignal`, `DstCPUThrottlePct`는 backend가 전송하나 `types.ts` `StatSnapshot`엔 없음. 프론트에서 쓰려면 타입 추가 필요.
8. **`NODE_POS`는 mock 이름 전용** — `constants/topology.ts` 좌표 키(`api-gateway` 등)는 mockup용. 실제 testenv 컨테이너명(`testenv-service-a-1`)과 안 맞음.

---

## D. 버그 점검 시 체크 순서

1. **데이터가 외부 소유(raw)인가 우리 파생인가** — A표 확인. 외부 소유면 커널/cgroup/Docker가 진실, 우리 해석(percentile·mdev·cause)을 의심.
2. **식별/매칭이 맞나** — 엉뚱한 대상에 값이 가면 `"src→dst"` 키 산출·이름 키 일치(§6)를 의심.
3. **코드로 범인이 안 잡히면** — 단정하지 말고 **로그를 먼저 심어** 실제 값을 찍고 사용자에게 요청. (특히 eBPF/컨테이너 경계는 로그 없이 못 본다)
4. **결합 경로 추적** — B표로 해당 데이터가 지나는 기능들을 따라가며 좁힌다.
