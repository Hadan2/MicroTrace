import { useEffect, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
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

function layoutNodes(services: string[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  const cx = 400
  const cy = 300
  const r = Math.max(150, services.length * 60)
  services.forEach((svc, i) => {
    const angle = (2 * Math.PI * i) / services.length - Math.PI / 2
    positions[svc] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    }
  })
  return positions
}

export default function TopologyGraph({ snapshots, onEdgeSelect }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    const entries = Object.entries(snapshots)

    const services = new Set<string>()
    entries.forEach(([, snap]) => {
      services.add(snap.src_service)
      services.add(snap.dst_service)
    })

    // 기존 노드 위치 유지 — 새 서비스만 배치
    setNodes(prev => {
      const existingPositions: Record<string, { x: number; y: number }> = {}
      prev.forEach(n => { existingPositions[n.id] = n.position })

      const newPositions = layoutNodes([...services])

      return [...services].map(svc => ({
        id: svc,
        position: existingPositions[svc] ?? newPositions[svc],
        data: { label: svc },
        style: {
          background: '#1e2130',
          border: '1px solid #3b4256',
          borderRadius: '8px',
          color: '#e2e8f0',
          fontSize: '13px',
          fontWeight: 500,
          padding: '10px 16px',
          minWidth: '140px',
          textAlign: 'center' as const,
        },
      }))
    })

    setEdges(
      entries.map(([key, snap]) => {
        const color = edgeColor(snap)
        return {
          id: key,
          source: snap.src_service,
          target: snap.dst_service,
          animated: snap.is_spike,
          label: formatLatency(snap.p99_us),
          labelStyle: { fill: color, fontSize: 12, fontWeight: 600 },
          style: { stroke: color, strokeWidth: snap.is_spike ? 3 : 2 },
          markerEnd: { type: 'arrowclosed' as any, color },
          data: snap as unknown as Record<string, unknown>,
        }
      })
    )
  }, [snapshots])

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onEdgeSelect(edge.id)
    },
    [onEdgeSelect]
  )

  const onPaneClick = useCallback(() => {
    onEdgeSelect(null)
  }, [onEdgeSelect])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
    >
      <Background variant={BackgroundVariant.Dots} color="#2a2f3f" gap={20} />
    </ReactFlow>
  )
}
