# MicroTrace TODO

다음에 할 작업을 여기에 기록한다.
완료된 항목은 GitHub Issue close로 관리한다. 이 파일은 "지금 하고 있는 작업 하나"만 담는다.

---

## 지금 하고 있는 작업

**Issue #9: agent↔collector Protobuf+gRPC 전환 + 부하 측정**

### 왜
agent(C) → collector(Go) 구간이 raw 이벤트를 JSON 텍스트로 직렬화 → stdout 파이프 →
재파싱하는 구조라, 부하가 커지면 문자열 변환 비용이 latency 측정 오버헤드에 섞인다.
또 EC2 멀티호스트로 가면 서버 간 통신 수단이 필요하다. 둘을 Protobuf+gRPC로 함께 해결한다.
전환 전후를 **측정으로 비교**해 개선을 수치로 증명한다.

### 구현 순서 (측정으로 증명)
1. **[측정 준비]** agent에 부하 생성용 테스트 모드 추가 (가짜 struct event를 초당 N개 생성) ← 지금 여기
2. **[측정 1]** JSON 상태 baseline 측정 (처리량·직렬화/역직렬화 지연·CPU)
3. **[전환]** .proto 정의 + gRPC 스트리밍 구현, collector에 gRPC EventProvider 주입
4. **[측정 2]** 동일 조건(localhost) 재측정 → JSON vs Protobuf+gRPC 비교표
5. **[문서]** 측정 결과 정리

### 완료 기준
gRPC 구현체로 교체해도 stats/hub 변경 없이 spike 감지 동작. JSON vs gRPC 비교 수치 문서화.
verify-resolver.sh 검증 통과 유지.

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
