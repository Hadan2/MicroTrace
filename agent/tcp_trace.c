// tcp_trace.c - 유저 공간에서 실행되는 로더 프로그램
//
// 역할:
//   1. tcp_trace.bpf.o 를 커널에 로드
//   2. sock_ops 프로그램을 루트 cgroup에 attach
//   3. Ring Buffer 이벤트를 기다렸다가 JSON으로 stdout 출력 (Go collector가 파싱)

#include <stdio.h>            // printf(), fprintf()
#include <stdlib.h>           // exit(), getenv(), strtoull()
#include <string.h>          // memset()
#include <signal.h>           // SIGINT 처리 (Ctrl+C)
#include <fcntl.h>            // open(), O_RDONLY
#include <unistd.h>           // close()
#include <arpa/inet.h>        // inet_ntoa() - IP를 문자열로 변환
#include <stdint.h>          // uint32_t (length-prefix)
#include <bpf/libbpf.h>       // libbpf API (ring_buffer 등)
#include <bpf/bpf.h>          // bpf_prog_attach(), bpf_prog_detach()
#include <pb_encode.h>        // nanopb 인코딩 (Issue #9)
#include "tcp_trace.skel.h"   // bpftool이 자동 생성하는 skeleton 헤더
#include "tcp_trace_common.h" // 커널/유저 공유 타입 (struct event, EVENT_TYPE_*)
#include "event.pb.h"        // nanopb 생성 타입 (microtrace_Event)

// 출력 포맷 선택: MICROTRACE_WIRE=pb 면 Protobuf, 아니면 JSON(기본).
// main()에서 1회 읽어 전역에 보관한다.
static int use_protobuf = 0;

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
    // saddr/daddr: big-endian 32비트 IP → "192.168.1.1" 형식 문자열로 변환
    // inet_ntoa()는 정적 버퍼를 재사용하므로 saddr을 먼저 복사해둬야 함
    struct in_addr sip = { .s_addr = e->saddr };
    char saddr_str[16];
    // inet_ntoa 정적 버퍼 덮어쓰기 방지: saddr 변환 결과를 별도 버퍼에 복사
    snprintf(saddr_str, sizeof(saddr_str), "%s", inet_ntoa(sip));

    struct in_addr dip = { .s_addr = e->daddr };
    char *daddr_str = inet_ntoa(dip);

    if (e->type == EVENT_TYPE_RETRANSMIT) {
        printf("{\"type\":\"retransmit\",\"pid\":%u,\"comm\":\"%s\",\"saddr\":\"%s\",\"daddr\":\"%s\",\"dport\":%u}\n",
               e->pid, e->comm, saddr_str, daddr_str, e->dport);
    } else if (e->type == EVENT_TYPE_RTT) {
        printf("{\"type\":\"rtt\",\"pid\":%u,\"comm\":\"%s\",\"saddr\":\"%s\",\"daddr\":\"%s\",\"dport\":%u,\"latency_us\":%llu,\"jitter_us\":%llu}\n",
               e->pid, e->comm, saddr_str, daddr_str, e->dport, e->latency_us, e->jitter_us);
    } else {
        printf("{\"type\":\"connect\",\"pid\":%u,\"comm\":\"%s\",\"saddr\":\"%s\",\"daddr\":\"%s\",\"dport\":%u,\"latency_us\":%llu,\"jitter_us\":%llu}\n",
               e->pid, e->comm, saddr_str, daddr_str, e->dport, e->latency_us, e->jitter_us);
    }
    // stdout 버퍼를 즉시 비움 - 이벤트가 Go collector에 실시간으로 전달되도록
    fflush(stdout);
}

// EVENT_TYPE_* → 문자열. JSON/Protobuf 양쪽에서 쓴다.
static const char *type_str(uint8_t type)
{
    switch (type) {
    case EVENT_TYPE_RETRANSMIT: return "retransmit";
    case EVENT_TYPE_RTT:        return "rtt";
    default:                    return "connect";
    }
}

// ─────────────────────────────────────────────
// Protobuf 출력 함수 (Issue #9)
//
// 이벤트를 nanopb로 인코딩해 stdout에 쓴다. 바이너리는 개행으로 경계를
// 나눌 수 없으므로 각 메시지 앞에 4바이트 길이(little-endian)를 붙인다
// (length-prefixed framing). collector가 이 길이를 읽고 그만큼 디코딩한다.
// ─────────────────────────────────────────────
static void output_event_pb(const struct event *e)
{
    microtrace_Event pb = microtrace_Event_init_zero;

    // struct event → protobuf 메시지 (문자열은 고정 char[N]이라 그대로 복사)
    snprintf(pb.type, sizeof(pb.type), "%s", type_str(e->type));
    pb.pid = e->pid;
    snprintf(pb.comm, sizeof(pb.comm), "%s", e->comm);

    struct in_addr sip = { .s_addr = e->saddr };
    snprintf(pb.saddr, sizeof(pb.saddr), "%s", inet_ntoa(sip));
    struct in_addr dip = { .s_addr = e->daddr };
    snprintf(pb.daddr, sizeof(pb.daddr), "%s", inet_ntoa(dip));

    pb.dport = e->dport;
    // retransmit은 latency/jitter가 0 (구조체가 이미 0으로 채워짐)
    if (e->type != EVENT_TYPE_RETRANSMIT) {
        pb.latency_us = e->latency_us;
        pb.jitter_us  = e->jitter_us;
    }

    // 고정 버퍼로 인코딩(최대 크기는 필드 상한 합보다 넉넉히).
    uint8_t buf[128];
    pb_ostream_t stream = pb_ostream_from_buffer(buf, sizeof(buf));
    if (!pb_encode(&stream, microtrace_Event_fields, &pb)) {
        fprintf(stderr, "[pb] 인코딩 실패: %s\n", PB_GET_ERROR(&stream));
        return;
    }

    // 4바이트 길이 프리픽스(LE) + 메시지 본문.
    uint32_t len = (uint32_t)stream.bytes_written;
    fwrite(&len, sizeof(len), 1, stdout);
    fwrite(buf, 1, len, stdout);
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
    if (use_protobuf)
        output_event_pb(e);
    else
        output_event(e);
    return 0;
}

// ─────────────────────────────────────────────
// 벤치마크 모드 (Issue #9 — ②번 구간 부하/전송 측정)
//
// MICROTRACE_BENCH_COUNT=N 이 설정되면 eBPF를 아예 거치지 않고
// 가짜 struct event N개를 최대 속도로 output_event()에 흘려보낸다.
// collector 입장에선 진짜 이벤트와 구분 불가 → C→Go 직렬화+파이프 구간만
// 순수 측정된다. 실제 커널/네트워크 변수를 배제하기 위함.
//
// JSON vs Protobuf+gRPC 전환 전후를 같은 부하로 비교하는 baseline 생성용.
// ─────────────────────────────────────────────
static int run_benchmark(unsigned long long count)
{
    // 고정된 가짜 이벤트 하나를 반복 출력한다(값 자체는 무의미, 형식만 실제와 동일).
    // saddr/daddr는 실제 컨테이너 대역과 비슷한 값으로 채워 파싱 경로를 동일하게 탄다.
    struct event e;
    memset(&e, 0, sizeof(e));
    e.type       = EVENT_TYPE_RTT;
    e.pid        = 12345;
    e.saddr      = inet_addr("172.19.0.3"); // network byte order
    e.daddr      = inet_addr("172.19.0.2");
    e.dport      = 8080;
    e.latency_us = 1234;
    e.jitter_us  = 56;

    // output_event()는 이벤트마다 fflush(stdout)한다(실시간 경로용).
    // 벤치에서 수백만 개를 flush하면 flush 비용이 직렬화 비용을 가려
    // JSON vs Protobuf 비교가 왜곡된다. stdout을 큰 버퍼의 full-buffered로
    // 바꿔 fflush가 실제 write를 자주 일으키지 않게 한다(블록이 찰 때만 write).
    static char buf[1 << 20]; // 1MB
    setvbuf(stdout, buf, _IOFBF, sizeof(buf));

    fprintf(stderr, "[bench] 가짜 이벤트 %llu개 최대 속도로 출력 시작 (wire=%s)\n",
            count, use_protobuf ? "protobuf" : "json");
    for (unsigned long long i = 0; i < count; i++) {
        // handle_event를 거쳐 use_protobuf에 따라 JSON/Protobuf를 탄다.
        if (use_protobuf)
            output_event_pb(&e);
        else
            output_event(&e);
    }
    fflush(stdout); // 남은 버퍼 마지막으로 비움
    fprintf(stderr, "[bench] 출력 완료 (%llu개)\n", count);
    return 0;
}

int main(void)
{
    signal(SIGINT,  handle_signal);
    signal(SIGTERM, handle_signal);

    // ── 출력 포맷 선택 (Issue #9) ──────────────────────────────
    // MICROTRACE_WIRE=pb 면 Protobuf(length-prefixed), 아니면 JSON(기본).
    // 벤치·실제 경로 모두 이 값을 본다.
    const char *wire = getenv("MICROTRACE_WIRE");
    use_protobuf = (wire && (wire[0] == 'p' || wire[0] == 'P'));

    // ── 벤치마크 모드 분기 (Issue #9) ──────────────────────────
    // MICROTRACE_BENCH_COUNT=N 이면 eBPF를 건너뛰고 가짜 이벤트 N개만 뿜고 종료.
    // eBPF attach가 없으므로 root/sudo도 불필요하다.
    const char *bench = getenv("MICROTRACE_BENCH_COUNT");
    if (bench && *bench) {
        unsigned long long count = strtoull(bench, NULL, 10);
        if (count > 0)
            return run_benchmark(count);
    }

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
