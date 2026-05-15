import { useRef, useEffect, useState } from 'react'
import type { HistoryPoint } from '../hooks/useWebSocket'
import { fmtYLabel, fmtTime } from '../utils/format'
import { useChartPanZoom } from '../hooks/useChartPanZoom'

interface Props {
  history: HistoryPoint[]
  isSpike?: boolean
}

const PAD = { top: 10, right: 14, bottom: 22, left: 56 }

function LatencyCanvas({
  history,
  isSpike,
  expanded = false,
}: Props & { expanded?: boolean }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { window: viewWin, isLive, goLive, onMouseDown, onWheel } = useChartPanZoom({
    totalLength: history.length,
  })

  // 현재 보여줄 포인트 슬라이스
  const pts = (() => {
    if (viewWin === null) return history.slice(-180)
    return history.slice(viewWin.start, viewWin.end + 1)
  })()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = canvas.width  / dpr
    const H = canvas.height / dpr

    if (pts.length < 2) {
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px Inter, system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('데이터 수집 중…', W / 2, H / 2)
      return
    }

    const pw = W - PAD.left - PAD.right
    const ph = H - PAD.top  - PAD.bottom

    const allVals = pts.flatMap(p => [p.avg_us, p.p50_us, p.p95_us, p.p99_us])
    const rawMax  = Math.max(...allVals)
    const rawMin  = Math.min(...allVals)
    const yMax = Math.max(rawMax * 1.15, rawMin * 0.85 + 500)
    const yMin = Math.max(0, rawMin * 0.85)
    const yRange = yMax - yMin || 1

    const toX = (i: number) => PAD.left + (i / (pts.length - 1)) * pw
    const toY = (v: number) => PAD.top + ph - ((v - yMin) / yRange) * ph

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    // pan 중이면 배경에 살짝 틴트
    if (!isLive) {
      ctx.fillStyle = 'rgba(99,102,241,0.03)'
      ctx.fillRect(PAD.left, PAD.top, pw, ph)
    }

    if (isSpike) {
      ctx.fillStyle = 'rgba(220,38,38,0.04)'
      ctx.fillRect(PAD.left + pw * 0.82, PAD.top, pw * 0.18, ph)
    }

    // Jitter band
    ctx.fillStyle = 'rgba(37,99,235,0.08)'
    ctx.beginPath()
    pts.forEach((p, i) => {
      const x = toX(i)
      const y = toY(p.p50_us + p.jitter_us / 2)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    for (let i = pts.length - 1; i >= 0; i--) {
      ctx.lineTo(toX(i), toY(Math.max(yMin, pts[i].p50_us - pts[i].jitter_us / 2)))
    }
    ctx.closePath()
    ctx.fill()

    // Grid
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 1
    for (let i = 0; i <= 3; i++) {
      const y = PAD.top + (ph / 3) * i
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(PAD.left + pw, y)
      ctx.stroke()
      const val = yMax - (yRange / 3) * i
      ctx.fillStyle = '#94a3b8'
      ctx.font = '9px JetBrains Mono, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(fmtYLabel(val), PAD.left - 4, y + 3)
    }

    function drawLine(getter: (p: HistoryPoint) => number, color: string, width: number, dash?: number[]) {
      ctx!.strokeStyle = color
      ctx!.lineWidth   = width
      ctx!.setLineDash(dash ?? [])
      ctx!.beginPath()
      pts.forEach((p, i) => {
        const x = toX(i)
        const y = toY(getter(p))
        i === 0 ? ctx!.moveTo(x, y) : ctx!.lineTo(x, y)
      })
      ctx!.stroke()
    }

    drawLine(p => p.avg_us,  '#2563eb', 1.2, [4, 3])
    drawLine(p => p.p50_us,  '#16a34a', 1.8)
    drawLine(p => p.p95_us,  '#d97706', 1.8)
    drawLine(p => p.p99_us,  '#ea580c', 2.4)

    // X labels
    const xTicks = [0, Math.floor(pts.length / 2), pts.length - 1]
    ctx.fillStyle = '#94a3b8'
    ctx.font = '9px JetBrains Mono, monospace'
    xTicks.forEach(i => {
      if (!pts[i]) return
      const x = toX(i)
      const label = fmtTime(pts[i].time)
      ctx.textAlign = i === 0 ? 'left' : i === pts.length - 1 ? 'right' : 'center'
      ctx.fillText(label, x, PAD.top + ph + 14)
    })

    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.strokeRect(PAD.left, PAD.top, pw, ph)
  }, [pts, isSpike, isLive])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current
      if (!canvas || !el) return
      const dpr = window.devicePixelRatio || 1
      canvas.width  = el.clientWidth  * dpr
      canvas.height = el.clientHeight * dpr
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: isLive ? 'default' : 'grab' }}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
      />
      {/* Live 복귀 버튼 */}
      {!isLive && (
        <button
          onClick={goLive}
          style={{
            position: 'absolute', bottom: 26, right: 18,
            fontSize: 10, padding: '2px 7px', borderRadius: 4,
            background: '#6366f1', color: '#fff', border: 'none',
            cursor: 'pointer', fontFamily: 'Inter, system-ui',
          }}
        >
          ▶ Live
        </button>
      )}
      {/* 범례 */}
      {expanded && (
        <div style={{
          position: 'absolute', top: 12, right: 18,
          display: 'flex', gap: 10, fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace', color: '#64748b',
        }}>
          {[
            { color: '#2563eb', label: 'avg', dash: true },
            { color: '#16a34a', label: 'p50' },
            { color: '#d97706', label: 'p95' },
            { color: '#ea580c', label: 'p99' },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 16, height: 2, background: color, display: 'inline-block' }} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LatencyChart({ history, isSpike }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      {/* 일반 크기 */}
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
        >
          ⤢
        </button>
      </div>

      {/* 모달 */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 10,
              width: '80vw', height: '60vh',
              padding: '36px 24px 24px',
              position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            <span style={{
              position: 'absolute', top: 10, left: 16,
              fontSize: 12, fontWeight: 600, color: '#374151',
            }}>
              Latency
            </span>
            <button
              onClick={() => setModalOpen(false)}
              style={{
                position: 'absolute', top: 8, right: 12,
                background: 'none', border: 'none', fontSize: 18,
                cursor: 'pointer', color: '#94a3b8',
              }}
            >
              ✕
            </button>
            <LatencyCanvas history={history} isSpike={isSpike} expanded />
          </div>
        </div>
      )}
    </>
  )
}
