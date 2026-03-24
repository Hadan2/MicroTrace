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

## (추가 예정)

Phase 2 진행하면서 필요한 개념 추가:
- JSON 인코딩/디코딩
- HTTP 서버
- WebSocket
- binary 패키지 (바이너리 파싱)
