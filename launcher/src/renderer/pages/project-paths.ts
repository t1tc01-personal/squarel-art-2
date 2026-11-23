/** Pure path checks of the Dự án forms (no React, so unit tests can import them). */

/**
 * Error of an export folder ('' = none): a sub-folder strictly inside the project folder (the same
 * rule as main and Squarel: not the folder itself, no escape like `..` or `../x`; `..assets` is fine).
 */
export function exportDirError(v: string): string | undefined {
  const t = v.trim()
  if (!t) return undefined
  if (/^[a-zA-Z]:/.test(t) || /^[\\/]/.test(t) || t.includes(':'))
    return 'Ghi đường dẫn tương đối trong thư mục dự án, ví dụ game-client/assets/sprites'
  if (/["*?<>|]/.test(t)) return 'Đường dẫn có ký tự Windows không nhận (" * ? < > |)'
  const parts: string[] = []
  for (const s of t.split(/[\\/]+/)) {
    if (s === '' || s === '.') continue
    if (s !== '..') parts.push(s)
    else if (parts.pop() === undefined) return 'Thư mục nhận file xuất phải nằm trong thư mục dự án'
  }
  if (parts.length === 0) return 'Chọn một thư mục con, không phải chính thư mục dự án'
  return undefined
}
