// collector/main.go - Go collector
//
// 역할:
//   1. tcp_trace(C 에이전트)를 subprocess로 실행
//   2. stdout으로 나오는 JSON을 한 줄씩 읽음
//   3. JSON을 파싱해서 Event 구조체로 변환
//   4. 연결된 모든 WebSocket 클라이언트에 브로드캐스트
//   5. HTTP 서버: /ws (WebSocket), / (테스트용 HTML)

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"

	"github.com/gorilla/websocket"
)

// ─────────────────────────────────────────────
// Event 구조체 - tcp_trace.c 의 JSON 출력과 필드가 일치해야 함
// ─────────────────────────────────────────────
type Event struct {
	Type      string `json:"type"`       // "connect", "rtt", "retransmit"
	PID       uint32 `json:"pid"`        // 실제로는 local_port (소켓 식별용)
	Comm      string `json:"comm"`       // sock_ops 제한으로 항상 빈 문자열
	DAddr     string `json:"daddr"`
	DPort     uint16 `json:"dport"`
	LatencyUs uint64 `json:"latency_us"` // connect/rtt 이벤트에서 유효
}

// ─────────────────────────────────────────────
// Hub - WebSocket 클라이언트 연결을 관리하고 브로드캐스트를 담당
//
// 구조:
//   clients   : 현재 연결된 WebSocket 클라이언트 목록
//   broadcast : 보낼 메시지를 받는 channel (이벤트 수신 goroutine → Hub)
//
// 흐름:
//   이벤트 수신 goroutine → hub.broadcast <- msg
//                           → Hub.Run()이 모든 clients에 WriteMessage
// ─────────────────────────────────────────────
type Hub struct {
	mu        sync.Mutex
	clients   map[*websocket.Conn]bool
	broadcast chan []byte
}

func newHub() *Hub {
	return &Hub{
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan []byte, 256), // 버퍼 256: 이벤트 폭발 시 손실 방지
	}
}

// Run: Hub의 메인 루프. 별도 goroutine으로 실행됨.
//
// broadcast channel에 메시지가 들어오면 모든 클라이언트에 전송.
// WriteMessage는 반드시 이 goroutine 하나에서만 호출해야 함
// (gorilla/websocket은 동시 WriteMessage를 허용하지 않음).
func (h *Hub) Run() {
	for msg := range h.broadcast {
		h.mu.Lock()
		for conn := range h.clients {
			err := conn.WriteMessage(websocket.TextMessage, msg)
			if err != nil {
				// 전송 실패 = 클라이언트 연결 끊김
				// Run() 안에서 직접 close/delete하면 Lock 중 map 변경이라 안전하지 않음
				// → unregister는 serveWs의 ReadMessage 루프에서 처리됨
				conn.Close()
				delete(h.clients, conn)
			}
		}
		h.mu.Unlock()
	}
}

func (h *Hub) register(conn *websocket.Conn) {
	h.mu.Lock()
	h.clients[conn] = true
	h.mu.Unlock()
}

func (h *Hub) unregister(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
	conn.Close()
}

// ─────────────────────────────────────────────
// WebSocket Upgrader
//
// HTTP 요청을 WebSocket 연결로 업그레이드하는 객체.
// CheckOrigin: 개발 중에는 모든 Origin 허용.
//   (프로덕션에서는 도메인 검증 필요)
// ─────────────────────────────────────────────
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// serveWs: "/ws" 경로 핸들러
//
// HTTP → WebSocket 업그레이드 후 클라이언트를 Hub에 등록.
// ReadMessage 루프로 연결이 살아있는지 감지.
// 클라이언트가 끊기면 Hub에서 제거.
func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket 업그레이드 실패:", err)
		return
	}

	hub.register(conn)
	log.Printf("클라이언트 연결: %s (현재 %d명)", r.RemoteAddr, len(hub.clients))

	// ReadMessage 루프: 클라이언트 연결 끊김 감지용
	// 브라우저가 탭을 닫거나 연결을 끊으면 ReadMessage가 에러 반환
	// → unregister 호출 → goroutine 종료 (goroutine 누수 방지)
	go func() {
		defer hub.unregister(conn)
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				// 정상 종료(1000) 또는 비정상 종료 모두 여기서 처리
				log.Printf("클라이언트 연결 끊김: %s", r.RemoteAddr)
				return
			}
		}
	}()
}

// ─────────────────────────────────────────────
// 테스트용 HTML 핸들러
//
// 브라우저에서 localhost:8080 접속 시 간단한 HTML 페이지 제공.
// WebSocket 연결을 맺고 수신한 이벤트를 화면에 출력.
// Wails 대시보드 완성 전까지 동작 확인용으로 사용.
// ─────────────────────────────────────────────
func serveHome(w http.ResponseWriter, r *http.Request) {
	fmt.Fprint(w, `<!DOCTYPE html>
<html>
<head>
  <title>MicroTrace</title>
  <style>
    body { font-family: monospace; background: #1a1a1a; color: #00ff88; padding: 20px; }
    h2   { color: #ffffff; }
    #log { height: 80vh; overflow-y: auto; border: 1px solid #333; padding: 10px; }
    .connect    { color: #00aaff; }
    .rtt        { color: #00ff88; }
    .retransmit { color: #ff4444; }
  </style>
</head>
<body>
  <h2>MicroTrace — Live Events</h2>
  <div id="status">연결 중...</div>
  <div id="log"></div>
  <script>
    const log = document.getElementById('log');
    const status = document.getElementById('status');

    function connect() {
      const ws = new WebSocket('ws://' + location.hostname + ':9090/ws');

      ws.onopen = () => {
        status.textContent = '● 연결됨';
        status.style.color = '#00ff88';
      };

      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        const div = document.createElement('div');
        div.className = d.type;

        if (d.type === 'retransmit') {
          div.textContent = '[RETRANSMIT] lport:' + d.pid + ' → ' + d.daddr + ':' + d.dport;
        } else if (d.type === 'rtt') {
          div.textContent = '[RTT]        lport:' + d.pid + ' → ' + d.daddr + ':' + d.dport + '  rtt:' + d.latency_us + ' us';
        } else {
          div.textContent = '[CONNECT]    lport:' + d.pid + ' → ' + d.daddr + ':' + d.dport + '  rtt:' + d.latency_us + ' us';
        }

        log.prepend(div); // 최신 이벤트가 위에 쌓임
      };

      ws.onclose = () => {
        status.textContent = '● 연결 끊김 — 3초 후 재연결';
        status.style.color = '#ff4444';
        setTimeout(connect, 3000);
      };
    }

    connect();
  </script>
</body>
</html>`)
}

// ─────────────────────────────────────────────
// handleEvent: 이벤트를 Hub의 broadcast channel에 넣기
//
// 이전: 터미널에 fmt.Printf로 출력
// 현재: JSON으로 직렬화해서 broadcast channel에 넣기
//       → Hub.Run()이 모든 WebSocket 클라이언트에 전송
// ─────────────────────────────────────────────
func handleEvent(hub *Hub, e Event) {
	msg, err := json.Marshal(e)
	if err != nil {
		log.Printf("JSON 직렬화 실패: %v", err)
		return
	}
	// non-blocking send: 버퍼가 꽉 찼으면 이벤트를 버림 (로그만 남김)
	select {
	case hub.broadcast <- msg:
	default:
		log.Println("broadcast 버퍼 가득 참, 이벤트 드롭")
	}
}

func main() {
	hub := newHub()
	go hub.Run() // Hub 메인 루프를 별도 goroutine으로 실행

	// ── HTTP 서버 라우팅 설정 ──────────────────────
	http.HandleFunc("/", serveHome)
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})

	// ── 1단계: tcp_trace subprocess 실행 ──────────
	cmd := exec.Command("sudo", "../agent/tcp_trace")
	cmd.Stderr = os.Stderr

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatal("stdout 파이프 연결 실패:", err)
	}

	if err := cmd.Start(); err != nil {
		log.Fatal("tcp_trace 실행 실패:", err)
	}

	// ── 2단계: HTTP 서버를 goroutine으로 실행 ────────
	// HTTP 서버는 배경 인프라. goroutine으로 띄우고 메인은 agent 데이터 수신 담당.
	addr := ":9090"
	go func() {
		log.Printf("collector 시작 — http://localhost%s", addr)
		log.Printf("WebSocket 엔드포인트: ws://localhost%s/ws", addr)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatal(err)
		}
	}()

	// ── 3단계: JSON 수신 루프 (메인 goroutine) ──────
	// 프로그램 수명이 agent에 달려 있음.
	// agent가 종료되면 scanner 루프 끝 → cmd.Wait() 반환 → 프로그램 종료.
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()

		var e Event
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			log.Printf("JSON 파싱 실패: %v (원본: %s)", err, line)
			continue
		}

		handleEvent(hub, e)
	}
	cmd.Wait()
}
