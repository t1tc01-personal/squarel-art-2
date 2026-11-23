import { useCallback, useEffect, useState } from 'react'
import type { SetupInfo } from '../shared/ipc'
import { api } from './api'
import { DataProvider, report, TasksProvider, Toasts, useData } from './app-context'
import { AppRail } from './layout/AppRail'
import { ConnectionsPanel } from './layout/ConnectionsPanel'
import { TitleBar } from './layout/TitleBar'
import { NavProvider, useNav } from './nav'
import { Home } from './pages/Home'
import { Integration } from './pages/Integration'
import { Library } from './pages/Library'
import { ProjectDetail } from './pages/ProjectDetail'
import { ProjectNew } from './pages/ProjectNew'
import { Projects } from './pages/Projects'
import { Settings } from './pages/Settings'
import { System } from './pages/System'
import { Wizard } from './setup/Wizard'

function CurrentPage() {
  const { page } = useNav()
  if (page === 'home') return <Home />
  if (page === 'projects') return <Projects />
  if (page === 'project-new') return <ProjectNew />
  if (page === 'library') return <Library />
  if (page === 'settings') return <Settings />
  if ('project' in page) return <ProjectDetail key={page.project} id={page.project} tab={page.tab} />
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

/**
 * The first-run wizard while setup is not done (or a required component went missing), the app
 * shell otherwise. Main decides through setup:info; if that fails the shell is shown.
 */
function Root() {
  const { state } = useData()
  const [setup, setSetup] = useState<SetupInfo | 'failed' | null>(null)
  const reload = useCallback(async (refresh = false) => {
    try {
      setSetup(await api.setupInfo({ refresh }))
    } catch (e) {
      report('setup:info')(e)
      setSetup('failed')
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  if (setup === null)
    return (
      <div className="shell">
        <TitleBar />
      </div>
    )
  if (setup !== 'failed' && setup.step !== 'done')
    return <Wizard info={setup} state={state} reload={reload} />
  return <Shell />
}

export function App() {
  return (
    <NavProvider>
      <DataProvider>
        <TasksProvider>
          <Root />
        </TasksProvider>
      </DataProvider>
    </NavProvider>
  )
}
