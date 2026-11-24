import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { exists } from './fsutil.ts'

export interface UsageEntry {
  ts: string
  provider: string
  model: string
  op: string
  units: number
  unitKind: 'neuron' | 'credit' | 'none'
  usd: number
  project?: string
  proposal?: string
  ok: boolean
}

export interface UsageSummary {
  todayUsd: number
  monthUsd: number
  todayNeurons: number
  todayCalls: number
  byProvider: Record<string, number>
}

/** Image-provider spend log: DATA_DIR/usage.jsonl (one JSON object per line). */
export class UsageLog {
  private readonly dataDir: string
  constructor(dataDir: string) {
    this.dataDir = dataDir
  }

  async append(e: UsageEntry): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    await appendFile(join(this.dataDir, 'usage.jsonl'), `${JSON.stringify(e)}\n`)
  }

  async entries(): Promise<UsageEntry[]> {
    const file = join(this.dataDir, 'usage.jsonl')
    if (!(await exists(file))) return []
    return (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as UsageEntry)
  }

  async summary(now = new Date()): Promise<UsageSummary> {
    const day = now.toISOString().slice(0, 10)
    const month = day.slice(0, 7)
    const s: UsageSummary = { todayUsd: 0, monthUsd: 0, todayNeurons: 0, todayCalls: 0, byProvider: {} }
    for (const e of await this.entries()) {
      if (e.ts.slice(0, 7) !== month) continue
      s.monthUsd += e.usd
      if (e.ts.slice(0, 10) === day) {
        s.todayUsd += e.usd
        s.todayCalls++
        if (e.unitKind === 'neuron') s.todayNeurons += e.units
        s.byProvider[e.provider] = (s.byProvider[e.provider] ?? 0) + e.usd
      }
    }
    return s
  }
}
