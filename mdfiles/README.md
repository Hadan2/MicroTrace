# MicroTrace & NetSim Lab

> **커널 레벨 네트워크 프로파일링 + 로컬 카오스 엔지니어링 통합 플랫폼**

---

## 프로젝트 전체 구조

본 프로젝트는 **두 개의 독립적이면서도 유기적으로 연결되는 도구**로 구성됩니다.

| 프로젝트 | 한 줄 설명 | 역할 |
|---|---|---|
| **MicroTrace** | eBPF 기반 실시간 네트워크 프로파일러 | 장애를 **관측**한다 |
| **NetSim Lab** | Docker 컨테이너 대상 네트워크 장애 주입 도구 | 장애를 **재현**한다 |

두 도구를 결합하면 **"장애 주입 → 실시간 관측 → 원인 분석"** 이라는 완전한 피드백 루프가 완성됩니다.

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
| [microtrace.md](./microtrace.md) | MicroTrace 상세 기획서 |
| [netsim.md](./netsim.md) | NetSim Lab 상세 기획서 |
| [integration.md](./integration.md) | 통합/독립 운영 시나리오 |
| [interview-qa.md](./interview-qa.md) | 면접 대비 Q&A |

---

## 기술 스택 요약

| 계층 | MicroTrace | NetSim Lab |
|---|---|---|
| 커널/시스템 | C, eBPF (libbpf), sock_ops, kprobe, uprobe | tc/netem, nsenter, netlink |
| 백엔드 | Go (Goroutine, Channel, WebSocket) | Go (Docker API, REST API) |
| 프론트엔드 | Wails (Go + React/TypeScript) | Web UI (React) |
| 인프라 | Docker, cgroup v2 | Docker API, Network Namespace |

---

## 웹 UI 구조 설계

사용자가 자신의 마이크로서비스에 MicroTrace를 올리면, 전체 서비스 토폴로지를 시각화하고 병목 구간을 색상/화살표로 표시합니다. 특정 노드나 엣지를 클릭하면 상세 분석 화면으로 진입합니다.

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
| Phase 1 | collector에 Docker API 연동 → IP를 컨테이너 이름으로 매핑 → WebSocket으로 프론트 전달 |
| Phase 2 | React 토폴로지 화면 → 노드(서비스), 엣지(연결), 색상(레이턴시 수준) |
| Phase 3 | 엣지/노드 클릭 → 상세 그래프 화면 → RTT 시계열, P95, 재전송 등 |

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






. 근데  "이 시점에 해당 컨테이너 CPU가 몇 %였나?" 를 보여주려면 너가 까다롭다고 한 컨테이너별 CPU 사용량 분리 를 어차피 구현해야 하는거 아닌지 ? 
2. 내 추측(물론 난 마이크로 서비스를 잘 몰라서 , 단순 나의 뇌피셜이므로 지적해줘도 됨) Local Docker Compose 의 Container 끼리의 네트워크 병목은 거의 없을 것 같음(같은 서버=컴퓨터 내이니까. 대신에 CPU 병목이나 이런게 훨씬 많을 것 같은데, 이런 기능이 더 중요하지는 않을지 ? 아니면 내가 틀렸어 ?
두 질문 모두 날카롭습니다. 순서대로 답할게요.

1. 맞습니다. 어차피 구현해야 합니다
제가 앞에서 모순된 말을 했네요. "보조 기능으로 넣자"고 하면서 "컨테이너별 분리가 까다롭다"고 했는데, 보조 기능이든 주기능이든 컨테이너별 분리는 똑같이 필요합니다. 취소선 그어야 할 말이었습니다.

정확히 말하면 난이도 자체가 문제가 아니라 순서의 문제입니다.


지금 상태:
  네트워크 UI 없음
  토폴로지 없음
  WebSocket 없음

CPU 지표를 지금 넣으면:
  보여줄 화면이 없음
  → 수집만 하고 출력 못하는 상태
구현 자체는 해야 하지만, 화면이 먼저 있어야 의미가 생깁니다.

2. 반은 맞고 반은 틀렸습니다
뇌피셜이라고 하셨지만 꽤 정확한 직관입니다. 다만 "거의 없을 것 같다"는 부분은 수정이 필요합니다.

로컬 Docker Compose에서 네트워크 병목이 아예 없냐?
없지 않습니다. 있습니다. 다만 원인이 다릅니다.


실제 프로덕션 MSA 네트워크 병목:
  서버 A → 서버 B 물리 네트워크 구간
  → 케이블, 스위치, 대역폭 한계
  → 수십~수백 ms 지연 가능

로컬 Docker Compose 네트워크 병목:
  물리 네트워크 없음 (루프백/브릿지)
  → 대신 이런 것들이 병목이 됨:
     ① 컨테이너가 CPU를 너무 써서 응답이 늦어짐  ← CPU 병목
     ② 디스크 IO 대기 중에 응답 못 함             ← IO 병목
     ③ 연결 수가 너무 많아 accept queue 초과       ← 소켓 병목
     ④ 메모리 부족으로 OOM killer 발동             ← 메모리 병목
즉 로컬에서 RTT가 높게 나왔다면 원인이 네트워크가 아닐 가능성이 높습니다. 이게 바로 Correlated Monitoring이 필요한 이유입니다.

그러면 MicroTrace가 로컬에서 뭘 봐야 하는가?

현재 MicroTrace가 보는 것:
  service-a → service-b RTT = 150ms  (높다!)

근데 왜 150ms인지 알 수가 없음
  원인 후보 1: 네트워크 문제?  → 로컬에선 거의 없음
  원인 후보 2: service-b CPU 포화?  → 모름
  원인 후보 3: service-b 디스크 IO 대기?  → 모름
  원인 후보 4: service-b 내부 로직 느림?  → eBPF로 못 잡음

Correlated Monitoring 추가 후:
  service-a → service-b RTT = 150ms
  + 그 시점 service-b CPU = 98%  ← 바로 원인 특정
이게 MicroTrace의 실제 가치입니다. 로컬 환경에서는 특히 더.

결론적으로 방향 수정이 필요합니다
제가 앞에서 "보조 기능"이라고 한 건 틀린 포지셔닝이었습니다.


수정 전 (제가 말한 것):
  주기능: 네트워크 토폴로지
  보조:   CPU/IO 상관관계

수정 후 (더 정확한 것):
  주기능: "레이턴시 스파이크의 원인을 찾아준다"
             ├── 네트워크 지표 (RTT, 재전송)
             └── 시스템 지표 (CPU, IO) ← 동등한 위치
특히 타겟이 "로컬 Docker Compose 환경의 스타트업"이라면 CPU/IO 지표가 오히려 더 직접적인 가치를 줍니다.

구현 순서 제안 (수정)

Phase 1: 데이터 수집 완성
  ├── 네트워크: 현재 RTT + Jitter + 재전송 (이미 있음)
  └── 시스템:  컨테이너별 CPU throttling + IO wait (추가)

Phase 2: 웹 UI
  ├── 토폴로지 화면 (서비스 간 연결 + 레이턴시 색상)
  └── 상세 화면 (RTT 그래프 + CPU 그래프 시간 동기화)

Phase 3: 상관관계 분석
  └── "RTT 스파이크 = CPU 포화 때문" 자동 판별
README 업데이트할까요?

업데이트 하기 전에 마지막 하나만 . 
"멀티 호스트 분산 분석 (Multi-Host Analysis): 단일 서버를 넘어 여러 EC2 인스턴스에 배포된 에이전트들로부터 데이터를 취합하는 중앙 콜렉터 아키텍처 구현. 이를 통해 서비스 간 실제 네트워크 구간(VPC)에서 발생하는 지연과 각 서버 내부의 자원 경합을 통합 분석함."

이건 어디서 나온 의견이냐면, 
우리가 지금 Local Docker 환경에서 네트워크 + CPU 등 전통적 지표를 사용해서 측정하기로 했는데, local docker 도 아니고, 쿠버네티스도 아니고, 그냥 클라우드를 이용해서 EC2 서버 여러개 띄운 환경에서는 또 따로 구현해야 하는거 아닌지 ? 
실제로 작은 스타트업에서는 쿠버네티스를 사용하지 않고 이런 방식을 사용할 것 같응ㄴ데 ?
완전히 맞습니다. 그리고 이게 사실 가장 현실적인 타겟입니다.

실제 스타트업 인프라 현실

초기 스타트업의 실제 배포 방식:

단계 1: 로컬 개발
  docker-compose up
  → 개발자 노트북에서 전부 돌림

단계 2: 클라우드 초기 (← 실제로 가장 많은 구간)
  EC2 3대
  ├── EC2-1: service-a, service-b
  ├── EC2-2: service-c, postgres
  └── EC2-3: redis, service-d
  → 각 서버에서 docker-compose 또는 그냥 프로세스로 실행
  → k8s 없음, 오케스트레이션 없음

단계 3: 성장 후
  ECS or Kubernetes
  → 이 단계 가면 Datadog 살 돈도 생김
MicroTrace의 실제 골든 타겟은 단계 2입니다. k8s 쓸 여유 없고, Datadog 비싸고, 서버 몇 대에 Docker로 운영하는 팀.

그러면 EC2 멀티 호스트는 k8s랑 어떻게 다른가?

Kubernetes 멀티 호스트:
  Control Plane이 모든 걸 관리
  Pod IP는 k8s가 자동 할당
  서비스 이름은 DNS로 자동 해석 (service-a.default.svc.cluster.local)
  → 이름 매핑이 k8s API에 다 있음

EC2 멀티 호스트:
  오케스트레이션 없음
  IP는 EC2 인스턴스 IP (고정적)
  서비스 이름? → 사람이 정한 규칙만 있음 (없을 수도 있음)
  → 이름 매핑을 MicroTrace가 직접 해줘야 함
그리고 네트워크 구간이 진짜 물리적으로 분리됩니다.


로컬 Docker:
  service-a → service-b
  [브릿지 네트워크, 같은 머신]
  RTT: 거의 0 (0.1ms 이하)
  병목 원인: CPU/IO

EC2 멀티 호스트:
  EC2-1의 service-a → EC2-2의 service-b
  [VPC 내부 네트워크]
  RTT: 1~5ms (정상), 스파이크 시 수십ms
  병목 원인: 네트워크 지연 + CPU/IO 둘 다 가능
로컬에서는 의미 없던 네트워크 지연이 EC2 환경에서는 진짜 측정 대상이 됩니다. MicroTrace의 네트워크 측정이 여기서 빛을 발합니다.

그러면 세 환경이 이렇게 정리됩니다

환경 1: 로컬 Docker Compose
  특징: 단일 머신, 네트워크 병목 없음
  주요 병목: CPU, IO
  ServiceResolver: DockerResolver
  Agent 배포: 1개

환경 2: EC2 멀티 호스트        ← 골든 타겟
  특징: 여러 서버, VPC 네트워크
  주요 병목: 네트워크 + CPU + IO 전부
  ServiceResolver: StaticResolver (IP→이름 설정 파일)
                   or EC2 API (태그로 이름 조회)
  Agent 배포: 서버마다 1개 + 중앙 Collector

환경 3: Kubernetes
  특징: 오케스트레이션, Pod IP 유동적
  주요 병목: 네트워크 + 자원 경합
  ServiceResolver: K8sResolver
  Agent 배포: DaemonSet
EC2 멀티 호스트 아키텍처

EC2-1                    EC2-2                    EC2-3
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│ [eBPF agent]│         │ [eBPF agent]│         │ [eBPF agent]│
│ [sender]    │──gRPC──▶│             │         │ [sender]    │
└─────────────┘         │  [중앙      │◀──gRPC──└─────────────┘
                        │  Collector] │
                        │  [WebSocket]│
                        └──────┬──────┘
                               │
                            [웹 UI]
                  EC2-1의 service-a
                  → EC2-2의 service-b
                  VPC 구간 RTT: 12ms 🔴
이게 바로 아까 말한 B 방식(다중 호스트)입니다. 그리고 k8s가 아닌 EC2 환경이 구현이 오히려 더 단순합니다. k8s처럼 Control Plane API 없어도 되고, IP가 고정적이라 매핑도 쉽습니다.

결론: 환경별 구현 우선순위 재정립

Phase 1: 로컬 Docker Compose
  → 단일 agent, DockerResolver, 웹 UI 완성

Phase 2: EC2 멀티 호스트      ← 이게 실제 가치
  → 중앙 Collector 추가, gRPC 도입, EC2 태그 기반 이름 매핑
  → 여기서 gRPC 전환(처음에 논의한 선택지 1번)이 자연스럽게 필요해짐

Phase 3: Kubernetes
  → K8sResolver 추가, DaemonSet 배포
선택지 1번(gRPC 전환)이 Phase 2에서 자연스럽게 필요해지는 구조입니다. 처음부터 할 게 아니라 이 시점에 하면 됩니다.

README 업데이트할까요?