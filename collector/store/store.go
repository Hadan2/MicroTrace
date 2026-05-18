// store/store.go
//
// 역할: StatSnapshot과 ResourceSnapshot을 SQLite에 저장한다.
//
// 설계 원칙:
//   - 실시간 경로(WebSocket)와 완전히 분리된다. publishSnapshots()는 Write()를 호출하기만 하면 된다.
//   - Write()는 즉시 반환한다. 실제 INSERT는 별도 goroutine에서 배치로 처리한다.
//   - 60초마다 버퍼를 flush해서 쓰기 빈도를 최소화한다. (Prometheus/Netdata와 동일한 패턴)
//   - 1시간마다 7일 이전 데이터를 DELETE한다.

package store

import (
	"database/sql"
	"log"
	"sync"
	"time"

	"microtrace/collector/model"

	_ "modernc.org/sqlite"
)

const (
	flushInterval = 60 * time.Second
	ttlInterval   = 1 * time.Hour
	retentionDays = 7
)

// Store — SQLite 배치 저장소
type Store struct {
	db *sql.DB

	mu        sync.Mutex
	connBuf   []model.StatSnapshot
	resBuf    []model.ResourceSnapshot
}

// New — SQLite 파일을 열고 테이블/인덱스를 생성한다.
// path: DB 파일 경로 (예: "microtrace.db")
func New(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	// WAL 모드: 읽기/쓰기 동시 처리 가능. collector의 WebSocket 브로드캐스트와 충돌 없음.
	if _, err := db.Exec("PRAGMA journal_mode=WAL;"); err != nil {
		return nil, err
	}

	if err := migrate(db); err != nil {
		return nil, err
	}

	return &Store{db: db, connBuf: make([]model.StatSnapshot, 0, 120), resBuf: make([]model.ResourceSnapshot, 0, 120)}, nil
}

// migrate — 테이블과 인덱스를 생성한다. 이미 존재하면 무시한다.
func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS conn_stats (
			ts               INTEGER NOT NULL,
			src              TEXT    NOT NULL,
			dst              TEXT    NOT NULL,
			p50_us           INTEGER,
			p95_us           INTEGER,
			p99_us           INTEGER,
			avg_us           INTEGER,
			jitter_us        INTEGER,
			retransmit       INTEGER,
			is_spike         INTEGER,
			cause_kind       TEXT,
			cause_signal     TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_conn_ts ON conn_stats (src, dst, ts);

		CREATE TABLE IF NOT EXISTS resource_stats (
			ts               INTEGER NOT NULL,
			service          TEXT    NOT NULL,
			cpu_pct          REAL,
			cpu_throttle_pct REAL,
			mem_bytes        INTEGER,
			mem_pressure_pct REAL,
			io_wait_pct      REAL,
			oom_kill_count   INTEGER
		);
		CREATE INDEX IF NOT EXISTS idx_res_ts ON resource_stats (service, ts);
	`)
	return err
}

// WriteConn — StatSnapshot을 버퍼에 추가한다. 즉시 반환.
func (s *Store) WriteConn(snap model.StatSnapshot) {
	s.mu.Lock()
	s.connBuf = append(s.connBuf, snap)
	s.mu.Unlock()
}

// WriteResource — ResourceSnapshot을 버퍼에 추가한다. 즉시 반환.
func (s *Store) WriteResource(snap model.ResourceSnapshot) {
	s.mu.Lock()
	s.resBuf = append(s.resBuf, snap)
	s.mu.Unlock()
}

// Run — flush/TTL 루프를 실행한다. 별도 goroutine으로 실행할 것: go store.Run(ctx)
func (s *Store) Run(done <-chan struct{}) {
	flushTicker := time.NewTicker(flushInterval)
	ttlTicker   := time.NewTicker(ttlInterval)
	defer flushTicker.Stop()
	defer ttlTicker.Stop()

	for {
		select {
		case <-flushTicker.C:
			s.flush()
		case <-ttlTicker.C:
			s.deleteExpired()
		case <-done:
			s.flush() // 종료 시 남은 버퍼 마저 씀
			return
		}
	}
}

// flush — 버퍼에 쌓인 데이터를 트랜잭션 한 번으로 INSERT한다.
func (s *Store) flush() {
	s.mu.Lock()
	conns := s.connBuf
	ress  := s.resBuf
	s.connBuf = s.connBuf[:0]
	s.resBuf  = s.resBuf[:0]
	s.mu.Unlock()

	if len(conns) == 0 && len(ress) == 0 {
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("[store] 트랜잭션 시작 실패: %v", err)
		return
	}
	defer tx.Rollback()

	now := time.Now().UnixMilli()

	connStmt, err := tx.Prepare(`
		INSERT INTO conn_stats
		(ts, src, dst, p50_us, p95_us, p99_us, avg_us, jitter_us, retransmit, is_spike, cause_kind, cause_signal)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		log.Printf("[store] conn_stats prepare 실패: %v", err)
		return
	}
	defer connStmt.Close()

	for _, c := range conns {
		spike := 0
		if c.IsSpike {
			spike = 1
		}
		if _, err := connStmt.Exec(now, c.SrcService, c.DstService,
			c.P50Us, c.P95Us, c.P99Us, c.AvgUs, c.JitterUs,
			c.RetransmitCount, spike, c.CauseKind, c.CauseSignal,
		); err != nil {
			log.Printf("[store] conn_stats insert 실패: %v", err)
		}
	}

	resStmt, err := tx.Prepare(`
		INSERT INTO resource_stats
		(ts, service, cpu_pct, cpu_throttle_pct, mem_bytes, mem_pressure_pct, io_wait_pct, oom_kill_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		log.Printf("[store] resource_stats prepare 실패: %v", err)
		return
	}
	defer resStmt.Close()

	for _, r := range ress {
		if _, err := resStmt.Exec(now, r.ServiceName,
			r.CPUPct, r.CPUThrottlePct, r.MemCurrentBytes,
			r.MemPressurePct, r.IOWaitPct, r.OOMKillCount,
		); err != nil {
			log.Printf("[store] resource_stats insert 실패: %v", err)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[store] commit 실패: %v", err)
		return
	}

	log.Printf("[store] flush 완료: conn=%d res=%d", len(conns), len(ress))
}

// deleteExpired — retentionDays일보다 오래된 행을 삭제한다.
func (s *Store) deleteExpired() {
	cutoff := time.Now().Add(-retentionDays * 24 * time.Hour).UnixMilli()

	res, err := s.db.Exec("DELETE FROM conn_stats WHERE ts < ?", cutoff)
	if err != nil {
		log.Printf("[store] conn_stats TTL 삭제 실패: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[store] conn_stats TTL 삭제: %d행", n)
	}

	res, err = s.db.Exec("DELETE FROM resource_stats WHERE ts < ?", cutoff)
	if err != nil {
		log.Printf("[store] resource_stats TTL 삭제 실패: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[store] resource_stats TTL 삭제: %d행", n)
	}
}

// HistoryRow — conn_stats 조회 결과 한 행
type HistoryRow struct {
	Ts          int64  `json:"ts"`
	P50Us       int64  `json:"p50_us"`
	P95Us       int64  `json:"p95_us"`
	P99Us       int64  `json:"p99_us"`
	AvgUs       int64  `json:"avg_us"`
	JitterUs    int64  `json:"jitter_us"`
	IsSpike     bool   `json:"is_spike"`
	CauseKind   string `json:"cause_kind"`
	CauseSignal string `json:"cause_signal"`
}

// QueryHistory — src→dst 연결의 과거 데이터를 from 이후부터 조회한다.
func (s *Store) QueryHistory(src, dst string, from time.Time) ([]HistoryRow, error) {
	rows, err := s.db.Query(`
		SELECT ts, p50_us, p95_us, p99_us, avg_us, jitter_us, is_spike, cause_kind, cause_signal
		FROM conn_stats
		WHERE src = ? AND dst = ? AND ts >= ?
		ORDER BY ts ASC
	`, src, dst, from.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []HistoryRow
	for rows.Next() {
		var r HistoryRow
		var isSpike int
		if err := rows.Scan(&r.Ts, &r.P50Us, &r.P95Us, &r.P99Us, &r.AvgUs, &r.JitterUs,
			&isSpike, &r.CauseKind, &r.CauseSignal); err != nil {
			continue
		}
		r.IsSpike = isSpike == 1
		result = append(result, r)
	}
	return result, nil
}

// ListConnections — DB에 기록된 연결 목록(src, dst 쌍)을 반환한다.
func (s *Store) ListConnections() ([][2]string, error) {
	rows, err := s.db.Query(`SELECT DISTINCT src, dst FROM conn_stats ORDER BY src, dst`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result [][2]string
	for rows.Next() {
		var src, dst string
		if err := rows.Scan(&src, &dst); err != nil {
			continue
		}
		result = append(result, [2]string{src, dst})
	}
	return result, nil
}

// Close — DB 연결을 닫는다.
func (s *Store) Close() {
	if err := s.db.Close(); err != nil {
		log.Printf("[store] DB 닫기 실패: %v", err)
	}
}
