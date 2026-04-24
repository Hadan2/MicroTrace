// collector/model/event.go 의 OutboundMsg와 1:1 대응

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

export interface OutboundMsg {
  msg_type: 'stats' | 'event' | 'remove' | 'history'
  stats?: StatSnapshot
  remove_key?: string
  history?: ConnHistory[]
}

// 토폴로지 엣지 하나 = 서비스 쌍의 최신 통계
export type EdgeStats = StatSnapshot
