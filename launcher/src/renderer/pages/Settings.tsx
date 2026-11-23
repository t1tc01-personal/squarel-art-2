/**
 * Settings: `.env` values through env:set (secrets only ever shown masked, typed values replace
 * them), launcher options through state:set, and the About section (spec §15).
 */
import { type ReactNode, useEffect, useState } from 'react'
import { type About, api, type EnvKey, type EnvView } from '../api'
import { errorText, report, useData, useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { StatusPill } from '../components/StatusPill'
import { SubTabs } from '../components/SubTabs'

type Drafts = Partial<Record<EnvKey, string>>

const PROVIDERS = [
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'local-sd', label: 'GPU của máy' },
  { id: 'mock', label: 'Mock (thử)' },
] as const
type Provider = (typeof PROVIDERS)[number]['id']

function Card({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="card settings-card" aria-label={title}>
      <div className="settings-card-head">
        <h2 className="card-title">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange(v: boolean): void
}) {
  return (
    <div className="toggle-row">
      <span>
        <span className="row-title">{label}</span>
        <span className="row-sub">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  )
}

export function Settings() {
  const { state, setState, components } = useData()
  const { notify } = useTasks()
  const [env, setEnv] = useState<EnvView | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [about, setAbout] = useState<About | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getEnv().then(setEnv, report('env:get'))
    api.about().then(setAbout, report('app:about'))
  }, [])

  const value = (k: EnvKey) => drafts[k] ?? (env?.[k].secret ? '' : (env?.[k].value ?? ''))
  const draft = (k: EnvKey, v: string) => {
    setSaved(false)
    setDrafts((d) => ({ ...d, [k]: v }))
  }
  const secretField = (k: EnvKey, label: string) => (
    <Field
      label={label}
      type="password"
      autoComplete="off"
      spellCheck={false}
      value={drafts[k] ?? ''}
      placeholder={env?.[k].set ? env[k].value : 'Chưa nhập'}
      state={env?.[k].set && drafts[k] === undefined ? 'valid' : 'default'}
      hint={env?.[k].set ? 'Đã lưu (đang che). Nhập giá trị mới để thay.' : undefined}
      onChange={(e) => draft(k, e.target.value)}
    />
  )
  const plainField = (k: EnvKey, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field
      label={label}
      value={value(k)}
      spellCheck={false}
      onChange={(e) => draft(k, e.target.value)}
      {...extra}
    />
  )

  const pickInto = async (k: EnvKey, pick: () => Promise<string | null>) => {
    try {
      const p = await pick()
      if (p) draft(k, p)
    } catch (e) {
      notify({ label: 'Chọn đường dẫn', kind: 'error', text: errorText(e) })
    }
  }

  const dirty = Object.keys(drafts) as EnvKey[]
  const save = async () => {
    setSaving(true)
    try {
      let view = env
      for (const key of dirty) view = await api.setEnv({ key, value: drafts[key] ?? '' })
      setEnv(view)
      setDrafts({})
      setSaved(true)
      notify({
        label: 'Lưu thay đổi',
        kind: 'done',
        text: dirty.includes('BRIDGE_PORT')
          ? 'Đã ghi .env · bridge khởi động lại trên cổng mới'
          : 'Đã ghi .env',
      })
    } catch (e) {
      notify({ label: 'Lưu thay đổi', kind: 'error', text: errorText(e) })
      api.getEnv().then(setEnv, report('env:get'))
    } finally {
      setSaving(false)
    }
  }

  const setOption = async (patch: { closeToTray?: boolean; autostart?: boolean }) => {
    try {
      setState(await api.setState(patch))
    } catch (e) {
      notify({ label: 'Cài đặt', kind: 'error', text: errorText(e) })
    }
  }

  /** Same rule as the wizard: main accepts only a folder whose package.json is named squarel-art. */
  const pickSquarel = async () => {
    try {
      const dir = await api.pickFolder()
      if (!dir) return
      setState(await api.setState({ squarelDir: dir, mode: 'clone' }))
      api.getEnv().then(setEnv, report('env:get'))
      api.about().then(setAbout, report('app:about'))
    } catch (e) {
      notify({ label: 'Chọn thư mục Squarel', kind: 'error', text: errorText(e) })
    }
  }
  const reopenSetup = async () => {
    try {
      await api.setState({ setupStep: 1 })
      location.reload() // Root asks main for setup:info again and shows the wizard
    } catch (e) {
      notify({ label: 'Mở trình thiết lập', kind: 'error', text: errorText(e) })
    }
  }

  const provider = (value('IMAGE_PROVIDER') || 'cloudflare') as Provider
  const aseprite = state?.selected.includes('aseprite') && components.some((c) => c.id === 'aseprite')
  const envFile = state?.squarelDir ? `${state.squarelDir}\\.env` : undefined

  return (
    <div className="page page-settings">
      <div className="page-head">
        <div>
          <h1 className="page-title">Cài đặt</h1>
          <p className="page-sub">Ghi vào .env của Squarel. Đổi cổng thì launcher tự khởi động lại bridge.</p>
        </div>
        <div className="page-actions">
          {envFile && (
            <Button
              type="ghost"
              icon="folder"
              onClick={() =>
                api
                  .reveal({ path: envFile })
                  .catch((e) => notify({ label: 'Mở file .env', kind: 'error', text: errorText(e) }))
              }
            >
              Mở file .env
            </Button>
          )}
          <Button type="primary" disabled={saving || dirty.length === 0 || !envFile} onClick={save}>
            {saving ? 'Đang lưu…' : saved && dirty.length === 0 ? 'Đã lưu' : 'Lưu thay đổi'}
          </Button>
        </div>
      </div>

      {!envFile && (
        <section className="card settings-missing" role="alert" aria-label="Chưa có thư mục Squarel">
          <div>
            <h2 className="card-title">Chưa có thư mục Squarel</h2>
            <p className="row-sub">
              Cấu hình được ghi vào file .env trong repo Squarel. Chọn repo đã clone, hoặc mở lại trình thiết
              lập để tải về.
            </p>
          </div>
          <div className="page-actions">
            <Button type="secondary" icon="folder" onClick={() => void pickSquarel()}>
              Chọn thư mục Squarel
            </Button>
            <Button type="primary" onClick={() => void reopenSetup()}>
              Mở trình thiết lập
            </Button>
          </div>
        </section>
      )}

      <div className="settings-grid">
        <div className="settings-col">
          <Card title="Dữ liệu">
            {plainField('DATA_DIR', 'Thư mục dữ liệu (DATA_DIR)', {
              readOnly: true,
              action: { label: 'Chọn', onClick: () => void pickInto('DATA_DIR', () => api.pickFolder()) },
              hint: 'Project, lịch sử và log. Nên đặt trong OneDrive để tự backup.',
            })}
          </Card>
          <Card
            title="Ảnh AI"
            badge={
              <StatusPill level="ok" label={PROVIDERS.find((p) => p.id === provider)?.label ?? provider} />
            }
          >
            <SubTabs
              tabs={PROVIDERS}
              active={provider}
              onSelect={(p) => draft('IMAGE_PROVIDER', p)}
              label="Nguồn ảnh AI"
            />
            {provider === 'cloudflare' && (
              <>
                {secretField('CLOUDFLARE_API_TOKEN', 'Cloudflare API token')}
                {secretField('CLOUDFLARE_ACCOUNT_ID', 'Cloudflare account ID')}
              </>
            )}
            {provider === 'local-sd' &&
              plainField('LOCAL_SD_URL', 'Địa chỉ máy chủ ảnh', { placeholder: 'http://127.0.0.1:7860' })}
            <div className="field-pair">
              {secretField('RETRO_DIFFUSION_API_KEY', 'Retro Diffusion key')}
              {plainField('IMAGE_DAILY_BUDGET_USD', 'Trần chi phí / ngày (USD)', { inputMode: 'decimal' })}
            </div>
          </Card>
        </div>
        <div className="settings-col">
          {aseprite && (
            <Card title="Aseprite">
              {plainField('ASEPRITE_PATH', 'ASEPRITE_PATH', {
                readOnly: true,
                action: {
                  label: 'Chọn',
                  onClick: () =>
                    void pickInto('ASEPRITE_PATH', () =>
                      api.pickFile({ filters: [{ name: 'Aseprite', extensions: ['exe'] }] }),
                    ),
                },
              })}
            </Card>
          )}
          <Card title="Bridge & khởi động">
            {plainField('BRIDGE_PORT', 'Cổng bridge', { inputMode: 'numeric', placeholder: '4321' })}
            <Toggle
              label="Thu xuống khay khi đóng cửa sổ"
              hint="Giữ bridge chạy để công cụ vẽ vẫn đồng bộ."
              checked={!!state?.closeToTray}
              onChange={(v) => void setOption({ closeToTray: v })}
            />
            <Toggle
              label="Khởi động cùng Windows"
              hint="Mở launcher ẩn dưới khay khi đăng nhập."
              checked={!!state?.autostart}
              onChange={(v) => void setOption({ autostart: v })}
            />
          </Card>
          <Card title="Giới thiệu">
            <dl className="about" data-testid="about">
              <dt className="caption">Launcher</dt>
              <dd className="mono-value">v{about?.launcherVersion ?? '…'}</dd>
              <dt className="caption">Squarel</dt>
              <dd className="mono-value">{about?.squarelVersion ? `v${about.squarelVersion}` : 'chưa có'}</dd>
              <dt className="caption">Giấy phép</dt>
              <dd>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    api
                      .openLicense()
                      .catch((e) => notify({ label: 'LICENSE.md', kind: 'error', text: errorText(e) }))
                  }
                >
                  PolyForm Shield 1.0.0 (LICENSE.md)
                </button>
              </dd>
              <dt className="caption">Mã nguồn</dt>
              <dd>
                {about && (
                  <a className="link" href={about.repoUrl} target="_blank" rel="noreferrer">
                    {about.repoUrl.replace(/^https:\/\/github\.com\//, 'GitHub · ')}
                  </a>
                )}
              </dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}
