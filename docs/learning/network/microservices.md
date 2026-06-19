# 마이크로서비스 기초

## 마이크로서비스가 뭔지

> "하나의 큰 앱을 작은 독립 서비스들로 쪼갠 아키텍처"

### 모놀리식 vs 마이크로서비스

```
모놀리식 (Monolithic):
  ┌─────────────────────────────┐
  │  로그인 + 상품 + 주문 +      │
  │  결제 + 추천 + 배송...       │  ← 하나의 거대한 앱
  └─────────────────────────────┘
  장점: 단순함, 개발 빠름
  단점: 일부 수정해도 전체 재배포, 일부 장애가 전체 장애로 전파

마이크로서비스 (Microservices):
  ┌────────┐  ┌────────┐  ┌────────┐
  │ 로그인  │  │  상품  │  │  주문  │  ← 각각 독립 서비스
  └────────┘  └────────┘  └────────┘
       ↕           ↕           ↕
  ┌────────┐  ┌────────┐  ┌────────┐
  │  결제  │  │  추천  │  │  배송  │
  └────────┘  └────────┘  └────────┘
  장점: 독립 배포, 장애 격리, 각 서비스마다 다른 언어/DB 가능
  단점: 복잡함, 서비스 간 통신 오버헤드
```

---

## 서비스 간 통신

마이크로서비스는 각각 독립된 프로세스(컨테이너)로 실행되므로
서로 데이터를 주고받으려면 **네트워크 통신**이 필요함.

### HTTP/REST
가장 일반적인 방식. JSON으로 데이터 교환.

```
주문 서비스  →  HTTP GET /products/123  →  상품 서비스
            ←  { "id": 123, "name": "..." }  ←
```

### gRPC
Google이 만든 고성능 RPC 프레임워크. Protobuf로 바이너리 직렬화.

```
주문 서비스  →  GetProduct(id: 123)  →  상품 서비스
            ←  Product{id: 123, ...}  ←
```

| 항목 | HTTP/REST | gRPC |
|------|-----------|------|
| 데이터 형식 | JSON (텍스트) | Protobuf (바이너리) |
| 속도 | 보통 | 빠름 (2~10배) |
| 가독성 | 높음 | 낮음 (바이너리) |
| 스트리밍 | 어려움 | 기본 지원 |
| 주 용도 | 외부 API | 서비스 간 내부 통신 |

**MicroTrace 관련:** 구글 데모는 서비스 간 통신에 gRPC 사용.
eBPF는 TCP 레벨에서 트래픽을 관찰하므로 HTTP든 gRPC든 전부 잡힘.

---

## 구글 Microservices Demo 구조

실제 이커머스(쇼핑몰)를 마이크로서비스로 구현한 오픈소스 데모.
Google Cloud 팀이 만들었고, 11개 서비스로 구성.

```
브라우저
    │
    ▼
[Frontend] (Go) - 8080포트, 유일하게 외부에서 접근 가능
    │
    ├──→ [ProductCatalog] (Go)     상품 목록/상세
    ├──→ [Cart] (C#)               장바구니
    ├──→ [Recommendation] (Python) 추천 상품
    ├──→ [Currency] (Node.js)      환율 변환
    ├──→ [Ad] (Java)               광고
    │
    ├──→ [Checkout] (Go)           주문 처리
    │       │
    │       ├──→ [Payment] (Node.js)   결제
    │       ├──→ [Email] (Python)      주문 확인 메일
    │       └──→ [Shipping] (Go)       배송비 계산
    │
    └──→ [Redis]                   장바구니 데이터 저장
```

**왜 이걸 쓰는가:**
- 실제 프로덕션 수준의 마이크로서비스 트래픽 패턴
- 서비스마다 다른 언어 → 다양한 TCP 연결 패턴
- gRPC 통신 → 실제 서비스 간 latency 측정 가능
- 부하 발생기(loadgenerator)가 내장되어 있어 별도 툴 없이 테스트 가능

---

## 병목이 어디서 생기는가

마이크로서비스에서 latency 문제가 생기는 주요 지점:

### 1. 서비스 간 네트워크 홉
```
Frontend → Checkout → Payment → (외부 결제 API)
    5ms  →    3ms  →   12ms  →      100ms

사용자가 느끼는 latency = 5 + 3 + 12 + 100 = 120ms
하나의 느린 서비스가 전체를 느리게 만듦 (Critical Path)
```

### 2. TCP 재전송
```
컨테이너 간 패킷 손실 → TCP 재전송 → 최소 200ms 지연 추가
(재전송 타임아웃 기본값이 200ms이기 때문)
```

### 3. 연결 지연 (Connection Latency)
```
매 요청마다 새 TCP 연결 → 3-way handshake → 추가 RTT
gRPC는 연결 재사용(HTTP/2 multiplexing)으로 이를 줄임
```

### 4. Head-of-Line Blocking
```
HTTP/1.1: 앞 요청이 끝나야 다음 요청 처리 (줄 세우기)
HTTP/2 (gRPC): 여러 요청 동시 처리 → 더 효율적
```

---

## MicroTrace로 무엇을 관찰할 수 있나

구글 데모를 띄우고 MicroTrace를 실행하면:

```
[CONNECT] PID: 1234  COMM: frontend   ->  172.17.0.3:50051  latency: 850 us
[CONNECT] PID: 1234  COMM: frontend   ->  172.17.0.4:50051  latency: 1200 us
[CONNECT] PID: 5678  COMM: checkout   ->  172.17.0.5:50051  latency: 950 us
[RETRANSMIT] ...     COMM: payment    ->  172.17.0.6:50051
```

현재 알 수 있는 것:
- 어떤 서비스(COMM)가 어디(daddr:dport)에 연결하는지
- TCP 연결 latency
- 재전송 발생 여부

현재 알 수 없는 것 (→ struct event 확장 필요):
- 어느 IP에서 연결을 시도했는지 (src IP 없음)
- 재전송이 몇 번 발생했는지
- 요청 하나에 대한 end-to-end latency

---

## 부하 테스트 도구

구글 데모를 무거운 트래픽 상태로 만들어야 병목이 관찰됨.

### 내장 loadgenerator
구글 데모에 Python Locust 기반 부하 발생기가 포함되어 있음.
별도 설치 없이 바로 사용 가능.

```bash
# docker compose up 하면 loadgenerator도 같이 뜸
# http://localhost:8089 에서 부하 설정 UI 접근 가능
```

### wrk (별도 설치)
더 세밀한 제어가 필요할 때:
```bash
# 설치
sudo apt install wrk

# 10개 스레드, 100개 커넥션, 30초 동안 부하
wrk -t10 -c100 -d30s http://localhost:8080
```

---

## 로컬 실행 방법 (설치 후)

```bash
# 1. 구글 데모 소스 받기
git clone https://github.com/GoogleCloudPlatform/microservices-demo.git
cd microservices-demo

# 2. 전체 서비스 실행 (처음엔 이미지 다운로드로 시간 걸림)
docker compose up

# 3. 브라우저에서 확인
# http://localhost:8080

# 4. 다른 터미널에서 MicroTrace 실행
cd ~/MicroTrace/collector
sudo env PATH=$PATH go run main.go

# 5. 트래픽 관찰
```