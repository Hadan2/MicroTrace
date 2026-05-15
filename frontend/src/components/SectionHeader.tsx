import type { ReactNode } from 'react'

interface Props {
  label: string
  count?: string | number
  children?: ReactNode
}

export default function SectionHeader({ label, count, children }: Props) {
  return (
    <div style={{
      height: 36,
      padding: '8px 16px',
      background: 'var(--bg-subtle)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0,
    }}>
      <span style={{ font: 'var(--font-ui)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>
        {label}
      </span>
      {count !== undefined && (
        <span style={{
          fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)',
          padding: '1px 8px', background: 'var(--bg-surface)',
          border: '1px solid var(--border)', borderRadius: 999,
          color: 'var(--text-muted)',
        }}>
          {count}
        </span>
      )}
      {children && <div style={{ marginLeft: 'auto' }}>{children}</div>}
    </div>
  )
}
