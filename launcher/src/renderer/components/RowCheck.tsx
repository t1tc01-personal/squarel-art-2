import type { ActionRef, CheckResult } from '../../shared/model'
import { Button } from './Button'
import { Icon } from './Icon'

const ICON = { pass: 'check', warn: 'alert', fail: 'cross' } as const
const LABEL = { pass: 'Đạt', warn: 'Cảnh báo', fail: 'Lỗi' } as const

/** One health check: result tile, label + description, detail (mono) and an optional fix. */
export function RowCheck({ check, onFix }: { check: CheckResult; onFix?(ref: ActionRef): void }) {
  return (
    <div className={`row-check is-${check.result}`}>
      <span className="row-check-tile" role="img" aria-label={LABEL[check.result]}>
        <Icon name={ICON[check.result]} size={16} />
      </span>
      <span className="row-check-text">
        <span className="row-title">{check.label}</span>
        <span className="row-sub">{check.description}</span>
      </span>
      <span className="row-check-detail mono-small">{check.detail}</span>
      {check.fix && (
        <Button type="ghost" onClick={() => check.fix && onFix?.(check.fix)}>
          {check.fix.label}
        </Button>
      )}
    </div>
  )
}
