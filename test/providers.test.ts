import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { encodePng } from '../src/core/png.ts'
import { CloudflareProvider } from '../src/providers/cloudflare.ts'
import { LocalSdProvider } from '../src/providers/localsd.ts'
import { MockProvider, mockSprite } from '../src/providers/mock.ts'
import { RetroDiffusionProvider } from '../src/providers/retrodiffusion.ts'
import { BudgetError, ProviderRouter } from '../src/providers/router.ts'
import { ProviderError } from '../src/providers/types.ts'
import { Store } from '../src/store/store.ts'
import { tempDir } from './helpers.ts'

const PNG = encodePng(mockSprite(1, 8, ['#ff0000'], 8))
const b64 = Buffer.from(PNG).toString('base64')

type Call = { url: string; init: RequestInit }
function fakeFetch(responses: (() => Response)[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  let i = 0
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const r = responses[Math.min(i++, responses.length - 1)]
    return r()
  }) as unknown as typeof fetch
  return { fetch: f, calls }
}
const json =
  (v: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

describe('CloudflareProvider', () => {
  it('calls flux-1-schnell with bearer auth and decodes base64 images', async () => {
    const { fetch, calls } = fakeFetch([json({ success: true, result: { image: b64 } })])
    const p = new CloudflareProvider({ accountId: 'acc', token: 'tok' }, fetch)
    const out = await p.generate({ prompt: 'knight', width: 32, height: 32, variants: 2, seed: 5 })
    expect(out).toHaveLength(2)
    expect(out[0].bytes).toEqual(PNG)
    expect(calls[0].url).toContain('/accounts/acc/ai/run/@cf/black-forest-labs/flux-1-schnell')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.prompt).toContain('pixel art sprite of knight')
    expect(body.prompt).toContain('magenta')
    expect(body.steps).toBe(4)
  })
  it('retries 429 then succeeds; binary image responses for img2img', async () => {
    const { fetch, calls } = fakeFetch([
      () => new Response('slow down', { status: 429 }),
      () => new Response(Buffer.from(PNG), { status: 200, headers: { 'content-type': 'image/png' } }),
    ])
    const p = new CloudflareProvider({ accountId: 'a', token: 't' }, fetch)
    const out = await p.edit({ prompt: 'red cape', width: 8, height: 8, variants: 1, image: PNG, mask: PNG })
    expect(out[0].bytes).toEqual(PNG)
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toContain('inpainting')
  })
  it('does not retry 4xx and reports the error', async () => {
    const { fetch, calls } = fakeFetch([() => new Response('bad', { status: 400 })])
    const p = new CloudflareProvider({ accountId: 'a', token: 't' }, fetch)
    await expect(p.generate({ prompt: 'x', width: 8, height: 8, variants: 1 })).rejects.toBeInstanceOf(
      ProviderError,
    )
    expect(calls).toHaveLength(1)
  })
  it('quotes neurons', async () => {
    const q = await new CloudflareProvider({}).quote('generate', {
      prompt: 'x',
      width: 8,
      height: 8,
      variants: 4,
    })
    expect(q.unitKind).toBe('neuron')
    expect(q.units).toBeCloseTo(4 * 43.2)
  })
})

describe('RetroDiffusionProvider', () => {
  it('quotes with the free check_cost dry run and sends the palette as an image', async () => {
    const { fetch, calls } = fakeFetch([json({ credit_cost: 3 }), json({ base64_images: [b64, b64] })])
    const p = new RetroDiffusionProvider({ apiKey: 'k', usdPerCredit: 0.01 }, fetch)
    const req = { prompt: 'knight', width: 32, height: 32, variants: 2, palette: ['#ff0000', '#00ff00'] }
    const q = await p.quote('generate', req)
    expect(q.usd).toBeCloseTo(0.03)
    expect(JSON.parse(String(calls[0].init.body)).check_cost).toBe(true)
    const out = await p.generate(req)
    expect(out).toHaveLength(2)
    const body = JSON.parse(String(calls[1].init.body))
    expect(body.check_cost).toBeUndefined()
    expect(body.input_palette).toBeTypeOf('string')
    expect((calls[1].init.headers as Record<string, string>)['X-RD-Token']).toBe('k')
  })
})

describe('LocalSdProvider', () => {
  it('reports unhealthy when nothing listens', async () => {
    expect(await new LocalSdProvider('http://127.0.0.1:1').health()).toBe(false)
  })
  it('speaks the services/local-sd contract', async () => {
    const { fetch, calls } = fakeFetch([json({ images: [b64], seeds: [7] })])
    const p = new LocalSdProvider('http://127.0.0.1:7861/', fetch)
    const out = await p.edit({ prompt: 'cape', width: 8, height: 8, variants: 1, image: PNG, strength: 0.5 })
    expect(out[0]).toEqual({ bytes: PNG, seed: 7 })
    expect(calls[0].url).toBe('http://127.0.0.1:7861/img2img')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.image).toBe(b64)
    expect(body.strength).toBe(0.5)
  })
})

describe('ProviderRouter', () => {
  let t: ReturnType<typeof tempDir>
  let store: Store
  beforeEach(async () => {
    t = tempDir()
    store = new Store(t.dir)
    await store.init()
  })
  afterEach(() => t.cleanup())

  const cfg = (o: Partial<ReturnType<typeof loadConfig>> = {}) => ({
    ...loadConfig({ dataDir: '' }),
    dataDir: '',
    imageProvider: 'cloudflare' as const,
    dailyBudgetUsd: 0.05,
    ...o,
  })

  it('free chain never includes paid providers; errors when nothing is configured', async () => {
    const r = new ProviderRouter(cfg(), store, {
      cloudflare: new CloudflareProvider({}),
      retrodiffusion: new RetroDiffusionProvider({ apiKey: 'k', usdPerCredit: 0.01 }),
      'local-sd': new LocalSdProvider('http://127.0.0.1:1'),
    })
    await expect(r.chain('generate', 'free')).rejects.toThrow(/no image provider is configured/)
    expect((await r.chain('generate', 'high'))[0].id).toBe('retrodiffusion')
    const r2 = new ProviderRouter(cfg({ imageProvider: 'mock' }), store, { mock: new MockProvider() })
    expect((await r2.chain('generate', 'free')).map((p) => p.id)).toEqual(['mock'])
    await expect(r2.chain('generate', 'high')).rejects.toThrow(/RETRO_DIFFUSION_API_KEY/)
  })

  it('Cloudflare free tier costs $0 until 10k neurons, then counts against the budget', async () => {
    const r = new ProviderRouter(cfg(), store, {})
    const q = { usd: 0.002, units: 200, unitKind: 'neuron' as const, model: 'm' }
    expect(await r.effectiveUsd(q)).toBe(0)
    await store.appendUsage({
      ts: new Date().toISOString(),
      provider: 'cloudflare',
      model: 'm',
      op: 'g',
      units: 9900,
      unitKind: 'neuron',
      usd: 0,
      ok: true,
    })
    expect(await r.effectiveUsd(q)).toBeCloseTo(100 * 0.000011)
  })

  it('blocks paid calls over the daily cap', async () => {
    const r = new ProviderRouter(cfg(), store, {})
    await r.record({
      provider: 'retrodiffusion',
      model: 'm',
      op: 'g',
      units: 4,
      unitKind: 'credit',
      usd: 0.04,
      ok: true,
    })
    await expect(
      r.checkBudget({ usd: 0.02, units: 2, unitKind: 'credit', model: 'm' }),
    ).rejects.toBeInstanceOf(BudgetError)
    await expect(
      r.checkBudget({ usd: 0.005, units: 1, unitKind: 'credit', model: 'm' }),
    ).resolves.toBeTruthy()
  })
})
