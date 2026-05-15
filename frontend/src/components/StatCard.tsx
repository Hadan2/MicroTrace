interface Props {
  label: string
  value: string | number
  color?: string
  sub?: string
  highlight?: boolean
}

export default function StatCard({ label, value, color = 'var(--text-primary)', sub, highlight }: Props) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid var(--border)`,
      borderTop: highlight ? `2px solid ${color}` : `1px solid var(--border)`,
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 120,
      flex: '1 1 120px',
      boxShadow: highlight ? `0 1px 3px ${color}22` : 'var(--shadow-card)',
    }}>
      <div style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)', color, lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, fontWeight: 400, fontFamily: 'var(--font-ui)', color: 'var(--text-faint)', marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  )
}
