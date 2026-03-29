// tcp_trace.c - 유저 공간에서 실행되는 로더 프로그램
//
// 역할:
//   1. tcp_trace.bpf.o 를 커널에 로드
//   2. sock_ops 프로그램을 루트 cgroup에 attach
//   3. Ring Buffer 이벤트를 기다렸다가 JSON으로 stdout 출력 (Go collector가 파싱)

#include <stdio.h>            // printf(), fprintf()
#include <stdlib.h>           // exit()
#include <signal.h>           // SIGINT 처리 (Ctrl+C)
#include <fcntl.h>            // open(), O_RDONLY
#include <unistd.h>           // close()
#include <arpa/inet.h>        // inet_ntoa() - IP를 문자열로 변환
#include <bpf/libbpf.h>       // libbpf API (ring_buffer 등)
#include <bpf/bpf.h>          // bpf_prog_attach(), bpf_prog_detach()
#include "tcp_trace.skel.h"   // bpftool이 자동 생성하는 skeleton 헤더
#include "tcp_trace_common.h" // 커널/유저 공유 타입 (struct event, EVENT_TYPE_*)

// ─────────────────────────────────────────────
// cgroup 경로
//
// sock_ops는 특정 cgroup에 attach해야 동작함.
// 루트 cgroup("/sys/fs/cgroup")에 attach하면 시스템 전체 소켓이 대상이 됨.
// 나중에 service_a의 cgroup 경로로 바꾸면 해당 서비스 소켓만 선택적으로 추적 가능.
// ─────────────────────────────────────────────
#define CGROUP_PATH "/sys/fs/cgroup"

// 프로그램 종료 플래그 (Ctrl+C 시 이벤트 루프 탈출용)
static volatile int running = 1;
// detach 시 cgroup_fd가 필요해서 전역으로 보관
static int cgroup_fd = -1;

// Ctrl+C / SIGTERM 핸들러
static void handle_signal(int sig)
{
    running = 0;
}

// ─────────────────────────────────────────────
// JSON 출력 함수
//
// Ring Buffer 이벤트를 JSON 한 줄로 stdout에 출력.
// stdout은 JSON 전용 - 상태 메시지는 모두 stderr로 출력.
// (Go collector가 stdout을 파이프로 읽어서 파싱하기 때문)
//
// 나중에 WebSocket 전송으로 교체할 때 이 함수만 바꾸면 됨.
// ─────────────────────────────────────────────
static void output_event(const struct event *e)
{
    // e->daddr: big-endian 32비트 IP → "192.168.1.1" 형식 문자열로 변환
    struct in_addr ip_addr = { .s_addr = e->daddr };
    char *ip_str = inet_ntoa(ip_addr);

    if (e->type == EVENT_TYPE_RETRANSMIT) {
        printf("{\"type\":\"retransmit\",\"pid\":%u,\"comm\":\"%s\",\"daddr\":\"%s\",\"dport\":%u}\n",
               e->pid, e->comm, ip_str, e->dport);
    } else if (e->type == EVENT_TYPE_RTT) {
        printf("{\"type\":\"rtt\",\"pid\":%u,\"comm\":\"%s\",\"daddr\":\"%s\",\"dport\":%u,\"latency_us\":%llu}\n",
               e->pid, e->comm, ip_str, e->dport, e->latency_us);
    } else {
        printf("{\"type\":\"connect\",\"pid\":%u,\"comm\":\"%s\",\"daddr\":\"%s\",\"dport\":%u,\"latency_us\":%llu}\n",
               e->pid, e->comm, ip_str, e->dport, e->latency_us);
    }
    // stdout 버퍼를 즉시 비움 - 이벤트가 Go collector에 실시간으로 전달되도록
    fflush(stdout);
}

// ─────────────────────────────────────────────
// Ring Buffer 콜백
//
// ring_buffer__poll() 이 이벤트를 감지하면 자동으로 호출됨.
// data: Ring Buffer에서 받은 raw 이벤트 포인터 (struct event * 로 캐스팅)
// ─────────────────────────────────────────────
static int handle_event(void *ctx, void *data, size_t size)
{
    struct event *e = data;
    output_event(e);
    return 0;
}

int main(void)
{
    signal(SIGINT,  handle_signal);
    signal(SIGTERM, handle_signal);

    // ── 1단계: eBPF skeleton 열기 ──────────────────────────────
    // tcp_trace.skel.h 안에 박힌 .bpf.o 바이트코드를 메모리에 파싱.
    // 아직 커널에는 아무것도 올라가지 않은 상태.
    struct tcp_trace_bpf *skel = tcp_trace_bpf__open();
    if (!skel) {
        fprintf(stderr, "skeleton 열기 실패\n");
        return 1;
    }

    // ── 2단계: eBPF 프로그램 커널에 로드 ───────────────────────
    // Verifier 검증 후 Ring Buffer Map과 sock_ops 프로그램을 커널에 등록.
    // 아직 어디에도 attach되지 않은 상태 - 이벤트 감시 아직 시작 안 됨.
    int err = tcp_trace_bpf__load(skel);
    if (err) {
        fprintf(stderr, "커널 로드 실패: %d\n", err);
        goto cleanup;
    }

    // ── 3단계: cgroup fd 열기 ──────────────────────────────────
    // bpf_prog_attach()는 "어느 cgroup에 붙일지"를 fd(파일 디스크립터)로 받음.
    // 파일 내용을 읽으려는 게 아니라 fd를 얻기 위해 O_RDONLY로 열기만 함.
    cgroup_fd = open(CGROUP_PATH, O_RDONLY);
    if (cgroup_fd < 0) {
        fprintf(stderr, "cgroup 열기 실패: %s\n", CGROUP_PATH);
        err = 1;
        goto cleanup;
    }

    // ── 4단계: sock_ops 프로그램을 cgroup에 attach ─────────────
    // sock_ops는 "어느 cgroup에 붙일지"를 런타임에 직접 지정해야 함.
    // skeleton 자동 attach(tcp_trace_bpf__attach)는 SEC에 대상이 명시된
    // kprobe/tracepoint 에만 동작하므로, sock_ops는 수동으로 attach.
    //
    // 이 순간부터 cgroup_fd가 가리키는 cgroup 소속 소켓에서
    // TCP 이벤트가 발생할 때마다 handle_sock_ops()가 호출됨.
    //
    // bpf_prog_attach 인자:
    //   prog_fd:             attach할 eBPF 프로그램의 fd
    //   cgroup_fd:           attach할 cgroup의 fd
    //   BPF_CGROUP_SOCK_OPS: sock_ops 타입으로 attach
    //   0:                   flags (현재 미사용)
    int prog_fd = bpf_program__fd(skel->progs.handle_sock_ops);
    err = bpf_prog_attach(prog_fd, cgroup_fd, BPF_CGROUP_SOCK_OPS, 0);
    if (err) {
        fprintf(stderr, "sock_ops attach 실패: %d\n", err);
        goto cleanup;
    }

    // ── 5단계: Ring Buffer 폴러 설정 ───────────────────────────
    // skel->maps.events: .bpf.c 에서 선언한 Ring Buffer Map
    // handle_event: Ring Buffer에 이벤트가 도착할 때 호출할 콜백 함수
    struct ring_buffer *rb = ring_buffer__new(
        bpf_map__fd(skel->maps.events),
        handle_event,
        NULL, // 콜백에 전달할 ctx (미사용)
        NULL  // 추가 옵션 (없음)
    );
    if (!rb) {
        fprintf(stderr, "ring buffer 생성 실패\n");
        err = 1;
        goto cleanup;
    }

    // 상태 메시지는 stderr로 출력 (stdout은 JSON 전용)
    fprintf(stderr, "TCP 연결 추적 시작 (sock_ops)... (종료: Ctrl+C)\n");

    // ── 6단계: 이벤트 루프 ─────────────────────────────────────
    // 100ms마다 Ring Buffer를 체크. 이벤트 있으면 handle_event() 호출.
    // 이벤트 없으면 CPU를 점유하지 않고 대기.
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

    // ── 7단계: sock_ops detach ──────────────────────────────────
    // 수동으로 attach했으므로 수동으로 detach해야 함.
    // detach 안 하면 프로그램 종료 후에도 cgroup에 eBPF hook이 남아있어서
    // 다음 실행 시 attach 에러가 발생하거나 의도치 않은 이벤트가 계속 처리됨.
    if (cgroup_fd >= 0) {
        bpf_prog_detach(cgroup_fd, BPF_CGROUP_SOCK_OPS);
        close(cgroup_fd);
    }

cleanup:
    // skeleton 해제: 커널에 로드된 eBPF 프로그램과 Map 정리
    tcp_trace_bpf__destroy(skel);
    return err < 0 ? -err : err;
}
