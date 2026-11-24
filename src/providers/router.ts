import type { Config } from '../config.ts'
import type { UsageEntry, UsageLog } from '../store/usage.ts'
import { CF_FREE_NEURONS_PER_DAY, CF_USD_PER_NEURON, CloudflareProvider } from './cloudflare.ts'
import { LocalSdProvider } from './localsd.ts'
import { MockProvider } from './mock.ts'
import { RetroDiffusionProvider } from './retrodiffusion.ts'
import type { ImageProvider, Quality, Quote, Task } from './types.ts'

export class BudgetError extends Error {}

export type ProviderMap = Partial<Record<ImageProvider['id'], ImageProvider>>

export function defaultProviders(cfg: Config, fetchImpl?: typeof fetch): ProviderMap {
  return {
    mock: new MockProvider(),
    cloudflare: new CloudflareProvider(cfg.cloudflare, fetchImpl),
    retrodiffusion: new RetroDiffusionProvider(cfg.retroDiffusion, fetchImpl),
    'local-sd': new LocalSdProvider(cfg.localSdUrl, fetchImpl),
  }
}

function supports(p: ImageProvider, task: Task) {
  return task === 'generate'
    ? p.capabilities.generate
    : task === 'edit'
      ? p.capabilities.edit
      : p.capabilities.animate
}

export class ProviderRouter {
  private cfg: Config
  private usage: UsageLog
  readonly providers: ProviderMap
  constructor(cfg: Config, usage: UsageLog, providers: ProviderMap) {
    this.cfg = cfg
    this.usage = usage
    this.providers = providers
  }

  /**
   * Candidate chain. quality "free": configured default, then other free providers (never paid).
   * quality "high": Retro Diffusion only (paid, needs confirmation upstream).
   */
  async chain(task: Task, quality: Quality, explicit?: ImageProvider['id']): Promise<ImageProvider[]> {
    if (explicit) {
      const p = this.providers[explicit]
      if (!p) throw new Error(`unknown provider "${explicit}"`)
      if (!supports(p, task)) throw new Error(`provider ${explicit} cannot ${task}`)
      if (!p.configured()) throw new Error(`provider ${explicit} is not configured (see .env)`)
      return [p]
    }
    if (quality === 'high') {
      const rd = this.providers.retrodiffusion
      if (!rd?.configured()) throw new Error('quality "high" needs RETRO_DIFFUSION_API_KEY in .env')
      if (!supports(rd, task)) throw new Error(`Retro Diffusion cannot ${task}`)
      return [rd]
    }
    const order: ImageProvider['id'][] = [this.cfg.imageProvider, 'cloudflare', 'local-sd']
    const out: ImageProvider[] = []
    for (const id of order) {
      const p = this.providers[id]
      if (!p || out.includes(p) || p.capabilities.paid || !supports(p, task) || !p.configured()) continue
      if (id === 'local-sd' && id !== this.cfg.imageProvider && !(await p.health())) continue
      out.push(p)
    }
    if (out.length === 0) {
      if (task === 'animate')
        throw new Error(
          'no free provider can animate; use quality "high" (Retro Diffusion, needs a key and an approved price) or IMAGE_PROVIDER=mock. Tell the user, then stop: do not write your own image generator or push pixels from scripts. Offer instead: add a free Cloudflare token in Squarel Art Launcher (Cấu hình), photo_to_pixel from their picture, drawing with draw_pixels, or open_in_editor (Aseprite).',
        )
      throw new Error(
        'no image provider is configured: set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN in .env, start services/local-sd, or set IMAGE_PROVIDER=mock. Tell the user, then stop: do not write your own image generator or push pixels from scripts. Offer instead: add a free Cloudflare token in Squarel Art Launcher (Cấu hình), photo_to_pixel from their picture, drawing with draw_pixels, or open_in_editor (Aseprite).',
      )
    }
    return out
  }

  /** Cost that actually leaves the wallet (Cloudflare neurons within the free tier cost $0). */
  async effectiveUsd(q: Quote): Promise<number> {
    if (q.unitKind !== 'neuron') return q.usd
    const s = await this.usage.summary()
    const over =
      Math.max(0, s.todayNeurons + q.units - CF_FREE_NEURONS_PER_DAY) -
      Math.max(0, s.todayNeurons - CF_FREE_NEURONS_PER_DAY)
    return over * CF_USD_PER_NEURON
  }

  async checkBudget(q: Quote): Promise<{ effectiveUsd: number; todayUsd: number }> {
    const s = await this.usage.summary()
    const eff = await this.effectiveUsd(q)
    if (eff > 0 && s.todayUsd + eff > this.cfg.dailyBudgetUsd + 1e-9)
      throw new BudgetError(
        `daily image budget reached: spent $${s.todayUsd.toFixed(3)} today, this call ~$${eff.toFixed(3)}, cap $${this.cfg.dailyBudgetUsd} (IMAGE_DAILY_BUDGET_USD)`,
      )
    return { effectiveUsd: eff, todayUsd: s.todayUsd }
  }

  async record(e: Omit<UsageEntry, 'ts'>): Promise<void> {
    await this.usage.append({ ts: new Date().toISOString(), ...e })
  }

  async status() {
    const s = await this.usage.summary()
    const providers = await Promise.all(
      Object.values(this.providers).map(async (p) => ({
        id: p!.id,
        configured: p!.configured(),
        paid: p!.capabilities.paid,
        default: p!.id === this.cfg.imageProvider,
      })),
    )
    return {
      ...s,
      cloudflareFreeNeuronsLeft: Math.max(0, CF_FREE_NEURONS_PER_DAY - s.todayNeurons),
      dailyBudgetUsd: this.cfg.dailyBudgetUsd,
      providers,
    }
  }
}
