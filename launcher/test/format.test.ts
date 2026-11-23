import { describe, expect, it } from 'vitest'
import { ago, formatLogLine, squarelPlanText } from '../src/renderer/format'

describe('renderer text helpers', () => {
  it('a tag plan already at its target reads "Hoàn tất cập nhật"', () => {
    expect(squarelPlanText({ kind: 'tag', from: '0.2.1', to: '0.2.1' })).toBe('Hoàn tất cập nhật')
    expect(squarelPlanText({ kind: 'tag', from: '0.2.0', to: '0.2.1' })).toBe('Squarel 0.2.0 → 0.2.1')
    expect(squarelPlanText({ kind: 'none' })).toBe('Squarel đã đúng phiên bản')
    expect(squarelPlanText({ kind: 'blocked', reason: 'dirty', message: 'có thay đổi' })).toBe('có thay đổi')
  })

  it('formats relative times and copied log lines', () => {
    const now = Date.parse('2026-01-02T12:00:00Z')
    expect(ago('2026-01-02T10:00:00Z', now)).toBe('2 giờ trước')
    expect(ago('2026-01-01T12:00:00Z', now)).toBe('hôm qua')
    expect(ago('nope', now)).toBe('')
    expect(formatLogLine({ ts: '2026-01-01T00:00:00Z', level: 'warn', source: 'mcp', text: 'x' })).toBe(
      '2026-01-01T00:00:00Z WARN mcp x',
    )
  })
})
