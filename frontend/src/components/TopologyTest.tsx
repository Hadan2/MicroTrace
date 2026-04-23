import { ReactFlow, Background, BackgroundVariant, Controls, type Node, type Edge } from '@xyflow/react'

const nodes: Node[] = [
  { id: 'a', position: { x: 300, y: 100 }, data: { label: 'service-a' } },
  { id: 'b', position: { x: 100, y: 300 }, data: { label: 'service-b' } },
  { id: 'c', position: { x: 500, y: 300 }, data: { label: 'service-c' } },
]

const edges: Edge[] = [
  { id: 'a-b', source: 'a', target: 'b', label: '2ms' },
  { id: 'a-c', source: 'a', target: 'c', label: '5ms' },
]

export default function TopologyTest() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
      </ReactFlow>
    </div>
  )
}
