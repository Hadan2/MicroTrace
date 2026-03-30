# 🔬 MicroTrace — eBPF-based Live Network Profiler

> **"1초의 평균(Average)에 숨겨진 1밀리초(ms)의 병목을 찾아내는 초실시간 네트워크 프로파일링 도구"**

---

## 1. 프로젝트 개요 (Overview)

현대의 마이크로서비스 아키텍처(MSA) 및 대규모 분산 시스템에서는 단 1ms의 네트워크 튐(Jitter) 현상이나 패킷 드롭이 치명적인 장애로 이어질 수 있습니다.

하지만 기존 상용 APM(Datadog, WhaTap 등) 솔루션은 클라우드 스토리지 비용 문제로 주로 10초~1분 단위의 데이터를 평균 내어(Aggregation) 수집하므로, 찰나의 마이크로 버스트(Micro-burst)를 관측하기 어렵습니다.

### 문제의 심각성: 평균에 숨겨진 장애

> **사례:** Datadog 대시보드에서 p99 latency가 50ms로 '정상'으로 표시되지만, 100ms 단위로 세분화하면 500ms spike가 0.1초간 간헐적으로 발생하여 주문 처리 실패율 3%를 유발하는 상황.
> 1분 평균으로 집계하면 이 spike는 완전히 묻히며, 엔지니어는 "모니터링에는 문제 없는데 왜 에러가 나지?"라는 상황에 놓이게 됩니다.
> (참고: Brendan Gregg — "Latency is not a single number, it's a distribution")

**MicroTrace**는 이러한 문제를 해결하기 위해, 24시간 감시하는 기존 모니터링 시스템을 **보완**하여 **엔지니어가 장애 트러블슈팅 및 부하 테스트 시 즉각적으로 투입하는 '실시간 프로파일러(Live Profiler)'**를 목표로 합니다.

운영체제 커널의 **eBPF** 기술을 활용하여 **낮은 오버헤드(low-overhead)**로 TCP 지연 및 재전송 이벤트를 커널 레벨에서 추적하고, 이를 사용자 인터페이스로 **실시간 스트리밍 시각화(real-time streaming visualization)** 합니다.

---

## 2. 목표

1. **ms 단위 latency 측정** — TCP 연결 및 요청 단위 latency 추적
2. **microburst spike 탐지** — 평균에 묻히는 찰나의 지연 스파이크 감지
3. **원인 자동 추적** — spike 감지 시 커널/앱 레벨 원인을 자동으로 좁혀가는 지능형 분석
4. **실시간 시각화** — 대시보드에서 latency spike를 실시간 그래프로 표시
5. **낮은 시스템 오버헤드** — 운영 환경에 부담 없이 상시 투입 가능

---

## 3. 비기능 요구사항 (Non-Functional Requirements)

"낮은 오버헤드"와 "실시간"을 구체적 수치로 정의합니다.

| 항목 | 목표치 | 측정 방법 |
|---|---|---|
| Agent CPU 오버헤드 (평상시, sock_ops only) | < 1% | `perf stat` / `top` 비교 |
| Agent CPU 오버헤드 (spike 시, kprobe 활성화) | < 3% | 동일 |
| 이벤트 전달 지연 (커널 → 대시보드) | < 100ms | 타임스탬프 차이 측정 |
| 동시 추적 가능 소켓 수 | 1,000+ | 부하 테스트로 검증 |
| Agent 메모리 사용량 | < 50MB | `RSS` 기준 측정 |
| Spike 이벤트 로그 보존 | 최근 1시간 (파일 덤프) | 로그 파일 크기/시간 확인 |

> **참고:** 위 수치는 Phase 2 완료 시점에 실측하여 기획서에 결과를 업데이트할 예정입니다.

---

## 4. 타겟 및 활용 분야 (Target Use Cases)

* **초저지연 금융 시스템:** 알고리즘/퀀트 트레이딩 거래 서버의 틱(Tick) 지연 및 TCP 재전송 원인 분석.
* **대규모 실시간 게임 서버:** 데디케이티드(Dedicated) 서버 내 멀티플레이어 간의 찰나의 '네트워크 랙' 추적. (차후 UDP 패킷 드롭 분석으로 확장 예정)
* **클라우드 인프라 (SRE):** 수십 개의 마이크로서비스 간 통신에서 발생하는 서브 밀리초(Sub-ms) 단위의 숨은 병목 구간 식별.

---

## 5. 시스템 아키텍처 (Architecture)

무거운 DB 저장을 최소화하고, 수집된 Raw 데이터를 즉시 프론트엔드로 전달(Streaming)하여 실시간성을 높인 3계층 아키텍처입니다.

| 구성 요소 | 기술 스택 | 주요 역할 |
|---|---|---|
| **Agent (수집기)** | C, eBPF (libbpf) | sock_ops로 소켓 단위 TCP latency/재전송 감시. spike 감지 시 kprobe/uprobe 동적 활성화. |
| **Collector (백엔드)** | Go (Goroutine, Channel) | 에이전트 이벤트를 고루틴/채널로 비동기 처리 후 WebSocket으로 실시간 스트리밍. |
| **Database** | In-Memory Cache + Spike Log | 단기 버퍼링 및 통계 계산을 위한 인메모리 저장소. spike 이벤트는 파일로 덤프하여 소급 분석 지원. |
| **Dashboard (클라이언트)** | Wails (Go + React/TS) | WebSocket으로 수신한 이벤트를 실시간 그래프로 시각화. |

```
[ 서비스 A ]  →  [ 서비스 B ]
      │                │
      └────────────────┘
               │
        sock_ops (소켓 단위 상시 감시)
               │
      latency spike 감지?
          │         │
         YES        NO → 통계만 수집
          │
     kprobe/uprobe 동적 활성화
     (커널/앱 레벨 원인 추적)
          │
     spike 이벤트 파일 덤프
          │
    [ Go Collector ]
          │  WebSocket
    [ Dashboard ]
```

### 기술 선택 근거

| 선택 | 이유 |
|---|---|
| **C + libbpf (CO-RE)** | BCC 대비 런타임 의존성 제거, 배포 용이성 확보 |
| **Go Collector** | goroutine/channel 기반 비동기 처리가 이벤트 스트리밍에 최적. 크로스 컴파일 용이 |
| **Wails (Go + React)** | Electron 대비 메모리 사용량 1/10 수준. Go 백엔드와 단일 언어 생태계 유지 |
| **인메모리 + 파일 덤프** | TSDB(InfluxDB 등) 의존성 제거로 설치 복잡도 최소화. spike 이벤트만 선별 저장 |

---

## 6. eBPF 추적 전략

### 왜 sock_ops인가?

기존 kprobe 방식의 한계:

```
kprobe/tcp_connect:
  - 새로운 TCP 연결을 맺을 때만 감지
  - HTTP Keep-Alive로 연결을 재사용하면 이후 요청은 추적 불가
  - 시스템 전체 모든 소켓에 훅 → 불필요한 오버헤드
```

sock_ops 방식:

```
소켓 하나에 eBPF 프로그램을 attach
  - 연결/전송/수신/재전송 등 소켓 전체 생명주기 추적
  - cgroup 단위로 관심 있는 서비스에만 선택적으로 적용
  - Keep-Alive 연결 위의 요청 단위 latency 측정 가능
```

### 3단계 추적 구조

```
1단계: sock_ops (상시 감시, 낮은 오버헤드)
   └── 소켓 단위로 TCP latency, 재전송 감시
   └── 평상시에는 이것만 동작

2단계: kprobe (spike 감지 시 자동 활성화)
   └── tcp_transmit_skb  → 패킷이 NIC 드라이버로 넘어가는 시간
   └── finish_task_switch → CPU 스케줄링 지연 (Run-Queue Latency)
   └── vfs_write          → 디스크 I/O 간섭 여부
   └── "네트워크 문제인가, CPU/디스크 문제인가" 판별

3단계: uprobe (커널 원인 제거 후 앱 레벨 추적)
   └── 서비스 함수 진입/반환 시점 기록
   └── "어느 함수에서 몇 ms를 썼는가" 추적
   └── Go부터 지원 시작 (Go 런타임 goroutine 스케줄러 추적 포함)
```

---

## 7. 경쟁 도구 비교

| | Datadog APM | Cilium | Pixie (New Relic) | MicroTrace |
|---|---|---|---|---|
| 추적 방식 | SDK 삽입 (코드 수정 필요) | sock_ops | eBPF (kprobe 중심) | sock_ops + 동적 kprobe/uprobe |
| 오버헤드 | 높음 | 낮음 | 낮음 | 낮음 |
| 원인 분석 | 앱 레벨만 | 네트워크만 | 프로토콜 파싱 중심 | 커널 + 앱 레벨 자동 추적 |
| 코드 수정 | 필요 | 불필요 | 불필요 | 불필요 |
| 배포 환경 | 클라우드/온프레미스 | Kubernetes 필수 | Kubernetes 필수 | **Docker/로컬 환경 지원** |
| 비용 | 유료 (호스트당 과금) | 무료 | 무료 (제한적) | **무료 (오픈소스)** |

**핵심 차별점:**
- Pixie/Cilium은 **Kubernetes 환경에 종속**되지만, MicroTrace는 **로컬 Docker 환경**에서도 동작
- Datadog은 SDK 삽입이 필요하지만, MicroTrace는 **Zero-Code Modification**
- 어떤 도구도 제공하지 않는 **"spike 감지 → 커널/앱 레벨 자동 원인 추적"** 3단계 구조

---

## 8. 핵심 구현 포인트 (Technical Highlights)

* **sock_ops 기반 소켓 단위 추적:** kprobe 대비 낮은 오버헤드로 Keep-Alive 연결 위의 요청 단위 latency 측정.
* **동적 kprobe/uprobe 활성화:** spike 감지 시에만 커널/앱 레벨 추적을 활성화하여 평상시 오버헤드 최소화.
* **tracepoint 동적 offset 파싱:** `/sys/kernel/debug/tracing/events/` format 파일을 런타임에 파싱하여 커널 버전 변경에 자동 대응.
* **eBPF Ring Buffer:** 커널↔유저 공간 간 이벤트 전달 오버헤드 최소화.
* **실시간 WebSocket 스트리밍:** Go collector가 이벤트를 WebSocket으로 대시보드에 즉시 전달.
* **Spike 이벤트 파일 덤프:** 인메모리 휘발성을 보완하여 spike 발생 시 이벤트를 JSON Lines 형식으로 파일 저장. 소급 분석 지원.

---

## 9. 테스트 및 검증 계획 (Test Plan)

실제 프로덕션 수준의 트래픽을 모사하여 도구의 실시간 트러블슈팅 능력을 검증합니다.

* **로컬 테스트 환경:** `testenv/` 폴더의 service_a, service_b로 서비스 간 TCP 통신 시뮬레이션. `tc netem`으로 패킷 손실/지연 주입.
* **클라우드 테스트 환경:** AWS EC2 인스턴스 상에 **Google Microservices Demo** 배포.
* **부하 발생:** `wrk` 또는 내부 Load Generator를 이용하여 초당 수만 건의 가상 요청 생성.
* **결과 검증:** 과부하 상태에서 특정 서비스 간에 발생하는 TCP retransmission 및 latency spike를 MicroTrace 대시보드가 실시간으로 감지하고 원인을 자동 추적하는지 확인.

### 성공 지표 (Success Criteria)

| 시나리오 | 성공 기준 |
|---|---|
| `tc netem`으로 100ms spike 주입 | 대시보드에서 **100ms 이내** 감지 및 표시 |
| 초당 10,000 요청 부하 | Agent CPU 오버헤드 **< 1%** 유지 |
| Keep-Alive 연결 위 요청 단위 latency | 개별 요청 latency **± 1ms 정확도**로 측정 |
| spike 감지 → kprobe 활성화 | **자동 활성화 후 원인 후보 3초 이내 표시** |

---

## 10. 개발 마일스톤 (Milestones)

### ✅ Phase 1 — Agent 뼈대 구축 (완료)

- WSL2 eBPF 개발 환경 구축 (커널 5.15, libbpf, clang)
- kprobe로 TCP 연결 latency 측정 구현
- tracepoint로 TCP 재전송 감지 구현 (동적 offset 파싱)
- Go collector와 연동하여 JSON 이벤트 스트리밍
- testenv로 Keep-Alive 한계 확인 → sock_ops 전환 결정

**Phase 1 결과 및 교훈:**
> - kprobe/tcp_connect 방식으로 새 TCP 연결의 latency 측정에 성공
> - 그러나 testenv에서 HTTP Keep-Alive 활성화 시, **연결 재사용 구간의 요청이 완전히 추적 불가**한 것을 확인
> - 이 한계가 sock_ops 전환의 직접적 근거가 됨
> - tracepoint offset 동적 파싱으로 커널 버전 의존성 해소 검증 완료

---

### Phase 2 — sock_ops 전환 + 실시간 스트리밍 (예상: 4~6주)

- kprobe → sock_ops 방식으로 전환
  - 소켓 단위 TCP latency 측정
  - Keep-Alive 연결 위의 요청 단위 추적
  - cgroup 기반 서비스 선택적 적용
- Go collector에 WebSocket 서버 추가
- agent → collector 통신: 바이너리 직렬화로 교체 (현재 JSON 임시)
- spike 이벤트 파일 덤프 기능 구현

---

### Phase 3 — 동적 kprobe 활성화 + 대시보드 (예상: 4~6주)

- spike 감지 시 kprobe 자동 활성화
  - tcp_transmit_skb, finish_task_switch, vfs_write
  - 커널 레벨 원인 후보 자동 판별
- Wails + React 대시보드 구현
  - 실시간 latency 그래프
  - p50 / p95 / p99 latency
  - spike timeline + 원인 표시
- NFR 목표 수치 실측 및 기획서 업데이트

---

### Phase 4 — uprobe + 클라우드 검증 (장기, 예상: 6~8주)

- uprobe 언어별 지원 (Go 런타임부터 시작)
  - goroutine 스케줄링 지연 추적
  - 함수 단위 실행 시간 측정
- EC2 + Google Microservices Demo 배포
- wrk 부하 테스트 및 spike 원인 자동 추적 검증

---

## 11. 리스크 분석 및 대응 전략

| 리스크 | 영향도 | 발생 가능성 | 대응 전략 |
|---|---|---|---|
| WSL2에서 sock_ops / cgroup v2 미지원 | 상 | 중 | Phase 2 초기에 EC2 프리티어로 조기 검증. 실패 시 kprobe 폴백 유지하고 sock_ops는 Linux 네이티브 환경 전용으로 전환 |
| eBPF Verifier 통과 실패 (복잡한 로직) | 상 | 고 | 복잡한 분석 로직은 유저스페이스(Go)로 분리. BPF 프로그램은 데이터 수집에만 집중 |
| Go uprobe ABI 변경 (Go 버전업 시) | 중 | 중 | Phase 4를 장기 목표로 분리. 특정 Go 버전 고정. ABI 변경 시 offset 테이블 업데이트 방식 채택 |
| 실시간 그래프 렌더링 성능 병목 | 중 | 중 | 이벤트 샘플링/버퍼링으로 프론트 부하 제어. 초당 렌더링 횟수 제한 (30fps) |
| 동적 kprobe attach/detach 시 커널 불안정 | 상 | 하 | attach 실패 시 graceful fallback. 프로브 개수 상한 설정 |

---

## 12. 확장 가능성

- anomaly detection (ML 기반 이상 패턴 탐지)
- Kubernetes integration (Pod/Service 단위 추적)
- UDP 패킷 드롭 분석 지원
- cloud deployment (SaaS 형태)
- NetSim Lab 통합 (→ [integration.md](./integration.md) 참조)
