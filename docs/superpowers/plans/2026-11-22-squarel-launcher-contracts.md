# Squarel: hợp đồng cho Launcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bổ sung vào Squarel những "hợp đồng" mà launcher dựa vào:
- trạng thái bridge;
- file phiên MCP;
- mở project qua bridge của tiến trình khác;
- mở Aseprite không đồng bộ;
- tiến độ build dạng JSON;
- file khai báo tích hợp, schema của nó và danh mục "sắp có".

**Architecture:** Chỉ thêm, không đổi nghĩa giao thức và lệnh hiện có. Schema `integration.json` là một file TS dùng zod, đặt tại `integrations/schema/`. Squarel dùng nó để kiểm tra file khai báo của mình; launcher (plan B) bundle cùng file đó.

**Tech Stack:** Node ≥ 22.18 chạy `.ts` trực tiếp, TypeScript, zod 4, ws, vitest, biome, Lua (extension Aseprite, test bằng fengari).

**Spec:** `docs/superpowers/specs/2026-11-22-launcher-design.md` (§7, §8, §10)

## Global Constraints

- Không phá client cũ: chỉ thêm loại thông điệp và trường mới. Thông điệp hiện có giữ nguyên hình dạng.
- Bridge vẫn chỉ nghe `127.0.0.1`, giữ quy tắc Origin `isLocalClientOrigin`.
- File phiên MCP: `DATA_DIR/run/mcp-<pid>.json`, ghi lại mỗi **10 giây** và sau mỗi lần gọi tool, xoá khi thoát. Launcher coi là cũ sau **30 giây**.
- Schema tích hợp: `schema: 1`.
- `run` luôn là mảng; biến thay thế chỉ gồm `{toolsDir}`, `{exe}`, `{exeDir}`, `{version}`, `{recentProject}`.
- Biến môi trường tắt đồng bộ: `SQUAREL_NO_SYNC=1`.
- Màu nhấn của Aseprite: `#FF77A8`. Icon 16×16 PNG.
- Repo công khai: `test/repo-hygiene.test.ts` phải tiếp tục qua.
- Làm trên nhánh `feat/launcher-contracts`, mỗi task một commit. `pnpm check` xanh sau mỗi task.

## Review Focus

1. **Hai MCP server cùng lúc** (hai phiên Claude Code): mỗi phiên một file theo pid, không ghi đè nhau. Một phiên thoát chỉ xoá file của nó. → test ở Task 2.
2. **MCP bị kill** (không chạy được dọn dẹp): file còn lại phải có `updatedAt` để launcher tự bỏ. Squarel không cố dọn file của pid khác. → test ở Task 2.
3. **Cổng 4321 do chương trình không phải Squarel giữ**: `openViaBridge` phải trả lỗi rõ ràng sau timeout, không treo tool `open_in_editor`. → test ở Task 3.
4. **Client không gửi `hello`** (công cụ lạ kết nối vào): `status` vẫn liệt kê với `name: "unknown"` và không lỗi. → test ở Task 1.
5. **Output build có dòng không phải tiến độ, hoặc tiến độ nhảy lùi** (ninja in cảnh báo): bộ đọc tiến độ bỏ qua dòng lạ, phần trăm không giảm. → test ở Task 5.

---

### Task 1: Bridge trả về trạng thái (`status`)

**Files:**
- Modify: `src/bridge/protocol.ts`
- Modify: `src/bridge/server.ts` (interface `Client`, `onConnection`, `handle`)
- Test: `test/bridge.test.ts`

**Interfaces:**
- Produces:
  - `ClientMessage` thêm `{ type: 'status' }`.
  - `ServerMessage` thêm `{ type: 'status'; version: string; clients: BridgeClientInfo[] }`.
  - Export `interface BridgeClientInfo { name: string; ext?: string; app?: string; slug?: string; version?: string; connectedAt: string; lastSeen: string }` từ `protocol.ts`.
  - `hello` thêm trường tuỳ chọn `app?: string` (phiên bản công cụ, ví dụ `"1.3.18.6"`). Trường `aseprite` cũ vẫn nhận và được ghi vào `app`.

- [ ] **Step 1: Write the failing tests** trong `test/bridge.test.ts`:

```ts
it('status lists connected clients with what they have open', async () => {
  const c = await connect() // hello client=aseprite
  c.send({ type: 'open', slug: 'bridge' }); await c.next('doc')
  const probe = new TestClient(bridge.port); await probe.opened()
  probe.send({ type: 'status' })
  const s = await probe.next('status')
  expect(s.version).toMatch(/^\d+\.\d+\.\d+$/)
  const ase = s.clients.find((x) => x.name === 'aseprite')!
  expect(ase.slug).toBe('bridge')
  expect(Date.parse(ase.lastSeen)).toBeGreaterThan(0)
  expect(s.clients.some((x) => x.name === 'unknown')).toBe(true) // the probe never said hello
})
it('ping refreshes lastSeen', async () => { /* status → ping → status: lastSeen tăng hoặc bằng */ })
```

- [ ] **Step 2: Run — expect FAIL** `pnpm exec vitest run test/bridge.test.ts` → lỗi kiểu dữ liệu / timeout chờ `status`.
- [ ] **Step 3: Implement.** `Client` thêm `ext`, `app`, `connectedAt`, `lastSeen`. Mọi thông điệp nhận được đều cập nhật `lastSeen`. `hello` ghi `ext` và `app ?? aseprite`. `status` trả về danh sách lấy từ `this.clients`.
- [ ] **Step 4: Run — expect PASS**, sau đó chạy `pnpm check`.
- [ ] **Step 5: Commit** `feat(bridge): status message listing connected clients`

### Task 2: File phiên MCP (presence)

**Files:**
- Create: `src/mcp/presence.ts`
- Modify: `src/mcp/index.ts` (khởi động và dừng presence)
- Modify: `src/mcp/server.ts:60` (sau `runTool` gọi `presence.touch(tool.name)`)
- Test: `test/presence.test.ts`

**Interfaces:**
- Produces:

```ts
export interface McpPresence { pid: number; cwd: string; version: string; startedAt: string; updatedAt: string; lastTool?: string; lastToolAt?: string; bridge: 'own' | 'shared' | 'none' }
export function presenceFile(dataDir: string, pid?: number): string // DATA_DIR/run/mcp-<pid>.json
export function startPresence(opts: { dataDir: string; version: string; bridge: McpPresence['bridge']; intervalMs?: number; now?: () => Date }): { touch(tool: string): void; stop(): Promise<void> }
```

- `createMcpServer(ctx, opts?: { onToolCall?: (name: string) => void })`: thêm tham số tuỳ chọn.

- [ ] **Step 1: Failing tests** (`test/presence.test.ts`, dùng `tempDir()` và đồng hồ giả):
  - `writes run/mcp-<pid>.json at start with bridge mode and cwd`
  - `touch() records lastTool and rewrites immediately`
  - `heartbeat rewrites updatedAt every intervalMs` (`intervalMs: 20`, chờ 60ms, `updatedAt` tăng)
  - `stop() removes only its own file`: tạo sẵn `mcp-999999.json` của "pid khác", sau `stop()` file đó vẫn còn (Review Focus 1, 2)
  - `two instances with different pids keep separate files` (truyền pid qua `presenceFile(dir, pid)`; trong test, `startPresence` nhận thêm `pid?` để giả lập)
- [ ] **Step 2: Run — expect FAIL** (module không tồn tại).
- [ ] **Step 3: Implement.**
  - Ghi file bằng `writeAtomic` từ `src/store/fsutil.ts`.
  - Thêm `pid?: number` vào opts, mặc định `process.pid`.
  - Trong `index.ts`, `bridge` là `'own'` nếu bridge của MCP khởi động được, `'shared'` nếu cổng đã bận, `'none'` nếu có `SQUAREL_NO_BRIDGE`.
  - `shutdown` gọi `stop()` trước khi thoát.
- [ ] **Step 4: Run — expect PASS**. Mở rộng `test/mcp.test.ts` (phần chạy qua stdio): sau `initialize`, thư mục `run/` có đúng một file; đóng stdin rồi file biến mất.
- [ ] **Step 5: Commit** `feat(mcp): presence files for the launcher`

### Task 3: `open_in_editor` đi qua bridge của tiến trình khác

**Files:**
- Create: `src/bridge/remote.ts`
- Modify: `src/mcp/index.ts` (thay `ctx.editor` dự phòng)
- Test: `test/bridge.test.ts`

**Interfaces:**
- Produces: `export async function openViaBridge(opts: { port: number; token?: string; slug: string; timeoutMs?: number }): Promise<string>`
  - Gửi `hello{client:'squarel-mcp'}` rồi `tool{name:'open_in_editor', input:{project: slug}}`, trả về `text` của `tool_result`.
  - Lỗi: ném `Error` có thông điệp tiếng Anh, bắt đầu bằng `bridge on port <port> did not answer`. Mặc định `timeoutMs = 3000`.

- [ ] **Step 1: Failing tests:**
  - `openViaBridge asks the running bridge to open the project in the connected editor`: client aseprite đã kết nối, gọi `openViaBridge({port, slug:'bridge'})` → client nhận `open.request`, hàm trả về chuỗi chứa `live sync on`.
  - `openViaBridge fails fast when something else holds the port`: một `net.createServer()` thô nghe cổng ngẫu nhiên và không trả lời → reject trong ≤ `timeoutMs + 500` (Review Focus 3).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Trong `index.ts`, nhánh `!bridgeUp` dùng `ctx.editor = { open: (slug) => openViaBridge({ port, token, slug }) }`.
- [ ] **Step 4: Run — expect PASS** + `pnpm check`.
- [ ] **Step 5: Commit** `feat(mcp): open_in_editor through another process's bridge`

### Task 4: Mở Aseprite không đồng bộ (`SQUAREL_NO_SYNC`)

**Files:**
- Modify: `integrations/aseprite/squarel/plugin.lua` (hàm `setup`)
- Modify: `test/lua/plugin_harness.lua` (cho phép giả `os.getenv`)
- Test: `test/lua.test.ts`

- [ ] **Step 1: Failing test** `does not autoconnect when SQUAREL_NO_SYNC=1`: harness đặt `ENV_OVERRIDE = { SQUAREL_NO_SYNC = '1' }` → sau `init`, `#SOCKETS == 0`, và menu vẫn được tạo (Connect bấm tay được).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
  - Trong `setup`: `if os.getenv('SQUAREL_NO_SYNC') == '1' then trace('no-sync mode') else (autoconnect như cũ) end`.
  - Harness: bọc `os.getenv` để đọc `ENV_OVERRIDE` trước.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(aseprite): SQUAREL_NO_SYNC skips auto-connect`

### Task 5: Tiến độ build dạng JSON

**Files:**
- Modify: `scripts/lib/aseprite-build.ts` (thêm hàm thuần)
- Modify: `scripts/aseprite-build.ts` (cờ `--json-progress`)
- Test: `test/aseprite-build.test.ts`

**Interfaces:**
- Produces:
  - `export interface BuildProgress { step: number; total: 6; label: string; percent?: number; message?: string }`
  - `export function parseNinjaProgress(line: string): { done: number; total: number } | undefined`: nhận dạng `[1000/1575] …`.
  - `export function progressTracker(): (line: string) => number | undefined`: trả về phần trăm 0–100, **không bao giờ giảm**.
  - Với `--json-progress`, mỗi dòng stdout có dạng `@@progress {"step":5,"total":6,"label":"Build","percent":63}`. Log thường vẫn in như cũ. `parseBuildArgs` nhận thêm `jsonProgress: boolean`.

- [ ] **Step 1: Failing tests:**
  - `parseNinjaProgress reads ninja counters`: `[1000/1575] Building CXX …` → `{done:1000,total:1575}`; `-- Looking for strerror` → `undefined`.
  - `progressTracker never goes backwards and ignores noise`: các dòng `[10/100]`, `warning: …`, `[5/100]`, `[50/100]` → `10, undefined, 10, 50` (Review Focus 5).
  - `parseBuildArgs accepts --json-progress`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
  - Ở bước 5 (build), khi có cờ thì chạy `cmake --build` với `stdio: ['ignore','pipe','inherit']`, đọc từng dòng, chuyển tiếp ra stdout, và in thêm dòng `@@progress`.
  - Hàm `step()` in `@@progress` cho các bước 1–6.
- [ ] **Step 4: Run — expect PASS.** Kiểm tra tay: `pnpm aseprite:build -- --check --json-progress` in `@@progress {"step":1,…}`.
- [ ] **Step 5: Commit** `feat(build): machine-readable progress for the launcher`

### Task 6: Schema tích hợp, file khai báo Aseprite, danh mục "sắp có"

**Files:**
- Create: `integrations/schema/integration.schema.ts`
- Create: `integrations/aseprite/integration.json`
- Create: `integrations/aseprite/icon.png` (16×16)
- Create: `integrations/catalog.json`
- Create: `scripts/make-integration-icon.ts` (sinh `icon.png` từ bitmap 8×8, scale ×2, bằng `encodePng` của `src/core/png.ts`)
- Modify: `tsconfig.json` (`include` thêm `integrations/schema`), `biome.json` (`includes` thêm `integrations/schema/**`)
- Test: `test/integrations.test.ts`

**Interfaces:**
- Produces (launcher dùng nguyên văn):

```ts
export const SUBST_VARS = ['toolsDir', 'exe', 'exeDir', 'version', 'recentProject'] as const
export const IntegrationManifest: z.ZodType<IntegrationManifestT> // zod object, .strict()
export const Catalog: z.ZodType<{ schema: 1; comingSoon: { id: string; name: string; description: string; icon: string; accent: string }[] }>
export function substitute(arg: string, vars: Partial<Record<(typeof SUBST_VARS)[number], string>>): string // ném lỗi nếu gặp {biến} lạ hoặc thiếu giá trị
export type IntegrationManifestT = { schema: 1; id: string; name: string; description: string; icon: string; accent: string; platforms: ('win32'|'darwin'|'linux')[]; detect: {...}; latest?: {...}; install: InstallOption[]; update?: {...}; extension?: {...}; bridge?: { client: string }; launch: LaunchAction[]; checks: CheckSpec[] }
```

  Hình dạng từng trường lấy đúng ví dụ ở spec §7. `id` khớp `^[a-z][a-z0-9-]{1,31}$`. Mỗi `install`, `launch`, `checks` có `id` duy nhất. Một `launch` có đúng một trong `run | bridgeTool | reveal`. Đúng một `launch` có `default: true`. `checks[].builtin ∈ ['detect','bridge-client','extension-version']`, hoặc có `run`.

- [ ] **Step 1: Failing tests** (`test/integrations.test.ts`):
  - `every integrations/*/integration.json validates and its icon is a 16x16 PNG` (đọc PNG bằng `decodePng`).
  - `aseprite manifest matches the build/pack scripts that exist`: mọi `run[0..2]` dạng `pnpm <script>` trỏ tới script có trong `package.json`.
  - `rejects unknown keys, duplicate ids, two defaults, launch with both run and bridgeTool`.
  - `substitute fills known vars, rejects unknown {foo} and missing values`.
  - `catalog.json validates and contains libresprite, pixelorama, godot, export-folder` (đúng như Thư viện trong Figma).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
  - Viết schema.
  - Copy ví dụ ở spec §7 vào `integrations/aseprite/integration.json`.
  - Chạy `node scripts/make-integration-icon.ts` để tạo `icon.png`. Dùng bitmap logo pixel trong Figma (`..####..`, `.#....#.`, `#.#..#.#`, `#......#`, `#.####.#`, `#......#`, `.#....#.`, `..####..`), màu `#FF77A8`, nền trong suốt.
  - Viết `catalog.json`.
- [ ] **Step 4: Run — expect PASS** + `pnpm check`. `repo-hygiene` phải còn xanh.
- [ ] **Step 5: Commit** `feat(integrations): manifest schema, Aseprite manifest and catalog`

### Task 7: Tài liệu hợp đồng

**Files:**
- Create: `docs/integrations.md`: cách viết tích hợp (schema, ví dụ Aseprite, biến thay thế, check có sẵn, giao thức bridge `hello/open/cels/ping/status`, thư mục tích hợp của người dùng `%APPDATA%\SquarelArt Launcher\integrations\<id>\`)
- Modify: `docs/aseprite.md` (mục `SQUAREL_NO_SYNC`, `--json-progress`)
- Modify: `docs/architecture.md` (thông điệp `status`, file phiên MCP)

- [ ] **Step 1:** Viết tài liệu. Mỗi tên trường và tên thông điệp phải khớp code của Task 1–6 (tìm bằng `grep` trước khi viết).
- [ ] **Step 2:** `pnpm check` (test `docs` + `repo-hygiene`) → PASS.
- [ ] **Step 3: Commit** `docs: integration contract for the launcher`
