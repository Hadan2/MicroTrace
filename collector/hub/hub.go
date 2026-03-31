// hub/hub.go
//
// 역할: 연결된 WebSocket 클라이언트를 관리하고, 메시지를 브로드캐스트한다.
//
// 설계 원칙:
//   - Hub는 "누구에게 보낼지"만 안다. "무엇을 보낼지"는 모른다.
//   - stats, main 등 상위 패키지가 OutboundMsg를 만들어 Broadcast()에 넘긴다.
//   - gorilla/websocket 제약: 하나의 conn에 WriteMessage를 동시에 호출 불가.
//     → Run() 단일 goroutine에서만 WriteMessage를 호출한다.

package hub

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"microtrace/collector/model"
)

var upgrader = websocket.Upgrader{
	// 개발 중에는 모든 Origin 허용.
	// 프로덕션 전환 시 r.Header.Get("Origin") 검증 추가.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Hub — WebSocket 클라이언트 연결 집합과 브로드캐스트 채널
type Hub struct {
	mu        sync.Mutex
	clients   map[*websocket.Conn]bool
	broadcast chan []byte // JSON 직렬화된 OutboundMsg
}

// New — Hub를 생성한다. main에서 한 번만 호출한다.
func New() *Hub {
	return &Hub{
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan []byte, 512), // 버퍼 512: 통계 burst 대응
	}
}

// Run — broadcast 채널을 소비하며 모든 클라이언트에 전송하는 메인 루프.
//
// 반드시 별도 goroutine으로 실행: go hub.Run()
// broadcast 채널이 닫히면 루프가 종료된다.
func (h *Hub) Run() {
	for msg := range h.broadcast {
		h.mu.Lock()
		for conn := range h.clients {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				// 전송 실패 = 클라이언트 연결 끊김
				log.Printf("[hub] 클라이언트 전송 실패, 제거: %v", err)
				conn.Close()
				delete(h.clients, conn)
			}
		}
		h.mu.Unlock()
	}
}

// Broadcast — OutboundMsg를 JSON으로 직렬화해서 broadcast 채널에 넣는다.
//
// non-blocking: 채널 버퍼가 꽉 찼으면 이벤트를 버리고 로그만 남긴다.
// (느린 클라이언트 때문에 collector 전체가 막히지 않도록)
func (h *Hub) Broadcast(msg model.OutboundMsg) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[hub] JSON 직렬화 실패: %v", err)
		return
	}

	select {
	case h.broadcast <- data:
	default:
		log.Println("[hub] broadcast 버퍼 가득 참, 이벤트 드롭")
	}
}

// ServeWs — "/ws" HTTP 핸들러. HTTP → WebSocket 업그레이드 후 Hub에 등록한다.
func (h *Hub) ServeWs(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[hub] WebSocket 업그레이드 실패: %v", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = true
	count := len(h.clients)
	h.mu.Unlock()

	log.Printf("[hub] 클라이언트 연결: %s (현재 %d명)", r.RemoteAddr, count)

	// ReadMessage 루프 — 클라이언트 연결 끊김 감지용 goroutine
	// 브라우저 탭 닫힘 / 네트워크 끊김 → ReadMessage 에러 → unregister
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			h.mu.Unlock()
			conn.Close()
			log.Printf("[hub] 클라이언트 해제: %s", r.RemoteAddr)
		}()

		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

// ClientCount — 현재 연결된 클라이언트 수 (진단용)
func (h *Hub) ClientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}
