import { useEffect, useState } from 'react'
import { ENV_KEYS, type EnvKey, type EnvView, type SetupInfo } from '../../shared/ipc'
import type { CheckResult } from '../../shared/model'
import { api } from '../api'
import { errorText, report, useData, useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Icon } from '../components/Icon'
import { InstallProgress } from '../components/InstallProgress'
import { StatusPill } from '../components/StatusPill'
import { StepFrame, type StepProps } from './Wizard'

type Provider = 'cloudflare' | 'local-sd' | 'mock'
type Integration = SetupInfo['integrations'][number]

/** Step 3: `.env` (image AI, Retro Diffusion, DATA_DIR) and how to install each integration. */
export function Step3(props: StepProps) {
  const { info, go } = props
  const { notify } = useTasks()
  const [env, setEnv] = useState<EnvView | null>(null)
  const [drafts, setDrafts] = useState<Partial<Record<EnvKey, string>>>({})
  const [cf, setCf] = useState<CheckResult | 'running' | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getEnv().then(setEnv, report('env:get'))
  }, [])

  const localSd = !!info.tools.find((t) => t.id === 'local-sd')?.installed
  const value = (k: EnvKey) => drafts[k] ?? (env?.[k].secret ? '' : (env?.[k].value ?? ''))
  const draft = (k: EnvKey, v: string) => setDrafts((d) => ({ ...d, [k]: v }))
  const current = (value('IMAGE_PROVIDER') || 'cloudflare') as Provider
  const provider: Provider = current === 'local-sd' && !localSd ? 'cloudflare' : current

  /** Writes the drafts to .env (main validates each key); keeps nothing secret in the renderer. */
  const save = async (): Promise<boolean> => {
    try {
      let view = env
      const keys = Object.keys(drafts) as EnvKey[]
      for (const key of keys) {
        const v = drafts[key] ?? ''
        if (view?.[key].secret && v === '') continue // empty = keep the stored secret
        view = await api.setEnv({ key, value: v })
      }
      if (!env?.IMAGE_PROVIDER.set && !keys.includes('IMAGE_PROVIDER'))
        view = await api.setEnv({ key: 'IMAGE_PROVIDER', value: provider })
      setEnv(view)
      setDrafts({})
      return true
    } catch (e) {
      notify({ label: 'Lưu cấu hình', kind: 'error', text: errorText(e) })
      return false
    }
  }

  const verify = async () => {
    if (!(await save())) return
    setCf('running')
    try {
      setCf(await api.runCheck({ id: 'cloudflare-token' }))
    } catch (e) {
      setCf(null)
      notify({ label: 'Kiểm tra token', kind: 'error', text: errorText(e) })
    }
  }

  const pickDataDir = async () => {
    try {
      const dir = await api.pickFolder()
      if (dir) setEnv(await api.setEnv({ key: 'DATA_DIR', value: dir }))
    } catch (e) {
      notify({ label: 'Thư mục dữ liệu', kind: 'error', text: errorText(e) })
    }
  }

  const secretField = (k: EnvKey, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field
      label={label}
      type="password"
      autoComplete="off"
      spellCheck={false}
      value={drafts[k] ?? ''}
      placeholder={env?.[k].set ? env[k].value : 'Chưa nhập'}
      onChange={(e) => draft(k, e.target.value)}
      {...extra}
    />
  )

  const cfText =
    cf === 'running'
      ? 'Đang kiểm tra…'
      : cf?.result === 'pass'
        ? `Hợp lệ · ${cf.detail}`
        : cf?.result === 'warn'
          ? `Chưa kiểm tra được: ${cf.detail}`
          : cf
            ? `Không hợp lệ: ${cf.detail}`
            : undefined

  const tabs: { id: Provider; label: string; disabled?: boolean }[] = [
    { id: 'cloudflare', label: 'Cloudflare' },
    { id: 'local-sd', label: 'GPU của máy', disabled: !localSd },
    { id: 'mock', label: 'Mock (thử)' },
  ]

  return (
    <StepFrame
      step={3}
      title="Cấu hình"
      intro="Mọi giá trị được ghi vào file .env của Squarel. Đổi lại được bất cứ lúc nào ở mục Cài đặt."
      footer={
        <>
          <Button type="ghost" onClick={() => void go(2)}>
            Quay lại
          </Button>
          <span className="wiz-footer-spacer" />
          <span className="wiz-footer-hint">
            Khoá chỉ lưu trong .env trên máy này; token chỉ gửi tới Cloudflare khi bạn bấm Kiểm tra
          </span>
          <Button
            type="primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              const ok = await save()
              setSaving(false)
              if (ok) await go(4)
            }}
          >
            Lưu & tiếp tục
          </Button>
        </>
      }
    >
      <div className="wiz-grid">
        <div className="wiz-grid-col">
          <section className="card wiz-card" aria-label="Tạo ảnh AI">
            <div className="wiz-card-head">
              <h2 className="card-title">Tạo ảnh AI</h2>
              <StatusPill level="ok" label="Miễn phí" />
            </div>
            <div className="subtabs" role="tablist" aria-label="Nguồn ảnh AI">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={provider === t.id}
                  disabled={t.disabled}
                  title={t.disabled ? 'Chưa thấy máy chủ ảnh cục bộ (LOCAL_SD_URL) đang chạy' : undefined}
                  className={`subtab${provider === t.id ? ' is-active' : ''}`}
                  onClick={() => draft('IMAGE_PROVIDER', t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {provider === 'cloudflare' && (
              <>
                {secretField('CLOUDFLARE_ACCOUNT_ID', 'Cloudflare account ID')}
                {secretField('CLOUDFLARE_API_TOKEN', 'Cloudflare API token', {
                  state:
                    cf !== 'running' && cf?.result === 'pass'
                      ? 'valid'
                      : cf && cf !== 'running' && cf.result === 'fail'
                        ? 'error'
                        : 'default',
                  action: { label: 'Kiểm tra', onClick: () => void verify() },
                })}
                {cfText && (
                  <p
                    className={`wiz-check is-${cf === 'running' ? 'running' : cf?.result}`}
                    data-testid="cloudflare-result"
                  >
                    {cfText}
                  </p>
                )}
              </>
            )}
            {provider === 'local-sd' && (
              <Field
                label="Địa chỉ máy chủ ảnh"
                value={value('LOCAL_SD_URL')}
                spellCheck={false}
                onChange={(e) => draft('LOCAL_SD_URL', e.target.value)}
              />
            )}
            {provider === 'mock' && (
              <p className="row-sub">Ảnh mẫu tạo ngay, không cần mạng, $0. Dùng để thử trước khi có key.</p>
            )}
          </section>
          <section className="card wiz-card" aria-label="Retro Diffusion">
            <div className="wiz-card-head">
              <h2 className="card-title">Retro Diffusion</h2>
              <StatusPill level="idle" label="Tuỳ chọn · trả phí" />
            </div>
            <div className="field-pair">
              {secretField('RETRO_DIFFUSION_API_KEY', 'API key')}
              <Field
                label="Trần chi phí / ngày (USD)"
                value={value('IMAGE_DAILY_BUDGET_USD')}
                inputMode="decimal"
                placeholder="1.00"
                onChange={(e) => draft('IMAGE_DAILY_BUDGET_USD', e.target.value)}
              />
            </div>
          </section>
          <section className="card wiz-card" aria-label="Dữ liệu">
            <h2 className="card-title">Nơi lưu project và lịch sử</h2>
            <Field
              label="Thư mục dữ liệu (DATA_DIR)"
              value={env?.DATA_DIR.value ?? ''}
              placeholder="Mặc định: ~\SquarelArt-data"
              readOnly
              action={{ label: 'Chọn…', onClick: () => void pickDataDir() }}
              hint="Đặt trong OneDrive/Google Drive để tự backup. Mọi project, version, file xuất nằm ở đây."
            />
          </section>
        </div>
        <div className="wiz-grid-col">
          {info.integrations.map((i) => (
            <IntegrationCard key={i.id} {...props} integration={i} onEnvChanged={setEnv} />
          ))}
          {info.integrations.length === 0 && (
            <section className="card wiz-card">
              <p className="row-sub">Squarel này chưa khai báo tích hợp nào.</p>
            </section>
          )}
        </div>
      </div>
    </StepFrame>
  )
}

function IntegrationCard({
  integration: i,
  info,
  state,
  log,
  builds,
  setBuild,
  reload,
  onEnvChanged,
}: StepProps & {
  integration: Integration
  onEnvChanged(v: EnvView): void
}) {
  const { run, notify } = useTasks()
  const { setState } = useData()
  const selected = !!state?.selected.includes(i.id)
  const choice = selected ? (state?.installChoice[i.id] ?? null) : 'skip'
  const opt = i.options.find((o) => o.id === choice)
  const buildTask = builds[i.id]
  const buildEnd = log.final(buildTask)
  const building = !!buildTask && !buildEnd
  const vs = info.tools.find((t) => t.id === 'vs-build-tools')
  const isAsepriteBuild = i.id === 'aseprite' && !!opt?.command

  const choose = async (id: string | 'skip') => {
    if (!state) return
    try {
      const sel = state.selected.filter((x) => x !== i.id)
      const installChoice = { ...state.installChoice }
      delete installChoice[i.id]
      if (id !== 'skip') {
        sel.push(i.id)
        installChoice[i.id] = id
      }
      setState(await api.setState({ selected: sel, installChoice }))
    } catch (e) {
      notify({ label: i.name, kind: 'error', text: errorText(e) })
    }
  }

  const pickExe = async () => {
    if (!opt?.pickFile) return
    try {
      const p = await api.pickFile({ filters: [{ name: opt.pickFile, extensions: ['exe'] }] })
      if (!p) return
      const key = opt.setEnv as EnvKey | undefined
      if (!key || !(ENV_KEYS as readonly string[]).includes(key)) {
        notify({ label: i.name, kind: 'error', text: 'Đặt đường dẫn này trong trang Cài đặt' })
        return
      }
      onEnvChanged(await api.setEnv({ key, value: p }))
      await reload()
    } catch (e) {
      notify({ label: i.name, kind: 'error', text: errorText(e) })
    }
  }

  const startBuild = async () => {
    if (!opt?.command) return
    const taskId = await run({
      componentId: i.id,
      kind: 'install',
      id: opt.id,
      label: `${opt.label} (${i.name})`,
      needsConsent: {
        command: opt.command,
        ...(i.id === 'aseprite'
          ? { sizeHint: '~1 GB tải về (mã nguồn Aseprite + Skia), cần VS Build Tools ~7 GB, build ~6 phút' }
          : {}),
      },
    })
    if (taskId) setBuild(i.id, taskId)
  }

  const vsAction = vs?.installed
    ? undefined
    : info.winget
      ? {
          componentId: 'vs-build-tools',
          kind: 'terminal' as const,
          id: 'winget',
          label: 'Cài Visual Studio Build Tools',
          ...(vs?.actions[0]?.needsConsent ? { needsConsent: vs.actions[0].needsConsent } : {}),
        }
      : {
          componentId: 'vs-build-tools',
          kind: 'terminal' as const,
          id: 'download',
          label: 'Mở trang tải Build Tools',
        }

  const options = [
    ...i.options.map((o) => ({ id: o.id, label: o.label, note: o.note })),
    {
      id: 'skip',
      label: 'Bỏ qua',
      note: 'Không dùng công cụ này lúc này; thêm lại sau ở Thư viện tích hợp.',
    },
  ]

  return (
    <section className="card wiz-card" aria-label={i.name}>
      <h2 className="card-title">{i.name}</h2>
      {/* While the build runs the choice is fixed: the card shows only its progress. */}
      {!building && (
        <fieldset className="wiz-options" aria-label={`Cách cài ${i.name}`}>
          {options.map((o) => (
            <label key={o.id} className={`wiz-option${choice === o.id ? ' is-selected' : ''}`}>
              <input
                type="radio"
                className="wiz-radio"
                name={`install-${i.id}`}
                checked={choice === o.id}
                onChange={() => void choose(o.id)}
              />
              <span className="wiz-option-text">
                <span className="row-title">{o.label}</span>
                {o.note && <span className="row-sub">{o.note}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {isAsepriteBuild && (
        <>
          <p className="wiz-notice" data-testid="eula-notice">
            <Icon name="alert" size={16} />
            <span>
              EULA của Aseprite chỉ cho phép tự build để dùng cá nhân. Không chia sẻ hay phát tán bản đã
              build.{' '}
              <a className="link" href={info.asepriteEula} target="_blank" rel="noreferrer">
                Đọc EULA của Aseprite
              </a>
            </span>
          </p>
          {!building && (
            <div className="wiz-row is-sub">
              <span className="wiz-row-text">
                <span className="row-title">Visual Studio Build Tools</span>
                <span className="row-sub">
                  Cần để build (~7 GB). Trình cài của Visual Studio mở cửa sổ riêng; bạn bấm Install ở đó.
                </span>
              </span>
              <StatusPill
                level={vs?.installed ? 'ok' : 'idle'}
                label={vs?.installed ? `Có sẵn ${vs.version ?? ''}`.trim() : 'Chưa cài'}
              />
              {vsAction && (
                <Button type="secondary" onClick={() => void run(vsAction)}>
                  Cài Build Tools
                </Button>
              )}
            </div>
          )}
          {buildTask ? (
            <InstallProgress
              taskId={buildTask}
              name={i.name}
              verb="build"
              runningNote="Lần đầu mất 15–40 phút. Bạn có thể sang bước 4 hoặc thu nhỏ launcher, build vẫn chạy nền."
              retryNote="Các bước đã xong được giữ lại; thử lại sẽ chạy tiếp. Bấm Xem log để xem dòng lỗi."
              doneNote="Đã ghi ASEPRITE_PATH vào .env"
              onRetry={() => void startBuild()}
            />
          ) : (
            <div className="wiz-row is-sub" data-testid="build-status">
              <span className="wiz-row-text">
                <span className="row-title">Build Aseprite</span>
                <span className="row-sub">Chạy nền; bạn tiếp tục được sang bước 4.</span>
              </span>
              <Button type="primary" onClick={() => void startBuild()}>
                Bắt đầu build
              </Button>
            </div>
          )}
        </>
      )}

      {opt?.pickFile && (
        <div className="wiz-row is-sub">
          <span className="wiz-row-text">
            <span className="row-title">File {opt.pickFile}</span>
            <span className="row-sub">{opt.setEnv ? `Lưu vào ${opt.setEnv} trong .env` : ''}</span>
          </span>
          <Button type="secondary" icon="folder" onClick={() => void pickExe()}>
            Chọn file
          </Button>
        </div>
      )}
      {i.id === 'aseprite' && opt?.pickFile && (
        <p className="wiz-notice is-warn">
          <Icon name="alert" size={16} />
          <span>Bản dùng thử (trial) không chạy được: nó tắt scripting và tắt lưu file.</span>
        </p>
      )}
    </section>
  )
}
