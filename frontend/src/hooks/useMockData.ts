import { useState, useEffect, useRef } from 'react'
import type { StatSnapshot, ServiceSnapshot, SpikeEvent, CauseKind, StressKind } from '../types'
import type { SnapshotMap, HistoryMap, HistoryPoint } from './useWebSocket'

export type ServiceMap = Record<string, ServiceSnapshot>

// ── 서비스 정의 ──────────────────────────────────────────────
const INTERNAL_SERVICES = ['api-gateway', 'auth-svc', 'order-svc', 'payment-svc', 'inventory-svc', 'notif-svc']
const EXTERNAL_SERVICES = ['postgres', 'redis', 'kafka', 'stripe-api']

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
]

// ── 내부 상태 타입 ─────────────────────────────────────────────
interface ServiceState {
  name: string
  cpu_pct: number
  io_wait_pct: number
  mem_pressure_pct: number
  cpu_throttle_pct: number
  stressKind: StressKind
  stressTimer: number
  history: ServiceSnapshot['history']
}

interface ConnState {
  src: string
  dst: string
  key: string
  baseMs: number
  noiseMs: number
  isSpike: boolean
  spikeTimer: number
  retransmitCount: number
  sampleCount: number
  closeStates: { fin: number; rst: number; timeout: number }
  history: { time: number; avg_us: number; p50_us: number; p95_us: number; p99_us: number; jitter_us: number }[]
  causeKind: CauseKind | null
}

// ── 유틸 ──────────────────────────────────────────────────────
const SAMPLES = 30
function rnd(lo: number, hi: number) { return lo + Math.random() * (hi - lo) }

function genPercs(state: ConnState) {
  const base  = state.isSpike ? state.baseMs * rnd(8, 25) : state.baseMs
  const noise = state.isSpike ? state.baseMs * 5          : state.noiseMs
  const arr = Array.from({ length: SAMPLES }, () =>
    Math.max(0.1, base + rnd(-noise * 0.8, noise * 1.2))
  ).sort((a, b) => a - b)
  const p = (pct: number) => arr[Math.max(0, Math.floor(pct / 100 * (arr.length - 1)))]
  const avg = arr.reduce((s, v) => s + v, 0) / arr.length
  return {
    avg_us:    avg   * 1000,
    p50_us:    p(50) * 1000,
    p95_us:    p(95) * 1000,
    p99_us:    p(99) * 1000,
    jitter_us: (p(75) - p(25)) * 1000,
  }
}

function classifyCause(state: ConnState, dstSvc: ServiceState): CauseKind {
  if (EXTERNAL_SERVICES.includes(state.dst) && state.baseMs > 30) return 'external'
  if (dstSvc.stressKind === 'cpu')    return 'cpu'
  if (dstSvc.stressKind === 'io')     return 'io'
  if (dstSvc.stressKind === 'memory') return 'memory'
  return 'network'
}

function tickService(s: ServiceState) {
  if (s.stressTimer > 0) {
    s.stressTimer--
    if (s.stressTimer === 0) s.stressKind = null
  } else if (Math.random() < 0.008) {
    const kinds: StressKind[] = ['cpu', 'io', 'memory']
    s.stressKind = kinds[Math.floor(Math.random() * 3)]
    s.stressTimer = Math.floor(rnd(5, 14))
  }

  let targetCpu = 15 + Math.random() * 25
  let targetIo  = 2  + Math.random() * 6
  let targetMem = 5  + Math.random() * 15
  let targetThrottle = 0

  if (s.stressKind === 'cpu')    { targetCpu = 85 + Math.random() * 14; targetThrottle = 20 + Math.random() * 60 }
  if (s.stressKind === 'io')     { targetIo  = 35 + Math.random() * 40 }
  if (s.stressKind === 'memory') { targetMem = 75 + Math.random() * 22; targetCpu = 50 + Math.random() * 30 }

  s.cpu_pct          += (targetCpu      - s.cpu_pct)          * 0.4
  s.io_wait_pct      += (targetIo       - s.io_wait_pct)      * 0.5
  s.mem_pressure_pct += (targetMem      - s.mem_pressure_pct) * 0.3
  s.cpu_throttle_pct += (targetThrottle - s.cpu_throttle_pct) * 0.5

  s.history = [...s.history.slice(-300), {
    time: Date.now(),
    cpu_pct: s.cpu_pct,
    io_wait_pct: s.io_wait_pct,
    mem_pressure_pct: s.mem_pressure_pct,
    cpu_throttle_pct: s.cpu_throttle_pct,
  }]
}

// ── 훅 ────────────────────────────────────────────────────────
export function useMockData() {
  const [snapshots, setSnapshots] = useState<SnapshotMap>({})
  const [services,  setServices]  = useState<ServiceMap>({})
  const [history,   setHistory]   = useState<HistoryMap>({})
  const [events,    setEvents]    = useState<SpikeEvent[]>([])

  // mutable ref로 관리 (매 tick마다 state 읽기 비용 없이)
  const serviceStateRef = useRef<Record<string, ServiceState>>({})
  const connStateRef    = useRef<Record<string, ConnState>>({})
  const allEventsRef    = useRef<SpikeEvent[]>([])
  const eventCounterRef = useRef(0)
  const initialized     = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // 서비스 상태 초기화
    ;[...INTERNAL_SERVICES, ...EXTERNAL_SERVICES].forEach(svc => {
      serviceStateRef.current[svc] = {
        name: svc,
        cpu_pct: 15 + Math.random() * 25,
        io_wait_pct: 2 + Math.random() * 6,
        mem_pressure_pct: 5 + Math.random() * 15,
        cpu_throttle_pct: 0,
        stressKind: null,
        stressTimer: 0,
        history: [],
      }
    })

    // 연결 상태 초기화
    CONN_DEFS.forEach(def => {
      const key = `${def.src}→${def.dst}`
      connStateRef.current[key] = {
        ...def, key,
        isSpike: false, spikeTimer: 0,
        retransmitCount: 0, sampleCount: 0,
        closeStates: { fin: 0, rst: 0, timeout: 0 },
        history: [],
        causeKind: null,
      }
    })

    const tick = () => {
      // 서비스 상태 업데이트
      Object.values(serviceStateRef.current).forEach(tickService)

      const nextSnapshots: SnapshotMap = {}
      const nextHistory: HistoryMap   = {}
      const newEvents: SpikeEvent[]   = []

      Object.values(connStateRef.current).forEach(state => {
        const wasSpike = state.isSpike
        const dstState = serviceStateRef.current[state.dst]
        const dstStressed = dstState?.stressKind !== null

        // 스파이크 상태 머신
        if (state.isSpike) {
          if (--state.spikeTimer <= 0) state.isSpike = false
        } else {
          const p = dstStressed ? 0.18 : 0.008
          if (Math.random() < p) {
            state.isSpike    = true
            state.spikeTimer = Math.floor(rnd(3, 8))
            state.retransmitCount += Math.floor(rnd(1, 5))
            const r = Math.random()
            if (r < 0.15) {
              const rr = Math.random()
              if      (rr < 0.33) state.closeStates.rst++
              else if (rr < 0.66) state.closeStates.timeout++
              else                state.closeStates.fin++
            } else {
              state.closeStates.fin++
            }
          }
        }

        const perc = genPercs(state)
        state.sampleCount += SAMPLES
        state.causeKind = state.isSpike ? classifyCause(state, dstState) : null

        const histPoint = { time: Date.now(), ...perc, latest_srtt_us: perc.avg_us }
        state.history = [...state.history.slice(-300), histPoint]

        const snap: StatSnapshot = {
          src_service: state.src,
          dst_service: state.dst,
          src_type: INTERNAL_SERVICES.includes(state.src) ? 'internal' : 'external',
          dst_type: INTERNAL_SERVICES.includes(state.dst) ? 'internal' : 'external',
          latest_srtt_us: perc.avg_us,
          ...perc,
          retransmit_count: state.retransmitCount,
          sample_count: state.sampleCount,
          is_spike: state.isSpike,
          spike_threshold_us: state.baseMs * 5 * 1000,
          cause_kind: state.causeKind ?? undefined,
          close_states: { ...state.closeStates },
          dst_cpu_pct:          dstState?.cpu_pct,
          dst_io_wait_pct:      dstState?.io_wait_pct,
          dst_mem_pressure_pct: dstState?.mem_pressure_pct,
          baseline_us: state.baseMs * 1000,
        }

        nextSnapshots[state.key] = snap

        // history용 포인트 배열 (최근 300개)
        nextHistory[state.key] = state.history.map(h => ({
          time: h.time,
          latest_srtt_us: h.avg_us,
          avg_us:  h.avg_us,
          p50_us:  h.p50_us,
          p95_us:  h.p95_us,
          p99_us:  h.p99_us,
          jitter_us: h.jitter_us,
        })) as HistoryPoint[]

        // 스파이크 이벤트 생성 (false → true 전환 시)
        if (state.isSpike && !wasSpike) {
          const ev: SpikeEvent = {
            id: `${state.key}-${Date.now()}-${++eventCounterRef.current}`,
            timestamp: Date.now(),
            key: state.key,
            src: state.src,
            dst: state.dst,
            p99_us: perc.p99_us,
            baseline_us: state.baseMs * 1000,
            severity: perc.p99_us > 80_000 ? 'critical' : 'warning',
            cause_kind: state.causeKind ?? 'network',
            dst_cpu_pct:          dstState?.cpu_pct ?? 0,
            dst_io_wait_pct:      dstState?.io_wait_pct ?? 0,
            dst_mem_pressure_pct: dstState?.mem_pressure_pct ?? 0,
          }
          newEvents.push(ev)
          allEventsRef.current = [ev, ...allEventsRef.current].slice(0, 100)
        }
      })

      // 서비스 맵 생성
      const nextServices: ServiceMap = {}
      Object.values(serviceStateRef.current).forEach(s => {
        nextServices[s.name] = {
          name: s.name,
          cpu_pct: s.cpu_pct,
          io_wait_pct: s.io_wait_pct,
          mem_pressure_pct: s.mem_pressure_pct,
          cpu_throttle_pct: s.cpu_throttle_pct,
          stress_kind: s.stressKind,
          history: s.history,
        }
      })

      setSnapshots(nextSnapshots)
      setHistory(nextHistory)
      setServices(nextServices)
      if (newEvents.length > 0) {
        setEvents([...allEventsRef.current])
      }
    }

    // 첫 tick 즉시 실행
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])

  return { snapshots, services, history, events, connected: true }
}
