// SPDX-License-Identifier: GPL-2.0
//
// tcp_trace.bpf.c - 커널 공간에서 실행되는 eBPF 프로그램
//
// 역할:
//   1. sock_ops: cgroup에 attach해서 소켓 단위로 TCP 이벤트를 감시
//   2. TCP 연결 수립 완료 시 RTT 측정, Keep-Alive 요청마다 RTT 갱신, 재전송 감지
//   3. 결과(로컬포트, IP, 포트, RTT/재전송)를 Ring Buffer로 유저 공간에 전달

#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>  // sock_ops 허용 헬퍼
#include <bpf/bpf_endian.h>   // bpf_ntohs() - 바이트 오더 변환
#include "tcp_trace_common.h" // 커널/유저 공유 타입 (struct event, EVENT_TYPE_*)

// sock_ops 프로그램 타입은 사용 가능한 헬퍼 함수가 제한됨.
// bpf_get_current_pid_tgid(), bpf_get_current_comm() 은 사용 불가.
// → pid/comm 대신 skops->local_port 로 소켓을 식별함.
//   local_port는 소켓마다 고유한 값으로, 유저 공간에서 /proc/net/tcp 를 통해
//   포트 → PID/프로세스명을 역추적할 수 있음. (향후 구현)

// ─────────────────────────────────────────────
// BPF Map: Ring Buffer - 커널→유저 공간 이벤트 전달
//
// 커널에서 발생한 이벤트를 유저 공간으로 스트리밍하는 통로.
// bpf_ringbuf_reserve() 로 공간 예약 → 데이터 채움 → bpf_ringbuf_submit() 으로 전송.
// 유저 공간은 ring_buffer__poll() 로 이벤트 도착을 감지.
// ─────────────────────────────────────────────
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

// ─────────────────────────────────────────────
// 이벤트 채우기 헬퍼
//
// CONNECT, RTT, RETRANSMIT 세 케이스가 공통으로 쓰는 필드 채우기를
// 인라인 함수로 분리. 코드 중복 제거.
// ─────────────────────────────────────────────
static __always_inline void fill_event(struct event *e, struct bpf_sock_ops *skops,
                                       __u8 type, __u64 latency_us)
{
    e->type       = type;
    // sock_ops는 pid 접근 불가 → local_port로 소켓 식별
    // local_port: 호스트 바이트 오더로 저장됨 (변환 불필요)
    e->pid        = skops->local_port;
    e->daddr      = skops->remote_ip4;
    // remote_port: (port << 16) 형태로 저장됨 (big-endian 상위 16비트)
    // >> 16 으로 포트를 하위 16비트로 내린 뒤, bpf_ntohs()로 바이트 오더 변환
    e->dport      = bpf_ntohs(skops->remote_port >> 16);
    e->latency_us = latency_us;
    __builtin_memset(e->comm, 0, sizeof(e->comm)); // comm 접근 불가
}

// ─────────────────────────────────────────────
// sock_ops 프로그램
//
// SEC("sockops"):
//   tcp_trace.c 에서 bpf_prog_attach(prog_fd, cgroup_fd, BPF_CGROUP_SOCK_OPS, 0) 로
//   특정 cgroup에 attach됨. 이후 그 cgroup 소속 소켓에서 TCP 이벤트가 발생할 때마다
//   커널이 이 함수를 직접 호출함. 어떤 이벤트인지는 skops->op 로 구분.
//
// 인자: struct bpf_sock_ops *skops
//   커널이 이벤트 발생 시 직접 채워서 넘겨주는 구조체.
//   목적지 IP(remote_ip4), 포트(remote_port), RTT(srtt_us) 등을
//   skops->필드 로 바로 읽을 수 있음.
//
// 반환값: 1 (sock_ops 프로그램의 정상 처리 완료를 의미)
// ─────────────────────────────────────────────
SEC("sockops")
int handle_sock_ops(struct bpf_sock_ops *skops)
{
    // IPv4 소켓만 처리
    // skops->family: 소켓 주소 체계 (AF_INET=2, AF_INET6=10)
    if (skops->family != 2) // AF_INET = 2
        return 1;

    switch (skops->op) {

    // ── 이벤트 1: TCP 연결 수립 완료 (Active 측) ──────────────
    //
    // BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB:
    //   connect()를 건 쪽(클라이언트)에서 3-way handshake가 끝나
    //   ESTABLISHED 상태가 된 직후 딱 한 번 호출됨.
    //   Keep-Alive로 연결이 재사용될 때는 호출되지 않음.
    case BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB: {
        // 이 소켓에서 RTT_CB를 활성화
        // 기본적으로 RTT_CB는 꺼져 있음 → 여기서 켜야 이후 요청마다 RTT_CB가 발생함
        // BPF_SOCK_OPS_RTT_CB_FLAG: "이 소켓에서 RTT 갱신 시마다 콜백 호출" 플래그
        bpf_sock_ops_cb_flags_set(skops, skops->bpf_sock_ops_cb_flags | BPF_SOCK_OPS_RTT_CB_FLAG);

        // skops->srtt_us: 커널이 handshake로 측정한 Smoothed RTT
        //   커널 내부에서 마이크로초 × 8 (고정소수점) 로 저장됨
        //   실제 마이크로초 = srtt_us >> 3 (오른쪽 3비트 shift = ÷8)
        __u64 rtt_us = skops->srtt_us >> 3;

        struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (!e)
            return 1;

        fill_event(e, skops, EVENT_TYPE_CONNECT, rtt_us);
        bpf_ringbuf_submit(e, 0);
        break;
    }

    // ── 이벤트 2: RTT 갱신 ────────────────────────────────────
    //
    // BPF_SOCK_OPS_RTT_CB:
    //   Keep-Alive 연결 위에서 ACK가 돌아올 때마다 커널이 RTT를 재계산하고
    //   이 콜백을 호출함. 즉 HTTP 요청 하나가 완료될 때마다 발생.
    //
    //   이 이벤트 덕분에 Keep-Alive 연결에서도 요청 단위 RTT 추적이 가능함.
    //   단, 기본적으로 비활성화 상태 → 소켓에 명시적으로 활성화해야 함.
    //
    //   활성화 방법:
    //   BPF_SOCK_OPS_ACTIVE_ESTABLISHED_CB 시점에 아래 플래그를 세팅:
    //     bpf_sock_ops_cb_flags_set(skops, BPF_SOCK_OPS_RTT_CB_FLAG)
    //   이렇게 하면 이후 이 소켓에서 RTT_CB 가 발생하기 시작함.
    case BPF_SOCK_OPS_RTT_CB: {
        __u64 rtt_us = skops->srtt_us >> 3;

        struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (!e)
            return 1;

        // EVENT_TYPE_RTT: Keep-Alive 연결 위의 요청 단위 RTT
        fill_event(e, skops, EVENT_TYPE_RTT, rtt_us);
        bpf_ringbuf_submit(e, 0);
        break;
    }

    // ── 이벤트 3: TCP 재전송 발생 ──────────────────────────────
    //
    // BPF_SOCK_OPS_RETRANS_CB:
    //   attach된 소켓에서 패킷 재전송이 발생할 때마다 호출됨.
    case BPF_SOCK_OPS_RETRANS_CB: {
        struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (!e)
            return 1;

        fill_event(e, skops, EVENT_TYPE_RETRANSMIT, 0);
        bpf_ringbuf_submit(e, 0);
        break;
    }

    // 그 외 이벤트 (연결 종료, Passive 연결, 타임아웃 등)는 무시
    default:
        break;
    }

    return 1;
}

// eBPF 프로그램의 라이선스 선언 (필수)
char LICENSE[] SEC("license") = "GPL";
