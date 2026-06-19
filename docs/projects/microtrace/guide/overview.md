# MicroTrace — 개요 (AI guide)

> 역할: **설명(Guide) · AI용 축약본**. 프로젝트의 목적·포지션·동작 원리를 자연어로 압축.
> 상세 기획서(사람용 PRD 전문)는 [`../reference/microtrace.md`](../reference/microtrace.md), 코드 위치는 [`../code/microtrace.code.md`](../code/microtrace.code.md), 진행 현황은 [`../analysis/progress.md`](../analysis/progress.md).

## 한 줄 정의

latency spike가 났을 때 **원인이 네트워크인지 / CPU인지 / 메모리인지 / 외부 의존성인지**를 가장 빠르게 좁혀주는 eBPF 기반 root-cause 진단 도구.

## 포지션 (중요)

- Datadog 같은 **상시 전수 모니터링의 대체재가 아니다.** spike가 났을 때 원인을 가르는 **진단 도구**다.
- 주인공은 **latency**. 서버 리소스(CPU throttle / memory pressure / OOM)는 cause 판별을 위한 **증거로만** 수집한다 — Datadog식 전수 수집이 아니라 cause에 직접 필요한 지표만.
- 1차 타겟: **k8s 없이 Docker/EC2 몇 대로 운영하는 소규모 MSA 팀** (Datadog은 비싸고 Pixie/Cilium은 k8s 전제).

## 왜 필요한가

1분 평균 APM에서는 p99가 '정상'으로 보여도, 100ms 단위로는 500ms spike가 간헐 발생해 타임아웃·재시도를 유발한다("모니터링은 정상인데 왜 에러?"). MicroTrace는 이 찰나의 spike와 **그 시점의 시스템 상태**를 함께 본다.

## 어떻게 동작하나 (개념)

**3계층**: eBPF Agent(수집) → Go Collector(집계·상관분석) → React 대시보드(시각화). In-memory 실시간 + SQLite 7일 보존(외부 DB 없음).

핵심 메커니즘:
- **sock_ops 기반 latency 측정**: kprobe는 새 TCP 연결만 잡고 Keep-Alive 재사용 구간을 놓친다. sock_ops는 소켓 생명주기 전체를 추적해 **Keep-Alive 연결 위의 요청 단위 RTT**까지 측정. 코드 수정/SDK 불필요.
- **spike 감지**: 안정 구간에서만 갱신되는 기준선(stableP99)의 3배를 넘으면 spike (spike 중에 기준선이 안 올라가게 해 연쇄 오탐 방지).
- **cause 자동 판별**: spike 시점 목적지 서비스의 리소스를 보고 `external → memory(OOM) → cpu(throttle) → memory(pressure) → network` 순으로 원인을 분류.

추적 전략은 단계적: ①상시 저비용 감시(sock_ops + cgroup) → ②spike 시 kprobe 정밀 추적(예정) → ③uprobe 앱 레벨(장기).

## 현재 상태

Phase 1~3 완료(sock_ops 전환, 리소스 파이프라인, cause 판별, 대시보드, SQLite, history API). Phase 4(EC2 멀티호스트 + wrk NFR 실측 + StaticResolver/gRPC) 진행 예정. 자세한 진행/다음 작업은 [`../analysis/progress.md`](../analysis/progress.md)와 [`../../../ai/todo.md`](../../../ai/todo.md).

## 관련

- 짝 프로젝트 NetSim Lab(장애 주입)과 통합 예정 → [`../../netsim/guide/overview.md`](../../netsim/guide/overview.md)
- 면접/발표 Q&A → [`../reference/interview-qa.md`](../reference/interview-qa.md)
