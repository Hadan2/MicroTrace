import { useEffect, useRef, useState } from 'react'
import type { StatSnapshot, OutboundMsg } from '../types'

// key: "src→dst", value: 최신 StatSnapshot
export type SnapshotMap = Record<string, StatSnapshot>

export function useWebSocket(url: string) {
  const [snapshots, setSnapshots] = useState<SnapshotMap>({})
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
        }
      }
    }

    connect()
    return () => {
      const ws = wsRef.current
      if (ws) {
        // onclose 핸들러 제거 — cleanup 시 재연결 루프 방지
        ws.onclose = null
        ws.close()
        wsRef.current = null
      }
    }
  }, [url])

  return { snapshots, connected }
}
