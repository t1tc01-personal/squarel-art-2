/** Generate docs/tools.md from the zod schemas of every tool (pnpm docs:tools). */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '../src/config.ts'
import { PRESETS } from '../src/core/export.ts'
import { ALL_TOOLS } from '../src/tools/registry.ts'

type Schema = {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  anyOf?: Schema[]
  items?: Schema
  default?: unknown
}

function typeOf(s: Schema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' \\| ')
  if (s.anyOf) return s.anyOf.map(typeOf).join(' \\| ')
  if (s.type === 'array') return `${s.items ? typeOf(s.items) : 'any'}[]`
  return Array.isArray(s.type) ? s.type.join(' \\| ') : (s.type ?? 'object')
}

export function renderToolsDoc(): string {
  const out: string[] = [
    '# Danh mục tool (tự sinh)',
    '',
    '> File này được sinh bởi `pnpm docs:tools` từ schema zod trong `src/tools`. Đừng sửa tay.',
    '',
    `Tổng cộng **${ALL_TOOLS.length} tool**. Mọi tool art đều nhận \`art\` (id của art trong dự án này, mặc định là art đang mở bằng art_open / art_create) nếu có liên quan.`,
    '',
  ]
  for (const t of ALL_TOOLS) {
    const js = z.toJSONSchema(t.input, { unrepresentable: 'any' }) as {
      properties?: Record<string, Schema>
      required?: string[]
    }
    out.push(`## \`${t.name}\` — ${t.title}`, '', t.description, '')
    const props = Object.entries(js.properties ?? {})
    if (props.length) {
      out.push('| Tham số | Kiểu | Bắt buộc | Mô tả |', '|---|---|---|---|')
      for (const [k, s] of props)
        out.push(
          `| \`${k}\` | ${typeOf(s)} | ${js.required?.includes(k) && s.default === undefined ? '✓' : ''} | ${(s.description ?? '').replace(/\|/g, '\\|')}${s.default !== undefined ? ` (mặc định \`${JSON.stringify(s.default)}\`)` : ''} |`,
        )
      out.push('')
    }
    const flags = [t.annotations?.readOnly && 'chỉ đọc', t.annotations?.costly && 'có thể tốn tiền'].filter(
      Boolean,
    )
    if (flags.length) out.push(`_${flags.join(', ')}_`, '')
  }
  out.push('## Preset xuất file', '', '| id | Mục đích | Mô tả | Tuỳ chọn |', '|---|---|---|---|')
  for (const p of PRESETS) {
    const js = z.toJSONSchema(p.options) as { properties?: Record<string, Schema> }
    const opts = Object.entries(js.properties ?? {})
      .map(([k, s]) => `\`${k}\`${s.default !== undefined ? `=${JSON.stringify(s.default)}` : ''}`)
      .join(', ')
    out.push(`| \`${p.id}\` | ${p.purpose} | ${p.label} | ${opts} |`)
  }
  return `${out.join('\n')}\n`
}

if (process.argv[1]?.endsWith('gen-tools-doc.ts')) {
  const file = join(REPO_ROOT, 'docs', 'tools.md')
  writeFileSync(file, renderToolsDoc())
  console.log(`Wrote ${file}`)
}
