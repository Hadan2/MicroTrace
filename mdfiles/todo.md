# MicroTrace TODO

다음에 할 작업을 여기에 기록한다.
완료된 항목은 GitHub Issue close로 관리한다. 이 파일은 "지금 하고 있는 작업 하나"만 담는다.

---

## 지금 하고 있는 작업

**Issue #4: SQLite 영속성**

### 왜
현재 모든 데이터는 메모리에만 있어 재시작 시 소멸한다.
"어젯밤 spike가 왜 났는지"를 나중에 조회할 수 없다.
모니터링 도구로서 최소한의 이력 보존이 필요하다.

### 저장 대상
- `StatSnapshot` — 1초마다 연결별 p50/p95/p99/spike/cause_kind
- `ResourceSnapshot` — 1초마다 서비스별 CPU throttle/memory pressure
- `RawEvent`는 저장 안 함 (고빈도 원시 이벤트, 병목 원인)

### 저장 방식
- 메모리 버퍼에 60초치 누적 → 60초마다 SQLite 배치 INSERT
- 보존 기간: 7일 (매 1시간마다 오래된 행 자동 삭제)
- 외부 DB 서버 없음, 파일 1개 (`microtrace.db`)
- Go 드라이버: `modernc.org/sqlite` (CGo 없는 순수 Go)

### 건드리는 파일
- `collector/store/store.go` — 신규. SQLite 배치 버퍼 + flush + TTL 삭제
- `collector/stats/stats.go` — `publishSnapshots()`에서 store.Write() 호출 추가
- `collector/main.go` — store 초기화 및 주입

### 완료 기준
collector 재시작 후에도 직전 7일치 StatSnapshot·ResourceSnapshot이 DB에서 조회된다.
