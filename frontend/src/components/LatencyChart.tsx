import { useRef, useEffect, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { HistoryPoint } from '../types'
import { fmtUs } from '../utils/format'

interface Props {
  history: HistoryPoint[]
  isSpike?: boolean
}

function toUPlotData(pts: HistoryPoint[]): uPlot.AlignedData {
  return [
    pts.map(p => p.time / 1000),
    pts.map(p => p.avg_us),
    pts.map(p => p.p50_us),
    pts.map(p => p.p95_us),
    pts.map(p => p.p99_us),
  ]
}

function calcSpikeBands(pts: HistoryPoint[], isSpike: boolean) {
  const bands: { from: number; to: number }[] = []
  let start: number | null = null
  pts.forEach((p, i) => {
    const flagged = !!(p as HistoryPoint & { is_spike?: boolean }).is_spike
    if (flagged) {
      if (start === null) start = p.time / 1000
      if (i === pts.length - 1) bands.push({ from: start, to: p.time / 1000 })
    } else if (start !== null) {
      bands.push({ from: start, to: pts[i - 1].time / 1000 })
      start = null
    }
  })
  if (isSpike && bands.length === 0 && pts.length > 1) {
    const cutIdx = Math.max(0, pts.length - Math.ceil(pts.length * 0.18))
    bands.push({ from: pts[cutIdx].time / 1000, to: pts[pts.length - 1].time / 1000 })
  }
  return bands
}

const SERIES = [
  { label: 'AVG', stroke: '#2563eb', width: 1.2, dash: [4, 3] as number[] },
  { label: 'P50', stroke: '#16a34a', width: 1.8 },
  { label: 'P95', stroke: '#d97706', width: 1.8 },
  { label: 'P99', stroke: '#ea580c', width: 2.4 },
]

// 휠 줌 + 드래그 pan 플러그인.
// 경계(데이터 최소/최대)는 매번 data에서 다시 읽어, range 전환(1h/6h/…)으로
// 데이터가 통째로 바뀌어도 어긋나지 않게 한다.
export interface PanZoomState {
  // 사용자가 줌/팬 중이면 true → 새 데이터가 와도 스케일을 유지한다.
  // 완전히 줌아웃(전체 범위 복귀)하면 false로 돌아가 Live 추적을 재개한다.
  userZoomed: boolean
}

function panZoomPlugin(state: PanZoomState): uPlot.Plugin {
  function clamp(val: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, val))
  }

  // 현재 데이터의 x 범위(경계). ready 시점 고정이 아니라 호출마다 최신 data 기준.
  function dataBounds(u: uPlot): { min: number; max: number } {
    const xs = u.data[0]
    if (!xs || xs.length === 0) return { min: 0, max: 1 }
    const min = xs[0] as number
    const max = xs[xs.length - 1] as number
    return max > min ? { min, max } : { min, max: min + 1 }
  }

  // 현재 x 범위가 데이터 전체 범위와 거의 같으면 "줌 안 됨"으로 본다.
  function isFullRange(u: uPlot): boolean {
    const b = dataBounds(u)
    const full = b.max - b.min
    const cur = u.scales.x.max! - u.scales.x.min!
    return cur >= full - full * 0.001
  }

  return {
    hooks: {
      ready: (u) => {
        const over = u.over
        over.style.cursor = 'grab'

        // 휠 줌 — 마우스 위치 기준
        over.addEventListener('wheel', (e: WheelEvent) => {
          e.preventDefault()
          const b = dataBounds(u)
          const fullRange = b.max - b.min
          const { left, width } = over.getBoundingClientRect()
          const mouseRatio = (e.clientX - left) / width
          const factor = e.deltaY > 0 ? 1.25 : 0.8
          const curXMin = u.scales.x.min!
          const curXMax = u.scales.x.max!
          const curRange = curXMax - curXMin
          // 최소 폭은 전체의 1%, 최대는 전체(데이터 밖으로는 못 나감)
          const newRange = clamp(curRange * factor, fullRange * 0.01, fullRange)
          const anchor   = curXMin + mouseRatio * curRange
          const newXMin  = clamp(anchor - mouseRatio * newRange, b.min, b.max - newRange)
          u.setScale('x', { min: newXMin, max: newXMin + newRange })
        }, { passive: false })

        // 드래그 pan
        let dragStartX = 0
        let dragStartXMin = 0
        let dragStartXMax = 0
        let dragging = false

        over.addEventListener('mousedown', (e: MouseEvent) => {
          if (e.button !== 0) return
          dragging = true
          dragStartX    = e.clientX
          dragStartXMin = u.scales.x.min!
          dragStartXMax = u.scales.x.max!
          over.style.cursor = 'grabbing'
        })

        window.addEventListener('mousemove', (e: MouseEvent) => {
          if (!dragging) return
          const b = dataBounds(u)
          const { width } = over.getBoundingClientRect()
          const dx = e.clientX - dragStartX
          const range = dragStartXMax - dragStartXMin
          const shift = -(dx / width) * range
          const newXMin = clamp(dragStartXMin + shift, b.min, b.max - range)
          u.setScale('x', { min: newXMin, max: newXMin + range })
        })

        window.addEventListener('mouseup', () => {
          if (!dragging) return
          dragging = false
          over.style.cursor = 'grab'
        })
      },
      // 스케일이 바뀔 때마다 "지금 줌 상태인가"를 갱신한다.
      // 전체 범위면 userZoomed=false(Live 추적 재개), 아니면 true(스케일 유지).
      setScale: (u, key) => {
        if (key !== 'x') return
        state.userZoomed = !isFullRange(u)
      },
    },
  }
}

function makeOpts(
  width: number,
  height: number,
  spikeBands: { from: number; to: number }[],
  panZoom: PanZoomState,
): uPlot.Options {
  return {
    width,
    height,
    padding: [10, 14, 0, 56],
    cursor: {
      drag: { x: false, y: false },
      focus: { prox: 30 },
    },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    legend: { show: false },
    scales: {
      x: { time: true },
      y: { range: (_u, min, max) => [Math.max(0, min * 0.85), max * 1.15] },
    },
    axes: [
      {
        stroke: '#94a3b8',
        ticks: { stroke: '#e2e8f0', width: 1 },
        grid:  { stroke: '#f1f5f9', width: 1 },
        font:  '9px JetBrains Mono, monospace',
        size:  28,
        // 시간 + 날짜(M/d) 2줄 — 7일 범위에서 날짜 구분 필요
        values: (_u, splits) => splits.map(s => {
          if (s == null) return ''
          const d = new Date(s * 1000)
          const hhmm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
          const md   = `${d.getMonth() + 1}/${d.getDate()}`
          return hhmm + '\n' + md
        }),
      },
      {
        stroke: '#94a3b8',
        ticks: { stroke: '#e2e8f0', width: 1 },
        grid:  { stroke: '#f1f5f9', width: 1 },
        font:  '9px JetBrains Mono, monospace',
        size:  52,
        values: (_u, vals) => vals.map(v => v == null ? '' : fmtUs(v)),
      },
    ],
    series: [
      {},
      ...SERIES.map(s => ({ label: s.label, stroke: s.stroke, width: s.width, dash: s.dash })),
    ],
    plugins: [panZoomPlugin(panZoom)],
    hooks: {
      drawAxes: [(u) => {
        if (spikeBands.length === 0) return
        const ctx = u.ctx
        const { top, height: ph } = u.bbox
        ctx.save()
        ctx.fillStyle = 'rgba(220,38,38,0.07)'
        spikeBands.forEach(({ from, to }) => {
          const x0 = Math.round(u.valToPos(from, 'x', true))
          const x1 = Math.round(u.valToPos(to,   'x', true))
          ctx.fillRect(x0, top, Math.max(2, x1 - x0), ph)
        })
        ctx.restore()
      }],
    },
  }
}

// Datadog 스타일 툴팁
function Tooltip({ u, pts }: { u: uPlot | null; pts: HistoryPoint[] }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [idx, setIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!u) return
    const over = u.over
    const onMove = () => {
      const ci = u.cursor.idx
      if (ci == null || ci < 0 || ci >= pts.length) { setPos(null); setIdx(null); return }
      const rect = over.getBoundingClientRect()
      setPos({ x: rect.left + (u.cursor.left ?? 0), y: rect.top + u.bbox.top / window.devicePixelRatio })
      setIdx(ci)
    }
    const onLeave = () => { setPos(null); setIdx(null) }
    over.addEventListener('mousemove', onMove)
    over.addEventListener('mouseleave', onLeave)
    return () => { over.removeEventListener('mousemove', onMove); over.removeEventListener('mouseleave', onLeave) }
  }, [u, pts])

  if (!pos || idx === null || !pts[idx]) return null
  const p = pts[idx]
  const time = new Date(p.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

  return (
    <div style={{
      position: 'fixed', left: pos.x + 12, top: pos.y,
      background: 'rgba(15,23,42,0.92)', border: '1px solid #334155',
      borderRadius: 6, padding: '7px 10px', fontSize: 11,
      fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0',
      pointerEvents: 'none', zIndex: 9999, minWidth: 120,
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    }}>
      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 5 }}>{time}</div>
      {SERIES.map((s, i) => {
        const val = [p.avg_us, p.p50_us, p.p95_us, p.p99_us][i]
        return (
          <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
            <span style={{ color: s.stroke }}>{s.label}</span>
            <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{fmtUs(val)}</span>
          </div>
        )
      })}
    </div>
  )
}

// height prop 없이 부모 컨테이너 크기를 그대로 채움
function LatencyCanvas({ history, isSpike }: Props) {
  const wrapRef      = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef      = useRef<uPlot | null>(null)
  // 줌 상태를 ref로 들고 다닌다(플러그인이 setScale에서 갱신, setData가 참조).
  const panZoomRef   = useRef<PanZoomState>({ userZoomed: false })
  const [uInst, setUInst] = useState<uPlot | null>(null)

  const rebuild = (w: number, h: number) => {
    const el = containerRef.current
    if (!el) return
    plotRef.current?.destroy()
    panZoomRef.current = { userZoomed: false }  // 재생성 시 줌 초기화
    const bands = calcSpikeBands(history, !!isSpike)
    const u = new uPlot(makeOpts(w, h, bands, panZoomRef.current), toUPlotData(history), el)
    plotRef.current = u
    setUInst(u)
  }

  // 마운트 + isSpike 변경 시 재생성
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    rebuild(wrap.clientWidth || 400, wrap.clientHeight || 140)
    return () => { plotRef.current?.destroy(); plotRef.current = null; setUInst(null) }
  }, [isSpike])  // eslint-disable-line react-hooks/exhaustive-deps

  // 새 데이터 반영. 사용자가 줌/팬 중이면(userZoomed) uPlot의 자동 x 리셋을
  // 되돌려 현재 구간을 유지한다. 안 건드렸으면 그대로 최신 데이터를 추적(Live).
  useEffect(() => {
    const u = plotRef.current
    if (!u) return
    if (panZoomRef.current.userZoomed) {
      const xMin = u.scales.x.min!
      const xMax = u.scales.x.max!
      u.setData(toUPlotData(history), false)  // false = 스케일 자동 리셋 억제
      u.setScale('x', { min: xMin, max: xMax })
    } else {
      u.setData(toUPlotData(history))
    }
  }, [history])

  // 부모 크기 변화 감지 → setSize
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (plotRef.current && w > 0 && h > 0) {
        plotRef.current.setSize({ width: w, height: h })
      }
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} className="uplot-fill" />
      <Tooltip u={uInst} pts={history} />
    </div>
  )
}

export default function LatencyChart({ history, isSpike }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <LatencyCanvas history={history} isSpike={isSpike} />
        <button
          onClick={() => setModalOpen(true)}
          title="크게 보기"
          style={{
            position: 'absolute', top: 6, right: 6,
            background: 'rgba(255,255,255,0.85)', border: '1px solid #e2e8f0',
            borderRadius: 4, width: 22, height: 22, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: '#64748b', padding: 0,
          }}
        >⤢</button>
      </div>

      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 10, width: '80vw', height: '60vh', padding: '36px 24px 24px', position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
          >
            <span style={{ position: 'absolute', top: 10, left: 16, fontSize: 12, fontWeight: 600, color: '#374151' }}>Latency</span>
            <div style={{ position: 'absolute', top: 12, right: 44, display: 'flex', gap: 10, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: '#64748b' }}>
              {SERIES.map(({ stroke, label }) => (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 16, height: 2, background: stroke, display: 'inline-block' }} />
                  {label}
                </span>
              ))}
            </div>
            <button onClick={() => setModalOpen(false)} style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            <div style={{ width: '100%', height: '100%' }}>
              <LatencyCanvas history={history} isSpike={isSpike} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
