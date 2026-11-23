import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
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
  const toggle = useRef<HTMLButtonElement>(null)

  /** Closes the menu; keyboard and item closes hand focus back to the ▾ toggle. */
  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) toggle.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(true)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    wrap.current?.querySelector<HTMLButtonElement>('.launch-item:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  /** Roving focus between enabled items: ArrowUp/ArrowDown wrap, Home/End jump; Tab closes. */
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      close(false)
      return
    }
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.launch-item:not(:disabled)')]
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | undefined
    if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length
    else if (e.key === 'ArrowUp') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next === undefined) return
    e.preventDefault()
    items[next]?.focus()
  }

  return (
    <div className="launch" ref={wrap}>
      <button type="button" className="launch-main" onClick={onLaunch} disabled={disabled}>
        <Icon name="play" size={20} />
        {label}
      </button>
      {actions.length > 0 && (
        <button
          ref={toggle}
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
        <div className="launch-menu" role="menu" id={menuId} tabIndex={-1} onKeyDown={onMenuKey}>
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="launch-item"
              disabled={a.disabled}
              onClick={() => {
                close(true)
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
