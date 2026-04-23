import { useEffect, useCallback, useRef } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import type { SnapshotMap } from '../hooks/useWebSocket'
import type { StatSnapshot } from '../types'
// StatSnapshot은 edgeColor, data 타입에 사용

interface Props {
  snapshots: SnapshotMap
  onEdgeSelect: (key: string | null) => void
}

function formatLatency(us: number): string {
  if (us >= 1000) return `${(us / 1000).toFixed(1)}ms`
  return `${us}µs`
}

function edgeColor(snap: StatSnapshot): string {
  if (snap.is_spike) return '#ef4444'
  if (snap.p99_us > 10_000) return '#f97316'
  if (snap.p99_us > 1_000) return '#eab308'
  return '#22c55e'
}

// 내부/외부 노드를 분리해서 배치한다.
// 내부: 상단 영역 원형 배치
// 외부: 하단 영역 가로로 나열
function layoutNodes(
  internal: string[],
  external: string[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}

  // 내부 노드: 원형 배치
  const cx = 400
  const cy = 220
  const r = Math.max(130, internal.length * 55)
  internal.forEach((svc, i) => {
    const angle = (2 * Math.PI * i) / internal.length - Math.PI / 2
    positions[svc] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    }
  })

  // 외부 노드: 구분선 아래 가로 나열
  const externalY = cy + r + 180
  const spacing = 200
  const startX = cx - ((external.length - 1) * spacing) / 2
  external.forEach((svc, i) => {
    positions[svc] = {
      x: startX + i * spacing,
      y: externalY,
    }
  })

  return positions
}

function TopologyGraphInner({ snapshots, onEdgeSelect }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { fitView } = useReactFlow()
  const initialFitDone = useRef(false)

  // 엣지 업데이트 — snapshots가 바뀔 때마다 실행 (레이턴시/색상 갱신)
  useEffect(() => {
    const entries = Object.entries(snapshots)
    setEdges(
      entries.map(([key, snap]) => {
        const color = edgeColor(snap)
        return {
          id: key,
          source: snap.src_service,
          target: snap.dst_service,
          animated: snap.is_spike,
          label: formatLatency(snap.p50_us),
          labelStyle: { fill: color, fontSize: 12, fontWeight: 600 },
          style: { stroke: color, strokeWidth: snap.is_spike ? 3 : 2 },
          markerEnd: { type: 'arrowclosed' as any, color },
          data: snap as unknown as Record<string, unknown>,
        }
      })
    )
  }, [snapshots])

  // 노드 업데이트 — 서비스 목록이 바뀔 때만 실행 (추가/삭제)
  useEffect(() => {
    const entries = Object.entries(snapshots)

    const internalSet = new Set<string>()
    const externalSet = new Set<string>()
    entries.forEach(([, snap]) => {
      if (snap.src_type === 'internal') internalSet.add(snap.src_service)
      else externalSet.add(snap.src_service)
      if (snap.dst_type === 'internal') internalSet.add(snap.dst_service)
      else externalSet.add(snap.dst_service)
    })

    const allServices = [...internalSet, ...externalSet]
    const allServicesKey = allServices.slice().sort().join(',')

    setNodes(prev => {
      // 서비스 목록이 실제로 바뀐 경우에만 노드 재계산
      const prevKey = prev.map(n => n.id).slice().sort().join(',')
      if (prevKey === allServicesKey) return prev

      const existingPositions: Record<string, { x: number; y: number }> = {}
      prev.forEach(n => { existingPositions[n.id] = n.position })

      const newPositions = layoutNodes([...internalSet], [...externalSet])

      const nextNodes = allServices.map(svc => {
        const isInternal = internalSet.has(svc)
        return {
          id: svc,
          position: existingPositions[svc] ?? newPositions[svc],
          data: { label: svc },
          style: isInternal ? {
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            color: '#1e293b',
            fontSize: '13px',
            fontWeight: 500,
            padding: '10px 16px',
            minWidth: '140px',
            textAlign: 'center' as const,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          } : {
            background: '#f8fafc',
            border: '1px dashed #94a3b8',
            borderRadius: '8px',
            color: '#64748b',
            fontSize: '12px',
            fontWeight: 400,
            padding: '8px 14px',
            minWidth: '120px',
            textAlign: 'center' as const,
          },
        }
      })

      // 처음 노드 등장 시 fitView
      if (!initialFitDone.current && nextNodes.length > 0) {
        initialFitDone.current = true
        setTimeout(() => fitView({ padding: 0.3 }), 50)
      }

      return nextNodes
    })
  }, [Object.keys(snapshots).sort().join(',')])

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onEdgeSelect(edge.id)
    },
    [onEdgeSelect]
  )

  const onPaneClick = useCallback(() => {
    onEdgeSelect(null)
  }, [onEdgeSelect])

  // 외부 노드가 있을 때만 구분선 표시
  const hasExternal = Object.values(snapshots).some(
    s => s.src_type === 'external' || s.dst_type === 'external'
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', userSelect: 'none' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodesDraggable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        nodesConnectable={false}
        elementsSelectable
      >
        <Background variant={BackgroundVariant.Dots} color="#e2e8f0" gap={20} />
        <Controls />
      </ReactFlow>

      {/* 내부/외부 영역 레이블 — ReactFlow 캔버스 위에 고정 표시 */}
      {hasExternal && (
        <div style={{
          position: 'absolute', top: 12, left: 16,
          display: 'flex', flexDirection: 'column', gap: 6,
          pointerEvents: 'none', zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: '#ffffff', border: '1px solid #cbd5e1' }} />
            <span style={{ fontSize: 11, color: '#64748b' }}>내부 컨테이너</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: '#f8fafc', border: '1px dashed #94a3b8' }} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>외부 서비스</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TopologyGraph(props: Props) {
  return <TopologyGraphInner {...props} />
}
