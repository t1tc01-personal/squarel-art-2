# Art in the project folder: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Art lives in `<project folder>/squarel_art/<art>/` instead of `DATA_DIR/projects/<art>/`.
- Art tools work only inside a Dự án.
- Every component addresses art by `<project id>/<art id>`.

**Architecture:**
- The MCP server builds its art `Store` on `<home>/squarel_art`. `home` is the project folder, or the main checkout's copy of it when the project folder is in a git worktree.
- `DATA_DIR/projects` becomes a read-only legacy store. `art_import` moves art from it into a project.
- The single bridge resolves project ids through live MCP presence files and the launcher index. It keeps one `Store` per project and speaks protocol 2 (`ref` instead of `slug`).
- The launcher reads art from project folders and runs `art_import` through the Squarel CLI.

**Tech Stack:** Node ≥22.18 (runs .ts directly), TypeScript, zod 4, vitest, biome, chokidar, ws. Launcher: Electron 45, React 19, Playwright (fake mode). Aseprite extension: Lua.

**Spec:** `docs/superpowers/specs/2026-11-24-art-in-project-folder-design.md` (amends `docs/superpowers/specs/2026-11-24-workspaces-design.md`).

## Global Constraints

**Ids, folders and protocol**
- Art folder name: `squarel_art`.
- Id regex for both project ids and art ids: `^[a-z0-9][a-z0-9-]{0,63}$`.
- Art ref: `<project id>/<art id>`.
- Bridge protocol version: `2`.

**`squarel_art/.gitignore`**
- Created only when missing, never overwritten.
- Exact content:
  ```
  */.lock
  *.tmp
  */.work-*.json
  */proposals/
  */exports/
  */work.aseprite
  */thumb.png
  ```

**Data**
- An art's `project.json` no longer carries `workspace`. Readers ignore it.
- `DATA_DIR` keeps `logs/`, `usage.jsonl`, `run/`, `inbox/`, `workspaces/` and the bridge token.
- `DATA_DIR/projects` is read-only legacy.

**Tool renames**

| Old | New |
|---|---|
| `project_list` | `art_list` |
| `project_create` | `art_create` |
| `project_open` | `art_open` |
| `project_info` | `art_info` |
| `workspace_info` | `project_info` |
| `workspace_add_art` | `art_import` |

The per-tool `project` (art slug) parameter becomes `art`. No alias for the old names.

**Behaviour rules**
- Outside a project, every art tool fails with `NO_PROJECT` and this exact text: `No Squarel project here. Art lives inside a project folder: create one in Squarel Art Launcher (Dự án → Dự án mới), then open Claude Code in that folder.` Only `art_list { legacy: true }` still works.
- Squarel writes only inside `<home>/squarel_art/`, `<home>/.squarel/` (catalog) and the configured export folder. It never creates `squarel_art/` in a folder without `.squarel/project.json`.
- Legacy art is never deleted before its copy is verified. On any import failure, the temp copy is removed and the source is kept.
- No hidden commands. Launcher tasks start only from an explicit click. Never overwrite the user's `AGENTS.md` or `CLAUDE.md` content (unchanged rules from the workspaces feature).

**Release and workflow**
- Versions: Squarel root, launcher and extension all become `0.4.0`. CHANGELOG lists the breaking changes.
- UI copy is Vietnamese; code, comments and CHANGELOG are English.
- Commit locally per task only if the user approved commits for this execution. Never push or tag.

## Review Focus

1. **Project folder on another drive than DATA_DIR** (e.g. `E:\game`, with DATA_DIR on `C:`). `art_import` must copy, not rely on rename. Test in Task 5: the import still succeeds when `fs.rename` is stubbed to throw `EXDEV`.
2. **Folder names with Vietnamese letters and spaces** (`D:\Dự án\game dungeon`). Bridge resolution and watching must work. Tests in Task 7 and Task 8 use such a folder.
3. **Worktree whose main checkout was deleted or moved** (`commondir` points nowhere). Detection falls back to the worktree as home, with no crash. Test in Task 1.
4. **User edits `id` in `.squarel/project.json` while the bridge runs.** The cached mapping must not keep serving the old id: `get(oldId)` fails with NOT_FOUND, and `get(newId)` resolves. Test in Task 7.
5. **Claude opened inside `squarel_art/` or `squarel_art/hero/`.** Detection walks up to the project and does not nest another `squarel_art`. Test in Task 3.

---

## File map

**Squarel (new)**
- `src/shared/ref.ts`: ref format.
- `src/store/worktree.ts`: git worktree detection without running git.
- `src/store/usage.ts`: `UsageLog`, moved out of `Store`.
- `src/store/import.ts`: legacy → project move.
- `src/bridge/projects.ts`: `ProjectDirectory`, the bridge's id → folder resolver.

**Squarel (modified)**
- `src/store/store.ts`, `src/store/workspace.ts`
- `src/config.ts`
- `src/providers/router.ts`
- `src/tools/{types,context,common,project,workspace,misc,ai,draw,ops,registry}.ts`
- `src/mcp/{index,server,presence}.ts`
- `src/bridge/{protocol,server,remote,index}.ts`
- `src/cli/index.ts`
- `integrations/aseprite/squarel/{plugin.lua,package.json}`
- `.claude/skills/pixel-*/SKILL.md`, `docs/*.md`, `evals/run.ts`

**Launcher (new)**
- `launcher/src/main/worktree.ts`

**Launcher (modified)**
- `launcher/src/main/{workspaces,ipc-handlers,actions,presence,index}.ts`
- `launcher/src/main/bridge/{client,types,supervisor}.ts`
- `launcher/src/shared/ipc.ts`, `launcher/src/preload/index.ts`
- `launcher/src/renderer/pages/{Projects,ProjectDetail,ProjectNew,Home,Integration}.tsx`, `launcher/src/renderer/pages/project-ui.tsx`
- `integrations/aseprite/integration.json` (labels only)

---

### Task 1: Ref format and worktree detection

**Files:**
- Create: `src/shared/ref.ts`, `src/store/worktree.ts`
- Modify: `src/store/workspace.ts` (`Workspace`, `readWorkspace`, `detectWorkspace`)
- Test: `test/worktree.test.ts` (new), `test/workspace.test.ts`

**Interfaces:**
- Produces:
  - `ID_RE: RegExp`
  - `artRef(project: string, art: string): string`, which throws on an invalid id.
  - `parseArtRef(ref: string): { project: string; art: string } | undefined`
  - `ART_DIR = 'squarel_art'`
  - `ART_GITIGNORE: string`: the exact content from Global Constraints, ending in `\n`.
  - `gitCommonDir(folder: string): Promise<string | undefined>`
  - `mainCheckoutOf(folder: string): Promise<string | undefined>`
  - `Workspace.home: string`
  - `artsDirOf(ws: Workspace): string` returns `join(ws.home, ART_DIR)`.
  - `resolveHome(ws: Workspace): Promise<string>`: the rule in Step 3, used by `detectWorkspace` and by the bridge (Task 7).
  - `readWorkspace` sets `home = folder`.
  - `detectWorkspace` sets `home = await resolveHome(ws)`.

- [ ] **Step 1: Write failing tests in `test/worktree.test.ts`.** Build temp folders by hand, with no git binary:
  - `main/.git/` is a directory;
  - `main/.git/worktrees/wt/commondir` contains `../..`;
  - `wt/.git` is a file containing `gitdir: <abs main>/.git/worktrees/wt`;
  - each of `main/app/.squarel/project.json` and `wt/app/.squarel/project.json` holds `{"id":"game","name":"Game"}`.

  Cases:
  ```ts
  expect(parseArtRef('game/hero')).toEqual({ project: 'game', art: 'hero' })
  expect(parseArtRef('game/Hero')).toBeUndefined()
  expect(parseArtRef('a/b/c')).toBeUndefined()
  expect(() => artRef('Game', 'hero')).toThrow()
  expect(await mainCheckoutOf(join(wt, 'app'))).toBe(join(main, 'app'))
  expect(await mainCheckoutOf(join(main, 'app'))).toBeUndefined()           // not a linked worktree
  expect(await gitCommonDir(join(wt, 'app'))).toBe(join(main, '.git'))
  expect(await gitCommonDir(join(main, 'app'))).toBe(join(main, '.git'))
  // Review Focus 3: commondir points to a deleted main
  rmSync(main, { recursive: true }); expect(await mainCheckoutOf(join(wt, 'app'))).toBeUndefined()
  ```

  Add to `test/workspace.test.ts`, `detectWorkspace` cases:
  - from `wt/app`, `ws.folder === wt/app` and `ws.home === main/app`;
  - when `main/app/.squarel/project.json` has another id, `home === wt/app`;
  - when main lacks the project file, `home === wt/app`;
  - from a plain folder, `home === folder`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/worktree.test.ts test/workspace.test.ts`
  Expected: FAIL. The new modules are missing.
- [ ] **Step 3: Implement.**
  - **`mainCheckoutOf`:** walk up from `folder`, at most 32 levels, to the first `.git`.
    - If it is a directory, return `undefined`.
    - If it is a file, parse `gitdir: <path>`; the path may be relative to the file's folder. Read `<gitdir>/commondir`, resolved relative to gitdir. When `basename(common) !== '.git'` (bare repo), or that folder is missing, return `undefined`.
    - Otherwise return `join(dirname(common), relative(worktreeRoot, folder))`.
  - **`gitCommonDir`:** same walk. Return the `.git` directory itself, or the resolved common dir for a worktree.
  - **`resolveHome`:** compute `main = await mainCheckoutOf(ws.folder)`. If `main` holds `.squarel/project.json` with the same id, return `main`; otherwise return `ws.folder`.
  - **`detectWorkspace`:** keep the existing `ensureWorkspaceIndex` call.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(store): art refs and git worktree detection`

### Task 2: Store rooted at an art folder, usage split out

**Files:**
- Create: `src/store/usage.ts`
- Modify:
  - `src/store/store.ts`
  - `src/store/workspace.ts` (`workspaceArts`, `renderCatalog`, `writeCatalog`, `refreshCatalog`)
  - `src/config.ts`
  - `src/providers/router.ts`
- Test: `test/store.test.ts`, `test/providers.test.ts`, `test/workspace.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ART_GITIGNORE`, `Workspace.home`).
- Produces:
  - `new Store(root: string, o?: { log?: Logger; hooks?: boolean; project?: Workspace; readOnly?: string })`.
    - `readonly root: string` replaces `dataDir`, `projectsDir` and `inboxDir`.
    - `readOnly` is the error text thrown by every write: `createProject`, `commit`, `withHead`, `restore`, `undo`, `writeProjectFile`, `saveProposal`, `updateProposal`.
  - `Store.init()` creates `root`. When `project` is set, it also writes `root/.gitignore` with `ART_GITIGNORE` if missing.
    - Writes call `init()` lazily.
    - `listProjects()` returns `[]` when `root` is missing and creates nothing.
  - `ProjectInfo` loses `workspace`. `setWorkspace` is deleted.
  - Post-commit hooks: thumb as now. Catalog: `writeCatalog(this, o.project)` when `project` is set.
  - `workspaceArts(store)` lists `store.listProjects()`; the id parameter is gone.
  - `catalogPath(ws.home)` is the catalog location, used by `writeCatalog`/`renderCatalog`.
  - `class UsageLog { constructor(dataDir: string); append(e: UsageEntry): Promise<void>; entries(): Promise<UsageEntry[]>; summary(now?: Date): Promise<UsageSummary> }`. The bodies move from `Store`, same file `DATA_DIR/usage.jsonl`.
  - `inboxDir(config: Config): string` returns `join(config.dataDir, 'inbox')`.
  - `new ProviderRouter(config, usage: UsageLog, providers)`.

- [ ] **Step 1: Update and write failing tests.**

  In `test/store.test.ts` (existing tests switch to `new Store(join(tmp, 'squarel_art'))`):
  - `init on a project store writes .gitignore once and never overwrites it`:
    - write `custom\n` first; `init()`; content stays `custom\n`;
    - a fresh root gets exactly `ART_GITIGNORE`.
  - `listProjects on a missing root returns [] and creates nothing`:
    - `expect(existsSync(root)).toBe(false)` afterwards.
  - `a readOnly store refuses writes with its reason`:
    - `await expect(s.createProject({...})).rejects.toThrow('legacy art')`, with `readOnly: 'legacy art is read-only'`.
  - `the catalog goes to <home>/.squarel/arts.md`: after `createProject` on a store with `project`, the file lists the art.

  In `test/providers.test.ts`: the router is built with `new UsageLog(tmp)`, and the budget tests stay as they are.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/store.test.ts test/providers.test.ts test/workspace.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above. Delete the tests of `setWorkspace` and of the `workspace` field filter.
- [ ] **Step 4: Run them to see them pass.**
  Run the same command, then `pnpm typecheck`. Expected: tests PASS. `typecheck` still fails in `src/tools`, `src/bridge` and `src/mcp`; Tasks 3 and 8 fix those, so list the remaining errors in the task report.
- [ ] **Step 5: Commit.** `refactor(store): store rooted at squarel_art; usage log in DATA_DIR`

### Task 3: Tool context requires a project

**Files:**
- Modify:
  - `src/tools/types.ts`, `src/tools/context.ts`, `src/tools/common.ts`
  - every tool file that reads `ctx.store` (`ai.ts`, `draw.ts`, `ops.ts`, `misc.ts`, `project.ts`, `workspace.ts`, `registry.ts`)
  - `src/mcp/index.ts`, `src/cli/index.ts`
- Test: `test/tools.test.ts`, `test/mcp.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `detectWorkspace`, `artsDirOf`.
  - Task 2: `Store`, `UsageLog`, `inboxDir`.
- Produces:
  - `ErrorCode` gains `'NO_PROJECT' | 'DUPLICATE_PROJECT'`.
  - `NO_PROJECT_TEXT`, exported from `src/tools/common.ts` (exact text from Global Constraints).
  - `ToolContext` drops `store` and gains:
    - `arts?: Store`: the project's art store, absent outside a project;
    - `legacy: Store`: root `DATA_DIR/projects`, `readOnly: 'Legacy art is read-only: move it into a project with art_import first.'`;
    - `usage: UsageLog`.
  - `ToolContext.session` gains `duplicateOf?: string`.
  - `artStore(ctx: ToolContext): Store` throws `ToolError('NO_PROJECT', NO_PROJECT_TEXT)` when `ctx.arts` is undefined.
  - `CreateContextOptions.projectStart?: string`. When it is set, the context runs `detectWorkspace({ start, dataDir, log })`, stores the result in `session.workspace`, and builds `arts = new Store(artsDirOf(ws), { log, project: ws, readOnly })`. `readOnly` is set only by Task 6.
  - Start folders:
    - MCP: `process.env.CLAUDE_PROJECT_DIR || process.cwd()`;
    - CLI: `process.env.SQUAREL_PROJECT_DIR || process.env.INIT_CWD || process.cwd()`;
    - standalone bridge: no `projectStart`.

- [ ] **Step 1: Write failing tests** in `test/tools.test.ts`. Existing tests build their context with a temp project folder (`.squarel/project.json`) as `projectStart`.
  - `art tools outside a project fail with NO_PROJECT`:
    - `runTool('draw_pixels', …)` on a context without `projectStart` rejects with `code === 'NO_PROJECT'`;
    - the message equals `NO_PROJECT_TEXT`.
  - `usage_today works outside a project`.
  - `a context started in squarel_art/hero detects the project above` (Review Focus 5):
    - `ctx.session.workspace.id === 'game'`;
    - `ctx.arts.root === join(projectFolder, 'squarel_art')`.
  - `art is written under <project>/squarel_art`: after a create, `existsSync(join(projectFolder, 'squarel_art', slug, 'project.json'))`.
  - `detecting a project creates nothing`: right after `createToolContext({ projectStart })`, `existsSync(join(projectFolder, 'squarel_art')) === false`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/tools.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Replace every `ctx.store` with `artStore(ctx)`; usage calls go through `ctx.usage`.
  - `photo_to_pixel` resolves inbox paths with `inboxDir(ctx.config)`.
  - `mcp/index.ts` stops calling `detectWorkspace` itself and reads `ctx.session.workspace`.
  - The CLI drops the `input.project` shortcut. Task 4 renames it to `input.art`.
- [ ] **Step 4: Run them to see them pass.**
  Run: `pnpm vitest run test/tools.test.ts test/mcp.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit.** `feat(tools): art tools need a project; context detects it`

### Task 4: Tool renames, `art` parameter, instructions, docs

**Files:**
- Modify:
  - `src/tools/project.ts`, `src/tools/workspace.ts`, `src/tools/common.ts`
  - every tool using `projectArg`
  - `src/mcp/server.ts`, `src/cli/index.ts`
  - `.claude/skills/pixel-{new,art,from-photo,export}/SKILL.md`
  - `docs/tools.md` (regenerate with `pnpm docs:tools`), `docs/architecture.md`, `docs/integrations.md`, `docs/setup.md`
  - `README*.md` where tool names appear
  - `evals/run.ts`
- Test: `test/tools.test.ts`, `test/mcp.test.ts`, `test/docs.test.ts`

**Interfaces:**
- Consumes: Task 3 (`artStore`, `ToolContext`).
- Produces:
  - Tool names per Global Constraints.
  - `artArg`, replacing `projectArg`. Description: `Art id in this project. Defaults to the art opened with art_open / art_create.`
  - `artSlug(ctx, art?: string): Promise<string>`, replacing `projectSlug`. Its not-found message names `art_list`.
  - `mutate(ctx, art, label, fn, o)`; result `data: { art: slug, ref: artRef(ws.id, slug), version }`.
  - `art_list { legacy?: boolean }`:
    - without `legacy`, lists `artStore(ctx)` (NO_PROJECT outside a project);
    - with `legacy: true`, lists `ctx.legacy` and works anywhere.
  - `art_create` and `art_info` text includes the art's absolute folder.
  - `serverInstructions(s: { workspace?: Workspace; arts: ProjectInfo[]; legacyCount: number; duplicateOf?: string }): string`:
    - **no workspace:** `SERVER_INSTRUCTIONS` with `NO_PROJECT_TEXT`, plus `"<n> older arts wait in DATA_DIR/projects; inside a project, art_import moves one in."` when `legacyCount > 0`;
    - **workspace:** as today, plus a worktree paragraph when `home !== folder`. The paragraph says that art lives in `<home>/squarel_art`, that this worktree's `squarel_art/` is a stale checkout not to be read or edited with file tools, and that new art shows as uncommitted changes in the main checkout;
    - **`duplicateOf`:** a paragraph saying writes are blocked and how to change the id.
  - CLI: `input.art` sets `ctx.session.activeProject`.

- [ ] **Step 1: Update tests.**
  - Rename tool names and `project` params in `test/tools.test.ts` and `test/mcp.test.ts`.
  - New asserts:
    ```ts
    expect(names).toContain('art_create'); expect(names).not.toContain('project_create')
    expect(names).toContain('project_info'); expect(names).not.toContain('workspace_info')
    expect(serverInstructions({ arts: [], legacyCount: 2 })).toContain('2 older arts')
    expect(serverInstructions({ workspace: wtWs, arts: [] })).toContain(join(main, 'app', 'squarel_art'))
    ```
  - `test/docs.test.ts` keeps passing after `pnpm docs:tools`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/tools.test.ts test/mcp.test.ts test/docs.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Rename the tools.
  - Update skills, docs and evals text: "Dự án"/project, art, the rule that a project is needed, and the new names.
  - Run `pnpm docs:tools`.
- [ ] **Step 4: Run them to see them pass.**
  Run: `pnpm vitest run` (whole root suite)
  Expected: PASS, except bridge tests, which Task 8 fixes. List them in the task report.
- [ ] **Step 5: Commit.** `feat(tools)!: art_* and project_info tool names; art parameter`

### Task 5: `art_import` (legacy → project)

**Files:**
- Create: `src/store/import.ts`
- Modify: `src/tools/workspace.ts`
- Test: `test/import.test.ts` (new)

**Interfaces:**
- Consumes:
  - Task 2: `Store` (`root`, `projectPath`, `writeThumb`), `writeCatalog`.
  - Task 3: `ctx.legacy`, `artStore`.
- Produces:
  - `importLegacyArt(legacy: Store, target: Store, slug: string, o?: { log?: Logger; fs?: Pick<typeof import('node:fs/promises'), 'cp' | 'rename' | 'rm'> }): Promise<{ slug: string; from: string; to: string }>`
  - Tool `art_import { slug: string }`. Its text: `Moved "<old>" into <project name> as "<new>" (<to>).`

- [ ] **Step 1: Write failing tests** in `test/import.test.ts`:
  - **`moves an art with its history`:**
    - `versions/` count, `head` and `history()` length are equal before and after;
    - the source folder is gone;
    - `project.json` has no `workspace` key;
    - `thumb.png` exists in the target;
    - the catalog lists it.
  - **`an id taken in the project gets -2`:** the result has `slug === 'hero-2'`.
  - **`a failure after copying keeps the source and removes the temp copy`:** inject `fs.rm` that throws on the first call. The source remains, `squarel_art/.hero.importing` is absent, and the call rejects.
  - **`works across drives` (Review Focus 1):** inject `fs.rename` throwing `Object.assign(new Error('x'), { code: 'EXDEV' })`; the import succeeds.
  - **`refuses while the source is locked`:** hold `withLock(legacy.projectPath('hero', '.lock'))` with a never-resolving fn. The import rejects within the lock's timeout, and the source is unchanged.
  - **`refuses an unknown slug`:** rejects with `NOT_FOUND`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/import.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement.** All under `withLock(legacy.projectPath(slug, '.lock'))`:
  1. `cp` the source into `target.root/.<slug>.importing`, skipping `.lock` and `*.tmp`.
  2. Compare relative file lists and sizes.
  3. Decode `versions/<head>.json.gz` from the temp copy. Extract the `readVersion` decoding into `readVersionFile(path): Promise<PixelDoc>` in `store.ts` and reuse it.
  4. Pick a free slug in the target (same suffix rule as `createProject`).
  5. `rename` the temp folder to the final slug inside `target.root`. This rename is always on the same drive.
  6. Drop `workspace` from `project.json`.
  7. `rm` the source.
  8. Run `target.writeThumb`, and `writeCatalog` when `target` has a project.

  Any failure before step 7 removes the temp folder.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: art_import moves legacy art into the project`

### Task 6: Duplicate project id guard in the MCP

**Files:**
- Modify: `src/store/workspace.ts`, `src/tools/context.ts`
- Test: `test/workspace.test.ts`, `test/tools.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `gitCommonDir`, `readWorkspaceIndex`.
  - Task 3: `CreateContextOptions.projectStart`.
- Produces:
  - `duplicateProjectFolder(dataDir: string, ws: Workspace): Promise<string | undefined>` returns the other folder when all of these hold:
    - the index entry for `ws.id` points to a folder that is not `ws.home`;
    - that folder exists;
    - it declares the same id;
    - its `gitCommonDir` differs from `ws.home`'s, or either one is undefined.
  - The context sets `session.duplicateOf` to that folder. It builds `arts` with `readOnly: \`Project id "${id}" is also used by ${other}. Change the id in .squarel/project.json (or in Squarel Art Launcher → project → Cài đặt) to keep drawing here.\``

- [ ] **Step 1: Write failing tests:**
  - `a copied folder with the same id is a duplicate`:
    - two plain folders with the same id, index → first;
    - the context started in the second has `duplicateOf === first`;
    - `art_create` rejects with the read-only text;
    - `art_list` works.
  - `a worktree of the registered folder is not a duplicate`: the Task 1 layout, with the index pointing at `main/app`.
  - `instructions name the other folder`: `serverInstructions({ workspace, arts: [], legacyCount: 0, duplicateOf: first })` contains `first`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/workspace.test.ts test/tools.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: block art writes when the project id is used by another folder`

### Task 7: Bridge project directory

**Files:**
- Create: `src/bridge/projects.ts`
- Modify: `src/mcp/presence.ts`
- Test: `test/bridge-projects.test.ts` (new), `test/presence.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `readWorkspace`, `detectWorkspace` home rule (reuse its resolver; export it as `resolveHome(ws: Workspace): Promise<string>` in Task 1's module if needed), `gitCommonDir`.
  - Task 2: `Store`.
- Produces:
  - `McpPresence.workspace?: { id: string; name: string; folder: string }`, where `folder` is `ws.home`.
  - `interface KnownProject { id: string; name: string; home: string; ws: Workspace; store: Store }`
  - `class ProjectDirectory`:
    - `constructor(o: { dataDir: string; log: Logger })`
    - `get(id: string): Promise<KnownProject>`. It throws `ToolError('NOT_FOUND', …)` when the id is unknown or the folder no longer declares it, and `ToolError('DUPLICATE_PROJECT', …)` naming both folders when two different homes outside one git repository declare it.
    - `list(): Promise<KnownProject[]>`: duplicates are skipped and logged.
    - `refresh(): Promise<boolean>`: true when the set of homes changed.
    - `homes(): string[]`
  - Sources, in this order:
    1. presence files `DATA_DIR/run/mcp-*.json` with `workspace.folder`, where the pid is alive (`process.kill(pid, 0)`);
    2. the index `DATA_DIR/workspaces/*.json`. Each index folder is resolved to its home with the Task 1 rule.
  - Learned mappings are cached for the directory's lifetime.
  - Each `get` re-reads `<home>/.squarel/project.json` and drops the cache entry when the id changed.
  - Stores are built with `project: ws` and the post-commit hooks on.

- [ ] **Step 1: Write failing tests** in `test/bridge-projects.test.ts`. Use a home folder named `Dự án game` (Review Focus 2).
  - `resolves an id from a live presence file`: write `run/mcp-<process.pid>.json` with `workspace.folder`.
  - `keeps the mapping after the session's presence file is removed`.
  - `falls back to the index`.
  - `a worktree presence and the main index entry are one project, not a duplicate`.
  - `two copied folders with one id → DUPLICATE_PROJECT naming both`.
  - `after the user edits the id, get(old) is NOT_FOUND and get(new) resolves via the index` (Review Focus 4).

  In `test/presence.test.ts`, the presence file carries `workspace.folder === ws.home`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/bridge-projects.test.ts test/presence.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(bridge): resolve project ids from live sessions and the index`

### Task 8: Bridge protocol 2 and multi-project server

**Files:**
- Modify:
  - `src/bridge/protocol.ts`, `src/bridge/server.ts`, `src/bridge/remote.ts`, `src/bridge/index.ts`
  - `src/mcp/index.ts`
  - `src/tools/types.ts` (`EditorHost.open(ref)`)
  - `src/tools/misc.ts` (`open_in_editor`)
- Test: `test/bridge.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `artRef`, `parseArtRef`.
  - Task 3: `ToolContext`.
  - Task 7: `ProjectDirectory`, `KnownProject`.
- Produces:
  - `BRIDGE_PROTOCOL = 2`.
  - `ArtEntry { ref; project; projectName; art; name; head }`.
  - `ClientMessage`:
    - `hello { client; ext?; app?; aseprite?; protocol?: number }`
    - `list`
    - `open { ref }`
    - `cels { ref; baseVersion; doc; label? }`
    - `tool { id; name; input?; ref? }`
    - `ping`, `status`
  - `ServerMessage`:
    - `welcome { server; version; protocol: 2; arts: ArtEntry[] }`
    - `arts { arts: ArtEntry[] }`, which replaces `projects`
    - `doc`, `ack`, `rebased`, `doc.updated`, `open.request`: all carry `ref` instead of `slug`
    - `tool_result`, `pong`, `status`, `error` are unchanged
  - `BridgeClientInfo.ref?` replaces `slug`.
  - A `hello` without `protocol: 2` gets `{ type: 'error', code: 'extension-outdated', message: 'This Squarel bridge (0.4) needs the Squarel extension 0.4 or newer. Update it from Squarel Art Launcher: Aseprite → Cài extension.' }`, and the socket is closed.
  - `new BridgeServer(ctx, { port, token, projects: ProjectDirectory, host?, watchFiles? })`.
  - Ref-based methods: `notify(ref, versionId?)`, `open(ref)`, `writeWorkFile(ref)`, `importWorkFile(ref)`, `applyEditorState(ref, base, doc, label)`.
  - Tools run for a client with `{ ...ctx, arts: p.store, session: { workspace: p.ws, activeProject: art } }`. The project comes from `m.ref`, or else the client's current ref. When neither exists, the result is `tool_result ok: false` with `NO_PROJECT_TEXT`.
  - Watching:
    - one chokidar watcher over `projects.homes().map(h => join(h, ART_DIR))`, depth 1, with the same ignore rule as today;
    - a second watcher on `DATA_DIR/run` and `DATA_DIR/workspaces` calls `projects.refresh()`, then `watcher.add(newRoots)`;
    - a changed file maps back to a ref through its root prefix.
  - `openViaBridge({ port, token, ref })` sends `hello { client: 'squarel-mcp', protocol: 2 }`, then `tool { name: 'open_in_editor', ref, input: {} }`.
  - MCP:
    - `ctx.onCommit = (slug, v) => bridge.notify(artRef(ws.id, slug), v)`;
    - the bridge is constructed with `new ProjectDirectory({ dataDir, log })`;
    - `open_in_editor` calls `ctx.editor.open(artRef(ws.id, slug))`.

- [ ] **Step 1: Update and write failing tests** in `test/bridge.test.ts`. Port the existing tests to refs and protocol 2. New cases:
  - `two projects with an art named hero stay apart`: edits to `a/hero` never reach a client holding `b/hero`.
  - `a commit by another process in a project folder reaches Aseprite`: the watcher case, with the home `Dự án game` (Review Focus 2).
  - `a project that appears after start (new presence file) is watched`.
  - `hello without protocol 2 gets extension-outdated and is closed`.
  - `tool export with ref runs in that project and writes to its squarel_art/<art>/exports`.
  - `list returns ArtEntry for every known project`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/bridge.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run them to see them pass.**
  Run: `pnpm check`
  Expected: typecheck, lint and every root test PASS.
- [ ] **Step 5: Commit.** `feat(bridge)!: protocol 2 with project/art refs across many projects`

### Task 9: Aseprite extension speaks protocol 2

**Files:**
- Modify: `integrations/aseprite/squarel/plugin.lua`, `integrations/aseprite/squarel/package.json` (`"version": "0.4.0"`)
- Test: `test/lua.test.ts` (and its fixtures in `test/lua/`)

**Interfaces:**
- Consumes: Task 8 messages.
- Produces:
  - Sprite property `squarel_ref` replaces `squarel_slug`.
  - `hello` sends `protocol = 2` and `ext = '0.4.0'`.
  - The open dialog lists `"<projectName> / <name>"` and sends `open { ref }`.
  - The handler `arts` replaces `projects`.
  - On `error` with `code == 'extension-outdated'`, show `m.message` in an alert.
  - Empty list text: `No art yet. Open Claude Code in a Squarel project and ask it to create one.`
  - The export menu sends `tool { name = 'export', ref = ref, input = { preset = … } }`.
  - The launcher needs no new Health check. Its existing `extension-version` check compares this `package.json` version with the installed one. After the bump to 0.4.0, it flags an old extension and offers "Cài extension".

- [ ] **Step 1: Update `test/lua.test.ts`** for the new message shapes. Add cases:
  - `hello carries protocol 2`;
  - `open dialog labels are project / art and send the ref`;
  - `an outdated-extension error is shown`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm vitest run test/lua.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement** in `plugin.lua`.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(aseprite): extension 0.4.0 with project/art refs`

### Task 10: Launcher reads art from project folders

**Files:**
- Create: `launcher/src/main/worktree.ts`
- Modify:
  - `launcher/src/main/workspaces.ts`, `launcher/src/main/ipc-handlers.ts`, `launcher/src/shared/ipc.ts`
  - `launcher/src/renderer/pages/{Projects,ProjectDetail,ProjectNew}.tsx`, `launcher/src/renderer/pages/project-ui.tsx`
- Test: `launcher/test/workspaces.test.ts`, `launcher/test/e2e/workspaces.spec.ts`, `launcher/test/e2e/projects.spec.ts`, `launcher/test/fixtures/workspaces/`

**Interfaces:**
- Consumes: the folder contract (`squarel_art`, `ART_GITIGNORE` text duplicated as a launcher constant), and presence `workspace.folder`.
- Produces:
  - `ART_DIR`, `ART_GITIGNORE`.
  - `readArts(ctx, folder: string): Promise<ArtMeta[]>` reads `<folder>/squarel_art`; `ArtMeta.workspace` is dropped.
  - `readThumb(ctx, folder: string, slug: string)` accepts only a real path inside `<folder>/squarel_art`.
  - `planFolderFiles` adds `squarel_art/` and `squarel_art/.gitignore`, each `create` or `keep`.
  - `createWorkspace` writes them.
  - `worktreeMain(d: Deps, folder: string): Promise<string | undefined>`: same algorithm as Squarel's `mainCheckoutOf`, through `Deps.fs`.
  - `checkChosenFolder` refuses a linked worktree with `Thư mục này là một git worktree. Hãy chọn thư mục dự án ở bản chính: <main>`.
  - `WorkspaceSummary.duplicate?: string` is set when a live presence session declares this id with a `workspace.folder` other than the index folder.
  - `updateWorkspace` patch accepts `id`. It checks the regex and uniqueness (same rule as `uniqueId`), rewrites `.squarel/project.json` keeping unknown fields, and renames the index file. The response is the detail under the new id.
  - Remove-dialog copy: `Gỡ khỏi launcher không xoá gì. Art của dự án vẫn nằm trong <folder>\squarel_art. Xoá thư mục dự án là mất art.`

- [ ] **Step 1: Write failing tests** in `launcher/test/workspaces.test.ts`:
  - `arts come from <folder>/squarel_art`: the fixture art is in the folder, not in DATA_DIR.
  - `inspectFolder plans squarel_art and its .gitignore`: `create`, and `keep` when they exist.
  - `create keeps an existing squarel_art/.gitignore`.
  - `a linked worktree folder is refused with the main folder named`.
  - `a live session declaring the id from another folder marks duplicate`.
  - `changing the id rewrites project.json and the index; a taken id is refused`.
  - `readThumb refuses a path outside squarel_art`.

  Update fixture `test/fixtures/workspaces` so its arts live in the project folders.
- [ ] **Step 2: Run them to see them fail.**
  Run: `cd launcher && pnpm vitest run test/workspaces.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement.** In the UI:
  - the "Launcher sẽ ghi" list shows the two new lines;
  - the card shows a warning `Trùng mã với <folder>` with a link to Cài đặt;
  - Cài đặt has a "Mã dự án" field;
  - remove dialog copy as above.
- [ ] **Step 4: Run them to see them pass.**
  Run: `cd launcher && pnpm check && pnpm build && npx playwright test test/e2e/workspaces.spec.ts test/e2e/projects.spec.ts`
  Expected: PASS. Update the e2e asserts for the new lines and the art location.
- [ ] **Step 5: Commit.** `feat(launcher): read art from project folders; squarel_art on create`

### Task 11: Launcher legacy art and import

**Files:**
- Modify:
  - `launcher/src/main/workspaces.ts`, `launcher/src/main/actions.ts`, `launcher/src/main/ipc-handlers.ts`
  - `launcher/src/shared/ipc.ts`, `launcher/src/preload/index.ts`
  - `launcher/src/renderer/pages/Projects.tsx` (the card), plus a legacy art view in `Projects.tsx` or a new `launcher/src/renderer/pages/LegacyArts.tsx` (builder's call), and `nav.ts` if a page is added
- Test: `launcher/test/workspaces.test.ts`, `launcher/test/ipc.test.ts`, `launcher/test/e2e/projects.spec.ts`

**Interfaces:**
- Consumes: Task 10 `readArts`, the CLI contract `pnpm cli art_import --slug <slug>` with env `SQUAREL_PROJECT_DIR=<folder>` (Tasks 3 and 5).
- Produces:
  - `legacyArts(ctx): Promise<ArtView[]>` lists every art in `DATA_DIR/projects`. It replaces `unassignedArts`.
  - IPC: `arts:legacy` (output `artViewSchema[]`) replaces `workspaces:unassigned`. `arts:import { slug, workspaceId }` returns a task id.
  - `resolveImportArt(ctx: ActionCtx, slug: string, folder: string): Resolved`:
    - key `squarel:import-art:<slug>`, `squarelDir: true`, busyText `Đang chuyển art <slug>…`;
    - its body runs `['pnpm', 'cli', 'art_import', '--slug', slug]` in the Squarel folder with `env: { SQUAREL_PROJECT_DIR: folder }`, through the same `runStep` used by other Squarel-folder tasks.
  - Card `Art cũ` (testid `ws-legacy`) appears only when `legacyArts` is non-empty. Its list has a `Chuyển vào dự án…` button per art. The dialog has a select of projects and the confirm line `Chuyển "<name>" vào <project>? Art sẽ được chép sang <folder>\squarel_art, kiểm tra xong mới xoá bản cũ.` Confirming starts the task. On `done`, the lists reload.

- [ ] **Step 1: Write failing tests.**

  In `launcher/test/ipc.test.ts`:
  - **`arts:import runs the CLI in the Squarel folder with SQUAREL_PROJECT_DIR`:** the fake `run` sees the exact argv, `cwd === SQ` and `env.SQUAREL_PROJECT_DIR === folder`.
  - **`arts:import refuses an unknown workspace or slug`.**

  In `launcher/test/workspaces.test.ts`:
  - **`legacyArts ignores the old workspace field and lists all`.**

  In e2e `projects.spec.ts`:
  - **`Art cũ → Chuyển vào dự án → confirm → task runs`:** fake fixture `run` for the import command moves the fixture files; the art then appears in the project detail.
- [ ] **Step 2: Run them to see them fail.**
  Run: `cd launcher && pnpm vitest run test/ipc.test.ts test/workspaces.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run them to see them pass.**
  Run: `cd launcher && pnpm check && pnpm build && npx playwright test test/e2e/projects.spec.ts`
  Expected: PASS.
- [ ] **Step 5: Commit.** `feat(launcher): legacy art card with move into project`

### Task 12: Launcher recent art, Aseprite picker and bridge client on refs

**Files:**
- Modify:
  - `launcher/src/main/{ipc-handlers,actions,presence,index}.ts`
  - `launcher/src/main/bridge/{client,types,supervisor}.ts`
  - `launcher/src/main/registry/registry.ts`
  - `launcher/src/shared/ipc.ts`, `launcher/src/preload/index.ts`
  - `launcher/src/renderer/pages/{Home,Integration}.tsx`
  - `integrations/aseprite/integration.json` (labels)
- Test:
  - `launcher/test/ipc.test.ts`, `launcher/test/actions-lifecycle.test.ts`, `launcher/test/presence.test.ts`, `launcher/test/bridge-supervisor.test.ts`
  - e2e specs that use recent projects (`home`/`integration` specs)

**Interfaces:**
- Consumes: Task 8 protocol (`hello.protocol`, `tool.ref`, `BridgeClientInfo.ref`), Task 10 `readArts`.
- Produces:
  - `recentArtSchema { ref: /^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9-]{0,63}$/, name, projectName, width?, height?, version, updatedAt }` replaces `recentProjectSchema`. IPC `arts:recent` (max 3, across all indexed projects) replaces `projects:recent`.
  - `ActionRef.project` (slug regex) becomes `ActionRef.art` (ref regex).
  - `ActionCtx`:
    - `recentProject` becomes `recentArt` (a ref);
    - `projects()` becomes `artRefs(): Promise<string[]>`;
    - `bridgeTool(name: string, input: unknown, ref?: string)`.
  - The manifest keys `pickProject` and `{recentProject}` are kept, and their value is now a ref. Labels in `integration.json` become `Mở art…` and `Mở {recentProject}`.
  - `BridgeConnection.sendTool(name, input, ref?)` sends `{ type: 'tool', id, name, input, ref }`. `hello` sends `{ type: 'hello', client: 'launcher', protocol: 2 }`.
  - `BridgeClientInfo.ref` replaces `slug`. The presence subtitle is `[ref, app]`.
  - Home section title `Art gần đây`; each card shows `name` and `projectName`.

- [ ] **Step 1: Update and write failing tests:**
  - `arts:recent gathers the newest arts of two projects with refs`.
  - `open-recent sends open_in_editor with the newest ref`: `bridgeTools` sink gets `{ name: 'open_in_editor', input: {}, ref: 'b/hero' }`; extend the sink with `ref`.
  - `a pickProject action refuses a ref that does not exist`.
  - `the launcher hello declares protocol 2`.
  - `presence subtitle shows the ref`.
- [ ] **Step 2: Run them to see them fail.**
  Run: `cd launcher && pnpm vitest run`
  Expected: FAIL in the updated tests.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run them to see them pass.**
  Run: `cd launcher && pnpm check && pnpm build && npx playwright test`
  Expected: all unit and e2e tests PASS.
- [ ] **Step 5: Commit.** `feat(launcher)!: art refs for recent art, the Aseprite picker and the bridge client`

### Task 13: Release 0.4.0 and real-machine check

**Files:**
- Modify:
  - `package.json`, `launcher/package.json` (`0.4.0`)
  - `CHANGELOG.md`, `SECURITY.md` (supported versions table)
  - `docs/release.md` example tag
  - e2e fixtures and specs that pin versions (as was done for 0.3.0)
- Test: full suites

- [ ] **Step 1: Bump versions and write the CHANGELOG.** Add `## [0.4.0]`:
  - **Changed (breaking):** the art location, required projects, the tool renames table, bridge protocol 2 with extension 0.4.0.
  - **Added:** `art_import`, the legacy art card, worktree support, the duplicate id guard, changing a project's id.
  - **Migration:** how to move old art.
  - The Health fix already in Unreleased moves under 0.4.0.
- [ ] **Step 2: Run the root checks.**
  Run: `pnpm check`
  Expected: PASS.
- [ ] **Step 3: Run the launcher checks.**
  Run: `cd launcher && pnpm check && pnpm build && npx playwright test`
  Expected: PASS.
- [ ] **Step 4: Build the installer.**
  Run: `cd launcher && pnpm dist`
  Expected: `launcher/dist/Squarel-Art-Launcher-Setup-0.4.0.exe`.
- [ ] **Step 5: Report the manual checklist for the user** (spec §8, "Thử trên máy thật"), as a list in the final report. Do not mark it done.
- [ ] **Step 6: Commit.** `chore(release): 0.4.0`. Do not tag or push.
