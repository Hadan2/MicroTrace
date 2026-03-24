# 프로젝트 기획서: MicroTrace - eBPF-based Live Network Profiler

> **"1초의 평균(Average)에 숨겨진 1밀리초(ms)의 병목을 찾아내는 초실시간 네트워크 프로파일링 도구"**

---

# 1. 프로젝트 개요 (Overview)

현대의 마이크로서비스 아키텍처(MSA) 및 대규모 분산 시스템에서는 단 1ms의 네트워크 튐(Jitter) 현상이나 패킷 드롭이 치명적인 장애로 이어질 수 있습니다.

하지만 기존 상용 APM(Datadog, WhaTap 등) 솔루션은 클라우드 스토리지 비용 문제로 주로 10초~1분 단위의 데이터를 평균 내어(Aggregation) 수집하므로, 찰나의 마이크로 버스트(Micro-burst)를 관측하기 어렵습니다.

**MicroTrace**는 24시간 감시하는 기존 모니터링 시스템을 보완하여, **엔지니어가 장애 트러블슈팅 및 부하 테스트 시 즉각적으로 투입하는 '실시간 프로파일러(Live Profiler)'**를 목표로 합니다.

운영체제 커널의 **eBPF** 기술을 활용하여 **낮은 오버헤드(low-overhead)**로 TCP 지연 및 재전송 이벤트를 커널 레벨에서 추적하고, 이를 사용자 인터페이스로 **실시간 스트리밍 시각화(real-time streaming visualization)** 합니다.

---

# 2. 목표
1. **ms 단위 latency 측정**
2. **microburst spike 탐지**
3. **실시간 시각화**
4. **낮은 시스템 오버헤드**

---

# 3. 타겟 및 활용 분야 (Target Use Cases)

* **초저지연 금융 시스템:** 알고리즘/퀀트 트레이딩 거래 서버의 틱(Tick) 지연 및 TCP 재전송 원인 분석.
* **대규모 실시간 게임 서버:** 데디케이티드(Dedicated) 서버 내 멀티플레이어 간의 찰나의 '네트워크 랙' 추적. (차후 UDP 패킷 드롭 분석으로 확장 예정)
* **클라우드 인프라 (SRE):** 수십 개의 마이크로서비스 간 통신에서 발생하는 서브 밀리초(Sub-ms) 단위의 숨은 병목 구간 식별.

---

# 4. 시스템 아키텍처 (Architecture)

무거운 DB 저장을 최소화하고, 수집된 Raw 데이터를 즉시 프론트엔드로 전달(Streaming)하여 실시간성을 높인 3계층 아키텍처입니다.

| 구성 요소 | 기술 스택 | 주요 역할 |
| :--- | :--- | :--- |
| **Agent (수집기)** | C/C++, eBPF, Cilium | 리눅스 커널에 훅을 주입하여 TCP 지연 및 재전송 이벤트를 낮은 오버헤드로 수집. |
| **Collector (백엔드)** | Go (Goroutine), gRPC | 에이전트의 시계열 이벤트를 고루틴/채널로 비동기 처리 후 클라이언트로 실시간 스트리밍. |
| **Database** | In-Memory Cache (또는 Redis) | 장기 저장 대신 단기 버퍼링 및 통계 계산을 위한 인메모리 저장소. |
| **Dashboard (클라이언트)** | Wails (Go + React/Vue 등) | 백엔드와 IPC로 통신하는 데스크톱 프로파일러 UI. 실시간 네트워크 지연 스파이크를 시각적으로 표시. |

```
Application
     │
     │ (HTTP / RPC / Socket)
     ▼
Kernel
     │
     │ eBPF probe
     ▼
Latency Collector
     │
     │ stream
     ▼
Metrics Processor
     │
     ▼
Visualization Dashboard
```

---

# 구성 요소

### 1) eBPF Latency Collector

- TCP send / receive latency 추적
- syscall trace
- timestamp 기반 latency 측정

### 2) Metrics Processor

- latency histogram 생성
- spike detection
- sliding window 계산

### 3) Visualization Dashboard

- real-time latency graph
- p50 / p95 / p99 latency
- spike timeline
- service-level latency overview

---

# 5. 핵심 구현 포인트 (Technical Highlights)

* **Event-based Spike Detection:** 기존 폴링 기반 모니터링이 놓치는 짧은 지연 스파이크를 eBPF 이벤트 기반으로 즉각 탐지.
* **TCP Retransmission & Jitter Profiling:** TCP 재전송 횟수와 RTT 지연을 추적하여 네트워크 인프라 문제와 애플리케이션 병목을 구분.
* **Low-overhead Data Path:** eBPF Ring Buffer 기반 이벤트 전달을 활용하여 커널과 유저 공간 간 데이터 전달 오버헤드를 최소화.
* **Live Latency Visualization:** 데스크톱 기반 대시보드를 통해 네트워크 지연 스파이크를 실시간 그래프로 시각화.

---

# 6. 테스트 및 검증 계획 (Test Plan)

실제 프로덕션 수준의 트래픽을 모사하여 도구의 실시간 트러블슈팅 능력을 검증합니다.

* **테스트 환경:** AWS EC2 인스턴스 상에 **Google Microservices Demo** 배포.

  → :contentReference[oaicite:0]{index=0}

* **부하 발생:** `wrk` 또는 내부 Load Generator를 이용하여 초당 수만 건의 가상 요청 생성.

* **결과 검증:** 과부하 상태에서 특정 서비스 간에 발생하는 TCP retransmission 및 latency spike를 MicroTrace 대시보드가 실시간으로 감지하고 시각화하는지 확인.

---

# 7. 개발 마일스톤 (Milestones)

### Phase 1 (Agent 뼈대 구축)

단일 리눅스 환경에서 eBPF 개발 환경 구축

- TCP 지연 및 재전송 이벤트 추출
- 커널 이벤트를 터미널 로그로 출력

---

### Phase 2 (Go 스트리밍 서버 연동)

- eBPF 모듈과 Go 애플리케이션 연동
- 이벤트 데이터를 실시간 스트림 형태로 처리
- WebSocket 또는 IPC 기반 데이터 전달 파이프라인 구축

---

### Phase 3 (클라우드 테스트 및 시각화)

- EC2 환경에서 마이크로서비스 테스트 환경 구성
- 부하 테스트 수행
- 대시보드에서 latency spike 시각화 확인

---

# 8. 확장 가능성

향후 확장 기능

- anomaly detection
- latency spike root cause analysis
- Kubernetes integration
- cloud deployment
- UDP 패킷 드롭 분석 지원