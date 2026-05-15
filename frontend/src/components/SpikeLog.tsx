import { useState, useEffect } from 'react'
import type { SpikeEvent } from '../types'
import { fmtUs, fmtTime, timeAgo } from '../utils/format'
import { CAUSE_META } from '../constants/causes'

interface Props {
  events: SpikeEvent[]
  onSelect?: (key: string) => void
}

const LOG_HEIGHT = 168

export default function SpikeLog({ events, onSelect }: Props) {
  const [, setTick] = useState(0)

  // timeAgo 갱신용
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10_000)
    return () => clearInterval(t)
  }, [])

  if (events.length === 0) {
    return (
      <div style={{ height: LOG_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-faint)', fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }}/>
        스파이크 이벤트 없음 — 모든 연결 정상
      </div>
    )
  }

  return (
    <div style={{ height: LOG_HEIGHT, overflowY: 'auto' }}>
      {events.map(ev => {
        const meta     = CAUSE_META[ev.cause_kind]
        const isCrit   = ev.severity === 'critical'
        const dotColor = isCrit ? '#dc2626' : '#d97706'
        const p99Color = isCrit ? '#dc2626' : '#d97706'

        return (
          <div
            key={ev.id}
            onClick={() => onSelect?.(ev.key)}
            style={{
              padding: '7px 16px',
              borderBottom: '1px solid var(--border-soft)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: onSelect ? 'pointer' : 'default',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-subtle)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
          >
            {/* severity dot */}
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, boxShadow: `0 0 5px ${dotColor}88`, display: 'inline-block', flexShrink: 0 }}/>

            {/* 시간 */}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', width: 72, flexShrink: 0 }}>
              {fmtTime(ev.timestamp)}
            </span>

            {/* 연결 */}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              {ev.src} → {ev.dst}
            </span>

            {/* Cause pill */}
            <span style={{
              padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
              background: `${meta.color}14`, border: `1px solid ${meta.color}40`, color: meta.color,
              display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
            }}>
              {meta.icon} {meta.label}
            </span>

            <div style={{ flex: 1 }}/>

            {/* P99 */}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: p99Color, flexShrink: 0 }}>
              P99 {fmtUs(ev.p99_us)}
            </span>

            {/* N× pill */}
            <span style={{
              padding: '2px 6px', borderRadius: 10, fontSize: 10, fontWeight: 600, flexShrink: 0,
              background: isCrit ? '#fef2f2' : '#fef3c7',
              color: isCrit ? '#dc2626' : '#d97706',
            }}>
              {ev.baseline_us > 0 ? `${(ev.p99_us / ev.baseline_us).toFixed(1)}×` : '—'}
            </span>

            {/* time ago */}
            <span style={{ fontSize: 10, color: 'var(--text-faint)', width: 56, textAlign: 'right', flexShrink: 0 }}>
              {timeAgo(ev.timestamp)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
