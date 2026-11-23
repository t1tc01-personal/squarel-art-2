/** Dự án: one card per workspace, "Chưa phân loại", "Dự án mới" and a tip (spec §5.2). */
import { useCallback, useEffect, useState } from 'react'
import type { ArtView, WorkspaceSummary } from '../../shared/ipc'
import { api } from '../api'
import { errorText, useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { StatusPill } from '../components/StatusPill'
import { ago } from '../format'
import { useNav } from '../nav'
import { ArtThumb, ConfirmRemove, PURPOSE_LABEL } from './project-ui'

/** Mở Claude in a workspace folder, with a toast either way. */
export function useOpenClaude() {
  const { notify } = useTasks()
  return useCallback(
    async (id: string, folder: string) => {
      try {
        await api.openWorkspaceClaude({ id })
        notify({ label: 'Mở Claude', kind: 'done', text: `Claude Code mở trong ${folder}` })
      } catch (e) {
        notify({ label: 'Mở Claude', kind: 'error', text: errorText(e) })
      }
    },
    [notify],
  )
}

function ProjectCard({ w, onRemove }: { w: WorkspaceSummary; onRemove(): void }) {
  const { go } = useNav()
  const openClaude = useOpenClaude()
  const ok = w.status === 'ok'
  return (
    <li className={`card ws-card${ok ? '' : ' is-broken'}`} aria-label={w.name} data-testid="ws-card">
      <div className="ws-card-head">
        <span className="ws-thumbs">
          {ok && w.recent.length > 0 ? (
            w.recent.map((a) => <ArtThumb key={a.slug} art={a} />)
          ) : (
            <span className={`ws-thumb${ok ? '' : ' is-error'}`} style={{ width: 48, height: 48 }}>
              <Icon name={ok ? 'folder' : 'alert'} size={20} />
            </span>
          )}
        </span>
        {!ok ? (
          <StatusPill level="error" label={w.status === 'missing' ? 'Mất thư mục' : 'File hỏng'} />
        ) : w.purpose ? (
          <StatusPill level={w.sessions > 0 ? 'running' : 'idle'} label={PURPOSE_LABEL[w.purpose]} />
        ) : null}
      </div>
      <h3 className="ws-name">{w.name}</h3>
      <p className="ws-folder mono-small" title={w.folder}>
        <Icon name="folder" />
        <span className="ws-path">{w.folder}</span>
      </p>
      {ok ? (
        <p className="ws-meta" data-testid="ws-meta">
          {w.artCount} art
          {w.updatedAt && ` · cập nhật ${ago(w.updatedAt)}`}
          {w.sessions > 0 && <span className="ws-live"> · {w.sessions} phiên Claude đang mở</span>}
        </p>
      ) : (
        <p className="ws-error" role="alert">
          {w.status === 'missing'
            ? 'Không thấy thư mục hoặc .squarel/project.json. Khôi phục thư mục, hoặc gỡ dự án khỏi launcher.'
            : 'File .squarel/project.json bị hỏng. Sửa file rồi mở lại trang, hoặc gỡ dự án khỏi launcher.'}
        </p>
      )}
      <div className="ws-actions">
        {ok ? (
          <>
            <Button
              type="primary"
              icon="bolt"
              className="ws-open"
              onClick={() => void openClaude(w.id, w.folder)}
            >
              Mở Claude
            </Button>
            <Button type="ghost" onClick={() => go({ project: w.id, tab: 'overview' })}>
              Chi tiết
            </Button>
          </>
        ) : (
          <Button type="secondary" onClick={onRemove}>
            Gỡ
          </Button>
        )}
      </div>
    </li>
  )
}

function UnassignedCard({ arts }: { arts: ArtView[] }) {
  const example = arts[0]?.name ?? '<tên>'
  return (
    <li className="card ws-card ws-dashed" aria-label="Chưa phân loại" data-testid="ws-unassigned">
      <h3 className="ws-name ws-name-icon">
        <Icon name="list" />
        Chưa phân loại
      </h3>
      <p className="ws-desc">
        {arts.length === 0
          ? 'Mọi art đều đã thuộc một dự án.'
          : `${arts.length} art tạo trước khi có dự án. Mở một dự án rồi bảo Claude: "chuyển art ${example} vào dự án này".`}
      </p>
      {arts.length > 0 && (
        <span className="ws-thumbs ws-thumbs-sm">
          {arts.slice(0, 6).map((a) => (
            <ArtThumb key={a.slug} art={a} size={32} />
          ))}
        </span>
      )}
    </li>
  )
}

function TipCard() {
  return (
    <li className="card ws-card ws-tip" aria-label="Mẹo">
      <h3 className="ws-tip-title">
        <Icon name="sparkle" />
        Mở Claude ở đâu cũng được
      </h3>
      <p className="ws-desc">
        Mở Claude trong thư mục dự án hay thư mục con đều vào đúng dự án. Codex, Cursor, Gemini CLI cũng đọc
        được AGENTS.md.
      </p>
    </li>
  )
}

export function Projects() {
  const { go } = useNav()
  const { notify } = useTasks()
  const [list, setList] = useState<WorkspaceSummary[] | null>(null)
  const [unassigned, setUnassigned] = useState<ArtView[]>([])
  const [removing, setRemoving] = useState<WorkspaceSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [l, u] = await Promise.all([api.listWorkspaces(), api.unassignedArts()])
      setList(l)
      setUnassigned(u)
    } catch (e) {
      setList((cur) => cur ?? [])
      notify({ label: 'Đọc danh sách dự án', kind: 'error', text: errorText(e) })
    }
  }, [notify])
  useEffect(() => {
    void load()
  }, [load])

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await api.removeWorkspace({ id: removing.id })
      notify({ label: 'Gỡ dự án', kind: 'done', text: `Đã gỡ ${removing.name}; file trong thư mục vẫn còn` })
      setRemoving(null)
      await load()
    } catch (e) {
      notify({ label: 'Gỡ dự án', kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page page-projects">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dự án</h1>
          <p className="page-sub">
            Mỗi dự án là một thư mục. Mở Claude ở đó là Claude biết ngay bạn đang làm gì.
          </p>
        </div>
        <Button type="primary" icon="plus" onClick={() => go('project-new')}>
          Dự án mới
        </Button>
      </div>
      {list === null ? (
        <p className="empty">Đang đọc…</p>
      ) : (
        <>
          {list.length === 0 && (
            <section className="card ws-empty" aria-label="Chưa có dự án">
              <span className="ws-empty-icon">
                <Icon name="folder" size={32} />
              </span>
              <h2 className="card-title">Chưa có dự án nào</h2>
              <p className="ws-desc">
                Chọn một thư mục (repo game, thư mục in ấn…) và viết brief. Mở Claude ở đó là Claude biết
                palette, kích thước và các art của dự án.
              </p>
              <Button type="primary" icon="plus" onClick={() => go('project-new')}>
                Tạo dự án đầu tiên
              </Button>
            </section>
          )}
          <ul className="ws-grid">
            {list.map((w) => (
              <ProjectCard key={w.id} w={w} onRemove={() => setRemoving(w)} />
            ))}
            {(list.length > 0 || unassigned.length > 0) && <UnassignedCard arts={unassigned} />}
            {list.length > 0 && (
              <li className="ws-new-slot">
                <button
                  type="button"
                  className="card ws-card ws-dashed ws-new"
                  onClick={() => go('project-new')}
                >
                  <Icon name="plus" size={24} className="ws-new-icon" />
                  <span className="ws-new-title">Dự án mới</span>
                  <span className="ws-desc">Chọn thư mục, viết brief, gắn repo.</span>
                </button>
              </li>
            )}
            <TipCard />
          </ul>
        </>
      )}
      {removing && (
        <ConfirmRemove
          name={removing.name}
          busy={busy}
          onConfirm={() => void remove()}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
