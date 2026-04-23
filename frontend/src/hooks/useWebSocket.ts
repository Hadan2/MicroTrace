import { useEffect, useRef, useState } from 'react'
import type { StatSnapshot, OutboundMsg } from '../types'

// key: "src→dst", value: 최신 StatSnapshot
export type SnapshotMap = Record<string, StatSnapshot>

// 시계열 히스토리 한 포인트
export interface HistoryPoint {
  time: number   // Date.now()
  p50: number
  p95: number
  p99: number
}

// key: "src→dst", value: 최근 60개 포인트 (1초 주기 → 60초)
export type HistoryMap = Record<string, HistoryPoint[]>

const MAX_HISTORY = 60

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
              p50: snap.p50_us,
              p95: snap.p95_us,
              p99: snap.p99_us,
            }
            const updated = [...existing, point].slice(-MAX_HISTORY)
            return { ...prev, [key]: updated }
          })
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
