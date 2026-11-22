import { ProviderError } from './types.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** fetch with timeout + retries on 429/5xx/network errors. */
export async function fetchRetry(
  url: string,
  init: RequestInit,
  o: { timeoutMs?: number; retries?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const retries = o.retries ?? 2
  const f = o.fetchImpl ?? fetch
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 90_000)
    const onAbort = () => ctrl.abort()
    o.signal?.addEventListener('abort', onAbort)
    try {
      const res = await f(url, { ...init, signal: ctrl.signal })
      if (res.ok) return res
      const retryable = res.status === 429 || res.status >= 500
      const body = await res.text().catch(() => '')
      if (!retryable || attempt >= retries)
        throw new ProviderError(`HTTP ${res.status} from ${new URL(url).host}: ${body.slice(0, 300)}`, {
          status: res.status,
          retryable,
        })
    } catch (e: any) {
      if (e instanceof ProviderError) throw e
      if (o.signal?.aborted) throw new ProviderError('request cancelled')
      if (attempt >= retries)
        throw new ProviderError(
          ctrl.signal.aborted ? `timeout calling ${new URL(url).host}` : `network error: ${e?.message ?? e}`,
          { retryable: true },
        )
    } finally {
      clearTimeout(t)
      o.signal?.removeEventListener('abort', onAbort)
    }
    await sleep(1000 * (attempt + 1) * (attempt + 1))
  }
}

/** Run async jobs with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export function b64ToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/^data:[^,]+,/, ''), 'base64'))
}
