import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { artsDirOf, describeDefaults, workspaceArts } from '../store/workspace.ts'
import { artStore, currentWorkspace, NO_PROJECT_TEXT } from './common.ts'
import { defineTool } from './types.ts'

export const workspaceTools = [
  defineTool({
    name: 'project_info',
    title: 'Project info',
    description:
      'The current project ("Dự án": a folder whose squarel_art/ holds the arts of one game, sticker set or print): name, folder, description, brief, defaults for new art, repos, export folder and its arts.',
    input: z.object({}),
    annotations: { readOnly: true },
    async handler(ctx) {
      const ws = await currentWorkspace(ctx)
      if (!ws) return { text: NO_PROJECT_TEXT, data: { workspace: null } }
      const c = ws.config
      const arts = await workspaceArts(artStore(ctx))
      const repos = (c.repos ?? []).map((r) => ({
        path: r,
        resolved: resolve(ws.folder, r),
        inside: !isAbsolute(r),
      }))
      const lines = [
        `Project "${ws.name}" (id ${ws.id})`,
        `Folder: ${ws.folder}`,
        ws.home !== ws.folder
          ? `Art lives in the main checkout: ${artsDirOf(ws)}`
          : `Art folder: ${artsDirOf(ws)}`,
        c.description ? `Description: ${c.description}` : '',
        `Defaults for new art: ${describeDefaults(c.defaults)}`,
        repos.length
          ? `Repos: ${repos.map((r) => `${r.path} (${r.inside ? 'inside' : 'outside'})`).join(', ')}`
          : '',
        c.exportDir ? `Exports are also copied to: ${c.exportDir}` : '',
        c.brief ? `\nBrief:\n${c.brief}\n` : 'Brief: (none)',
        arts.length
          ? `Arts (${arts.length}, newest first):\n${arts.map((p) => `${p.slug === ctx.session.activeProject ? '* ' : '- '}${p.slug} — "${p.name}" (${p.purpose}, head ${p.head}, updated ${p.updatedAt})`).join('\n')}`
          : 'No art yet: art_create adds one with the defaults above.',
        'Catalog: .squarel/arts.md in the project folder.',
      ]
      return {
        text: lines.filter(Boolean).join('\n'),
        data: {
          workspace: {
            id: ws.id,
            name: ws.name,
            folder: ws.folder,
            description: c.description ?? '',
            brief: c.brief ?? '',
            defaults: c.defaults ?? {},
            repos,
            exportDir: c.exportDir ?? null,
          },
          arts,
        },
      }
    },
  }),
]
