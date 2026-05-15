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

	// connTTL — 마지막 이벤트로부터 이 시간이 지나면 connStats를 삭제한다.
	// 끊긴 연결 노드가 토폴로지에서 자동으로 사라지는 시간.
	connTTL = 30 * time.Second

	// ttlSweepInterval — TTL 만료 연결을 정리하는 주기
	ttlSweepInterval = 10 * time.Second

	// maxHistory — 연결별 시계열 히스토리 최대 보관 개수 (1초 주기 × 3600 = 1시간)
	maxHistory = 3600
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

// FlowKey — 개별 TCP 흐름(소켓)을 식별하는 내부 키
//
// ConnKey가 "서비스 간 연결" 집계용이라면, FlowKey는 "EWMA/mdev 계산용"이다.
// mdev는 소켓별 상태를 가져야 하므로 서비스 단위로 섞으면 안 된다.
//
// PID 필드는 sock_ops 제약으로 실제 pid가 아니라 local_port 값이다.
// 여기에 출발지/목적지 IP와 포트를 함께 묶어 흐름을 구분한다.
type FlowKey struct {
	SockID uint32
	SAddr  string
	DAddr  string
	DPort  uint16
}

// nodeType — resolver가 Docker 캐시에서 알고 있는 IP면 내부, 모르면 외부.
// rDNS로 이름이 바뀐 외부 IP를 internal로 오판하는 것을 방지한다.
func nodeType(ip string, r resolver.ServiceResolver) string {
	if r.IsInternal(ip) {
		return "internal"
	}
	return "external"
}

// flowState — 개별 흐름의 srtt/mdev 상태
//
// 커널 srtt_us 대신 Go에서 직접 EWMA를 계산한다.
// 첫 RTT 샘플에서는 srtt=rtt, mdev=0 으로 초기화하고
// 두 번째 샘플부터 RFC 스타일 공식에 따라 갱신한다.
type flowState struct {
	srttUs      uint64
	mdevUs      uint64
	lastSeen    time.Time
	initialized bool
}

// connStats — 연결 하나의 RTT 링버퍼와 집계 상태
type connStats struct {
	// 링버퍼: 최근 rttRingSize 개의 RTT(마이크로초)를 원형으로 덮어쓴다.
	// 배열 크기가 고정이라 힙 할당이 없고, 오래된 데이터가 자동으로 사라진다.
	ring  [rttRingSize]uint64
	head  int // 다음에 쓸 인덱스
	count int // 현재 저장된 샘플 수 (최대 rttRingSize)

	// jitter 링버퍼: mdev_us 값을 RTT와 동일한 방식으로 보관
	jitterRing  [rttRingSize]uint64
	jitterHead  int
	jitterCount int

	// stableP99: mdev가 낮은 "안정 구간"에서만 업데이트하는 기준선.
	// spike 발생 중에도 이 값은 바뀌지 않으므로 Shadowing Effect 방지.
	// spike 판단 threshold = stableP99 × spikeMultiplier
	stableP99 uint64

	retransmit uint32    // 누적 재전송 횟수
	lastSeen   time.Time // 마지막 이벤트 수신 시각 (TTL 계산용)
	srcType    string    // "internal" | "external"
	dstType    string    // "internal" | "external"

	// history: 1초마다 스냅샷 포인트를 추가. 최대 maxHistory개 (오래된 것부터 제거)
	history []model.HistoryPoint
}

// addRTT — 새 RTT를 링버퍼에 추가한다.
func (s *connStats) addRTT(us uint64) {
	s.ring[s.head] = us
	s.head = (s.head + 1) % rttRingSize
	if s.count < rttRingSize {
		s.count++
	}
}

// addJitter — 새 jitter(mdev) 값을 링버퍼에 추가한다.
func (s *connStats) addJitter(us uint64) {
	s.jitterRing[s.jitterHead] = us
	s.jitterHead = (s.jitterHead + 1) % rttRingSize
	if s.jitterCount < rttRingSize {
		s.jitterCount++
	}
}

// latestJitter — 가장 최근에 계산된 flow-level mdev 값을 반환한다.
func (s *connStats) latestJitter() uint64 {
	if s.jitterCount == 0 {
		return 0
	}
	idx := (s.jitterHead - 1 + rttRingSize) % rttRingSize
	return s.jitterRing[idx]
}

// updateStableP99 — 네트워크가 안정적일 때만 stableP99를 갱신한다.
//
// "안정적"의 기준: jitter < stableJitterThreshold (현재 P50의 50%)
// spike 발생 중(jitter 높음)에는 stableP99가 바뀌지 않아 Shadowing Effect를 방지한다.
// stableP99가 아직 0이면(초기 상태) 무조건 세팅한다.
func (s *connStats) updateStableP99(jitterUs uint64) {
	_, p50, _, p99 := s.percentiles()
	if p99 == 0 {
		return
	}
	// 안정 구간 판단: jitter가 P50의 절반 미만이면 안정적으로 본다
	stableThreshold := p50 / 2
	if s.stableP99 == 0 || jitterUs <= stableThreshold {
		s.stableP99 = p99
	}
}

// percentiles — 현재 링버퍼에서 avg, p50, p95, p99를 계산한다.
//
// 링버퍼를 복사 후 정렬한다. 원본을 정렬하면 순서가 깨진다.
// 샘플이 없으면 모두 0을 반환한다.
func (s *connStats) percentiles() (avg, p50, p95, p99 uint64) {
	if s.count == 0 {
		return 0, 0, 0, 0
	}

	// 링버퍼에서 유효한 샘플만 복사
	samples := make([]uint64, s.count)
	var sum uint64
	for i := 0; i < s.count; i++ {
		idx := (s.head - s.count + i + rttRingSize) % rttRingSize
		samples[i] = s.ring[idx]
		sum += s.ring[idx]
	}

	avg = sum / uint64(s.count)

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

// isSpike — 최신 RTT가 stableP99 × spikeMultiplier를 초과하면 spike로 판단한다.
//
// stableP99: 안정 구간에서만 갱신되는 기준선.
// 큰 spike 직후에도 threshold가 치솟지 않으므로 Shadowing Effect가 없다.
// stableP99가 아직 없으면 현재 p99로 대체한다.
func (s *connStats) isSpike(latestUs uint64) (bool, uint64) {
	baseline := s.stableP99
	if baseline == 0 {
		_, _, _, p99 := s.percentiles()
		baseline = p99
	}
	if baseline == 0 {
		return false, 0
	}
	threshold := baseline * spikeMultiplier
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
	flows map[FlowKey]*flowState
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
		flows:     make(map[FlowKey]*flowState),
	}
}

// Run — 이벤트 채널을 소비하고, 1초 타이머로 스냅샷을 발행한다.
//
// 반드시 별도 goroutine으로 실행: go proc.Run(eventCh)
// eventCh가 닫히면 (agent 종료 시) 루프를 빠져나온다.
func (p *Processor) Run(eventCh <-chan model.Event) {
	ticker := time.NewTicker(snapshotInterval)
	sweeper := time.NewTicker(ttlSweepInterval)
	defer ticker.Stop()
	defer sweeper.Stop()

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

		case <-sweeper.C:
			p.sweepExpired()
		}
	}
}

// handleEvent — 이벤트 하나를 처리한다.
//
// 1. resolver로 daddr → 서비스 이름 변환
// 2. RawEvent를 즉시 브로드캐스트 (실시간 이벤트 로그용)
// 3. RTT/retransmit 이벤트면 링버퍼에 추가
func (p *Processor) handleEvent(e model.Event) {
	now := time.Now()
	dstService := p.resolver.Resolve(e.DAddr)
	srcService := p.resolver.Resolve(e.SAddr)

	// 실시간 이벤트를 즉시 클라이언트로 전달
	raw := model.RawEvent{
		Type:        e.Type,
		SrcService:  srcService,
		DstService:  dstService,
		DPort:       e.DPort,
		LatencyUs:   e.LatencyUs,
		TimestampNs: now.UnixNano(),
	}
	p.broadcast(model.OutboundMsg{MsgType: "event", Event: &raw})

	// 링버퍼 업데이트
	connKey := ConnKey{Src: srcService, Dst: dstService}
	p.mu.Lock()
	cs := p.getOrCreateConn(connKey)

	cs.srcType = nodeType(e.SAddr, p.resolver)
	cs.dstType = nodeType(e.DAddr, p.resolver)
	cs.lastSeen = now
	switch e.Type {
	case "connect", "rtt":
		if e.LatencyUs > 0 {
			flowKey := FlowKey{
				SockID: e.PID,
				SAddr:  e.SAddr,
				DAddr:  e.DAddr,
				DPort:  e.DPort,
			}
			jitterUs := p.updateFlowMdev(flowKey, e.LatencyUs, now)
			cs.addRTT(e.LatencyUs)
			cs.addJitter(jitterUs)
			cs.updateStableP99(jitterUs)
		}
	case "retransmit":
		cs.retransmit++
	}
	p.mu.Unlock()
}

// publishSnapshots — 모든 연결의 현재 통계를 StatSnapshot으로 만들어 브로드캐스트한다.
func (p *Processor) publishSnapshots() {
	now := time.Now()

	// lock 한 번으로: 스냅샷 계산 + 히스토리 저장 + 발행 목록 수집을 함께 처리한다.
	// 이전 구현은 unlock → 재lock 사이에 sweepExpired가 connStats를 삭제할 수 있었다.
	p.mu.Lock()
	type outEntry struct {
		snap  model.StatSnapshot
		spike bool
	}
	out := make([]outEntry, 0, len(p.conns))

	for key, cs := range p.conns {
		avg, p50, p95, p99 := cs.percentiles()
		jitter := cs.latestJitter()

		var latestUs uint64
		if cs.count > 0 {
			latestIdx := (cs.head - 1 + rttRingSize) % rttRingSize
			latestUs = cs.ring[latestIdx]
		}
		spike, threshold := cs.isSpike(latestUs)

		snap := model.StatSnapshot{
			SrcService:       key.Src,
			DstService:       key.Dst,
			SrcType:          cs.srcType,
			DstType:          cs.dstType,
			LatestSRTTUs:     latestUs,
			AvgUs:            avg,
			P50Us:            p50,
			P95Us:            p95,
			P99Us:            p99,
			JitterUs:         jitter,
			RetransmitCount:  cs.retransmit,
			SampleCount:      cs.count,
			IsSpike:          spike,
			SpikeThresholdUs: threshold,
		}

		// 히스토리 포인트 저장 — 같은 lock 안에서 처리
		pt := model.HistoryPoint{
			Time:         now.UnixMilli(),
			LatestSRTTUs: latestUs,
			AvgUs:        avg,
			P50Us:        p50,
			P95Us:        p95,
			P99Us:        p99,
			JitterUs:     jitter,
		}
		cs.history = append(cs.history, pt)
		if len(cs.history) > maxHistory {
			cs.history = cs.history[len(cs.history)-maxHistory:]
		}

		out = append(out, outEntry{snap: snap, spike: spike})
	}
	p.mu.Unlock()

	// broadcast는 lock 밖에서 — hub 전송이 느려도 stats 처리를 막지 않는다.
	for _, e := range out {
		if e.spike {
			log.Printf("[stats] SPIKE 감지: %s→%s latency=%dµs threshold=%dµs",
				e.snap.SrcService, e.snap.DstService, e.snap.LatestSRTTUs, e.snap.SpikeThresholdUs)
		}
		p.broadcast(model.OutboundMsg{MsgType: "stats", Stats: &e.snap})
	}
}

// updateFlowMdev — 개별 흐름의 srtt/mdev를 갱신하고 최신 mdev를 반환한다.
//
// 1차 구현 공식:
//
//	err  = abs(rtt - srtt)
//	mdev = mdev*0.75 + err*0.25
//	srtt = srtt*0.875 + rtt*0.125
//
// 정수 연산으로 처리하기 위해 다음과 같이 계산한다.
//
//	mdev = (3*mdev + err) / 4
//	srtt = (7*srtt + rtt) / 8
func (p *Processor) updateFlowMdev(key FlowKey, rttUs uint64, now time.Time) uint64 {
	fs := p.getOrCreateFlow(key, now)
	fs.lastSeen = now

	if !fs.initialized {
		fs.srttUs = rttUs
		fs.mdevUs = 0
		fs.initialized = true
		return 0
	}

	errUs := absDiff(rttUs, fs.srttUs)
	fs.mdevUs = (3*fs.mdevUs + errUs) / 4
	fs.srttUs = (7*fs.srttUs + rttUs) / 8
	return fs.mdevUs
}

func absDiff(a, b uint64) uint64 {
	if a > b {
		return a - b
	}
	return b - a
}

// getOrCreateConn — ConnKey에 해당하는 connStats를 가져오거나 새로 만든다.
// 호출 전 p.mu를 잡고 있어야 한다.
func (p *Processor) getOrCreateConn(key ConnKey) *connStats {
	if cs, ok := p.conns[key]; ok {
		return cs
	}
	cs := &connStats{lastSeen: time.Now()}
	p.conns[key] = cs
	log.Printf("[stats] 새 연결 추적 시작: %s → %s", key.Src, key.Dst)
	return cs
}

// getOrCreateFlow — FlowKey에 해당하는 flowState를 가져오거나 새로 만든다.
// 호출 전 p.mu를 잡고 있어야 한다.
func (p *Processor) getOrCreateFlow(key FlowKey, now time.Time) *flowState {
	if fs, ok := p.flows[key]; ok {
		return fs
	}
	fs := &flowState{lastSeen: now}
	p.flows[key] = fs
	return fs
}

// sweepExpired — lastSeen이 connTTL을 초과한 연결을 삭제하고
// 프론트엔드에 "remove" 메시지를 전송해서 노드/엣지를 제거한다.
func (p *Processor) sweepExpired() {
	now := time.Now()
	p.mu.Lock()
	var expired []ConnKey
	for key, cs := range p.conns {
		if now.Sub(cs.lastSeen) > connTTL {
			expired = append(expired, key)
			delete(p.conns, key)
		}
	}
	for key, fs := range p.flows {
		if now.Sub(fs.lastSeen) > connTTL {
			delete(p.flows, key)
		}
	}
	p.mu.Unlock()

	for _, key := range expired {
		log.Printf("[stats] TTL 만료 → 연결 제거: %s → %s", key.Src, key.Dst)
		p.broadcast(model.OutboundMsg{
			MsgType:   "remove",
			RemoveKey: key.Src + "→" + key.Dst,
		})
	}
}

// ForwardResource — resource_agent 스냅샷을 받아 hub로 브로드캐스트한다.
//
// main.go에서 직접 Broadcast를 호출하지 않고 Processor에 위임함으로써
// main.go를 배선(wiring)만 하는 역할로 유지한다.
// resCh가 닫히면(resource_agent 종료 시) goroutine이 자동으로 종료된다.
func (p *Processor) ForwardResource(resCh <-chan model.ResourceSnapshot) {
	go func() {
		for snap := range resCh {
			s := snap
			log.Printf("[resource] %s cpu=%.2f%% mem=%dKB io_wait=%.2f%%",
				s.ServiceName, s.CPUPct, s.MemCurrentBytes/1024, s.IOWaitPct)
			p.broadcast(model.OutboundMsg{MsgType: "resource", Resource: &s})
		}
		log.Println("[stats] resource_agent 스트림 종료")
	}()
}

// GetHistory — 현재 추적 중인 모든 연결의 히스토리를 반환한다.
// 신규 클라이언트 연결 시 호출해서 한 번에 전송한다.
func (p *Processor) GetHistory() []model.ConnHistory {
	p.mu.Lock()
	defer p.mu.Unlock()

	result := make([]model.ConnHistory, 0, len(p.conns))
	for key, cs := range p.conns {
		if len(cs.history) == 0 {
			continue
		}
		points := make([]model.HistoryPoint, len(cs.history))
		copy(points, cs.history)
		result = append(result, model.ConnHistory{
			Key:    key.Src + "→" + key.Dst,
			Points: points,
		})
	}
	return result
}
