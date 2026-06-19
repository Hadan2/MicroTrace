# MicroTrace TODO

다음에 할 작업을 여기에 기록한다.
완료된 항목은 GitHub Issue close로 관리한다. 이 파일은 "지금 하고 있는 작업 하나"만 담는다.

---

## 지금 하고 있는 작업

**Issue #6: StaticResolver + EC2 배포 + wrk 부하 테스트 + NFR 수치 실측**

### 왜
로컬 Docker 환경에서만 검증된 상태다. 실제 멀티호스트(EC2) 환경에서 동작을 확인하고,
wrk 부하 테스트로 p99 latency·수집 오버헤드 등 NFR 수치를 실측해야 포트폴리오로서 완성된다.

### 구현 내용
- StaticResolver: Docker 없는 환경(EC2)에서 IP→서비스명 수동 매핑
- EC2 멀티호스트 배포 및 동작 확인
- wrk 부하 테스트 시나리오 작성 + p50/p95/p99 실측
- gRPC 전환 (EventProvider 인터페이스 교체, EC2 멀티호스트 시점에 진행)

### 완료 기준
EC2 2대 이상 환경에서 spike 감지 + 원인 표시가 동작하고, wrk 측정 NFR 수치가 문서화된다.

---

## 다음 작업 순서

1. ~~**Issue #5** 과거 데이터 조회 API + 프론트 연동~~ ✅ PR #7 merged
2. **[버그] LatencyChart 전면 재작업** ← 다음
   - uPlot 교체 후 x축 시간 포맷(오전/오후 표기), 그래프 레이아웃, 줌/패닝 등 동작이 불안정
   - 처음부터 다시 설계해서 확실히 동작하는 버전으로 교체
3. **Issue #6** StaticResolver + EC2 배포 + wrk 부하 테스트 + NFR 수치 실측
   - EC2 멀티호스트 시점에 gRPC 전환도 같이 (EventProvider 인터페이스 교체)
4. **Issue #7** README 정비 + 시연 영상 (EC2 검증 후 수치 채우고 마지막에)
