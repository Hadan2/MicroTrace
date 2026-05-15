export function fmtUs(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(1)}s`
  if (us >= 1000)      return `${(us / 1000).toFixed(us >= 10_000 ? 1 : 2)}ms`
  return `${Math.round(us)}µs`
}

export function fmtYLabel(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(1)}s`
  if (us >= 1000)      return `${(us / 1000).toFixed(us >= 10_000 ? 0 : 1)}ms`
  return `${Math.round(us)}µs`
}

export function fmtTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8)
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function latencyStatus(p99_us: number): 'ok' | 'warning' | 'high' | 'critical' {
  if (p99_us < 5_000)   return 'ok'
  if (p99_us < 20_000)  return 'warning'
  if (p99_us < 100_000) return 'high'
  return 'critical'
}

export const STATUS_COLOR = {
  ok:       '#16a34a',
  warning:  '#d97706',
  high:     '#ea580c',
  critical: '#dc2626',
} as const

export const STATUS_BG = {
  ok:       '#dcfce7',
  warning:  '#fef3c7',
  high:     '#fed7aa',
  critical: '#fee2e2',
} as const
