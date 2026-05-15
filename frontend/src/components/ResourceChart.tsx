import { useRef, useEffect, useState } from 'react'
import type { ResourcePoint } from '../types'
import { fmtTime } from '../utils/format'
import { useChartPanZoom } from '../hooks/useChartPanZoom'

interface Props {
  history: ResourcePoint[]
  dstName?: string
}

const PAD = { top: 10, right: 14, bottom: 22, left: 56 }

function ResourceCanvas({ history, dstName, expanded = false }: Props & { expanded?: boolean }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { window: viewWin, isLive, goLive, onMouseDown, onWheel } = useChartPanZoom({
    totalLength: history.length,
  })

  const pts = viewWin === null ? history.slice(-180) : history.slice(viewWin.start, viewWin.end + 1)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = canvas.width  / dpr
    const H = canvas.height / dpr
    const pw = W - PAD.left - PAD.right
    const ph = H - PAD.top  - PAD.bottom

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    if (pts.length < 2) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px Inter, system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('리소스 데이터 수집 중…', W / 2, H / 2)
      return
    }

    // pan 중 배경 틴트
    if (!isLive) {
      ctx.fillStyle = 'rgba(99,102,241,0.03)'
      ctx.fillRect(PAD.left, PAD.top, pw, ph)
    }

    const toX = (i: number) => PAD.left + (i / (pts.length - 1)) * pw
    const toY = (pct: number) => PAD.top + ph - (pct / 100) * ph

    // Y grid
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 1
    ;[0, 50, 100].forEach(pct => {
      const y = toY(pct)
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(PAD.left + pw, y)
      ctx.stroke()
      ctx.fillStyle = '#94a3b8'
      ctx.font = '9px JetBrains Mono, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`${pct}%`, PAD.left - 4, y + 3)
    })

    // 70% 가이드라인
    ctx.strokeStyle = '#dc2626'
    ctx.lineWidth = 0.8
    ctx.setLineDash([4, 3])
    const y70 = toY(70)
    ctx.beginPath()
    ctx.moveTo(PAD.left, y70)
    ctx.lineTo(PAD.left + pw, y70)
    ctx.stroke()
    ctx.setLineDash([])

    function drawLine(getter: (p: ResourcePoint) => number, color: string) {
      ctx!.strokeStyle = color
      ctx!.lineWidth   = 2
      ctx!.setLineDash([])
      ctx!.beginPath()
      pts.forEach((p, i) => {
        const x = toX(i)
        const y = toY(getter(p))
        i === 0 ? ctx!.moveTo(x, y) : ctx!.lineTo(x, y)
      })
      ctx!.stroke()
    }

    drawLine(p => p.cpu_pct,          '#dc2626')
    drawLine(p => p.io_wait_pct,      '#7c3aed')
    drawLine(p => p.mem_pressure_pct, '#ea580c')

    // X labels
    const xTicks = [0, Math.floor(pts.length / 2), pts.length - 1]
    ctx.fillStyle = '#94a3b8'
    ctx.font = '9px JetBrains Mono, monospace'
    xTicks.forEach(i => {
      if (!pts[i]) return
      const x = toX(i)
      ctx.textAlign = i === 0 ? 'left' : i === pts.length - 1 ? 'right' : 'center'
      ctx.fillText(fmtTime(pts[i].time), x, PAD.top + ph + 14)
    })

    if (dstName) {
      ctx.fillStyle = '#64748b'
      ctx.font = '9px Inter, system-ui'
      ctx.textAlign = 'left'
      ctx.fillText(dstName, PAD.left + 4, PAD.top + 10)
    }

    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.strokeRect(PAD.left, PAD.top, pw, ph)
  }, [pts, dstName, isLive])

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
      {expanded && (
        <div style={{
          position: 'absolute', top: 12, right: 18,
          display: 'flex', gap: 10, fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace', color: '#64748b',
        }}>
          {[
            { color: '#dc2626', label: 'CPU' },
            { color: '#7c3aed', label: 'IO wait' },
            { color: '#ea580c', label: 'Mem pressure' },
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

export default function ResourceChart({ history, dstName }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <ResourceCanvas history={history} dstName={dstName} />
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
              Resource
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
            <ResourceCanvas history={history} dstName={dstName} expanded />
          </div>
        </div>
      )}
    </>
  )
}
