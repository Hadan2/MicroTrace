import { useState } from 'react'
import { useWebSocket }      from './hooks/useWebSocket'
import { useMockData }       from './hooks/useMockData'
import TopBar                from './components/TopBar'
import GlobalMetrics         from './components/GlobalMetrics'
import SectionHeader         from './components/SectionHeader'
import ViewSwitcher          from './components/ViewSwitcher'
import TopoGraph             from './components/TopoGraph'
import ConnectionListView    from './components/ConnectionListView'
import HeatmapMatrixView     from './components/HeatmapMatrixView'
import DetailPanel           from './components/DetailPanel'
import SpikeLog              from './components/SpikeLog'

const WS_URL   = `ws://${window.location.hostname}:9090/ws`
const USE_MOCK = import.meta.env.VITE_MOCK === 'true'

export type ViewMode = 'graph' | 'list' | 'matrix'

export default function App() {
  const ws   = useWebSocket(USE_MOCK ? '' : WS_URL)
  const mock = useMockData()
  const { snapshots, services, history, events, connected } = USE_MOCK ? mock : ws

  const [selectedKey,  setSelected]     = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [viewMode,     setViewMode]     = useState<ViewMode>('graph')

  const selectedSnap = selectedKey ? (snapshots[selectedKey] ?? null) : null
  const selectedHist = selectedKey ? (history[selectedKey]   ?? [])   : []

  const handleSelectEdge = (key: string | null) => {
    setSelected(key)
    setSelectedNode(null)
  }
  const handleSelectNode = (name: string | null) => {
    setSelectedNode(name)
    setSelected(null)
  }

  const edgeCount = Object.keys(snapshots).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-base)', overflowY: 'auto' }}>
      <TopBar connected={connected} snapshots={snapshots} services={services} />

      <GlobalMetrics snapshots={snapshots} services={services} />

      <div style={{ display: 'flex', flex: 1, minHeight: 460, gap: 12, padding: 12 }}>
        {/* 왼쪽: 토폴로지 패널 */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <SectionHeader label="Service Topology" count={`${edgeCount} edges`}>
            <ViewSwitcher value={viewMode} onChange={setViewMode} />
          </SectionHeader>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {viewMode === 'graph'  && (
              <TopoGraph
                snapshots={snapshots}
                services={services}
                selectedKey={selectedKey}
                selectedNode={selectedNode}
                onSelect={handleSelectEdge}
                onSelectNode={handleSelectNode}
              />
            )}
            {viewMode === 'list' && (
              <ConnectionListView
                snapshots={snapshots}
                selectedKey={selectedKey}
                onSelect={handleSelectEdge}
              />
            )}
            {viewMode === 'matrix' && (
              <HeatmapMatrixView
                snapshots={snapshots}
                services={services}
                selectedKey={selectedKey}
                onSelect={handleSelectEdge}
              />
            )}
          </div>
        </div>

        {/* 오른쪽: 디테일 패널 */}
        <div style={{ flex: '0 0 calc(40% - 12px)', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <SectionHeader label="Detail · Root-cause Analysis" />
          <DetailPanel
            snap={selectedSnap}
            history={selectedHist}
            selectedNode={selectedNode}
            nodeService={selectedNode ? (services[selectedNode] ?? null) : null}
            onClose={() => { setSelected(null); setSelectedNode(null) }}
          />
        </div>
      </div>

      {/* 하단: 스파이크 로그 */}
      <div style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}>
        <SectionHeader label="Spike Event Log" count={events.length > 0 ? String(events.length) : undefined} />
        <SpikeLog events={events} onSelect={setSelected} />
      </div>
    </div>
  )
}
