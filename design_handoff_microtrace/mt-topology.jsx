// mt-topology.jsx — Light theme SVG topology with resource badges
// Exports: TopoGraph

const { useRef, useEffect, useState } = React;

const STATUS_COLOR = {
  ok:       '#16a34a',
  warning:  '#d97706',
  high:     '#ea580c',
  critical: '#dc2626',
};

const CAUSE_COLOR = {
  network:  '#2563eb',
  cpu:      '#dc2626',
  io:       '#7c3aed',
  memory:   '#ea580c',
  external: '#d97706',
};

function latencyStatus(p99_us) {
  if (p99_us < 5000)   return 'ok';
  if (p99_us < 20000)  return 'warning';
  if (p99_us < 100000) return 'high';
  return 'critical';
}

function fmtUs(us) {
  return us >= 1000 ? `${(us / 1000).toFixed(1)}ms` : `${Math.round(us)}µs`;
}

// Service node — internal services show CPU/IO badges
function ServiceNode({ x, y, svcName, svc, isInternal, isSpike, isSel }) {
  const nw = isInternal ? 156 : 112;
  const nh = isInternal ? 56 : 36;
  const stressed = svc?.stress_kind;
  const stressColor = stressed === 'cpu' ? '#dc2626'
                    : stressed === 'io' ? '#7c3aed'
                    : stressed === 'memory' ? '#ea580c'
                    : null;

  const borderColor =
    isSel ? '#2563eb' :
    stressColor ? stressColor :
    isSpike ? '#dc2626' :
    isInternal ? '#cbd5e1' : '#cbd5e1';

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Stress halo for stressed services */}
      {stressColor && (
        <rect x={x - nw/2 - 4} y={y - nh/2 - 4} width={nw + 8} height={nh + 8} rx={11}
          fill="none" stroke={stressColor} strokeWidth={1.2} strokeDasharray="3,3" opacity={0.5}>
          <animate attributeName="opacity" values="0.7;0.25;0.7" dur="1.4s" repeatCount="indefinite" />
        </rect>
      )}
      {/* Spike halo */}
      {isSpike && !stressColor && (
        <rect x={x - nw/2 - 3} y={y - nh/2 - 3} width={nw + 6} height={nh + 6} rx={10}
          fill="none" stroke="#dc2626" strokeWidth={1.5}>
          <animate attributeName="opacity" values="1;0.3;1" dur="1.1s" repeatCount="indefinite" />
        </rect>
      )}

      {/* Box */}
      <rect x={x - nw/2} y={y - nh/2} width={nw} height={nh} rx={8}
        fill={isInternal ? '#ffffff' : '#f8fafc'}
        stroke={borderColor}
        strokeWidth={isSel ? 2 : 1}
        strokeDasharray={isInternal ? 'none' : '5,3'}
        filter={isInternal ? 'url(#node-shadow)' : undefined}
      />

      {/* Service name */}
      <text x={x} y={isInternal ? y - 10 : y + 4}
        textAnchor="middle"
        fontSize={isInternal ? 12 : 11}
        fill={isInternal ? '#0f172a' : '#64748b'}
        fontFamily="'Inter', system-ui, sans-serif"
        fontWeight={isInternal ? 600 : 500}>
        {svcName}
      </text>

      {/* Resource bars for internal services */}
      {isInternal && svc && (
        <g>
          {[
            { lbl: 'CPU',  val: svc.cpu_pct,          color: '#dc2626' },
            { lbl: 'IO',   val: svc.io_wait_pct,      color: '#7c3aed' },
            { lbl: 'MEM',  val: svc.mem_pressure_pct, color: '#ea580c' },
          ].map((m, i) => {
            const bx = x - nw/2 + 10 + i * 46;
            const by = y + 4;
            const w  = 36;
            const filled = Math.max(0, Math.min(1, m.val / 100)) * w;
            const hot = m.val > 70;
            return (
              <g key={m.lbl}>
                <text x={bx} y={by + 2} fontSize={8} fill="#94a3b8"
                  fontFamily="'Inter', system-ui" fontWeight={500}>{m.lbl}</text>
                {/* Bar bg */}
                <rect x={bx + 18} y={by - 4} width={w} height={6} rx={2} fill="#f1f5f9" />
                <rect x={bx + 18} y={by - 4} width={filled} height={6} rx={2}
                  fill={hot ? m.color : '#94a3b8'} opacity={hot ? 1 : 0.55} />
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}

function TopoGraph({ snapshots, services, selectedKey, onSelect }) {
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 700, h: 500 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const { NODE_POS, INTERNAL_SERVICES } = window.MTData;
  const { w, h } = dims;
  // Adaptive padding — internal nodes are 156×56, external 112×36
  const PX = Math.max(58, Math.min(92, w * 0.08));
  const PY = Math.max(36, Math.min(48, h * 0.08));

  function xy(svc) {
    const p = NODE_POS[svc] || { x: 0.5, y: 0.5 };
    return { x: PX + p.x * (w - PX * 2), y: PY + p.y * (h - PY * 2) };
  }

  const edges = Object.values(snapshots);
  const nodeSet = new Set();
  edges.forEach(s => { nodeSet.add(s.src_service); nodeSet.add(s.dst_service); });

  const nodeSpike = {};
  edges.forEach(s => {
    if (s.is_spike) { nodeSpike[s.src_service] = true; nodeSpike[s.dst_service] = true; }
  });
  const nodeSelected = {};
  edges.forEach(s => {
    if (selectedKey === s.key) { nodeSelected[s.src_service] = true; nodeSelected[s.dst_service] = true; }
  });

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg width={w} height={h} style={{ display: 'block' }} onClick={() => onSelect(null)}>
        <defs>
          {Object.entries(STATUS_COLOR).map(([name, color]) => (
            <marker key={name} id={`arr-${name}`} markerWidth="6" markerHeight="6" refX="5" refY="2.5" orient="auto">
              <path d="M0,0 L0,5 L6,2.5 z" fill={color} />
            </marker>
          ))}
          <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.08" />
          </filter>
          <filter id="topo-glow">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Subtle dot grid */}
          <pattern id="dotgrid" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="#e2e8f0" />
          </pattern>
        </defs>

        <rect width={w} height={h} fill="url(#dotgrid)" />

        {/* Edges */}
        {edges.map(snap => {
          const src = xy(snap.src_service);
          const dst = xy(snap.dst_service);
          const key = snap.key;
          const status = latencyStatus(snap.p99_us);
          const color = STATUS_COLOR[status];
          const sel = selectedKey === key;

          const mx = (src.x + dst.x) / 2;
          const my = (src.y + dst.y) / 2;
          const dx = dst.x - src.x, dy = dst.y - src.y;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          const cx = mx - (dy / len) * 26;
          const cy = my + (dx / len) * 26;
          const d = `M${src.x.toFixed(1)},${src.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${dst.x.toFixed(1)},${dst.y.toFixed(1)}`;

          const lx = 0.25 * src.x + 0.5 * cx + 0.25 * dst.x;
          const ly = 0.25 * src.y + 0.5 * cy + 0.25 * dst.y;

          return (
            <g key={key} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onSelect(key); }}>
              <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
              {sel && <path d={d} fill="none" stroke={color} strokeWidth={7} opacity={0.18} />}
              {snap.is_spike ? (
                <path d={d} fill="none" stroke={color} strokeWidth={sel ? 2.5 : 2}
                  strokeDasharray="7,4" markerEnd={`url(#arr-${status})`}
                  filter="url(#topo-glow)">
                  <animate attributeName="stroke-dashoffset" values="0;-22" dur="0.55s" repeatCount="indefinite" />
                </path>
              ) : (
                <path d={d} fill="none" stroke={color} strokeWidth={sel ? 2.4 : 1.6}
                  markerEnd={`url(#arr-${status})`} opacity={sel ? 1 : 0.75} />
              )}
              {/* Label pill */}
              <g>
                <rect x={lx - 26} y={ly - 19} width={52} height={15} rx={3}
                  fill="#ffffff" stroke={color} strokeWidth={0.8} opacity={sel ? 1 : 0.92} />
                <text x={lx} y={ly - 8} textAnchor="middle"
                  fontSize={10} fill={color}
                  fontFamily="'JetBrains Mono', monospace"
                  fontWeight={sel ? 600 : 500}>
                  {fmtUs(snap.p50_us)}
                </text>
              </g>
            </g>
          );
        })}

        {/* Nodes */}
        {[...nodeSet].map(svc => {
          const { x, y } = xy(svc);
          const isInternal = INTERNAL_SERVICES.includes(svc);
          return (
            <g key={svc}>
              <ServiceNode
                x={x} y={y} svcName={svc}
                svc={services?.[svc]}
                isInternal={isInternal}
                isSpike={!!nodeSpike[svc]}
                isSel={!!nodeSelected[svc]}
              />
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 10, left: 12,
        display: 'flex', gap: 14, flexWrap: 'wrap',
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid #e2e8f0', borderRadius: 6,
        padding: '6px 10px', pointerEvents: 'none',
      }}>
        {[['ok','<5ms'],['warning','5–20ms'],['high','20–100ms'],['critical','>100ms']].map(([s, label]) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 18, height: 2.5, background: STATUS_COLOR[s], borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'Inter, system-ui' }}>{label}</span>
          </div>
        ))}
        <div style={{ width: 1, background: '#e2e8f0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 14, height: 10, border: '1px dashed #cbd5e1', borderRadius: 2 }} />
          <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'Inter, system-ui' }}>external</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TopoGraph, STATUS_COLOR, CAUSE_COLOR });
