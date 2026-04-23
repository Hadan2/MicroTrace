import { useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useWebSocket } from './hooks/useWebSocket'
import TopologyGraph from './components/TopologyGraph'
import LatencyChart from './components/LatencyChart'

const WS_URL = `ws://${window.location.hostname}:9090/ws`

export default function App() {
  const { snapshots, history, connected } = useWebSocket(WS_URL)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const selectedSnap = selectedKey ? (snapshots[selectedKey] ?? null) : null
  const selectedHistory = selectedKey ? (history[selectedKey] ?? []) : []

  return (
    <div className="flex flex-col w-screen h-screen bg-white">
      {/* 상단 바 */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
        <h1 className="text-slate-800 font-semibold text-base tracking-tight">
          MicroTrace
        </h1>
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-slate-500">{connected ? 'connected' : 'reconnecting...'}</span>
        </div>
      </header>

      {/* 상단: 그래프 패널 */}
      <div className="h-56 border-b border-slate-200 shrink-0">
        <LatencyChart
          historyKey={selectedKey}
          history={selectedHistory}
          snap={selectedSnap}
        />
      </div>

      {/* 하단: 토폴로지 */}
      <div className="flex-1 overflow-hidden select-none">
        <ReactFlowProvider>
          {Object.keys(snapshots).length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              {connected ? '트래픽 대기 중...' : 'collector에 연결 중...'}
            </div>
          ) : (
            <TopologyGraph snapshots={snapshots} onEdgeSelect={setSelectedKey} />
          )}
        </ReactFlowProvider>
      </div>
    </div>
  )
}
