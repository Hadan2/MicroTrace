import { useRef, useEffect, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { ResourcePoint } from '../types'
import { panZoomPlugin, applyData, timeAxisValues, axisBase, type PanZoomState } from './chartShared'

interface Props {
  history: ResourcePoint[]
}

// 리소스 3지표 — 모두 0~100% 스케일. LatencyChart와 같은 룩앤필(uPlot).
const SERIES = [
  { label: 'CPU',          stroke: '#dc2626', width: 2, get: (p: ResourcePoint) => p.cpu_pct },
  { label: 'IO wait',      stroke: '#7c3aed', width: 2, get: (p: ResourcePoint) => p.io_wait_pct },
  { label: 'Mem pressure', stroke: '#ea580c', width: 2, get: (p: ResourcePoint) => p.mem_pressure_pct },
]

const DANGER_PCT = 70  // 위험 가이드라인

function toUPlotData(pts: ResourcePoint[]): uPlot.AlignedData {
  return [
    pts.map(p => p.time / 1000),
    ...SERIES.map(s => pts.map(s.get)),
  ]
}

function makeOpts(width: number, height: number, panZoom: PanZoomState): uPlot.Options {
  return {
    width,
    height,
    padding: [10, 14, 0, 56],
    cursor: { drag: { x: false, y: false }, focus: { prox: 30 } },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    legend: { show: false },
    scales: {
      x: { time: true },
      y: { range: () => [0, 100] },  // 리소스는 0~100% 고정
    },
    axes: [
      { ...axisBase, size: 28, values: timeAxisValues },
      {
        ...axisBase,
        size: 52,
        // 0/50/100 눈금만
        splits: () => [0, 50, 100],
        values: (_u, vals) => vals.map(v => v == null ? '' : `${v}%`),
      },
    ],
    series: [
      {},
      ...SERIES.map(s => ({ label: s.label, stroke: s.stroke, width: s.width })),
    ],
    plugins: [panZoomPlugin(panZoom)],
    hooks: {
      // 70% 위험 가이드라인 (빨강 점선)
      drawAxes: [(u) => {
        const ctx = u.ctx
        const { left, width: pw } = u.bbox
        const y = Math.round(u.valToPos(DANGER_PCT, 'y', true))
        ctx.save()
        ctx.strokeStyle = 'rgba(220,38,38,0.5)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(left + pw, y)
        ctx.stroke()
        ctx.restore()
      }],
    },
  }
}

// LatencyChart와 동일한 스타일의 툴팁
function Tooltip({ u, pts }: { u: uPlot | null; pts: ResourcePoint[] }) {
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
      pointerEvents: 'none', zIndex: 9999, minWidth: 130,
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    }}>
      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 5 }}>{time}</div>
      {SERIES.map(s => (
        <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
          <span style={{ color: s.stroke }}>{s.label}</span>
          <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{s.get(p).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}

function ResourceCanvas({ history }: Props) {
  const wrapRef      = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef      = useRef<uPlot | null>(null)
  const panZoomRef   = useRef<PanZoomState>({ userZoomed: false })
  const [uInst, setUInst] = useState<uPlot | null>(null)

  const rebuild = (w: number, h: number) => {
    const el = containerRef.current
    if (!el) return
    plotRef.current?.destroy()
    panZoomRef.current = { userZoomed: false }
    const u = new uPlot(makeOpts(w, h, panZoomRef.current), toUPlotData(history), el)
    plotRef.current = u
    setUInst(u)
  }

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    rebuild(wrap.clientWidth || 400, wrap.clientHeight || 140)
    return () => { plotRef.current?.destroy(); plotRef.current = null; setUInst(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 새 데이터 반영 — 줌 상태 존중(공유 헬퍼)
  useEffect(() => {
    const u = plotRef.current
    if (!u) return
    applyData(u, toUPlotData(history), panZoomRef.current)
  }, [history])

  // 부모 크기 변화 감지 → setSize
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (plotRef.current && w > 0 && h > 0) plotRef.current.setSize({ width: w, height: h })
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

export default function ResourceChart({ history }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <ResourceCanvas history={history} />
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
            <span style={{ position: 'absolute', top: 10, left: 16, fontSize: 12, fontWeight: 600, color: '#374151' }}>Resource</span>
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
              <ResourceCanvas history={history} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
