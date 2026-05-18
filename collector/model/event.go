// model/event.go
//
// 프로젝트 전체에서 사용하는 공유 타입을 한 곳에 정의한다.
// 여러 패키지(agent, stats, hub)가 각자 타입을 정의하면
// 필드 하나 바뀔 때 여러 파일을 고쳐야 한다.
// 이 파일 하나만 수정하면 전 패키지에 전파된다.

package model

// ─────────────────────────────────────────────
// Event — agent(C 바이너리)가 JSON으로 출력하는 원시 이벤트
//
// tcp_trace_common.h 의 struct event 와 필드가 일치해야 한다.
// Phase 2에서 필드가 추가되면 여기와 tcp_trace_common.h 두 곳만 수정한다.
// ─────────────────────────────────────────────
type Event struct {
	Type      string `json:"type"`       // "connect" | "rtt" | "retransmit"
	PID       uint32 `json:"pid"`        // sock_ops 제한으로 local_port 대체 사용
	Comm      string `json:"comm"`       // 프로세스 이름 (sock_ops에선 항상 빈 문자열)
	SAddr     string `json:"saddr"`      // 출발지 IPv4 문자열 — 이 소켓이 속한 컨테이너 IP
	DAddr     string `json:"daddr"`      // 목적지 IPv4 문자열 (예: "172.17.0.3")
	DPort     uint16 `json:"dport"`      // 목적지 포트
	LatencyUs uint64 `json:"latency_us"` // RTT (마이크로초). retransmit 이벤트에서는 0
	JitterUs  uint64 `json:"jitter_us"`  // RTT 변동폭 (mdev_us >> 3). retransmit에서는 0
}

// HistoryPoint — 1초 단위 시계열 포인트 (collector가 보관, 신규 클라이언트에게 전송)
type HistoryPoint struct {
	Time         int64  `json:"time"` // Unix millisecond
	LatestSRTTUs uint64 `json:"latest_srtt_us"`
	AvgUs        uint64 `json:"avg_us"`
	P50Us        uint64 `json:"p50_us"`
	P95Us        uint64 `json:"p95_us"`
	P99Us        uint64 `json:"p99_us"`
	JitterUs     uint64 `json:"jitter_us"` // 최신 flow-level mdev 값
}

// ConnHistory — 연결 하나의 전체 히스토리 (신규 클라이언트 전송용)
type ConnHistory struct {
	Key    string         `json:"key"`
	Points []HistoryPoint `json:"points"`
}

// OutboundMsg — WebSocket을 통해 클라이언트로 나가는 모든 메시지의 봉투(envelope)
//
// 포인터 임베딩 대신 명시적 필드를 사용한다.
// 포인터 임베딩 + omitempty 조합은 Go JSON 직렬화 시 내부 필드가
// 인라인으로 펼쳐지지 않고 통째로 생략되는 버그가 있다.
// 명시적 필드를 쓰면 항상 예측 가능한 JSON 구조가 보장된다.
type OutboundMsg struct {
	MsgType string `json:"msg_type"` // "event" | "stats" | "remove" | "history" | "resource"

	Event     *RawEvent         `json:"event,omitempty"`
	Stats     *StatSnapshot     `json:"stats,omitempty"`
	Resource  *ResourceSnapshot `json:"resource,omitempty"`
	RemoveKey string            `json:"remove_key,omitempty"`

	// MsgType == "history" 일 때 채워진다. 신규 클라이언트 연결 시 한 번만 전송.
	History []ConnHistory `json:"history,omitempty"`
}

// RawEvent — Event 에 서비스 이름(resolver 결과)을 붙인 실시간 이벤트
type RawEvent struct {
	Type        string `json:"type"`        // "connect" | "rtt" | "retransmit"
	SrcService  string `json:"src_service"` // resolver가 채운 출발지 서비스 이름
	DstService  string `json:"dst_service"` // resolver가 채운 목적지 서비스 이름
	DPort       uint16 `json:"dport"`
	LatencyUs   uint64 `json:"latency_us"`
	TimestampNs int64  `json:"timestamp_ns"` // collector 수신 시각 (Unix nanosecond)
}

// ResourceSnapshot — resource_agent가 1초마다 출력하는 컨테이너 자원 스냅샷
//
// cgroup v2 파일에서 직접 읽은 값이다. 누적 카운터(cpu_usage_usec, throttled_usec 등)는
// resource_agent 내부에서 delta 계산 후 초당 비율(%)로 변환한다.
type ResourceSnapshot struct {
	ServiceName      string  `json:"service_name"`       // 컨테이너 이름(= 서비스 이름)
	TimestampMs      int64   `json:"timestamp_ms"`        // Unix millisecond
	CPUPct           float64 `json:"cpu_pct"`             // CPU 사용률 (0-100)
	CPUThrottlePct   float64 `json:"cpu_throttle_pct"`    // CPU 스로틀 비율 (0-100)
	MemCurrentBytes  uint64  `json:"mem_current_bytes"`   // 현재 메모리 사용량 (bytes)
	MemLimitBytes    uint64  `json:"mem_limit_bytes"`     // 메모리 한도 (bytes, 0=무제한)
	MemPressurePct   float64 `json:"mem_pressure_pct"`    // 메모리 high 이벤트 기반 압력 (0-100)
	IOReadBytesPerS  uint64  `json:"io_read_bytes_per_s"` // 초당 읽기 바이트
	IOWriteBytesPerS uint64  `json:"io_write_bytes_per_s"`// 초당 쓰기 바이트
	IOWaitPct        float64 `json:"io_wait_pct"`         // IO wait 비율 (0-100, /proc/stat 기반)
	OOMKillCount     uint64  `json:"oom_kill_count"`      // oom_kill 누적 횟수 (delta)

	// PSI (Pressure Stall Information) — cgroup memory.pressure, avg10 (최근 10초 평균)
	PSIMemSomePct float64 `json:"psi_mem_some_pct"` // 최소 1개 태스크 stall 비율
	PSIMemFullPct float64 `json:"psi_mem_full_pct"` // 모든 태스크 동시 stall 비율
}

// StatSnapshot — 1초마다 stats 패키지가 생성하는 집계 결과
//
// 클라이언트는 이 메시지로 토폴로지 뷰의 색상·두께를 업데이트한다.
type StatSnapshot struct {
	SrcService       string `json:"src_service"`
	DstService       string `json:"dst_service"`
	SrcType          string `json:"src_type"` // "internal" | "external"
	DstType          string `json:"dst_type"` // "internal" | "external"
	LatestSRTTUs     uint64 `json:"latest_srtt_us"`
	AvgUs            uint64 `json:"avg_us"`
	P50Us            uint64 `json:"p50_us"`
	P95Us            uint64 `json:"p95_us"`
	P99Us            uint64 `json:"p99_us"`
	JitterUs         uint64 `json:"jitter_us"` // 최신 flow-level mdev 값
	RetransmitCount  uint32 `json:"retransmit_count"`
	SampleCount      int    `json:"sample_count"`       // 이번 1초 구간 RTT 샘플 수
	IsSpike          bool   `json:"is_spike"`           // stableP99 기반 spike 여부
	SpikeThresholdUs uint64 `json:"spike_threshold_us"` // 현재 임계값 (stableP99 × 3)

	// cause_kind: spike 발생 시 원인 후보. spike 아니면 빈 문자열.
	// "cpu" | "memory" | "network" | "external"
	CauseKind string `json:"cause_kind,omitempty"`

	// cause_signal: 판별에 사용된 신호. 왜 이 cause_kind가 됐는지 근거.
	// "cpu_throttle_high" | "cpu_throttle_burst" | "oom_kill" | "mem_pressure" | "external_dst" | "none"
	CauseSignal string `json:"cause_signal,omitempty"`

	// dst 서비스의 리소스 현황 (spike 발생 시점 스냅샷). 프론트 Evidence Chip 표시용.
	DstCPUPct        float64 `json:"dst_cpu_pct,omitempty"`
	DstCPUThrottlePct float64 `json:"dst_cpu_throttle_pct,omitempty"`
	DstMemPressurePct float64 `json:"dst_mem_pressure_pct,omitempty"`
	DstIOWaitPct     float64 `json:"dst_io_wait_pct,omitempty"`
}
