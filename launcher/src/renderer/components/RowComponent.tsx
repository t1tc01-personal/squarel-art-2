import type { ActionRef, ComponentView } from '../../shared/model'
import { Button } from './Button'
import { ModelIcon } from './Icon'
import { StatusPill } from './StatusPill'

/** One row of the components table (System → Thành phần). */
export function RowComponent({
  component: c,
  onAction,
  primary,
}: {
  component: ComponentView
  onAction?(ref: ActionRef): void
  /** Show the main action as a primary button (e.g. the first row with an update). */
  primary?: boolean
}) {
  const action = c.actions.find((a) => a.kind === 'update' || a.kind === 'install' || a.kind === 'fix')
  const newer = !!c.version && !!c.latest && c.latest !== c.version
  return (
    <div className="row-comp">
      <span className="row-comp-icon">
        <ModelIcon icon={c.icon} iconKind={c.iconKind} size={16} />
      </span>
      <span className="row-comp-name">
        <span className="row-title">{c.name}</span>
        <span className="row-sub">{c.incompatible ?? c.description}</span>
      </span>
      <span className="row-comp-ver mono-value">{c.version ?? '–'}</span>
      <span className={`row-comp-ver mono-value${newer ? ' is-newer' : ' is-muted'}`}>{c.latest ?? '–'}</span>
      <span className="row-comp-status">
        <StatusPill level={c.level} label={c.levelLabel} />
      </span>
      <span className="row-comp-action">
        {action && (
          <Button
            type={primary ? 'primary' : action.kind === 'install' ? 'ghost' : 'secondary'}
            onClick={() => onAction?.(action)}
          >
            {action.label}
          </Button>
        )}
      </span>
    </div>
  )
}
