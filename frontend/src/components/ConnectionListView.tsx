import { useState, useMemo } from 'react'
import type { SnapshotMap } from '../hooks/useWebSocket'
import type { StatSnapshot } from '../types'
import { fmtUs, latencyStatus, STATUS_COLOR, STATUS_BG } from '../utils/format'
import { CAUSE_META } from '../constants/causes'

interface Props {
  snapshots: SnapshotMap
  selectedKey: string | null
  onSelect: (key: string | null) => void
}

type FilterMode = 'all' | 'spiking' | 'stressed'
type SortCol = 'connection' | 'p50' | 'p95' | 'p99' | 'retrans'
type SortDir = 'asc' | 'desc'


export default function ConnectionListView({ snapshots, selectedKey, onSelect }: Props) {
  const [filter, setFilter]   = useState<FilterMode>('all')
  const [sortCol, setSortCol] = useState<SortCol>('p99')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const snaps = Object.values(snapshots)
  const spikingCount  = snaps.filter(s => s.is_spike).length
  const stressedCount = snaps.filter(s => s.dst_cpu_pct !== undefined && (
    (s.dst_cpu_pct ?? 0) > 70 || (s.dst_io_wait_pct ?? 0) > 30 || (s.dst_mem_pressure_pct ?? 0) > 70
  )).length

  const filtered = useMemo(() => {
    let list = snaps
    if (filter === 'spiking')  list = list.filter(s => s.is_spike)
    if (filter === 'stressed') list = list.filter(s =>
      (s.dst_cpu_pct ?? 0) > 70 || (s.dst_io_wait_pct ?? 0) > 30 || (s.dst_mem_pressure_pct ?? 0) > 70
    )
    return list.slice().sort((a, b) => {
      let av = 0, bv = 0
      if (sortCol === 'p50')    { av = a.p50_us;           bv = b.p50_us }
      if (sortCol === 'p95')    { av = a.p95_us;           bv = b.p95_us }
      if (sortCol === 'p99')    { av = a.p99_us;           bv = b.p99_us }
      if (sortCol === 'retrans'){ av = a.retransmit_count; bv = b.retransmit_count }
      if (sortCol === 'connection') {
        const ak = `${a.src_service}→${a.dst_service}`
        const bk = `${b.src_service}→${b.dst_service}`
        return sortDir === 'asc' ? ak.localeCompare(bk) : bk.localeCompare(ak)
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [snaps, filter, sortCol, sortDir])

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const thStyle = (col: SortCol): React.CSSProperties => ({
    padding: '7px 10px',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: 'var(--font-ui)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    textAlign: col === 'connection' ? 'left' : 'right',
  })

  const sortIcon = (col: SortCol) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter chips */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {([
          ['all',      `All · ${snaps.length}`],
          ['spiking',  `🔴 Spiking · ${spikingCount}`],
          ['stressed', `⚡ Stressed · ${stressedCount}`],
        ] as [FilterMode, string][]).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setFilter(mode)}
            style={{
              padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600,
              cursor: 'pointer', border: '1px solid',
              borderColor: filter === mode ? '#2563eb' : 'var(--border)',
              background:  filter === mode ? '#eff6ff'  : 'var(--bg-surface)',
              color:       filter === mode ? '#2563eb'  : 'var(--text-secondary)',
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>click column header to sort</span>
      </div>

      {/* 테이블 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col/>{/* Connection — auto */}
            <col style={{ width: 72 }}/>
            <col style={{ width: 72 }}/>
            <col style={{ width: 82 }}/>
            <col style={{ width: 62 }}/>
            <col style={{ width: 90 }}/>
          </colgroup>
          <thead style={{ background: 'var(--bg-subtle)', position: 'sticky', top: 0, zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...thStyle('connection'), textAlign: 'left' }} onClick={() => handleSort('connection')}>
                Connection{sortIcon('connection')}
              </th>
              <th style={thStyle('p50')} onClick={() => handleSort('p50')}>P50{sortIcon('p50')}</th>
              <th style={thStyle('p95')} onClick={() => handleSort('p95')}>P95{sortIcon('p95')}</th>
              <th style={thStyle('p99')} onClick={() => handleSort('p99')}>P99{sortIcon('p99')}</th>
              <th style={thStyle('retrans')} onClick={() => handleSort('retrans')}>Retrans{sortIcon('retrans')}</th>
              <th style={{ ...thStyle('connection'), textAlign: 'center', cursor: 'default' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(snap => {
              const key      = `${snap.src_service}→${snap.dst_service}`
              const selected = key === selectedKey
              const status   = latencyStatus(snap.p99_us)
              const isExt    = snap.dst_type === 'external'

              return (
                <tr
                  key={key}
                  onClick={() => onSelect(key)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border-soft)',
                    background: selected ? '#eff6ff' : undefined,
                    borderLeft: selected ? '3px solid #2563eb' : '3px solid transparent',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-subtle)' }}
                  onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  {/* Connection */}
                  <td style={{ padding: '7px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {snap.is_spike && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#dc2626', boxShadow: '0 0 4px #dc262688', display: 'inline-block', flexShrink: 0 }}/>}
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {snap.src_service} → {snap.dst_service}
                      </span>
                      {isExt && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', background: '#f1f5f9', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', borderRadius: 4 }}>EXT</span>}
                    </div>
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{fmtUs(snap.p50_us)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{fmtUs(snap.p95_us)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: STATUS_COLOR[status] }}>{fmtUs(snap.p99_us)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: snap.retransmit_count > 0 ? '#ea580c' : 'var(--text-faint)' }}>{snap.retransmit_count}</td>
                  {/* Status */}
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                    {snap.is_spike && snap.cause_kind ? (
                      <CausePill cause={snap.cause_kind}/>
                    ) : (
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: STATUS_BG[status], color: STATUS_COLOR[status],
                      }}>
                        {status}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CausePill({ cause }: { cause: StatSnapshot['cause_kind'] }) {
  if (!cause) return null
  const meta = CAUSE_META[cause]
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${meta.color}14`, border: `1px solid ${meta.color}40`, color: meta.color,
    }}>
      {meta.icon} {meta.label}
    </span>
  )
}
