# Latency 원인 판별 — 핵심 개념

> cause_kind 구현을 위해 조사한 내용. "왜 이 지표를 쓰는가"의 근거를 담는다.

---

## 1. CPU Throttling이란?

### 뭔지

컨테이너에 CPU 한도(limit)가 설정되어 있을 때, 그 한도를 초과하면 Linux 커널이 컨테이너를 강제로 **일시 정지**시키는 것.

### 왜 발생하는가

Linux는 **CFS(Completely Fair Scheduler)** 라는 CPU 스케줄러를 쓴다.
cgroup 설정에서 `cpu.max` 파일로 쿼터를 지정한다.

```
cpu.max 파일 내용 예시:
50000 100000
 ↑       ↑
쿼터    주기(period)
(50ms)  (100ms)

→ 컨테이너는 100ms마다 최대 50ms만 CPU를 쓸 수 있다.
```

100ms 주기 중 할당된 50ms를 다 쓰면 → 나머지 50ms는 강제 정지(throttle).

### 왜 latency와 직접 연결되는가

```
요청 A가 들어옴
    │
    ▼
컨테이너가 이미 이번 100ms 주기의 쿼터를 다 씀
    │
    ▼
커널이 컨테이너 정지 → 최대 100ms 대기
    │
    ▼
요청 A 처리 재개 → 응답 지연 = latency spike
```

이것이 핵심이다. **CPU 사용률이 40%여도 throttle이 발생할 수 있다.**

```
[시간 →]  0ms          50ms         100ms
           ████████████              (정지)
           쿼터 소진!      ←→50ms 대기→
```

짧은 시간에 몰아서 CPU를 쓰는 "버스트 패턴" 서비스(웹 서버, API 서버 등)에서
평균 사용률은 낮아 보이지만 p99 latency가 폭발하는 이유다.

### 실제 수치 (업계 근거)

| 임계값 | 의미 | 출처 |
|---|---|---|
| throttle > 1% | p99에 영향 가능성 있음 | Dan Luu (danluu.com) |
| throttle > 25% | latency에 능동적으로 영향 중 | Kubernetes 실무 (kubenatives.com) |
| throttle 제거 | p99 2000ms → 30ms | Indeed Engineering 실측 |
| throttle 제거 | p99 500ms → 27ms (94.5% 감소) | Alibaba Cloud 실측 |

### 우리 코드에서 어디에 있나

```
resource_agent/main.go → readCPUStat() → cpu.stat 파일 읽기

cpu.stat 파일:
  usage_usec     100000   ← 누적 CPU 사용 시간
  nr_periods     50       ← 지금까지 100ms 주기가 몇 번 지났는가
  nr_throttled   12       ← 그 중 throttle이 발생한 횟수
  throttled_usec 800000   ← 누적 throttle 대기 시간

throttle_pct = (delta throttled_usec) / (interval_usec) × 100
```

---

## 2. PSI (Pressure Stall Information)란?

### 뭔지

**"어떤 리소스 때문에 실제로 멈춘 시간"의 비율**을 측정하는 Linux 지표.
Meta(Facebook)이 2018년 개발해서 Linux 커널에 제출했다.

### 왜 PSI가 사용률(%)보다 나은가

```
기존 지표:  메모리 사용률 75%
→ "75% 쓰는 중이니 25% 여유 있음"이라고 해석
→ 실제로 성능 영향이 있는지는 모름

PSI:        memory.pressure some = 8%
→ "지난 10초 중 8%의 시간 동안 최소 한 개의 스레드가 
   메모리 때문에 멈춰 있었다"
→ 실제 latency 영향이 발생하고 있다는 직접 증거
```

### some vs full

```
some : 최소 1개 이상의 태스크가 멈춘 시간 비율
       → "일부가 영향받는 중"

full : 모든 태스크가 동시에 멈춘 시간 비율
       → "아무것도 진행되지 않는 구간" (심각)
```

```
예시:
memory.pressure some = 5%   → 조기 경보. 성능 저하 시작
memory.pressure full = 0.5% → 긴급. OOM kill 임박
```

### 파일 위치

```
cgroup 전체:        /proc/pressure/memory
컨테이너 개별:      /sys/fs/cgroup/<경로>/memory.pressure

파일 형식:
some avg10=0.12 avg60=0.03 avg300=0.01 total=123456
full avg10=0.00 avg60=0.00 avg300=0.00 total=0

avg10  = 최근 10초 평균 (실시간 판단에 사용)
avg60  = 최근 60초 평균
avg300 = 최근 300초 평균
```

### 실제 임계값 (Meta/systemd 기준)

| 임계값 | 의미 |
|---|---|
| some > 5~10% (10초 평균) | 조기 경보. 조사 필요 |
| some > 20~30% | 사용자 체감 latency 영향 |
| full > 1% | OOM kill 임박. 즉시 조치 |
| full > 0 | 이미 심각한 상태 |

Meta는 자체 OOM 방지 도구(oomd)에서 PSI를 트리거로 사용한다.

---

## 3. memory.events — 이벤트 카운터

PSI가 "연속적 시간 측정"이라면, memory.events는 "특정 임계값을 넘은 횟수"를 세는 카운터다.

```
/sys/fs/cgroup/<경로>/memory.events

항목:
  low      N   ← 메모리가 low 한도 아래로 내려간 횟수 (가장 낮은 경고)
  high     N   ← 메모리가 high 한도를 초과한 횟수 ← 우리가 쓰는 값
  max      N   ← 메모리가 limit에 도달한 횟수 (OOM 직전)
  oom      N   ← OOM이 발생한 횟수
  oom_kill N   ← OOM kill로 프로세스가 죽은 횟수 ← 결정적 증거
```

### high 이벤트가 발생한다는 것의 의미

메모리가 `memory.high` 한도를 넘으면 → 커널이 **직접 reclaim**(메모리 회수)을 실행한다.
이 회수 작업이 **요청 처리 스레드 안에서 실행**되므로 해당 요청이 그 시간만큼 지연된다.

### oom_kill이 발생한다는 것의 의미

프로세스가 강제 종료됐다는 뜻. 연결이 끊기고 서비스가 재시작하는 시간만큼 latency spike가 발생한다.
숫자가 0이냐 1이냐가 전부인 binary 판단 기준.

---

## 4. io_wait_pct — 왜 cause 판단에 쓰지 않는가

### io_wait란

`/proc/stat` 파일에서 읽는 값. "CPU가 디스크 응답을 기다리는 시간의 비율".

### 왜 단독으로 쓰면 안 되는가

**1. 호스트 전체 기준이다**

우리가 읽는 `/proc/stat`는 컨테이너가 아닌 **서버 전체**의 io_wait다.
service_a가 아무 IO를 안 해도, 서버의 다른 컨테이너가 디스크를 많이 쓰면 io_wait_pct가 높게 나온다.
→ service_a의 latency 원인으로 쓸 수 없다.

**2. io_wait 자체가 인과관계가 아닐 수 있다**

```
io_wait 높음 ← 배치 잡이 디스크 쓰는 중 → HTTP 처리와 무관 → latency 무관
io_wait 높음 ← DB 쿼리 대기 중           → HTTP 핸들러 대기 → latency 직결
```

같은 io_wait 수치여도 원인이 완전히 다를 수 있다. 신호(canary)이지 원인이 아니다.

---

## 5. CPU 사용률(cpu_pct)만으로 원인 판단이 어려운 이유

### 공통 원인(common cause) 문제

```
트래픽 급증
    ├── CPU 사용률 증가   ┐
    │                    ├── 둘 다 트래픽의 결과물
    └── latency 증가     ┘

→ CPU가 원인처럼 보이지만, 실제로는 둘 다 트래픽 급증의 결과다.
```

### cpu_pct를 보조적으로만 쓰는 이유

cpu_throttle_pct가 같이 높을 때만 "CPU가 원인"이라고 볼 수 있다.
- throttle 높음 + 사용률 높음 → CPU 한도가 부족한 버스트 패턴
- throttle 낮음 + 사용률 높음 → CPU는 충분히 공급되는 중, 원인이 아닐 수 있음

---

## 6. 결론: 신호 품질 순위

```
높음 ──────────────────────────── 낮음
  │                                  │
  ▼                                  ▼
oom_kill     cpu_throttle    mem_pressure    cpu_pct    io_wait
  │               │               │
결정적 증거    직접 원인       실제 stall      간접        호스트 전체
(binary)     (컨테이너 정지)  (시간 측정)    신호 약함   기준이라 부적합
```

→ 이 순서가 MicroTrace cause_kind 판별의 우선순위 근거다.

---

## 참고 출처

- [The container throttling problem — Dan Luu](https://danluu.com/cgroup-throttling/)
- [Unthrottled: Fixing CPU Limits — Indeed Engineering](https://engineering.indeedblog.com/blog/2019/12/unthrottled-fixing-cpu-limits-in-the-cloud/)
- [PSI 개요 — Facebook Microsites](https://facebookmicrosites.github.io/psi/docs/overview)
- [PSI — Linux Kernel Documentation](https://docs.kernel.org/accounting/psi.html)
- [Open-sourcing oomd — Engineering at Meta](https://engineering.fb.com/2018/07/19/production-engineering/oomd/)
- [Kill CPU Throttling — Alibaba Cloud](https://www.alibabacloud.com/blog/kill-the-annoying-cpu-throttling-and-make-containers-run-faster_598738)
- [CFS Bandwidth Control — Linux Kernel](https://docs.kernel.org/scheduler/sched-bwc.html)
