import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { describeDefaults, workspaceArts } from '../store/workspace.ts'
import { currentWorkspace, projectArg, projectSlug } from './common.ts'
import { defineTool, ToolError } from './types.ts'

const NO_WORKSPACE =
  'No Squarel workspace ("Dự án") is active in this session: no .squarel/project.json was found in the folder Claude Code was started in or any parent. Create one in the Squarel Art Launcher (Dự án → Dự án mới), then start Claude Code in that folder.'

export const workspaceTools = [
  defineTool({
    name: 'workspace_info',
    title: 'Workspace info',
    description:
      'The active workspace ("Dự án": a folder grouping arts for one game, sticker set or print): name, folder, description, brief, defaults for new art, repos, export folder and its arts.',
    input: z.object({}),
    annotations: { readOnly: true },
    async handler(ctx) {
      const ws = await currentWorkspace(ctx)
      if (!ws) return { text: NO_WORKSPACE, data: { workspace: null } }
      const c = ws.config
      const arts = await workspaceArts(ctx.store, ws.id)
      const repos = (c.repos ?? []).map((r) => ({
        path: r,
        resolved: resolve(ws.folder, r),
        inside: !isAbsolute(r),
      }))
      const lines = [
        `Workspace "${ws.name}" (id ${ws.id})`,
        `Folder: ${ws.folder}`,
        c.description ? `Description: ${c.description}` : '',
        `Defaults for new art: ${describeDefaults(c.defaults)}`,
        repos.length
          ? `Repos: ${repos.map((r) => `${r.path} (${r.inside ? 'inside' : 'outside'})`).join(', ')}`
          : '',
        c.exportDir ? `Exports are also copied to: ${c.exportDir}` : '',
        c.brief ? `\nBrief:\n${c.brief}\n` : 'Brief: (none)',
        arts.length
          ? `Arts (${arts.length}, newest first):\n${arts.map((p) => `${p.slug === ctx.session.activeProject ? '* ' : '- '}${p.slug} — "${p.name}" (${p.purpose}, head ${p.head}, updated ${p.updatedAt})`).join('\n')}`
          : 'No art yet: project_create adds one with the defaults above.',
        'Catalog: .squarel/arts.md in the workspace folder.',
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
  defineTool({
    name: 'workspace_add_art',
    title: 'Add art to workspace',
    description:
      'Move an art (project), including an unassigned one, into the active workspace. Its previous workspace loses it.',
    input: z.object({ project: projectArg }),
    async handler(ctx, i) {
      const ws = await currentWorkspace(ctx)
      if (!ws) throw new ToolError('UNAVAILABLE', NO_WORKSPACE)
      const slug = await projectSlug(ctx, i.project)
      const prev = await ctx.store.setWorkspace(slug, ws.id)
      const from = prev === ws.id ? 'already in it' : prev ? `moved from workspace ${prev}` : 'was unassigned'
      return {
        text: `Art "${slug}" is in workspace "${ws.name}" (${from}).`,
        data: { project: slug, workspace: ws.id, previous: prev ?? null },
      }
    },
  }),
]
