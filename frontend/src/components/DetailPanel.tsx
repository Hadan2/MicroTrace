import type { StatSnapshot } from '../types'

interface Props {
  snap: StatSnapshot | null
}

function formatLatency(us: number): string {
  if (us >= 1000) return `${(us / 1000).toFixed(2)}ms`
  return `${us}µs`
}

export default function DetailPanel({ snap }: Props) {
  if (!snap) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
        엣지를 클릭하면 상세 정보가 표시됩니다
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      {/* 헤더 */}
      <div>
        <p className="text-xs text-slate-400 mb-1">연결</p>
        <p className="text-sm font-semibold text-slate-800">
          {snap.src_service}
          <span className="text-slate-400 mx-2">→</span>
          {snap.dst_service}
        </p>
      </div>

      {/* Spike 경고 */}
      {snap.is_spike && (
        <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-red-600 text-xs font-medium">
          ⚠ Latency Spike 감지 — 임계값: {formatLatency(snap.spike_threshold_us)}
        </div>
      )}

      {/* 레이턴시 */}
      <div>
        <p className="text-xs text-slate-400 mb-2">레이턴시</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'P50', value: snap.p50_us },
            { label: 'P95', value: snap.p95_us },
            { label: 'P99', value: snap.p99_us },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-base font-bold text-slate-800 mt-1">
                {formatLatency(value)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 재전송 + 샘플 수 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p className="text-xs text-slate-400">재전송</p>
          <p className={`text-base font-bold mt-1 ${snap.retransmit_count > 0 ? 'text-orange-500' : 'text-slate-800'}`}>
            {snap.retransmit_count}
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p className="text-xs text-slate-400">샘플 수</p>
          <p className="text-base font-bold text-slate-800 mt-1">{snap.sample_count}</p>
        </div>
      </div>
    </div>
  )
}
