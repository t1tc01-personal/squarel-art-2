/** Art references: `<project id>/<art id>`. Both ids are lowercase letters, digits and "-". */
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function artRef(project: string, art: string): string {
  if (!ID_RE.test(project)) throw new Error(`invalid project id "${project}"`)
  if (!ID_RE.test(art)) throw new Error(`invalid art id "${art}"`)
  return `${project}/${art}`
}

export function parseArtRef(ref: string): { project: string; art: string } | undefined {
  const parts = ref.split('/')
  if (parts.length !== 2) return undefined
  const [project, art] = parts
  return ID_RE.test(project) && ID_RE.test(art) ? { project, art } : undefined
}
