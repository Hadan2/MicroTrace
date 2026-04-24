import { useEffect, useRef, useState } from 'react'
import type { StatSnapshot, OutboundMsg, ConnHistory } from '../types'

// key: "src→dst", value: 최신 StatSnapshot
export type SnapshotMap = Record<string, StatSnapshot>

// 시계열 히스토리 한 포인트
export interface HistoryPoint {
  time: number   // Date.now()
  avg_us: number
  p50_us: number
  p95_us: number
  p99_us: number
  jitter_us: number
}

// key: "src→dst", value: 최근 3600개 포인트 (1초 주기 → 1시간)
export type HistoryMap = Record<string, HistoryPoint[]>

const MAX_HISTORY = 3600

export function useWebSocket(url: string) {
  const [snapshots, setSnapshots] = useState<SnapshotMap>({})
  const [history, setHistory] = useState<HistoryMap>({})
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)

      ws.onclose = () => {
        setConnected(false)
        setTimeout(connect, 2000)
      }

      ws.onmessage = (e) => {
        const msg: OutboundMsg = JSON.parse(e.data)

        if (msg.msg_type === 'stats' && msg.stats) {
          const snap = msg.stats
          const key = `${snap.src_service}→${snap.dst_service}`

          setSnapshots(prev => ({ ...prev, [key]: snap }))

          setHistory(prev => {
            const existing = prev[key] ?? []
            const point: HistoryPoint = {
              time: Date.now(),
              avg_us: snap.avg_us,
              p50_us: snap.p50_us,
              p95_us: snap.p95_us,
              p99_us: snap.p99_us,
              jitter_us: snap.jitter_us,
            }
            const updated = [...existing, point].slice(-MAX_HISTORY)
            return { ...prev, [key]: updated }
          })
        } else if (msg.msg_type === 'history' && msg.history) {
          // 신규 연결 시 collector가 보내는 전체 히스토리로 초기화
          const nextSnapshots: SnapshotMap = {}
          const nextHistory: HistoryMap = {}
          msg.history.forEach((conn: ConnHistory) => {
            nextHistory[conn.key] = conn.points.map(p => ({
              time: p.time,
              avg_us: p.avg_us,
              p50_us: p.p50_us,
              p95_us: p.p95_us,
              p99_us: p.p99_us,
              jitter_us: p.jitter_us,
            }))
          })
          setSnapshots(prev => ({ ...nextSnapshots, ...prev }))
          setHistory(nextHistory)
        } else if (msg.msg_type === 'remove' && msg.remove_key) {
          const key = msg.remove_key
          setSnapshots(prev => {
            const next = { ...prev }
            delete next[key]
            return next
          })
          setHistory(prev => {
            const next = { ...prev }
            delete next[key]
            return next
          })
        }
      }
    }

    connect()
    return () => {
      const ws = wsRef.current
      if (ws) {
        ws.onclose = null
        ws.close()
        wsRef.current = null
      }
    }
  }, [url])

  return { snapshots, history, connected }
}
