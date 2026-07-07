# Issue #9 — agent↔collector 직렬화 벤치마크

②번 구간(agent C → stdout 파이프 → collector Go 파싱)의 처리량을 JSON vs Protobuf+gRPC로
비교한다. 전환의 효과를 수치로 증명하기 위한 기록.

## 측정 방법

- **agent 벤치 모드**: `MICROTRACE_BENCH_COUNT=N ./agent/tcp_trace`
  → eBPF를 거치지 않고 가짜 `struct event` N개를 최대 속도로 출력(sudo 불필요).
  실제 커널/네트워크 변수를 배제해 직렬화+파이프+역직렬화만 순수 측정.
- **파이프라인 벤치**: `scripts/bench-pipeline.go`
  → 실제 collector가 쓰는 `agent.SubprocessProvider`를 그대로 재사용해 수신 이벤트를
  세기만 한다(stats/hub/store 배제). 전체 파이프라인 처리량을 잰다.
- 환경: 로컬 WSL2, 같은 머신 localhost (agent·collector 동일 호스트).

실행:
```bash
# agent 단독 (직렬화+write 상한)
MICROTRACE_BENCH_COUNT=1000000 ./agent/tcp_trace >/dev/null

# ②번 전체 파이프라인
cd collector && MICROTRACE_BENCH_COUNT=3000000 go run ../scripts/bench-pipeline.go -bin ../agent/tcp_trace
```

## Baseline — JSON (전환 전)

| 구간 | 처리량 | 비고 |
|---|---|---|
| agent 단독 (JSON 직렬화 + stdout write) | ~1,450,000 events/s | User 0.63s / Sys 0.09s @ 100만 개 |
| ②번 전체 파이프라인 (직렬화→파이프→파싱) | **~430,000 events/s** | 3백만 개 3회: 435K / 437K / 338K(부하 튐) |

### 관찰
- 병목은 **직렬화(C)가 아니라 역직렬화(Go `json.Unmarshal`)**.
  agent는 145만/s를 뿜을 수 있는데 파이프라인은 43만/s로 떨어짐(약 3.5배 감속).
- → Protobuf 전환의 개선 여지는 collector 측 파싱에 집중될 것으로 예상.

## Protobuf + gRPC (전환 후)

_(전환 완료 후 같은 방식으로 재측정해 채운다)_

| 구간 | 처리량 | JSON 대비 |
|---|---|---|
| ②번 전체 파이프라인 | TBD | TBD |
