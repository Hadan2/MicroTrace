// tcp_trace.c - 유저 공간에서 실행되는 로더 프로그램
//
// 역할:
//   1. tcp_trace.bpf.o 를 커널에 로드
//   2. Ring Buffer 이벤트를 기다렸다가
//   3. 이벤트 올 때마다 JSON으로 stdout 출력 (Go collector가 파싱)

#include <stdio.h>          // printf()
#include <stdlib.h>         // exit()
#include <signal.h>         // SIGINT 처리 (Ctrl+C)
#include <arpa/inet.h>      // inet_ntoa() - IP를 문자열로 변환
#include <bpf/libbpf.h>     // libbpf API (bpf_object, ring_buffer 등)
#include "tcp_trace.skel.h" // bpftool이 자동 생성하는 skeleton 헤더
                            // eBPF 프로그램을 C코드에서 쉽게 다루게 해줌

// ─────────────────────────────────────────────
// 이벤트 구조체 - .bpf.c 와 동일해야 함
// 커널에서 보낸 데이터를 이 구조체로 해석
// ─────────────────────────────────────────────
struct event {
    unsigned int       pid;
    unsigned int       daddr;
    unsigned short     dport;
    unsigned long long latency_us;  // TCP 연결 latency (마이크로초)
    char               comm[16];
};

// 프로그램 종료 플래그 (Ctrl+C 시 루프 탈출용)
static volatile int running = 1;

// Ctrl+C 핸들러
static void handle_signal(int sig)
{
    running = 0;
}

// ─────────────────────────────────────────────
// JSON 출력 함수 (나중에 바이너리로 교체할 때 이 함수만 바꾸면 됨)
//
// 출력 형식:
//   {"pid":1234,"comm":"curl","daddr":"142.250.196.78","dport":443}
//
// stdout 으로 출력 → Go collector 가 줄 단위로 읽어서 파싱
// ─────────────────────────────────────────────
static void output_event(const struct event *e)
{
    // IP 주소를 "192.168.1.1" 형식 문자열로 변환
    struct in_addr ip_addr = { .s_addr = e->daddr };
    char *ip_str = inet_ntoa(ip_addr);

    // JSON 한 줄 출력 (줄바꿈 필수 - Go 가 '\n' 기준으로 한 이벤트를 구분)
    printf("{\"pid\":%u,\"comm\":\"%s\",\"daddr\":\"%s\",\"dport\":%u,\"latency_us\":%llu}\n",
           e->pid,
           e->comm,
           ip_str,
           e->dport,
           e->latency_us);

    // 버퍼 즉시 비우기
    // 기본적으로 stdout 은 버퍼가 가득 차야 출력됨
    // Go 가 실시간으로 읽으려면 이벤트마다 즉시 내보내야 함
    fflush(stdout);
}

// ─────────────────────────────────────────────
// Ring Buffer 콜백 함수
//
// Ring Buffer에 이벤트가 들어올 때마다 자동 호출됨
// ctx: 컨텍스트 (여기선 미사용)
// data: Ring Buffer에서 받은 raw 데이터 포인터
// size: 데이터 크기
// ─────────────────────────────────────────────
static int handle_event(void *ctx, void *data, size_t size)
{
    struct event *e = data;
    output_event(e);
    return 0;
}

int main(void)
{
    // Ctrl+C 시그널 등록
    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);

    // ── 1단계: eBPF skeleton 열기 ──────────────────
    // tcp_trace_bpf__open(): skeleton이 제공하는 함수
    // .bpf.o 파일을 메모리에 로드하고 구조체로 감싸줌
    struct tcp_trace_bpf *skel = tcp_trace_bpf__open();
    if (!skel) {
        fprintf(stderr, "skeleton 열기 실패\n");
        return 1;
    }

    // ── 2단계: eBPF 프로그램 커널에 로드 ──────────
    // tcp_trace_bpf__load(): Verifier 검증 후 커널에 로드
    int err = tcp_trace_bpf__load(skel);
    if (err) {
        fprintf(stderr, "커널 로드 실패: %d\n", err);
        goto cleanup;
    }

    // ── 3단계: kprobe 훅 연결 ─────────────────────
    // tcp_trace_bpf__attach(): tcp_connect 함수에 kprobe 연결
    err = tcp_trace_bpf__attach(skel);
    if (err) {
        fprintf(stderr, "attach 실패: %d\n", err);
        goto cleanup;
    }

    // ── 4단계: Ring Buffer 설정 ───────────────────
    // ring_buffer__new(): Ring Buffer 폴러 생성
    //   - skel->maps.events: .bpf.c 에서 선언한 Ring Buffer Map
    //   - handle_event: 이벤트 도착 시 호출할 콜백 함수
    struct ring_buffer *rb = ring_buffer__new(
        bpf_map__fd(skel->maps.events),
        handle_event,
        NULL,   // 콜백에 전달할 ctx (미사용)
        NULL    // 추가 옵션 (없음)
    );
    if (!rb) {
        fprintf(stderr, "ring buffer 생성 실패\n");
        err = 1;
        goto cleanup;
    }

    // 상태 메시지는 stderr 로 출력 (stdout 은 JSON 전용)
    // Go 가 stdout 을 파싱할 때 이 메시지가 섞이면 JSON 파싱 오류 발생
    fprintf(stderr, "TCP 연결 추적 시작... (종료: Ctrl+C)\n");

    // ── 5단계: 이벤트 루프 ────────────────────────
    // ring_buffer__poll(): Ring Buffer에 이벤트가 있으면 handle_event 호출
    //   타임아웃 100ms 마다 한번씩 체크
    //   이벤트 없으면 그냥 대기 (CPU 낭비 없음)
    while (running) {
        err = ring_buffer__poll(rb, 100 /* ms */);
        if (err == -EINTR) { // Ctrl+C 인터럽트
            err = 0;
            break;
        }
        if (err < 0) {
            fprintf(stderr, "poll 에러: %d\n", err);
            break;
        }
    }

    ring_buffer__free(rb);

cleanup:
    tcp_trace_bpf__destroy(skel);
    return err < 0 ? -err : err;
}
