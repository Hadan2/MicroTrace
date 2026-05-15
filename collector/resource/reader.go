// collector/resource/reader.go
//
// SubprocessProvider — resource_agent 바이너리를 subprocess로 실행하고,
// stdout JSON 한 줄씩을 chan model.ResourceSnapshot 으로 흘려보낸다.
//
// agent/reader.go와 동일한 패턴이다.
// - subprocess + stdout 파이프
// - ctx 취소 시 subprocess 종료
// - JSON 파싱 실패는 건너뛰고 계속 진행
// - subprocess 종료 시 채널을 닫는다

package resource

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"

	"microtrace/collector/model"
)

// SubprocessProvider — resource_agent를 subprocess로 실행하는 ResourceProvider 구현체.
type SubprocessProvider struct {
	binaryPath string // resource_agent 바이너리 경로
}

// NewSubprocessProvider — SubprocessProvider를 생성한다.
func NewSubprocessProvider(binaryPath string) *SubprocessProvider {
	return &SubprocessProvider{binaryPath: binaryPath}
}

// Start — subprocess를 실행하고 ResourceSnapshot 채널을 반환한다.
//
// 반환된 채널은 subprocess 종료 또는 ctx 취소 시 닫힌다.
// 채널 버퍼: 64개 — resource_agent가 burst로 출력해도 collector가 따라잡을 시간을 줌.
func (p *SubprocessProvider) Start(ctx context.Context) (<-chan model.ResourceSnapshot, error) {
	cmd := exec.CommandContext(ctx, p.binaryPath)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("resource_agent stdout 파이프 연결 실패: %w", err)
	}
	// stderr는 터미널로 직접 흘려보낸다
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("resource_agent 실행 실패: %w", err)
	}

	log.Printf("[resource] resource_agent 시작 (pid=%d, path=%s)", cmd.Process.Pid, p.binaryPath)

	ch := make(chan model.ResourceSnapshot, 64)

	go func() {
		defer close(ch)
		defer cmd.Wait()

		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			var snap model.ResourceSnapshot
			if err := json.Unmarshal(scanner.Bytes(), &snap); err != nil {
				log.Printf("[resource] JSON 파싱 실패: %v (원본: %s)", err, scanner.Text())
				continue
			}

			select {
			case ch <- snap:
			case <-ctx.Done():
				return
			}
		}

		log.Println("[resource] resource_agent stdout 종료 — 스냅샷 스트림 닫힘")
	}()

	return ch, nil
}
