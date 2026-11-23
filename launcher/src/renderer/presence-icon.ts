import type { ComponentView, PresenceItem } from '../shared/model'

/**
 * The integration icon (from components:list) for a presence row that names its component
 * (`componentId`, e.g. a bridge tool). Exact id match only: `foo` never takes `foo-bar`'s icon.
 */
export function componentIcon(
  item: PresenceItem,
  components: readonly ComponentView[],
): { icon: string; iconKind: 'name' | 'data' } | undefined {
  if (!item.componentId) return undefined
  const c = components.find((x) => x.kind === 'integration' && x.id === item.componentId)
  return c ? { icon: c.icon, iconKind: c.iconKind } : undefined
}
