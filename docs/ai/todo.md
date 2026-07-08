# MicroTrace TODO

다음에 할 작업을 여기에 기록한다.
완료된 항목은 GitHub Issue close로 관리한다. 이 파일은 "지금 하고 있는 작업 하나"만 담는다.

---

## 지금 하고 있는 작업

**Issue #11: EC2 멀티호스트 배포 + collector↔collector gRPC 전송 + wrk NFR 실측**

### 왜
Issue #9에서 같은 서버 내부 agent(C)→collector(Go) 파이프 구간을 Protobuf로 전환해
JSON 대비 2.2배 처리량 개선을 확인했다. 이제 EC2 멀티호스트 구조로 확장해,
각 서버의 edge collector가 중앙 collector로 telemetry를 gRPC stream 전송하게 만든다.

### 아키텍처 결정
- agent(C)는 계속 **eBPF 수집만** 담당한다. gRPC는 Go collector가 담당한다.
- `MICROTRACE_MODE=local|edge|central`로 실행 역할을 나눈다.
  - `local`: 기존 단일 호스트 개발 모드(agent/resource_agent subprocess → stats/hub/store)
  - `edge`: EC2 워커 모드(agent/resource_agent subprocess → central gRPC 전송)
  - `central`: gRPC 수신 → 기존 stats/hub/store/WebSocket 파이프라인
- EC2 서비스명 조인 키는 `hosts.yaml`의 서비스명과 `resource_agent`의 `service_name`이다.
  edge에서는 `MICROTRACE_SERVICE_NAME`으로 resource 이름을 hosts.yaml과 맞춘다.

### 구현 순서
1. **[구현]** collector gRPC telemetry proto/server/client ✅
2. **[구현]** `MICROTRACE_MODE=local|edge|central` 실행 모드 ✅
3. **[구현]** `MICROTRACE_SERVICE_NAME` resource 이름 override ✅
4. **[로컬 검증]** collector 테스트/빌드 ✅
5. **[로컬 통합 검증]** central+edge 2프로세스 smoke test
6. **[EC2 검증]** StaticResolver hosts.yaml + wrk 부하 + NFR 수치 실측

### 완료 상태
🔄 코드 골격 구현 완료. 다음은 로컬 edge/central smoke test와 EC2 배포 실측.

---

## 다음 작업 순서

1. ~~과거 데이터 조회 API + 프론트 연동~~ ✅ (GitHub #6 closed)
2. ~~[버그] LatencyChart 전면 재작업~~ ✅ uPlot 재작업 (줌/팬 경계 붕괴 수정, Live 줌 유지)
3. ~~StaticResolver 구현 + 로컬 검증 파이프라인~~ ✅ (verify-resolver.sh로 실제 동작 검증 완료)
4. ~~**Issue #9** agent↔collector Protobuf 전환 + 부하 측정~~ ✅
5. **Issue #11** EC2 멀티호스트 배포 + wrk NFR 실측 ← 지금
6. **Issue #10** 다중 해상도 히스토리 저장 — sub-second 줌인 지원 (규모 커서 별도, EC2 이후)
7. README 정비 + 시연 영상 (EC2 검증 후 수치 채우고 마지막에)

> 이슈 번호 정정: 예전 todo에서 쓰던 "#6 StaticResolver / #7 README"는 GitHub 실제 이슈와
> 어긋난 로컬 번호였다. 이제 GitHub Issue #9/#10/#11로 재정렬함.

---

## NetSim 착수 시 확인할 것 (2026-07-08 기록)

MicroTrace를 일단락하고 NetSim 코드 구현을 시작할 때, `.claude/`·`.codex/` AI 워크플로우를
NetSim에도 새로 셋업해야 한다(아직 NetSim엔 `.claude/`, `.codex/` 자체가 없음 — 확인됨).
이때 **Codex 스킬은 전역 경로(`~/.codex/skills/`)를 모든 프로젝트가 공유**한다는 제약을 반드시 인지할 것
(상세 근거·해결 방식은 `AGENTS.md`의 "Codex 어댑터 규칙" 참조):
- NetSim용 update-docs류 스킬은 `update-docs`가 아니라 `netsim-update-docs`처럼 **프로젝트 접두 이름**으로 심링크할 것 (MicroTrace가 이미 `microtrace-update-docs`를 씀 — 이름 겹치면 codex에서 충돌).
- MicroTrace의 `.claude/skills/update-docs/SKILL.md`는 MicroTrace 전용 경로를 전제로 하므로 NetSim에 재사용 불가 — 새로 작성해야 한다.
