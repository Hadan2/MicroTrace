import { useRef, useEffect } from 'react'
import type { ResourcePoint } from '../types'
import { fmtTime } from '../utils/format'

interface Props {
  history: ResourcePoint[]
  dstName?: string
}

const PAD = { top: 10, right: 14, bottom: 22, left: 56 }

export default function ResourceChart({ history, dstName }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = canvas.width  / dpr
    const H = canvas.height / dpr

    const pts = history.slice(-180)
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

    const toX = (i: number) => PAD.left + (i / (pts.length - 1)) * pw
    const toY = (pct: number) => PAD.top + ph - (pct / 100) * ph

    // Y grid (0 / 50 / 100)
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

    // 70% 가이드라인 (빨간 점선)
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

    // Label (좌상단)
    if (dstName) {
      ctx.fillStyle = '#64748b'
      ctx.font = '9px Inter, system-ui'
      ctx.textAlign = 'left'
      ctx.fillText(dstName, PAD.left + 4, PAD.top + 10)
    }

    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.strokeRect(PAD.left, PAD.top, pw, ph)
  }, [history, dstName])

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
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }}/>
    </div>
  )
}
