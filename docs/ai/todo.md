# MicroTrace TODO

다음에 할 작업을 여기에 기록한다.
완료된 항목은 GitHub Issue close로 관리한다. 이 파일은 "지금 하고 있는 작업 하나"만 담는다.

---

## 지금 하고 있는 작업

**Issue #9: agent↔collector 직렬화 JSON → Protobuf(nanopb) 전환 + 부하 측정**

### 왜
agent(C) → collector(Go) 구간(②번, 같은 서버·파이프)이 raw 이벤트를 JSON 텍스트로
직렬화 → 재파싱하는 구조라, 부하가 커지면 collector의 json.Unmarshal이 병목이 된다
(baseline 측정 확인: agent 단독 145만/s인데 파이프라인은 43만/s로 3.5배 감속).
JSON을 Protobuf 바이너리로 바꿔 파싱 비용을 줄이고, 전후를 측정으로 비교한다.

### 아키텍처 결정 (2026-07-07)
- **gRPC는 이 이슈 범위 아님 → #11(EC2)로.** gRPC가 푸는 문제("서버가 나뉘어도 통신")는
  서버를 나눌 때만 생긴다. 지금은 같은 서버·파이프라 gRPC 불필요.
- agent(C)는 **초경량 유지가 원칙**(eBPF 수집만, 커널에 붙어 24시간 도는 민감 부분).
  무거운 gRPC C++ 라이브러리(수십 MB)를 agent에 넣지 않는다.
- 직렬화 포맷은 **nanopb**(초경량 C protobuf, 수십 KB) 선택. raw 구조체 대비:
  endian/레이아웃 안전 + 필드 추가 하위호환. #11에서 collector 간 gRPC도 protobuf라
  같은 .proto를 공유해 포맷이 통일된다(raw로 갔다 다시 바꾸는 이중 작업 방지).
- 현업 구조(참고): agent(C, 경량) ──파이프──▶ collector(Go)가 gRPC 담당.
  EC2에선 collector를 A용(간소화+전송)/B용(중앙)으로 나눠 Go↔Go gRPC 통신.

### 구현 순서
1. **[측정 준비]** agent 벤치 모드 (MICROTRACE_BENCH_COUNT) ✅
2. **[측정 1]** JSON baseline ✅ (~445K events/s)
3. **[전환]** nanopb 도입 ✅
   - event.proto + event.options(문자열 고정 char[N]) 정의
   - agent(C): output_event_pb(length-prefixed nanopb), MICROTRACE_WIRE=pb로 선택
   - collector(Go): reader.go readProtobuf, model/pb 생성 코드
4. **[측정 2]** 재측정 ✅ (Protobuf ~984K events/s, JSON 대비 2.2배)
5. **[문서]** analysis/grpc-bench.md 비교표 ✅ + edges.md 필드전파 갱신 ✅

### 완료 상태
✅ Protobuf 전환 후 stats/hub/store 변경 없이 spike 감지 동작(verify-resolver.sh
   MICROTRACE_WIRE=pb 통과). JSON 하위호환 유지. 처리량 2.2배·와이어 크기 1/3.
→ **Issue #9 완료. 다음은 #11(EC2)에서 이 protobuf를 gRPC로 서버 간 전송.**

---

## 다음 작업 순서

1. ~~과거 데이터 조회 API + 프론트 연동~~ ✅ (GitHub #6 closed)
2. ~~[버그] LatencyChart 전면 재작업~~ ✅ uPlot 재작업 (줌/팬 경계 붕괴 수정, Live 줌 유지)
3. ~~StaticResolver 구현 + 로컬 검증 파이프라인~~ ✅ (verify-resolver.sh로 실제 동작 검증 완료)
4. **Issue #9** agent↔collector Protobuf+gRPC 전환 + 부하 측정 ← 지금
5. **Issue #11** EC2 멀티호스트 배포 + wrk NFR 실측 (#9 전환 후, gRPC로 서버 간 통신)
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
