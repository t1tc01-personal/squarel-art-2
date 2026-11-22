import type { Config } from '../config.ts'
import { normHex, parseHex } from '../core/color.ts'
import { encodePng } from '../core/png.ts'
import { b64ToBytes, fetchRetry } from './http.ts'
import { nativePixelPrompt } from './prompts.ts'
import {
  type AnimRequest,
  type EditRequest,
  type GenRequest,
  type ImageProvider,
  ProviderError,
  type Quote,
  type RawImage,
  type Task,
} from './types.ts'

const ENDPOINT = 'https://api.retrodiffusion.ai/v1/inferences'

export const RD_STYLES = {
  generate: process.env.RETRO_DIFFUSION_STYLE || 'rd_fast__default',
  animate: process.env.RETRO_DIFFUSION_ANIM_STYLE || 'animation__four_angle_walking',
}

function paletteImage(colors: string[]): string {
  const data = new Uint8ClampedArray(colors.length * 4)
  for (const [i, c] of colors.entries()) data.set(parseHex(normHex(c)), i * 4)
  return Buffer.from(encodePng({ data, width: colors.length, height: 1 })).toString('base64')
}

/**
 * Retro Diffusion: native pixel-art models (paid). Every call is gated by the tools layer's
 * confirm_cost protocol; `quote()` uses the API's free `check_cost` dry run.
 * Field names follow the public API examples (github.com/Retro-Diffusion/api-examples) — verify on upgrade.
 */
export class RetroDiffusionProvider implements ImageProvider {
  readonly id = 'retrodiffusion' as const
  readonly capabilities = {
    generate: true,
    edit: true,
    inpaint: false,
    animate: true,
    nativePixel: true,
    paletteInput: true,
    paid: true,
  }
  private cfg: Config['retroDiffusion']
  private fetchImpl?: typeof fetch
  constructor(cfg: Config['retroDiffusion'], fetchImpl?: typeof fetch) {
    this.cfg = cfg
    this.fetchImpl = fetchImpl
  }
  configured() {
    return Boolean(this.cfg.apiKey)
  }
  async health() {
    return this.configured()
  }

  private body(task: Task, req: GenRequest | EditRequest | AnimRequest, checkCost = false) {
    const body: Record<string, unknown> = {
      prompt: nativePixelPrompt(req.prompt),
      width: Math.max(16, Math.min(384, req.width)),
      height: Math.max(16, Math.min(384, req.height)),
      num_images: req.variants,
      prompt_style: task === 'animate' ? RD_STYLES.animate : RD_STYLES.generate,
      remove_bg: true,
    }
    if (req.seed !== undefined) body.seed = req.seed
    if (req.palette?.length) body.input_palette = paletteImage(req.palette)
    if ('image' in req) {
      body.input_image = Buffer.from(req.image).toString('base64')
      body.strength = req.strength ?? 0.6
    }
    if ('action' in req)
      body.prompt = `${req.prompt}, ${req.action}${req.direction ? `, facing ${req.direction}` : ''}`
    if (checkCost) body.check_cost = true
    return body
  }

  private async call(body: Record<string, unknown>, signal?: AbortSignal) {
    if (!this.configured())
      throw new ProviderError('Retro Diffusion is not configured (RETRO_DIFFUSION_API_KEY)')
    const res = await fetchRetry(
      ENDPOINT,
      {
        method: 'POST',
        headers: { 'X-RD-Token': this.cfg.apiKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { signal, fetchImpl: this.fetchImpl, retries: body.check_cost ? 1 : 0 },
    )
    return (await res.json()) as {
      credit_cost?: number
      base64_images?: string[]
      remaining_credits?: number
    }
  }

  async quote(task: Task, req: GenRequest): Promise<Quote> {
    const r = await this.call(this.body(task, req, true))
    const credits = Number(r.credit_cost ?? req.variants)
    return {
      usd: credits * this.cfg.usdPerCredit,
      units: credits,
      unitKind: 'credit',
      model: String(this.body(task, req).prompt_style),
    }
  }

  private toImages(r: { base64_images?: string[] }, frames?: number): RawImage[] {
    if (!r.base64_images?.length) throw new ProviderError('Retro Diffusion returned no images')
    return r.base64_images.map((b) => ({ bytes: b64ToBytes(b), ...(frames ? { frames } : {}) }))
  }

  async generate(req: GenRequest, signal?: AbortSignal) {
    return this.toImages(await this.call(this.body('generate', req), signal))
  }
  async edit(req: EditRequest, signal?: AbortSignal) {
    return this.toImages(await this.call(this.body('edit', req), signal))
  }
  async animate(req: AnimRequest, signal?: AbortSignal) {
    const body = this.body('animate', req)
    body.return_spritesheet = true
    return this.toImages(await this.call(body, signal), req.frames)
  }
}
