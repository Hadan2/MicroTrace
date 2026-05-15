# MicroTrace & NetSim Lab

> **eBPF 기반 latency 원인 분석 + 로컬 카오스 엔지니어링 통합 플랫폼**

---

## 프로젝트 전체 구조

본 프로젝트는 **두 개의 독립적이면서도 유기적으로 연결되는 도구**로 구성됩니다.

| 프로젝트 | 한 줄 설명 | 역할 |
|---|---|---|
| **MicroTrace** | eBPF 기반 실시간 latency 원인 분석기 | 장애의 **원인을 좁힌다** |
| **NetSim Lab** | Docker 컨테이너 대상 네트워크 장애 주입 도구 | 장애를 **재현**한다 |

두 도구를 결합하면 **"장애 주입 → latency spike 감지 → 원인 분석"** 이라는 완전한 피드백 루프가 완성됩니다.

```
┌─────────────────────────────────────────────────┐
│              통합 운영 시나리오                    │
│                                                   │
│   NetSim Lab          MicroTrace                  │
│   (장애 주입)    →    (실시간 관측)               │
│       │                    │                      │
│       └────── 피드백 ──────┘                      │
│              루프 완성                             │
└─────────────────────────────────────────────────┘
```

---

## 타겟 페르소나

> **스타트업 3~10인 백엔드 팀.** MSA 전환 초기 단계로, Datadog/WhaTap 비용이 부담되어 무료 대안을 모색 중.
> 간헐적 API 타임아웃이 발생하지만 기존 APM의 1분 평균 데이터로는 원인을 찾지 못하고 있는 상황.
> 로컬 개발 환경에서 네트워크 예외 상황을 재현할 도구도 마땅치 않아, retry/timeout 로직의 신뢰성을 검증하지 못하고 있음.

---

## 문서 구조

| 문서 | 내용 |
|---|---|
| [microtrace.md](./mdfiles/microtrace.md) | MicroTrace 상세 기획서 |
| [netsim.md](./mdfiles/netsim.md) | NetSim Lab 상세 기획서 |
| [integration.md](./mdfiles/integration.md) | 통합/독립 운영 시나리오 |
| [todo.md](./mdfiles/todo.md) | 다음 작업 및 완료 이력 |
| [interview-qa.md](./mdfiles/interview-qa.md) | 면접 대비 Q&A |

---

## 기술 스택 요약

| 계층 | MicroTrace | NetSim Lab |
|---|---|---|
| 커널/시스템 | C, eBPF (libbpf), sock_ops, kprobe, uprobe | tc/netem, nsenter, netlink |
| 백엔드 | Go (Goroutine, Channel, WebSocket) | Go (Docker API, REST API) |
| 프론트엔드 | React Web (TypeScript) | Web UI (React) |
| 인프라 | Docker, cgroup v2 | Docker API, Network Namespace |

---

## 개발용 원클릭 실행

디버깅할 때 필요한 테스트 컨테이너, collector, React 개발 서버를 한 번에 실행합니다.

```bash
make dev
```

실행 후 접속:

| 대상 | 주소 |
|---|---|
| React 대시보드 | `http://localhost:5173` 또는 런처가 출력한 WSL IP 주소 |
| Collector 테스트 페이지 | `http://localhost:9090` 또는 런처가 출력한 WSL IP 주소 |
| WebSocket | 프론트가 접속한 host 기준으로 자동 연결 |

종료는 실행 중인 터미널에서 `Ctrl+C`를 누르면 됩니다. 기본적으로 테스트 컨테이너도 함께 정리됩니다. 컨테이너를 유지하고 싶으면 아래처럼 실행합니다.

```bash
KEEP_CONTAINERS=1 make dev
```

테스트 컨테이너만 수동으로 정리하려면:

```bash
make dev-down
```

---

## React Web 대시보드 구조 설계

> **프론트엔드 방향: React Web (TypeScript) 확정.**
> Wails(데스크톱 앱)는 로컬 단일 머신에서만 동작하므로, EC2 멀티 호스트·K8s 환경에서 팀원이 브라우저로 접속할 수 없음. React Web은 URL 하나로 모든 환경에서 공유 가능.

사용자가 자신의 마이크로서비스에 MicroTrace를 올리면, 먼저 서비스 간 latency spike와 리소스 이상 징후를 감지하고, 이를 토폴로지와 상세 그래프에서 함께 보여줍니다. 특정 노드나 엣지를 클릭하면 RTT뿐 아니라 CPU/IO 같은 원인 후보를 확인하는 상세 분석 화면으로 진입합니다.

```
토폴로지 화면 (Overview)
┌─────────────────────────────────┐
│                                  │
│  [service-a] ──🔴──▶ [service-b] │  ← 빨간색 = 레이턴시 높음
│       │                          │
│       └────────▶ [postgres]      │  ← 화살표 두께 = 트래픽 양
│                                  │
└─────────────────────────────────┘
         클릭하면 ▼

상세 화면 (service-a → service-b)
┌─────────────────────────────────┐
│  RTT 시계열 그래프               │
│  재전송 횟수                     │
│  P50 / P95 / P99 레이턴시        │
└─────────────────────────────────┘
```

### 구현 로드맵

| Phase | 내용 |
|---|---|
| Phase 1 | collector에 Docker API 연동 → IP를 컨테이너 이름으로 매핑 → 서비스 간 latency 시각화 기반 마련 |
| Phase 2 | latency spike 감지 + CPU/IO/Memory 리소스 수집 (고정 1초 주기, resource_agent 별도 바이너리) |
| Phase 3 | React 토폴로지/상세 화면 → RTT, CPU, IO, 재전송을 함께 보여주는 drill-down UI |

### 환경별 지원 전략

Docker Compose와 Kubernetes는 서비스 이름 체계와 네트워크 구조가 근본적으로 다르므로, 별개의 구현체로 설계합니다. 확장성을 위해 `ServiceResolver` 인터페이스를 공통으로 두고, 환경에 따라 구현체를 교체하는 방식을 사용합니다.

```go
// collector/resolver/resolver.go
type ServiceResolver interface {
    Resolve(ip string) string  // IP → 서비스 이름
}

// 지금 구현: Docker API로 IP → 컨테이너 이름 조회
type DockerResolver struct { ... }

// 나중에 추가: k8s API로 Pod/Service 조회
type KubernetesResolver struct { ... }
```

| 모드 | 대상 환경 | 이름 매핑 방식 |
|---|---|---|
| Docker Compose 모드 | 단일 호스트, 로컬 개발 환경 | Docker API (컨테이너 이름) |
| Kubernetes 모드 | 다중 노드, 프로덕션 환경 | k8s API (Pod/Service 이름) |

---

## 확장 지표 계획

현재 수집 중인 기본 지표(RTT, 재전송) 외에 아래 지표들을 단계적으로 추가합니다.

### 우선순위 높음

**Jitter (RTT 변동폭)**

레이턴시 스파이크를 탐지하려면 "RTT가 높다"가 아니라 "RTT가 갑자기 튀었다"를 알아야 합니다. 현재 `srtt_us`는 커널이 EWMA로 평활화한 값이라 500ms 스파이크가 발생해도 부드럽게 반영됩니다. 실제 스파이크를 잡으려면 `mdev_us`(RTT Mean Deviation)가 필요합니다.

```c
e->jitter_us = skops->mdev_us >> 3;  // mdev도 고정소수점
```

**연결 종료 상태 (RST / FIN / Timeout)**

연결이 어떻게 끝났는지 파악하면 장애 원인을 분류할 수 있습니다.

| 상태 | 의미 |
|---|---|
| 정상 FIN | 클라이언트/서버가 정상 종료 |
| RST 수신 | 상대방이 연결을 강제 끊음 (서버 에러, 방화벽 차단) |
| Timeout | 응답 없음 (서비스 다운, 네트워크 단절) |

`BPF_SOCK_OPS_STATE_CB`를 추가하면 "이 서비스 연결이 RST로 끊기는 비율이 15%" 같은 진단이 가능합니다.

### 우선순위 중간

**Congestion Window (cwnd)**

네트워크가 느린 원인이 실제 네트워크 지연인지, TCP 혼잡 제어가 속도를 줄인 것인지 구분하는 데 사용합니다.

- cwnd가 급감 → 패킷 유실 → TCP가 속도를 줄인 것
- cwnd는 정상인데 RTT만 높음 → 순수 네트워크 지연

**바이트 카운터 (Throughput)**

연결별로 얼마나 데이터를 주고받았는지 파악해 "이 연결이 중요한 연결인지" 판단하는 데 사용합니다. 연결 종료 시점(`STATE_CB`)에 한 번만 기록하므로 오버헤드가 거의 없습니다.

```c
skops->bytes_sent
skops->bytes_received
```

### 우선순위 낮음

| 지표 | 접근 방법 | 이유 |
|---|---|---|
| SYN Retransmission | `BPF_SOCK_OPS_TCP_CONNECT_CB` 시점 추적 | 연결 자체가 안 되는 경우에만 유의미 |
| Receive Window | `skops->rcv_wnd` | cwnd보다 원인 분석 기여도 낮음 |
| Delivery Rate | `skops->rate_delivered` | Phase 3 상세 분석 시 추가 |

### 확장 후 struct event 구조

```c
// tcp_trace_common.h

#define EVENT_TYPE_CONNECT     1
#define EVENT_TYPE_RTT         2
#define EVENT_TYPE_RETRANSMIT  3
#define EVENT_TYPE_CLOSE       4

struct event {
    __u8  type;
    __u32 pid;            // local_port (소켓 식별용)
    __u32 daddr;
    __u16 dport;
    char  comm[16];

    // 기존
    __u64 latency_us;     // srtt_us >> 3

    // Phase 2 추가
    __u64 timestamp_ns;   // bpf_ktime_get_ns()
    __u64 jitter_us;      // mdev_us >> 3
    __u32 snd_cwnd;       // congestion window
    __u32 total_retrans;  // 누적 재전송 횟수

    // CLOSE 이벤트용
    __u32 old_state;      // 이전 TCP 상태
    __u64 bytes_sent;
    __u64 bytes_received;
};
```
