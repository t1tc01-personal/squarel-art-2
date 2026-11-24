/**
 * "Art cũ": arts still in DATA_DIR/projects from before art moved into project folders. The card
 * lists them; "Chuyển vào dự án…" opens a dialog whose confirm starts the Squarel CLI `art_import`
 * as a visible task (nothing runs before that click).
 */
import { useState } from 'react'
import type { ArtView, WorkspaceSummary } from '../../shared/ipc'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { ArtThumb } from './project-ui'

function ImportDialog({
  art,
  projects,
  busy,
  onConfirm,
  onClose,
}: {
  art: ArtView
  projects: WorkspaceSummary[]
  busy: boolean
  onConfirm(workspaceId: string): void
  onClose(): void
}) {
  const [picked, setPicked] = useState(projects[0]?.id ?? '')
  const target = projects.find((p) => p.id === picked)
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-import-title"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="ws-import-title" className="modal-title">
          Chuyển art cũ vào dự án
        </h2>
        <p className="modal-text">
          {art.name} · {art.slug}
        </p>
        {projects.length === 0 ? (
          <p className="modal-text">Chưa có dự án nào để chuyển vào. Hãy tạo một dự án trước.</p>
        ) : (
          <fieldset className="wiz-options" aria-label="Chọn dự án">
            <legend className="row-sub">CHỌN DỰ ÁN</legend>
            {projects.map((p) => (
              <label key={p.id} className={`wiz-option${picked === p.id ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  className="wiz-radio"
                  name="import-project"
                  checked={picked === p.id}
                  onChange={() => setPicked(p.id)}
                />
                <span className="wiz-option-text">
                  <span className="row-title">{p.name}</span>
                  <span className="row-sub">{p.folder}\squarel_art</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {target && (
          <p className="modal-text" data-testid="import-confirm-text">
            Chuyển "{art.name}" vào {target.name}? Art sẽ được chép sang {target.folder}\squarel_art, kiểm tra
            xong mới xoá bản cũ.
          </p>
        )}
        <div className="modal-actions">
          <Button type="ghost" autoFocus onClick={onClose}>
            Huỷ
          </Button>
          <Button type="primary" disabled={busy || !target} onClick={() => target && onConfirm(target.id)}>
            {target ? `Chuyển vào ${target.name}` : 'Chuyển'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function LegacyCard({
  arts,
  projects,
  busy,
  onImport,
}: {
  arts: ArtView[]
  projects: WorkspaceSummary[]
  busy: boolean
  onImport(slug: string, workspaceId: string): void
}) {
  const [open, setOpen] = useState(false)
  const [choosing, setChoosing] = useState<ArtView | null>(null)
  return (
    <li className="card ws-card ws-dashed" aria-label="Art cũ" data-testid="ws-legacy">
      <h3 className="ws-name ws-name-icon">
        <Icon name="list" />
        Art cũ
      </h3>
      <p className="ws-desc">
        {arts.length} art từ bản cũ còn trong DATA_DIR. Chuyển vào một dự án để vẽ tiếp, giữ nguyên lịch sử.
      </p>
      {open ? (
        <ul className="ws-legacy-list">
          {arts.map((a) => (
            <li key={a.slug} className="ws-legacy-row" aria-label={a.name}>
              <ArtThumb art={a} size={32} />
              <span className="row-title">{a.name}</span>
              <Button type="secondary" onClick={() => setChoosing(a)}>
                Chuyển vào dự án…
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Button type="secondary" onClick={() => setOpen(true)}>
          Xem và chuyển…
        </Button>
      )}
      {choosing && (
        <ImportDialog
          art={choosing}
          projects={projects}
          busy={busy}
          onConfirm={(id) => {
            onImport(choosing.slug, id)
            setChoosing(null)
          }}
          onClose={() => setChoosing(null)}
        />
      )}
    </li>
  )
}
