import StatCard from './StatCard'
import type { SnapshotMap } from '../hooks/useWebSocket'
import type { ServiceMap } from '../hooks/useMockData'
import { fmtUs, latencyStatus, STATUS_COLOR } from '../utils/format'

interface Props {
  snapshots: SnapshotMap
  services: ServiceMap
}

export default function GlobalMetrics({ snapshots, services }: Props) {
  const snaps = Object.values(snapshots)

  const gp95 = snaps.length > 0
    ? snaps.reduce((s, v) => s + v.p95_us, 0) / snaps.length : 0
  const gp99 = snaps.length > 0
    ? snaps.reduce((s, v) => s + v.p99_us, 0) / snaps.length : 0

  const spikeCount    = snaps.filter(s => s.is_spike).length
  const retransmits   = snaps.reduce((s, v) => s + v.retransmit_count, 0)

  const svcList = Object.values(services)
  const stressedCount = svcList.filter(s => s.stress_kind !== null).length
  const cpuCount  = svcList.filter(s => s.stress_kind === 'cpu').length
  const ioCount   = svcList.filter(s => s.stress_kind === 'io').length
  const memCount  = svcList.filter(s => s.stress_kind === 'memory').length

  const serviceNames = new Set<string>()
  snaps.forEach(s => { serviceNames.add(s.src_service); serviceNames.add(s.dst_service) })

  const gp99Status = latencyStatus(gp99)

  return (
    <div style={{
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      padding: '10px 14px',
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      flexShrink: 0,
    }}>
      <StatCard
        label="Global P95"
        value={fmtUs(gp95)}
        color="#d97706"
      />
      <StatCard
        label="Global P99"
        value={fmtUs(gp99)}
        color={STATUS_COLOR[gp99Status]}
        highlight={gp99 > 20_000}
      />
      <StatCard
        label="Active Spikes"
        value={spikeCount}
        color={spikeCount > 0 ? '#dc2626' : 'var(--text-faint)'}
        sub={spikeCount > 0 ? 'analyzing causes…' : 'all normal'}
        highlight={spikeCount > 0}
      />
      {svcList.length > 0 && (
        <StatCard
          label="Stressed Svcs"
          value={stressedCount}
          color={stressedCount > 0 ? '#ea580c' : 'var(--text-faint)'}
          sub={stressedCount > 0 ? `CPU:${cpuCount} IO:${ioCount} MEM:${memCount}` : undefined}
          highlight={stressedCount > 0}
        />
      )}
      <StatCard
        label="Retransmits"
        value={retransmits}
        color={retransmits > 20 ? '#ea580c' : 'var(--text-secondary)'}
        sub="cumulative"
      />
      <StatCard
        label="Connections"
        value={snaps.length}
        color="#2563eb"
        sub={`${serviceNames.size} svcs`}
      />
    </div>
  )
}
