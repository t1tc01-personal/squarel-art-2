import { b64ToBytes, fetchRetry } from './http.ts'
import { editPrompt, generalPrompt } from './prompts.ts'
import type { EditRequest, GenRequest, ImageProvider, Quote, RawImage } from './types.ts'

/** Client for services/local-sd (FastAPI + diffusers on the local GPU). */
export class LocalSdProvider implements ImageProvider {
  readonly id = 'local-sd' as const
  readonly capabilities = {
    generate: true,
    edit: true,
    inpaint: true,
    animate: false,
    nativePixel: false,
    paletteInput: false,
    paid: false,
  }
  private url: string
  private fetchImpl?: typeof fetch
  constructor(url: string, fetchImpl?: typeof fetch) {
    this.url = url.replace(/\/$/, '')
    this.fetchImpl = fetchImpl
  }
  configured() {
    return Boolean(this.url)
  }
  async health(): Promise<boolean> {
    try {
      const res = await fetchRetry(
        `${this.url}/health`,
        { method: 'GET' },
        { timeoutMs: 1500, retries: 0, fetchImpl: this.fetchImpl },
      )
      return res.ok
    } catch {
      return false
    }
  }
  async quote(): Promise<Quote> {
    return { usd: 0, units: 0, unitKind: 'none', model: 'local-sd' }
  }
  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<RawImage[]> {
    const res = await fetchRetry(
      `${this.url}${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { signal, timeoutMs: 300_000, retries: 0, fetchImpl: this.fetchImpl },
    )
    const json = (await res.json()) as { images: string[]; seeds?: number[] }
    return json.images.map((b, i) => ({ bytes: b64ToBytes(b), seed: json.seeds?.[i] }))
  }
  generate(req: GenRequest, signal?: AbortSignal) {
    return this.post(
      '/generate',
      {
        prompt: generalPrompt(req.prompt, req),
        width: 512,
        height: 512,
        num_images: req.variants,
        seed: req.seed,
      },
      signal,
    )
  }
  edit(req: EditRequest, signal?: AbortSignal) {
    return this.post(
      '/img2img',
      {
        prompt: editPrompt(req.prompt),
        image: Buffer.from(req.image).toString('base64'),
        mask: req.mask ? Buffer.from(req.mask).toString('base64') : undefined,
        strength: req.strength ?? 0.6,
        num_images: req.variants,
        seed: req.seed,
      },
      signal,
    )
  }
}
