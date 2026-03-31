# Go 언어 기초

## Go가 뭔지

Google이 만든 언어. C처럼 빠르고, Python처럼 쓰기 쉬운 것을 목표로 설계됨.
MicroTrace에서는 eBPF Agent(C)가 수집한 데이터를 받아서 처리하고 스트리밍하는 백엔드 역할로 사용.

---

## 기본 문법

### 변수 선언

```go
// 방법 1: 타입 명시
var name string = "MicroTrace"
var port int = 8080

// 방법 2: 타입 추론 (Go가 알아서 타입 결정)
var name = "MicroTrace"

// 방법 3: := 단축 선언 (함수 안에서만 사용 가능)
name := "MicroTrace"
port := 8080
```

C와 다른 점: 타입이 변수명 뒤에 옴 (`int port` → `port int`)

### 함수

```go
// 기본 함수
func add(a int, b int) int {
    return a + b
}

// 반환값 여러 개 (Go의 특징)
func divide(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("0으로 나눌 수 없음")
    }
    return a / b, nil  // nil = 에러 없음
}

// 호출
result, err := divide(10, 2)
```

### 구조체 (struct)

```go
// C의 struct와 거의 같음
type Event struct {
    PID   uint32
    DAddr uint32
    DPort uint16
    Comm  string
}

// 생성
e := Event{
    PID:   1234,
    DPort: 443,
    Comm:  "curl",
}

// 접근
fmt.Println(e.PID)  // 1234
```

---

## 에러 처리 (Go 특유의 방식)

Go에는 try/catch가 없음. 함수가 에러를 직접 반환함.

```go
// 에러를 반환값으로 넘김
result, err := someFunction()
if err != nil {       // err이 nil이 아니면 에러 발생
    fmt.Println(err)  // 에러 출력
    return            // 또는 종료
}
// 에러 없으면 result 사용
```

처음엔 번거로워 보이지만, 에러가 어디서 발생하는지 코드에서 명확하게 보임.

---

## goroutine (경량 스레드)

Go의 핵심 기능. 함수 앞에 `go`만 붙이면 동시에 실행됨.

```go
func receiveEvents() {
    // 이벤트 계속 받기
}

func streamToClient() {
    // 클라이언트에 계속 보내기
}

func main() {
    go receiveEvents()   // 동시 실행
    go streamToClient()  // 동시 실행
    // 두 함수가 동시에 돌아감
}
```

C의 pthread보다 훨씬 가볍고 간단함. 수만 개도 동시에 실행 가능.

---

## channel (goroutine 간 데이터 전달)

goroutine끼리 데이터를 안전하게 주고받는 통로.

```go
// channel 생성 (Event 타입 데이터가 오가는 통로)
ch := make(chan Event)

// goroutine A: 데이터 보내기
go func() {
    ch <- event  // channel에 넣기
}()

// goroutine B: 데이터 받기
e := <-ch  // channel에서 꺼내기
```

```
[goroutine A] → ch → [goroutine B]
                채널
```

공유 메모리 없이 데이터를 전달해서 race condition(동시 접근 충돌) 문제가 없음.

---

## os/exec (subprocess 실행)

Go에서 다른 프로그램을 자식 프로세스로 실행하는 패키지.

```go
import "os/exec"

cmd := exec.Command("./tcp_trace")  // 실행할 프로그램
stdout, _ := cmd.StdoutPipe()       // stdout을 파이프로 연결
cmd.Start()                          // 실행

// 이제 stdout에서 읽으면 tcp_trace의 출력이 들어옴
```

---

## go.mod (모듈 시스템)

Go 프로젝트의 **신분증** 같은 파일. 프로젝트 이름, Go 버전, 외부 패키지 목록을 정의함.

```
module microtrace/testenv   // 이 프로젝트 이름
go 1.22.3                   // Go 버전
```

`go build`, `go run` 실행 시 Go가 "이 폴더가 어느 프로젝트에 속하는지"를 go.mod로 판단.
없으면 `cannot find main module` 오류 발생.

비슷한 것: Python의 `requirements.txt`, Node.js의 `package.json`

```bash
go mod init microtrace/testenv  # go.mod 생성
```

---

## for 문법

Go는 반복문이 `for` 하나뿐. 3가지 형태:

```go
// 형태 1: 무한 루프 (다른 언어의 while(true))
for {
    // Ctrl+C 전까지 계속 반복
}

// 형태 2: 조건부 루프 (다른 언어의 while)
for i < 10 {
    // i가 10 미만일 때만 반복
}

// 형태 3: 일반 for 루프
for i := 0; i < 10; i++ {
    // 0~9 반복
}
```

---

## defer (지연 실행)

"지금 당장 말고, 이 함수가 끝날 때 실행해줘" 라는 키워드.

```go
func main() {
    f, _ := os.Open("file.txt")
    defer f.Close()   // main() 끝날 때 자동으로 Close() 호출

    // ... 파일 사용 ...
}   // ← 여기서 f.Close() 자동 실행
```

파일, 네트워크 연결 등 반드시 닫아야 하는 리소스에 사용.

---

## HTTP 클라이언트 (net/http)

```go
// 클라이언트 생성
client := &http.Client{
    Transport: &http.Transport{
        DisableKeepAlives: false,  // false = Keep-Alive 사용 (연결 재사용)
                                   // true  = 매 요청마다 새 TCP 연결
    },
    Timeout: 3 * time.Second,     // 3초 안에 응답 없으면 실패 처리
}

// GET 요청
resp, err := client.Get("http://localhost:8080/ping")
if err != nil {
    log.Printf("실패: %v", err)
    return
}

// ⚠️ Body를 끝까지 읽고 닫아야 연결이 풀에 반환됨
// 안 읽고 닫으면 연결 재사용 불가 → 매번 새 TCP 연결
io.Copy(io.Discard, resp.Body)
resp.Body.Close()
```

**Keep-Alive가 동작하려면 두 조건 모두 필요:**
1. 클라이언트: `DisableKeepAlives: false` + Body 끝까지 읽기
2. 서버: `IdleTimeout` 명시 (없으면 `ReadTimeout` 값 사용 → 짧으면 자주 끊김)

---

## HTTP 서버 (net/http)

```go
// 핸들러 함수 - 특정 경로로 요청이 오면 자동 호출
func pingHandler(w http.ResponseWriter, r *http.Request) {
    // w: 응답 쓰는 통로 (여기에 쓰면 클라이언트로 전송)
    // r: 요청 정보 (경로, 헤더, 바디 등)
    fmt.Fprintf(w, "pong")
}

func main() {
    // "/ping" 경로 → pingHandler 함수 연결
    // 등록 안 된 경로로 요청하면 자동 404 응답
    http.HandleFunc("/ping", pingHandler)

    srv := &http.Server{
        Addr:        ":8080",
        ReadTimeout: 5 * time.Second,   // 요청 읽기 최대 5초
        IdleTimeout: 60 * time.Second,  // Keep-Alive 연결 유지 시간 (필수!)
    }
    log.Fatal(srv.ListenAndServe())
}
```

---

## io.Copy / io.Discard

**`io.Copy(dst, src)`** — src에서 읽어서 dst로 복사

```go
io.Copy(파일, resp.Body)      // Body 내용을 파일에 저장
io.Copy(os.Stdout, resp.Body) // Body 내용을 터미널에 출력
io.Copy(io.Discard, resp.Body) // Body 내용을 버림 (읽기만 하고 저장 안 함)
```

**`io.Discard`** — 쓰레기통. 데이터를 받아서 그냥 버림.

```
resp.Body → io.Copy → io.Discard
               ↑              ↑
          끝까지 읽음      결과는 버림
```

HTTP 응답 Body를 사용하지 않더라도 Go 연결 풀 반환을 위해 끝까지 읽어야 할 때 사용.

---

## JSON 인코딩/디코딩

```go
import "encoding/json"

// 구조체 → JSON (인코딩)
type Event struct {
    PID  uint32 `json:"pid"`   // json 태그: JSON 키 이름 지정
    Comm string `json:"comm"`
}

e := Event{PID: 1234, Comm: "curl"}
data, _ := json.Marshal(e)
// → {"pid":1234,"comm":"curl"}

// JSON → 구조체 (디코딩)
var e Event
json.Unmarshal([]byte(`{"pid":1234,"comm":"curl"}`), &e)
// → e.PID = 1234, e.Comm = "curl"
```

---

---

## select (여러 channel 동시 대기)

`switch`처럼 생겼지만, **"준비된 channel"** 을 고르는 문법입니다.

```go
select {
case msg := <-broadcast:
    // broadcast channel에 데이터가 들어오면 실행
    sendToAllClients(msg)

case conn := <-register:
    // register channel에 데이터가 들어오면 실행
    clients[conn] = true

case conn := <-unregister:
    // unregister channel에 데이터가 들어오면 실행
    delete(clients, conn)
}
```

```
동시에 여러 channel이 준비되면 Go가 랜덤으로 하나를 선택
아무것도 준비 안 됐으면 준비될 때까지 블로킹 (대기)
```

WebSocket 허브처럼 **"여러 종류의 이벤트를 하나의 goroutine에서 처리"** 할 때 핵심으로 사용됩니다.

`default` 케이스를 넣으면 아무 channel도 준비 안 됐을 때 블로킹 없이 즉시 넘어갑니다:

```go
select {
case msg := <-ch:
    process(msg)
default:
    // ch가 비어있으면 여기 실행 (블로킹 안 함)
}
```

---

## sync.Mutex (동시 접근 보호)

goroutine 여러 개가 같은 변수를 동시에 읽고 쓰면 데이터가 망가집니다 (Race Condition).
`sync.Mutex`는 한 번에 하나의 goroutine만 접근하도록 잠그는 자물쇠입니다.

```go
import "sync"

type Hub struct {
    mu      sync.Mutex
    clients map[*websocket.Conn]bool
}

// goroutine A가 클라이언트 추가 중
func (h *Hub) add(conn *websocket.Conn) {
    h.mu.Lock()           // 자물쇠 잠금 (다른 goroutine은 대기)
    h.clients[conn] = true
    h.mu.Unlock()         // 자물쇠 해제 (대기 중인 goroutine 진입 가능)
}

// goroutine B가 같은 시점에 순회 시도 → Lock 걸려 있으면 대기
func (h *Hub) broadcast(msg []byte) {
    h.mu.Lock()
    defer h.mu.Unlock()   // 함수 끝날 때 자동 해제 (defer 활용)
    for conn := range h.clients {
        conn.WriteMessage(websocket.TextMessage, msg)
    }
}
```

```
자물쇠 없을 때 (위험):
  goroutine A: clients 맵에 추가 중...
  goroutine B: 동시에 clients 맵 순회 중...
  → 맵이 깨짐 (panic: concurrent map read and map write)

자물쇠 있을 때 (안전):
  goroutine A: Lock → 추가 → Unlock
  goroutine B: Lock 시도 → 대기 → A 끝나면 Lock → 순회 → Unlock
```

---

## context (취소 신호 전파)

> "이 goroutine들아, 이제 그만해" 라는 신호를 동시에 보내는 도구

Ctrl+C를 누르거나 클라이언트 연결이 끊겼을 때, 그 goroutine과 연관된 모든 작업을 깔끔하게 종료해야 합니다.

```go
import "context"

// context 생성 (취소 가능한 버전)
ctx, cancel := context.WithCancel(context.Background())

// goroutine에게 context 전달
go func(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            // cancel()이 호출되면 ctx.Done() channel이 닫힘
            // → 이 case가 실행됨 → goroutine 종료
            fmt.Println("종료")
            return
        case msg := <-eventCh:
            sendToClient(msg)
        }
    }
}(ctx)

// 나중에 클라이언트 연결이 끊기면
cancel()  // ctx.Done()이 닫힘 → 위 goroutine이 종료됨
```

```
parent context
    │
    ├── child goroutine 1  ← cancel() 호출 시 동시에 종료 신호
    ├── child goroutine 2  ←
    └── child goroutine 3  ←
```

타임아웃도 설정할 수 있습니다:

```go
// 30초 후 자동으로 cancel
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
```

---

## goroutine 누수 (Goroutine Leak)

WebSocket 서버에서 자주 발생하는 문제입니다. goroutine을 시작했는데 끝내는 코드가 없으면 메모리를 계속 차지합니다.

```
누수 상황:
  클라이언트 1000명 접속 → goroutine 1000개 생성
  클라이언트 999명 끊김  → goroutine은 여전히 1000개 실행 중
                              ↑ 이게 누수
```

방지 방법:

```go
func handleClient(conn *websocket.Conn) {
    defer conn.Close()  // 함수 끝날 때 반드시 연결 종료

    for {
        _, msg, err := conn.ReadMessage()
        if err != nil {
            // 클라이언트가 끊기면 ReadMessage가 에러 반환
            // → err != nil → return → defer conn.Close() 실행
            return
        }
        process(msg)
    }
}
```

클라이언트 연결이 끊기면 `ReadMessage()`가 에러를 반환합니다. 그 시점에 goroutine이 return하도록 반드시 에러 처리를 해야 합니다.

---

## buffered channel (버퍼 있는 channel)

기본 channel은 보내는 쪽과 받는 쪽이 동시에 준비돼야 합니다 (동기).
buffered channel은 버퍼 크기만큼 받는 쪽이 준비 안 돼도 넣을 수 있습니다 (비동기).

```go
// 버퍼 없는 channel: 받는 쪽 준비 전까지 블로킹
ch := make(chan Event)

// 버퍼 있는 channel: 버퍼(256개)가 찰 때까지 블로킹 없이 넣기 가능
ch := make(chan Event, 256)
```

```
버퍼 없는 channel:
  생산자: ch <- event  → 소비자가 받을 때까지 여기서 멈춤
  소비자: e := <-ch   → 생산자가 넣을 때까지 여기서 멈춤

버퍼 있는 channel (크기 3):
  생산자: ch <- e1  → OK (버퍼: [e1])
  생산자: ch <- e2  → OK (버퍼: [e1, e2])
  생산자: ch <- e3  → OK (버퍼: [e1, e2, e3])
  생산자: ch <- e4  → 버퍼 꽉 참 → 소비자가 꺼낼 때까지 블로킹
```

MicroTrace에서 eBPF 이벤트는 짧은 시간에 많이 쏟아질 수 있습니다. broadcast channel에 버퍼를 주면 WebSocket 전송이 잠깐 느려져도 이벤트를 잃지 않습니다.

---

## http.Handler 인터페이스

Go의 HTTP 서버는 `Handler` 인터페이스를 기반으로 동작합니다.

```go
// Handler 인터페이스 (내부 정의)
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}

// 함수를 Handler로 등록하는 편의 함수
http.HandleFunc("/ws", wsHandler)
// 내부적으로: http.Handle("/ws", http.HandlerFunc(wsHandler)) 와 동일

// ResponseWriter: 응답을 쓰는 인터페이스
// *Request: 요청 정보 (헤더, URL, Body 등)
func wsHandler(w http.ResponseWriter, r *http.Request) {
    // gorilla/websocket의 Upgrade는 w와 r을 받아서
    // HTTP 연결을 WebSocket으로 전환함
    conn, _ := upgrader.Upgrade(w, r, nil)
}
```

---

## Go 인터페이스 (interface)

> "이 메서드만 있으면 뭐든 OK" 라는 약속

인터페이스는 구체적인 구현체를 몰라도 되도록 **약속(계약)** 만 정의합니다.

```go
// 약속: Resolve(ip) 메서드가 있으면 ServiceResolver로 쓸 수 있다
type ServiceResolver interface {
    Resolve(ip string) string
}

// 구현체 1: Docker API로 조회
type DockerResolver struct { ... }
func (r *DockerResolver) Resolve(ip string) string { ... }

// 구현체 2: 설정 파일 기반 (EC2 환경)
type StaticResolver struct { ... }
func (r *StaticResolver) Resolve(ip string) string { ... }
```

### 왜 인터페이스를 쓰는가?

```
인터페이스 없이:
  stats.go → DockerResolver 직접 사용
  EC2 환경으로 바꿀 때 → stats.go 코드를 수정해야 함

인터페이스 있으면:
  stats.go → ServiceResolver (약속만 봄)
  EC2 환경으로 바꿀 때 → main.go에서 어떤 구현체를 넘길지만 바꾸면 됨
                          stats.go는 건드리지 않아도 됨
```

```go
// stats.go: 인터페이스만 알고 있음
type Processor struct {
    resolver resolver.ServiceResolver  // DockerResolver인지 StaticResolver인지 모름
}

// main.go: 환경에 따라 구현체를 선택
var r resolver.ServiceResolver
if dockerAvailable {
    r, _ = resolver.NewDockerResolver(ctx)
} else {
    r = resolver.NewStaticResolver(table)
}
proc := stats.New(r, ...)  // 어떤 구현체든 상관없이 넘김
```

Go에서는 인터페이스를 **명시적으로 선언하지 않아도** 됩니다. 메서드만 있으면 자동으로 인터페이스를 만족합니다.

```go
// Java: "implements ServiceResolver" 라고 명시해야 함
// Go: Resolve() 메서드만 있으면 자동으로 ServiceResolver로 취급됨
```

---

## 포인터 임베딩 + omitempty JSON 함정

이번 구현에서 실제로 발생한 버그입니다.

### 증상
```go
type OutboundMsg struct {
    MsgType  string        `json:"msg_type"`
    *RawEvent `json:",omitempty"`  // 포인터 임베딩
}
```

`*RawEvent`의 필드들이 JSON에 인라인으로 펼쳐질 것을 기대했는데, 실제로는 **필드가 통째로 사라졌습니다.**

브라우저에서 `msg.src_service`를 읽으면 `undefined`가 나왔습니다.

### 원인

Go의 JSON 직렬화 규칙:
- 포인터 임베딩(`*RawEvent`) + `omitempty`가 붙으면, 포인터가 nil이 아니어도 내부 필드들이 인라인으로 펼쳐지지 않고 무시됩니다.
- 이건 Go의 알려진 동작이지만 직관적이지 않아서 실수하기 쉽습니다.

### 해결: 명시적 필드 사용

```go
// 잘못된 구조 (포인터 임베딩)
type OutboundMsg struct {
    MsgType   string        `json:"msg_type"`
    *RawEvent  `json:",omitempty"`     // ← 내부 필드가 JSON에서 사라짐
    *StatSnapshot `json:",omitempty"`
}
// 실제 JSON: {"msg_type":"event"}  ← src_service 등이 없음!

// 올바른 구조 (명시적 필드)
type OutboundMsg struct {
    MsgType string        `json:"msg_type"`
    Event   *RawEvent     `json:"event,omitempty"`    // ← 이름 있는 필드
    Stats   *StatSnapshot `json:"stats,omitempty"`
}
// 실제 JSON: {"msg_type":"event","event":{"src_service":"unknown",...}}
```

클라이언트 JS에서는 `msg.event.src_service` 로 접근합니다.

### 교훈

Go에서 JSON 구조를 설계할 때:
- 포인터 임베딩은 타입 단위로 인라인 펼치기에만 사용
- `omitempty`와 포인터 임베딩을 함께 쓰면 예상치 못한 동작 발생
- 불확실할 때는 명시적 필드가 항상 안전

---

## signal.NotifyContext (graceful shutdown)

프로그램이 Ctrl+C나 `docker stop`으로 종료될 때, 실행 중인 작업을 깔끔하게 마무리하는 패턴입니다.

```go
import (
    "context"
    "os"
    "os/signal"
    "syscall"
)

// SIGINT(Ctrl+C), SIGTERM(docker stop) 수신 시 ctx가 자동으로 취소됨
ctx, stop := signal.NotifyContext(context.Background(),
    os.Interrupt,    // SIGINT  (Ctrl+C)
    syscall.SIGTERM, // SIGTERM (kill 명령, docker stop)
)
defer stop()

// goroutine들에게 ctx를 넘기면, 종료 신호가 오면 ctx.Done()이 닫힘
go dockerResolver.watchEvents(ctx)  // ctx 취소 시 자동 종료
go proc.Run(eventCh)

// 종료 신호 올 때까지 대기
<-ctx.Done()
// 여기서부터 정리 작업
srv.Shutdown(context.Background())
```

```
Ctrl+C 누름
    │
    ▼
signal.NotifyContext → ctx 취소
    │
    ├── watchEvents goroutine: ctx.Done() 감지 → return
    ├── proc.Run goroutine: eventCh 닫힘 → return
    └── main: <-ctx.Done() 통과 → srv.Shutdown() → 프로그램 종료
```

**graceful shutdown이 중요한 이유:**
- eBPF 프로그램이 cgroup에 붙어있는 상태에서 갑자기 죽으면 hook이 그대로 남음
- 다음 실행 시 "이미 attach됨" 에러 발생
- 정상 종료해야 detach → cleanup이 실행됨

---

## WriteMessage 동시성 주의

`gorilla/websocket`의 `Conn`은 **동시에 WriteMessage를 호출하면 패닉** 이 납니다.

```
잘못된 구조:
  goroutine A: conn.WriteMessage(이벤트1)
  goroutine B: conn.WriteMessage(이벤트2)  ← 동시 호출 → 패닉!

올바른 구조:
  하나의 goroutine에서만 WriteMessage 호출
  (허브 패턴에서 Run() goroutine이 전담)
```

```go
// 올바른 패턴: 모든 쓰기를 한 goroutine이 담당
func (h *Hub) Run() {
    for msg := range h.broadcast {
        for conn := range h.clients {
            conn.WriteMessage(websocket.TextMessage, msg)  // 여기서만 씀
        }
    }
}
```
