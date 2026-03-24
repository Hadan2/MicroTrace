// SPDX-License-Identifier: GPL-2.0
//
// tcp_trace.bpf.c - 커널 공간에서 실행되는 eBPF 프로그램
//
// 역할:
//   1. tcp_connect() 호출 시 → 타임스탬프를 Hash Map에 저장
//   2. tcp_rcv_state_process() 호출 시 → 타임스탬프 꺼내서 latency 계산
//   3. tcp_retransmit_skb tracepoint → 재전송 이벤트 감지
//   4. 결과(PID, IP, 포트, latency/재전송)를 Ring Buffer로 유저 공간에 전달

#include <linux/bpf.h>
#include <asm/ptrace.h>            // struct pt_regs 정의 (BPF_KPROBE 매크로에 필요)
#include <bpf/bpf_helpers.h>       // bpf_get_current_pid_tgid(), bpf_ktime_get_ns() 등
#include <bpf/bpf_tracing.h>       // BPF_KPROBE 매크로
#include <bpf/bpf_core_read.h>     // BPF_CORE_READ - CO-RE 방식으로 구조체 필드 읽기
#include <bpf/bpf_endian.h>        // bpf_ntohs() - 바이트 오더 변환

// ─────────────────────────────────────────────
// 커널 구조체 정의 (CO-RE용 최소 선언)
// ─────────────────────────────────────────────

struct sock_common {
    union {
        struct {
            __be32 skc_daddr;
            __be32 skc_rcv_saddr;
        };
    };
    __be16 skc_dport;
    __u16  skc_num;
    __u16  skc_family;
    volatile unsigned char skc_state;   // TCP 상태 (TCP_SYN_SENT=2 등)
} __attribute__((preserve_access_index));

struct sock {
    struct sock_common __sk_common;
} __attribute__((preserve_access_index));

// ─────────────────────────────────────────────
// 이벤트 타입 구분
// ─────────────────────────────────────────────
#define EVENT_TYPE_CONNECT     1   // TCP 연결 latency 이벤트
#define EVENT_TYPE_RETRANSMIT  2   // TCP 재전송 이벤트

// ─────────────────────────────────────────────
// 이벤트 구조체 - Ring Buffer로 전달할 데이터 형식
// ─────────────────────────────────────────────
struct event {
    __u8  type;             // 이벤트 타입 (EVENT_TYPE_CONNECT or EVENT_TYPE_RETRANSMIT)
    __u32 pid;              // 프로세스 ID
    __u32 daddr;            // 목적지 IP
    __u16 dport;            // 목적지 포트
    __u64 latency_us;       // TCP 연결 latency (마이크로초, CONNECT 이벤트에서만 유효)
    char  comm[16];         // 프로그램 이름
};

// ─────────────────────────────────────────────
// BPF Map 1: Ring Buffer - 커널→유저 공간 이벤트 전달
// ─────────────────────────────────────────────
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

// ─────────────────────────────────────────────
// BPF Map 3: Array Map - tracepoint offset 저장
//
// 유저 공간(tcp_trace.c)이 format 파일을 파싱해서
// 런타임에 offset을 이 Map에 저장하면,
// eBPF 프로그램이 Map에서 읽어서 사용함.
//
// Key(index): 의미
//   0 → family offset
//   1 → dport  offset
//   2 → daddr  offset
// ─────────────────────────────────────────────
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 3);
    __type(key,   __u32);
    __type(value, __u32);
} retransmit_offsets SEC(".maps");

// ─────────────────────────────────────────────
// connect_info: Hash Map 에 저장할 연결 시작 정보
//
// tcp_connect 시점(curl 컨텍스트)에서 PID/comm/ts 를 같이 저장.
// tcp_rcv_state_process 는 인터럽트 컨텍스트라 PID를 읽을 수 없으므로
// 여기서 미리 저장해둔 값을 꺼내 씀.
// ─────────────────────────────────────────────
struct connect_info {
    __u64 ts;       // 연결 시작 타임스탬프 (나노초)
    __u32 pid;      // tcp_connect 시점의 PID
    char  comm[16]; // tcp_connect 시점의 프로그램 이름
};

// ─────────────────────────────────────────────
// BPF Map 2: Hash Map - 두 kprobe 사이 연결 정보 임시 저장
//
// Key:   __u64 (소켓 포인터 주소) ← 같은 TCP 연결을 식별하는 고유값
// Value: struct connect_info      ← 타임스탬프 + PID + comm
//
// max_entries: 동시에 추적할 수 있는 최대 TCP 연결 수
// ─────────────────────────────────────────────
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key,   __u64);
    __type(value, struct connect_info);
} connect_start SEC(".maps");

// ─────────────────────────────────────────────
// kprobe 1: tcp_connect 호출 시 실행
//
// 역할: 연결 시작 타임스탬프를 Hash Map에 저장
// ─────────────────────────────────────────────
SEC("kprobe/tcp_connect")
int BPF_KPROBE(handle_tcp_connect, struct sock *sk)
{
    // IPv4만 처리
    __u16 family = BPF_CORE_READ(sk, __sk_common.skc_family);
    if (family != 2) // AF_INET = 2
        return 0;

    // 연결 시작 정보 수집 (이 시점은 curl 컨텍스트 → PID/comm 유효)
    struct connect_info info = {};
    info.ts  = bpf_ktime_get_ns();
    info.pid = bpf_get_current_pid_tgid() >> 32;
    bpf_get_current_comm(&info.comm, sizeof(info.comm));

    // 소켓 포인터를 Key로 사용
    // (__u64)sk: 포인터를 정수로 변환해서 Map의 Key로 사용
    __u64 key = (__u64)sk;

    // Hash Map에 저장: connect_start[sk주소] = {ts, pid, comm}
    bpf_map_update_elem(&connect_start, &key, &info, BPF_ANY);

    return 0;
}

// ─────────────────────────────────────────────
// kprobe 2: tcp_rcv_state_process 호출 시 실행
//
// 역할: SYN-ACK 수신 시점에 타임스탬프를 꺼내 latency 계산
//
// tcp_rcv_state_process 는 TCP 상태머신을 처리하는 커널 함수.
// SYN_SENT 상태에서 SYN-ACK 를 받으면 이 함수가 호출됨.
// ─────────────────────────────────────────────
SEC("kprobe/tcp_rcv_state_process")
int BPF_KPROBE(handle_tcp_rcv_state_process, struct sock *sk)
{
    // SYN_SENT(=2) 상태인 소켓만 처리
    // SYN_SENT: tcp_connect() 후 SYN-ACK 를 기다리는 상태
    // 이 상태에서 tcp_rcv_state_process 가 불리면 = SYN-ACK 도착
    __u8 sk_state = BPF_CORE_READ(sk, __sk_common.skc_state);
    if (sk_state != 2) // TCP_SYN_SENT = 2
        return 0;

    // Hash Map에서 연결 시작 정보 꺼내기
    __u64 key = (__u64)sk;
    struct connect_info *info = bpf_map_lookup_elem(&connect_start, &key);
    if (!info)
        return 0; // 저장된 정보 없으면 종료

    // latency 계산 (나노초 → 마이크로초)
    __u64 latency_us = (bpf_ktime_get_ns() - info->ts) / 1000;

    // Hash Map에서 삭제 (메모리 누수 방지)
    bpf_map_delete_elem(&connect_start, &key);

    // IPv4만 처리
    __u16 family = BPF_CORE_READ(sk, __sk_common.skc_family);
    if (family != 2)
        return 0;

    // Ring Buffer에 이벤트 기록
    struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (!e)
        return 0;

    // tcp_connect 시점에 저장해둔 PID/comm 사용 (인터럽트 컨텍스트라 지금은 유효하지 않음)
    e->type       = EVENT_TYPE_CONNECT;
    e->pid        = info->pid;
    e->daddr      = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    e->dport      = bpf_ntohs(BPF_CORE_READ(sk, __sk_common.skc_dport));
    e->latency_us = latency_us;
    __builtin_memcpy(e->comm, info->comm, sizeof(e->comm));

    bpf_ringbuf_submit(e, 0);

    return 0;
}

// ─────────────────────────────────────────────
// tracepoint: tcp_retransmit_skb 호출 시 실행
//
// 역할: TCP 재전송 발생 시 이벤트를 Ring Buffer로 전달
//
// offset은 하드코딩하지 않고 retransmit_offsets Map에서 읽음
// → 유저 공간이 시작 시 format 파일을 파싱해서 Map에 저장
// ─────────────────────────────────────────────
SEC("tracepoint/tcp/tcp_retransmit_skb")
int handle_tcp_retransmit(void *ctx)
{
    // Map에서 offset 읽기
    __u32 idx;
    __u32 *off;

    idx = 0;
    off = bpf_map_lookup_elem(&retransmit_offsets, &idx);
    if (!off) return 0;
    __u32 off_family = *off;

    idx = 1;
    off = bpf_map_lookup_elem(&retransmit_offsets, &idx);
    if (!off) return 0;
    __u32 off_dport = *off;

    idx = 2;
    off = bpf_map_lookup_elem(&retransmit_offsets, &idx);
    if (!off) return 0;
    __u32 off_daddr = *off;

    // IPv4만 처리
    __u16 family;
    bpf_probe_read_kernel(&family, sizeof(family), ctx + off_family);
    if (family != 2) // AF_INET = 2
        return 0;

    __u16 dport;
    __u8  daddr[4];
    bpf_probe_read_kernel(&dport, sizeof(dport), ctx + off_dport);
    bpf_probe_read_kernel(&daddr, sizeof(daddr), ctx + off_daddr);

    // Ring Buffer에 이벤트 기록
    struct event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (!e)
        return 0;

    e->type       = EVENT_TYPE_RETRANSMIT;
    e->pid        = bpf_get_current_pid_tgid() >> 32;
    e->daddr      = *(__u32 *)daddr;
    e->dport      = dport;
    e->latency_us = 0;  // 재전송 이벤트에서는 미사용
    bpf_get_current_comm(&e->comm, sizeof(e->comm));

    bpf_ringbuf_submit(e, 0);

    return 0;
}

// eBPF 프로그램의 라이선스 선언 (필수)
char LICENSE[] SEC("license") = "GPL";
