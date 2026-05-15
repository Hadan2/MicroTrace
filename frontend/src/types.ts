// collector/model/event.go 의 OutboundMsg와 1:1 대응

export type CauseKind = 'network' | 'cpu' | 'io' | 'memory' | 'external'
export type StressKind = 'cpu' | 'io' | 'memory' | null

export interface StatSnapshot {
  src_service: string
  dst_service: string
  src_type: 'internal' | 'external'
  dst_type: 'internal' | 'external'
  latest_srtt_us: number
  avg_us: number
  p50_us: number
  p95_us: number
  p99_us: number
  jitter_us: number
  retransmit_count: number
  sample_count: number
  is_spike: boolean
  spike_threshold_us: number

  // Phase 2 — collector가 아직 안 보내는 필드는 optional
  cause_kind?: CauseKind
  close_states?: {
    fin: number
    rst: number
    timeout: number
  }
  dst_cpu_pct?: number
  dst_io_wait_pct?: number
  dst_mem_pressure_pct?: number
  baseline_us?: number
}

export interface ResourcePoint {
  time: number
  cpu_pct: number
  io_wait_pct: number
  mem_pressure_pct: number
  cpu_throttle_pct: number
}

export interface ServiceSnapshot {
  name: string
  cpu_pct: number
  io_wait_pct: number
  mem_pressure_pct: number
  cpu_throttle_pct: number
  stress_kind: StressKind
  history: ResourcePoint[]
}

export interface SpikeEvent {
  id: string
  timestamp: number
  key: string
  src: string
  dst: string
  p99_us: number
  baseline_us: number
  severity: 'warning' | 'critical'
  cause_kind: CauseKind
  dst_cpu_pct: number
  dst_io_wait_pct: number
  dst_mem_pressure_pct: number
}

export interface HistoryPoint {
  time: number
  latest_srtt_us: number
  avg_us: number
  p50_us: number
  p95_us: number
  p99_us: number
  jitter_us: number
}

export interface ConnHistory {
  key: string
  points: HistoryPoint[]
}

export interface ResourceMsg {
  service_name:       string
  timestamp_ms:       number
  cpu_pct:            number
  cpu_throttle_pct:   number
  mem_current_bytes:  number
  mem_limit_bytes:    number
  mem_pressure_pct:   number
  io_read_bytes_per_s:  number
  io_write_bytes_per_s: number
  io_wait_pct:        number
  oom_kill_count:     number
}

export interface OutboundMsg {
  msg_type: 'stats' | 'event' | 'remove' | 'history' | 'resource'
  stats?: StatSnapshot
  remove_key?: string
  history?: ConnHistory[]
  resource?: ResourceMsg
}

export type EdgeStats = StatSnapshot
