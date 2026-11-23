# Squarel Art Launcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ứng dụng desktop Electron, bố cục kiểu Riot Client, gồm:
- wizard cài đặt lần đầu;
- theo dõi kết nối (phiên Claude Code, bridge, công cụ, dịch vụ ảnh);
- health check;
- quản lý và cập nhật thành phần;
- mở các công cụ tích hợp.

Thêm công cụ mới chỉ cần một file `integration.json`.

**Architecture:**
- **Main process:** gồm các module thuần Node, nhận phụ thuộc qua tham số (`Deps`) để test được không cần Electron. Launcher chỉ nói chuyện với Squarel qua lệnh, WebSocket của bridge và file.
- **Renderer:** React, chạy sandbox, gọi main qua một danh sách IPC cố định, mỗi lệnh có schema zod.
- **Giao diện:** dựng theo Figma bằng CSS variables xuất từ biến Figma.

**Tech Stack:** Electron (bản ổn định mới nhất lúc làm, ghi cứng vào `package.json`), electron-vite, React 19, TypeScript, zod 4, ws, `@modelcontextprotocol/sdk` (client), electron-builder (NSIS), electron-updater, vitest, `@playwright/test` (Electron), biome.

**Spec:** `docs/superpowers/specs/2026-11-22-launcher-design.md`. Figma: file `AWBBKBpJ02xrY41bo45Ais`, trang "Launcher" (wizard hàng 1, ứng dụng hàng 2), trang "Lưu trữ v1" (nội dung các tab Health check, Nhật ký, Cấu hình).

**Phụ thuộc:** làm **sau** `docs/superpowers/plans/2026-11-22-squarel-launcher-contracts.md`. Plan này dùng thông điệp `status` của bridge, file `DATA_DIR/run/mcp-<pid>.json`, `integrations/schema/integration.schema.ts`, `integrations/catalog.json` và cờ `--json-progress`.

## Global Constraints

- **Nền tảng và cửa sổ:** Windows 11. Cửa sổ 1280×800, không viền hệ điều hành, dùng thanh tiêu đề riêng. Panel Kết nối rộng **272px**.
- **Node hệ thống:** ≥ **22.18** (`node --version`). Squarel luôn chạy bằng Node hệ thống, không chạy bằng Node trong Electron.
- **Đường dẫn:**
  - trạng thái launcher: `%APPDATA%\SquarelArt Launcher\state.json`;
  - tích hợp của người dùng: `%APPDATA%\SquarelArt Launcher\integrations\<id>\`;
  - Squarel cài mới: `%LOCALAPPDATA%\SquarelArt\app`;
  - công cụ: `%LOCALAPPDATA%\SquarelArt\tools\<id>`.
- **Repo:** `t1tc01-personal/squarel-art-2` (công khai). Bản phát hành đầu là tag **`v0.2.0`**, dùng chung một số phiên bản cho launcher và Squarel.
- **Lịch chạy:** health check **10 phút** một lần khi launcher đang mở. Kiểm tra cập nhật lúc mở và mỗi **6 giờ**.
- **Phiên MCP:** coi là cũ khi `updatedAt` quá **30 giây** hoặc pid đã chết. Coi là "đang làm" nếu có `lastToolAt` trong **15 giây** gần nhất.
- **Bridge:** cổng mặc định **4321** (đọc `BRIDGE_PORT` trong `.env`). Ai mở trước thì giữ cổng. Launcher chiếm cổng khi người đang giữ rời đi. Chỉ dừng bridge do chính launcher giữ.
- **Chạy lệnh:**
  - chỉ chạy từ thư mục Squarel hoặc thư mục tích hợp của người dùng;
  - `argv` là mảng, không bao giờ đưa chuỗi do người dùng nhập vào shell;
  - biến thay thế chỉ gồm `{toolsDir} {exe} {exeDir} {version} {recentProject}` (dùng `substitute` của schema).
- **Không tốn tiền:** health check không gọi API trả phí. Retro Diffusion chỉ kiểm tra có key hay không.
- **Cài đặt cần đồng ý:** mỗi thao tác cài hiện lệnh, dung lượng ước tính và nút "Cài". Câu hỏi quyền admin và điều khoản winget do người dùng tự trả lời.
- **Khoá API:** chỉ nằm trong `.env`. Giao diện hiện dạng che (`••••` + 4 ký tự cuối). Không ghi khoá ra log.
- **Renderer:** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Không tải nội dung từ mạng.
- **Chữ:** giao diện tiếng Việt. Font Geist / Geist Mono; Pixelify Sans chỉ cho chữ "SQUAREL".
- **Phát hành:** bộ cài kèm `LICENSE.md` (PolyForm Shield 1.0.0).
- **Cách làm:** nhánh `feat/launcher`, mỗi task một commit, `pnpm --dir launcher check` xanh sau mỗi task.

## Review Focus

1. **Đường dẫn có dấu cách hoặc tiếng Việt** (tên tài khoản Windows như `Nguyễn Văn A`, thư mục `D:\Dự án\…`): chạy lệnh, đọc/ghi `.env` và `state.json` đều đúng. → test ở Task 3, Task 2.
2. **`.env` do người viết tay:** có CRLF, BOM, chú thích, khoá trùng, dòng trống. Sửa một biến không được làm hỏng các dòng khác. → test ở Task 2.
3. **Cổng 4321 do chương trình khác giữ:** launcher báo "cổng bị chương trình khác dùng", thử lại thưa (30 giây), không quay vòng liên tục, không treo giao diện. → test ở Task 7.
4. **Máy offline hoặc GitHub giới hạn tốc độ:** kiểm tra cập nhật và tag mới thất bại nhẹ nhàng, hiện "Không kiểm tra được". Không crash, không đánh dấu thành phần là lỗi. → test ở Task 4, Task 10.
5. **File phiên MCP sót lại sau crash, hoặc pid bị tái sử dụng:** không hiện "phiên ma". → test ở Task 8.

## File Structure

```
launcher/
  package.json · electron.vite.config.ts · electron-builder.yml · tsconfig*.json · vitest.config.ts · playwright.config.ts · biome.json (extends ../biome.json)
  src/shared/   model.ts (kiểu dữ liệu dùng chung) · ipc.ts (danh sách kênh + zod)
  src/main/     index.ts (vòng đời app, cửa sổ) · deps.ts (Deps thật / giả) · paths.ts · state.ts · env-store.ts · run.ts · versions.ts
                registry/{core.ts,integrations.ts,registry.ts} · checks/{runner.ts,builtin.ts} · bridge/{client.ts,supervisor.ts}
                presence.ts · claude.ts · updates/{launcher.ts,squarel.ts,tools.ts} · setup.ts · scheduler.ts · ipc-handlers.ts · tray.ts
  src/preload/  index.ts
  src/renderer/ main.tsx · App.tsx · tokens.css · api.ts · nav.ts
                components/{Button,StatusPill,Field,RowComponent,RowCheck,SubTabs,LaunchButton,PresenceRow,Icon}.tsx
                layout/{TitleBar,AppRail,ConnectionsPanel}.tsx · pages/{Home,Library,Integration,System,Settings}.tsx · setup/{Wizard,Step1..Step4}.tsx
                assets/icons/*.png (icon pixel xuất từ Figma)
  test/         *.test.ts (unit, Node) · e2e/*.spec.ts (Playwright Electron) · sandbox/squarel.wsb
.github/workflows/release.yml
docs/launcher.md · docs/release.md · docs/launcher/screens/*.png
```

Kiểu dữ liệu dùng chung (`src/shared/model.ts`, tạo ở Task 1, dùng ở mọi task):

```ts
export type Level = 'ok' | 'warn' | 'error' | 'running' | 'idle'
export interface ComponentView { id: string; name: string; description: string; kind: 'core' | 'integration'; icon: string; accent?: string; required: boolean; installed: boolean; version?: string; latest?: string; latestError?: string; level: Level; levelLabel: string; incompatible?: string; actions: ActionRef[] }
export interface ActionRef { componentId: string; kind: 'install' | 'update' | 'launch' | 'extension' | 'fix' | 'terminal'; id: string; label: string; needsConsent?: { command: string; sizeHint?: string } }
export interface CheckResult { id: string; group: 'claude' | 'bridge' | 'ai' | 'machine' | string; label: string; description: string; result: 'pass' | 'warn' | 'fail'; detail: string; fix?: ActionRef }
export interface PresenceItem { id: string; title: string; subtitle: string; status: 'online' | 'busy' | 'away' | 'offline'; icon: string }
export interface PresenceGroup { id: 'claude' | 'tools' | 'services'; label: string; items: PresenceItem[] }
export interface TaskEvent { taskId: string; kind: 'line' | 'progress' | 'done' | 'error'; text?: string; percent?: number; code?: number }
```

---

### Task 1: Khung ứng dụng, token giao diện, cửa sổ

**Files:**
- Create: toàn bộ khung `launcher/` (package, config, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/{main.tsx,App.tsx,tokens.css}`, `src/shared/model.ts`)
- Create: `launcher/test/e2e/smoke.spec.ts`
- Modify: `.gitignore` (thêm `launcher/out/`, `launcher/dist/`)

**Interfaces:**
- Produces:
  - lệnh `pnpm --dir launcher dev | build | test | e2e | check`;
  - `tokens.css` gồm CSS variables trùng tên biến Figma (`--bg-app`, `--bg-surface`, `--text-primary`, `--accent-primary`, `--accent-brand`, `--status-ok`… và `--space-*`, `--radius-*`);
  - các kiểu dữ liệu trong `model.ts`.

- [ ] **Step 1:** Test e2e `launches a frameless 1280x800 window showing the SQUAREL wordmark`: dùng `_electron.launch({ args: ['.'] })`, kích thước cửa sổ `1280×800`, `page.getByText('SQUAREL')` hiển thị.
- [ ] **Step 2:** Chạy `pnpm --dir launcher e2e` → FAIL.
- [ ] **Step 3:** Dựng khung electron-vite + React.
  - Cửa sổ: `frame: false`, `backgroundColor` = `--bg-app` (`#0D0E12`), `webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }`.
  - Xuất 31 biến từ hai collection Figma "Launcher tokens" và "Launcher spacing" thành `tokens.css` (dùng `use_figma` với `getLocalVariablesAsync`, hoặc copy giá trị trong spec/Figma).
  - Font Geist / Geist Mono / Pixelify Sans tải từ gói npm `@fontsource/*` (đóng gói cùng app, không tải từ mạng).
- [ ] **Step 4:** Chạy e2e → PASS. Chạy `pnpm --dir launcher check` (tsc + biome + vitest) → PASS.
- [ ] **Step 5:** Commit `feat(launcher): electron shell with design tokens`

### Task 2: Đường dẫn, `state.json`, EnvStore

**Files:**
- Create: `src/main/paths.ts`, `src/main/state.ts`, `src/main/env-store.ts`
- Test: `test/state.test.ts`, `test/env-store.test.ts`

**Interfaces:**
- Produces:

```ts
export function appPaths(env: NodeJS.ProcessEnv): { stateFile: string; userIntegrations: string; defaultInstall: string; toolsDir(id: string): string }
export interface LauncherState { schema: 1; squarelDir?: string; mode?: 'fresh' | 'clone'; setupStep: 1 | 2 | 3 | 4 | 'done'; selected: string[]; installChoice: Record<string, string>; closeToTray: boolean; autostart: boolean; lastUpdateCheck?: string }
export async function loadState(file: string): Promise<LauncherState>   // thiếu hoặc hỏng → mặc định { schema:1, setupStep:1, selected:[], installChoice:{}, closeToTray:true, autostart:false }
export async function saveState(file: string, s: LauncherState): Promise<void> // ghi atomic
export interface EnvDoc { lines: string[]; eol: '\r\n' | '\n'; bom: boolean }
export function parseEnv(text: string): EnvDoc
export function getVar(doc: EnvDoc, key: string): string | undefined   // trùng khoá → lấy dòng cuối (giống dotenv)
export function setVar(doc: EnvDoc, key: string, value: string): EnvDoc // sửa dòng cuối của khoá đó, nếu chưa có thì thêm vào cuối
export function serializeEnv(doc: EnvDoc): string
export function maskSecret(v: string | undefined): string               // '' | '••••' + 4 ký tự cuối
```

- [ ] **Step 1:** Viết test (Review Focus 1, 2):
  - `round-trips CRLF, BOM, comments and blank lines byte for byte`
  - `setVar edits only the last occurrence of a duplicated key`
  - `setVar appends a missing key with the file's line ending`
  - `values with spaces, # and Vietnamese text survive` (`DATA_DIR=D:\Dự án\Squarel data`)
  - `maskSecret("abcd1234wxyz") === "••••wxyz"`
  - `state in a profile with Vietnamese/space characters loads and saves` (thư mục tạm có tên `Nguyễn Văn A`)
  - `corrupt state.json falls back to defaults`
- [ ] **Step 2:** Chạy `pnpm --dir launcher test` → FAIL.
- [ ] **Step 3:** Code các hàm đúng chữ ký trên.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): state and .env store`

### Task 3: Chạy lệnh an toàn

**Files:**
- Create: `src/main/run.ts`
- Test: `test/run.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RunSpec { argv: string[]; cwd: string; env?: Record<string, string>; signal?: AbortSignal; onLine?: (line: string, stream: 'stdout' | 'stderr') => void }
export async function runCommand(spec: RunSpec): Promise<{ code: number }>
export function resolveExecutable(name: string, env: NodeJS.ProcessEnv): { path: string; kind: 'exe' | 'cmd' } | undefined // tìm theo PATH + PATHEXT
export function quoteForCmd(arg: string): string // dùng khi argv[0] là shim .cmd/.bat (pnpm, npm, claude.cmd)
export function parseProgressLine(line: string): { step: number; total: number; label: string; percent?: number } | undefined // dòng "@@progress {...}"
export async function isProcessRunning(imageName: string): Promise<boolean> // tasklist /FI "IMAGENAME eq x" /NH
```

- File `.exe` được spawn trực tiếp, không qua shell. Shim `.cmd`/`.bat` chạy qua `cmd.exe /d /s /c` với từng argument đã qua `quoteForCmd`.
- `quoteForCmd`:
  - **từ chối** argument chứa `"` hoặc xuống dòng (ném lỗi);
  - bọc ngoặc kép khi có dấu cách;
  - escape `^ & | < > ( ) % !` bằng `^`.
- [ ] **Step 1:** Viết test (Review Focus 1):
  - `runs node with an argument containing spaces and Vietnamese` (in ra `process.argv[2]`, so khớp nguyên văn `D:\Dự án\a b`)
  - `runs a .cmd shim with the same argument unchanged` (tạo `echo-arg.cmd` tạm, gọi `node` in arg)
  - `quoteForCmd escapes metacharacters and rejects quotes/newlines`
  - `streams lines to onLine in order and returns the exit code`
  - `abort signal kills the child`
  - `parseProgressLine reads @@progress JSON and ignores other lines`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code đúng chữ ký trên.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): safe command runner`

### Task 4: Phiên bản và nguồn bản mới

**Files:**
- Create: `src/main/versions.ts`
- Test: `test/versions.test.ts`

**Interfaces:**
- Produces:

```ts
export function compareVersions(a: string, b: string): number           // "1.3.18.6" < "1.3.19"; bỏ "v" ở đầu; hậu tố -dev bằng bản gốc
export function satisfiesMin(version: string, min: string): boolean     // node ≥ 22.18
export type Latest = { ok: true; version: string } | { ok: false; reason: 'offline' | 'rate-limited' | 'not-found' | 'error'; message: string }
export async function latestGitTag(repo: string, deps: Pick<Deps, 'run'>): Promise<Latest>              // git ls-remote --tags --refs, chỉ tag ổn định
export async function latestGithubRelease(ownerRepo: string, deps: Pick<Deps, 'fetch'>): Promise<Latest> // GET /repos/{o}/{r}/releases/latest
```

- [ ] **Step 1:** Viết test (Review Focus 4):
  - `compareVersions orders aseprite-style 4-part versions and strips v`
  - `satisfiesMin("v24.19.0","22.18") is true; "v22.17.1" is false`
  - `latestGitTag picks newest stable tag from ls-remote output` (giả output; tái dùng logic `pickLatestStableTag`)
  - `network failure → { ok:false, reason:'offline' }`
  - `HTTP 403 with x-ratelimit-remaining:0 → 'rate-limited'`
  - `404 → 'not-found'`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code. `Deps` định nghĩa ở `src/main/deps.ts`: `{ run, fetch, fs, now, isPidAlive, statfs, spawnBridge, connectWs, platform, env }`, kèm `createDeps('real' | 'fake', fixtures?)`.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): version compare and latest-version sources`

### Task 5: Registry — thành phần lõi và tích hợp

**Files:**
- Create: `src/main/registry/core.ts`, `src/main/registry/integrations.ts`, `src/main/registry/registry.ts`
- Modify: `electron.vite.config.ts` (alias `@squarel/integration-schema` → `../integrations/schema/integration.schema.ts`)
- Test: `test/registry.test.ts`, `test/fixtures/integrations/*`

**Interfaces:**
- Consumes: `IntegrationManifest`, `Catalog`, `substitute` (plan A, Task 6); `Deps`; `compareVersions`, `satisfiesMin`, `latestGitTag`.
- Produces:

```ts
export interface CoreComponent { id: 'launcher' | 'squarel' | 'claude-code' | 'node' | 'pnpm' | 'git' | 'vs-build-tools' | 'local-sd'; name: string; description: string; icon: string; required: boolean; detect(d: Deps, ctx: Ctx): Promise<Detected>; latest?(d: Deps, ctx: Ctx): Promise<Latest>; install?: InstallSpec }
export interface Detected { installed: boolean; version?: string; path?: string; note?: string }
export interface Ctx { squarelDir?: string; launcherVersion: string; isDev: boolean; env: EnvDoc }
export interface InstallSpec { winget?: string; terminal?: { command: string; url: string }; sizeHint?: string }
export type CatalogEntry = z.infer<typeof Catalog>['comingSoon'][number] // từ plan A, Task 6
export interface LoadedIntegration { manifest: IntegrationManifestT; dir: string; source: 'squarel' | 'user'; incompatible?: string }
export interface Registry { core: CoreComponent[]; integrations: LoadedIntegration[]; comingSoon: CatalogEntry[]; problems: { path: string; error: string }[] }
export async function loadRegistry(opts: { squarelDir?: string; userIntegrationsDir: string; platform: NodeJS.Platform }, d: Deps): Promise<Registry>
export async function detectIntegration(i: LoadedIntegration, envDoc: EnvDoc, d: Deps): Promise<Detected> // env → candidates (expand %VAR%) → version qua run
export async function viewComponents(reg: Registry, state: LauncherState, envDoc: EnvDoc, d: Deps): Promise<ComponentView[]>
```

- **Cách phát hiện thành phần lõi:**

| Thành phần | Phát hiện | Cài | Ghi chú |
|---|---|---|---|
| node | `node --version` | winget `OpenJS.NodeJS.LTS` | cần ≥ 22.18 |
| pnpm | `pnpm -v` | winget `pnpm.pnpm` | |
| git | `git --version` | winget `Git.Git` | |
| claude-code | `claude --version` | `kind:'terminal'`: mở PowerShell chạy bộ cài chính thức `irm https://claude.ai/install.ps1 \| iex` | người dùng tự xem và đăng nhập |
| vs-build-tools | vswhere | | chỉ hiển thị |
| squarel | `package.json` có `name:'squarel-art'`; lấy `version`, nhánh, trạng thái dirty qua git | | |
| local-sd | `GET {LOCAL_SD_URL}/health` | | chỉ phát hiện |
| launcher | `app.getVersion()` truyền qua ctx | | |

- **Tích hợp:** đọc `squarelDir/integrations/*/integration.json` và `userIntegrationsDir/*/integration.json`. Trùng `id` thì bản của người dùng thắng và ghi một mục vào `problems`. `schema` khác `1` → `incompatible: 'Cần launcher mới hơn'`. File hỏng → ghi vào `problems`, không ném lỗi.
- [ ] **Step 1:** Viết test:
  - `loads the real Squarel aseprite manifest and catalog`
  - `user integration overrides a Squarel one with the same id and is reported`
  - `schema 2 manifest is listed as incompatible, not loaded into the rail`
  - `broken JSON goes to problems`
  - `detectIntegration prefers ASEPRITE_PATH from .env, then candidates with %ProgramFiles(x86)% expanded, parses "Aseprite 1.3.18.6-dev"`
  - `node 22.17 is installed but level=error with label "Cần Node ≥ 22.18"`
  - `viewComponents marks latest > installed as warn "Có bản mới", latest offline as idle "Không kiểm tra được"`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): component registry from core list and integration manifests`

### Task 6: Health check

**Files:**
- Create: `src/main/checks/runner.ts`, `src/main/checks/builtin.ts`
- Test: `test/checks.test.ts`

**Interfaces:**
- Consumes: `Registry`, `Deps`, `EnvDoc`, `BridgeState` (khai báo ở Task 7; trong task này dùng kiểu giả có cùng hình dạng).
- Produces: `export interface CheckCtx { squarelDir?: string; dataDir: string; env: EnvDoc; bridge: BridgeState }`, `export async function runChecks(reg: Registry, ctx: CheckCtx, d: Deps): Promise<CheckResult[]>` và `smokeTestMcp(squarelDir: string, d: Deps): Promise<{ ok: boolean; tools: number; ms: number; error?: string }>`.
- **Các kiểm tra và id** (theo spec §10):

| Nhóm | id | Cách làm |
|---|---|---|
| claude | `claude-installed` | |
| claude | `claude-sees-squarel` | `claude mcp list` có dòng khớp `/^squarel:.*(✓\|Connected)/m` |
| claude | `mcp-starts` | SDK `Client` + `StdioClientTransport('node', [squarelDir+'/src/mcp/index.ts'])`, env `SQUAREL_NO_BRIDGE=1`, gọi `listTools`, timeout 15 giây |
| bridge | `bridge-listening` | |
| integration:\<id\> | builtin `detect`, `bridge-client`, `extension-version` | check có `manual:true` không chạy tự động |
| ai | `cloudflare-token` | `GET https://api.cloudflare.com/client/v4/user/tokens/verify`; nếu trả 401/404 thì thử `/accounts/{CLOUDFLARE_ACCOUNT_ID}/tokens/verify`; `result.status === 'active'` → pass |
| ai | `retrodiffusion-key` | có key → pass, không có → warn "tuỳ chọn" |
| machine | `data-dir-writable` | ghi rồi xoá `.squarel-write-test` |
| machine | `disk-space` | `statfs`; dưới 2GB → warn |

- [ ] **Step 1:** Viết test (fetch và run giả):
  - `token verify active → pass, inactive → fail with fix opening Settings`
  - `retro diffusion without key is warn not fail and never calls the network`
  - `manual checks are skipped by runChecks`
  - `mcp smoke test against the real Squarel server lists ≥ 40 tools` (chạy thật `node ../src/mcp/index.ts` với `DATA_DIR` tạm)
  - `a throwing check becomes a fail result, others still run`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): health checks`

### Task 7: Giám sát bridge (giữ cổng, gắn vào, chiếm cổng)

**Files:**
- Create: `src/main/bridge/client.ts`, `src/main/bridge/supervisor.ts`
- Test: `test/bridge-supervisor.test.ts`

**Interfaces:**
- Consumes: thông điệp `status` (plan A, Task 1); `Deps.spawnBridge`, `Deps.connectWs`.
- Produces:

```ts
export type BridgeMode = 'own' | 'attached' | 'foreign' | 'down'
export interface BridgeState { mode: BridgeMode; port: number; clients: BridgeClientInfo[]; since: string; message?: string }
export function createBridgeSupervisor(opts: { port: number; token?: string; squarelDir: string; pollMs?: number /*5000*/; foreignRetryMs?: number /*30000*/ }, d: Deps): { start(): Promise<void>; stop(): Promise<void>; state(): BridgeState; onChange(cb: (s: BridgeState) => void): () => void; sendTool(name: string, input: unknown): Promise<string> }
```

- **Thuật toán:**
  1. Thử kết nối WS dưới tên `launcher` và gửi `status`, chờ tối đa 1,5 giây.
  2. Có trả lời → `attached`; hỏi lại `status` mỗi `pollMs`.
  3. Không kết nối được (ECONNREFUSED) → chạy `node src/bridge/index.ts` với `cwd = squarelDir` → `own`. Nếu tiến trình con thoát với lỗi "already in use" thì quay về bước 1.
  4. Cổng mở nhưng không phải bridge Squarel (handshake lỗi, hoặc không có `status` trong 1,5 giây) → `foreign` với message "Cổng 4321 đang bị chương trình khác dùng", thử lại sau mỗi `foreignRetryMs`.
  5. Đang `attached` mà socket đóng → thử ngay bước 3 (chiếm cổng).
  6. `stop()` chỉ kill tiến trình con của chính launcher.
- [ ] **Step 1:** Viết test:
  - `attaches to a running Squarel bridge and reports its clients` (`BridgeServer` thật từ `../src/bridge/server.ts`, port 0)
  - `spawns its own bridge when nothing listens` (spawn giả ghi nhận argv và cwd)
  - `takes over when the attached bridge goes away` (dừng `BridgeServer` → spawn được gọi trong ≤ 1 giây)
  - `foreign program on the port → mode foreign, retries at foreignRetryMs, never spawns in a tight loop` (Review Focus 3; một `net` server thô; đồng hồ giả; trong 60 giây giả: ≤ 3 lần thử)
  - `stop() kills only an own child`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): bridge supervisor`

### Task 8: Panel Kết nối (presence)

**Files:**
- Create: `src/main/presence.ts`
- Test: `test/presence.test.ts`

**Interfaces:**
- Consumes: file `DATA_DIR/run/mcp-*.json` (plan A, Task 2), `BridgeState`, `Registry`, `EnvDoc`.
- Produces: `export async function buildPresence(input: { dataDir: string; bridge: BridgeState; reg: Registry; env: EnvDoc }, d: Deps): Promise<PresenceGroup[]>`
- **Nhóm Claude Code:** mỗi file còn sống thành một dòng.
  - title: `Phiên · <tên thư mục cuối của cwd>`;
  - busy nếu `lastToolAt` trong 15 giây, subtitle `Đang gọi <lastTool>`;
  - ngược lại online, subtitle `Rảnh`.
- **Nhóm Công cụ:** client của bridge khớp `manifest.bridge.client` → online, subtitle `<slug> · <app>`.
- **Nhóm Dịch vụ:**

| Dịch vụ | Trạng thái |
|---|---|
| Bridge | own/attached → online `ws://127.0.0.1:<port>`; foreign → away; down → offline |
| Cloudflare AI | có token → online, subtitle `Còn <10000 − neuron đã dùng hôm nay> neuron hôm nay` (đọc `DATA_DIR/usage.jsonl`, chỉ tính các dòng `provider:'cloudflare'` theo ngày UTC hiện tại); không có token → offline |
| Retro Diffusion | có key → online "Đã có key"; không có → offline "Chưa có key · tuỳ chọn" |

- [ ] **Step 1:** Viết test (Review Focus 5):
  - `drops files whose pid is dead even if fresh`
  - `drops files older than 30s even if the pid is alive (pid reuse)`
  - `busy within 15s of lastToolAt`
  - `maps bridge clients to integrations by bridge.client; unknown clients are not shown`
  - `neurons left sums today's cloudflare usage only`
  - `malformed run file is ignored`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): connections panel model`

### Task 9: Kết nối Claude (đăng ký MCP, chép skill)

**Files:**
- Create: `src/main/claude.ts`
- Test: `test/claude.test.ts`

**Interfaces:**
- Produces:

```ts
export async function registerMcp(squarelDir: string, d: Deps): Promise<{ ok: boolean; output: string }> // `claude mcp remove squarel --scope user` (bỏ qua lỗi) rồi `claude mcp add squarel --scope user -- node <abs>/src/mcp/index.ts`
export async function copySkills(squarelDir: string, homeDir: string, d: Deps): Promise<string[]>   // chép .claude/skills/pixel-* vào ~/.claude/skills/, chỉ thay đúng các thư mục pixel-*; trả về tên đã chép
```

- [ ] **Step 1:** Viết test:
  - `registerMcp passes the absolute path as a single argv item` (đường dẫn có dấu cách)
  - `copySkills replaces only pixel-* folders and leaves other skills untouched`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): register Squarel with Claude Code`

### Task 10: Cập nhật

**Files:**
- Create: `src/main/updates/launcher.ts`, `src/main/updates/squarel.ts`, `src/main/updates/tools.ts`
- Test: `test/updates.test.ts`

**Interfaces:**
- Produces:

```ts
export type SquarelPlan = { kind: 'tag'; from?: string; to: string } | { kind: 'branch'; branch: string } | { kind: 'blocked'; reason: 'dirty' | 'not-a-repo'; message: string } | { kind: 'none' }
export async function planSquarelUpdate(squarelDir: string, launcherVersion: string, d: Deps): Promise<SquarelPlan>
export async function applySquarelUpdate(plan: SquarelPlan, ctx: { squarelDir: string; reg: Registry; onEvent: (e: TaskEvent) => void }, d: Deps): Promise<void> // fetch --tags → checkout v{to} → pnpm install → extension.install của các tích hợp đã chọn
export interface UpdateCtx { squarelDir: string; toolsDir: string; onEvent: (e: TaskEvent) => void }
export async function applyToolUpdate(i: LoadedIntegration, version: string, ctx: UpdateCtx, d: Deps): Promise<{ blocked?: string }> // requiresClosed đang chạy → blocked "Đóng aseprite.exe trước"
export function createLauncherUpdater(adapter: { checkForUpdates(): Promise<{ version?: string } | null>; quitAndInstall(): void }): { check(): Promise<Latest>; install(): void }
```

- **Quy tắc** (spec §6, §11):
  - Đích của Squarel là `v<launcherVersion>`, không nhảy lên tag mới hơn.
  - Repo đang ở một nhánh → `branch`, cập nhật bằng `git pull --ff-only`.
  - Có thay đổi chưa commit → `blocked: dirty`.
  - Launcher chạy từ source không đổi tag của repo: `launcherVersion` lấy từ `launcher/package.json` và `ctx.isDev` → `none`.
  - Adapter thật bọc `electron-updater` (`autoDownload: true`, provider github `t1tc01-personal/squarel-art-2`).
- [ ] **Step 1:** Viết test (Review Focus 4):
  - `tag checkout targets the launcher's own version`
  - `branch checkout plans a fast-forward pull`
  - `dirty tree blocks with a readable message`
  - `dev launcher never moves the repo`
  - `tool update blocked while aseprite.exe runs`
  - `offline check returns Latest{ok:false} and does not throw`
  - `apply runs fetch, checkout, install, extension reinstall in order and streams TaskEvents`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): updates for launcher, Squarel and tools`

### Task 11: IPC, preload, lịch chạy

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/ipc-handlers.ts`, `src/main/scheduler.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`
- Create: `src/renderer/api.ts`
- Test: `test/ipc.test.ts`, `test/scheduler.test.ts`

**Interfaces:**
- Produces: các kênh IPC (request kèm schema zod cho input và output):

| Kênh | Input | Output |
|---|---|---|
| `state:get` | | `LauncherState` |
| `state:set` | `Partial<LauncherState>` | |
| `components:list` | | `ComponentView[]` |
| `checks:run` | | `CheckResult[]` |
| `checks:last` | | |
| `presence:get` | | `PresenceGroup[]` |
| `env:get` | | các khoá đã che bằng `maskSecret` |
| `env:set` | `{key, value}`, key thuộc danh sách cho phép `DATA_DIR IMAGE_PROVIDER CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN RETRO_DIFFUSION_API_KEY IMAGE_DAILY_BUDGET_USD LOCAL_SD_URL BRIDGE_PORT ASEPRITE_PATH` | |
| `action:run` | `ActionRef` | `taskId` |
| `updates:check` | | |
| `updates:apply` | | |
| `dialog:pickFolder` | | |
| `dialog:pickFile` | `{filters}` | |
| `shell:reveal` | `{path}` (chỉ đường dẫn thuộc các thư mục đã biết) | |
| `projects:recent` | | 3 project mới nhất trong `DATA_DIR/projects` (tên, kích thước, version, thời gian) |

- Sự kiện đẩy về renderer: `presence:changed`, `task:event`, `components:changed`, `checks:changed`.
- `window.squarel` trong preload chỉ có các hàm của danh sách trên, không lộ `ipcRenderer`.
- Lịch chạy: `createScheduler({ checksMs: 600_000, updatesMs: 21_600_000 }, jobs, clock)`. Mỗi job chỉ có một lần chạy tại một thời điểm; lần đến hạn trong lúc job đang chạy thì bỏ qua.
- [ ] **Step 1:** Viết test:
  - `rejects unknown channels and invalid payloads`
  - `env:set refuses keys outside the allow-list`
  - `env:get never returns raw secrets`
  - `shell:reveal refuses paths outside known roots`
  - `scheduler runs checks every 10 min and updates every 6 h without overlap`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): typed IPC and scheduler`

### Task 12: Khung giao diện và component

**Files:**
- Create: `src/renderer/components/*`, `src/renderer/layout/{TitleBar,AppRail,ConnectionsPanel}.tsx`, `src/renderer/nav.ts`, `src/renderer/assets/icons/*.png`
- Test: `test/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `window.squarel` (Task 11), `ComponentView`, `PresenceGroup`.
- Produces: các component React trùng tên component Figma, gồm `Button{type:'primary'|'secondary'|'ghost'|'danger', size:'md'|'lg', icon?}`, `StatusPill{level,label}`, `Field{state:'default'|'valid'|'error'}`, `RowComponent`, `RowCheck`, `SubTabs{tabs, active, badges}`, `LaunchButton{label, actions}`, `PresenceRow`. Thêm `useNav(): { page: Page; go(p: Page): void }`, với `Page = 'home' | 'library' | { integration: string; tab: 'overview' | 'updates' | 'health' | 'settings' } | { system: 'components' | 'health' | 'logs' } | 'settings'`.
- `AppRail` dựng từ `components:list`, đúng thứ tự: home, library, ─, tích hợp đã chọn (icon là `icon.png` của manifest), ➕, (khoảng trống), system, settings.
- Panel Kết nối thu gọn được; trạng thái thu gọn lưu trong `localStorage`.
- Xuất 12 icon pixel từ Figma (component `Icon/*`) thành PNG 16px, hoặc vẽ lại bằng các bitmap 8×8 có trong Figma.
- [ ] **Step 1:** Test e2e dùng `createDeps('fake')` qua biến môi trường `SQUAREL_LAUNCHER_FAKE=fixtures/basic`:
  - `rail shows home, library, Aseprite (from manifest), add, system, settings`
  - `connections panel shows 2 Claude sessions, Aseprite, Bridge, Cloudflare, Retro Diffusion`
  - `collapse button hides the panel and survives reload`
  - `custom title bar buttons minimize/close` (đóng → ẩn khi `closeToTray`)
- [ ] **Step 2:** Chạy `pnpm --dir launcher e2e` → FAIL.
- [ ] **Step 3:** Code. Đối chiếu bằng mắt với ảnh chụp Figma đã lưu trong `docs/launcher/screens/`.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): shell layout and components`

### Task 13: Các trang ứng dụng

**Files:**
- Create: `src/renderer/pages/{Home,Library,Integration,System,Settings}.tsx`
- Test: `test/e2e/pages.spec.ts`

**Nội dung:** theo Figma hàng 2 và trang "Lưu trữ v1" (cho tab Health check, Nhật ký, Cấu hình).
- **Trang tích hợp:**
  - dựng hoàn toàn từ manifest: tên, `accent`, các tab;
  - `LaunchButton` gồm hành động `default` và menu ▾ chứa các `launch` còn lại; `{recentProject}` lấy từ `projects:recent`;
  - 3 thẻ: cập nhật, extension, hoạt động hôm nay. Số lần đồng bộ hôm nay đếm các version có `source: 'editor' | 'claude'` trong hôm nay. Nếu đọc lịch sử tốn kém, thay bằng "Đang kết nối/Không kết nối" và ghi lại quyết định này.
- **Nhật ký:**
  - đọc 500 dòng cuối của `DATA_DIR/logs/*.log` cùng log của launcher (`%APPDATA%\SquarelArt Launcher\logs`), lọc theo nguồn và mức;
  - nút "Sao chép cho Claude" chép các dòng đang hiển thị, đã che khoá.
- **Cấu hình:** ghi qua `env:set`; đổi `BRIDGE_PORT` thì khởi động lại supervisor. Cuối trang có mục **"Giới thiệu"**: phiên bản launcher và Squarel, link mở `LICENSE.md` (bản đi kèm trong `extraResources`), link tới repo (spec §15).
- [ ] **Step 1:** Test e2e (fixture giả):
  - `integration page is generated from a fixture manifest named "Demo Tool" without code changes`
  - `launch menu lists all non-default actions and runs the chosen one`
  - `system → components shows update buttons only where latest > installed`
  - `health tab groups results and the fix button opens Settings`
  - `settings shows masked token and saving writes .env`
  - `about section shows both versions and opens the bundled LICENSE.md`
  - `logs view filters by source and copy never includes a raw token`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): home, library, integration, system and settings pages`

### Task 14: Wizard thiết lập lần đầu

**Files:**
- Create: `src/main/setup.ts`, `src/renderer/setup/*`
- Test: `test/setup.test.ts`, `test/e2e/wizard.spec.ts`

**Interfaces:**
- Produces:

```ts
export function nextSetupStep(state: LauncherState, facts: { squarelOk: boolean; requiredMissing: string[] }): LauncherState['setupStep']
export async function hasWinget(d: Deps): Promise<boolean>
export function installPlan(views: ComponentView[], winget: boolean): ActionRef[] // không có winget → kind 'terminal' kèm link tải chính thức, không tự tải file chạy
```

- Wizard hiện khi `setupStep !== 'done'` hoặc thiếu thành phần bắt buộc. Đóng giữa chừng thì lưu lại bước đang làm.
- **Bước 1:**
  - "Cài mới": clone `https://github.com/t1tc01-personal/squarel-art-2.git` ở tag `v<launcherVersion>` vào `defaultInstall`;
  - "Dùng repo đã clone": kiểm tra thư mục có `package.json` tên `squarel-art`.
- **Bước 2:** hàng đợi cài đặt, mỗi mục cần người dùng bấm. `pnpm install`. Claude Code dùng `kind:'terminal'`.
- **Bước 3:**
  - form `.env` (ảnh AI; "GPU của máy" chỉ bật khi `local-sd` được phát hiện);
  - kiểm tra token Cloudflare;
  - danh sách tích hợp, mỗi tích hợp chọn một cách cài trong `install` hoặc "Bỏ qua". Aseprite build chạy nền với `--json-progress`, wizard đi tiếp được.
- **Bước 4:** `registerMcp`, `copySkills`, `smokeTestMcp`, check `claude-sees-squarel`, cài extension cho các tích hợp đã chọn.
- [ ] **Step 1:** Viết test:
  - `nextSetupStep resumes at the saved step`
  - `missing required component sends a done setup back to step 2`
  - `no winget → install plan uses terminal actions with official links, never a silent download`
  - e2e `fresh mode walks steps 1→4 with fake deps and ends on Home`
  - e2e `clone mode rejects a folder that is not squarel-art`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): first-run setup wizard`

### Task 15: Khay hệ thống và khởi động cùng Windows

**Files:**
- Create: `src/main/tray.ts`
- Modify: `src/main/index.ts`
- Test: `test/e2e/tray.spec.ts`

- Khi đóng cửa sổ:
  - `closeToTray` bật → ẩn cửa sổ, bridge vẫn chạy;
  - `closeToTray` tắt → `supervisor.stop()` rồi thoát.
- Menu khay: "Mở launcher", "Mở <tên tích hợp>…" (mỗi tích hợp đã chọn một mục, chạy hành động `default`), "Bridge: <mode>", "Thoát".
- Khởi động cùng Windows: `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`; với `--hidden` thì không hiện cửa sổ.
- Chỉ cho chạy một bản launcher (`requestSingleInstanceLock`); mở lần hai thì đưa cửa sổ đang chạy lên trước.
- [ ] **Step 1:** Test e2e:
  - `closing hides the window and the bridge keeps running`
  - `second instance focuses the first`
  - `Thoát stops an own bridge but leaves an attached one`
- [ ] **Step 2:** Chạy test → FAIL.
- [ ] **Step 3:** Code.
- [ ] **Step 4:** Chạy test → PASS.
- [ ] **Step 5:** Commit `feat(launcher): tray, single instance, autostart`

### Task 16: Đóng gói, phát hành, tài liệu

**Files:**
- Create: `launcher/electron-builder.yml`, `.github/workflows/release.yml`, `launcher/test/sandbox/squarel.wsb`, `docs/launcher.md`, `docs/release.md`, `docs/launcher/screens/*.png`
- Modify: `package.json` + `launcher/package.json` (`version: "0.2.0"`), `README.md` (mục Launcher), `docs/setup.md` (thêm đường tắt "Cách nhanh: dùng launcher")

- **electron-builder:**
  - `appId: art.squarel.launcher`, `productName: Squarel Art Launcher`;
  - `win.target: nsis`, `nsis.oneClick: false`, `perMachine: false`;
  - `extraResources: [../LICENSE.md]`;
  - `publish: { provider: github, owner: t1tc01-personal, repo: squarel-art-2 }`.
- **CI** (khi push tag `v*`, chạy trên `windows-latest`):
  1. `pnpm install` → `pnpm check`
  2. `pnpm --dir launcher install` → `pnpm --dir launcher check`
  3. `pnpm --dir launcher build` → `electron-builder --publish always` (token mặc định `GITHUB_TOKEN`, `permissions: contents: write`)
- **`docs/release.md`:**
  - build exe trên máy (`pnpm --dir launcher build`, file nằm ở `launcher/dist/`);
  - danh sách việc khi phát hành: tăng version ở hai `package.json`, chạy `pnpm check`, tạo và đẩy tag `vX.Y.Z`, kiểm tra Release có bộ cài và `latest.yml`;
  - cảnh báo SmartScreen ("More info → Run anyway").
- **`squarel.wsb`:** map thư mục `launcher/dist` vào Sandbox (chỉ đọc). Hướng dẫn trong `docs/release.md`: Sandbox không có winget, nên đây là bài thử nhánh "không có winget".
- **Ảnh chụp:** xuất các frame Figma trên trang "Launcher" thành PNG vào `docs/launcher/screens/`.
- [ ] **Step 1:** Chạy `pnpm --dir launcher build` → có file `launcher/dist/Squarel-Art-Launcher-Setup-0.2.0.exe`.
- [ ] **Step 2:** Cài file exe trên máy thật, đi hết wizard ở chế độ "Dùng repo đã clone" trỏ vào repo này → tới Trang chủ, panel Kết nối hiện bridge và Aseprite. Ghi kết quả vào `docs/release.md` (mục "Đã thử").
- [ ] **Step 3:** Chạy `pnpm check` và `pnpm --dir launcher check` → PASS. `test/repo-hygiene.test.ts` vẫn xanh (không commit file trong `dist/`).
- [ ] **Step 4:** Commit `build(launcher): packaging, release workflow and docs`.
- [ ] **Step 5:** Tag `v0.2.0` và push tag **chỉ khi chủ dự án đồng ý**, vì đây là phát hành công khai.
