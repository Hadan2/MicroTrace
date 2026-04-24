// tcp_trace_common.h - 커널/유저 공간 공유 타입 정의
//
// tcp_trace.bpf.c 와 tcp_trace.c 양쪽에서 include 해서 사용.
// 이 파일만 수정하면 두 파일에 동시 반영됨.

#ifndef TCP_TRACE_COMMON_H
#define TCP_TRACE_COMMON_H

// ─────────────────────────────────────────────
// 이벤트 타입
//
// #define 은 컴파일 전에 텍스트를 숫자로 치환하는 매크로.
// 코드에서 숫자 대신 의미 있는 이름으로 이벤트를 구분할 수 있게 함.
// ─────────────────────────────────────────────
#define EVENT_TYPE_CONNECT     1  // TCP 연결 수립 완료 (첫 RTT)
#define EVENT_TYPE_RETRANSMIT  2  // TCP 재전송 발생
#define EVENT_TYPE_RTT         3  // Keep-Alive 연결 위의 요청 단위 RTT 갱신

// ─────────────────────────────────────────────
// 이벤트 구조체 - Ring Buffer로 전달할 데이터 형식
//
// 커널(tcp_trace.bpf.c)이 이 구조체에 데이터를 채워 Ring Buffer에 넣으면
// 유저 공간(tcp_trace.c)이 꺼내서 JSON으로 출력함.
//
// 필드를 크기 내림차순으로 배치해서 컴파일러 패딩을 제거.
// clang(bpf.c)과 gcc(trace.c)가 동일한 메모리 레이아웃으로 해석하도록 보장.
//
// 메모리 레이아웃:
//   latency_us [8바이트]  ← CONNECT/RTT: RTT(마이크로초), RETRANSMIT: 0
//   pid        [4바이트]  ← sock_ops는 pid 불가 → local_port로 대체
//   saddr      [4바이트]  ← 출발지 IPv4 (skops->local_ip4, big-endian)
//   daddr      [4바이트]  ← 목적지 IPv4 (big-endian, inet_ntoa로 변환해서 출력)
//   dport      [2바이트]
//   type       [1바이트]  ← EVENT_TYPE_CONNECT / RTT / RETRANSMIT
//   pad        [1바이트]  ← 명시적 패딩 (comm을 8바이트 경계에 정렬)
//   comm       [16바이트] ← 프로그램 이름 (bpf_get_current_comm이 최대 16바이트)
//   합계: 40바이트, 컴파일러 자동 패딩 없음
// ─────────────────────────────────────────────
struct event {
    __u64 latency_us;   // RTT (마이크로초). CONNECT/RTT 이벤트에서 유효
    __u64 jitter_us;    // RTT 변동폭 (mdev_us >> 3). 불안정할수록 높음
    __u32 pid;          // 프로세스 ID (실제로는 local_port)
    __u32 saddr;        // 출발지 IPv4 주소 (big-endian) — 이 소켓이 속한 컨테이너 IP
    __u32 daddr;        // 목적지 IPv4 주소 (big-endian)
    __u16 dport;        // 목적지 포트
    __u8  type;         // 이벤트 타입 (EVENT_TYPE_CONNECT or EVENT_TYPE_RETRANSMIT)
    __u8  pad;          // 명시적 패딩
    char  comm[16];     // 프로그램 이름
};

#endif // TCP_TRACE_COMMON_H
