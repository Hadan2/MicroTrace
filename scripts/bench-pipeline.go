//go:build ignore

// bench-pipeline.go — ②번 구간(agent C → stdout 파이프 → collector Go 파싱)의
// 순수 처리량을 측정하는 마이크로벤치 (Issue #9 baseline).
//
// agent를 MICROTRACE_BENCH_COUNT=N 으로 실행하면 가짜 이벤트 N개를 최대 속도로
// 뿜는다. 이 프로그램은 실제 collector가 쓰는 agent.SubprocessProvider를 그대로
// 재사용해 그 이벤트를 받아 세기만 한다 — stats/hub/store를 배제해 "직렬화+파이프+
// 역직렬화" 구간만 순수 측정한다. Protobuf+gRPC 전환 후 같은 방식으로 재측정해 비교.
//
// 사용:
//   MICROTRACE_BENCH_COUNT=2000000 go run scripts/bench-pipeline.go -bin ./agent/tcp_trace
//
// 출력: 수신 이벤트 수, 소요 시간, events/s.

package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"microtrace/collector/agent"
)

func main() {
	bin := flag.String("bin", "../agent/tcp_trace", "agent 바이너리 경로")
	flag.Parse()

	if os.Getenv("MICROTRACE_BENCH_COUNT") == "" {
		fmt.Fprintln(os.Stderr, "MICROTRACE_BENCH_COUNT 환경변수를 설정하세요 (예: 2000000)")
		os.Exit(1)
	}

	// 실제 collector와 동일한 EventProvider 구현체를 사용한다.
	provider := agent.NewSubprocessProvider(*bin)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ch, err := provider.Start(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent 시작 실패: %v\n", err)
		os.Exit(1)
	}

	start := time.Now()
	var count uint64
	for range ch {
		count++
	}
	elapsed := time.Since(start)

	rate := float64(count) / elapsed.Seconds()
	fmt.Printf("수신 이벤트: %d\n", count)
	fmt.Printf("소요 시간:   %.3fs\n", elapsed.Seconds())
	fmt.Printf("처리량:      %.0f events/s\n", rate)
}
