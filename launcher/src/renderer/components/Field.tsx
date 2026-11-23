import { type InputHTMLAttributes, useId } from 'react'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  state?: 'default' | 'valid' | 'error'
  hint?: string
  /** Text action at the right edge of the input (e.g. "Mở", "Thêm"). */
  action?: { label: string; onClick(): void }
}

export function Field({ label, state = 'default', hint, action, className, ...input }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className={`field field-${state}${className ? ` ${className}` : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-box">
        <input
          {...input}
          id={id}
          className="field-input"
          aria-invalid={state === 'error' || undefined}
          aria-describedby={hintId}
        />
        {action && (
          <button type="button" className="field-action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      {hint && (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      )}
    </div>
  )
}
