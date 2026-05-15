import { useState, useEffect } from 'react'
import type { SnapshotMap } from '../hooks/useWebSocket'
import type { ServiceMap } from '../hooks/useMockData'

interface Props {
  connected: boolean
  snapshots: SnapshotMap
  services: ServiceMap
}

function Clock() {
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 8))
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toTimeString().slice(0, 8)), 1000)
    return () => clearInterval(t)
  }, [])
  return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{time}</span>
}

export default function TopBar({ connected, snapshots, services }: Props) {
  const serviceNames = new Set<string>()
  Object.values(snapshots).forEach(s => {
    serviceNames.add(s.src_service)
    serviceNames.add(s.dst_service)
  })

  const spikeCount    = Object.values(snapshots).filter(s => s.is_spike).length
  const stressedCount = Object.values(services).filter(s => s.stress_kind !== null).length

  return (
    <header style={{
      height: 50,
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 12,
      flexShrink: 0,
    }}>
      {/* 로고 */}
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="10" fill="#eff6ff" stroke="#2563eb" strokeWidth="1.5"/>
        <line x1="11" y1="4" x2="11" y2="18" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
        <line x1="4" y1="11" x2="18" y2="11" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
      </svg>

      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
        MicroTrace
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>v0.3</span>

      <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>
        Latency Root-Cause Profiler
      </span>

      {/* 연결 상태 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: connected ? '#16a34a' : '#dc2626',
          boxShadow: connected ? '0 0 0 2px #16a34a33' : '0 0 0 2px #dc262633',
          display: 'inline-block',
        }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {connected ? 'collector connected' : 'reconnecting…'}
        </span>
      </div>

      {/* 뱃지들 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569' }}>
          {serviceNames.size} services
        </span>
        {stressedCount > 0 && (
          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: '#fff7ed', border: '1px solid #fed7aa', color: '#ea580c' }}>
            ⚡ {stressedCount} stressed
          </span>
        )}
        {spikeCount > 0 && (
          <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', animation: 'blink 1.4s infinite' }}>
            🔴 {spikeCount} spike{spikeCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* 우측 */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)' }}>LIVE</span>
        <Clock />
      </div>
    </header>
  )
}
