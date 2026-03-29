# 🚀 프로젝트 기획서: NetSim Lab
**Developer-Centric Network Simulation Platform**

> **"네트워크 문제는 ‘추측’이 아니라 ‘재현(Replication)’으로 해결한다."**
> 무거운 엔터프라이즈 도구 대신, 로컬 환경에서 클릭 몇 번으로 복잡한 네트워크 장애를 주입하고 관측하는 **가벼운(Lightweight) Chaos Engineering 도구**

---

## 1. 프로젝트 개요 (Overview)
현대 분산 시스템 및 MSA(Microservices Architecture) 환경에서 네트워크 지연과 패킷 손실은 서비스 장애의 핵심 원인입니다. 하지만 개발자가 로컬 개발 단계에서 이러한 예외 상황을 정확하게 재현하기는 매우 까다롭습니다.

기존 방식(mock, tc CLI 등)으로는 실제 네트워크 문제를 정확히 재현하기 어렵고,
실험 결과를 반복적으로 검증하기 힘들다는 문제가 있습니다.

기존 상용 도구(예: Gremlin, Chaos Mesh)는 매우 강력하지만, SaaS에 연동되거나 Kubernetes 생태계에 강하게 종속되어 있어 로컬에서 가볍게 사용하기에는 진입 장벽이 높습니다. 반면 Linux 기본 도구(`tc/netem`)는 CLI 숙련도를 요구하며 컨테이너 단위의 제어가 번거롭습니다.

**NetSim Lab**은 이러한 페인 포인트를 해결하기 위해 설계된 **“로컬 개발자 친화적 네트워크 시뮬레이션 플랫폼”**입니다. 복잡한 설정 없이 `docker run` 한 줄로 실행되며, 직관적인 UI를 통해 타겟 컨테이너의 네트워크 상태를 자유롭게 조작하고 실험할 수 있습니다.

---

## 2. 핵심 목표 (Core Goals)
1. **직관적인 L4 제어:** UI 슬라이더를 통해 Latency(지연), Packet Loss(손실), Jitter(지터) 등을 실시간으로 조절
2. **컨테이너 단위 타겟팅:** 전체 호스트가 아닌 특정 Docker 컨테이너 및 서비스 단위로 격리된 네트워크 장애 주입
3. **시나리오 기반 실험:** '3G 모바일 환경', 'IDC 간 통신 지연' 등 사전 정의된 시나리오를 통한 반복 가능한 실험 환경 제공
4. **관측(Observability) 도구 연동:** 장애 주입(NetSim Lab)과 장애 감지(MicroTrace 등)를 연계하여 완전한 실험-분석 루프 완성

---

## 3. 핵심 차별성 (Differentiation: vs. Gremlin)
NetSim Lab은 거대한 카오스 엔지니어링 플랫폼이 아닌, **'주머니 속의 가벼운 디버깅 도구'**를 지향합니다.

* **Zero-Code Modification:** 대상 애플리케이션의 코드 수정이나 무거운 에이전트 설치 없이 인프라 레벨에서 즉각 개입
* **One-Shot Execution:** 지속적으로 메트릭을 수집하는 상용 툴과 달리, 사용자가 실험을 원할 때만 Host의 `veth` 또는 컨테이너 Network Namespace에 개입하는 경량화 구조
* **자체 검증 루프:** 외부 모니터링 툴에만 의존하지 않고, 장애를 주입한 시점의 데이터를 추적 시스템(MicroTrace 등)의 시각화 데이터와 직접 연결

---

## 4. 시스템 아키텍처 (Architecture)

```text
[ Web / Desktop UI ] 
        │ (REST API / WebSocket)
        ▼
[ Control Server (Go) ] ──────────┐
        │                         │ (Metrics)
        ▼                         ▼
[ Network Engine ]          [ Observability ]
 (tc / netem / nsenter)      (MicroTrace 연동)
        │
        ▼
[ Target Docker Container ]

---

이어서 **[Part 2: 상세 기능 및 마일스톤]**입니다.

### 📄 프로젝트 기획서 Part 2: 기능 및 로드맵

```markdown
## 5. 핵심 기능 (Core Features)

### 5.1 네트워크 시뮬레이션 (Traffic Shaping)
* **Latency & Jitter:** 특정 범위 내의 지연 및 변동폭 주입
* **Packet Loss:** 백분율 기반의 패킷 유실 시뮬레이션
* **Bandwidth Control:** 대역폭 제한을 통한 초저속 네트워크 환경 재현

### 5.2 서비스 단위 정밀 제어
* **Container Targeting:** Docker API를 통해 실행 중인 컨테이너 목록을 식별하고 개별 적용
* **Port-Specific Rules:** 특정 포트(예: DB 연결 3306, API 8080)에만 장애를 주입하는 선별적 제어

### 5.3 시나리오 매니저
* **Pre-defined Scenarios:** 3G/LTE, Satellite Link, Cross-Region(AWS Seoul to US-East) 등 현실적인 프리셋 제공
* **Custom Scenarios:** 사용자가 직접 정의한 복합 장애 시나리오 저장 및 공유

---

## 6. 기술적 핵심 포인트 (Technical Highlights)
1. **Low-level Network Control:** 단순 Mock이 아닌 `tc/netem` 기반의 실제 커널 레벨 패킷 제어 구현
2. **Network Namespace Traversal:** Go 언어의 `netlink` 라이브러리와 `nsenter` 메커니즘을 이용한 컨테이너 격리망 진입 기술
3. **Real-time Feedback Loop:** 설정 적용 즉시 결과(RTT, 에러율)를 시각화하여 실험의 신뢰성 확보

---

## 7. 개발 마일스톤 (Milestones)

* **Phase 0: 기술 검증 (PoC)**
  * Go 언어로 특정 Docker 컨테이너의 Network Namespace에 진입하여 `tc` 명령어 주입 및 해제 성공 여부 검증
* **Phase 1: Minimal MVP (단일 제어)**
  * 컨테이너 목록 조회 API 및 기본적인 웹 제어 UI 구축
  * Latency, Loss 단일 항목 적용 및 해제 기능 완료
* **Phase 2: 시나리오 및 고도화**
  * 시나리오 저장/불러오기 기능 및 복합 장애(Latency + Loss) 지원
  * 서비스 간(Service-to-Service) 특정 통신 경로 타겟팅 기능
* **Phase 3: 관측 파이프라인 연동 (MicroTrace)**
  * 장애 주입 시점의 트레이싱 데이터 매핑 및 시각화 연동
  * 분석 리포트(장애 상황 vs 정상 상황 비교) 생성 기능

---

## 8. 기대 효과 (Impact)
본 프로젝트는 단순 웹 서비스를 넘어 OSI 하위 계층(L2~L4)과 Linux 시스템 기술을 현대적 컨테이너 생태계와 결합하는 도전적인 과제입니다. 이를 통해 백엔드 개발자의 디버깅 생산성을 높일 뿐만 아니라, 시스템의 탄력성(Resilience)을 수치로 증명하는 강력한 포트폴리오가 될 것입니다.

- 외부 API 지연 상황에서 retry/timeout 로직을 실제 환경 기반으로 검증 가능
- 네트워크 장애 상황을 재현하여 장애 대응 코드의 신뢰성 향상
- MicroTrace와 연계하여 ms 단위 latency spike를 실제로 검증 가능

향후 SaaS 형태로 확장하여 팀 단위로 시나리오를 공유하고,
개발 및 테스트 환경에서 공통적으로 사용할 수 있는 플랫폼으로 발전시키는 것을 목표로 합니다.









Q1. tc 명령어를 쓰면 호스트 전체 네트워크가 느려지지 않나요? 어떻게 특정 컨테이너만 제어하죠?

답변: "그게 이 프로젝트의 핵심 기술입니다. Docker 컨테이너는 각각 독립된 Network Namespace를 가집니다. 저는 Go의 veth 인터페이스를 찾는 로직이나 nsenter를 통해 해당 컨테이너의 네임스페이스 내부로 진입하여 tc 규칙을 적용합니다. 덕분에 호스트나 다른 컨테이너에는 전혀 영향을 주지 않고 타겟 서비스만 격리하여 시뮬레이션할 수 있습니다."

Q2. 이미 Toxiproxy나 Pumba 같은 도구가 있는데 차이점이 뭔가요?

답변: "Toxiproxy는 L7/L4 프록시 방식이라 애플리케이션의 엔드포인트를 수정해야 하는 번거로움이 있고, Pumba는 CLI 중심이라 실시간 관측이 어렵습니다. NetSim Lab은 Zero-Code Modification을 지향하며, 웹 UI를 통해 장애 주입과 동시에 MicroTrace(관측 도구)로 실제 지연을 즉시 확인할 수 있는 '피드백 루프'를 제공한다는 점이 가장 큰 차별점입니다."

Q3. 구현하면서 가장 어려웠던 점은 무엇이었나요? (예상 답변 준비)

답변: "Go 언어로 리눅스 시스템 콜을 직접 다루며 컨테이너의 네트워킹 구조를 파악하는 것이었습니다. 특히 docker.sock을 통해 컨테이너의 Pid를 구하고, 이를 이용해 커널 레벨의 netlink 메시지를 보내 규칙을 주입하는 과정에서 권한 이슈와 인터페이스 매핑 문제를 해결하며 커널 네트워킹에 대한 깊은 이해를 얻었습니다."