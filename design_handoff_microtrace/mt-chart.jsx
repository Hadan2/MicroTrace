// mt-chart.jsx — Light theme dual chart (latency + correlated resources)
// Exports: LatencyChart, ResourceChart, Sparkline

const { useRef: cUseRef, useEffect: cUseEffect } = React;

const CHART_COLORS = {
  bg:        '#ffffff',
  grid:      '#f1f5f9',
  axis:      '#94a3b8',
  border:    '#e2e8f0',
  p50:       '#16a34a',
  p95:       '#d97706',
  p99:       '#ea580c',
  avg:       '#2563eb',
  spike:     '#dc2626',
  band:      'rgba(37,99,235,0.08)',
  cpu:       '#dc2626',
  io:        '#7c3aed',
  mem:       '#ea580c',
  throttle:  '#f59e0b',
};

function fmtYLabel(us) {
  if (us >= 1_000_000) return `${(us/1_000_000).toFixed(1)}s`;
  if (us >= 1000)      return `${(us/1000).toFixed(us>=10_000?0:1)}ms`;
  return `${Math.round(us)}µs`;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (W <= 0 || H <= 0) return null;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, W, H };
}

function drawLatency(canvas, history, isSpike) {
  if (!canvas || history.length < 2) return;
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, W, H } = setup;

  const PAD = { top: 10, right: 14, bottom: 22, left: 56 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top  - PAD.bottom;

  ctx.fillStyle = CHART_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const pts = history.slice(-180);
  const tMin = pts[0].time, tMax = pts[pts.length - 1].time;
  const tRange = Math.max(tMax - tMin, 1);

  const allVals = pts.flatMap(p => [p.avg_us, p.p50_us, p.p95_us, p.p99_us]);
  let yMax = Math.max(...allVals) * 1.15;
  let yMin = Math.max(0, Math.min(...allVals) * 0.85);
  if (yMax - yMin < 500) { yMax += 500; yMin = Math.max(0, yMin - 200); }
  const yRange = yMax - yMin || 1;

  const toX = t => PAD.left + (t - tMin) / tRange * cw;
  const toY = v => PAD.top  + (1 - (v - yMin) / yRange) * ch;

  // Grid
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const v = yMin + (yRange / ySteps) * i;
    const y = toY(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cw, y); ctx.stroke();
    ctx.fillStyle = CHART_COLORS.axis;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(fmtYLabel(v), PAD.left - 6, y + 3);
  }

  // Spike background band
  if (isSpike) {
    ctx.fillStyle = 'rgba(220,38,38,0.04)';
    ctx.fillRect(PAD.left + cw * 0.82, PAD.top, cw * 0.18, ch);
  }

  // Jitter band (P50 ± jitter/2)
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = toX(p.time), y = toY(p.p50_us + p.jitter_us * 0.5);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  [...pts].reverse().forEach(p => {
    const x = toX(p.time), y = toY(Math.max(yMin, p.p50_us - p.jitter_us * 0.5));
    ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = CHART_COLORS.band;
  ctx.fill();

  // Lines
  const lines = [
    { key: 'avg_us', color: CHART_COLORS.avg, dash: [4, 3], width: 1.2 },
    { key: 'p50_us', color: CHART_COLORS.p50, dash: [],     width: 1.8 },
    { key: 'p95_us', color: CHART_COLORS.p95, dash: [],     width: 1.8 },
    { key: 'p99_us', color: isSpike ? CHART_COLORS.spike : CHART_COLORS.p99, dash: [], width: 2.4 },
  ];
  lines.forEach(({ key, color, dash, width }) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    pts.forEach((p, i) => {
      const x = toX(p.time), y = toY(p[key]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // X-axis tick labels
  ctx.fillStyle = CHART_COLORS.axis;
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  [0, 0.5, 1].forEach(f => {
    ctx.fillText(fmtTime(tMin + f * tRange), toX(tMin + f * tRange), H - 6);
  });

  // Border
  ctx.strokeStyle = CHART_COLORS.border;
  ctx.strokeRect(PAD.left, PAD.top, cw, ch);
}

function drawResources(canvas, history, label) {
  if (!canvas || !history || history.length < 2) return;
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, W, H } = setup;

  const PAD = { top: 10, right: 14, bottom: 22, left: 56 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top  - PAD.bottom;

  ctx.fillStyle = CHART_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const pts = history.slice(-180);
  const tMin = pts[0].time, tMax = pts[pts.length - 1].time;
  const tRange = Math.max(tMax - tMin, 1);

  const yMin = 0, yMax = 100;
  const yRange = yMax - yMin;

  const toX = t => PAD.left + (t - tMin) / tRange * cw;
  const toY = v => PAD.top  + (1 - (v - yMin) / yRange) * ch;

  // 70% threshold guide
  ctx.strokeStyle = 'rgba(220,38,38,0.25)';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, toY(70)); ctx.lineTo(PAD.left + cw, toY(70));
  ctx.stroke();
  ctx.setLineDash([]);

  // Grid
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  [0, 50, 100].forEach(v => {
    const y = toY(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cw, y); ctx.stroke();
    ctx.fillStyle = CHART_COLORS.axis;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${v}%`, PAD.left - 6, y + 3);
  });

  const series = [
    { key: 'cpu_pct',          color: CHART_COLORS.cpu, width: 2 },
    { key: 'io_wait_pct',      color: CHART_COLORS.io,  width: 2 },
    { key: 'mem_pressure_pct', color: CHART_COLORS.mem, width: 2 },
  ];
  series.forEach(({ key, color, width }) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    pts.forEach((p, i) => {
      const x = toX(p.time), y = toY(p[key] || 0);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // X-axis labels
  ctx.fillStyle = CHART_COLORS.axis;
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  [0, 0.5, 1].forEach(f => {
    ctx.fillText(fmtTime(tMin + f * tRange), toX(tMin + f * tRange), H - 6);
  });

  // Label
  if (label) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 10px "Inter", system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(label, PAD.left + 4, PAD.top + 12);
  }

  ctx.strokeStyle = CHART_COLORS.border;
  ctx.strokeRect(PAD.left, PAD.top, cw, ch);
}

function LatencyChart({ history, isSpike }) {
  const ref = cUseRef(null);
  cUseEffect(() => { drawLatency(ref.current, history, isSpike); }, [history, isSpike]);
  cUseEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => drawLatency(el, history, isSpike));
    ro.observe(el.parentElement); return () => ro.disconnect();
  }, [history, isSpike]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

function ResourceChart({ history, label }) {
  const ref = cUseRef(null);
  cUseEffect(() => { drawResources(ref.current, history, label); }, [history, label]);
  cUseEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => drawResources(el, history, label));
    ro.observe(el.parentElement); return () => ro.disconnect();
  }, [history, label]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

function Sparkline({ values, color = '#16a34a', height = 28 }) {
  const ref = cUseRef(null);
  cUseEffect(() => {
    const canvas = ref.current; if (!canvas || values.length < 2) return;
    const setup = setupCanvas(canvas); if (!setup) return;
    const { ctx, W, H } = setup;
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [values, color]);
  return <canvas ref={ref} style={{ width: 60, height, display: 'block' }} />;
}

Object.assign(window, { LatencyChart, ResourceChart, Sparkline });
