import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { HistoryPoint } from '../hooks/useWebSocket'
import type { StatSnapshot } from '../types'

interface Props {
  historyKey: string | null
  history: HistoryPoint[]
  snap: StatSnapshot | null
}

function formatUs(us: number): string {
  if (us >= 1000) return `${(us / 1000).toFixed(1)}ms`
  return `${us}µs`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

export default function LatencyChart({ historyKey, history, snap }: Props) {
  if (!historyKey || history.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        토폴로지에서 엣지를 클릭하면 그래프가 표시됩니다
      </div>
    )
  }

  const spikeThreshold = snap?.spike_threshold_us

  return (
    <div className="h-full flex flex-col px-5 py-4 gap-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-100 font-semibold text-sm">{historyKey}</span>
          {snap?.is_spike && (
            <span className="text-xs bg-red-900/50 border border-red-500/50 text-red-400 px-2 py-0.5 rounded-full">
              ⚠ SPIKE
            </span>
          )}
        </div>
        {/* 현재값 뱃지 */}
        <div className="flex gap-3 text-xs">
          {[
            { label: 'P50', value: snap?.p50_us, color: '#22c55e' },
            { label: 'P95', value: snap?.p95_us, color: '#eab308' },
            { label: 'P99', value: snap?.p99_us, color: snap?.is_spike ? '#ef4444' : '#f97316' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex flex-col items-center">
              <span style={{ color }} className="font-bold text-base">
                {value != null ? formatUs(value) : '—'}
              </span>
              <span className="text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 그래프 */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={formatUs}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              contentStyle={{ background: '#1e2130', border: '1px solid #334155', borderRadius: 6 }}
              labelStyle={{ color: '#94a3b8', fontSize: 11 }}
              labelFormatter={(v) => formatTime(v as number)}
              formatter={(value: number) => [formatUs(value), '']}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#64748b' }}
            />
            {spikeThreshold && (
              <ReferenceLine
                y={spikeThreshold}
                stroke="#ef4444"
                strokeDasharray="4 3"
                label={{ value: 'spike', fill: '#ef4444', fontSize: 10, position: 'insideTopRight' }}
              />
            )}
            <Line type="monotone" dataKey="p50" name="P50" stroke="#22c55e" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="p95" name="P95" stroke="#eab308" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="p99" name="P99" stroke="#f97316" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
