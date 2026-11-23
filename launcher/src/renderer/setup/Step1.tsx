import { useState } from 'react'
import { api } from '../api'
import { errorText } from '../app-context'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { StepFrame, type StepProps } from './Wizard'

type Mode = 'fresh' | 'clone'

/** Step 1: fresh install (clone the launcher's tag) or an existing clone picked with the dialog. */
export function Step1({ info, state, reload, go }: StepProps) {
  const [mode, setMode] = useState<Mode>(state?.mode ?? 'fresh')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const squarelOk = !!info.tools.find((t) => t.id === 'squarel')?.installed
  const cloneDir = state?.mode === 'clone' || (squarelOk && state?.squarelDir) ? state?.squarelDir : undefined
  const canGo = mode === 'fresh' ? !!info.defaultInstall : !!cloneDir && squarelOk

  const pick = async () => {
    setError(null)
    setBusy(true)
    try {
      const dir = await api.pickFolder()
      if (!dir) return
      // Main checks the folder (package.json named "squarel-art") and refuses anything else.
      await api.setState({ squarelDir: dir, mode: 'clone' })
      await reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const card = (m: Mode, title: string, icon: 'box' | 'folder', text: string, path: string | undefined) => (
    <label className={`wiz-choice${mode === m ? ' is-selected' : ''}`}>
      <span className="wiz-choice-head">
        <span className="wiz-choice-icon">
          <Icon name={icon} size={16} />
        </span>
        <span className="wiz-choice-title">{title}</span>
        <input
          type="radio"
          className="wiz-radio"
          name="setup-mode"
          checked={mode === m}
          onChange={() => setMode(m)}
        />
      </span>
      <span className="wiz-choice-text">{text}</span>
      <span className="wiz-path mono-small">
        <Icon name="folder" size={14} />
        <span className="wiz-path-text">{path ?? 'Chưa chọn thư mục'}</span>
      </span>
    </label>
  )

  return (
    <StepFrame
      step={1}
      title="Chào mừng tới Squarel Art"
      intro={
        <>
          Launcher sẽ cài và kiểm tra mọi thứ Squarel cần trên máy này: công cụ, Claude Code, Aseprite, khoá
          API.
          <br />
          Bạn chỉ cần trả lời vài câu hỏi.
        </>
      }
      footer={
        <>
          <span className="wiz-footer-hint">Cần khoảng 10GB đĩa trống nếu tự build Aseprite</span>
          <Button
            type="primary"
            disabled={!canGo || busy}
            onClick={() => void go(2, mode === 'fresh' ? { mode: 'fresh' } : {})}
          >
            Tiếp tục
          </Button>
        </>
      }
    >
      <fieldset className="wiz-choices" aria-label="Cách cài">
        {card(
          'fresh',
          'Cài mới',
          'box',
          `Launcher tải Squarel v${info.launcherVersion} về máy này rồi cài mọi thứ còn thiếu. Dành cho máy mới.`,
          info.defaultInstall ?? undefined,
        )}
        {card(
          'clone',
          'Dùng repo đã clone',
          'folder',
          'Bạn đã clone squarel-art-2 bằng git. Launcher dùng đúng thư mục đó, không tải lại.',
          cloneDir,
        )}
      </fieldset>
      {mode === 'clone' && (
        <section className="card wiz-card">
          <h2 className="card-title">Thư mục Squarel</h2>
          <p className="row-sub">Chọn thư mục gốc của repo (có file package.json tên "squarel-art").</p>
          <div className="card-actions">
            <Button type="secondary" icon="folder" disabled={busy} onClick={() => void pick()}>
              Chọn thư mục
            </Button>
          </div>
          {error && (
            <p className="wiz-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
      <section className="card wiz-card">
        <h2 className="card-title">Nơi lưu project và lịch sử</h2>
        <p className="row-sub">
          Thư mục dữ liệu (DATA_DIR) được chọn ở bước 3, sau khi có thư mục Squarel. Nên đặt trong OneDrive
          hoặc Google Drive để tự backup.
        </p>
      </section>
    </StepFrame>
  )
}
