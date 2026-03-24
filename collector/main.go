// collector/main.go - Go collector
//
// 역할:
//   1. tcp_trace(C 에이전트)를 subprocess로 실행
//   2. stdout으로 나오는 JSON을 한 줄씩 읽음
//   3. JSON을 파싱해서 Event 구조체로 변환
//   4. 터미널에 출력 (확인용 - 나중에 WebSocket 스트리밍으로 교체)

package main

import (
	"bufio"          // 줄 단위로 읽기
	"encoding/json"  // JSON 파싱
	"fmt"            // 터미널 출력
	"log"            // 에러 로그
	"os"             // os.Stderr
	"os/exec"        // subprocess 실행
)

// ─────────────────────────────────────────────
// Event 구조체 - tcp_trace.c 의 JSON 출력과 필드가 일치해야 함
//
// json:"pid" → JSON의 "pid" 키와 이 필드를 연결
// ─────────────────────────────────────────────
type Event struct {
	Type      string `json:"type"`       // "connect" or "retransmit"
	PID       uint32 `json:"pid"`
	Comm      string `json:"comm"`
	DAddr     string `json:"daddr"`
	DPort     uint16 `json:"dport"`
	LatencyUs uint64 `json:"latency_us"` // connect 이벤트에서만 유효
}

// ─────────────────────────────────────────────
// 출력 함수 (나중에 WebSocket 전송으로 교체할 때 이 함수만 바꾸면 됨)
// ─────────────────────────────────────────────
func handleEvent(e Event) {
	if e.Type == "retransmit" {
		fmt.Printf("[RETRANSMIT] PID: %-6d  COMM: %-16s  ->  %s:%d\n",
			e.PID,
			e.Comm,
			e.DAddr,
			e.DPort,
		)
	} else {
		fmt.Printf("[CONNECT]    PID: %-6d  COMM: %-16s  ->  %s:%d  latency: %d us\n",
			e.PID,
			e.Comm,
			e.DAddr,
			e.DPort,
			e.LatencyUs,
		)
	}
}

func main() {
	// ── 1단계: tcp_trace subprocess 실행 ──────────
	// exec.Command: 실행할 프로그램과 인자를 지정
	// sudo 가 필요한 이유: eBPF 는 root 권한 필요
	cmd := exec.Command("sudo", "../agent/tcp_trace")

	// subprocess 의 stderr 를 그대로 이 프로세스의 stderr 로 연결
	// → "TCP 연결 추적 시작..." 메시지가 터미널에 보임
	cmd.Stderr = os.Stderr

	// subprocess 의 stdout 을 파이프로 연결
	// → tcp_trace 가 출력하는 JSON 을 Go 가 읽을 수 있게 됨
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatal("stdout 파이프 연결 실패:", err)
	}

	// subprocess 시작
	if err := cmd.Start(); err != nil {
		log.Fatal("tcp_trace 실행 실패:", err)
	}

	fmt.Println("collector 시작 - tcp_trace 이벤트 수신 중...")

	// ── 2단계: JSON 한 줄씩 읽기 ─────────────────
	// bufio.NewScanner: 스트림을 줄 단위로 읽는 스캐너
	// 기본적으로 \n 을 기준으로 한 줄을 구분
	scanner := bufio.NewScanner(stdout)

	for scanner.Scan() {
		// 한 줄 읽기 (blocking - 줄이 올 때까지 대기)
		line := scanner.Text()

		// ── 3단계: JSON 파싱 ──────────────────────
		var e Event
		// json.Unmarshal: JSON 문자열 → Event 구조체
		// []byte(line): string을 바이트 슬라이스로 변환 (Unmarshal이 요구하는 타입)
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			// 파싱 실패 시 그 줄은 건너뜀 (프로그램 종료 X)
			log.Printf("JSON 파싱 실패: %v (원본: %s)", err, line)
			continue
		}

		// ── 4단계: 이벤트 처리 ───────────────────
		handleEvent(e)
	}

	// subprocess 종료 대기
	cmd.Wait()
}
