import { useEffect, useId, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

export interface LaunchAction {
  id: string
  label: string
  icon?: IconName
  /** Right-aligned hint, e.g. "gần nhất". */
  hint?: string
  disabled?: boolean
  onSelect(): void
}

/** Big yellow launch button plus a ▾ button whose menu opens upwards. */
export function LaunchButton({
  label,
  actions,
  onLaunch,
  disabled,
}: {
  label: string
  actions: readonly LaunchAction[]
  onLaunch(): void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    wrap.current?.querySelector<HTMLButtonElement>('.launch-item:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="launch" ref={wrap}>
      <button type="button" className="launch-main" onClick={onLaunch} disabled={disabled}>
        <Icon name="play" size={20} />
        {label}
      </button>
      {actions.length > 0 && (
        <button
          type="button"
          className="launch-more"
          aria-label="Cách mở khác"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chevron" size={16} />
        </button>
      )}
      {open && (
        <div className="launch-menu" role="menu" id={menuId}>
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className="launch-item"
              disabled={a.disabled}
              onClick={() => {
                setOpen(false)
                a.onSelect()
              }}
            >
              <Icon name={a.icon ?? 'play'} size={16} />
              <span className="launch-item-label">{a.label}</span>
              {a.hint && <span className="launch-item-hint">{a.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
