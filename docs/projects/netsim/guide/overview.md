# NetSim Lab — 개요 (AI guide)

> 역할: **설명(Guide) · AI용 축약본**. 짝 프로젝트 NetSim Lab의 목적·동작·MicroTrace 연동을 자연어로 압축.
> 상세 기획서(사람용 전문)는 [`../reference/netsim.md`](../reference/netsim.md), 통합 시나리오 전문은 [`../reference/integration.md`](../reference/integration.md).

## 한 줄 정의

로컬에서 클릭 몇 번으로 특정 Docker 컨테이너에 네트워크 장애(지연·손실·지터)를 주입·해제하는 **경량 Chaos Engineering 도구**. "네트워크 문제는 추측이 아니라 재현으로 해결한다."

## 포지션

- Gremlin/Chaos Mesh처럼 무겁거나 k8s/SaaS에 종속되지 않고, `docker run` 한 줄로 뜨는 **개발자 친화 로컬 도구**.
- `tc/netem` CLI는 강력하지만 숙련도·컨테이너 단위 제어가 번거롭다 → **웹 UI + REST API**로 감싼다.
- MicroTrace의 **짝**: NetSim이 장애를 주입(원인), MicroTrace가 감지·분석(결과) → 완전한 실험-분석 루프.

## 어떻게 동작하나 (개념)

**Control Server(Go) → Network Engine → 타겟 컨테이너**:
- Docker API로 타겟 컨테이너의 PID/veth 식별
- `nsenter`로 타겟의 Network Namespace 진입 (docker exec과 달리 컨테이너 내부에 tc 바이너리 불필요 — 호스트 tc 사용)
- `tc/netem`으로 커널 레벨 Traffic Shaping 적용/해제 (iptables는 허용·차단용이라 부적합)
- 종료 시 signal handler로 tc 규칙 자동 롤백(좀비 규칙 방지)

특징: Zero-Code(앱 수정 없음), Port-Specific 선별 제어, 시나리오 프리셋(3G/Cross-Region 등), REST API로 CI/CD 연동.

## MicroTrace 통합 (2가지 운영 모드)

- **단독 모드**: NetSim 웹 UI에서 컨테이너 선택 → 슬라이더로 장애 주입/해제. 로컬 타임아웃·재시도 로직 검증용.
- **통합 모드**: MicroTrace 토폴로지 맵에서 노드/엣지 클릭 → NetSim 제어판 호출 → 장애 주입과 동시에 ms 단위 차트로 영향을 실시간 대조. 부하 테스트·운영 장애 재현·Root Cause 분석용.

공유 엔진(Docker API + Namespace Traversal + Traffic Shaping)은 두 모드 공통.

## 현재 상태

기획 단계(별도 레포 `NetSim/`). MicroTrace Phase 4 이후 통합 진행 예정. 상세 마일스톤은 [`../reference/netsim.md`](../reference/netsim.md) §8.
