import type { Level } from '../../shared/model'

/** Small status label: soft background, 6px square dot, uppercase-free UI/Label text. */
export function StatusPill({ level, label }: { level: Level; label: string }) {
  return (
    <span className={`pill pill-${level}`} title={label}>
      <span className="pill-dot" aria-hidden="true" />
      <span className="pill-label">{label}</span>
    </span>
  )
}

/** Colour token of a level (dots, text). */
export function levelColor(level: Level): string {
  switch (level) {
    case 'ok':
      return 'var(--status-ok)'
    case 'warn':
      return 'var(--status-warn)'
    case 'error':
      return 'var(--status-error)'
    case 'running':
      return 'var(--accent-primary)'
    default:
      return 'var(--status-idle)'
  }
}
