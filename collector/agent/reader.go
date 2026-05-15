// agent/reader.go
//
// EventProvider 인터페이스 — 이벤트를 공급하는 방법을 격리한다.
//
// 현재 구현: SubprocessProvider (tcp_trace 바이너리를 subprocess로 실행)
// 미래 구현: RemoteProvider (EC2 멀티호스트 환경, gRPC로 수신)
//
// 호출 측(collector/main.go)은 이 인터페이스만 보고, 구현체가 무엇인지 몰라야 한다.

package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"

	"microtrace/collector/model"
)

// EventProvider — TCP 이벤트를 채널로 공급하는 인터페이스.
//
// Start: ctx가 취소되거나 소스가 종료되면 반환된 채널이 닫힌다.
// 호출자는 채널이 닫혔을 때 재시작 여부를 결정한다.
type EventProvider interface {
	Start(ctx context.Context) (<-chan model.Event, error)
}

// SubprocessProvider — tcp_trace 바이너리를 subprocess로 실행하는 EventProvider 구현체.
type SubprocessProvider struct {
	binaryPath string
}

// NewSubprocessProvider — SubprocessProvider를 생성한다.
func NewSubprocessProvider(binaryPath string) *SubprocessProvider {
	return &SubprocessProvider{binaryPath: binaryPath}
}

// Start — subprocess를 실행하고 Event 채널을 반환한다.
//
// 반환된 채널은 subprocess 종료 또는 ctx 취소 시 닫힌다.
// 채널 버퍼: 1024개 — agent가 burst로 이벤트를 뿜어도 processor가 따라잡을 시간을 줌.
func (p *SubprocessProvider) Start(ctx context.Context) (<-chan model.Event, error) {
	cmd := exec.CommandContext(ctx, p.binaryPath)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("tcp_trace stdout 파이프 연결 실패: %w", err)
	}
	// stderr는 터미널로 직접 흘려보낸다 (agent 자체 진단 로그)
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("tcp_trace 실행 실패: %w", err)
	}

	log.Printf("[agent] tcp_trace 시작 (pid=%d, path=%s)", cmd.Process.Pid, p.binaryPath)

	ch := make(chan model.Event, 1024)

	go func() {
		defer close(ch)
		defer cmd.Wait()

		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			var e model.Event
			if err := json.Unmarshal(scanner.Bytes(), &e); err != nil {
				log.Printf("[agent] JSON 파싱 실패: %v (원본: %s)", err, scanner.Text())
				continue
			}

			select {
			case ch <- e:
			case <-ctx.Done():
				return
			}
		}

		log.Println("[agent] tcp_trace stdout 종료 — 이벤트 스트림 닫힘")
	}()

	return ch, nil
}

