import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, LineSeries, AreaSeries, type IChartApi, type ISeriesApi, type LineData, type AreaData, type UTCTimestamp, ColorType } from 'lightweight-charts'
import type { HistoryPoint } from '../hooks/useWebSocket'
import type { StatSnapshot } from '../types'

interface Props {
  historyKey: string | null
  history: HistoryPoint[]
  snap: StatSnapshot | null
}

function formatUs(us: number): string {
  if (us >= 1000) return `${(us / 1000).toFixed(1)}ms`
  return `${Math.round(us)}µs`
}

export default function LatencyChart({ historyKey, history, snap }: Props) {
  const containerRef      = useRef<HTMLDivElement>(null)
  const chartRef          = useRef<IChartApi | null>(null)
  const avgRef            = useRef<ISeriesApi<'Line'> | null>(null)
  const p50Ref            = useRef<ISeriesApi<'Line'> | null>(null)
  const p95Ref            = useRef<ISeriesApi<'Line'> | null>(null)
  const p99Ref            = useRef<ISeriesApi<'Line'> | null>(null)
  const jitterUpperRef    = useRef<ISeriesApi<'Area'> | null>(null)
  const jitterLowerRef    = useRef<ISeriesApi<'Area'> | null>(null)
  const isLiveRef         = useRef(true)
  const [isLive, setIsLive] = useState(true)

  const goLive = useCallback(() => {
    isLiveRef.current = true
    setIsLive(true)
    // 최신 데이터로 스크롤
    chartRef.current?.timeScale().scrollToRealTime()
  }, [])

  // 차트 생성 — historyKey 바뀔 때만
  useEffect(() => {
    if (!containerRef.current || !historyKey) return

    chartRef.current?.remove()
    chartRef.current = null
    isLiveRef.current = true
    setIsLive(true)

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#94a3b8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: '#e2e8f0',
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        borderColor: '#e2e8f0',
      },
      localization: {
        priceFormatter: (v: number) => formatUs(v),
        timeFormatter: (ts: number) => {
          const d = new Date(ts * 1000)
          const month = (d.getMonth() + 1).toString().padStart(2, '0')
          const day   = d.getDate().toString().padStart(2, '0')
          const hh    = d.getHours().toString().padStart(2, '0')
          const mm    = d.getMinutes().toString().padStart(2, '0')
          const ss    = d.getSeconds().toString().padStart(2, '0')
          return `${month}/${day} ${hh}:${mm}:${ss}`
        },
      },
      crosshair: {
        mode: 1,
      },
      handleScale: true,
      handleScroll: true,
      watermark: { visible: false },
    })

    // 사용자가 스크롤/줌하면 Live 모드 해제
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      if (isLiveRef.current) {
        // scrollToRealTime 호출로 인한 이벤트는 무시
        return
      }
    })

    chart.subscribeClick(() => {
      // 클릭은 무시
    })

    // 드래그 시작 감지 — Live 해제
    containerRef.current.addEventListener('mousedown', () => {
      if (isLiveRef.current) {
        isLiveRef.current = false
        setIsLive(false)
      }
    })

    // jitter 밴드: P50 ± jitter 범위를 반투명 영역으로 표시
    // lower를 먼저 추가해서 다른 라인들 뒤에 깔리도록 함
    const bandOpts = { lastValueVisible: false, priceLineVisible: false, lineWidth: 0 as const, lineColor: 'transparent' }
    jitterLowerRef.current = chart.addSeries(AreaSeries, {
      ...bandOpts,
      title: '',
      topColor: 'rgba(99,102,241,0.12)',
      bottomColor: 'rgba(99,102,241,0.0)',
    })
    jitterUpperRef.current = chart.addSeries(AreaSeries, {
      ...bandOpts,
      title: 'Jitter',
      topColor: 'rgba(99,102,241,0.12)',
      bottomColor: 'rgba(99,102,241,0.12)',
    })

    const seriesOpts = { lineWidth: 2, lastValueVisible: false, priceLineVisible: false }
    avgRef.current = chart.addSeries(LineSeries, { ...seriesOpts, color: '#94a3b8', title: 'AVG', lineStyle: 1 })
    p50Ref.current = chart.addSeries(LineSeries, { ...seriesOpts, color: '#22c55e', title: 'P50' })
    p95Ref.current = chart.addSeries(LineSeries, { ...seriesOpts, color: '#eab308', title: 'P95' })
    p99Ref.current = chart.addSeries(LineSeries, { ...seriesOpts, color: '#f97316', title: 'P99' })

    chartRef.current = chart

    // 리사이즈
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [historyKey])

  // 데이터 업데이트 — history 바뀔 때마다
  useEffect(() => {
    if (!chartRef.current || !avgRef.current || !p50Ref.current || !p95Ref.current || !p99Ref.current) return
    if (!jitterUpperRef.current || !jitterLowerRef.current) return
    if (history.length === 0) return

    // Lightweight Charts는 time을 UTC로 해석하므로 로컬 offset을 더해서 보정
    const tzOffsetSec = -new Date().getTimezoneOffset() * 60

    // 초 단위로 변환 후 중복 time 제거 (마지막 값 우선)
    const deduped = new Map<number, HistoryPoint>()
    for (const h of history) {
      deduped.set(Math.floor(h.time / 1000) + tzOffsetSec, h)
    }
    const sorted = [...deduped.entries()]
      .sort((a, b) => a[0] - b[0])

    const toLineData = (fn: (h: HistoryPoint) => number): LineData[] =>
      sorted.map(([sec, h]) => ({
        time: sec as UTCTimestamp,
        value: fn(h),
      }))

    // jitter 밴드: P50 ± jitter. 음수 방지를 위해 lower는 0 이상으로 클램프
    const toAreaData = (fn: (h: HistoryPoint) => number): AreaData[] =>
      sorted.map(([sec, h]) => ({
        time: sec as UTCTimestamp,
        value: fn(h),
      }))

    avgRef.current.setData(toLineData(h => h.avg_us))
    p50Ref.current.setData(toLineData(h => h.p50_us))
    p95Ref.current.setData(toLineData(h => h.p95_us))
    p99Ref.current.setData(toLineData(h => h.p99_us))
    jitterUpperRef.current.setData(toAreaData(h => h.p50_us + h.jitter_us))
    jitterLowerRef.current.setData(toAreaData(h => Math.max(0, h.p50_us - h.jitter_us)))

    // Live 모드면 항상 최신으로 스크롤
    if (isLiveRef.current) {
      chartRef.current.timeScale().scrollToRealTime()
    }
  }, [history])

  if (!historyKey) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
        토폴로지에서 엣지를 클릭하면 그래프가 표시됩니다
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col px-5 py-3 gap-2">
      {/* 헤더 */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-800 font-semibold text-sm">{historyKey}</span>
          {snap?.is_spike && (
            <span className="text-xs bg-red-50 border border-red-300 text-red-600 px-2 py-0.5 rounded-full">
              ⚠ SPIKE
            </span>
          )}
          {isLive ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
              LIVE
            </span>
          ) : (
            <button
              onClick={goLive}
              className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-600 px-2 py-0.5 rounded-full"
            >
              ▶ Live 복귀
            </button>
          )}
        </div>
        {/* 현재값 뱃지 */}
        <div className="flex gap-3 text-xs">
          {[
            { label: 'AVG', value: snap?.avg_us, color: '#94a3b8' },
            { label: 'P50', value: snap?.p50_us, color: '#22c55e' },
            { label: 'P95', value: snap?.p95_us, color: '#eab308' },
            { label: 'P99', value: snap?.p99_us, color: snap?.is_spike ? '#ef4444' : '#f97316' },
            {
              label: 'Jitter',
              value: snap?.jitter_us,
              // 0~1ms: 회색(안정) / 1~5ms: 노랑(주의) / 5ms 이상: 빨강(불안정)
              color: snap == null ? '#94a3b8'
                : snap.jitter_us >= 5000 ? '#ef4444'
                : snap.jitter_us >= 1000 ? '#eab308'
                : '#94a3b8',
            },
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

      {/* 차트 영역 */}
      <div ref={containerRef} className="flex-1 min-h-0 w-full" />
    </div>
  )
}
