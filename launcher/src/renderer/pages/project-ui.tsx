/**
 * Pieces shared by the Dự án pages (list, Dự án mới, chi tiết): labels, art thumbs, chips, the
 * defaults / repos / export-folder editors and the "Gỡ khỏi launcher" confirm dialog.
 * Paths are never typed: folders come from the pick dialog (main only accepts those).
 */
import { type ReactNode, useId } from 'react'
import {
  type ArtView,
  WORKSPACE_PALETTES,
  WORKSPACE_PURPOSES,
  type WorkspaceDefaults,
} from '../../shared/ipc'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { ago } from '../format'
import './projects.css'
import { exportDirError } from './project-paths'

export { exportDirError }

type Purpose = (typeof WORKSPACE_PURPOSES)[number]
type Palette = (typeof WORKSPACE_PALETTES)[number]

export const PURPOSE_LABEL: Record<Purpose, string> = {
  game: 'Game',
  print: 'In',
  digital: 'Digital',
  craft: 'Hạt',
}
export const PALETTE_LABEL: Record<Palette, string> = {
  pico8: 'PICO-8',
  sweetie16: 'Sweetie 16',
  db16: 'DB16',
  gameboy: 'Game Boy',
  grayscale4: 'Grayscale',
  bw: 'BW',
}

/** "Game · 32×32 · PICO-8" (only the parts that are set). */
export function specLine(d: WorkspaceDefaults): string {
  const parts: string[] = []
  if (d.purpose) parts.push(PURPOSE_LABEL[d.purpose])
  if (d.width && d.height) parts.push(`${d.width}×${d.height}`)
  else if (d.width) parts.push(`rộng ${d.width}`)
  else if (d.height) parts.push(`cao ${d.height}`)
  if (d.palette) parts.push(PALETTE_LABEL[d.palette])
  return parts.join(' · ')
}

/** Last segment of a Windows or `/` path. */
export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p

const trimSep = (p: string) => p.replace(/[\\/]+$/, '')

/** `p` relative to `folder` with `/` when it lies inside it ('' when equal), else null. */
export function relativeInside(folder: string, p: string): string | null {
  const f = trimSep(folder).replace(/\//g, '\\')
  const q = trimSep(p).replace(/\//g, '\\')
  if (q.toLowerCase() === f.toLowerCase()) return ''
  if (!q.toLowerCase().startsWith(`${f.toLowerCase()}\\`)) return null
  return q.slice(f.length + 1).replace(/\\/g, '/')
}

/** One art thumbnail tile (pixelated image, or a placeholder sprite icon). */
export function ArtThumb({ art, size = 48 }: { art?: ArtView; size?: number }) {
  return (
    <span className="ws-thumb" style={{ width: size, height: size }} title={art?.name}>
      {art?.thumb ? (
        <img src={art.thumb} alt="" draggable={false} />
      ) : (
        <Icon name={art ? 'sparkle' : 'folder'} size={Math.round(size / 2.5)} />
      )}
    </span>
  )
}

/** "32×32 · v000003 · 2 giờ trước" (frames when more than one). */
export function artMeta(a: ArtView): string {
  const parts: string[] = []
  if (a.width && a.height) parts.push(`${a.width}×${a.height}`)
  if (a.frames && a.frames > 1) parts.push(`${a.frames} frame`)
  if (a.head) parts.push(a.head)
  const when = ago(a.updatedAt)
  if (when) parts.push(when)
  return parts.join(' · ')
}

/** Multi-line text input styled like Field. */
export function TextArea({
  label,
  value,
  onChange,
  hint,
  rows = 4,
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange(v: string): void
  hint?: string
  rows?: number
  placeholder?: string
  maxLength?: number
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="field-box ws-textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <div className="field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
    </div>
  )
}

/** One-of chips: native radios drawn as chips; a `null` option means "unset". */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { id: T | null; label: string }[]
  value: T | undefined
  onChange(v: T | undefined): void
}) {
  const name = useId()
  return (
    <fieldset className="field ws-fieldset">
      <legend className="field-label">{label}</legend>
      <div className="chip-row ws-chips">
        {options.map((o) => {
          const on = (o.id ?? undefined) === value
          return (
            <label key={o.id ?? 'none'} className={`chip${on ? ' is-active' : ''}`}>
              <input
                type="radio"
                className="sr-only"
                name={name}
                checked={on}
                onChange={() => onChange(o.id ?? undefined)}
              />
              {o.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Defaults as edited: sizes stay text until saved. */
export interface DefaultsDraft {
  purpose?: Purpose
  width: string
  height: string
  palette?: Palette
}

export const toDraft = (d: WorkspaceDefaults): DefaultsDraft => ({
  ...(d.purpose ? { purpose: d.purpose } : {}),
  width: d.width ? String(d.width) : '',
  height: d.height ? String(d.height) : '',
  ...(d.palette ? { palette: d.palette } : {}),
})

/** Error of a size field ('' = unset is fine). */
export function sizeError(v: string): string | undefined {
  const t = v.trim()
  if (!t) return undefined
  if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 256) return 'Từ 1 đến 256'
  return undefined
}

export function fromDraft(d: DefaultsDraft): WorkspaceDefaults {
  const out: WorkspaceDefaults = {}
  if (d.purpose) out.purpose = d.purpose
  if (d.width.trim()) out.width = Number(d.width.trim())
  if (d.height.trim()) out.height = Number(d.height.trim())
  if (d.palette) out.palette = d.palette
  return out
}

const PURPOSE_OPTIONS = WORKSPACE_PURPOSES.map((id) => ({ id, label: PURPOSE_LABEL[id] }))
const PALETTE_OPTIONS = [
  ...WORKSPACE_PALETTES.map((id): { id: Palette | null; label: string } => ({
    id,
    label: PALETTE_LABEL[id],
  })),
  { id: null, label: 'Tự do' },
]

export function DefaultsEditor({
  value,
  onChange,
  showErrors,
}: {
  value: DefaultsDraft
  onChange(v: DefaultsDraft): void
  showErrors: boolean
}) {
  const wErr = showErrors ? sizeError(value.width) : undefined
  const hErr = showErrors ? sizeError(value.height) : undefined
  return (
    <>
      <ChipGroup
        label="Mục đích"
        options={PURPOSE_OPTIONS}
        value={value.purpose}
        onChange={(purpose) => onChange({ ...value, purpose })}
      />
      <div className="field-pair">
        <Field
          label="Rộng"
          inputMode="numeric"
          placeholder="32"
          value={value.width}
          state={wErr ? 'error' : 'default'}
          hint={wErr}
          onChange={(e) => onChange({ ...value, width: e.target.value })}
        />
        <Field
          label="Cao"
          inputMode="numeric"
          placeholder="32"
          value={value.height}
          state={hErr ? 'error' : 'default'}
          hint={hErr}
          onChange={(e) => onChange({ ...value, height: e.target.value })}
        />
      </div>
      <ChipGroup
        label="Palette"
        options={PALETTE_OPTIONS}
        value={value.palette}
        onChange={(palette) => onChange({ ...value, palette })}
      />
    </>
  )
}

/** A repo as edited: relative (`/`) inside the folder, or an absolute path outside it. */
export interface RepoDraft {
  path: string
  outside: boolean
  exists?: boolean
}

/** Where a repo really is, for display. */
export const repoFullPath = (folder: string | null, r: RepoDraft) =>
  r.outside || !folder ? r.path : `${trimSep(folder)}\\${r.path.replace(/\//g, '\\')}`

export function RepoList({
  folder,
  repos,
  onRemove,
}: {
  folder: string | null
  repos: readonly RepoDraft[]
  onRemove?(path: string): void
}) {
  if (repos.length === 0) return <p className="row-sub ws-none">Chưa gắn repo nào.</p>
  return (
    <ul className="ws-repos">
      {repos.map((r) => {
        const name = baseName(r.path)
        return (
          <li key={r.path} className="ws-repo" aria-label={name}>
            <Icon name="folder" className="ws-repo-icon" />
            <span className="ws-repo-text">
              <span className="row-title">{name}</span>
              <span className="mono-small row-sub ws-path">{repoFullPath(folder, r)}</span>
            </span>
            {r.exists === false ? (
              <span className="ws-repo-label is-warn">
                {r.outside ? 'ở ngoài' : 'trong thư mục'} · không tìm thấy
              </span>
            ) : r.outside ? (
              <span className="ws-repo-label">ở ngoài · --add-dir</span>
            ) : (
              <span className="ws-repo-label is-ok">trong thư mục</span>
            )}
            {onRemove && (
              <button
                type="button"
                className="icon-btn ws-repo-remove"
                aria-label={`Bỏ repo ${name}`}
                title="Bỏ repo"
                onClick={() => onRemove(r.path)}
              >
                <Icon name="cross" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A picked folder as a repo of `folder`: relative inside it, absolute outside; a string is an error. */
export function repoFromPick(folder: string, picked: string): RepoDraft | string {
  const rel = relativeInside(folder, picked)
  if (rel === '') return 'Repo không được là chính thư mục dự án'
  return rel === null ? { path: picked, outside: true } : { path: rel, outside: false }
}

/**
 * Repo rows, "Thêm repo" and "Thư mục nhận file xuất". `pick` is the folder dialog (null when
 * cancelled); `onAdd` gets the picked absolute folder. An export folder must be inside `folder`.
 */
export function ReposEditor({
  folder,
  repos,
  onAdd,
  onRemove,
  exportDir,
  onExportDir,
  showErrors,
  pick,
  onError,
}: {
  folder: string | null
  repos: readonly RepoDraft[]
  onAdd(picked: string): void
  onRemove(path: string): void
  exportDir: string
  onExportDir(v: string): void
  showErrors: boolean
  pick(): Promise<string | null>
  onError(text: string): void
}) {
  const add = async () => {
    if (!folder) return
    if (repos.length >= 20) return onError('Tối đa 20 repo')
    const p = await pick()
    if (p) onAdd(p)
  }
  const pickExport = async () => {
    if (!folder) return
    const p = await pick()
    if (!p) return
    const rel = relativeInside(folder, p)
    if (rel === null) return onError('Thư mục nhận file xuất phải nằm trong thư mục dự án')
    if (rel === '') return onError('Chọn một thư mục con, không phải chính thư mục dự án')
    onExportDir(rel)
  }
  const err = showErrors ? exportDirError(exportDir) : undefined
  return (
    <>
      <RepoList folder={folder} repos={repos} onRemove={onRemove} />
      <div className="ws-add-repo">
        <Button type="secondary" icon="plus" disabled={!folder} onClick={() => void add()}>
          Thêm repo
        </Button>
        {!folder && <span className="row-sub">Chọn thư mục dự án trước</span>}
      </div>
      <Field
        label="Thư mục nhận file xuất"
        value={exportDir}
        placeholder="game-client/assets/sprites"
        spellCheck={false}
        state={err ? 'error' : 'default'}
        hint={err ?? 'Sprite sheet, PNG xuất xong được chép vào đây (tương đối với thư mục dự án).'}
        onChange={(e) => onExportDir(e.target.value)}
        {...(folder ? { action: { label: 'Chọn…', onClick: () => void pickExport() } } : {})}
      />
    </>
  )
}

/** Asks before forgetting a workspace; says that nothing on disk is deleted. */
export function ConfirmRemove({
  name,
  busy,
  onConfirm,
  onClose,
}: {
  name: string
  busy?: boolean
  onConfirm(): void
  onClose(): void
}) {
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-remove-title"
        aria-describedby="ws-remove-text"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="ws-remove-title" className="modal-title">
          Gỡ “{name}” khỏi launcher?
        </h2>
        <p id="ws-remove-text" className="modal-text">
          Launcher thôi hiện dự án này. Thư mục, AGENTS.md, CLAUDE.md, .squarel/ và mọi art vẫn giữ nguyên;
          thêm lại bằng Dự án mới với cùng thư mục là có lại.
        </p>
        <div className="modal-actions">
          <Button type="ghost" autoFocus onClick={onClose}>
            Huỷ
          </Button>
          <Button type="danger" disabled={busy} onClick={onConfirm}>
            Gỡ khỏi launcher
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Card with a title row (the Settings page card look). */
export function WsCard({
  title,
  badge,
  children,
  className,
  testId,
}: {
  title: string
  badge?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section
      className={`card settings-card${className ? ` ${className}` : ''}`}
      aria-label={title}
      data-testid={testId}
    >
      <div className="settings-card-head">
        <h2 className="card-title">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  )
}
