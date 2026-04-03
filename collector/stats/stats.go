// stats/stats.go
//
// 역할: 연결별 RTT를 누적하고, p50/p95/p99를 계산하며, spike를 감지한다.
//       1초마다 모든 연결의 통계 스냅샷을 생성해서 hub로 브로드캐스트한다.
//
// 설계 원칙:
//   - 이 패키지는 "어떻게 이벤트가 왔는지" 모른다 (chan model.Event 만 받음).
//   - "어디로 보낼지"도 모른다 (hub.Broadcast 함수를 콜백으로 받음).
//   - 핵심 로직(링버퍼, 퍼센타일, spike)은 순수 데이터 구조로 분리되어 있어
//     나중에 단위 테스트 작성이 쉽다.

package stats

import (
	"log"
	"sort"
	"sync"
	"time"

	"microtrace/collector/model"
	"microtrace/collector/resolver"
)

const (
	// rttRingSize — 연결별로 최근 몇 개의 RTT를 보관할지
	// 1000개 × 8바이트 = 8KB / 연결. 연결 100개면 800KB.
	rttRingSize = 1000

	// spikeMultiplier — spike 판단 임계값: p99 × 이 배수
	// p99가 1ms일 때 3ms 이상이면 spike로 본다.
	spikeMultiplier = 3

	// snapshotInterval — StatSnapshot을 hub로 보내는 주기
	snapshotInterval = 1 * time.Second
)

// ConnKey — 연결을 식별하는 키 (출발지 서비스 → 목적지 서비스)
//
// saddr(skops->local_ip4) 수집 후 resolver가 양쪽 모두 서비스명으로 변환한다.
// Docker Compose: "testenv-service-a-1" → "testenv-service-b-1"
// 매핑 실패 시(캐시 미스): IP 문자열 그대로 사용
type ConnKey struct {
	Src string
	Dst string
}

// connStats — 연결 하나의 RTT 링버퍼와 집계 상태
type connStats struct {
	// 링버퍼: 최근 rttRingSize 개의 RTT(마이크로초)를 원형으로 덮어쓴다.
	// 배열 크기가 고정이라 힙 할당이 없고, 오래된 데이터가 자동으로 사라진다.
	ring  [rttRingSize]uint64
	head  int  // 다음에 쓸 인덱스
	count int  // 현재 저장된 샘플 수 (최대 rttRingSize)

	retransmit uint32 // 누적 재전송 횟수
}

// addRTT — 새 RTT를 링버퍼에 추가한다.
func (s *connStats) addRTT(us uint64) {
	s.ring[s.head] = us
	s.head = (s.head + 1) % rttRingSize
	if s.count < rttRingSize {
		s.count++
	}
}

// percentiles — 현재 링버퍼에서 p50, p95, p99를 계산한다.
//
// 링버퍼를 복사 후 정렬한다. 원본을 정렬하면 순서가 깨진다.
// 샘플이 없으면 모두 0을 반환한다.
func (s *connStats) percentiles() (p50, p95, p99 uint64) {
	if s.count == 0 {
		return 0, 0, 0
	}

	// 링버퍼에서 유효한 샘플만 복사
	samples := make([]uint64, s.count)
	for i := 0; i < s.count; i++ {
		// head는 "다음에 쓸 위치" = 가장 오래된 위치
		// count < rttRingSize 이면 0번 인덱스부터 count-1까지가 유효
		// count == rttRingSize 이면 head부터 순환하며 전부 유효
		idx := (s.head - s.count + i + rttRingSize) % rttRingSize
		samples[i] = s.ring[idx]
	}

	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })

	p50 = samples[percentileIdx(s.count, 50)]
	p95 = samples[percentileIdx(s.count, 95)]
	p99 = samples[percentileIdx(s.count, 99)]
	return
}

// percentileIdx — N개 샘플에서 p번째 퍼센타일의 인덱스를 계산한다.
func percentileIdx(n, p int) int {
	idx := (n * p / 100)
	if idx >= n {
		idx = n - 1
	}
	return idx
}

// isSpike — 최신 RTT가 p99 × spikeMultiplier를 초과하면 spike로 판단한다.
func (s *connStats) isSpike(latestUs uint64) (bool, uint64) {
	_, _, p99 := s.percentiles()
	if p99 == 0 {
		return false, 0
	}
	threshold := p99 * spikeMultiplier
	return latestUs > threshold, threshold
}

// ─────────────────────────────────────────────
// Processor — 이벤트를 받아 집계하고 스냅샷을 내보내는 중심 컴포넌트
// ─────────────────────────────────────────────

// BroadcastFn — hub.Broadcast와 같은 시그니처의 함수 타입.
// stats가 hub를 직접 임포트하지 않고 함수 포인터만 받도록 해서
// 패키지 간 순환 의존을 방지한다.
type BroadcastFn func(model.OutboundMsg)

// Processor — 이벤트 처리 + 집계 + 스냅샷 발행을 담당
type Processor struct {
	resolver  resolver.ServiceResolver
	broadcast BroadcastFn

	mu    sync.Mutex
	conns map[ConnKey]*connStats
}

// New — Processor를 생성한다.
//
// r: IP → 서비스 이름 변환기 (DockerResolver or StaticResolver)
// fn: 완성된 OutboundMsg를 WebSocket으로 내보내는 함수 (hub.Broadcast)
func New(r resolver.ServiceResolver, fn BroadcastFn) *Processor {
	return &Processor{
		resolver:  r,
		broadcast: fn,
		conns:     make(map[ConnKey]*connStats),
	}
}

// Run — 이벤트 채널을 소비하고, 1초 타이머로 스냅샷을 발행한다.
//
// 반드시 별도 goroutine으로 실행: go proc.Run(eventCh)
// eventCh가 닫히면 (agent 종료 시) 루프를 빠져나온다.
func (p *Processor) Run(eventCh <-chan model.Event) {
	ticker := time.NewTicker(snapshotInterval)
	defer ticker.Stop()

	for {
		select {
		case e, ok := <-eventCh:
			if !ok {
				// agent가 종료됨 → 마지막 스냅샷 발행 후 종료
				log.Println("[stats] 이벤트 채널 닫힘, Processor 종료")
				p.publishSnapshots()
				return
			}
			p.handleEvent(e)

		case <-ticker.C:
			p.publishSnapshots()
		}
	}
}

// handleEvent — 이벤트 하나를 처리한다.
//
// 1. resolver로 daddr → 서비스 이름 변환
// 2. RawEvent를 즉시 브로드캐스트 (실시간 이벤트 로그용)
// 3. RTT/retransmit 이벤트면 링버퍼에 추가
func (p *Processor) handleEvent(e model.Event) {
	dstService := p.resolver.Resolve(e.DAddr)
	srcService := p.resolver.Resolve(e.SAddr)

	// 실시간 이벤트를 즉시 클라이언트로 전달
	raw := model.RawEvent{
		Type:       e.Type,
		SrcService: srcService,
		DstService: dstService,
		DPort:      e.DPort,
		LatencyUs:  e.LatencyUs,
		TimestampNs: time.Now().UnixNano(),
	}
	p.broadcast(model.OutboundMsg{MsgType: "event", Event: &raw})

	// 링버퍼 업데이트
	key := ConnKey{Src: srcService, Dst: dstService}
	p.mu.Lock()
	cs := p.getOrCreate(key)

	switch e.Type {
	case "connect", "rtt":
		if e.LatencyUs > 0 {
			cs.addRTT(e.LatencyUs)
		}
	case "retransmit":
		cs.retransmit++
	}
	p.mu.Unlock()
}

// publishSnapshots — 모든 연결의 현재 통계를 StatSnapshot으로 만들어 브로드캐스트한다.
func (p *Processor) publishSnapshots() {
	p.mu.Lock()
	// 스냅샷 생성 중 lock을 오래 잡지 않도록 먼저 복사
	type entry struct {
		key ConnKey
		cs  connStats
	}
	entries := make([]entry, 0, len(p.conns))
	for k, cs := range p.conns {
		entries = append(entries, entry{key: k, cs: *cs})
	}
	p.mu.Unlock()

	for _, e := range entries {
		p50, p95, p99 := e.cs.percentiles()

		// 가장 최근 RTT로 spike 판단
		var latestUs uint64
		if e.cs.count > 0 {
			latestIdx := (e.cs.head - 1 + rttRingSize) % rttRingSize
			latestUs = e.cs.ring[latestIdx]
		}
		spike, threshold := e.cs.isSpike(latestUs)

		snap := model.StatSnapshot{
			SrcService:       e.key.Src,
			DstService:       e.key.Dst,
			P50Us:            p50,
			P95Us:            p95,
			P99Us:            p99,
			RetransmitCount:  e.cs.retransmit,
			SampleCount:      e.cs.count,
			IsSpike:          spike,
			SpikeThresholdUs: threshold,
		}

		if spike {
			log.Printf("[stats] SPIKE 감지: %s→%s latency=%dµs threshold=%dµs",
				e.key.Src, e.key.Dst, latestUs, threshold)
		}

		p.broadcast(model.OutboundMsg{MsgType: "stats", Stats: &snap})
	}
}

// getOrCreate — ConnKey에 해당하는 connStats를 가져오거나 새로 만든다.
// 호출 전 p.mu를 잡고 있어야 한다.
func (p *Processor) getOrCreate(key ConnKey) *connStats {
	if cs, ok := p.conns[key]; ok {
		return cs
	}
	cs := &connStats{}
	p.conns[key] = cs
	log.Printf("[stats] 새 연결 추적 시작: %s → %s", key.Src, key.Dst)
	return cs
}
