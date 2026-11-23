import type { ButtonHTMLAttributes, Ref } from 'react'
import { Icon, type IconName } from './Icon'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  ref?: Ref<HTMLButtonElement>
  type?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'lg'
  icon?: IconName
  /** HTML button type (the `type` prop is the Figma variant). */
  htmlType?: 'button' | 'submit'
}

export function Button({
  type = 'secondary',
  size = 'md',
  icon,
  htmlType = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={htmlType}
      className={`btn btn-${type} btn-${size}${className ? ` ${className}` : ''}`}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}
