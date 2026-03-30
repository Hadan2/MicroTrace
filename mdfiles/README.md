# 🔬 MicroTrace & NetSim Lab

> **커널 레벨 네트워크 프로파일링 + 로컬 카오스 엔지니어링 통합 플랫폼**

---

## 프로젝트 전체 구조

본 프로젝트는 **두 개의 독립적이면서도 유기적으로 연결되는 도구**로 구성됩니다.

| 프로젝트 | 한 줄 설명 | 역할 |
|---|---|---|
| **MicroTrace** | eBPF 기반 실시간 네트워크 프로파일러 | 장애를 **관측**한다 |
| **NetSim Lab** | Docker 컨테이너 대상 네트워크 장애 주입 도구 | 장애를 **재현**한다 |

두 도구를 결합하면 **"장애 주입 → 실시간 관측 → 원인 분석"**이라는 완전한 피드백 루프가 완성됩니다.

```
┌─────────────────────────────────────────────────┐
│              통합 운영 시나리오                    │
│                                                   │
│   NetSim Lab          MicroTrace                  │
│   (장애 주입)    →    (실시간 관측)               │
│       │                    │                      │
│       └────── 피드백 ──────┘                      │
│              루프 완성                             │
└─────────────────────────────────────────────────┘
```

---

## 타겟 페르소나

> **스타트업 3~10인 백엔드 팀.** MSA 전환 초기 단계로, Datadog/WhaTap 비용이 부담되어 무료 대안을 모색 중.
> 간헐적 API 타임아웃이 발생하지만 기존 APM의 1분 평균 데이터로는 원인을 찾지 못하고 있는 상황.
> 로컬 개발 환경에서 네트워크 예외 상황을 재현할 도구도 마땅치 않아, retry/timeout 로직의 신뢰성을 검증하지 못하고 있음.

---

## 문서 구조

| 문서 | 내용 |
|---|---|
| [microtrace.md](./microtrace.md) | MicroTrace 상세 기획서 |
| [netsim.md](./netsim.md) | NetSim Lab 상세 기획서 |
| [integration.md](./integration.md) | 통합/독립 운영 시나리오 |
| [interview-qa.md](./interview-qa.md) | 면접 대비 Q&A |

---

## 기술 스택 요약

| 계층 | MicroTrace | NetSim Lab |
|---|---|---|
| 커널/시스템 | C, eBPF (libbpf), sock_ops, kprobe, uprobe | tc/netem, nsenter, netlink |
| 백엔드 | Go (Goroutine, Channel, WebSocket) | Go (Docker API, REST API) |
| 프론트엔드 | Wails (Go + React/TypeScript) | Web UI (React) |
| 인프라 | Docker, cgroup v2 | Docker API, Network Namespace |

확장 지표들 : 

1. Jitter (RTT 변동폭) — 가장 시급
spike를 탐지하려면 "RTT가 높다"가 아니라 **"RTT가 갑자기 튀었다"**를 알아야 합니다.

현재 srtt_us는 커널이 이미 **지수이동평균(EWMA)**으로 평활화한 값이라, 500ms spike가 발생해도 srtt에는 부드럽게 반영됩니다. 실제 spike를 잡으려면:

c

// sock_ops에서 접근 가능한 필드들
skops->srtt_us    // Smoothed RTT (평활화됨 — 현재 사용 중)
skops->mdev_us    // RTT Mean Deviation — 이게 jitter
mdev_us가 핵심입니다. 이 값이 급등하면 "네트워크가 불안정해졌다"는 직접적 신호입니다. 현재 코드에 >> 3 하나만 추가하면 됩니다.

c

// fill_event에 추가
e->jitter_us = skops->mdev_us >> 3;  // mdev도 고정소수점
2. 연결 상태 변화 (RST, FIN, Timeout) — 높은 우선순위
현재 연결이 어떻게 끝났는지 전혀 모릅니다. 실무에서는 이게 중요합니다.

상황	의미
정상 FIN	클라이언트/서버가 정상 종료
RST 수신	상대방이 연결을 강제 끊음 — 서버 에러, 방화벽 차단
Timeout	응답 없음 — 서비스 다운, 네트워크 단절
sock_ops에서 BPF_SOCK_OPS_STATE_CB를 추가하면 됩니다:

c

case BPF_SOCK_OPS_STATE_CB: {
    // skops->args[0] = 이전 상태
    // skops->args[1] = 새로운 상태
    // TCP_CLOSE, TCP_CLOSE_WAIT 등으로 종료 원인 파악
    
    __u32 old_state = skops->args[0];
    __u32 new_state = skops->args[1];
    
    // TCP_CLOSE(7)로 전이될 때만 이벤트 발생
    if (new_state == 7) {
        struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (!e) return 1;
        fill_event(e, skops, EVENT_TYPE_CLOSE, 0);
        e->old_state = old_state;  // 어디서 끊겼는지
        bpf_ringbuf_submit(e, 0);
    }
    break;
}
이걸 추가하면 "이 서비스 연결이 RST로 끊기는 비율이 15%" 같은 진단이 가능해집니다.

3. Congestion Window (cwnd) — 중간 우선순위
네트워크가 느린 원인이 실제 네트워크 지연인지, TCP 혼잡 제어가 속도를 줄인 건지 구분하려면 필요합니다.

c

// RTT_CB 이벤트에서 함께 수집
skops->snd_cwnd    // 송신 혼잡 윈도우 (패킷 수)
cwnd가 급격히 줄어들면 → 패킷 유실 발생 → TCP가 속도를 줄인 것
cwnd는 정상인데 RTT만 높으면 → 순수 네트워크 지연

이 구분이 있어야 **"왜 느린가"**에 답할 수 있습니다.

4. 바이트 카운터 (Throughput) — 중간 우선순위
연결별로 얼마나 데이터를 주고받았는지 알아야 "이 연결이 중요한 연결인지" 판단할 수 있습니다.

c

// STATE_CB (연결 종료 시점)에서 수집
skops->bytes_sent
skops->bytes_received
연결 종료 시 한 번만 기록하면 되므로 오버헤드도 거의 없습니다.

추가하면 좋지만 나중이어도 되는 지표
지표	접근 방법	우선순위	이유
SYN Retransmission	BPF_SOCK_OPS_TCP_CONNECT_CB 시점 추적	낮음	연결 자체가 안 되는 경우에만 유의미
Receive Window	skops->rcv_wnd	낮음	수신 측 버퍼 상태. cwnd보다 원인 분석 기여도 낮음
Delivery Rate	skops->rate_delivered	낮음	Phase 3에서 상세 분석 시 추가
수정된 struct event 제안
현재와 추가 지표를 모두 반영하면:

c

// tcp_trace_common.h

#define EVENT_TYPE_CONNECT     1
#define EVENT_TYPE_RTT         2
#define EVENT_TYPE_RETRANSMIT  3
#define EVENT_TYPE_CLOSE       4  // 추가

struct event {
    __u8  type;
    __u32 pid;           // → local_port로 rename 권장
    __u32 daddr;
    __u16 dport;
    char  comm[16];
    
    // 기존
    __u64 latency_us;    // srtt_us >> 3
    
    // 추가 (Phase 2)
    __u64 timestamp_ns;  // bpf_ktime_get_ns()
    __u64 jitter_us;     // mdev_us >> 3
    __u32 snd_cwnd;      // congestion window
    __u32 total_retrans; // 누적 재전송 횟수
    
    // CLOSE 이벤트용
    __u32 old_state;     // 이전 TCP 상태
    __u64 bytes_sent;    // 연결 종료 시
    __u64 bytes_received;
};
그리고 fill_event()를 확장합니다:

c

static __always_inline void fill_event(struct event *e, struct bpf_sock_ops *skops,
                                       __u8 type, __u64 latency_us)
{
    e->type          = type;
    e->pid           = skops->local_port;
    e->daddr         = skops->remote_ip4;
    e->dport         = bpf_ntohs(skops->remote_port >> 16);
    e->latency_us    = latency_us;
    e->timestamp_ns  = bpf_ktime_get_ns();
    e->jitter_us     = skops->mdev_us >> 3;
    e->snd_cwnd      = skops->snd_cwnd;
    e->total_retrans = skops->total_retrans;
    __builtin_memset(e->comm, 0, sizeof(e->comm));
}