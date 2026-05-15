// mt-app.jsx — Main app (light theme)

const { useState: aUseState, useEffect: aUseEffect, useRef: aUseRef, useCallback: aUseCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "showExternal": true,
  "logPanelHeight": 168,
  "tickIntervalMs": 1000,
  "primaryAccent": "#2563eb"
}/*EDITMODE-END*/;

/* ── TopBar ── */
function TopBar({ connected, spikeCount, serviceCount, stressedCount }) {
  const [now, setNow] = aUseState(() => new Date());
  aUseEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toTimeString().slice(0, 8);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      padding: '0 18px', height: 50,
      background: '#ffffff', borderBottom: '1px solid #e2e8f0',
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginRight: 22 }}>
        <svg width={22} height={22} viewBox="0 0 22 22">
          <circle cx={11} cy={11} r={9.5} fill="none" stroke="#2563eb" strokeWidth={1.6} />
          <circle cx={11} cy={11} r={4} fill="#2563eb" />
          <line x1={11} y1={1} x2={11} y2={4} stroke="#2563eb" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={11} y1={18} x2={11} y2={21} stroke="#2563eb" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={1} y1={11} x2={4} y2={11} stroke="#2563eb" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={18} y1={11} x2={21} y2={11} stroke="#2563eb" strokeWidth={1.4} strokeLinecap="round" />
        </svg>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 600, color: '#0f172a', letterSpacing: '-0.02em' }}>MicroTrace</span>
        <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace", marginLeft: 2 }}>v0.3</span>
      </div>

      <div style={{ width: 1, height: 22, background: '#e2e8f0', marginRight: 16 }} />

      {/* Tagline */}
      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'Inter, system-ui', fontWeight: 500, marginRight: 18 }}>
        Latency Root-Cause Profiler
      </span>

      {/* Connection */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 16 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: connected ? '#16a34a' : '#dc2626',
          boxShadow: connected ? '0 0 6px #16a34a66' : '0 0 6px #dc262666',
        }} />
        <span style={{ fontSize: 11, color: connected ? '#16a34a' : '#dc2626', fontFamily: 'Inter, system-ui', fontWeight: 600 }}>
          {connected ? 'collector connected' : 'reconnecting…'}
        </span>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={badgePill('#f1f5f9', '#cbd5e1', '#475569')}>{serviceCount} services</span>
        {stressedCount > 0 && (
          <span style={badgePill('#fff7ed', '#fed7aa', '#ea580c')}>⚡ {stressedCount} stressed</span>
        )}
        {spikeCount > 0 && (
          <span style={{ ...badgePill('#fef2f2', '#fecaca', '#dc2626'), animation: 'blink 1.4s ease infinite' }}>
            🔴 {spikeCount} spike{spikeCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'Inter, system-ui', fontWeight: 500 }}>LIVE</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#0f172a', fontWeight: 600 }}>{timeStr}</span>
      </div>
    </div>
  );
}

function badgePill(bg, border, color) {
  return {
    padding: '3px 10px', borderRadius: 12,
    background: bg, border: `1px solid ${border}`,
    fontSize: 10, color, fontFamily: 'Inter, system-ui', fontWeight: 600,
  };
}

/* ── SectionHeader ── */
function SectionHeader({ label, count, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 16px', height: 36,
      borderBottom: '1px solid #e2e8f0',
      background: '#f8fafc',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, color: '#475569', fontFamily: 'Inter, system-ui', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 10, color: '#64748b', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1px 8px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{count}</span>
      )}
      {children && <div style={{ marginLeft: 'auto' }}>{children}</div>}
    </div>
  );
}

/* ── TweaksPanel ── */
function TweaksPanel({ tweaks, onChange, onClose }) {
  const row = (label, children) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
      <span style={{ fontSize: 11, color: '#475569', fontFamily: 'Inter, system-ui', fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  );
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, width: 260,
      background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10,
      boxShadow: '0 16px 40px rgba(15,23,42,0.16)', zIndex: 1000, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', fontFamily: 'Inter, system-ui', letterSpacing: '-0.01em' }}>Tweaks</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>
      {row('Tick interval', (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range" min={200} max={3000} step={100} value={tweaks.tickIntervalMs}
            onChange={e => onChange('tickIntervalMs', parseInt(e.target.value))}
            style={{ width: 80, accentColor: '#2563eb' }} />
          <span style={{ fontSize: 10, color: '#2563eb', fontFamily: "'JetBrains Mono', monospace", width: 40, textAlign: 'right' }}>{tweaks.tickIntervalMs}ms</span>
        </div>
      ))}
      {row('Show external', (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={tweaks.showExternal} onChange={e => onChange('showExternal', e.target.checked)} style={{ accentColor: '#2563eb' }} />
          <span style={{ fontSize: 10, color: tweaks.showExternal ? '#16a34a' : '#94a3b8', fontFamily: 'Inter, system-ui', fontWeight: 500 }}>{tweaks.showExternal ? 'on' : 'off'}</span>
        </label>
      ))}
      {row('Log height', (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range" min={120} max={320} step={20} value={tweaks.logPanelHeight}
            onChange={e => onChange('logPanelHeight', parseInt(e.target.value))}
            style={{ width: 80, accentColor: '#2563eb' }} />
          <span style={{ fontSize: 10, color: '#2563eb', fontFamily: "'JetBrains Mono', monospace", width: 36, textAlign: 'right' }}>{tweaks.logPanelHeight}px</span>
        </div>
      ))}
    </div>
  );
}

/* ── Main App ── */
function App() {
  const [snapshots, setSnapshots] = aUseState({});
  const [services, setServices]   = aUseState({});
  const [events, setEvents]       = aUseState([]);
  const [selectedKey, setSelected] = aUseState(null);
  const [tweaksVisible, setTweaksVisible] = aUseState(false);
  const [tweaks, setTweaks] = aUseState(TWEAK_DEFAULTS);
  const [viewMode, setViewMode] = aUseState('graph'); // graph | list | matrix
  const tickIntervalRef = aUseRef(tweaks.tickIntervalMs);

  aUseEffect(() => { tickIntervalRef.current = tweaks.tickIntervalMs; }, [tweaks.tickIntervalMs]);

  // Simulation loop
  aUseEffect(() => {
    const { tick } = window.MTData;
    // Pre-warm
    let result;
    for (let i = 0; i < 80; i++) result = tick();
    if (result) {
      setSnapshots(result.snapshots);
      setServices(result.services);
      setEvents(result.allEvents);
    }

    let timeoutId;
    function loop() {
      const r = tick();
      setSnapshots({ ...r.snapshots });
      setServices({ ...r.services });
      setEvents([...r.allEvents]);
      timeoutId = setTimeout(loop, tickIntervalRef.current);
    }
    timeoutId = setTimeout(loop, tickIntervalRef.current);
    return () => clearTimeout(timeoutId);
  }, []);

  const handleTweakChange = aUseCallback((key, val) => {
    setTweaks(prev => {
      const next = { ...prev, [key]: val };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: next }, '*');
      return next;
    });
  }, []);

  // Tweaks panel protocol
  aUseEffect(() => {
    function onMsg(e) {
      if (e.data?.type === '__activate_edit_mode')   setTweaksVisible(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksVisible(false);
    }
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const selectedSnap = selectedKey ? snapshots[selectedKey] : null;
  const dstSvc = selectedSnap ? services[selectedSnap.dst_service] : null;
  const spikeCount    = Object.values(snapshots).filter(s => s.is_spike).length;
  const stressedCount = Object.values(services).filter(s => s.stress_kind).length;
  const serviceCount  = Object.keys(services).length;

  const visibleSnapshots = tweaks.showExternal
    ? snapshots
    : Object.fromEntries(
        Object.entries(snapshots).filter(([, s]) =>
          window.MTData.INTERNAL_SERVICES.includes(s.src_service) &&
          window.MTData.INTERNAL_SERVICES.includes(s.dst_service)
        )
      );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', minHeight: '100vh', background: '#f6f8fb', overflow: 'auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.55} }
        @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.3);opacity:0.6} }
        @keyframes matrixPulse { 0%,100%{box-shadow:0 0 0 0 #dc262644} 50%{box-shadow:0 0 0 3px #dc262622} }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        * { box-sizing: border-box; }
        button:hover { background: #f1f5f9 !important; }
      `}</style>

      <TopBar connected={true} spikeCount={spikeCount} serviceCount={serviceCount} stressedCount={stressedCount} />
      <window.GlobalMetrics snapshots={snapshots} services={services} />

      {/* Middle: topology + detail */}
      <div style={{ flex: 1, display: 'flex', minHeight: 460, overflow: 'hidden', padding: 12, gap: 12 }}>
        {/* Topology pane */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', minWidth: 0, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
          <SectionHeader label="Service Topology" count={`${Object.keys(visibleSnapshots).length} edges`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <window.ViewSwitcher value={viewMode} onChange={setViewMode} />
            </div>
          </SectionHeader>
          <div style={{ flex: 1, minHeight: 0 }}>
            {viewMode === 'graph' && (
              <window.TopoGraph
                snapshots={visibleSnapshots}
                services={services}
                selectedKey={selectedKey}
                onSelect={setSelected}
              />
            )}
            {viewMode === 'list' && (
              <window.ConnectionListView
                snapshots={visibleSnapshots}
                selectedKey={selectedKey}
                onSelect={setSelected}
              />
            )}
            {viewMode === 'matrix' && (
              <window.HeatmapMatrixView
                snapshots={visibleSnapshots}
                services={services}
                selectedKey={selectedKey}
                onSelect={setSelected}
              />
            )}
          </div>
        </div>

        {/* Detail pane */}
        <div style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
          <SectionHeader label="Detail · Root-cause Analysis">
            {selectedSnap?.is_spike && (
              <span style={{ fontSize: 10, color: '#dc2626', fontFamily: 'Inter, system-ui', fontWeight: 700, animation: 'blink 1.2s infinite', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626' }} />
                SPIKE DETECTED
              </span>
            )}
          </SectionHeader>
          <window.DetailPanel snap={selectedSnap} dstService={dstSvc} onClose={() => setSelected(null)} />
        </div>
      </div>

      {/* Spike log */}
      <div style={{ flexShrink: 0, height: tweaks.logPanelHeight, borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#ffffff' }}>
        <SectionHeader label="Spike Event Log" count={events.length}>
          {events.length > 0 && (
            <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace" }}>
              latest: {new Date(events[0]?.timestamp).toTimeString().slice(0,8)}
            </span>
          )}
        </SectionHeader>
        <div style={{ flex: 1, minHeight: 0 }}>
          <window.SpikeLog events={events} />
        </div>
      </div>

      {/* Tweaks */}
      {tweaksVisible && (
        <TweaksPanel
          tweaks={tweaks}
          onChange={handleTweakChange}
          onClose={() => { setTweaksVisible(false); window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); }}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
