/**
 * Every task event since the launcher window opened, so a page can show a task's progress and
 * log and can wait for it to finish (events of a fast task may arrive before `action:run` returns
 * its id). One instance lives in TasksProvider (`useTasks().log`).
 */
import { useEffect, useMemo, useState } from 'react'
import type { TaskEvent } from '../shared/model'
import { api } from './api'
import { type TaskTrack, trackEvent } from './progress'

export interface TaskLog {
  /** All events of a task, oldest first. */
  events(taskId: string | undefined): TaskEvent[]
  /** The last `done` / `error` event, if the task finished. */
  final(taskId: string | undefined): TaskEvent | undefined
  /** Latest progress percent, if the task reported one. */
  percent(taskId: string | undefined): number | undefined
  /** Resolves with the `done` / `error` event. */
  wait(taskId: string): Promise<TaskEvent>
  /** Step, percent and timing of a task, kept for its whole run (events are capped at 200). */
  track(taskId: string | undefined): TaskTrack | undefined
}

const isFinal = (e: TaskEvent) => e.kind === 'done' || e.kind === 'error'

export function useTaskLog(): TaskLog {
  const [store] = useState(() => ({
    events: new Map<string, TaskEvent[]>(),
    waiters: new Map<string, ((e: TaskEvent) => void)[]>(),
    tracks: new Map<string, TaskTrack>(),
  }))
  const [version, setVersion] = useState(0)

  useEffect(
    () =>
      api.onTaskEvent((e) => {
        const list = store.events.get(e.taskId) ?? []
        list.push(e)
        store.events.set(e.taskId, list.slice(-200))
        store.tracks.set(e.taskId, trackEvent(store.tracks.get(e.taskId), e, Date.now()))
        if (isFinal(e)) {
          for (const w of store.waiters.get(e.taskId) ?? []) w(e)
          store.waiters.delete(e.taskId)
        }
        setVersion((v) => v + 1)
      }),
    [store],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-creates the view on every event
  return useMemo(() => {
    const events = (id: string | undefined) => (id ? (store.events.get(id) ?? []) : [])
    const final = (id: string | undefined) => events(id).find(isFinal)
    return {
      events,
      final,
      percent: (id) =>
        events(id)
          .filter((e) => e.kind === 'progress' && e.percent !== undefined)
          .at(-1)?.percent,
      track: (id) => (id ? store.tracks.get(id) : undefined),
      wait: (id) =>
        new Promise<TaskEvent>((resolve) => {
          const done = final(id)
          if (done) return resolve(done)
          store.waiters.set(id, [...(store.waiters.get(id) ?? []), resolve])
        }),
    }
  }, [store, version])
}
