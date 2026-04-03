import { useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useWebSocket } from './hooks/useWebSocket'
import TopologyGraph from './components/TopologyGraph'
import DetailPanel from './components/DetailPanel'

const WS_URL = `ws://${window.location.hostname}:9090/ws`

export default function App() {
  const { snapshots, connected } = useWebSocket(WS_URL)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // 항상 snapshots에서 최신값을 읽음 — 클릭 시점의 스냅샷에 고정되지 않음
  const selected = selectedKey ? (snapshots[selectedKey] ?? null) : null

  return (
    <div className="flex flex-col w-screen h-screen bg-[#0f1117]">
      {/* 상단 바 */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-slate-700/60 shrink-0">
        <h1 className="text-slate-100 font-semibold text-base tracking-tight">
          MicroTrace
        </h1>
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
          <span className="text-slate-400">{connected ? 'connected' : 'reconnecting...'}</span>
        </div>
      </header>

      {/* 메인 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 토폴로지 */}
        <div className="flex-1">
          {Object.keys(snapshots).length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              {connected ? '트래픽 대기 중...' : 'collector에 연결 중...'}
            </div>
          ) : (
            <ReactFlowProvider>
              <TopologyGraph snapshots={snapshots} onEdgeSelect={setSelectedKey} />
            </ReactFlowProvider>
          )}
        </div>

        {/* 우측 상세 패널 */}
        <aside className="w-72 border-l border-slate-700/60 shrink-0 overflow-y-auto">
          <DetailPanel snap={selected} />
        </aside>
      </div>
    </div>
  )
}
