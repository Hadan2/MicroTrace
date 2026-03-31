// agent/reader.go
//
// 역할: tcp_trace(C 바이너리)를 subprocess로 실행하고,
//       stdout JSON을 한 줄씩 읽어 chan model.Event 로 흘려보낸다.
//
// 설계 원칙:
//   - "어떻게 이벤트가 오는지"를 이 패키지 안에 캡슐화한다.
//   - stats, hub 등 상위 패키지는 chan model.Event 만 받으면 되고,
//     subprocess/파이프/gRPC 여부를 몰라도 된다.
//   - 나중에 gRPC Reader로 교체할 때 이 파일만 바꾸면 된다.

package agent

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"

	"microtrace/collector/model"
)

// Reader — agent 프로세스와의 연결을 관리한다.
// 현재 구현: subprocess + stdout 파이프
// 미래 구현: gRPC 클라이언트 (인터페이스 교체만으로 전환 가능)
type Reader struct {
	binaryPath string       // tcp_trace 바이너리 경로
	cmd        *exec.Cmd    // 실행 중인 subprocess
}

// New — Reader를 생성한다.
//
// binaryPath: tcp_trace 바이너리의 절대/상대 경로
func New(binaryPath string) *Reader {
	return &Reader{binaryPath: binaryPath}
}

// Start — subprocess를 실행하고 이벤트를 ch 로 흘려보내기 시작한다.
//
// 별도 goroutine에서 실행해야 한다: go reader.Start(ch)
// subprocess가 종료되거나 stdout이 닫히면 ch를 닫고 goroutine이 종료된다.
//
// 호출자는 ch가 닫혔을 때 프로그램을 종료하거나 재시작 로직을 처리한다.
func (r *Reader) Start(ch chan<- model.Event) error {
	// collector 자체가 sudo로 실행되므로 sudo 불필요
	// eBPF attach에 root 권한이 필요하기 때문에 collector 실행 시 sudo go run main.go 사용
	r.cmd = exec.Command(r.binaryPath)

	// stderr는 터미널로 직접 흘려보낸다 (agent 자체 진단 로그)
	// stdout만 파이프로 가져온다 (JSON 이벤트 스트림)
	r.cmd.Stderr = nil // 기본값: os.Stderr 상속
	stdout, err := r.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout 파이프 연결 실패: %w", err)
	}

	if err := r.cmd.Start(); err != nil {
		return fmt.Errorf("tcp_trace 실행 실패: %w", err)
	}

	log.Printf("[agent] tcp_trace 시작 (pid=%d, path=%s)", r.cmd.Process.Pid, r.binaryPath)

	// stdout → ch 변환 goroutine
	go func() {
		defer close(ch)
		defer r.cmd.Wait() // subprocess 종료 시 자원 정리

		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()

			var e model.Event
			if err := json.Unmarshal([]byte(line), &e); err != nil {
				// 파싱 실패는 버리고 계속 진행 (agent 시작 시 헤더 출력 등)
				log.Printf("[agent] JSON 파싱 실패: %v (원본: %s)", err, line)
				continue
			}

			ch <- e
		}

		log.Println("[agent] tcp_trace stdout 종료 — 이벤트 스트림 닫힘")
	}()

	return nil
}

// Stop — subprocess에 종료 신호를 보낸다.
// Start()의 goroutine이 ch를 닫고 스스로 종료된다.
func (r *Reader) Stop() {
	if r.cmd != nil && r.cmd.Process != nil {
		log.Println("[agent] tcp_trace 종료 요청")
		r.cmd.Process.Kill()
	}
}
