// mt-views.jsx — Alternative topology visualizations
// Exports: ConnectionListView, HeatmapMatrixView, ViewSwitcher

const { useRef: vUseRef, useEffect: vUseEffect, useState: vUseState, useMemo: vUseMemo } = React;

function vFmtUs(us) {
  return us >= 1000 ? `${(us / 1000).toFixed(us >= 10000 ? 1 : 2)}ms` : `${Math.round(us)}µs`;
}

function vLatencyStatus(p99_us) {
  if (p99_us < 5000)   return 'ok';
  if (p99_us < 20000)  return 'warning';
  if (p99_us < 100000) return 'high';
  return 'critical';
}

const V_STATUS_COLOR = {
  ok:       '#16a34a',
  warning:  '#d97706',
  high:     '#ea580c',
  critical: '#dc2626',
};

const V_STATUS_BG = {
  ok:       '#dcfce7',
  warning:  '#fef3c7',
  high:     '#fed7aa',
  critical: '#fee2e2',
};

const V_CAUSE_META = {
  network:  { label: 'Network',  color: '#2563eb', icon: '🌐' },
  cpu:      { label: 'CPU',      color: '#dc2626', icon: '🔥' },
  io:       { label: 'I/O',      color: '#7c3aed', icon: '💾' },
  memory:   { label: 'Memory',   color: '#ea580c', icon: '🧠' },
  external: { label: 'External', color: '#d97706', icon: '🔌' },
};

/* ─── Inline tiny sparkline (SVG, no canvas overhead) ─── */
function MiniSpark({ values, color = '#16a34a', width = 80, height = 22 }) {
  if (!values || values.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.4} />
    </svg>
  );
}

/* ─── Connection List View ─── */
function ConnectionListView({ snapshots, selectedKey, onSelect }) {
  const [sortKey, setSortKey] = vUseState('p99_us');
  const [sortDir, setSortDir] = vUseState('desc');
  const [filter, setFilter]   = vUseState('all'); // all | spike | stressed

  const rows = vUseMemo(() => {
    let arr = Object.values(snapshots);
    if (filter === 'spike')    arr = arr.filter(s => s.is_spike);
    if (filter === 'stressed') arr = arr.filter(s => s.dst_cpu_pct > 70 || s.dst_io_wait_pct > 30 || s.dst_mem_pressure_pct > 70);
    arr.sort((a, b) => {
      const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }, [snapshots, sortKey, sortDir, filter]);

  function setSort(key) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const headerCell = (key, label, align = 'left', width) => (
    <th onClick={() => setSort(key)} style={{
      padding: '7px 10px', fontSize: 10, color: '#475569',
      textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700,
      cursor: 'pointer', userSelect: 'none', textAlign: align,
      background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
      position: 'sticky', top: 0, zIndex: 1, width,
      fontFamily: 'Inter, system-ui',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}
        {sortKey === key && (
          <span style={{ color: '#2563eb', fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
        )}
      </span>
    </th>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#ffffff' }}>
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 14px', borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
        {[
          { k: 'all',      label: `All · ${Object.keys(snapshots).length}` },
          { k: 'spike',    label: `🔴 Spiking · ${Object.values(snapshots).filter(s=>s.is_spike).length}` },
          { k: 'stressed', label: `⚡ Stressed · ${Object.values(snapshots).filter(s=>s.dst_cpu_pct>70||s.dst_io_wait_pct>30||s.dst_mem_pressure_pct>70).length}` },
        ].map(({ k, label }) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600,
            border: filter === k ? '1px solid #2563eb' : '1px solid #e2e8f0',
            background: filter === k ? '#eff6ff' : '#ffffff',
            color: filter === k ? '#2563eb' : '#475569',
            cursor: 'pointer', fontFamily: 'Inter, system-ui',
          }}>{label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8', fontFamily: 'Inter, system-ui', alignSelf: 'center' }}>
          click column header to sort
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Inter, system-ui' }}>
          <thead>
            <tr>
              {headerCell('src_service', 'Connection', 'left')}
              {headerCell('p50_us', 'P50', 'right', 70)}
              {headerCell('p95_us', 'P95', 'right', 70)}
              {headerCell('p99_us', 'P99', 'right', 80)}
              <th style={hStyle('Trend', 'center', 90)}>Trend</th>
              {headerCell('retransmit_count', 'Retrans', 'right', 60)}
              <th style={hStyle('Dst Resources', 'left', 130)}>Dst Resources</th>
              <th style={hStyle('Status', 'center', 90)}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 12 }}>
                No connections match this filter
              </td></tr>
            )}
            {rows.map(snap => {
              const status = vLatencyStatus(snap.p99_us);
              const color  = V_STATUS_COLOR[status];
              const sel    = selectedKey === snap.key;
              const cause  = snap.cause_kind ? V_CAUSE_META[snap.cause_kind] : null;
              const sparkVals = (snap.history || []).slice(-30).map(p => p.p99_us);

              return (
                <tr key={snap.key}
                  onClick={() => onSelect(snap.key)}
                  style={{
                    background: sel ? '#eff6ff' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                    borderLeft: sel ? '3px solid #2563eb' : '3px solid transparent',
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Connection */}
                  <td style={tdStyle()}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {snap.is_spike && (
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#dc2626', boxShadow: '0 0 5px #dc262688', flexShrink: 0 }} />
                      )}
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#0f172a', fontWeight: 500 }}>
                        {snap.src_service}
                      </span>
                      <svg width={12} height={8} viewBox="0 0 12 8" style={{ flexShrink: 0 }}>
                        <path d="M1 4 H9 M7 1 L10 4 L7 7" stroke="#94a3b8" strokeWidth={1.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#0f172a', fontWeight: 500 }}>
                        {snap.dst_service}
                      </span>
                      {snap.dst_type === 'external' && (
                        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 8, background: '#f1f5f9', color: '#64748b', fontWeight: 600, fontFamily: 'Inter, system-ui' }}>EXT</span>
                      )}
                    </div>
                  </td>
                  {/* P50 */}
                  <td style={tdStyle('right')}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#475569' }}>{vFmtUs(snap.p50_us)}</span>
                  </td>
                  {/* P95 */}
                  <td style={tdStyle('right')}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#475569' }}>{vFmtUs(snap.p95_us)}</span>
                  </td>
                  {/* P99 */}
                  <td style={tdStyle('right')}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color, fontWeight: 600 }}>{vFmtUs(snap.p99_us)}</span>
                  </td>
                  {/* Sparkline */}
                  <td style={tdStyle('center')}>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <MiniSpark values={sparkVals} color={color} width={70} height={20} />
                    </div>
                  </td>
                  {/* Retrans */}
                  <td style={tdStyle('right')}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: snap.retransmit_count > 10 ? '#ea580c' : '#94a3b8' }}>
                      {snap.retransmit_count}
                    </span>
                  </td>
                  {/* Dst Resources */}
                  <td style={tdStyle()}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {[
                        { lbl: 'CPU', val: snap.dst_cpu_pct,          c: '#dc2626' },
                        { lbl: 'IO',  val: snap.dst_io_wait_pct,      c: '#7c3aed' },
                        { lbl: 'MEM', val: snap.dst_mem_pressure_pct, c: '#ea580c' },
                      ].map(m => {
                        const hot = m.val > 70 || (m.lbl === 'IO' && m.val > 30);
                        return (
                          <div key={m.lbl} title={`${m.lbl} ${m.val.toFixed(0)}%`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 600 }}>{m.lbl}</span>
                            <div style={{ width: 26, height: 5, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{
                                width: `${Math.min(100, m.val)}%`, height: '100%',
                                background: hot ? m.c : '#cbd5e1',
                              }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  {/* Status */}
                  <td style={tdStyle('center')}>
                    {snap.is_spike && cause ? (
                      <span style={{
                        fontSize: 9, padding: '2px 7px', borderRadius: 10,
                        background: `${cause.color}14`, border: `1px solid ${cause.color}40`,
                        color: cause.color, fontWeight: 600,
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}>
                        <span>{cause.icon}</span>{cause.label}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 9, padding: '2px 7px', borderRadius: 10,
                        background: V_STATUS_BG[status], color, fontWeight: 600,
                      }}>
                        {status}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hStyle(label, align = 'left', width) {
  return {
    padding: '7px 10px', fontSize: 10, color: '#475569',
    textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700,
    textAlign: align, background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 1, width,
    fontFamily: 'Inter, system-ui',
  };
}

function tdStyle(align = 'left') {
  return {
    padding: '8px 10px',
    borderBottom: '1px solid #f1f5f9',
    textAlign: align,
    verticalAlign: 'middle',
  };
}

/* ─── Heatmap Matrix View ─── */
function HeatmapMatrixView({ snapshots, services, selectedKey, onSelect }) {
  // Get all services involved, ordered (internal first, then external)
  const allSnaps = Object.values(snapshots);
  const internal = new Set();
  const external = new Set();
  allSnaps.forEach(s => {
    if (s.src_type === 'internal') internal.add(s.src_service); else external.add(s.src_service);
    if (s.dst_type === 'internal') internal.add(s.dst_service); else external.add(s.dst_service);
  });

  const sources = [...internal, ...external].sort();
  const targets = [...internal, ...external].sort();

  // Build lookup
  const connByPair = {};
  allSnaps.forEach(s => { connByPair[`${s.src_service}|${s.dst_service}`] = s; });

  const labelW   = 110;
  const labelH   = 84;
  const cellSize = 30;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#ffffff' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'Inter, system-ui', fontWeight: 600 }}>
          Adjacency matrix — row=source, column=destination, color=P99
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {[['ok','<5ms'],['warning','5–20'],['high','20–100ms'],['critical','>100ms']].map(([s, l]) => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 12, height: 12, background: V_STATUS_COLOR[s], borderRadius: 2 }} />
              <span style={{ fontSize: 10, color: '#64748b' }}>{l}</span>
            </span>
          ))}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: 14 }}>
        <div style={{ display: 'inline-block' }}>
          <div style={{ display: 'flex' }}>
            <div style={{ width: labelW, height: labelH }} />
            {targets.map(dst => {
              const stressedDst = services?.[dst]?.stress_kind;
              return (
                <div key={dst} style={{
                  width: cellSize, height: labelH,
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                  position: 'relative',
                }}>
                  <div style={{
                    transform: 'rotate(-55deg)', transformOrigin: 'left bottom',
                    position: 'absolute', bottom: 6, left: '50%',
                    fontSize: 10, color: stressedDst ? '#dc2626' : '#475569',
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'nowrap', fontWeight: stressedDst ? 600 : 500,
                  }}>
                    {dst}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {sources.map(src => {
            const stressedSrc = services?.[src]?.stress_kind;
            return (
              <div key={src} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  width: labelW, height: cellSize, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  paddingRight: 10, fontSize: 11, color: stressedSrc ? '#dc2626' : '#0f172a',
                  fontFamily: "'JetBrains Mono', monospace", fontWeight: stressedSrc ? 600 : 500,
                }}>
                  {src}
                </div>
                {targets.map(dst => {
                  const snap = connByPair[`${src}|${dst}`];
                  if (!snap) {
                    return (
                      <div key={dst} style={{
                        width: cellSize, height: cellSize, margin: 1,
                        background: '#f8fafc',
                        border: '1px solid #f1f5f9',
                        borderRadius: 3,
                      }} />
                    );
                  }
                  const status = vLatencyStatus(snap.p99_us);
                  const color  = V_STATUS_COLOR[status];
                  const sel    = selectedKey === snap.key;
                  return (
                    <div key={dst}
                      onClick={() => onSelect(snap.key)}
                      title={`${src} → ${dst}\nP99 ${vFmtUs(snap.p99_us)} · ${snap.is_spike ? 'SPIKE' : status}`}
                      style={{
                        width: cellSize, height: cellSize, margin: 1,
                        background: color,
                        border: sel ? '2px solid #0f172a' : (snap.is_spike ? '2px solid #dc2626' : '1px solid transparent'),
                        borderRadius: 3,
                        cursor: 'pointer',
                        position: 'relative',
                        animation: snap.is_spike ? 'matrixPulse 1.2s infinite' : 'none',
                        boxShadow: sel ? '0 0 0 2px #2563eb55' : 'none',
                      }}
                    >
                      {snap.is_spike && (
                        <div style={{
                          position: 'absolute', top: 2, right: 2,
                          width: 6, height: 6, borderRadius: '50%',
                          background: '#ffffff',
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── ViewSwitcher tab bar ─── */
function ViewSwitcher({ value, onChange }) {
  const tabs = [
    { v: 'graph',   label: 'Graph',   icon: (
      <svg width={12} height={12} viewBox="0 0 12 12"><circle cx={3} cy={3} r={2} fill="currentColor"/><circle cx={9} cy={6} r={2} fill="currentColor"/><circle cx={3} cy={9} r={2} fill="currentColor"/><line x1={3} y1={3} x2={9} y2={6} stroke="currentColor" strokeWidth={1}/><line x1={9} y1={6} x2={3} y2={9} stroke="currentColor" strokeWidth={1}/></svg>
    )},
    { v: 'list',    label: 'List',    icon: (
      <svg width={12} height={12} viewBox="0 0 12 12"><line x1={2} y1={3} x2={10} y2={3} stroke="currentColor" strokeWidth={1.5}/><line x1={2} y1={6} x2={10} y2={6} stroke="currentColor" strokeWidth={1.5}/><line x1={2} y1={9} x2={10} y2={9} stroke="currentColor" strokeWidth={1.5}/></svg>
    )},
    { v: 'matrix',  label: 'Matrix',  icon: (
      <svg width={12} height={12} viewBox="0 0 12 12"><rect x={1} y={1} width={3} height={3} fill="currentColor"/><rect x={5} y={1} width={3} height={3} fill="currentColor" opacity={0.5}/><rect x={9} y={1} width={3} height={3} fill="currentColor" opacity={0.3}/><rect x={1} y={5} width={3} height={3} fill="currentColor" opacity={0.5}/><rect x={5} y={5} width={3} height={3} fill="currentColor"/><rect x={9} y={5} width={3} height={3} fill="currentColor" opacity={0.5}/><rect x={1} y={9} width={3} height={3} fill="currentColor" opacity={0.3}/><rect x={5} y={9} width={3} height={3} fill="currentColor" opacity={0.5}/><rect x={9} y={9} width={3} height={3} fill="currentColor"/></svg>
    )},
  ];
  return (
    <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 6, padding: 2, gap: 0 }}>
      {tabs.map(t => (
        <button key={t.v} onClick={() => onChange(t.v)} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 4,
          border: 'none',
          background: value === t.v ? '#ffffff' : 'transparent',
          color: value === t.v ? '#0f172a' : '#64748b',
          fontSize: 10, fontWeight: 600, fontFamily: 'Inter, system-ui',
          cursor: 'pointer', boxShadow: value === t.v ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
          transition: 'all 0.15s',
        }}>
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

Object.assign(window, { ConnectionListView, HeatmapMatrixView, ViewSwitcher });
