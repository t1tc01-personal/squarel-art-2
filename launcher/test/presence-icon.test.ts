import { describe, expect, it } from 'vitest'
import { componentIcon } from '../src/renderer/presence-icon'
import type { ComponentView, PresenceItem } from '../src/shared/model'

const comp = (id: string, icon: string): ComponentView => ({
  id,
  name: id,
  description: '',
  kind: 'integration',
  icon,
  iconKind: 'data',
  required: false,
  installed: true,
  level: 'ok',
  levelLabel: '',
  actions: [],
})
const item = (componentId?: string): PresenceItem => ({
  id: `tool-${componentId}-bar-x`,
  title: 't',
  subtitle: '',
  status: 'online',
  icon: 'box',
  componentId,
})

describe('componentIcon', () => {
  it('matches the exact integration id, never a longer or shorter one', () => {
    const list = [comp('foo-bar', 'data:FOOBAR'), comp('foo', 'data:FOO')]
    expect(componentIcon(item('foo'), list)?.icon).toBe('data:FOO')
    expect(componentIcon(item('foo-bar'), list)?.icon).toBe('data:FOOBAR')
    expect(componentIcon(item('fo'), list)).toBeUndefined()
    expect(componentIcon(item(undefined), list)).toBeUndefined()
  })
})
