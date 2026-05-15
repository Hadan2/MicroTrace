import type { CauseKind } from '../types'

export const CAUSE_META: Record<CauseKind, { label: string; color: string; icon: string; desc: string }> = {
  network:  { label: 'Network',      color: '#2563eb', icon: '🌐', desc: 'TCP/네트워크 지연 또는 재전송' },
  cpu:      { label: 'CPU',          color: '#dc2626', icon: '🔥', desc: 'CPU throttling 또는 포화' },
  io:       { label: 'Disk I/O',     color: '#7c3aed', icon: '💾', desc: 'I/O wait 대기 시간 증가' },
  memory:   { label: 'Memory',       color: '#ea580c', icon: '🧠', desc: 'Memory pressure 발생' },
  external: { label: 'External API', color: '#d97706', icon: '🔌', desc: '외부 의존성 지연' },
}
