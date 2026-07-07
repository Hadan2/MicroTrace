//go:build ignore

// verify-resolver.go — collector WebSocket에 붙어 "IP가 실제로 서비스명으로
// resolve 되는지"를 런타임에서 관측하는 검증 클라이언트.
//
// 왜 이게 필요한가:
//   resolver 코드가 컴파일된다고 이름이 붙는 건 아니다. 실제로 collector를 띄우고
//   WebSocket으로 오는 stats/event 메시지의 src_service/dst_service를 봐야
//   "172.19.0.2" 같은 IP가 아니라 "service-a" 같은 이름이 나오는지 알 수 있다.
//   이 프로그램은 그 판정을 사람 말이 아니라 exit code로 낸다.
//
// 사용:
//   go run scripts/verify-resolver.go -url ws://localhost:9090/ws -timeout 15s
//
// 종료 코드:
//   0  기대한 이름이 최소 1개 관측됨 (통과)
//   1  타임아웃까지 이름이 안 붙음(전부 IP) 또는 접속 실패 (실패)
//
// collector 모듈 안에서 실행되므로 gorilla/websocket 의존성을 그대로 쓴다.

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// collector가 보내는 메시지의 필요한 필드만 추린 구조.
// hub/model의 실제 타입을 import하지 않는 이유: 검증기는 "관측자"라
// 내부 타입에 결합되지 않는 편이 낫다. 필드명(JSON 태그)만 맞으면 된다.
type wsMsg struct {
	Type  string `json:"msg_type"`
	Stats *struct {
		Src string `json:"src_service"`
		Dst string `json:"dst_service"`
	} `json:"stats"`
	Event *struct {
		Src string `json:"src_service"`
		Dst string `json:"dst_service"`
	} `json:"event"`
}

func main() {
	url := flag.String("url", "ws://localhost:9090/ws", "collector WebSocket URL")
	timeout := flag.Duration("timeout", 15*time.Second, "이름이 관측될 때까지 최대 대기")
	expect := flag.String("expect", "", "쉼표로 구분한 기대 이름들(예: service-a,service-b). 비면 'IP가 아니면 통과'")
	flag.Parse()

	var want []string
	for _, s := range strings.Split(*expect, ",") {
		if s = strings.TrimSpace(s); s != "" {
			want = append(want, s)
		}
	}

	deadline := time.Now().Add(*timeout)
	var conn *websocket.Conn
	var err error

	// collector가 아직 안 떴을 수 있으니 접속을 재시도한다.
	for time.Now().Before(deadline) {
		conn, _, err = websocket.DefaultDialer.Dial(*url, nil)
		if err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if conn == nil {
		fmt.Fprintf(os.Stderr, "[verify] 접속 실패: %s (%v)\n", *url, err)
		os.Exit(1)
	}
	defer conn.Close()
	fmt.Fprintf(os.Stderr, "[verify] 접속됨: %s\n", *url)

	// 관측된 값들을 모아 실패 시 진단에 쓴다.
	seenNames := map[string]bool{}
	seenIPs := map[string]bool{}

	conn.SetReadDeadline(deadline)
	for {
		var raw json.RawMessage
		if err := conn.ReadJSON(&raw); err != nil {
			break // 타임아웃 또는 연결 종료 → 루프 탈출 후 판정
		}
		var m wsMsg
		if json.Unmarshal(raw, &m) != nil {
			continue
		}

		for _, name := range namesOf(m) {
			if name == "" || name == "localhost" {
				// localhost: 이 검증기 자신이 collector WebSocket(127.0.0.1)에
				// 접속하며 발생시킨 루프백 연결의 rDNS 결과. 판정 대상이 아니다.
				continue
			}
			if isIP(name) {
				seenIPs[name] = true
				continue
			}
			seenNames[name] = true

			// 판정: expect가 주어졌으면 그 이름을 봐야 통과, 아니면 아무 이름이나 통과.
			if len(want) == 0 || contains(want, name) {
				fmt.Fprintf(os.Stderr, "[verify] ✅ 이름 관측: %q → 통과\n", name)
				os.Exit(0)
			}
		}
	}

	// 여기 도달 = 타임아웃까지 기대한 이름 못 봄 → 실패. 진단 출력.
	fmt.Fprintf(os.Stderr, "[verify] ❌ 실패: 기대한 이름이 관측되지 않음\n")
	fmt.Fprintf(os.Stderr, "  기대: %v\n", want)
	fmt.Fprintf(os.Stderr, "  관측된 이름: %v\n", keys(seenNames))
	fmt.Fprintf(os.Stderr, "  관측된 IP(이름 안 붙음): %v\n", keys(seenIPs))
	if len(seenNames) == 0 && len(seenIPs) == 0 {
		fmt.Fprintf(os.Stderr, "  (아무 stats/event 메시지도 못 받음 — 트래픽이 없거나 collector가 이벤트를 못 잡음)\n")
	}
	os.Exit(1)
}

func namesOf(m wsMsg) []string {
	switch {
	case m.Stats != nil:
		return []string{m.Stats.Src, m.Stats.Dst}
	case m.Event != nil:
		return []string{m.Event.Src, m.Event.Dst}
	}
	return nil
}

// isIP — 값이 순수 IP(이름 미해석)인지. IPv4/IPv6 모두.
func isIP(s string) bool { return net.ParseIP(s) != nil }

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
