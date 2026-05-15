(function () {
  'use strict';

  const INTERNAL_SERVICES = ['api-gateway', 'auth-svc', 'order-svc', 'payment-svc', 'inventory-svc', 'notif-svc'];
  const EXTERNAL_SERVICES = ['postgres', 'redis', 'kafka', 'stripe-api'];

  const CONN_DEFS = [
    { src: 'api-gateway',  dst: 'auth-svc',      baseMs: 3,   noiseMs: 1.5 },
    { src: 'api-gateway',  dst: 'order-svc',      baseMs: 5,   noiseMs: 2   },
    { src: 'auth-svc',     dst: 'redis',          baseMs: 1.5, noiseMs: 0.5 },
    { src: 'order-svc',    dst: 'payment-svc',    baseMs: 8,   noiseMs: 3   },
    { src: 'order-svc',    dst: 'inventory-svc',  baseMs: 4,   noiseMs: 2   },
    { src: 'order-svc',    dst: 'notif-svc',      baseMs: 6,   noiseMs: 2   },
    { src: 'order-svc',    dst: 'postgres',       baseMs: 9,   noiseMs: 4   },
    { src: 'payment-svc',  dst: 'postgres',       baseMs: 12,  noiseMs: 5   },
    { src: 'payment-svc',  dst: 'stripe-api',     baseMs: 45,  noiseMs: 15  },
    { src: 'notif-svc',    dst: 'kafka',          baseMs: 3,   noiseMs: 1   },
  ];

  // Normalized positions (0..1)
  const NODE_POS = {
    'api-gateway':   { x: 0.50, y: 0.08 },
    'auth-svc':      { x: 0.18, y: 0.35 },
    'order-svc':     { x: 0.78, y: 0.35 },
    'redis':         { x: 0.05, y: 0.66 },
    'payment-svc':   { x: 0.50, y: 0.64 },
    'inventory-svc': { x: 0.95, y: 0.66 },
    'notif-svc':     { x: 0.78, y: 0.93 },
    'postgres':      { x: 0.28, y: 0.93 },
    'kafka':         { x: 0.96, y: 0.96 },
    'stripe-api':    { x: 0.52, y: 0.93 },
  };

  // Per-service resource state (CPU%, io_wait%, mem_pressure%)
  const serviceState = {};
  [...INTERNAL_SERVICES, ...EXTERNAL_SERVICES].forEach(svc => {
    serviceState[svc] = {
      name: svc,
      cpu_pct: 15 + Math.random() * 25,
      io_wait_pct: 2 + Math.random() * 6,
      mem_pressure_pct: 5 + Math.random() * 15,
      cpu_throttle_pct: 0,
      stressKind: null,      // null | 'cpu' | 'io' | 'memory'
      stressTimer: 0,
      history: [],
    };
  });

  // Per-connection state
  const connState = {};
  CONN_DEFS.forEach(def => {
    const key = `${def.src}→${def.dst}`;
    connState[key] = {
      ...def, key,
      isSpike: false, spikeTimer: 0,
      retransmitCount: 0, sampleCount: 0,
      closeStates: { fin: 0, rst: 0, timeout: 0 },
      history: [],
      causeKind: null, // network | cpu | io | external
    };
  });

  let allSpikeEvents = [];
  let eventCounter = 0;
  const SAMPLES = 30;

  function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }

  function classifyCause(state, dstSvc) {
    // Decision logic based on what's stressed
    const dstState = serviceState[dstSvc];
    if (!dstState) return 'network';
    if (EXTERNAL_SERVICES.includes(dstSvc) && state.baseMs > 30) return 'external';
    if (dstState.stressKind === 'cpu')    return 'cpu';
    if (dstState.stressKind === 'io')     return 'io';
    if (dstState.stressKind === 'memory') return 'memory';
    return 'network';
  }

  function genPercs(state) {
    const base  = state.isSpike ? state.baseMs * rnd(8, 25) : state.baseMs;
    const noise = state.isSpike ? state.baseMs * 5          : state.noiseMs;
    const arr = Array.from({ length: SAMPLES }, () =>
      Math.max(0.1, base + rnd(-noise * 0.8, noise * 1.2))
    ).sort((a, b) => a - b);
    const p = pct => arr[Math.max(0, Math.floor(pct / 100 * (arr.length - 1)))];
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    return {
      avg_us:    avg   * 1000,
      p50_us:    p(50) * 1000,
      p95_us:    p(95) * 1000,
      p99_us:    p(99) * 1000,
      jitter_us: (p(75) - p(25)) * 1000,
    };
  }

  function tickService(s) {
    // Resource stress state machine
    if (s.stressTimer > 0) {
      s.stressTimer--;
      if (s.stressTimer === 0) s.stressKind = null;
    } else if (Math.random() < 0.008) {
      s.stressKind = ['cpu', 'io', 'memory'][Math.floor(Math.random() * 3)];
      s.stressTimer = Math.floor(rnd(5, 14));
    }

    // Base levels
    let targetCpu = 15 + Math.random() * 25;
    let targetIo  = 2 + Math.random() * 6;
    let targetMem = 5 + Math.random() * 15;
    let targetThrottle = 0;

    if (s.stressKind === 'cpu')    { targetCpu = 85 + Math.random() * 14; targetThrottle = 20 + Math.random() * 60; }
    if (s.stressKind === 'io')     { targetIo  = 35 + Math.random() * 40; }
    if (s.stressKind === 'memory') { targetMem = 75 + Math.random() * 22; targetCpu = 50 + Math.random() * 30; }

    // Smooth toward target
    s.cpu_pct          += (targetCpu - s.cpu_pct) * 0.4;
    s.io_wait_pct      += (targetIo  - s.io_wait_pct) * 0.5;
    s.mem_pressure_pct += (targetMem - s.mem_pressure_pct) * 0.3;
    s.cpu_throttle_pct += (targetThrottle - s.cpu_throttle_pct) * 0.5;

    s.history = [...s.history.slice(-300), {
      time: Date.now(),
      cpu_pct: s.cpu_pct,
      io_wait_pct: s.io_wait_pct,
      mem_pressure_pct: s.mem_pressure_pct,
      cpu_throttle_pct: s.cpu_throttle_pct,
    }];
  }

  function tick() {
    // Update all services first
    Object.values(serviceState).forEach(tickService);

    const snapshots = {};
    const newEvents = [];

    Object.values(connState).forEach(state => {
      const wasSpike = state.isSpike;
      const dstStressed = serviceState[state.dst].stressKind !== null;

      // Spike state machine — more likely if dst is stressed
      if (state.isSpike) {
        if (--state.spikeTimer <= 0) state.isSpike = false;
      } else {
        const p = dstStressed ? 0.18 : 0.008;
        if (Math.random() < p) {
          state.isSpike    = true;
          state.spikeTimer = Math.floor(rnd(3, 8));
          state.retransmitCount += Math.floor(rnd(1, 5));
          if (Math.random() < 0.15) {
            const r = Math.random();
            if (r < 0.33) state.closeStates.rst++;
            else if (r < 0.66) state.closeStates.timeout++;
            else state.closeStates.fin++;
          } else {
            state.closeStates.fin++;
          }
        }
      }

      const perc = genPercs(state);
      state.sampleCount += SAMPLES;
      state.causeKind = state.isSpike ? classifyCause(state, state.dst) : null;

      const point = { time: Date.now(), ...perc };
      state.history = [...state.history.slice(-300), point];

      snapshots[state.key] = {
        key: state.key,
        src_service: state.src,
        dst_service: state.dst,
        src_type: INTERNAL_SERVICES.includes(state.src) ? 'internal' : 'external',
        dst_type: INTERNAL_SERVICES.includes(state.dst) ? 'internal' : 'external',
        ...perc,
        retransmit_count: state.retransmitCount,
        sample_count: state.sampleCount,
        is_spike: state.isSpike,
        spike_threshold_us: state.baseMs * 5 * 1000,
        history: state.history,
        cause_kind: state.causeKind,
        close_states: { ...state.closeStates },
        // Snapshot dst resource at this moment for correlation
        dst_cpu_pct: serviceState[state.dst].cpu_pct,
        dst_io_wait_pct: serviceState[state.dst].io_wait_pct,
        dst_mem_pressure_pct: serviceState[state.dst].mem_pressure_pct,
      };

      if (state.isSpike && !wasSpike) {
        const ev = {
          id: `${state.key}-${Date.now()}-${++eventCounter}`,
          timestamp: Date.now(),
          key: state.key,
          src: state.src,
          dst: state.dst,
          p99_us: perc.p99_us,
          baseline_us: state.baseMs * 1000,
          severity: perc.p99_us > 80000 ? 'critical' : 'warning',
          cause_kind: state.causeKind,
          dst_cpu_pct: serviceState[state.dst].cpu_pct,
          dst_io_wait_pct: serviceState[state.dst].io_wait_pct,
          dst_mem_pressure_pct: serviceState[state.dst].mem_pressure_pct,
        };
        newEvents.push(ev);
        allSpikeEvents = [ev, ...allSpikeEvents].slice(0, 100);
      }
    });

    // Build service-level snapshot
    const services = {};
    Object.values(serviceState).forEach(s => {
      services[s.name] = {
        name: s.name,
        cpu_pct: s.cpu_pct,
        io_wait_pct: s.io_wait_pct,
        mem_pressure_pct: s.mem_pressure_pct,
        cpu_throttle_pct: s.cpu_throttle_pct,
        stress_kind: s.stressKind,
        history: s.history,
      };
    });

    return { snapshots, services, newEvents, allEvents: [...allSpikeEvents] };
  }

  window.MTData = {
    tick,
    INTERNAL_SERVICES,
    EXTERNAL_SERVICES,
    CONN_DEFS,
    NODE_POS,
  };
})();
