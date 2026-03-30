# WebSocket

---

## 1. WebSocket이 뭔지

> "한 번 연결하면 서버와 클라이언트가 **서로** 계속 데이터를 주고받을 수 있는 통신 방식"

HTTP와 비교해서 이해하는 게 가장 빠릅니다.

### HTTP 통신 (지금까지 알던 방식)

```
클라이언트                  서버
    │                        │
    │──── 요청 (Request) ───▶│   "데이터 줘"
    │                        │
    │◀─── 응답 (Response) ───│   "여기 있어"
    │                        │
    │  (연결 끝)              │

    다시 데이터가 필요하면?
    │                        │
    │──── 요청 ─────────────▶│   또 물어봐야 함
    │◀─── 응답 ──────────────│
```

HTTP는 **단방향 요청-응답** 구조입니다. 클라이언트가 먼저 물어봐야만 서버가 답합니다.
서버에서 새로운 이벤트가 생겨도 클라이언트가 물어보기 전까지는 전달할 방법이 없습니다.

### WebSocket 통신

```
클라이언트                  서버
    │                        │
    │── Upgrade 요청 ────────▶│   "HTTP에서 WebSocket으로 바꾸자"
    │◀── 101 Switching ───────│   "좋아, 바꾸자"
    │                        │
    │═══════════════════════════════  ← 연결이 열린 채로 유지
    │                        │
    │◀── 이벤트 데이터 ────────│   서버가 먼저 보낼 수 있음
    │◀── 이벤트 데이터 ────────│   계속 보낼 수 있음
    │                        │
    │──── 메시지 ────────────▶│   클라이언트도 보낼 수 있음
    │                        │
    │◀── 이벤트 데이터 ────────│   동시에 쌍방향
```

WebSocket은 **양방향 지속 연결** 구조입니다. 연결을 한 번 맺으면 서버가 클라이언트에게 먼저 데이터를 밀어넣을 수 있습니다 (Push).

---

## 2. 왜 MicroTrace에 필요한가

eBPF가 RTT 이벤트를 감지하는 건 **서버(에이전트)** 쪽에서 일어나는 일입니다.
브라우저 대시보드는 **클라이언트**입니다.

```
현재 구조:
  eBPF 이벤트 발생 → collector → 터미널 출력 (끝)
                                       ↑
                           브라우저가 볼 수 없음

HTTP 폴링 방식 (비효율적):
  브라우저가 0.5초마다 "새 이벤트 있어?" 물어봄
  → 이벤트가 없어도 계속 요청
  → 낭비, 실시간성도 떨어짐

WebSocket 방식:
  eBPF 이벤트 발생 → collector → WebSocket → 브라우저에 즉시 Push
                                                   ↑
                                    이벤트 발생하는 순간 바로 그래프에 반영
```

RTT 이벤트는 언제 발생할지 모릅니다. 브라우저가 계속 물어보는 것보다, 이벤트가 생기면 서버가 즉시 밀어주는 게 훨씬 효율적이고 실시간에 가깝습니다.

---

## 3. HTTP → WebSocket 전환 과정 (Handshake)

WebSocket은 HTTP 위에서 시작합니다. HTTP 연결을 WebSocket으로 "업그레이드"하는 과정이 있습니다.

```
① 클라이언트가 일반 HTTP 요청을 보냄 (특별한 헤더 포함)

GET /ws HTTP/1.1
Host: localhost:8080
Upgrade: websocket          ← "WebSocket으로 업그레이드 원함"
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==   ← 랜덤 키 (보안용)
Sec-WebSocket-Version: 13

② 서버가 동의하면 101 응답

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=  ← 키로 계산한 값

③ 이 시점부터 HTTP가 아닌 WebSocket 프레임 형식으로 통신
```

101은 특수한 HTTP 상태 코드입니다. "프로토콜 전환" 을 의미합니다.

---

## 4. WebSocket 프레임 구조

연결이 수립된 후 데이터는 **프레임(Frame)** 단위로 주고받습니다.

```
WebSocket 프레임:
┌──────────────────────────────────────────┐
│ FIN │ RSV │ Opcode │ MASK │ Payload Len  │  ← 헤더 (2바이트 이상)
├──────────────────────────────────────────┤
│            Masking Key (선택)             │  ← 클라이언트→서버 시에만 필수
├──────────────────────────────────────────┤
│            Payload Data                  │  ← 실제 데이터
└──────────────────────────────────────────┘
```

- **Opcode**: 이 프레임이 뭔지 구분
  - `0x1`: Text 프레임 (UTF-8 문자열, JSON 보낼 때)
  - `0x2`: Binary 프레임 (바이트 데이터)
  - `0x8`: Close 프레임 (연결 종료)
  - `0x9`: Ping 프레임 (살아있는지 확인)
  - `0xA`: Pong 프레임 (Ping에 대한 응답)
- **MASK**: 클라이언트→서버 방향은 반드시 마스킹해야 함 (보안 규칙, RFC 6455)
- MicroTrace에서는 서버→클라이언트 방향이므로 마스킹 불필요

실제로 이 구조를 직접 다룰 일은 없습니다. `gorilla/websocket` 라이브러리가 내부적으로 처리합니다.

---

## 5. HTTP Polling vs SSE vs WebSocket 비교

WebSocket 외에도 서버→클라이언트 실시간 전송 방법이 있습니다. 차이를 알아두면 왜 WebSocket을 선택했는지 이해됩니다.

```
방법 1: HTTP Polling (클라이언트가 계속 물어봄)
  브라우저 → "이벤트 있어?" → 서버 (500ms마다 반복)
  단점: 이벤트 없어도 요청 발생, 지연 최대 500ms

방법 2: Long Polling
  브라우저 → "이벤트 있으면 줘" → 서버 (이벤트 생길 때까지 응답 안 함)
  → 이벤트 발생 → 응답 → 브라우저가 다시 요청
  단점: 연결을 계속 새로 맺어야 함, 복잡함

방법 3: SSE (Server-Sent Events)
  서버 → 클라이언트 단방향 스트림 (HTTP 기반)
  장점: 단순함, 자동 재연결
  단점: 클라이언트→서버 메시지 불가, 단방향만

방법 4: WebSocket ← MicroTrace 선택
  서버 ↔ 클라이언트 양방향 지속 연결
  장점: 낮은 지연, 양방향, 효율적
  단점: HTTP보다 구현이 약간 복잡
```

MicroTrace는 나중에 브라우저에서 "이 서비스만 추적해줘" 같은 제어 메시지도 보낼 수 있어야 하므로 양방향인 WebSocket이 적합합니다.

---

## 6. gorilla/websocket — Go에서 WebSocket 쓰는 방법

Go 표준 라이브러리에는 WebSocket이 없습니다. `gorilla/websocket`이 사실상 표준으로 쓰이는 서드파티 라이브러리입니다.

```bash
# 설치
go get github.com/gorilla/websocket
```

### 서버 쪽 코드 흐름

```go
import "github.com/gorilla/websocket"

// ① Upgrader: HTTP → WebSocket 업그레이드 담당 객체
var upgrader = websocket.Upgrader{
    // 어떤 Origin에서 오는 연결이든 허용
    // (개발 중이라 도메인 체크 안 함)
    CheckOrigin: func(r *http.Request) bool { return true },
}

// ② HTTP 핸들러 — "/ws" 경로로 요청이 오면 WebSocket으로 업그레이드
func wsHandler(w http.ResponseWriter, r *http.Request) {
    // HTTP 연결을 WebSocket 연결로 업그레이드
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        return
    }
    defer conn.Close()

    // ③ 이 시점부터 conn으로 데이터 주고받기
    // conn.WriteMessage(): 클라이언트에 메시지 보내기
    // conn.ReadMessage(): 클라이언트 메시지 받기
}

func main() {
    http.HandleFunc("/ws", wsHandler)
    http.ListenAndServe(":8080", nil)
}
```

### 데이터 보내기

```go
// Text 메시지 보내기 (JSON 문자열)
conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"rtt","latency":123}`))

// Binary 메시지 보내기
conn.WriteMessage(websocket.BinaryMessage, someBytes)
```

### 살아있는지 확인 (Ping/Pong)

```go
// 서버가 Ping 보내기
conn.WriteMessage(websocket.PingMessage, nil)

// 클라이언트가 Pong으로 자동 응답 (gorilla가 자동 처리)
conn.SetPongHandler(func(string) error {
    // Pong 받을 때마다 타임아웃 리셋
    conn.SetReadDeadline(time.Now().Add(60 * time.Second))
    return nil
})
```

---

## 7. MicroTrace에서 WebSocket의 전체 흐름

WebSocket이 추가되면 데이터가 이렇게 흐릅니다:

```
[eBPF 커널]
    │
    │ Ring Buffer
    ▼
[tcp_trace (C)]  → stdout JSON → [Go collector]
                                        │
                              ┌─────────┴──────────┐
                              │    goroutine 1      │
                              │  (이벤트 수신 루프)  │
                              │  scanner.Scan()     │
                              │  → JSON 파싱        │
                              │  → channel에 넣기   │
                              └─────────┬──────────┘
                                        │ channel
                              ┌─────────▼──────────┐
                              │    goroutine 2      │
                              │  (WebSocket 허브)   │
                              │  channel에서 꺼내기  │
                              │  → 연결된 모든 클라   │
                              │    이언트에 브로드캐스트│
                              └─────────┬──────────┘
                                        │ WebSocket
                              ┌─────────▼──────────┐
                              │    브라우저 (Wails)  │
                              │  JS onmessage()     │
                              │  → 그래프 업데이트   │
                              └────────────────────┘
```

핵심은 **channel**입니다. 이벤트 수신과 WebSocket 브로드캐스트를 별개의 goroutine으로 분리하고, channel로 연결합니다. 이렇게 해야 이벤트 수신이 느린 클라이언트 때문에 블로킹되지 않습니다.

---

## 8. 브로드캐스트 허브 패턴

클라이언트가 여러 명 붙을 수 있으므로 **허브(Hub)** 패턴을 씁니다.

```
상황: 브라우저 창을 3개 열었을 때

                 ┌── conn1 (브라우저 탭 1)
이벤트 → 허브 ───┼── conn2 (브라우저 탭 2)
                 └── conn3 (브라우저 탭 3)

허브가 하는 일:
  1. 새 클라이언트 연결 → clients 맵에 추가
  2. 클라이언트 연결 끊김 → clients 맵에서 제거
  3. 이벤트 도착 → clients 맵 순회하며 모든 conn에 WriteMessage
```

Go 코드로 표현하면:

```go
type Hub struct {
    clients   map[*websocket.Conn]bool  // 연결된 클라이언트 목록
    broadcast chan []byte               // 보낼 데이터를 받는 channel
    register  chan *websocket.Conn      // 새 클라이언트 등록 channel
    unregister chan *websocket.Conn     // 클라이언트 해제 channel
}

func (h *Hub) Run() {
    for {
        select {
        case conn := <-h.register:
            h.clients[conn] = true           // 새 클라이언트 추가

        case conn := <-h.unregister:
            delete(h.clients, conn)          // 클라이언트 제거
            conn.Close()

        case msg := <-h.broadcast:
            for conn := range h.clients {    // 모든 클라이언트에 전송
                conn.WriteMessage(websocket.TextMessage, msg)
            }
        }
    }
}
```

`select`는 여러 channel 중 준비된 것 하나를 골라 처리하는 Go 문법입니다.

---

## 9. 클라이언트(브라우저) 쪽 JavaScript

브라우저에서 WebSocket을 사용하는 코드입니다. Wails 대시보드의 React 쪽에서 이 방식을 씁니다.

```javascript
// WebSocket 연결
const ws = new WebSocket("ws://localhost:8080/ws");

// 연결 성공 시
ws.onopen = () => {
    console.log("WebSocket 연결됨");
};

// 서버에서 메시지 도착 시 (이벤트 발생마다 자동 호출)
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // data = { type: "rtt", latency_us: 1234, daddr: "172.17.0.3", ... }

    // 그래프에 데이터 추가하는 함수 호출
    updateGraph(data);
};

// 연결 끊겼을 때 (서버 재시작 등)
ws.onclose = () => {
    console.log("연결 끊김, 재연결 시도...");
    setTimeout(() => reconnect(), 3000);  // 3초 후 재연결
};

// 에러 발생 시
ws.onerror = (error) => {
    console.error("WebSocket 에러:", error);
};
```

---

## 10. WebSocket과 HTTP는 포트를 공유할 수 있다

자주 오해하는 부분입니다.

```
같은 서버, 같은 포트에서:

GET http://localhost:8080/        → 일반 HTTP (대시보드 HTML)
GET ws://localhost:8080/ws        → WebSocket 업그레이드

http://  → 일반 HTTP
ws://    → WebSocket (내부적으로 HTTP Upgrade 요청)
https:// → HTTPS
wss://   → WebSocket over TLS (보안 연결)
```

Go에서 같은 `http.ServeMux`에 경로만 다르게 등록하면 됩니다:

```go
http.HandleFunc("/", htmlHandler)    // HTML 페이지 제공
http.HandleFunc("/ws", wsHandler)    // WebSocket 업그레이드
http.ListenAndServe(":8080", nil)
```
