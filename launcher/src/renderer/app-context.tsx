/**
 * Data shared by the pages (state, components, presence, last health check) and the one way to
 * run an ActionRef: `open-settings` navigates here, actions with `needsConsent` show the command
 * first, everything else goes to `action:run` and its task events feed the toast.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ChecksSnapshot, LauncherStateView } from '../shared/ipc'
import type { ActionRef, ComponentView, PresenceGroup, TaskEvent } from '../shared/model'
import { api } from './api'
import { Button } from './components/Button'
import { useNav } from './nav'

export interface LauncherData {
  state: LauncherStateView | null
  components: ComponentView[]
  presence: PresenceGroup[]
  checks: ChecksSnapshot | null
  setChecks(s: ChecksSnapshot): void
  setState(s: LauncherStateView): void
  refresh(): void
}

export interface Toast {
  id: string
  label: string
  kind: 'running' | 'done' | 'error'
  text?: string
}

interface Tasks {
  /** Runs an action; resolves with the task id, or undefined when nothing was started. */
  run(ref: ActionRef): Promise<string | undefined>
  /** Starts a task through another call (e.g. updates:apply) and follows it like `run`. */
  track(label: string, start: () => Promise<string>): Promise<string | undefined>
  /** Last event per task started from this window. */
  last: Record<string, TaskEvent>
  toasts: Toast[]
  dismiss(id: string): void
  /** Shows a message without a task (e.g. a refused IPC call). */
  notify(t: Omit<Toast, 'id'>): void
}

const DataContext = createContext<LauncherData | null>(null)
const TasksContext = createContext<Tasks | null>(null)

export function report(what: string) {
  return (e: unknown) => console.error(`[launcher] ${what} failed:`, (e as Error)?.message ?? e)
}

/** Message of an IPC rejection without Electron's "Error invoking remote method" prefix. */
export function errorText(e: unknown): string {
  const m = String((e as Error)?.message ?? e)
  return m.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LauncherStateView | null>(null)
  const [components, setComponents] = useState<ComponentView[]>([])
  const [presence, setPresence] = useState<PresenceGroup[]>([])
  const [checks, setChecks] = useState<ChecksSnapshot | null>(null)

  const refresh = useCallback(() => {
    api.getState().then(setState, report('state:get'))
    api.listComponents().then(setComponents, report('components:list'))
  }, [])

  useEffect(() => {
    let alive = true
    refresh()
    api.getPresence().then((p) => alive && setPresence(p), report('presence:get'))
    api.lastChecks().then((c) => alive && c && setChecks(c), report('checks:last'))
    const offComponents = api.onComponentsChanged(refresh)
    const offPresence = api.onPresenceChanged((p) => setPresence(p))
    const offChecks = api.onChecksChanged((c) => setChecks(c))
    return () => {
      alive = false
      offComponents()
      offPresence()
      offChecks()
    }
  }, [refresh])

  const value = useMemo(
    () => ({ state, components, presence, checks, setChecks, setState, refresh }),
    [state, components, presence, checks, refresh],
  )
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): LauncherData {
  const v = useContext(DataContext)
  if (!v) throw new Error('useData must be used inside <DataProvider>')
  return v
}

export function TasksProvider({ children }: { children: ReactNode }) {
  const { go } = useNav()
  const [last, setLast] = useState<Record<string, TaskEvent>>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const [consent, setConsent] = useState<{ ref: ActionRef; resolve(ok: boolean): void } | null>(null)
  const labels = useRef(new Map<string, string>())
  /** Finished tasks, also those that finished before action:run returned their id. */
  const finished = useRef(new Map<string, TaskEvent>())
  const seq = useRef(0)

  useEffect(
    () =>
      api.onTaskEvent((e) => {
        setLast((l) => ({ ...l, [e.taskId]: e }))
        if (e.kind === 'done' || e.kind === 'error') finished.current.set(e.taskId, e)
        const label = labels.current.get(e.taskId)
        if (!label) return
        setToasts((ts) =>
          ts.map((t) =>
            t.id !== e.taskId
              ? t
              : e.kind === 'done'
                ? { ...t, kind: 'done', text: e.text ?? 'Xong' }
                : e.kind === 'error'
                  ? { ...t, kind: 'error', text: e.text ?? 'Thất bại' }
                  : {
                      ...t,
                      text:
                        e.kind === 'progress' && e.percent !== undefined
                          ? `${e.text ? `${e.text} · ` : ''}${Math.round(e.percent)}%`
                          : (e.text ?? t.text),
                    },
          ),
        )
      }),
    [],
  )

  const notify = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `note#${++seq.current}`
    setToasts((ts) => [...ts.slice(-2), { ...t, id }])
  }, [])

  const track = useCallback(
    async (label: string, start: () => Promise<string>): Promise<string | undefined> => {
      try {
        const taskId = await start()
        labels.current.set(taskId, label)
        const end = finished.current.get(taskId)
        const toast: Toast = !end
          ? { id: taskId, label, kind: 'running', text: 'Đang chạy…' }
          : end.kind === 'done'
            ? { id: taskId, label, kind: 'done', text: end.text ?? 'Xong' }
            : { id: taskId, label, kind: 'error', text: end.text ?? 'Thất bại' }
        setToasts((ts) => [...ts.slice(-2), toast])
        return taskId
      } catch (e) {
        notify({ label, kind: 'error', text: errorText(e) })
        return undefined
      }
    },
    [notify],
  )

  const run = useCallback(
    async (ref: ActionRef): Promise<string | undefined> => {
      if (ref.componentId === 'settings' && ref.kind === 'fix' && ref.id === 'open-settings') {
        go('settings')
        return undefined
      }
      if (ref.needsConsent) {
        const ok = await new Promise<boolean>((resolve) => setConsent({ ref, resolve }))
        setConsent(null)
        if (!ok) return undefined
      }
      return track(ref.label, () => api.runAction(ref))
    },
    [go, track],
  )

  const dismiss = useCallback((id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const value = useMemo(
    () => ({ run, track, last, toasts, dismiss, notify }),
    [run, track, last, toasts, dismiss, notify],
  )
  return (
    <TasksContext.Provider value={value}>
      {children}
      {consent && <ConsentDialog ref_={consent.ref} onAnswer={consent.resolve} />}
    </TasksContext.Provider>
  )
}

export function useTasks(): Tasks {
  const v = useContext(TasksContext)
  if (!v) throw new Error('useTasks must be used inside <TasksProvider>')
  return v
}

/** Shows the exact command (and size) before anything runs; "Cài"/"Chạy" or "Huỷ". */
function ConsentDialog({ ref_, onAnswer }: { ref_: ActionRef; onAnswer(ok: boolean): void }) {
  const confirm = useRef<HTMLButtonElement>(null)
  useEffect(() => confirm.current?.focus(), [])
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onAnswer(false)
        }}
      >
        <h2 id="consent-title" className="modal-title">
          {ref_.label}
        </h2>
        <p className="modal-text">
          {ref_.kind === 'terminal'
            ? 'Launcher mở một cửa sổ riêng và chạy lệnh sau. Nếu Windows hỏi quyền admin hay trình cài hỏi điều khoản, bạn tự đọc và trả lời trong cửa sổ đó:'
            : 'Launcher sẽ chạy lệnh sau:'}
        </p>
        <pre className="modal-command mono-small">{ref_.needsConsent?.command}</pre>
        {ref_.needsConsent?.sizeHint && (
          <p className="modal-text">Dung lượng ước tính: {ref_.needsConsent.sizeHint}</p>
        )}
        <div className="modal-actions">
          <Button type="ghost" onClick={() => onAnswer(false)}>
            Huỷ
          </Button>
          <Button type="primary" ref={confirm} onClick={() => onAnswer(true)}>
            {ref_.kind === 'install' ? 'Cài' : 'Chạy'}
          </Button>
        </div>
      </div>
    </div>
  )
}

const DONE_TOAST_MS = 5000

/** Bottom-right status of the actions started from this window; finished ones fade after 5 s. */
export function Toasts({ errorsOnly = false }: { errorsOnly?: boolean }) {
  const { toasts: all, dismiss } = useTasks()
  const toasts = errorsOnly ? all.filter((t) => t.kind === 'error') : all
  const doneIds = toasts
    .filter((t) => t.kind === 'done')
    .map((t) => t.id)
    .join('|')
  useEffect(() => {
    if (!doneIds) return
    const timer = setTimeout(() => {
      for (const id of doneIds.split('|')) dismiss(id)
    }, DONE_TOAST_MS)
    return () => clearTimeout(timer)
  }, [doneIds, dismiss])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-${t.kind}`} data-testid="toast">
          <div className="toast-body">
            <div className="toast-title">{t.label}</div>
            {t.text && <div className="toast-text">{t.text}</div>}
          </div>
          <button type="button" className="icon-btn" aria-label="Ẩn thông báo" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
