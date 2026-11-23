export interface SubTab<T extends string> {
  id: T
  label: string
}

/** Segmented tab bar; the active tab has a surface background and a yellow underline. */
export function SubTabs<T extends string>({
  tabs,
  active,
  badges = [],
  onSelect,
  label,
}: {
  tabs: readonly SubTab<T>[]
  active: T
  /** Tabs that need attention (red 6px dot). */
  badges?: readonly T[]
  onSelect?(id: T): void
  label?: string
}) {
  return (
    <div className="subtabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className={`subtab${t.id === active ? ' is-active' : ''}`}
          onClick={() => onSelect?.(t.id)}
        >
          {t.label}
          {badges.includes(t.id) && <span className="subtab-badge" role="img" aria-label="cần chú ý" />}
        </button>
      ))}
    </div>
  )
}
