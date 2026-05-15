import type { SnapshotMap } from '../hooks/useWebSocket'
import type { ServiceMap } from '../hooks/useMockData'
import { fmtUs, latencyStatus, STATUS_COLOR } from '../utils/format'

interface Props {
  snapshots: SnapshotMap
  services: ServiceMap
  selectedKey: string | null
  onSelect: (key: string | null) => void
}

export default function HeatmapMatrixView({ snapshots, services, selectedKey, onSelect }: Props) {
  // 모든 서비스 목록 (출발지 + 목적지)
  const srcSet = new Set<string>()
  const dstSet = new Set<string>()
  Object.values(snapshots).forEach(s => {
    srcSet.add(s.src_service)
    dstSet.add(s.dst_service)
  })
  const srcs = [...srcSet].sort()
  const dsts = [...dstSet].sort()

  // 빠른 조회용 맵
  const snapMap: Record<string, typeof Object.values<any>> = {}
  Object.values(snapshots).forEach(s => {
    snapMap[`${s.src_service}→${s.dst_service}`] = s as any
  })

  const CELL = 30

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>
          Adjacency matrix — row=source, column=destination, color=P99
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { color: '#16a34a', label: 'OK' },
            { color: '#d97706', label: 'Warn' },
            { color: '#ea580c', label: 'High' },
            { color: '#dc2626', label: 'Critical' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 12, height: 12, background: color, borderRadius: 2 }}/>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Matrix */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 1 }}>
          <thead>
            <tr>
              {/* 빈 왼쪽 상단 셀 */}
              <th style={{ minWidth: 100 }}/>
              {dsts.map(dst => {
                const svc = services[dst]
                const isStressed = svc?.stress_kind !== null
                return (
                  <th key={dst} style={{ verticalAlign: 'bottom', paddingBottom: 4, minWidth: CELL }}>
                    <div style={{
                      writingMode: 'vertical-rl',
                      transform: 'rotate(180deg)',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: isStressed ? '#dc2626' : 'var(--text-muted)',
                      fontWeight: isStressed ? 600 : 400,
                      maxHeight: 80,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {dst}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {srcs.map(src => {
              const svc = services[src]
              const isStressed = svc?.stress_kind !== null
              return (
                <tr key={src}>
                  {/* 행 레이블 */}
                  <td style={{
                    paddingRight: 8,
                    textAlign: 'right',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: isStressed ? '#dc2626' : 'var(--text-muted)',
                    fontWeight: isStressed ? 600 : 400,
                    whiteSpace: 'nowrap',
                  }}>
                    {src}
                  </td>
                  {dsts.map(dst => {
                    const key  = `${src}→${dst}`
                    const snap = snapMap[key] as any
                    const selected = selectedKey === key

                    if (!snap) {
                      return (
                        <td key={dst}>
                          <div style={{ width: CELL, height: CELL, background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 3 }}/>
                        </td>
                      )
                    }

                    const status = latencyStatus(snap.p99_us)
                    const color  = STATUS_COLOR[status]

                    return (
                      <td key={dst}>
                        <div
                          title={`${src} → ${dst}\nP99 ${fmtUs(snap.p99_us)} · ${snap.is_spike ? 'SPIKE' : status}`}
                          onClick={() => onSelect(key)}
                          style={{
                            width: CELL, height: CELL,
                            background: color,
                            borderRadius: 3,
                            cursor: 'pointer',
                            position: 'relative',
                            border: selected ? '2px solid #0f172a' : snap.is_spike ? '2px solid #dc2626' : '1px solid transparent',
                            boxShadow: selected ? '0 0 0 2px #2563eb55' : undefined,
                            animation: snap.is_spike ? 'matrixPulse 1.2s infinite' : undefined,
                          }}
                        >
                          {/* 스파이크 dot */}
                          {snap.is_spike && (
                            <div style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: '50%', background: '#ffffff' }}/>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
