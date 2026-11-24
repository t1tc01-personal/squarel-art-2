/** One Dự án: header with Mở Claude, tabs Tổng quan (arts, sessions, repos, brief) | Brief | Cài đặt. */
import { useCallback, useEffect, useState } from 'react'
import { WORKSPACE_ID, type WorkspaceDetail } from '../../shared/ipc'
import { api } from '../api'
import { errorText, useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { LaunchButton } from '../components/LaunchButton'
import { SubTabs } from '../components/SubTabs'
import { type ProjectTab, useNav } from '../nav'
import { useOpenClaude } from './Projects'
import {
  ArtThumb,
  artMeta,
  ConfirmRemove,
  DefaultsEditor,
  exportDirError,
  fromDraft,
  type RepoDraft,
  RepoList,
  ReposEditor,
  repoFromPick,
  sizeError,
  specLine,
  TextArea,
  toDraft,
  WsCard,
} from './project-ui'

const TABS = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'brief', label: 'Brief' },
  { id: 'settings', label: 'Cài đặt' },
] as const

function useOpenFolder() {
  const { notify } = useTasks()
  return (id: string) =>
    api
      .openWorkspaceFolder({ id })
      .catch((e) => notify({ label: 'Mở thư mục', kind: 'error', text: errorText(e) }))
}

function Overview({ w }: { w: WorkspaceDetail }) {
  const { go } = useNav()
  const openFolder = useOpenFolder()
  return (
    <div className="ws-detail-grid">
      <section className="ws-arts" aria-label="Art của dự án">
        <div className="ws-section-head">
          <h2 className="ws-section-title">Art · {w.arts.length}</h2>
          {w.arts.length > 1 && <span className="row-sub">Mới nhất trước</span>}
        </div>
        {w.arts.length === 0 ? (
          <p className="card ws-desc ws-arts-empty">
            Chưa có art. Mở Claude ở đây rồi bảo: "vẽ một slime 32×32"; art mới tự vào dự án này.
          </p>
        ) : (
          <ul className="ws-art-grid">
            {w.arts.map((a) => (
              <li key={a.slug} className="card ws-art" aria-label={a.name} data-testid="ws-art">
                <span className="ws-art-thumb">
                  <ArtThumb art={a} size={64} />
                </span>
                <span className="ws-art-name">{a.name}</span>
                <span className="row-sub">{artMeta(a)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="ws-side">
        <WsCard title="Phiên Claude" testId="ws-sessions">
          <p className="ws-big">
            {w.sessions > 0 ? (
              <span className="ws-live">{w.sessions} phiên đang mở</span>
            ) : (
              'Chưa có phiên nào'
            )}
          </p>
          {w.sessionList.length > 0 && (
            <ul className="ws-sessions">
              {w.sessionList.map((s, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two sessions may share a title
                <li key={i} className="ws-session" aria-label={s.title} data-testid="ws-session">
                  <span className="ws-session-tile">
                    <Icon name="bolt" />
                  </span>
                  <span className="ws-repo-text">
                    <span className="row-title">{s.title}</span>
                    <span className={`row-sub${s.busy ? ' ws-live' : ''}`}>{s.subtitle}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="row-sub">Claude mở trong thư mục dự án hay thư mục con đều được tính.</p>
        </WsCard>
        <WsCard title="Repo gắn kèm" testId="ws-repos">
          <RepoList folder={w.folder} repos={w.repos} />
          {w.exportDir && (
            <p className="row-sub">
              Nhận file xuất: <span className="mono-small">{w.exportDir}</span>
            </p>
          )}
        </WsCard>
        <WsCard title="Brief" testId="ws-brief">
          <p className={`ws-excerpt${w.brief ? '' : ' is-empty'}`}>{w.brief || 'Chưa có brief.'}</p>
          <div className="ws-card-buttons">
            <Button type="ghost" icon="pencil" onClick={() => go({ project: w.id, tab: 'brief' })}>
              Sửa brief
            </Button>
            <Button type="ghost" icon="folder" onClick={() => void openFolder(w.id)}>
              Mở thư mục
            </Button>
          </div>
        </WsCard>
      </div>
    </div>
  )
}

function BriefTab({ w, onSaved }: { w: WorkspaceDetail; onSaved(d: WorkspaceDetail): void }) {
  const { notify } = useTasks()
  const [description, setDescription] = useState(w.description)
  const [brief, setBrief] = useState(w.brief)
  const [busy, setBusy] = useState(false)
  const dirty = description !== w.description || brief !== w.brief
  const save = async () => {
    setBusy(true)
    try {
      onSaved(await api.updateWorkspace({ id: w.id, patch: { description, brief } }))
      notify({ label: 'Lưu brief', kind: 'done', text: 'Đã ghi AGENTS.md' })
    } catch (e) {
      notify({ label: 'Lưu brief', kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <WsCard title="Brief cho AI">
      <TextArea label="Mô tả" rows={3} maxLength={2000} value={description} onChange={setDescription} />
      <TextArea
        label="Phong cách và quy tắc"
        rows={10}
        maxLength={8000}
        value={brief}
        onChange={setBrief}
        hint="Lưu là ghi lại khối Squarel trong AGENTS.md (phần còn lại của file giữ nguyên). Sửa tay trong khối sẽ bị thay ở lần lưu sau."
      />
      <div className="card-actions">
        <Button type="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </div>
    </WsCard>
  )
}

function SettingsTab({ w, onSaved }: { w: WorkspaceDetail; onSaved(d: WorkspaceDetail): void }) {
  const { notify } = useTasks()
  const { go } = useNav()
  const [name, setName] = useState(w.name)
  const [artId, setArtId] = useState(w.id)
  const [defaults, setDefaults] = useState(toDraft(w.defaults))
  const [repos, setRepos] = useState<RepoDraft[]>(w.repos)
  const [exportDir, setExportDir] = useState(w.exportDir ?? '')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)

  const nameErr = !name.trim() ? 'Nhập tên dự án' : undefined
  const idErr = !WORKSPACE_ID.test(artId.trim())
    ? 'Mã chỉ gồm chữ thường a-z, số và dấu gạch ngang, tối đa 64 ký tự'
    : undefined
  const invalid =
    !!nameErr ||
    !!idErr ||
    !!sizeError(defaults.width) ||
    !!sizeError(defaults.height) ||
    !!exportDirError(exportDir)
  const pick = async () => {
    try {
      return await api.pickFolder()
    } catch (e) {
      notify({ label: 'Chọn thư mục', kind: 'error', text: errorText(e) })
      return null
    }
  }
  const save = async () => {
    setTried(true)
    if (invalid) return
    setBusy(true)
    try {
      const saved = await api.updateWorkspace({
        id: w.id,
        patch: {
          ...(artId.trim() !== w.id ? { id: artId.trim() } : {}),
          name: name.trim(),
          defaults: fromDraft(defaults),
          repos: repos.map((r) => r.path),
          exportDir: exportDir.trim() ? exportDir.trim() : null,
        },
      })
      onSaved(saved)
      if (saved.id !== w.id) go({ project: saved.id, tab: 'settings' })
      notify({ label: 'Cài đặt dự án', kind: 'done', text: 'Đã ghi .squarel/project.json và AGENTS.md' })
    } catch (e) {
      notify({ label: 'Cài đặt dự án', kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api.removeWorkspace({ id: w.id })
      notify({ label: 'Gỡ dự án', kind: 'done', text: `Đã gỡ ${w.name}; file trong thư mục vẫn còn` })
      go('projects')
    } catch (e) {
      notify({ label: 'Gỡ dự án', kind: 'error', text: errorText(e) })
      setBusy(false)
    }
  }
  return (
    <>
      <div className="settings-grid">
        <div className="settings-col">
          <WsCard title="Thông tin">
            <Field
              label="Tên dự án"
              value={name}
              maxLength={80}
              state={tried && nameErr ? 'error' : 'default'}
              hint={tried ? nameErr : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            <Field
              label="Mã dự án"
              value={artId}
              maxLength={64}
              state={tried && idErr ? 'error' : 'default'}
              hint={
                (tried ? idErr : undefined) ??
                'Art tham chiếu dự án bằng mã này. Đổi mã khi hai thư mục trùng mã, hoặc khi muốn tên gọn hơn.'
              }
              onChange={(e) => setArtId(e.target.value)}
            />
          </WsCard>
          <WsCard title="Mặc định cho art mới">
            <DefaultsEditor value={defaults} onChange={setDefaults} showErrors={tried} />
          </WsCard>
        </div>
        <div className="settings-col">
          <WsCard title="Repo gắn kèm">
            <ReposEditor
              folder={w.folder}
              repos={repos}
              onAdd={(p) => {
                const r = repoFromPick(w.folder, p)
                if (typeof r === 'string') notify({ label: 'Repo gắn kèm', kind: 'error', text: r })
                else if (!repos.some((x) => x.path.toLowerCase() === r.path.toLowerCase()))
                  setRepos([...repos, r])
              }}
              onRemove={(path) => setRepos(repos.filter((r) => r.path !== path))}
              exportDir={exportDir}
              onExportDir={setExportDir}
              showErrors={tried}
              pick={pick}
              onError={(text) => notify({ label: 'Repo gắn kèm', kind: 'error', text })}
            />
          </WsCard>
          <div className="card-actions ws-save-row">
            <Button type="primary" disabled={busy} onClick={() => void save()}>
              Lưu
            </Button>
          </div>
          <WsCard title="Gỡ khỏi launcher" className="ws-danger">
            <p className="row-sub">
              Gỡ khỏi launcher không xoá gì. Art của dự án vẫn nằm trong {w.folder}\squarel_art. Xoá thư mục
              dự án là mất art.
            </p>
            <div>
              <Button type="danger" disabled={busy} onClick={() => setRemoving(true)}>
                Gỡ khỏi launcher
              </Button>
            </div>
          </WsCard>
        </div>
      </div>
      {removing && (
        <ConfirmRemove
          name={w.name}
          folder={w.folder}
          busy={busy}
          onConfirm={() => void remove()}
          onClose={() => setRemoving(false)}
        />
      )}
    </>
  )
}

export function ProjectDetail({ id, tab }: { id: string; tab: ProjectTab }) {
  const { go } = useNav()
  const openClaude = useOpenClaude()
  const openFolder = useOpenFolder()
  const [w, setW] = useState<WorkspaceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bumped on every load so the Brief / Cài đặt drafts start again from what was saved. */
  const [version, setVersion] = useState(0)

  const loaded = useCallback((d: WorkspaceDetail) => {
    setW(d)
    setVersion((v) => v + 1)
  }, [])
  useEffect(() => {
    api.getWorkspace({ id }).then(loaded, (e) => setError(errorText(e)))
  }, [id, loaded])

  const spec = w ? specLine(w.defaults) : ''
  return (
    <div className="page page-project">
      <div className="page-head">
        <div className="ws-head">
          <button type="button" className="link ws-back" onClick={() => go('projects')}>
            ← Dự án
          </button>
          <div className="ws-title-row">
            <h1 className="page-title">{w?.name ?? (error ? 'Dự án' : 'Đang tải…')}</h1>
            {spec && <span className="pill pill-running ws-spec">{spec}</span>}
          </div>
          {w && (
            <p className="ws-folder mono-small" title={w.folder}>
              <Icon name="folder" />
              <span className="ws-path">{w.folder}</span>
            </p>
          )}
        </div>
        {w && (
          <LaunchButton
            label="Mở Claude"
            disabled={w.status !== 'ok'}
            onLaunch={() => void openClaude(w.id, w.folder)}
            actions={[
              {
                id: 'folder',
                label: 'Mở thư mục',
                icon: 'folder',
                disabled: w.status === 'missing',
                onSelect: () => void openFolder(w.id),
              },
            ]}
          />
        )}
      </div>
      {error && !w && (
        <p className="ws-notice is-error" role="alert">
          <Icon name="alert" />
          <span>Không mở được dự án: {error}</span>
        </p>
      )}
      {w && (
        <>
          {w.status !== 'ok' && (
            <p className="ws-notice is-error" role="alert">
              <Icon name="alert" />
              <span>
                {w.status === 'missing'
                  ? 'Không thấy thư mục hoặc .squarel/project.json của dự án. Khôi phục thư mục, hoặc gỡ dự án ở tab Cài đặt.'
                  : 'File .squarel/project.json bị hỏng; sửa file rồi mở lại trang.'}
              </span>
            </p>
          )}
          <SubTabs
            tabs={TABS}
            active={tab}
            onSelect={(t) => go({ project: id, tab: t })}
            label={`Mục của ${w.name}`}
          />
          {tab === 'overview' ? (
            <Overview w={w} />
          ) : tab === 'brief' ? (
            <BriefTab key={version} w={w} onSaved={loaded} />
          ) : (
            <SettingsTab key={version} w={w} onSaved={loaded} />
          )}
        </>
      )}
    </div>
  )
}
