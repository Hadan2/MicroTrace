import type { ViewMode } from '../App'

interface Props {
  value: ViewMode
  onChange: (v: ViewMode) => void
}

const TABS: { value: ViewMode; label: string; icon: string }[] = [
  { value: 'graph',  label: 'Graph',  icon: 'M' },
  { value: 'list',   label: 'List',   icon: 'L' },
  { value: 'matrix', label: 'Matrix', icon: 'H' },
]

// 탭별 SVG 아이콘
function TabIcon({ type }: { type: string }) {
  if (type === 'M') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="2" r="1.5" fill="currentColor"/>
      <circle cx="2" cy="9" r="1.5" fill="currentColor"/>
      <circle cx="10" cy="9" r="1.5" fill="currentColor"/>
      <line x1="6" y1="3.5" x2="2" y2="7.5" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="6" y1="3.5" x2="10" y2="7.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
  if (type === 'L') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="2" width="10" height="2" rx="1" fill="currentColor" opacity="0.8"/>
      <rect x="1" y="5" width="10" height="2" rx="1" fill="currentColor" opacity="0.8"/>
      <rect x="1" y="8" width="10" height="2" rx="1" fill="currentColor" opacity="0.8"/>
    </svg>
  )
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="1" width="4" height="4" rx="1" fill="currentColor" opacity="0.6"/>
      <rect x="7" y="1" width="4" height="4" rx="1" fill="currentColor"/>
      <rect x="1" y="7" width="4" height="4" rx="1" fill="currentColor"/>
      <rect x="7" y="7" width="4" height="4" rx="1" fill="currentColor" opacity="0.6"/>
    </svg>
  )
}

export default function ViewSwitcher({ value, onChange }: Props) {
  return (
    <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
      {TABS.map(tab => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: 'var(--font-ui)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: active ? '#ffffff' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: active ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
              transition: 'all 0.12s',
            }}
          >
            <TabIcon type={tab.icon} />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
