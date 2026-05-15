import { useEffect, useRef, useState } from 'react'
import type { StatSnapshot, ServiceSnapshot, SpikeEvent, OutboundMsg, ConnHistory } from '../types'

export type SnapshotMap = Record<string, StatSnapshot>
export type ServiceMap  = Record<string, ServiceSnapshot>

export interface HistoryPoint {
  time: number
  latest_srtt_us: number
  avg_us: number
  p50_us: number
  p95_us: number
  p99_us: number
  jitter_us: number
}

export type HistoryMap = Record<string, HistoryPoint[]>

const MAX_HISTORY  = 3600
const MAX_EVENTS   = 100

export function useWebSocket(url: string) {
  const [snapshots, setSnapshots] = useState<SnapshotMap>({})
  const [services,  setServices]  = useState<ServiceMap>({})
  const [history,   setHistory]   = useState<HistoryMap>({})
  const [events,    setEvents]    = useState<SpikeEvent[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen  = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        setTimeout(connect, 2000)
      }

      ws.onmessage = (e) => {
        const msg: OutboundMsg = JSON.parse(e.data)

        if (msg.msg_type === 'stats' && msg.stats) {
          const snap = msg.stats
          const key  = `${snap.src_service}→${snap.dst_service}`

          setSnapshots(prev => {
            const prevSnap = prev[key]

            // is_spike false→true 전환 시 SpikeEvent 생성
            if (snap.is_spike && prevSnap && !prevSnap.is_spike) {
              const ev: SpikeEvent = {
                id: `${key}-${Date.now()}`,
                timestamp: Date.now(),
                key,
                src: snap.src_service,
                dst: snap.dst_service,
                p99_us: snap.p99_us,
                baseline_us: snap.baseline_us ?? snap.spike_threshold_us / 3,
                severity: snap.p99_us > 80_000 ? 'critical' : 'warning',
                cause_kind: snap.cause_kind ?? 'network',
                dst_cpu_pct:          snap.dst_cpu_pct ?? 0,
                dst_io_wait_pct:      snap.dst_io_wait_pct ?? 0,
                dst_mem_pressure_pct: snap.dst_mem_pressure_pct ?? 0,
              }
              setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS))
            }

            return { ...prev, [key]: snap }
          })

          setHistory(prev => {
            const existing = prev[key] ?? []
            const point: HistoryPoint = {
              time: Date.now(),
              latest_srtt_us: snap.latest_srtt_us,
              avg_us:    snap.avg_us,
              p50_us:    snap.p50_us,
              p95_us:    snap.p95_us,
              p99_us:    snap.p99_us,
              jitter_us: snap.jitter_us,
            }
            return { ...prev, [key]: [...existing, point].slice(-MAX_HISTORY) }
          })
        }

        else if (msg.msg_type === 'history' && msg.history) {
          const nextHistory: HistoryMap = {}
          msg.history.forEach((conn: ConnHistory) => {
            nextHistory[conn.key] = conn.points.map(p => ({
              time: p.time,
              latest_srtt_us: p.latest_srtt_us,
              avg_us:    p.avg_us,
              p50_us:    p.p50_us,
              p95_us:    p.p95_us,
              p99_us:    p.p99_us,
              jitter_us: p.jitter_us,
            }))
          })
          setHistory(nextHistory)
        }

        else if (msg.msg_type === 'resource' && msg.resource) {
          const r = msg.resource
          setServices(prev => {
            const existing = prev[r.service_name]
            const history  = [...(existing?.history ?? []), {
              time:             r.timestamp_ms,
              cpu_pct:          r.cpu_pct,
              io_wait_pct:      r.io_wait_pct,
              mem_pressure_pct: r.mem_pressure_pct,
              cpu_throttle_pct: r.cpu_throttle_pct,
            }].slice(-300) // 5분치 보관
            return {
              ...prev,
              [r.service_name]: {
                name:             r.service_name,
                cpu_pct:          r.cpu_pct,
                io_wait_pct:      r.io_wait_pct,
                mem_pressure_pct: r.mem_pressure_pct,
                cpu_throttle_pct: r.cpu_throttle_pct,
                stress_kind:      existing?.stress_kind ?? null,
                history,
              },
            }
          })
        }

        else if (msg.msg_type === 'remove' && msg.remove_key) {
          const key = msg.remove_key
          setSnapshots(prev => { const n = { ...prev }; delete n[key]; return n })
          setHistory(prev   => { const n = { ...prev }; delete n[key]; return n })
        }
      }
    }

    connect()
    return () => {
      const ws = wsRef.current
      if (ws) { ws.onclose = null; ws.close(); wsRef.current = null }
    }
  }, [url])

  return { snapshots, services, history, events, connected }
}
