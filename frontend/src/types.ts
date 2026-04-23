// collector/model/event.go 의 OutboundMsg와 1:1 대응

export interface StatSnapshot {
  src_service: string
  dst_service: string
  src_type: 'internal' | 'external'
  dst_type: 'internal' | 'external'
  p50_us: number
  p95_us: number
  p99_us: number
  retransmit_count: number
  sample_count: number
  is_spike: boolean
  spike_threshold_us: number
}

export interface OutboundMsg {
  msg_type: 'stats' | 'event' | 'remove'
  stats?: StatSnapshot
  remove_key?: string
}

// 토폴로지 엣지 하나 = 서비스 쌍의 최신 통계
export type EdgeStats = StatSnapshot
