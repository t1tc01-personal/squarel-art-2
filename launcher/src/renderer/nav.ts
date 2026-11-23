/** In-app navigation: the current page lives in React state, shared through a context. */
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

export type IntegrationTab = 'overview' | 'updates' | 'health' | 'settings'
export type SystemTab = 'components' | 'health' | 'logs'
export type Page =
  | 'home'
  | 'library'
  | { integration: string; tab: IntegrationTab }
  | { system: SystemTab }
  | 'settings'

export interface Nav {
  page: Page
  go(p: Page): void
}

const NavContext = createContext<Nav | null>(null)

export function NavProvider({ initial = 'home', children }: { initial?: Page; children: ReactNode }) {
  const [page, setPage] = useState<Page>(initial)
  const go = useCallback((p: Page) => setPage(p), [])
  const value = useMemo(() => ({ page, go }), [page, go])
  return createElement(NavContext.Provider, { value }, children)
}

export function useNav(): Nav {
  const nav = useContext(NavContext)
  if (!nav) throw new Error('useNav must be used inside <NavProvider>')
  return nav
}

/** Which rail item a page belongs to: 'home' | 'library' | 'system' | 'settings' | `int:<id>`. */
export function railKey(p: Page): string {
  if (typeof p === 'string') return p
  if ('integration' in p) return `int:${p.integration}`
  return 'system'
}
