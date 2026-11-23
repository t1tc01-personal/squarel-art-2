import { DataProvider, TasksProvider, Toasts, useData } from './app-context'
import { AppRail } from './layout/AppRail'
import { ConnectionsPanel } from './layout/ConnectionsPanel'
import { TitleBar } from './layout/TitleBar'
import { NavProvider, useNav } from './nav'
import { Home } from './pages/Home'
import { Integration } from './pages/Integration'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'
import { System } from './pages/System'

function CurrentPage() {
  const { page } = useNav()
  if (page === 'home') return <Home />
  if (page === 'library') return <Library />
  if (page === 'settings') return <Settings />
  if ('integration' in page) return <Integration id={page.integration} tab={page.tab} />
  return <System tab={page.system} />
}

function Shell() {
  const { state, components, presence } = useData()
  const { page } = useNav()
  return (
    <div className="shell">
      <TitleBar />
      <div className="body">
        <AppRail components={components} selected={state?.selected ?? []} />
        <main className="content" data-page={typeof page === 'string' ? page : JSON.stringify(page)}>
          <CurrentPage />
          <Toasts />
        </main>
        <ConnectionsPanel groups={presence} components={components} selected={state?.selected ?? []} />
      </div>
    </div>
  )
}

export function App() {
  return (
    <NavProvider>
      <DataProvider>
        <TasksProvider>
          <Shell />
        </TasksProvider>
      </DataProvider>
    </NavProvider>
  )
}
