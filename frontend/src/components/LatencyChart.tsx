import { useRef, useEffect } from 'react'
import type { HistoryPoint } from '../hooks/useWebSocket'
import { fmtYLabel, fmtTime } from '../utils/format'

interface Props {
  history: HistoryPoint[]
  isSpike?: boolean
}

const PAD = { top: 10, right: 14, bottom: 22, left: 56 }

export default function LatencyChart({ history, isSpike }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 논리 크기 (CSS px 기준으로 계산)
    const W = canvas.width  / dpr
    const H = canvas.height / dpr

    const pts = history.slice(-180)
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

    // Y 스케일
    const allVals = pts.flatMap(p => [p.avg_us, p.p50_us, p.p95_us, p.p99_us])
    const rawMax  = Math.max(...allVals)
    const rawMin  = Math.min(...allVals)
    const yMax = Math.max(rawMax * 1.15, rawMin * 0.85 + 500)
    const yMin = Math.max(0, rawMin * 0.85)
    const yRange = yMax - yMin || 1

    const toX = (i: number) => PAD.left + (i / (pts.length - 1)) * pw
    const toY = (v: number) => PAD.top + ph - ((v - yMin) / yRange) * ph

    // 배경
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    // 스파이크 오버레이
    if (isSpike) {
      ctx.fillStyle = 'rgba(220,38,38,0.04)'
      ctx.fillRect(PAD.left + pw * 0.82, PAD.top, pw * 0.18, ph)
    }

    // Jitter band (P50 ± jitter/2)
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

    // Grid lines (Y)
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

    // 라인 그리기
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

    // X axis labels
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

    // Border
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.strokeRect(PAD.left, PAD.top, pw, ph)
  }, [history, isSpike])

  // ResizeObserver로 캔버스 크기 동기화 (DPR 적용으로 고해상도 렌더링)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current
      if (!canvas || !el) return
      const dpr = window.devicePixelRatio || 1
      canvas.width  = el.clientWidth  * dpr
      canvas.height = el.clientHeight * dpr
      canvas.dispatchEvent(new Event('resize'))
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
