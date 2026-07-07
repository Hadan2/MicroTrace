# Makefile - 빌드 자동화
#
# make 명령어 하나로 아래 과정을 자동 실행:
#   1. tcp_trace.bpf.c → BPF 바이트코드(.o) 컴파일
#   2. bpftool로 skeleton 헤더(.skel.h) 자동 생성
#   3. tcp_trace.c → 실행 파일 컴파일

# 컴파일러 및 도구 설정
CLANG    := clang
BPFTOOL  := /usr/local/sbin/bpftool
CC       := gcc

# 컴파일 옵션
BPF_CFLAGS := -g -O2 -target bpf -D__TARGET_ARCH_x86 \
              -I/usr/include/x86_64-linux-gnu \
              -I/usr/include

# libbpf 링크 옵션 (유저 공간 컴파일 시)
LDFLAGS  := -lbpf -lelf -lz

# nanopb (Issue #9) — Protobuf 인코딩. 헤더는 /usr/include/nanopb,
# 런타임은 정적 라이브러리 libprotobuf-nanopb.a 를 링크한다.
NANOPB_CFLAGS := -I/usr/include/nanopb
NANOPB_LDFLAGS := -lprotobuf-nanopb

# ── 빌드 타겟 ──────────────────────────────────

# 기본 타겟: all → tcp_trace 실행 파일 생성
all: tcp_trace

# 1단계: .bpf.c → .bpf.o (BPF 바이트코드)
#   -target bpf : BPF 가상머신용으로 컴파일
#   -O2         : 최적화 (eBPF Verifier 통과에 도움)
#   -g          : BTF 디버그 정보 포함 (CO-RE에 필요)
tcp_trace.bpf.o: tcp_trace.bpf.c
	$(CLANG) $(BPF_CFLAGS) -c $< -o $@

# 2단계: .bpf.o → skeleton 헤더(.skel.h) 자동 생성
#   bpftool gen skeleton: eBPF 프로그램을 C코드에서 쉽게 다루는 헤더 생성
#   이 헤더가 tcp_trace_bpf__open(), load(), attach() 함수를 제공
tcp_trace.skel.h: tcp_trace.bpf.o
	$(BPFTOOL) gen skeleton $< > $@

# 3단계: tcp_trace.c + event.pb.c + skeleton → 실행 파일
#   event.pb.c : nanopb 생성 코드 (event.proto → 인코딩 디스크립터)
#   -lprotobuf-nanopb : nanopb 런타임(pb_encode/pb_decode/pb_common)
tcp_trace: tcp_trace.c event.pb.c tcp_trace.skel.h
	$(CC) $(NANOPB_CFLAGS) -o $@ tcp_trace.c event.pb.c $(LDFLAGS) $(NANOPB_LDFLAGS)

# event.proto → event.pb.c/.h (+ event.options 자동 반영)
event.pb.c event.pb.h: event.proto event.options
	nanopb_generator event.proto

# 빌드 결과물 삭제
clean:
	rm -f tcp_trace tcp_trace.bpf.o tcp_trace.skel.h event.pb.c event.pb.h

.PHONY: all clean
