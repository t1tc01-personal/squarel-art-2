import { useEffect, useState } from 'react'
import type { LauncherStateView } from '../shared/ipc'
import type { ComponentView, PresenceGroup } from '../shared/model'
import { api } from './api'
import { AppRail } from './layout/AppRail'
import { ConnectionsPanel } from './layout/ConnectionsPanel'
import { TitleBar } from './layout/TitleBar'
import { NavProvider, type Page, useNav } from './nav'

/** State, components and presence from main, kept fresh through the push events. */
function useLauncherData() {
  const [state, setState] = useState<LauncherStateView | null>(null)
  const [components, setComponents] = useState<ComponentView[]>([])
  const [presence, setPresence] = useState<PresenceGroup[]>([])

  useEffect(() => {
    let alive = true
    const refresh = () => {
      api.getState().then((s) => alive && setState(s), report('state:get'))
      api.listComponents().then((c) => alive && setComponents(c), report('components:list'))
    }
    refresh()
    api.getPresence().then((p) => alive && setPresence(p), report('presence:get'))
    const offComponents = api.onComponentsChanged(refresh)
    const offPresence = api.onPresenceChanged((p) => setPresence(p))
    return () => {
      alive = false
      offComponents()
      offPresence()
    }
  }, [])

  return { state, components, presence }
}

function report(what: string) {
  return (e: unknown) => console.error(`[launcher] ${what} failed:`, (e as Error)?.message ?? e)
}

/** Page title for the placeholder content (the pages themselves arrive in Task 13). */
function pageTitle(page: Page, components: ComponentView[]): string {
  if (page === 'home') return 'Trang chủ'
  if (page === 'library') return 'Thư viện tích hợp'
  if (page === 'settings') return 'Cài đặt'
  if ('integration' in page)
    return components.find((c) => c.id === page.integration)?.name ?? page.integration
  return 'Hệ thống'
}

function Shell() {
  const { state, components, presence } = useLauncherData()
  const { page } = useNav()
  return (
    <div className="shell">
      <TitleBar />
      <div className="body">
        <AppRail components={components} selected={state?.selected ?? []} />
        <main className="content" data-page={typeof page === 'string' ? page : JSON.stringify(page)}>
          <h1 className="page-title">{pageTitle(page, components)}</h1>
        </main>
        <ConnectionsPanel groups={presence} components={components} />
      </div>
    </div>
  )
}

export function App() {
  return (
    <NavProvider>
      <Shell />
    </NavProvider>
  )
}
