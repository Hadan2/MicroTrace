# MicroTrace 프로젝트 가이드

> AI가 이 프로젝트에서 작업할 때 따라야 할 모든 규칙이 여기에 있다. 이 파일이 원본이다.
> 루트 `CLAUDE.md`는 `@docs/ai/CLAUDE.md`로 이 파일을 import하고(Claude 자동 로딩용),
> 루트 `AGENTS.md`는 이 파일을 가리키는 심볼릭 링크다.
> **다른 두 파일을 따로 수정하지 말 것. 항상 이 파일만 수정한다.**

---

## 사용자 배경

- Linux 처음 사용. 기본 명령어(ls, cd, mkdir 등)도 모를 수 있음
- 명령어 실행 시 역할과 옵션 의미를 항상 함께 설명할 것
- 처음 보는 개념은 비유나 그림(ASCII)으로 자세히 설명할 것. 한줄 요약 금지
- 개념 설명 시 ① 이게 뭔지 ② 왜 필요한지 ③ 어떻게 동작하는지 순서로 설명
- 한글로 설명할 것

---

## 프로젝트 개요

MicroTrace는 latency spike가 왜 났는지 — 네트워크인지, CPU throttle인지, 메모리인지 — 가장 빠르게 좁혀주는 eBPF 기반 root-cause 진단 도구다.
주인공은 latency다. 서버 리소스(CPU throttle, OOM, memory pressure)는 cause 판별을 위한 증거로만 수집한다. Datadog식 전수 수집이 아니다.

AI용 축약 개요: `docs/projects/microtrace/guide/overview.md` (NetSim: `docs/projects/netsim/guide/overview.md`)
사람용 기획서 전문: `docs/projects/microtrace/reference/microtrace.md`, `docs/projects/netsim/reference/{netsim,integration}.md`

---

## 작업 워크플로우 (★ 매 작업 이 순서를 따른다)

기능 추가·수정·리팩토링 검토 요청을 받으면 **문서를 따라 필요한 코드만** 읽는다. 전체 코드를 통독하지 않는다.

```
1. 진입   guide/overview.md          프로젝트 전체 파악 (라우터)
2. 조준   code/microtrace.code.md     해당 기능 §섹션 → 파일/심볼 확인
            └ §11 함정·교차영향 + §1 필드 전파 지도를 반드시 확인
3. 진입   실제 코드                   코드맵이 가리킨 파일/심볼만 (전체 X)
4. 막히면  learning/<분야>/ (개념) · reference/microtrace.md (배경·근거)
```

**작업 중/후 문서 갱신 규칙 (안 썩게 하는 핵심):**

| 무엇이 바뀌면 | 갱신할 문서 |
|---|---|
| 코드 구조/심볼/교차영향 | `code/microtrace.code.md` |
| 진행 단계(Phase·기능 완료) | `analysis/progress.md` (현황 단일 출처) |
| "지금 하는 작업" 전환 | `ai/todo.md` |
| 새 개념 학습 | `learning/<분야>/` |
| 에러 트러블슈팅 | `reports/yyyy-mm-dd.md` |
| 설계 방향/포지션 변경 | `guide/overview.md` (+ 필요 시 reference) |

> 문서 역할: **guide=AI 축약 자연어 / code=코드맵(파일·심볼) / reference=사람용 전문 / learning=개념 / analysis=진행 / reports=트러블슈팅.** 전체 지도는 `docs/README.md`.

---

## 기술 스택

| 계층 | 기술 |
|---|---|
| 커널 에이전트 | C, eBPF (libbpf, sock_ops), `agent/tcp_trace` |
| 리소스 에이전트 | Go, cgroup v2, `resource_agent/` |
| 백엔드 | Go (goroutine, channel, WebSocket), `collector/` |
| 프론트엔드 | React Web (TypeScript, Vite), `frontend/` |
| 환경 | Linux Ubuntu 22.04+ / eBPF 활성화된 WSL2 커널 |

프론트엔드는 Wails(데스크톱 앱)가 아니라 브라우저 웹 UI다. EC2/K8s 환경에서 URL 하나로 팀원이 공유할 수 있어야 한다.

---

## 개발 실행 — `make dev`

가장 자주 쓰는 명령어다. 테스트 컨테이너 + collector + React 개발 서버를 한 번에 올린다.

```bash
make dev
```

### make dev 내부 실행 순서 (`scripts/dev.sh`)

```
1. 사전 검사
   - docker, go, npm, docker compose 설치 여부 확인
   - WSL2 IP 주소 감지 (hostname -I)
   - collector는 eBPF attach에 root 권한 필요 → sudo -v 로 미리 인증

2. resource_agent 빌드
   - cd resource_agent && go build -o resource_agent .
   - 빌드 실패해도 경고만 내고 계속 진행 (자원 수집 없이도 latency 추적 가능)
   - SKIP_RESOURCE=1 환경변수로 건너뛸 수 있음

3. collector 시작 (백그라운드)
   - cd collector && sudo -n -E go run .
   - eBPF sock_ops 프로그램을 루트 cgroup에 attach
   - Docker API로 컨테이너 IP → 이름 매핑 캐시 초기화
   - resource_agent를 subprocess로 실행
   - :9090 에서 WebSocket 서버 대기

4. 2초 대기
   - eBPF attach가 완료된 후 testenv가 연결을 맺어야 sock_ops가 해당 소켓을 추적할 수 있음
   - 순서가 뒤집히면 기존 Keep-Alive 연결은 추적 불가

5. testenv 시작 (백그라운드)
   - docker compose -f testenv/docker-compose.yml up --build
   - service_a, service_b 컨테이너 실행
   - service_a가 service_b로 주기적으로 HTTP 요청 전송

6. 3초 대기
   - Docker Compose가 컨테이너를 올리고 트래픽이 흐를 시간

7. frontend 시작 (백그라운드)
   - cd frontend && npm run dev -- --host 0.0.0.0 --port 5173
   - VITE_MOCK=1 이면 VITE_MOCK=true 환경변수를 함께 설정 (mock 데이터 모드)

8. 종료 (Ctrl+C)
   - 모든 백그라운드 프로세스 kill
   - KEEP_CONTAINERS=1 이 아니면 docker compose down 실행
```

### 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `KEEP_CONTAINERS` | `0` | `1`로 설정하면 종료 시 컨테이너를 내리지 않음 |
| `SKIP_COLLECTOR` | `0` | `1`로 설정하면 collector를 시작하지 않음 |
| `SKIP_RESOURCE` | `0` | `1`로 설정하면 resource_agent 빌드를 건너뜀 |
| `VITE_MOCK` | `0` | `1`로 설정하면 프론트엔드가 mock 데이터를 사용 |
| `COLLECTOR_BOOT_DELAY` | `2` | collector 기동 후 testenv 시작까지 대기 시간(초) |
| `DEV_BOOT_DELAY` | `3` | testenv 기동 후 frontend 시작까지 대기 시간(초) |

접속 주소:

| 대상 | 주소 |
|---|---|
| React 대시보드 | `http://localhost:5173` |
| Collector WebSocket | `ws://localhost:9090/ws` |
| Collector 테스트 페이지 | `http://localhost:9090` |

---

## 코딩 규칙

### Go (collector, resource_agent)

- Idiomatic Go. 채널로 데이터 흐름 표현. 철저한 에러 처리.
- **인터페이스로 변경 경계를 격리한다.**
  교체가 예정된 구현체는 인터페이스 뒤에 숨긴다.
  예: `ServiceResolver` → `DockerResolver` / `StaticResolver` / `K8sResolver`
  예: `EventProvider` → `SubprocessProvider` (현재) / gRPC 구현체 (EC2 단계)
  호출 측(stats, hub)은 인터페이스만 보고, 구현체가 무엇인지 몰라야 한다.
- **패키지는 역할 단위로 나눈다.**
  `agent/` (tcp_trace subprocess), `resource/` (resource_agent subprocess),
  `hub/` (WebSocket), `stats/` (집계·spike), `resolver/` (IP→이름), `model/` (공유 타입)
- **공유 타입은 `model/event.go` 한 곳에만 정의한다.**
  필드 하나 추가할 때 이 파일 하나만 수정하면 전 패키지에 전파된다.
- **통신 방식을 비즈니스 로직과 분리한다.**
  stats는 데이터가 파이프로 오는지 gRPC로 오는지 모른다. `chan model.Event` 하나만 받는다.
  gRPC로 전환해도 stats, hub는 건드리지 않는다.

### eBPF (C)

- 리눅스 커널 코딩 스타일. CO-RE(Compile Once – Run Everywhere) 방식.
- eBPF Verifier 제약: 무한루프 금지, 메모리 범위 체크 필수.

### Frontend (TypeScript/React)

- 함수형 컴포넌트. 고빈도 데이터는 Canvas 직접 렌더링(devicePixelRatio 적용).
- WebSocket 메시지 타입: `stats` / `event` / `resource` / `remove` / `history`

---

## 단계별 변경 파일 지도

새 환경을 지원할 때 어느 파일만 건드리면 되는지 미리 정리해 둔다.

| 변경 시점 | 건드리는 파일 | 건드리지 않는 파일 |
|---|---|---|
| gRPC 전환 (EC2 멀티호스트) | `agent/reader.go` 교체 | stats, hub, model, resolver |
| EC2 IP 매핑 | `main.go`에서 `StaticResolver` 선택 | stats, hub |
| k8s 지원 | `resolver/k8s_resolver.go` 추가, `main.go` 선택 변경 | stats, hub |
| spike 임계값 조정 | `stats/stats.go`의 `spikeMultiplier` 상수 | 나머지 전부 |
| 이벤트 필드 추가 | `model/event.go` + `agent/tcp_trace_common.h` | 나머지는 통과 |

---

## 문서 구조

전체 지도는 `docs/README.md`에 있다. 역할별로 분리돼 있으니 필요한 한 덩이만 읽는다.

| 파일 | 역할 |
|---|---|
| `docs/README.md` | 문서 지도 (역할 구분 + 빠른 진입) |
| `docs/ai/CLAUDE.md` (이 파일) | AI 작업 가이드 원본. 루트 `CLAUDE.md`/`AGENTS.md`가 이 파일을 가리킴 |
| `docs/ai/todo.md` | 다음 작업 기록 |
| `docs/projects/microtrace/guide/overview.md` | AI용 축약 개요 (목적·포지션·동작원리) |
| `docs/projects/microtrace/reference/microtrace.md` | 사람용 PRD 전문 (배경·근거 필요 시) |
| `docs/projects/microtrace/code/microtrace.code.md` | ★코드 수정·탐색 시 필수. 기능→파일/심볼, 필드 전파 지도, 함정·교차영향, 부록A 빌드·로드 순서 |
| `docs/projects/microtrace/analysis/progress.md` | 구현 진행 기록 (요약) |

---

## Git 관리 규칙

**전략: GitHub Flow + Issue 기반 + Conventional Commits**

### 작업 시작 전

1. GitHub Issue를 생성한다 (작업 범위, 목적 명시)
2. Issue 번호를 확인한다 (예: #12)
3. 브랜치를 생성한다: `feat/#12-cause-kind` / `fix/#15-rtt-bug` / `docs/#20-flow-md`

```bash
git checkout -b feat/#12-cause-kind
```

### 작업 완료 후

1. AI가 변경 내용을 분석해서 커밋 메시지를 제안한다.
2. 커밋 메시지 형식: `<type>: <한글 요약> (closes #번호)`
   - type: `feat` / `fix` / `refactor` / `docs` / `chore`
   - 예: `feat: spike 원인 자동 판별 구현 (closes #12)`
3. 사용자에게 커밋 여부를 묻는다. 동의하면 실행한다.
4. main에 merge한다 (솔로이므로 PR 없이 직접 merge 가능).
5. `closes #번호` 덕분에 GitHub Issue가 자동으로 닫힌다.

### 규칙

- **절대로 사용자 확인 없이 커밋하지 않는다.**
- **이슈 없이 작업을 시작하지 않는다.**  새 작업이면 먼저 이슈 생성을 제안한다.
- 사용자가 메시지 수정을 요청하면 수정 후 재확인한다.

---

## 용어 구분 (헷갈리지 말 것)

| 용어 | 의미 |
|---|---|
| **토폴로지** | Web UI에서 컨테이너들을 노드·엣지로 시각화한 화면 |
| **그래프** | Web UI에서 p99, p95 등 지표를 시간 축으로 나타낸 선 그래프 |

---

## 학습 노트 / 리포트 관리 규칙

새로운 개념이 등장할 때마다 `docs/learning/<분야>/`에 추가한다.

| 파일 | 다루는 내용 |
|---|---|
| `docs/learning/kernel/ebpf.md` | eBPF, kprobe, tracepoint, Ring Buffer, Verifier, CO-RE, sock_ops |
| `docs/learning/kernel/c_language.md` | C 언어 문법, 포인터, 구조체 |
| `docs/learning/kernel/go.md` | Go 문법, goroutine, channel, sync |
| `docs/learning/network/tcp.md` | TCP 흐름, RTT, 재전송, Keep-Alive, EWMA |
| `docs/learning/network/websocket.md` | WebSocket 프로토콜, Hub 패턴 |
| `docs/learning/network/microservices.md` | MSA 개념, 서비스 간 통신 |
| `docs/learning/network/percentile.md` | p50/p95/p99 백분위 통계 |
| `docs/learning/infra/linux.md` | Linux 명령어, cgroup v2, /proc |
| `docs/learning/infra/docker.md` | Docker, 컨테이너, Docker API |
| `docs/learning/infra/sqlite.md` | SQLite 영속성, 배치 INSERT, TTL |
| `docs/learning/infra/cause_detection.md` | cause_kind 자동 판별 규칙 |

빌드/실행/데이터 흐름·코드 위치는 코드맵인 `docs/projects/microtrace/code/microtrace.code.md`에 둔다.
에러 트러블슈팅은 `docs/reports/yyyy-mm-dd.md` 형식으로 날짜별로 기록한다.
