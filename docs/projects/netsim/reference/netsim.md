# 🚀 NetSim Lab — Developer-Centric Network Simulation Platform

> 역할: **레퍼런스(사람용 기획서 전문)**. AI는 보통 축약본 [`../guide/overview.md`](../guide/overview.md)만 읽으면 된다. 이 문서는 전체 맥락·마일스톤이 필요할 때 참조한다.

> **"네트워크 문제는 '추측'이 아니라 '재현(Replication)'으로 해결한다."**
> 무거운 엔터프라이즈 도구 대신, 로컬 환경에서 클릭 몇 번으로 복잡한 네트워크 장애를 주입하고 관측하는 **가벼운(Lightweight) Chaos Engineering 도구**

---

## 1. 프로젝트 개요 (Overview)

현대 분산 시스템 및 MSA(Microservices Architecture) 환경에서 네트워크 지연과 패킷 손실은 서비스 장애의 핵심 원인입니다. 하지만 개발자가 로컬 개발 단계에서 이러한 예외 상황을 정확하게 재현하기는 매우 까다롭습니다.

기존 방식(mock, tc CLI 등)으로는 실제 네트워크 문제를 정확히 재현하기 어렵고, 실험 결과를 반복적으로 검증하기 힘들다는 문제가 있습니다.

기존 상용 도구(예: Gremlin, Chaos Mesh)는 매우 강력하지만, SaaS에 연동되거나 Kubernetes 생태계에 강하게 종속되어 있어 로컬에서 가볍게 사용하기에는 진입 장벽이 높습니다. 반면 Linux 기본 도구(`tc/netem`)는 CLI 숙련도를 요구하며 컨테이너 단위의 제어가 번거롭습니다.

**NetSim Lab**은 이러한 페인 포인트를 해결하기 위해 설계된 **"로컬 개발자 친화적 네트워크 시뮬레이션 플랫폼"**입니다. 복잡한 설정 없이 `docker run` 한 줄로 실행되며, 직관적인 UI를 통해 타겟 컨테이너의 네트워크 상태를 자유롭게 조작하고 실험할 수 있습니다.

---

## 2. 핵심 목표 (Core Goals)

1. **직관적인 L4 제어:** UI 슬라이더를 통해 Latency(지연), Packet Loss(손실), Jitter(지터) 등을 실시간으로 조절
2. **컨테이너 단위 타겟팅:** 전체 호스트가 아닌 특정 Docker 컨테이너 및 서비스 단위로 격리된 네트워크 장애 주입
3. **시나리오 기반 실험:** '3G 모바일 환경', 'IDC 간 통신 지연' 등 사전 정의된 시나리오를 통한 반복 가능한 실험 환경 제공
4. **API-First 설계:** REST API를 통해 CI/CD 파이프라인에서 자동화된 네트워크 장애 테스트 지원
5. **관측(Observability) 도구 연동:** 장애 주입(NetSim Lab)과 장애 감지(MicroTrace 등)를 연계하여 완전한 실험-분석 루프 완성

---

## 3. 핵심 차별성 (Differentiation)

NetSim Lab은 거대한 카오스 엔지니어링 플랫폼이 아닌, **'주머니 속의 가벼운 디버깅 도구'**를 지향합니다.

### vs. 기존 도구 비교

| | Gremlin | Pumba | Toxiproxy | NetSim Lab |
|---|---|---|---|---|
| 방식 | 에이전트 기반 | CLI (tc/netem) | L4/L7 프록시 | tc/netem + 웹 UI |
| 코드 수정 | 불필요 | 불필요 | 엔드포인트 수정 필요 | **불필요** |
| 인터페이스 | 웹 UI (SaaS) | CLI 전용 | CLI / API | **웹 UI + REST API** |
| 배포 환경 | K8s / 클라우드 | Docker | 독립 실행 | **Docker (`docker run` 한 줄)** |
| 실시간 관측 | 별도 도구 필요 | 없음 | 없음 | **MicroTrace 연동** |
| 자동화 | API 지원 | 스크립트 | API 지원 | **REST API (CI/CD 연동)** |
| 비용 | 유료 | 무료 | 무료 | **무료** |

### 핵심 차별 포인트

* **Zero-Code Modification:** 대상 애플리케이션의 코드 수정이나 무거운 에이전트 설치 없이 인프라 레벨에서 즉각 개입
* **One-Shot Execution:** 사용자가 실험을 원할 때만 Host의 `veth` 또는 컨테이너 Network Namespace에 개입하는 경량화 구조
* **API-First:** CI/CD 파이프라인에서 `curl` 한 줄로 장애 주입 가능. 자동화 테스트에 네트워크 장애 시나리오 포함 가능
* **자체 검증 루프:** MicroTrace 연동으로 장애 주입과 동시에 ms 단위 실시간 관측 가능

---

## 4. 시스템 아키텍처 (Architecture)

```
┌──────────────────────────────────────────────────┐
│                    사용자 접점                      │
│                                                    │
│   [ Web UI ]              [ REST API ]            │
│   (슬라이더, 컨테이너 목록)   (CI/CD, curl 연동)    │
└──────────────┬───────────────┬────────────────────┘
               │               │
               ▼               ▼
        ┌─────────────────────────────┐
        │   Control Server (Go)       │
        │   - Docker API 연동          │
        │   - 컨테이너 PID/veth 식별   │
        │   - 시나리오 관리             │
        └──────────┬──────────────────┘
                   │
                   ▼
        ┌─────────────────────────────┐
        │   Network Engine            │
        │   - nsenter (Namespace 진입) │
        │   - tc / netem (Traffic     │
        │     Shaping 적용/해제)       │
        │   - netlink (Go 바인딩)      │
        └──────────┬──────────────────┘
                   │
                   ▼
        ┌─────────────────────────────┐
        │   Target Docker Container   │
        │   (격리된 Network Namespace) │
        └─────────────────────────────┘
```

### 기술 선택 근거

| 선택 | 이유 |
|---|---|
| **Go** | Docker SDK 공식 지원. 단일 바이너리 배포로 설치 간소화. MicroTrace Collector와 동일 언어로 통합 용이 |
| **tc/netem (iptables 아닌 이유)** | iptables는 패킷 허용/차단에 최적화. latency/jitter/loss 같은 **Traffic Shaping**은 tc/netem이 커널 레벨에서 직접 지원 |
| **nsenter (docker exec 아닌 이유)** | docker exec은 컨테이너 내부에 tc 바이너리가 필요. nsenter는 호스트의 tc 바이너리로 타겟 네임스페이스에 직접 개입 가능 |
| **REST API** | WebSocket보다 CI/CD 연동이 간편. 장애 주입/해제는 요청-응답 패턴이 적합 |

---

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
* **Custom Scenarios:** 사용자가 직접 정의한 복합 장애 시나리오 저장 및 공유 (JSON 기반)
* **Chaos Schedule:** "30초 정상 → 10초 장애 → 30초 정상" 같은 시간 기반 시나리오 자동 실행

### 5.4 API-First 자동화
```bash
# CI/CD 파이프라인에서 장애 주입
curl -X POST http://localhost:8080/api/inject \
  -d '{"container": "service-b", "latency": "200ms", "loss": "5%"}'

# 테스트 완료 후 해제
curl -X POST http://localhost:8080/api/rollback \
  -d '{"container": "service-b"}'
```

---

## 6. 기술적 핵심 포인트 (Technical Highlights)

1. **Low-level Network Control:** 단순 Mock이 아닌 `tc/netem` 기반의 실제 커널 레벨 패킷 제어 구현
2. **Network Namespace Traversal:** Go 언어의 `netlink` 라이브러리와 `nsenter` 메커니즘을 이용한 컨테이너 격리망 진입 기술
3. **Real-time Feedback Loop:** 설정 적용 즉시 결과(RTT, 에러율)를 시각화하여 실험의 신뢰성 확보
4. **Graceful Rollback:** 프로세스 종료 시에도 주입된 tc 규칙을 자동 해제하여 좀비 규칙 방지

---

## 7. 비기능 요구사항 (Non-Functional Requirements)

| 항목 | 목표치 |
|---|---|
| 장애 주입 → 적용 지연 | < 500ms |
| 컨테이너 격리 정확도 | 타겟 외 컨테이너 영향 **0%** |
| 동시 제어 가능 컨테이너 수 | 20+ |
| API 응답 시간 | < 200ms |
| 롤백 완료 시간 | < 1초 |

---

## 8. 개발 마일스톤 (Milestones)

### Phase 0: 기술 검증 (PoC) — 예상: 1주
* Go 언어로 특정 Docker 컨테이너의 Network Namespace에 진입하여 `tc` 명령어 주입 및 해제 성공 여부 검증
* 타겟 외 컨테이너 무영향 확인

### Phase 1: Minimal MVP (단일 제어) — 예상: 2~3주
* 컨테이너 목록 조회 REST API 구축
* 기본적인 웹 제어 UI (컨테이너 목록 + 슬라이더)
* Latency, Loss 단일 항목 적용 및 해제 기능 완료
* REST API로 CI/CD 연동 가능한 엔드포인트 제공

### Phase 2: 시나리오 및 고도화 — 예상: 3~4주
* 시나리오 저장/불러오기 기능 (JSON 기반)
* 복합 장애(Latency + Loss + Jitter) 동시 지원
* Chaos Schedule (시간 기반 자동 시나리오 실행)
* 서비스 간(Service-to-Service) 특정 통신 경로 타겟팅 기능
* Port-Specific Rules 구현

### Phase 3: 관측 파이프라인 연동 (MicroTrace) — 예상: 2~3주
* MicroTrace 대시보드 내 NetSim 제어판 통합
* 장애 주입 시점의 트레이싱 데이터 매핑 및 시각화 연동
* 분석 리포트(장애 상황 vs 정상 상황 비교) 생성 기능

---

## 9. 리스크 분석 및 대응 전략

| 리스크 | 영향도 | 대응 전략 |
|---|---|---|
| privileged 권한 필요 (보안 민감 환경 제약) | 중 | `NET_ADMIN` capability만으로 동작하도록 최소 권한 설계. 문서에 보안 가이드 제공 |
| tc 규칙 충돌 (기존 규칙과 중첩) | 중 | 주입 전 기존 규칙 백업, 롤백 시 원상 복구. 규칙 상태 조회 API 제공 |
| 좀비 규칙 잔존 (비정상 종료 시) | 상 | Go의 signal handler로 SIGTERM/SIGINT 시 자동 롤백. 시작 시 잔존 규칙 스캔 및 정리 |
| Docker API 버전 호환성 | 하 | Docker SDK의 API version negotiation 활용. 최소 지원 버전 명시 |

---

## 10. 성공 지표 (Success Criteria)

| 시나리오 | 성공 기준 |
|---|---|
| 타겟 컨테이너에 200ms 지연 주입 | 다른 컨테이너의 latency 변화 **0%** (격리 검증) |
| REST API로 장애 주입/해제 | 요청부터 적용까지 **< 500ms** |
| 비정상 종료 후 재시작 | 잔존 tc 규칙 **자동 정리 확인** |
| CI/CD 파이프라인 통합 테스트 | `curl` 명령어로 장애 주입 → 테스트 실행 → 자동 해제 **완전 자동화** |

---

## 11. 기대 효과 (Impact)

본 프로젝트는 단순 웹 서비스를 넘어 OSI 하위 계층(L2~L4)과 Linux 시스템 기술을 현대적 컨테이너 생태계와 결합하는 도전적인 과제입니다.

- 외부 API 지연 상황에서 retry/timeout 로직을 실제 환경 기반으로 검증 가능
- 네트워크 장애 상황을 재현하여 장애 대응 코드의 신뢰성 향상
- CI/CD 파이프라인에 네트워크 장애 테스트를 표준 프로세스로 포함 가능
- MicroTrace와 연계하여 ms 단위 latency spike를 실제로 검증 가능

향후 SaaS 형태로 확장하여 팀 단위로 시나리오를 공유하고, 개발 및 테스트 환경에서 공통적으로 사용할 수 있는 플랫폼으로 발전시키는 것을 목표로 합니다.
