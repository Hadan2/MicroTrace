import { useState, useEffect, useCallback } from 'react'
import type { StatSnapshot, ServiceSnapshot, HistoryPoint } from '../types'
import { fmtUs, latencyStatus, STATUS_COLOR } from '../utils/format'
import { CAUSE_META } from '../constants/causes'
import LatencyChart  from './LatencyChart'
import ResourceChart from './ResourceChart'

type RangeKey = '1h' | '6h' | '24h' | '7d'

const RANGE_LABELS: { key: RangeKey; label: string }[] = [
  { key: '1h',  label: '1h'  },
  { key: '6h',  label: '6h'  },
  { key: '24h', label: '24h' },
  { key: '7d',  label: '7d'  },
]

const COLLECTOR_BASE = `http://${window.location.hostname}:9090`

interface Props {
  snap: StatSnapshot | null
  history: HistoryPoint[]
  selectedNode: string | null
  nodeService: ServiceSnapshot | null
  onClose: () => void
}

export default function DetailPanel({ snap, history, selectedNode, nodeService, onClose }: Props) {
  const [range, setRange] = useState<RangeKey | null>(null)  // null = Live
  const [dbHistory, setDbHistory] = useState<HistoryPoint[] | null>(null)

  const fetchHistory = useCallback(async (src: string, dst: string, r: RangeKey) => {
    try {
      const res = await fetch(`${COLLECTOR_BASE}/api/history?src=${encodeURIComponent(src)}&dst=${encodeURIComponent(dst)}&range=${r}`)
      const rows = await res.json()
      // API 응답을 HistoryPoint 형태로 변환
      setDbHistory(rows.map((row: {
        ts: number; p50_us: number; p95_us: number; p99_us: number;
        avg_us: number; jitter_us: number
      }) => ({
        time: row.ts,
        latest_srtt_us: row.p99_us,
        avg_us: row.avg_us,
        p50_us: row.p50_us,
        p95_us: row.p95_us,
        p99_us: row.p99_us,
        jitter_us: row.jitter_us,
      })))
    } catch (e) {
      console.error('[history api]', e)
    }
  }, [])

  // 연결이 바뀌면 range/dbHistory 초기화
  useEffect(() => {
    setRange(null)
    setDbHistory(null)
  }, [snap?.src_service, snap?.dst_service])

  const handleRange = (r: RangeKey) => {
    if (!snap) return
    setRange(r)
    fetchHistory(snap.src_service, snap.dst_service, r)
  }

  const handleLive = () => {
    setRange(null)
    setDbHistory(null)
  }

  // 보여줄 히스토리: range 선택 시 DB 데이터, 아니면 실시간
  const displayHistory = range !== null && dbHistory !== null ? dbHistory : history

  // 노드 선택 뷰
  if (selectedNode) {
    return <NodePanel name={selectedNode} svc={nodeService} onClose={onClose} />
  }

  if (!snap) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-faint)' }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" stroke="#e2e8f0" strokeWidth="2"/>
          <path d="M16 24 Q24 14 32 24 Q24 34 16 24Z" stroke="#cbd5e1" strokeWidth="1.5" fill="none"/>
          <circle cx="24" cy="24" r="3" fill="#e2e8f0"/>
        </svg>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>연결 또는 서비스를 선택하세요</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>엣지 클릭 → latency 분석 · 노드 클릭 → 서비스 리소스</div>
        </div>
      </div>
    )
  }

  const status    = latencyStatus(snap.p99_us)
  const causeMeta = snap.cause_kind ? CAUSE_META[snap.cause_kind] : null
  const closeTotal = (snap.close_states?.fin ?? 0) + (snap.close_states?.rst ?? 0) + (snap.close_states?.timeout ?? 0)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {/* ① Connection Header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
          Connection
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {snap.src_service}
            </span>
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
              <path d="M1 5H13M9 1L13 5L9 9" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {snap.dst_service}
            </span>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
        </div>
      </div>

      {/* ② CauseCandidate Banner */}
      {snap.is_spike && causeMeta && (
        <div style={{
          margin: '10px 14px 0',
          padding: '12px 14px',
          background: `linear-gradient(135deg, ${causeMeta.color}0d, ${causeMeta.color}05)`,
          border: `1px solid ${causeMeta.color}40`,
          borderLeft: `3px solid ${causeMeta.color}`,
          borderRadius: 8,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Root Cause Candidate
            </span>
            {snap.baseline_us && (
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: '#dc2626' }}>
                {(snap.p99_us / snap.baseline_us).toFixed(1)}× baseline
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: causeMeta.color, marginBottom: 4 }}>
            {causeMeta.icon} {causeMeta.label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>{causeMeta.desc}</div>
          {/* Evidence chips */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(snap.dst_cpu_pct ?? 0) > 50 && (
              <Chip color={causeMeta.color} label={`CPU: ${snap.dst_cpu_pct?.toFixed(0)}%`}/>
            )}
            {(snap.dst_io_wait_pct ?? 0) > 20 && (
              <Chip color={causeMeta.color} label={`IO wait: ${snap.dst_io_wait_pct?.toFixed(0)}%`}/>
            )}
            {(snap.dst_mem_pressure_pct ?? 0) > 50 && (
              <Chip color={causeMeta.color} label={`Mem: ${snap.dst_mem_pressure_pct?.toFixed(0)}%`}/>
            )}
            {snap.retransmit_count > 0 && (
              <Chip color={causeMeta.color} label={`Retrans: ${snap.retransmit_count}`}/>
            )}
          </div>
        </div>
      )}

      {/* ③ Percentile Cards */}
      <div style={{ padding: '12px 14px 8px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, flexShrink: 0 }}>
        {[
          { label: 'AVG', value: snap.avg_us, color: '#2563eb' },
          { label: 'P50', value: snap.p50_us, color: '#16a34a' },
          { label: 'P95', value: snap.p95_us, color: '#d97706' },
          { label: 'P99', value: snap.p99_us, color: STATUS_COLOR[status] },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 6px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-mono)', color }}>{fmtUs(value)}</div>
          </div>
        ))}
      </div>

      {/* ④ Secondary Metrics */}
      <div style={{ padding: '0 14px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, flexShrink: 0 }}>
        {[
          { label: 'Jitter',      value: fmtUs(snap.jitter_us),        color: 'var(--text-muted)' },
          { label: 'Retransmits', value: snap.retransmit_count,          color: snap.retransmit_count > 0 ? '#ea580c' : 'var(--text-muted)' },
          { label: 'Samples',     value: snap.sample_count,              color: 'var(--text-muted)' },
          { label: 'Threshold',   value: fmtUs(snap.spike_threshold_us), color: 'var(--text-muted)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px' }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ⑤ Close States Bar */}
      {closeTotal > 0 && snap.close_states && (
        <div style={{ padding: '0 14px 10px', flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
            Close states · {closeTotal} total
          </div>
          <div style={{ height: 8, borderRadius: 4, background: '#f1f5f9', display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: `${(snap.close_states.fin / closeTotal) * 100}%`, background: '#16a34a' }}/>
            <div style={{ width: `${(snap.close_states.rst / closeTotal) * 100}%`, background: '#dc2626' }}/>
            <div style={{ width: `${(snap.close_states.timeout / closeTotal) * 100}%`, background: '#ea580c' }}/>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {[
              { color: '#16a34a', label: 'FIN',     n: snap.close_states.fin },
              { color: '#dc2626', label: 'RST',     n: snap.close_states.rst },
              { color: '#ea580c', label: 'TIMEOUT', n: snap.close_states.timeout },
            ].map(({ color, label, n }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 7, height: 7, background: color, borderRadius: 1 }}/>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ⑥ Latency Chart */}
      <div style={{ padding: '0 14px 6px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChartHeader title="Latency" legend={[
            { color: '#2563eb', label: 'AVG', dash: true },
            { color: '#16a34a', label: 'P50' },
            { color: '#d97706', label: 'P95' },
            { color: '#ea580c', label: 'P99' },
          ]}/>
          {/* 시간 범위 버튼 */}
          <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
            <RangeBtn label="Live" active={range === null} onClick={handleLive} accent />
            {RANGE_LABELS.map(({ key, label }) => (
              <RangeBtn key={key} label={label} active={range === key} onClick={() => handleRange(key)} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ height: 140, padding: '0 14px 8px', flexShrink: 0 }}>
        <LatencyChart history={displayHistory} isSpike={snap.is_spike}/>
      </div>

    </div>
  )
}

function ChartHeader({ title, legend }: { title: string; legend: { color: string; label: string; dash?: boolean }[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        {title}
      </span>
      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
        {legend.map(({ color, label, dash }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke={color} strokeWidth="1.5" strokeDasharray={dash ? '4,2' : undefined}/></svg>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RangeBtn({ label, active, onClick, accent }: { label: string; active: boolean; onClick: () => void; accent?: boolean }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 9, padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontWeight: 600,
      border: `1px solid ${active ? (accent ? '#6366f1' : '#64748b') : 'var(--border)'}`,
      background: active ? (accent ? '#6366f1' : '#334155') : 'var(--bg-surface)',
      color: active ? '#fff' : 'var(--text-muted)',
    }}>
      {label}
    </button>
  )
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 500, padding: '2px 8px',
      background: '#ffffff', border: `1px solid ${color}40`, color,
      borderRadius: 10,
    }}>
      {label}
    </span>
  )
}

function NodePanel({ name, svc, onClose }: { name: string; svc: ServiceSnapshot | null; onClose: () => void }) {
  const metrics = [
    { label: 'CPU',         value: svc?.cpu_pct          ?? 0, color: '#dc2626', unit: '%' },
    { label: 'IO Wait',     value: svc?.io_wait_pct      ?? 0, color: '#7c3aed', unit: '%' },
    { label: 'Mem Pressure',value: svc?.mem_pressure_pct ?? 0, color: '#ea580c', unit: '%' },
    { label: 'CPU Throttle',value: svc?.cpu_throttle_pct ?? 0, color: '#f59e0b', unit: '%' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
          Service
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {name}
          </span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
        </div>
      </div>

      {/* 리소스 없을 때 */}
      {!svc ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
          리소스 데이터 수집 중…
        </div>
      ) : (
        <>
          {/* 지표 카드 4개 */}
          <div style={{ padding: '12px 14px 8px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, flexShrink: 0 }}>
            {metrics.map(({ label, value, color, unit }) => (
              <div key={label} style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)', color: value > 70 ? color : 'var(--text-primary)' }}>
                  {value.toFixed(2)}{unit}
                </div>
                {/* 미니 바 */}
                <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: '#f1f5f9', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, value)}%`, height: '100%', background: value > 70 ? color : '#94a3b8', borderRadius: 2, transition: 'width 0.3s' }}/>
                </div>
              </div>
            ))}
          </div>

          {/* Resource Chart */}
          <div style={{ padding: '4px 14px 6px', flexShrink: 0 }}>
            <ChartHeader title="Resource History" legend={[
              { color: '#dc2626', label: 'CPU' },
              { color: '#7c3aed', label: 'IO wait' },
              { color: '#ea580c', label: 'Mem' },
            ]}/>
          </div>
          <div style={{ height: 160, padding: '0 14px 12px', flexShrink: 0 }}>
            <ResourceChart history={svc.history} dstName={name}/>
          </div>
        </>
      )}
    </div>
  )
}
