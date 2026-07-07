// agent/reader.go
//
// EventProvider 인터페이스 — 이벤트를 공급하는 방법을 격리한다.
//
// 현재 구현: SubprocessProvider (tcp_trace 바이너리를 subprocess로 실행)
// 미래 구현: RemoteProvider (EC2 멀티호스트 환경, gRPC로 수신)
//
// 호출 측(collector/main.go)은 이 인터페이스만 보고, 구현체가 무엇인지 몰라야 한다.
//
// 와이어 포맷(Issue #9): agent와 동일한 MICROTRACE_WIRE로 JSON/Protobuf를 고른다.
//   - json(기본): agent가 개행 구분 JSON 한 줄씩 출력 → json.Unmarshal
//   - pb:          agent가 4바이트 길이(LE) + protobuf 본문 → nanopb와 짝

package agent

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"

	"google.golang.org/protobuf/proto"
	"microtrace/collector/model"
	pb "microtrace/collector/model/pb"
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
	protobuf   bool // MICROTRACE_WIRE=pb 면 true. agent와 반드시 일치해야 한다.
}

// NewSubprocessProvider — SubprocessProvider를 생성한다.
// 와이어 포맷은 MICROTRACE_WIRE 환경변수로 agent와 맞춘다(pb 면 Protobuf, 아니면 JSON).
func NewSubprocessProvider(binaryPath string) *SubprocessProvider {
	wire := os.Getenv("MICROTRACE_WIRE")
	return &SubprocessProvider{
		binaryPath: binaryPath,
		protobuf:   len(wire) > 0 && (wire[0] == 'p' || wire[0] == 'P'),
	}
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

	wireName := "json"
	if p.protobuf {
		wireName = "protobuf"
	}
	log.Printf("[agent] tcp_trace 시작 (pid=%d, path=%s, wire=%s)", cmd.Process.Pid, p.binaryPath, wireName)

	ch := make(chan model.Event, 1024)

	go func() {
		defer close(ch)
		defer cmd.Wait()

		if p.protobuf {
			readProtobuf(ctx, stdout, ch)
		} else {
			readJSON(ctx, stdout, ch)
		}

		log.Println("[agent] tcp_trace stdout 종료 — 이벤트 스트림 닫힘")
	}()

	return ch, nil
}

// readJSON — 개행 구분 JSON을 한 줄씩 파싱한다(기존 경로).
func readJSON(ctx context.Context, r io.Reader, ch chan<- model.Event) {
	scanner := bufio.NewScanner(r)
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
}

// readProtobuf — 4바이트 길이(LE) + protobuf 본문 프레이밍을 디코딩한다(Issue #9).
func readProtobuf(ctx context.Context, r io.Reader, ch chan<- model.Event) {
	br := bufio.NewReaderSize(r, 1<<16)
	var lenBuf [4]byte
	buf := make([]byte, 0, 256)

	for {
		if _, err := io.ReadFull(br, lenBuf[:]); err != nil {
			if err != io.EOF && err != io.ErrUnexpectedEOF {
				log.Printf("[agent] 길이 프리픽스 읽기 실패: %v", err)
			}
			return
		}
		n := binary.LittleEndian.Uint32(lenBuf[:])
		if cap(buf) < int(n) {
			buf = make([]byte, n)
		}
		buf = buf[:n]
		if _, err := io.ReadFull(br, buf); err != nil {
			log.Printf("[agent] protobuf 본문 읽기 실패: %v", err)
			return
		}

		var m pb.Event
		if err := proto.Unmarshal(buf, &m); err != nil {
			log.Printf("[agent] protobuf 파싱 실패: %v", err)
			continue
		}

		e := model.Event{
			Type:      m.Type,
			PID:       m.Pid,
			Comm:      m.Comm,
			SAddr:     m.Saddr,
			DAddr:     m.Daddr,
			DPort:     uint16(m.Dport),
			LatencyUs: m.LatencyUs,
			JitterUs:  m.JitterUs,
		}
		select {
		case ch <- e:
		case <-ctx.Done():
			return
		}
	}
}
