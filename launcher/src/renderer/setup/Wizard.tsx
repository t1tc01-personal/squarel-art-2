/**
 * First-run setup (spec §9): four steps, each saved in state.json (`setupStep`) so closing the
 * launcher mid-way resumes at the same step. Main decides which step to show (setup:info);
 * every install runs only after the user clicks it.
 */
import { type ReactNode, useCallback, useState } from 'react'
import type { LauncherStateView, SetupInfo, StatePatch } from '../../shared/ipc'
import { api } from '../api'
import { errorText, Toasts, useTasks } from '../app-context'
import { Icon } from '../components/Icon'
import { TitleBar } from '../layout/TitleBar'
import { Step1 } from './Step1'
import { Step2 } from './Step2'
import { Step3 } from './Step3'
import { Step4 } from './Step4'
import { type TaskLog, useTaskLog } from './task-log'
import './wizard.css'

export type StepNo = 1 | 2 | 3 | 4

export interface StepProps {
  info: SetupInfo
  state: LauncherStateView | null
  /** Re-reads setup:info (`refresh` = re-read PATH first, after an install in another window). */
  reload(refresh?: boolean): Promise<void>
  /** Saves the step (and other state), then re-reads setup:info. */
  go(step: StepNo | 'done', patch?: Omit<StatePatch, 'setupStep'>): Promise<void>
  log: TaskLog
  /** The Aseprite (or other integration) build started in step 3, shown again in step 4. */
  builds: Record<string, string>
  setBuild(id: string, taskId: string): void
}

const STEPS: { n: StepNo; label: string }[] = [
  { n: 1, label: 'Chào mừng' },
  { n: 2, label: 'Cài công cụ' },
  { n: 3, label: 'Cấu hình' },
  { n: 4, label: 'Kết nối Claude' },
]

/** Compact progress line (replaces the old left step bar of the mockups). */
function Stepper({ step }: { step: StepNo }) {
  return (
    <ol className="wiz-stepper" aria-label="Các bước thiết lập">
      {STEPS.map((s) => (
        <li
          key={s.n}
          className={`wiz-stepper-item${s.n === step ? ' is-active' : s.n < step ? ' is-done' : ''}`}
          aria-current={s.n === step ? 'step' : undefined}
        >
          <span className="wiz-stepper-num">{s.n < step ? <Icon name="check" size={12} /> : s.n}</span>
          {s.label}
        </li>
      ))}
    </ol>
  )
}

/** Common frame of a step: label, title, intro, body, then the footer bar. */
export function StepFrame({
  step,
  title,
  intro,
  children,
  footer,
}: {
  step: StepNo
  title: string
  intro: ReactNode
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <>
      <div className="wiz-scroll">
        <div className="wiz-col">
          <Stepper step={step} />
          <div className="wiz-label">BƯỚC {step} / 4</div>
          <h1 className="wiz-title">{title}</h1>
          <p className="wiz-intro">{intro}</p>
          {children}
        </div>
      </div>
      <footer className="wiz-footer">
        <div className="wiz-col wiz-footer-row">{footer}</div>
      </footer>
    </>
  )
}

export function Wizard({
  info,
  state,
  reload,
}: {
  info: SetupInfo
  state: LauncherStateView | null
  reload(refresh?: boolean): Promise<void>
}) {
  const log = useTaskLog()
  const { notify } = useTasks()
  const [builds, setBuilds] = useState<Record<string, string>>({})
  const setBuild = useCallback((id: string, taskId: string) => setBuilds((b) => ({ ...b, [id]: taskId })), [])

  const go = useCallback(
    async (step: StepNo | 'done', patch: Omit<StatePatch, 'setupStep'> = {}) => {
      try {
        await api.setState({ ...patch, setupStep: step })
      } catch (e) {
        notify({ label: 'Thiết lập', kind: 'error', text: errorText(e) })
      }
      await reload()
    },
    [notify, reload],
  )

  const step = info.step === 'done' ? 4 : info.step
  const props: StepProps = { info, state, reload, go, log, builds, setBuild }
  return (
    <div className="shell">
      <TitleBar />
      <main className="wizard" aria-label="Thiết lập lần đầu">
        {step === 1 ? (
          <Step1 {...props} />
        ) : step === 2 ? (
          <Step2 {...props} />
        ) : step === 3 ? (
          <Step3 {...props} />
        ) : (
          <Step4 {...props} />
        )}
        {/* Rows show progress and results; only failures pop up here. */}
        <Toasts errorsOnly />
      </main>
    </div>
  )
}
