import { describe, expect, it } from 'vitest'
import { withProgress } from '../src/main/actions'
import type { TaskEvent } from '../src/shared/model'

const line = (text: string): TaskEvent => ({ taskId: 't', kind: 'line', text })
const rec = (o: object) => line(`@@progress ${JSON.stringify(o)}`)

describe('withProgress', () => {
  it('passes ordinary lines through unchanged', () => {
    const out: TaskEvent[] = []
    withProgress((e) => out.push(e))(line('[1/10] cc a.c'))
    expect(out).toEqual([line('[1/10] cc a.c')])
  })

  it('uses the weighted overall percent and adds the step', () => {
    const out: TaskEvent[] = []
    withProgress((e) => out.push(e))(
      rec({ step: 5, total: 6, label: 'Build', percent: 50, overall: 63, detail: '715/1430', plan: ['a'] }),
    )
    expect(out).toEqual([
      {
        taskId: 't',
        kind: 'progress',
        text: 'Build',
        percent: 63,
        step: { step: 5, total: 6, label: 'Build', detail: '715/1430', plan: ['a'] },
      },
    ])
  })

  it('never goes backwards when an older script restarts its counter in a step', () => {
    const out: TaskEvent[] = []
    const emit = withProgress((e) => out.push(e))
    // Old scripts: no overall, percent only inside the compile step.
    emit(rec({ step: 4, total: 6, label: 'Configure' }))
    emit(rec({ step: 5, total: 6, label: 'Build' }))
    emit(rec({ step: 5, total: 6, label: 'Build', percent: 3 }))
    emit(rec({ step: 5, total: 6, label: 'Build', percent: 60 }))
    emit(rec({ step: 2, total: 6, label: 'Odd', percent: 0 }))
    expect(out.map((e) => e.percent)).toEqual([50, 67, 67, 77, 77])
  })

  it('clamps out-of-range values', () => {
    const out: TaskEvent[] = []
    const emit = withProgress((e) => out.push(e))
    emit(rec({ step: 9, total: 6, label: 'x', overall: 250 }))
    expect(out[0]).toMatchObject({ percent: 100, step: { step: 6, total: 6 } })
  })
})
