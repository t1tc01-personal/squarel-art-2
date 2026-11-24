import { useEffect, useState } from 'react'
import type { About, EnvView, RecentArt } from '../api'
import { api } from '../api'
import { errorText, report, useData, useTasks } from '../app-context'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon, PixelGrid } from '../components/Icon'
import { ago } from '../format'
import { useNav } from '../nav'

/** Example sprites from design.md, used as project thumbnails (projects carry no preview). */
const SPRITES = [
  {
    rows: ['..####..', '.######.', '.#.##.#.', '.######.', '..####..', '.######.', '#.####.#', '..#..#..'],
    fg: '#C2C3C7',
    bg: '#1F232C',
  },
  {
    rows: ['........', '..####..', '.######.', '##.##.##', '########', '########', '.######.', '........'],
    fg: '#00E436',
    bg: '#0B2A16',
  },
  {
    rows: ['...##...', '....#...', '.######.', '########', '########', '########', '.######.', '..####..'],
    fg: '#FF004D',
    bg: '#1D2B53',
  },
] as const

const PROMPTS = [
  '/pixel-new một hiệp sĩ 32×32 cho game',
  '/pixel-from-photo meo.jpg làm avatar 48px',
  'thêm viền đen rồi xuất sprite sheet',
  '/pixel-export in lên áo khổ 30cm',
]

export function Home() {
  const { go } = useNav()
  const { presence } = useData()
  const { notify } = useTasks()
  const [arts, setArts] = useState<RecentArt[]>([])
  const [about, setAbout] = useState<About | null>(null)
  const [env, setEnv] = useState<EnvView | null>(null)

  useEffect(() => {
    api.recentArts().then(setArts, report('arts:recent'))
    api.about().then(setAbout, report('app:about'))
    api.getEnv().then(setEnv, report('env:get'))
  }, [])

  // An art is "open" when a bridge tool row shows its ref.
  const openRefs = presence
    .filter((g) => g.id === 'tools')
    .flatMap((g) => g.items.filter((i) => i.status !== 'offline').map((i) => i.subtitle.split(' · ')[0]))

  const dataDir = env?.DATA_DIR.value
  return (
    <div className="page page-home">
      <h1 className="sr-only">Trang chủ</h1>
      <Banner>
        {about?.squarelVersion && (
          <span className="banner-pill">Squarel Art v{about.squarelVersion} đã sẵn sàng</span>
        )}
        <h2 className="banner-title">
          Vẽ pixel art bằng lời,
          <br />
          chỉnh tay trong công cụ vẽ
        </h2>
        <p className="banner-text">
          Nói với Claude điều bạn muốn vẽ. Launcher giữ bridge chạy để công cụ vẽ và Claude luôn thấy cùng một
          bản.
        </p>
        <div className="banner-actions">
          <Button type="secondary" onClick={() => window.open(`${about?.repoUrl ?? ''}/releases`)}>
            Xem có gì mới
          </Button>
          <Button type="ghost" onClick={() => go('library')}>
            Hướng dẫn nhanh
          </Button>
        </div>
      </Banner>

      <div className="section-head">
        <h2 className="section-title">Art gần đây</h2>
      </div>
      {arts.length === 0 ? (
        <p className="empty">Chưa có art nào. Thử một câu lệnh bên dưới trong Claude Code.</p>
      ) : (
        <ul className="project-grid" aria-label="Art gần đây">
          {arts.map((p, i) => {
            const s = SPRITES[i % SPRITES.length] ?? SPRITES[0]
            const size = p.width && p.height ? `${p.width}×${p.height}` : undefined
            const open = openRefs.includes(p.ref)
            return (
              <li key={p.ref} className="card project-card">
                <span className="project-thumb" style={{ background: s.bg, color: s.fg }}>
                  <PixelGrid rows={s.rows} cell={7} />
                </span>
                <span className="project-text">
                  <span className="row-title">{p.name}</span>
                  <span className="row-sub">{p.projectName}</span>
                  <span className="row-sub">
                    {[size, p.version, ago(p.updatedAt)].filter(Boolean).join(' · ')}
                  </span>
                  {open && <span className="project-open">Đang mở trong công cụ vẽ</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <h2 className="section-title">Thử trong Claude Code</h2>
      <ul className="prompt-list">
        {PROMPTS.map((p) => (
          <li key={p} className="prompt-chip mono-small">
            <Icon name="sparkle" className="is-brand" />
            {p}
          </li>
        ))}
      </ul>
      {dataDir && (
        <p className="row-sub">
          <button
            type="button"
            className="link"
            onClick={() =>
              api
                .reveal({ path: dataDir })
                .catch((e) => notify({ label: 'Thư mục dữ liệu', kind: 'error', text: errorText(e) }))
            }
          >
            Thư mục dữ liệu (log, art cũ) →
          </button>
        </p>
      )}
    </div>
  )
}
