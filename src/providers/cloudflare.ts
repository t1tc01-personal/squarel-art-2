import type { Config } from '../config.ts'
import { b64ToBytes, fetchRetry, mapLimit } from './http.ts'
import { editPrompt, generalPrompt } from './prompts.ts'
import {
  type EditRequest,
  type GenRequest,
  type ImageProvider,
  ProviderError,
  type Quote,
  type RawImage,
  type Task,
} from './types.ts'

export const CF_FREE_NEURONS_PER_DAY = 10_000
export const CF_USD_PER_NEURON = 0.011 / 1000

const MODELS = {
  generate: '@cf/black-forest-labs/flux-1-schnell',
  img2img: '@cf/runwayml/stable-diffusion-v1-5-img2img',
  inpaint: '@cf/runwayml/stable-diffusion-v1-5-inpainting',
}
const FLUX_STEPS = 4
// flux-1-schnell: 4.8 neurons per 512×512 tile + 9.6 per step (Cloudflare pricing page, 2026).
const FLUX_NEURONS = 4.8 + 9.6 * FLUX_STEPS
// SD 1.5 img2img/inpainting: conservative estimate; verify against the Cloudflare dashboard.
const SD15_NEURONS = 60

/** Cloudflare Workers AI. General-purpose models: results always go through normalize(). */
export class CloudflareProvider implements ImageProvider {
  readonly id = 'cloudflare' as const
  readonly capabilities = {
    generate: true,
    edit: true,
    inpaint: true,
    animate: false,
    nativePixel: false,
    paletteInput: false,
    paid: false,
  }
  private cfg: Config['cloudflare']
  private fetchImpl?: typeof fetch
  constructor(cfg: Config['cloudflare'], fetchImpl?: typeof fetch) {
    this.cfg = cfg
    this.fetchImpl = fetchImpl
  }
  configured() {
    return Boolean(this.cfg.accountId && this.cfg.token)
  }
  async health() {
    return this.configured()
  }
  async quote(task: Task, req: GenRequest): Promise<Quote> {
    const per = task === 'generate' ? FLUX_NEURONS : SD15_NEURONS
    const units = per * req.variants
    return {
      usd: units * CF_USD_PER_NEURON,
      units,
      unitKind: 'neuron',
      model: task === 'generate' ? MODELS.generate : MODELS.img2img,
    }
  }

  private url(model: string) {
    if (!this.configured())
      throw new ProviderError('Cloudflare is not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)')
    return `https://api.cloudflare.com/client/v4/accounts/${this.cfg.accountId}/ai/run/${model}`
  }

  private async run(model: string, body: unknown, signal?: AbortSignal): Promise<Uint8Array> {
    const res = await fetchRetry(
      this.url(model),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { signal, fetchImpl: this.fetchImpl },
    )
    const type = res.headers.get('content-type') ?? ''
    if (type.startsWith('image/')) return new Uint8Array(await res.arrayBuffer())
    const json = (await res.json()) as {
      success?: boolean
      result?: { image?: string }
      errors?: { message: string }[]
    }
    if (json.success === false || !json.result?.image)
      throw new ProviderError(
        `Cloudflare error: ${json.errors?.map((e) => e.message).join('; ') || 'no image returned'}`,
      )
    return b64ToBytes(json.result.image)
  }

  async generate(req: GenRequest, signal?: AbortSignal): Promise<RawImage[]> {
    const prompt = generalPrompt(req.prompt, req)
    const base = req.seed ?? Math.floor(Math.random() * 1e9)
    return mapLimit(
      Array.from({ length: req.variants }, (_, i) => base + i * 101),
      2,
      async (seed) => ({
        bytes: await this.run(MODELS.generate, { prompt, steps: FLUX_STEPS, seed }, signal),
        seed,
      }),
    )
  }

  async edit(req: EditRequest, signal?: AbortSignal): Promise<RawImage[]> {
    const prompt = editPrompt(req.prompt)
    const base = req.seed ?? Math.floor(Math.random() * 1e9)
    return mapLimit(
      Array.from({ length: req.variants }, (_, i) => base + i * 101),
      2,
      async (seed) => {
        const body: Record<string, unknown> = {
          prompt,
          image: Array.from(req.image),
          strength: req.strength ?? 0.6,
          num_steps: 20,
          seed,
        }
        if (req.mask) body.mask = Array.from(req.mask)
        return { bytes: await this.run(req.mask ? MODELS.inpaint : MODELS.img2img, body, signal), seed }
      },
    )
  }
}
