/** Giao diện: the saved choice (state.theme) and the scheme the window is drawn in right now. */
import { useEffect, useState } from 'react'
import type { LauncherStateView } from '../shared/ipc'
import { api } from './api'
import { errorText, useData, useTasks } from './app-context'

export type Theme = NonNullable<LauncherStateView['theme']>

export const THEME_TABS: readonly { id: Theme; label: string }[] = [
  { id: 'system', label: 'Theo hệ thống' },
  { id: 'light', label: 'Sáng' },
  { id: 'dark', label: 'Tối' },
]

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** Main maps the setting to nativeTheme, so prefers-color-scheme already reflects it. */
function useIsLight(): boolean {
  const [light, setLight] = useState(() => window.matchMedia(LIGHT_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(LIGHT_QUERY)
    const on = () => setLight(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return light
}

export function useTheme(): { theme: Theme; isLight: boolean; setTheme(t: Theme): Promise<void> } {
  const { state, setState } = useData()
  const { notify } = useTasks()
  const isLight = useIsLight()
  const setTheme = async (theme: Theme) => {
    try {
      setState(await api.setState({ theme }))
    } catch (e) {
      notify({ label: 'Giao diện', kind: 'error', text: errorText(e) })
    }
  }
  return { theme: state?.theme ?? 'dark', isLight, setTheme }
}
