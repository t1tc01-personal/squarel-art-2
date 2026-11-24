/**
 * Dự án mới: name, folder (picked; optionally a new sub-folder inside it), description, brief,
 * defaults for new art, repos, export folder, and what the launcher will write there.
 */
import { useEffect, useState } from 'react'
import type { WorkspaceCreate, WorkspaceFolderInfo } from '../../shared/ipc'
import { api } from '../api'
import { errorText, useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { useNav } from '../nav'
import {
  type DefaultsDraft,
  DefaultsEditor,
  exportDirError,
  fromDraft,
  type RepoDraft,
  ReposEditor,
  repoFromPick,
  sizeError,
  TextArea,
  WsCard,
} from './project-ui'

const BAD_NAME = /[\\/:*?"<>|]/

function subError(v: string): string | undefined {
  const t = v.trim()
  if (!t) return undefined
  if (BAD_NAME.test(t) || [...t].some((c) => c.charCodeAt(0) < 0x20))
    return 'Tên thư mục không được có \\ / : * ? " < > |'
  if (t === '.' || t === '..' || /[. ]$/.test(t)) return 'Tên thư mục không hợp lệ'
  return undefined
}

type Verb = 'create' | 'update' | 'keep'
type WriteKey = keyof WorkspaceFolderInfo['files']
const WRITES: { file: string; key: WriteKey | null; text: Record<Verb, string> }[] = [
  {
    file: 'AGENTS.md',
    key: 'agents',
    text: {
      create: 'tạo mới · brief cho mọi agent',
      update: 'thêm khối Squarel · giữ nội dung cũ',
      keep: 'giữ nguyên',
    },
  },
  {
    file: 'CLAUDE.md',
    key: 'claude',
    text: {
      create: 'tạo mới · dòng @AGENTS.md',
      update: 'thêm dòng @AGENTS.md lên đầu',
      keep: 'giữ nguyên · đã có @AGENTS.md',
    },
  },
  {
    file: '.squarel/project.json',
    key: 'project',
    text: { create: 'tạo mới · id dự án, repo, nơi xuất', update: 'cập nhật', keep: 'giữ nguyên' },
  },
  {
    file: 'squarel_art/',
    key: 'art',
    text: { create: 'tạo mới · nơi lưu art của dự án', update: 'cập nhật', keep: 'giữ nguyên' },
  },
  {
    file: 'squarel_art/.gitignore',
    key: 'artIgnore',
    text: { create: 'tạo mới · git bỏ qua file nặng', update: 'cập nhật', keep: 'giữ nguyên' },
  },
  {
    file: '.squarel/arts.md',
    key: null,
    text: {
      create: 'danh mục art · Squarel tự cập nhật',
      update: 'danh mục art · Squarel tự cập nhật',
      keep: 'giữ nguyên',
    },
  },
]

function WritesCard({ info, folder }: { info: WorkspaceFolderInfo | null; folder: string | null }) {
  const existing = info?.existing
  return (
    <WsCard title="Launcher sẽ ghi" testId="ws-writes">
      {existing && (
        <p className="ws-notice" role="status">
          <Icon name="alert" />
          <span>
            Thư mục này đã là dự án “{existing.name}”. Launcher chỉ đăng ký lại, không ghi file nào.
          </span>
        </p>
      )}
      <ul className="ws-writes">
        {WRITES.map((w) => {
          const verb: Verb = existing ? 'keep' : w.key && info ? info.files[w.key] : 'create'
          return (
            <li key={w.file} className="ws-write" data-testid={`write-${w.file}`}>
              <span className="mono-small">{w.file}</span>
              <span className={`ws-write-what${verb === 'keep' ? ' is-keep' : ''}`}>{w.text[verb]}</span>
            </li>
          )
        })}
      </ul>
      <p className="field-hint">
        {folder
          ? 'Không xoá hay ghi đè file của bạn: nếu AGENTS.md đã có, launcher chỉ thêm một khối có đánh dấu.'
          : 'Chọn thư mục để xem chính xác file nào được tạo mới, file nào được thêm vào.'}
      </p>
    </WsCard>
  )
}

export function ProjectNew() {
  const { go } = useNav()
  const { notify } = useTasks()
  const [name, setName] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [sub, setSub] = useState('')
  const [description, setDescription] = useState('')
  const [brief, setBrief] = useState('')
  const [defaults, setDefaults] = useState<DefaultsDraft>({ width: '', height: '' })
  /** Picked repo folders (absolute); shown relative once they turn out to be inside the folder. */
  const [picked, setPicked] = useState<string[]>([])
  const [exportDir, setExportDir] = useState('')
  const [info, setInfo] = useState<WorkspaceFolderInfo | null>(null)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)

  const subErr = subError(sub)
  const folder = parent
    ? sub.trim() && !subErr
      ? `${parent.replace(/[\\/]+$/, '')}\\${sub.trim()}`
      : parent
    : null
  const repos = folder
    ? picked.map((p) => repoFromPick(folder, p)).filter((r): r is RepoDraft => typeof r !== 'string')
    : []

  // What the launcher would write in this folder (debounced while the sub-folder name is typed).
  useEffect(() => {
    setInfo(null)
    setInspectError(null)
    if (!folder) return
    let live = true
    const t = setTimeout(() => {
      api.inspectWorkspaceFolder({ folder }).then(
        (i) => live && setInfo(i),
        (e) => live && setInspectError(errorText(e)),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [folder])

  const pick = async (): Promise<string | null> => {
    try {
      return await api.pickFolder()
    } catch (e) {
      notify({ label: 'Chọn thư mục', kind: 'error', text: errorText(e) })
      return null
    }
  }
  const pickParent = async () => {
    const p = await pick()
    if (!p) return
    setParent(p)
    if (!name.trim()) setName(p.split(/[\\/]/).filter(Boolean).at(-1) ?? '')
  }

  const errors = {
    name: !name.trim() ? 'Nhập tên dự án' : name.trim().length > 80 ? 'Tên tối đa 80 ký tự' : undefined,
    folder: !parent ? 'Chọn thư mục dự án' : undefined,
    sub: subErr,
    size: sizeError(defaults.width) ?? sizeError(defaults.height),
    exportDir: exportDirError(exportDir),
  }
  const show = (k: keyof typeof errors) => (tried ? errors[k] : k === 'sub' ? errors.sub : undefined)

  const submit = async (openAfter: boolean) => {
    setTried(true)
    if (Object.values(errors).some(Boolean) || !folder) return
    const d = fromDraft(defaults)
    const input: WorkspaceCreate = {
      name: name.trim(),
      folder,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(brief.trim() ? { brief: brief.trim() } : {}),
      ...(Object.keys(d).length ? { defaults: d } : {}),
      ...(repos.length ? { repos: repos.map((r) => r.path) } : {}),
      ...(exportDir.trim() ? { exportDir: exportDir.trim() } : {}),
    }
    setBusy(true)
    try {
      const w = await api.createWorkspace(input)
      notify({
        label: 'Dự án mới',
        kind: 'done',
        text: info?.existing ? `Đã đăng ký lại dự án ${w.name}` : `Đã tạo ${w.name} và ghi AGENTS.md`,
      })
      go({ project: w.id, tab: 'overview' })
      if (openAfter) {
        try {
          await api.openWorkspaceClaude({ id: w.id })
        } catch (e) {
          notify({ label: 'Mở Claude', kind: 'error', text: errorText(e) })
        }
      }
    } catch (e) {
      notify({ label: 'Tạo dự án', kind: 'error', text: errorText(e) })
      setBusy(false)
    }
  }

  return (
    <div className="page page-project-new">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dự án mới</h1>
          <p className="page-sub">
            Launcher ghi brief vào thư mục dự án. Claude, Codex, Cursor mở ở đó đều đọc được.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <div className="settings-col">
          <WsCard title="Thông tin">
            <Field
              label="Tên dự án"
              value={name}
              maxLength={80}
              placeholder="Game dungeon"
              state={show('name') ? 'error' : 'default'}
              hint={show('name')}
              onChange={(e) => setName(e.target.value)}
            />
            <Field
              label="Thư mục dự án"
              value={folder ?? ''}
              readOnly
              placeholder="Chưa chọn"
              state={show('folder') || inspectError ? 'error' : 'default'}
              hint={
                show('folder') ?? inspectError ?? 'Mở Claude ở thư mục này. Chưa có thì launcher tạo mới.'
              }
              action={{ label: 'Chọn…', onClick: () => void pickParent() }}
            />
            {parent && (
              <Field
                label="Tạo thư mục con (tuỳ chọn)"
                value={sub}
                maxLength={120}
                placeholder="Để trống: dùng chính thư mục đã chọn"
                state={show('sub') ? 'error' : 'default'}
                hint={show('sub') ?? `Thư mục mới nằm trong ${parent}`}
                onChange={(e) => setSub(e.target.value)}
              />
            )}
            <TextArea
              label="Mô tả"
              rows={3}
              maxLength={2000}
              value={description}
              placeholder="Game roguelike 2D góc nhìn top-down…"
              onChange={setDescription}
            />
          </WsCard>
          <WsCard title="Brief cho AI">
            <TextArea
              label="Phong cách và quy tắc"
              rows={6}
              maxLength={8000}
              value={brief}
              placeholder="Sprite 32×32, viền đen 1px, nhìn 3/4 từ trên xuống…"
              hint="Ghi vào AGENTS.md. Bạn sửa lại bất cứ lúc nào ở tab Brief."
              onChange={setBrief}
            />
          </WsCard>
        </div>
        <div className="settings-col">
          <WsCard title="Mặc định cho art mới">
            <DefaultsEditor value={defaults} onChange={setDefaults} showErrors={tried} />
          </WsCard>
          <WsCard title="Repo gắn kèm">
            <ReposEditor
              folder={folder}
              repos={repos}
              onAdd={(p) => {
                const r = folder && repoFromPick(folder, p)
                if (typeof r === 'string') notify({ label: 'Repo gắn kèm', kind: 'error', text: r })
                else if (!picked.some((x) => x.toLowerCase() === p.toLowerCase())) setPicked([...picked, p])
              }}
              onRemove={(path) =>
                setPicked(
                  picked.filter((p) => {
                    const r = folder ? repoFromPick(folder, p) : p
                    return typeof r === 'string' || r.path !== path
                  }),
                )
              }
              exportDir={exportDir}
              onExportDir={setExportDir}
              showErrors={tried}
              pick={pick}
              onError={(text) => notify({ label: 'Repo gắn kèm', kind: 'error', text })}
            />
          </WsCard>
          <WritesCard info={info} folder={folder} />
        </div>
      </div>
      <div className="ws-footer">
        <Button type="ghost" onClick={() => go('projects')}>
          Huỷ
        </Button>
        <span className="ws-footer-spacer" />
        {tried && Object.values(errors).some(Boolean) && (
          <span className="ws-footer-error" role="alert">
            Kiểm tra lại các ô báo đỏ
          </span>
        )}
        <Button type="secondary" disabled={busy} onClick={() => void submit(false)}>
          Tạo dự án
        </Button>
        <Button type="primary" icon="bolt" disabled={busy} onClick={() => void submit(true)}>
          Tạo và mở Claude
        </Button>
      </div>
    </div>
  )
}
