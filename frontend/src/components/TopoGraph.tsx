import { useRef, useState, useCallback, useEffect } from 'react'
import type { SnapshotMap } from '../hooks/useWebSocket'
import type { ServiceMap } from '../hooks/useMockData'
import { NODE_POS } from '../constants/topology'
import { fmtUs, latencyStatus, STATUS_COLOR } from '../utils/format'

interface Props {
  snapshots: SnapshotMap
  services: ServiceMap
  selectedKey: string | null
  selectedNode: string | null
  onSelect: (key: string | null) => void
  onSelectNode: (name: string | null) => void
}

const NODE_W = 156
const NODE_H = 56
const EXT_W  = 112
const EXT_H  = 36
const W      = 1000   // 논리 좌표계 너비
const H      = 700    // 논리 좌표계 높이

function bezierCtrl(sx: number, sy: number, ex: number, ey: number) {
  const mx = (sx + ex) / 2
  const my = (sy + ey) / 2
  const dx = ex - sx
  const dy = ey - sy
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  return { cx: mx + (-dy / len) * 26, cy: my + (dx / len) * 26 }
}

function bezierMid(sx: number, sy: number, cx: number, cy: number, ex: number, ey: number) {
  const t = 0.5
  return {
    x: (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * ex,
    y: (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ey,
  }
}

function nodeLeft(name: string, positions: Record<string, { x: number; y: number }>) {
  const pos = positions[name] ?? NODE_POS[name] ?? { x: 0.5, y: 0.5 }
  return pos.x * W
}
function nodeTop(name: string, positions: Record<string, { x: number; y: number }>) {
  const pos = positions[name] ?? NODE_POS[name] ?? { x: 0.5, y: 0.5 }
  return pos.y * H
}
function nodeCx(name: string, isInternal: boolean, positions: Record<string, { x: number; y: number }>) {
  return nodeLeft(name, positions) + (isInternal ? NODE_W : EXT_W) / 2
}
function nodeCy(name: string, isInternal: boolean, positions: Record<string, { x: number; y: number }>) {
  return nodeTop(name, positions) + (isInternal ? NODE_H : EXT_H) / 2
}

export default function TopoGraph({ snapshots, services, selectedKey, selectedNode, onSelect, onSelectNode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // pan/zoom 상태
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })

  // 현재 스냅샷에서 서비스 목록 + 타입 맵 추출 — positions useEffect보다 먼저 선언해야 함
  const snaps = Object.values(snapshots)
  const allServices = new Set<string>()
  const serviceTypeMap: Record<string, 'internal' | 'external'> = {}
  snaps.forEach(s => {
    allServices.add(s.src_service)
    allServices.add(s.dst_service)
    serviceTypeMap[s.src_service] = s.src_type === 'external' ? 'external' : 'internal'
    serviceTypeMap[s.dst_service] = s.dst_type === 'external' ? 'external' : 'internal'
  })

  // 노드 위치 (0..1 정규화) — 드래그로 변경 가능
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => ({ ...NODE_POS }))

  // NODE_POS에 없는 새 서비스가 등장하면 겹치지 않는 위치를 자동 배정한다.
  const allServicesKey = [...allServices].sort().join(',')
  useEffect(() => {
    setPositions(prev => {
      let changed = false
      const next = { ...prev }
      let idx = Object.keys(next).length
      for (const name of allServices) {
        if (next[name]) continue
        // 황금각 나선 배치 — 겹침 최소화
        const angle = (idx * 137.5 * Math.PI) / 180
        next[name] = {
          x: Math.min(0.9, Math.max(0.1, 0.5 + 0.32 * Math.cos(angle))),
          y: Math.min(0.9, Math.max(0.1, 0.5 + 0.32 * Math.sin(angle))),
        }
        idx++
        changed = true
      }
      return changed ? next : prev
    })
  // allServicesKey로 비교 — Set은 매 렌더마다 새 객체라 직접 deps로 쓰면 무한 루프
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allServicesKey])

  // 캔버스 pan 드래그
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null)
  // 노드 드래그
  const nodeDragRef = useRef<{ name: string; startX: number; startY: number; ox: number; oy: number } | null>(null)
  // 클릭과 드래그 구분
  const didDragRef = useRef(false)

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    setTransform(prev => {
      const newScale = Math.min(3, Math.max(0.2, prev.scale * factor))
      // 마우스 위치 기준으로 줌
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return prev
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      return {
        scale: newScale,
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
      }
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // SVG 좌표 변환 (화면 px → 논리 좌표)
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    didDragRef.current = false

    // 노드 드래그 감지
    const target = e.target as SVGElement
    const nodeEl = target.closest('[data-node-name]') as SVGElement | null
    if (nodeEl) {
      e.stopPropagation()
      const name = nodeEl.dataset.nodeName!
      const cur  = positions[name] ?? NODE_POS[name] ?? { x: 0.5, y: 0.5 }
      nodeDragRef.current = { name, startX: e.clientX, startY: e.clientY, ox: cur.x, oy: cur.y }
      return
    }

    // 캔버스 pan
    panRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y }
  }, [positions, transform])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (nodeDragRef.current) {
      const { startX, startY, name, ox, oy } = nodeDragRef.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDragRef.current = true
      setPositions(prev => ({
        ...prev,
        [name]: {
          x: Math.max(0, Math.min(1, ox + dx / (transform.scale * W))),
          y: Math.max(0, Math.min(1, oy + dy / (transform.scale * H))),
        },
      }))
      return
    }

    if (panRef.current) {
      const { startX, startY, tx, ty } = panRef.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDragRef.current = true
      setTransform(prev => ({ ...prev, x: tx + dx, y: ty + dy }))
    }
  }, [transform.scale])

  const onMouseUp = useCallback(() => {
    nodeDragRef.current = null
    panRef.current = null
  }, [])

  const onSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (didDragRef.current) return
    const target = e.target as SVGElement
    const edgeEl = target.closest('[data-edge-key]') as SVGElement | null
    const nodeEl = target.closest('[data-node-name]') as SVGElement | null
    if (edgeEl) {
      onSelect(edgeEl.dataset.edgeKey ?? null)
    } else if (nodeEl) {
      onSelectNode(nodeEl.dataset.nodeName ?? null)
    } else {
      onSelect(null)
      onSelectNode(null)
    }
  }, [onSelect, onSelectNode])

  // 더블클릭으로 fitView
  const onDoubleClick = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [])

  const cursor = nodeDragRef.current ? 'grabbing' : panRef.current ? 'grabbing' : 'grab'

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', cursor }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {snaps.length === 0 ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          트래픽 대기 중…
        </div>
      ) : (
        <svg
          style={{ width: '100%', height: '100%' }}
          onMouseDown={onMouseDown}
          onClick={onSvgClick}
          onDoubleClick={onDoubleClick}
        >
          <defs>
            <pattern id="topo-dots" x={transform.x % 22} y={transform.y % 22} width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="#e2e8f0"/>
            </pattern>
            <filter id="topo-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="node-shadow">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.08"/>
            </filter>
            {(['#16a34a','#d97706','#ea580c','#dc2626','#2563eb'] as const).map(color => (
              <marker key={color} id={`arr-${color.slice(1)}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 Z" fill={color}/>
              </marker>
            ))}
          </defs>

          {/* 배경 dot grid — pan과 함께 움직임 */}
          <rect width="100%" height="100%" fill="url(#topo-dots)"/>

          {/* 전체 콘텐츠 — pan/zoom transform */}
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>

            {/* 엣지 */}
            {snaps.map(snap => {
              const key      = `${snap.src_service}→${snap.dst_service}`
              const isIntSrc = serviceTypeMap[snap.src_service] !== 'external'
              const isIntDst = serviceTypeMap[snap.dst_service] !== 'external'
              const sx = nodeCx(snap.src_service, isIntSrc, positions)
              const sy = nodeCy(snap.src_service, isIntSrc, positions)
              const ex = nodeCx(snap.dst_service, isIntDst, positions)
              const ey = nodeCy(snap.dst_service, isIntDst, positions)
              const { cx: qcx, cy: qcy } = bezierCtrl(sx, sy, ex, ey)
              const mid = bezierMid(sx, sy, qcx, qcy, ex, ey)
              const d   = `M${sx},${sy} Q${qcx},${qcy} ${ex},${ey}`

              const status   = latencyStatus(snap.p99_us)
              const color    = snap.is_spike ? '#dc2626' : STATUS_COLOR[status]
              const selected = key === selectedKey
              const arrowId  = `arr-${color.slice(1)}`

              return (
                <g key={key} data-edge-key={key} style={{ cursor: 'pointer' }}>
                  <path d={d} fill="none" stroke="transparent" strokeWidth={16 / transform.scale}/>
                  {selected && <path d={d} fill="none" stroke={color} strokeWidth={7} opacity={0.18}/>}
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={snap.is_spike ? 2 : selected ? 2.4 : 1.6}
                    opacity={selected ? 1 : 0.75}
                    strokeDasharray={snap.is_spike ? '7,4' : undefined}
                    markerEnd={`url(#${arrowId})`}
                    filter={snap.is_spike ? 'url(#topo-glow)' : undefined}
                  >
                    {snap.is_spike && (
                      <animate attributeName="stroke-dashoffset" from="0" to="-22" dur="0.55s" repeatCount="indefinite"/>
                    )}
                  </path>
                  <g transform={`translate(${mid.x},${mid.y})`}>
                    <rect x="-26" y="-7.5" width="52" height="15" rx="3" fill="#ffffff" stroke={color} strokeWidth={0.8}/>
                    <text textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-mono)" fontSize={10} fontWeight={selected ? 600 : 500} fill={color}>
                      {fmtUs(snap.p50_us)}
                    </text>
                  </g>
                </g>
              )
            })}

            {/* 노드 */}
            {[...allServices].map(name => {
              const isInternal  = serviceTypeMap[name] !== 'external'
              const x = nodeLeft(name, positions)
              const y = nodeTop(name, positions)
              const w = isInternal ? NODE_W : EXT_W
              const h = isInternal ? NODE_H : EXT_H
              const svc = services[name]
              const stressKind  = svc?.stress_kind ?? null
              const stressColor = stressKind === 'cpu' ? '#dc2626' : stressKind === 'io' ? '#7c3aed' : stressKind === 'memory' ? '#ea580c' : null
              const isSelectedNode = selectedNode === name || (selectedKey ? selectedKey.startsWith(name + '→') || selectedKey.endsWith('→' + name) : false)

              return (
                <g key={name} data-node-name={name} style={{ cursor: 'grab' }} filter="url(#node-shadow)">
                  {stressColor && (
                    <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={10} fill={stressColor} opacity={0}>
                      <animate attributeName="opacity" values="0.18;0.06;0.18" dur="1.4s" repeatCount="indefinite"/>
                    </rect>
                  )}
                  <rect
                    x={x} y={y} width={w} height={h} rx={8}
                    fill={isInternal ? '#ffffff' : '#f8fafc'}
                    stroke={isSelectedNode ? '#2563eb' : stressColor ?? '#cbd5e1'}
                    strokeWidth={isSelectedNode ? 1.8 : 1.2}
                    strokeDasharray={!isInternal ? '5,3' : undefined}
                  />
                  {isInternal ? (
                    <>
                      <text x={x + w / 2} y={y + 18} textAnchor="middle" fontFamily="var(--font-ui)" fontSize={12} fontWeight={600} fill="var(--text-primary)" style={{ pointerEvents: 'none' }}>
                        {name}
                      </text>
                      <MicroBars x={x + w / 2 - 60} y={y + 32} svc={svc}/>
                    </>
                  ) : (
                    <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-ui)" fontSize={11} fontWeight={500} fill="var(--text-muted)" style={{ pointerEvents: 'none' }}>
                      {name}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      )}

      {/* 컨트롤 버튼 */}
      <Controls onZoomIn={() => setTransform(p => ({ ...p, scale: Math.min(3, p.scale * 1.2) }))}
                onZoomOut={() => setTransform(p => ({ ...p, scale: Math.max(0.2, p.scale / 1.2) }))}
                onFit={() => setTransform({ x: 0, y: 0, scale: 1 })} />

      <Legend />
    </div>
  )
}

function MicroBars({ x, y, svc }: { x: number; y: number; svc: any }) {
  const bars = [
    { pct: svc?.cpu_pct ?? 0,          high: (svc?.cpu_pct ?? 0) > 70,    color: '#dc2626' },
    { pct: svc?.io_wait_pct ?? 0,       high: (svc?.io_wait_pct ?? 0) > 30, color: '#7c3aed' },
    { pct: svc?.mem_pressure_pct ?? 0,  high: (svc?.mem_pressure_pct ?? 0) > 70, color: '#ea580c' },
  ]
  const BAR_W = 36, BAR_H = 6, GAP = 8
  return (
    <g style={{ pointerEvents: 'none' }}>
      {bars.map((bar, i) => {
        const bx = x + i * (BAR_W + GAP)
        return (
          <g key={i}>
            <rect x={bx} y={y} width={BAR_W} height={BAR_H} rx={3} fill="#f1f5f9"/>
            <rect x={bx} y={y} width={Math.min(BAR_W, (bar.pct / 100) * BAR_W)} height={BAR_H} rx={3}
              fill={bar.high ? bar.color : '#94a3b8'} fillOpacity={bar.high ? 1 : 0.55}/>
          </g>
        )
      })}
    </g>
  )
}

function Controls({ onZoomIn, onZoomOut, onFit }: { onZoomIn: () => void; onZoomOut: () => void; onFit: () => void }) {
  const btn: React.CSSProperties = {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#ffffff', border: 'none', borderBottom: '1px solid #e2e8f0',
    cursor: 'pointer', fontSize: 16, color: '#475569',
  }
  return (
    <div style={{ position: 'absolute', bottom: 12, right: 12, borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
      <button style={btn} onClick={onZoomIn} title="Zoom in">+</button>
      <button style={{ ...btn, fontSize: 20 }} onClick={onZoomOut} title="Zoom out">−</button>
      <button style={{ ...btn, borderBottom: 'none', fontSize: 11, fontWeight: 600, color: '#64748b' }} onClick={onFit} title="Fit view (double-click)">⊡</button>
    </div>
  )
}

function Legend() {
  return (
    <div style={{
      position: 'absolute', bottom: 12, left: 12,
      background: '#ffffff', border: '1px solid var(--border)',
      borderRadius: 8, padding: '6px 10px',
      display: 'flex', flexDirection: 'column', gap: 4,
      pointerEvents: 'none',
    }}>
      {[
        { color: '#16a34a', label: 'OK  < 5ms' },
        { color: '#d97706', label: 'Warn  5–20ms' },
        { color: '#ea580c', label: 'High  20–100ms' },
        { color: '#dc2626', label: 'Critical / Spike' },
      ].map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 24, height: 2, background: color, borderRadius: 1 }}/>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <div style={{ width: 24, height: 2, borderTop: '1px dashed #cbd5e1' }}/>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>external</span>
      </div>
    </div>
  )
}
