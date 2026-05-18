# SQLite와 시계열 데이터 저장 — MicroTrace 구현을 위한 핵심 개념

---

## 1. SQLite가 뭔지

SQLite는 **파일 하나가 데이터베이스 전체**인 DB다.

```
일반 DB (PostgreSQL, MySQL):
  서버 프로세스가 따로 실행됨
  앱 → 네트워크 → DB 서버 → 응답
  설치, 계정, 포트 설정 필요

SQLite:
  DB = 그냥 파일 하나 (microtrace.db)
  앱이 파일을 직접 읽고 씀
  설치 불필요, 설정 불필요
```

Go에서는 DB 드라이버를 import하면 그게 전부다.
`modernc.org/sqlite`는 C 컴파일러도 필요 없는 순수 Go 구현이라 `go get` 하나면 끝난다.

---

## 2. 왜 SQLite인가 — MicroTrace 기준

```
요구사항:
  - "어젯밤 spike" 재시작 후에도 조회 가능
  - 외부 서버 의존성 없음 (설치 간단)
  - 초당 2건 정도의 낮은 쓰기 빈도

→ PostgreSQL: 서버 필요, 과함
→ InfluxDB:   시계열 전용이지만 별도 프로세스 필요
→ SQLite:     파일 1개, 설치 0, 충분
```

SQLite의 약점은 "동시 쓰기 성능"인데 MicroTrace는 collector 하나만 씀.
동시성 문제가 없으므로 SQLite가 최적이다.

---

## 3. 시계열 데이터를 DB에 저장하는 원리

### 왜 이벤트마다 INSERT하면 안 되는가

```
서비스 2개가 초당 수백 개 RTT 이벤트 발생
→ 초당 수백 번 INSERT
→ SQLite는 매 INSERT마다 fsync (디스크 동기화)
→ 디스크 IOPS 폭발 → 수십 ms 지연 발생
→ collector 전체가 느려짐
```

### Prometheus/Netdata가 쓰는 패턴 — 배치 INSERT

```
원시 이벤트 (매우 고빈도)
    ↓
메모리 버퍼에 60초치 누적
    ↓ 60초마다 한 번만
SQLite에 60행 배치 INSERT
    ↓
주기적으로 오래된 행 DELETE (7일 보존)
```

MicroTrace는 원시 이벤트가 아닌 **이미 집계된 StatSnapshot을 저장**한다.
1초마다 1행씩 생기므로 버퍼 없이 60초 배치만으로도 충분히 가볍다.

---

## 4. 테이블 설계

### 기본 개념: 테이블 = 스프레드시트

```
conn_stats 테이블:

ts          | src       | dst       | p99_us | is_spike | cause_kind
------------|-----------|-----------|--------|----------|-----------
1716000000  | service-a | service-b | 1200   | 0        |
1716000001  | service-a | service-b | 1250   | 0        |
1716000060  | service-a | service-b | 8900   | 1        | cpu
```

행(row) 하나 = 1초 스냅샷 하나.
열(column) = 각 지표 값.

### MicroTrace 실제 테이블

```sql
CREATE TABLE IF NOT EXISTS conn_stats (
    ts               INTEGER NOT NULL,   -- Unix millisecond (time.Now().UnixMilli())
    src              TEXT    NOT NULL,   -- 출발지 서비스명
    dst              TEXT    NOT NULL,   -- 목적지 서비스명
    p50_us           INTEGER,
    p95_us           INTEGER,
    p99_us           INTEGER,
    avg_us           INTEGER,
    jitter_us        INTEGER,
    retransmit       INTEGER,
    is_spike         INTEGER,            -- Go bool → SQLite 0/1
    cause_kind       TEXT,               -- "cpu" | "memory" | "network" | "external" | ""
    cause_signal     TEXT
);

CREATE TABLE IF NOT EXISTS resource_stats (
    ts               INTEGER NOT NULL,   -- Unix millisecond
    service          TEXT    NOT NULL,
    cpu_pct          REAL,               -- 실수는 REAL
    cpu_throttle_pct REAL,
    mem_bytes        INTEGER,
    mem_pressure_pct REAL,
    io_wait_pct      REAL,
    oom_kill_count   INTEGER
);
```

### 인덱스가 뭔지

인덱스 없이 "지난 1시간 데이터 조회"를 하면:

```
WHERE src='service-a' AND ts > 1716000000

→ 전체 행을 처음부터 끝까지 하나하나 비교 (Full Table Scan)
→ 행이 100만 개면 100만 번 비교
```

인덱스가 있으면:

```
→ 책 맨 뒤 색인처럼 ts 기준으로 미리 정렬된 포인터 존재
→ 해당 구간으로 바로 점프 → 수십 배 빠름
```

MicroTrace 인덱스:
```sql
CREATE INDEX IF NOT EXISTS idx_conn_ts ON conn_stats (src, dst, ts);
CREATE INDEX IF NOT EXISTS idx_res_ts  ON resource_stats (service, ts);
```

---

## 5. SQLite 타입 시스템

SQLite는 타입이 유연하다. Go 타입과 매핑:

| Go 타입  | SQLite 타입 | 예시 |
|---------|------------|------|
| `int64` | `INTEGER`  | 타임스탬프, 카운터 |
| `uint64`| `INTEGER`  | p99_us, 바이트 수 |
| `float64`| `REAL`    | cpu_pct, 비율 |
| `string`| `TEXT`     | 서비스명, cause_kind |
| `bool`  | `INTEGER`  | is_spike → 0 또는 1 |

---

## 6. WAL 모드 — 쓰기 성능의 핵심

SQLite를 그냥 열면 쓰기할 때 DB 파일 전체에 잠금이 걸린다.
읽기와 쓰기가 동시에 일어나면 한쪽이 기다려야 한다.

**WAL(Write-Ahead Log) 모드**를 켜면:

```
기본 모드:
  쓰기 → 파일 잠금 → 읽기 대기
  읽기 끝날 때까지 쓰기 대기

WAL 모드:
  쓰기 → -wal 파일에 먼저 기록 (빠름)
  읽기 → 기존 파일 읽기 (방해 안 받음)
  → 읽기/쓰기 동시 가능
```

설정 한 줄:
```sql
PRAGMA journal_mode=WAL;
```

collector가 WebSocket 브로드캐스트(읽기)와 DB 쓰기를 동시에 하므로 필수다.

---

## 7. TTL(자동 삭제) 구현

7일이 지난 데이터는 주기적으로 지워야 DB 파일이 무한정 커지지 않는다.

```sql
DELETE FROM conn_stats
WHERE ts < (현재_시각_ms - 7일_ms);

-- 7일 = 7 * 24 * 60 * 60 * 1000 = 604800000 ms
```

Go에서:
```go
cutoff := time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
db.Exec("DELETE FROM conn_stats WHERE ts < ?", cutoff)
```

`?`는 SQL 인젝션 방지를 위한 파라미터 바인딩이다.
문자열을 직접 이어붙이면(`"WHERE ts < " + cutoff`) 보안 취약점이 생기므로 항상 `?`를 쓴다.

---

## 8. MicroTrace에서 SQLite가 데이터 흐름에 어디에 끼는가

```
[eBPF agent]
    ↓ 이벤트 스트림
[stats/stats.go] publishSnapshots()
    ├── hub.Broadcast()  → WebSocket → 브라우저 (실시간, 지금과 동일)
    └── store.Write()    → 메모리 버퍼에 추가
                              ↓ 60초마다
                         SQLite 배치 INSERT    ← 신규
                              ↓ 1시간마다
                         오래된 행 DELETE      ← 신규
```

실시간 경로(WebSocket)는 전혀 건드리지 않는다.
SQLite 쓰기는 별도 goroutine에서 비동기로 처리되므로 latency에 영향 없다.

---

## 9. 사용자가 직접 해야 할 것

**없다.** 모두 Go 코드가 처리한다.

```
DB 파일 생성   → collector 시작 시 자동 생성
테이블 생성    → collector 시작 시 자동 CREATE TABLE IF NOT EXISTS
데이터 삽입    → 60초마다 자동 배치 INSERT
데이터 삭제    → 1시간마다 자동 TTL DELETE
DB 파일 위치   → collector 실행 디렉토리의 microtrace.db
```

나중에 과거 데이터를 직접 보고 싶다면:
```bash
sqlite3 collector/microtrace.db

# 프롬프트에서:
SELECT src, dst, p99_us, cause_kind
FROM conn_stats
WHERE is_spike = 1
ORDER BY ts DESC
LIMIT 20;
```

`sqlite3` CLI는 `sudo apt install sqlite3` 한 번이면 된다.
