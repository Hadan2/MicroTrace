package store

import (
	"path/filepath"
	"testing"
	"time"

	"microtrace/collector/model"
)

// TestFlushPreservesPerSnapshotTimestamp — flush가 배치 전체를 한 시각으로 뭉개지 않고
// 각 스냅샷의 실제 발생 시각을 보존하는지 검증한다.
//
// 회귀 방지: 예전 flush는 now := time.Now() 하나를 모든 행에 박아, 60초치가 같은 ts로 저장돼
// 프론트 x축이 붕괴(All 압축·줌인 시 전부 같은 시각)했다. WriteConn 시점의 tsMs를 행마다 쓰게 고쳤다.
func TestFlushPreservesPerSnapshotTimestamp(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	const src, dst = "svc-a", "svc-b"
	const n = 5

	// 스냅샷을 시차(실제 코드처럼 시간이 흐르며)를 두고 버퍼에 넣는다.
	for i := 0; i < n; i++ {
		s.WriteConn(model.StatSnapshot{
			SrcService: src, DstService: dst,
			P50Us: uint64(100 + i), P95Us: 200, P99Us: 300, AvgUs: 150,
		})
		time.Sleep(2 * time.Millisecond) // ts가 확실히 갈라지도록
	}

	s.flush()

	rows, err := s.QueryHistory(src, dst, time.Time{})
	if err != nil {
		t.Fatalf("QueryHistory: %v", err)
	}
	if len(rows) != n {
		t.Fatalf("행 수 = %d, 기대 %d", len(rows), n)
	}

	// 핵심 검증: ts가 전부 같으면(유니크 1개) 예전 버그. 서로 달라야 한다.
	uniq := map[int64]struct{}{}
	for _, r := range rows {
		uniq[r.Ts] = struct{}{}
	}
	if len(uniq) < n {
		t.Fatalf("ts가 뭉쳤다: 유니크 ts %d개 / 행 %d개 — flush가 배치를 한 시각으로 저장하는 회귀", len(uniq), n)
	}

	// ts는 ASC 정렬돼 나오고, 단조 증가해야 한다.
	for i := 1; i < len(rows); i++ {
		if rows[i].Ts <= rows[i-1].Ts {
			t.Fatalf("ts 단조 증가 아님: rows[%d].Ts=%d <= rows[%d].Ts=%d", i, rows[i].Ts, i-1, rows[i-1].Ts)
		}
	}
}
