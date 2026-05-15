// mt-panels.jsx — GlobalMetrics, CauseCandidates, DetailPanel, SpikeLog
// Exports all to window

const { useMemo: pUseMemo } = React;

const CAUSE_META = {
  network:  { label: 'Network',      color: '#2563eb', icon: '🌐', desc: 'TCP/네트워크 지연 또는 재전송' },
  cpu:      { label: 'CPU',          color: '#dc2626', icon: '🔥', desc: 'CPU throttling 또는 포화' },
  io:       { label: 'Disk I/O',     color: '#7c3aed', icon: '💾', desc: 'I/O wait 대기 시간 증가' },
  memory:   { label: 'Memory',       color: '#ea580c', icon: '🧠', desc: 'Memory pressure 발생' },
  external: { label: 'External API', color: '#d97706', icon: '🔌', desc: '외부 의존성 지연' },
};

function fmtUs(us) {
  return us >= 1000 ? `${(us / 1000).toFixed(us >= 10000 ? 1 : 2)}ms` : `${Math.round(us)}µs`;
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/* ─── StatCard ─── */
function StatCard({ label, value, sub, color, highlight, trend }) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderTop: highlight ? `2px solid ${color || '#2563eb'}` : '1px solid #e2e8f0',
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 120,
      flex: '1 1 120px',
      boxShadow: highlight ? `0 1px 3px ${color}22` : '0 1px 2px rgba(15,23,42,0.04)',
    }}>
      <div style={{
        fontSize: 9, color: '#64748b', fontFamily: 'Inter, system-ui',
        marginBottom: 3, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600,
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
        color: color || '#0f172a', lineHeight: 1.1,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, fontFamily: 'Inter, system-ui' }}>{sub}</div>}
    </div>
  );
}

/* ─── GlobalMetrics ─── */
function GlobalMetrics({ snapshots, services }) {
  const snaps = Object.values(snapshots);
  if (snaps.length === 0) return null;

  const avg = fn => snaps.reduce((s, x) => s + fn(x), 0) / snaps.length;
  const gp95 = avg(s => s.p95_us);
  const gp99 = avg(s => s.p99_us);
  const spikes = snaps.filter(s => s.is_spike).length;
  const retrans = snaps.reduce((s, x) => s + x.retransmit_count, 0);

  const svcArr = Object.values(services || {});
  const hotCpu = svcArr.filter(s => s.cpu_pct > 70).length;
  const hotIo  = svcArr.filter(s => s.io_wait_pct > 30).length;
  const hotMem = svcArr.filter(s => s.mem_pressure_pct > 70).length;
  const stressed = svcArr.filter(s => s.stress_kind).length;

  const p99Color = gp99 > 100000 ? '#dc2626' : gp99 > 20000 ? '#ea580c' : gp99 > 5000 ? '#d97706' : '#16a34a';

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '10px 14px',
      background: '#ffffff', borderBottom: '1px solid #e2e8f0',
      flexWrap: 'wrap',
    }}>
      <StatCard label="Global P95"     value={fmtUs(gp95)} color="#d97706" />
      <StatCard label="Global P99"     value={fmtUs(gp99)} color={p99Color} highlight={gp99 > 20000} />
      <StatCard label="Active Spikes"  value={spikes}      color={spikes ? '#dc2626' : '#94a3b8'} highlight={spikes > 0} sub={spikes ? 'analyzing causes…' : 'all normal'} />
      <StatCard label="Stressed Svcs"  value={stressed}    color={stressed ? '#ea580c' : '#94a3b8'} highlight={stressed > 0} sub={`CPU:${hotCpu} IO:${hotIo} MEM:${hotMem}`} />
      <StatCard label="Retransmits"    value={retrans}     color={retrans > 20 ? '#ea580c' : '#475569'} sub="cumulative" />
      <StatCard label="Connections"    value={snaps.length} color="#2563eb" sub={`${window.MTData.INTERNAL_SERVICES.length} svcs`} />
    </div>
  );
}

/* ─── Cause Candidate banner (in DetailPanel) ─── */
function CauseCandidate({ snap }) {
  if (!snap?.is_spike) return null;
  const cause = snap.cause_kind || 'network';
  const meta  = CAUSE_META[cause];
  const mult  = (snap.p99_us / (snap.spike_threshold_us / 5)).toFixed(1);

  // Build evidence chips
  const evidence = [];
  if (snap.dst_cpu_pct > 70)         evidence.push({ label: 'CPU', value: `${snap.dst_cpu_pct.toFixed(0)}%`, color: '#dc2626' });
  if (snap.dst_io_wait_pct > 30)     evidence.push({ label: 'IO wait', value: `${snap.dst_io_wait_pct.toFixed(0)}%`, color: '#7c3aed' });
  if (snap.dst_mem_pressure_pct > 70) evidence.push({ label: 'Mem', value: `${snap.dst_mem_pressure_pct.toFixed(0)}%`, color: '#ea580c' });
  if (snap.retransmit_count > 0)     evidence.push({ label: 'Retrans', value: snap.retransmit_count, color: '#2563eb' });

  return (
    <div style={{
      margin: '10px 14px 0',
      padding: '12px 14px',
      background: `linear-gradient(135deg, ${meta.color}0d, ${meta.color}05)`,
      border: `1px solid ${meta.color}40`,
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>{meta.icon}</span>
        <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Root cause candidate</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#dc2626', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{mult}× baseline</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: meta.color, fontFamily: 'Inter, system-ui', marginBottom: 2 }}>
        {meta.label}
      </div>
      <div style={{ fontSize: 11, color: '#475569', fontFamily: 'Inter, system-ui', marginBottom: evidence.length ? 8 : 0 }}>
        {meta.desc}
      </div>
      {evidence.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {evidence.map(e => (
            <span key={e.label} style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 12,
              background: '#ffffff', border: `1px solid ${e.color}40`,
              color: e.color, fontFamily: 'Inter, system-ui', fontWeight: 500,
            }}>
              {e.label}: <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── DetailPanel ─── */
function DetailPanel({ snap, dstService, onClose }) {
  if (!snap) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: 10, padding: 20 }}>
        <svg width={42} height={42} viewBox="0 0 42 42" fill="none">
          <path d="M5 21 Q21 5 37 21 Q21 37 5 21Z" stroke="#cbd5e1" strokeWidth={1.5} fill="none" />
          <circle cx={21} cy={21} r={4} fill="#cbd5e1" />
          <line x1={21} y1={3} x2={21} y2={9}  stroke="#cbd5e1" strokeWidth={1.2} />
          <line x1={21} y1={33} x2={21} y2={39} stroke="#cbd5e1" strokeWidth={1.2} />
        </svg>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#475569', fontFamily: 'Inter, system-ui', fontWeight: 500, marginBottom: 4 }}>
            연결을 선택하세요
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'Inter, system-ui' }}>
            토폴로지에서 엣지를 클릭하면 latency + 리소스 상관관계를 분석합니다
          </div>
        </div>
      </div>
    );
  }

  const p99Color = snap.p99_us > 100000 ? '#dc2626' : snap.p99_us > 20000 ? '#ea580c' : snap.p99_us > 5000 ? '#d97706' : '#16a34a';
  const closeTotal = snap.close_states.fin + snap.close_states.rst + snap.close_states.timeout;
  const errorRate = closeTotal ? ((snap.close_states.rst + snap.close_states.timeout) / closeTotal * 100) : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5, fontWeight: 600 }}>Connection</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#0f172a', fontWeight: 600 }}>{snap.src_service}</span>
            <svg width={14} height={10} viewBox="0 0 14 10" fill="none"><path d="M1 5 H12 M9 2 L12 5 L9 8" stroke="#94a3b8" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#0f172a', fontWeight: 600 }}>{snap.dst_service}</span>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer',
          fontSize: 18, lineHeight: 1, padding: 4, borderRadius: 4,
        }}>✕</button>
      </div>

      <CauseCandidate snap={snap} />

      {/* Percentile cards */}
      <div style={{ padding: '12px 14px 8px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        {[
          { l: 'AVG', v: snap.avg_us, c: '#2563eb' },
          { l: 'P50', v: snap.p50_us, c: '#16a34a' },
          { l: 'P95', v: snap.p95_us, c: '#d97706' },
          { l: 'P99', v: snap.p99_us, c: p99Color  },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 6px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{l}</div>
            <div style={{ fontSize: 16, fontFamily: "'JetBrains Mono', monospace", color: c, fontWeight: 600, marginTop: 3 }}>{fmtUs(v)}</div>
          </div>
        ))}
      </div>

      {/* Secondary metrics */}
      <div style={{ padding: '0 14px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
        {[
          { l: 'Jitter',      v: fmtUs(snap.jitter_us),  c: snap.jitter_us > 5000 ? '#dc2626' : snap.jitter_us > 1000 ? '#d97706' : '#475569' },
          { l: 'Retransmits', v: snap.retransmit_count,   c: snap.retransmit_count > 10 ? '#ea580c' : '#475569' },
          { l: 'Error Rate',  v: `${errorRate.toFixed(1)}%`, c: errorRate > 5 ? '#dc2626' : errorRate > 1 ? '#d97706' : '#475569' },
          { l: 'Samples',     v: snap.sample_count > 999 ? `${(snap.sample_count/1000).toFixed(1)}k` : snap.sample_count, c: '#475569' },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 9px' }}>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{l}</div>
            <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: c, marginTop: 2, fontWeight: 500 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Connection close breakdown */}
      {closeTotal > 0 && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 5 }}>
            Close states · {closeTotal} total
          </div>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f1f5f9' }}>
            {[
              { k: 'fin',     c: '#16a34a' },
              { k: 'rst',     c: '#dc2626' },
              { k: 'timeout', c: '#ea580c' },
            ].map(({ k, c }) => {
              const v = snap.close_states[k];
              if (!v) return null;
              return <div key={k} style={{ background: c, width: `${v/closeTotal*100}%` }} />;
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            {['fin','rst','timeout'].map(k => {
              const c = k === 'fin' ? '#16a34a' : k === 'rst' ? '#dc2626' : '#ea580c';
              return (
                <span key={k} style={{ fontSize: 10, color: '#64748b', fontFamily: 'Inter, system-ui', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: c }} />
                  {k.toUpperCase()} <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#0f172a' }}>{snap.close_states[k]}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '4px 14px 0' }} />

      {/* Latency chart */}
      <div style={{ padding: '8px 14px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Latency</span>
          <div style={{ display: 'flex', gap: 10 }}>
            {[['#2563eb','AVG','dashed'],['#16a34a','P50',''],['#d97706','P95',''],['#ea580c','P99','']].map(([c,l,d]) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width={14} height={6}>
                  <line x1={0} y1={3} x2={14} y2={3} stroke={c} strokeWidth={d?1.5:2} strokeDasharray={d?'4,3':''} />
                </svg>
                <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'Inter, system-ui', fontWeight: 500 }}>{l}</span>
              </span>
            ))}
          </div>
        </div>
        <div style={{ height: 140 }}>
          <window.LatencyChart history={snap.history || []} isSpike={snap.is_spike} />
        </div>
      </div>

      {/* Resource chart (correlated) */}
      <div style={{ padding: '4px 14px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            {snap.dst_service} · Resources
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            {[['#dc2626','CPU'],['#7c3aed','IO wait'],['#ea580c','Mem']].map(([c,l]) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width={14} height={6}><line x1={0} y1={3} x2={14} y2={3} stroke={c} strokeWidth={2} /></svg>
                <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'Inter, system-ui', fontWeight: 500 }}>{l}</span>
              </span>
            ))}
          </div>
        </div>
        <div style={{ height: 120 }}>
          <window.ResourceChart history={dstService?.history || []} />
        </div>
      </div>
    </div>
  );
}

/* ─── SpikeLog ─── */
function SpikeLog({ events }) {
  if (events.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 12, fontFamily: 'Inter, system-ui', gap: 8 }}>
        <span style={{ color: '#16a34a', fontSize: 12 }}>●</span>
        스파이크 이벤트 없음 — 모든 연결 정상
      </div>
    );
  }

  return (
    <div style={{ overflowY: 'auto', height: '100%', padding: '4px 0' }}>
      {events.map((ev, i) => {
        const isCrit = ev.severity === 'critical';
        const mult = (ev.p99_us / ev.baseline_us).toFixed(0);
        const cause = ev.cause_kind ? CAUSE_META[ev.cause_kind] : null;
        return (
          <div key={`${ev.id}-${i}`} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '7px 16px',
            borderBottom: '1px solid #f1f5f9',
            transition: 'background 0.15s',
            cursor: 'default',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
          onMouseLeave={e => e.currentTarget.style.background = ''}
          >
            <div style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: isCrit ? '#dc2626' : '#d97706',
              boxShadow: `0 0 5px ${isCrit ? '#dc2626' : '#d97706'}88`,
            }} />
            <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace", width: 72, flexShrink: 0 }}>
              {new Date(ev.timestamp).toTimeString().slice(0, 8)}
            </span>
            <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#0f172a', minWidth: 0 }}>
              {ev.src} <span style={{ color: '#94a3b8' }}>→</span> {ev.dst}
            </span>

            {cause && (
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 12,
                background: `${cause.color}14`, border: `1px solid ${cause.color}40`,
                color: cause.color, fontFamily: 'Inter, system-ui', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span>{cause.icon}</span>{cause.label}
              </span>
            )}

            <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: isCrit ? '#dc2626' : '#d97706', fontWeight: 600 }}>
              P99 {fmtUs(ev.p99_us)}
            </span>
            <span style={{
              fontSize: 9, padding: '2px 7px', borderRadius: 3,
              background: isCrit ? '#fee2e2' : '#fef3c7',
              color: isCrit ? '#dc2626' : '#d97706',
              fontFamily: 'Inter, system-ui', fontWeight: 600,
            }}>
              {mult}×
            </span>
            <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'Inter, system-ui', width: 56, textAlign: 'right', flexShrink: 0 }}>
              {timeAgo(ev.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { GlobalMetrics, DetailPanel, SpikeLog, CauseCandidate, StatCard, CAUSE_META });
