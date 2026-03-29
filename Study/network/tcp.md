# TCP 기초

## TCP란?

> "인터넷에서 데이터를 안전하게 주고받기 위한 규칙(프로토콜)"

편지로 비유하면:
- **UDP** = 그냥 편지 보내기. 도착했는지 확인 안 함. 빠르지만 불안정
- **TCP** = 등기우편. 도착 확인, 순서 보장, 유실 시 재전송. 느리지만 안정적

웹 브라우저, HTTP, 데이터베이스 연결 등 대부분이 TCP 사용.

---

## 유저 공간 vs 커널 공간

```
┌─────────────────────────────────┐
│       User Space (유저 공간)      │
│  앱, 쉘, 브라우저, 내 프로그램    │
│  - 직접 하드웨어/네트워크 접근 불가 │
│  - 메모리 보호됨                  │
├─────────────────────────────────┤
│      System Call Interface      │  ← 이 경계를 넘어야 커널 기능 사용
├─────────────────────────────────┤
│       Kernel Space (커널 공간)    │
│  TCP/IP 스택, 파일시스템,          │
│  프로세스 스케줄러, 드라이버 등     │
│  - 실제 네트워크 카드 제어          │
└─────────────────────────────────┘
```

앱이 네트워크를 쓰려면 반드시 **Syscall(시스템 콜)** 을 통해 커널에 요청해야 함.
`connect()`, `send()`, `recv()`, `close()` 등이 모두 syscall.

---

## 3-way Handshake (TCP 연결 수립)

TCP 연결은 항상 이 3단계 과정을 거침. MicroTrace가 이 시점을 감지함.

```
Client (내 앱)                    Server (구글 등)
     │                               │
     │  1. SYN  ─────────────────▶  │   "나 연결할게"
     │                               │
     │  2. SYN-ACK  ◀─────────────  │   "응, 나도 준비됐어"
     │                               │
     │  3. ACK  ─────────────────▶  │   "알겠어, 연결됨!"
     │                               │
     │      ← 연결 수립 완료 →        │
     │                               │
     │  DATA ─────────────────────▶ │   실제 데이터 전송
     │  ACK  ◀─────────────────────  │
```

- **SYN**: Synchronize. "연결 시작" 신호
- **ACK**: Acknowledge. "받았어" 확인 신호
- `connect()` syscall이 호출되면 이 과정이 시작됨

---

## RTT (Round Trip Time)

> "패킷을 보내고 응답을 받기까지의 시간"

```
Client                          Server
  │                               │
  │──── DATA ─────────────────▶  │   t1: 전송 시작
  │                               │
  │  ◀──── ACK ─────────────────  │   t2: ACK 수신
  │                               │
  RTT = t2 - t1
```

**MicroTrace가 측정하는 핵심 지표.**
정상적인 같은 리전 서버 간 RTT: 1~5ms
이게 갑자기 50ms, 100ms로 튀면 → Latency Spike 발생!

---

## TCP 재전송 (Retransmission)

패킷이 유실되거나 ACK가 오지 않으면 TCP는 자동으로 재전송함.

```
Client                          Server
  │                               │
  │──── DATA ─────────────────▶  │   패킷 유실!
  │                               │
  │  (ACK 안 옴, 타임아웃 대기)    │
  │                               │
  │──── DATA 재전송 ──────────▶  │   다시 보냄
  │                               │
  │  ◀──── ACK ─────────────────  │
```

재전송이 많다 = 네트워크 불안정 또는 서버 과부하 신호.
MicroTrace는 재전송 이벤트도 추적함.

---

## HTTP Keep-Alive와 TCP 연결 재사용

### ① 이게 뭔지

HTTP 요청마다 TCP 연결을 새로 맺으면 3-way handshake 비용이 매번 발생함.
Keep-Alive는 한 번 맺은 TCP 연결을 여러 HTTP 요청에 재사용하는 방식.

### ② 왜 필요한가

```
Keep-Alive 없을 때 (HTTP/1.0 기본):
  요청1: [SYN→SYN-ACK→ACK] → GET /ping → [FIN→FIN-ACK]  ← 연결 수립/종료
  요청2: [SYN→SYN-ACK→ACK] → GET /ping → [FIN→FIN-ACK]  ← 또 연결 수립/종료
  요청3: [SYN→SYN-ACK→ACK] → GET /ping → [FIN→FIN-ACK]  ← 또또...

Keep-Alive 있을 때 (HTTP/1.1 기본):
  요청1: [SYN→SYN-ACK→ACK] → GET /ping  ← 연결 한 번만 수립
  요청2:                       GET /ping  ← 재사용
  요청3:                       GET /ping  ← 재사용
  ...                          [FIN→FIN-ACK]  ← 마지막에 한 번만 종료
```

요청이 많을수록 handshake 비용 절감 효과가 커짐.

### ③ MicroTrace와의 관계

kprobe/tcp_connect는 새 TCP 연결 시점만 감지함.
Keep-Alive로 연결을 재사용하면 2번째 요청부터는 이벤트가 안 잡힘.

```
service_a → service_b (Keep-Alive 활성화)

MicroTrace kprobe 출력:
  [CONNECT] service_a → 127.0.0.1:8080  latency: 36 us  ← 1번만 출력
  (이후 요청들은 출력 없음 ❌)
```

→ Phase 2에서 sock_ops로 전환하면 연결 위의 요청 단위 latency도 측정 가능.
   자세한 내용은 `Study/kernel/ebpf.md` → sock_ops 섹션 참고.

### Go에서 Keep-Alive가 제대로 동작하려면 (03.27 트러블슈팅)

```go
// ✅ 필수: Body를 끝까지 읽어야 연결 풀에 반환됨
io.Copy(io.Discard, resp.Body)
resp.Body.Close()

// ✅ 필수: IdleTimeout 명시 안 하면 ReadTimeout 값이 그대로 사용됨
srv := &http.Server{
    ReadTimeout: 5 * time.Second,
    IdleTimeout: 60 * time.Second,
}
```

동작 확인:
```bash
ss -tn | grep 8080
# 포트 번호 고정 → 연결 재사용 중 ✅
# 포트 번호 변경 → 매번 새 연결 (Keep-Alive 안 되는 것) ❌
```
