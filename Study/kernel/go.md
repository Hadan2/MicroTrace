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

## (추가 예정)

Phase 2 진행하면서 필요한 개념 추가:
- WebSocket
- binary 패키지 (바이너리 파싱)
- context (취소/타임아웃 전파)
