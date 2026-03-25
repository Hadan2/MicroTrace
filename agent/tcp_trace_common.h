// tcp_trace_common.h - 커널/유저 공간 공유 타입 정의
//
// tcp_trace.bpf.c 와 tcp_trace.c 양쪽에서 include 해서 사용.
// 이 파일만 수정하면 두 파일에 동시 반영됨.

#ifndef TCP_TRACE_COMMON_H
#define TCP_TRACE_COMMON_H

// ─────────────────────────────────────────────
// 이벤트 타입
// ─────────────────────────────────────────────
#define EVENT_TYPE_CONNECT     1
#define EVENT_TYPE_RETRANSMIT  2

// ─────────────────────────────────────────────
// 이벤트 구조체 - Ring Buffer로 전달할 데이터 형식
//
// 필드를 크기 내림차순으로 배치해서 컴파일러 패딩을 제거.
// clang(bpf.c)과 gcc(trace.c)가 동일하게 해석하도록 보장.
//
// 메모리 레이아웃:
//   latency_us [8바이트]
//   pid        [4바이트]
//   daddr      [4바이트]
//   dport      [2바이트]
//   type       [1바이트]
//   pad        [1바이트] ← 명시적 패딩 (comm 정렬)
//   comm       [16바이트]
//   합계: 36바이트, 패딩 없음
// ─────────────────────────────────────────────
struct event {
    __u64 latency_us;   // TCP 연결 latency (마이크로초, CONNECT에서만 유효)
    __u32 pid;          // 프로세스 ID
    __u32 daddr;        // 목적지 IP
    __u16 dport;        // 목적지 포트
    __u8  type;         // 이벤트 타입 (EVENT_TYPE_CONNECT or EVENT_TYPE_RETRANSMIT)
    __u8  pad;          // 명시적 패딩
    char  comm[16];     // 프로그램 이름
};

// ─────────────────────────────────────────────
// tracepoint offset 구조체 - Array Map의 value 타입
//
// 유저 공간이 format 파일을 파싱해서 이 구조체를 Map에 저장하면
// eBPF 프로그램이 Map lookup 1번으로 모든 offset을 읽음
// ─────────────────────────────────────────────
struct retransmit_offsets_t {
    __u32 family;   // family 필드의 offset
    __u32 dport;    // dport  필드의 offset
    __u32 daddr;    // daddr  필드의 offset
};

#endif // TCP_TRACE_COMMON_H
