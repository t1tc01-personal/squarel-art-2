# Kiến trúc hệ thống — Squarel Art (bản cá nhân, cắm vào Claude Code)

> Đi kèm [kế hoạch cá nhân](plans/2026-11-22-personal-tool-plan.md). Ngày: 2026-11-22. Trạng thái: **thiết kế, chưa có code**.
> Tài liệu này chốt cụ thể các tiến trình, module, interface, cấu trúc dữ liệu và luồng xử lý, để lúc build không phải đoán.
> **Editor:** Aseprite + extension Lua, chọn ngày 2026-11-22 (xem [editor-options.md](editor-options.md)). Không còn editor web tự viết.
>
> **Ghi chú triển khai v0.1 (2026-11-22):** code đã có đủ các phần dưới đây (`pnpm check`: 73 test). Những điểm khác so với thiết kế ban đầu:
> - **`withHead` giữ khoá trong suốt chuỗi đọc → sửa → ghi.** Không còn cơ chế thử lại khi gặp `CONFLICT`, vì test với 2 tiến trình ghi cùng lúc cho thấy cơ chế đó không đủ.
> - **Bridge luôn tính patch rồi rebase lên head,** kể cả khi head chưa đổi, để giữ `meta` (title, maxColors) của bản trên máy.
> - **Prompt cho model đa năng yêu cầu nền magenta** chứ không phải nền trắng. Màu này dùng làm phông để xoá nền.
> - **Despeckle chỉ xoá chấm lạc giữa vùng trong suốt,** giữ lại pixel đơn lẻ bên trong sprite (mắt, điểm sáng).
> - **Tổng cộng 41 tool.** Có thêm `frame_*`, `palette_set_color`, `proposal_list`, `layer_merge_down`.
> - **Extension Lua tự mang theo `json.lua`,** vì không phải bản Aseprite nào cũng có sẵn `json`. Extension dùng `image.bytes` khi có, nếu không thì quay về `getPixel`/`drawPixel`.
> - **Extension được test trên fengari** (máy ảo Lua chạy trong Node) với API Aseprite giả lập. Chưa test trên Aseprite thật: dùng `pnpm aseprite:test`.

---

## 1. Toàn cảnh

### 1.1 Các tiến trình khi chạy

| Tiến trình | Ai khởi động | Vai trò | Giao tiếp |
|---|---|---|---|
| **Claude Code** | Bạn mở | Chatbot: hiểu yêu cầu, gọi tool, xem ảnh preview | MCP qua stdio tới `squarel-mcp` |
| **squarel-mcp** | Claude Code tự chạy khi mở session (khai báo trong `.mcp.json`) | Cung cấp ~30 tool pixel art | stdin/stdout (JSON-RPC). Log chỉ ghi ra **stderr** và file |
| **squarel-bridge** | Chạy kèm trong `squarel-mcp` nếu cổng 4321 còn trống; hoặc `pnpm bridge` khi muốn vẽ mà không mở Claude Code | Đồng bộ với Aseprite, theo dõi file, gọi Aseprite CLI | WebSocket `ws://127.0.0.1:4321/bridge` |
| **Aseprite** + extension `Squarel` | Bạn mở | Vẽ tay. Extension Lua đồng bộ hai chiều | WebSocket tới bridge. Aseprite CLI (`-b --script`) cho chế độ trao đổi qua file |
| **local-sd** (tuỳ chọn) | `pnpm local-sd` (uvicorn) | Sinh ảnh SD1.5 trên GTX 1650 | HTTP `127.0.0.1:7861` |
| Dịch vụ ngoài | — | Cloudflare Workers AI · Retro Diffusion | HTTPS |

Hệ thống **không có database và không có daemon chạy nền**. Trạng thái chung duy nhất là thư mục `DATA_DIR` trên đĩa. Mọi tiến trình Node (`squarel-mcp`, `pnpm bridge`, CLI) đều đọc/ghi thư mục này qua cùng một thư viện `src/store`. Aseprite không ghi thẳng vào `DATA_DIR`: mọi thay đổi đều đi qua bridge.

```mermaid
flowchart LR
  U([Bạn]) -->|chat| CC[Claude Code]
  U -->|vẽ tay| ASE[Aseprite + extension Squarel]
  CC <-->|MCP stdio| MCP[squarel-mcp]
  ASE <-->|WebSocket| BR[squarel-bridge]
  MCP -. chạy kèm .-> BR
  CLI[squarel CLI] --> TOOLS
  MCP --> TOOLS[[src/tools - lớp tool dùng chung]]
  BR --> TOOLS
  TOOLS --> STORE[src/store]
  TOOLS --> PROV[src/providers]
  TOOLS --> CORE[src/core]
  STORE --> DATA[(DATA_DIR)]
  BR -. theo dõi file .-> DATA
  PROV -->|HTTPS| CF[Cloudflare Workers AI]
  PROV -->|HTTPS| RD[Retro Diffusion]
  PROV -->|HTTP local| SD[local-sd Python]
```

### 1.2 Nguyên tắc thiết kế
1. **Tool chỉ viết một lần** trong `src/tools`. MCP, CLI và bridge (cho Aseprite) đều chỉ là lớp vỏ mỏng gọi vào đó.
2. **`src/core` thuần tính toán:** không đọc file, không gọi mạng. Nhờ vậy chạy được cả trong trình duyệt lẫn Node, và test dễ.
3. **Lịch sử chỉ thêm, không sửa:** mỗi thay đổi tạo một version mới, kể cả undo. Không bao giờ ghi đè.
4. **AI không ghi đè tác phẩm:** kết quả AI là đề xuất (proposal). Khi chấp nhận thì đặt vào một layer mới.
5. **Chi phí được chặn bằng code**, không chỉ dựa vào lời dặn trong prompt: có `confirm_cost` và trần chi phí hằng ngày.

---

## 2. Phân lớp module & quy tắc phụ thuộc

```mermaid
flowchart TB
  mcp[src/mcp] --> tools
  cli[src/cli] --> tools
  bridge[src/bridge] --> tools
  bridge --> store
  ase[integrations/aseprite - Lua] -. WebSocket .-> bridge
  tools[src/tools] --> store
  tools --> providers
  tools --> core
  store[src/store] --> core
  providers[src/providers] --> shared
  core[src/core] --> shared[src/shared]
```

| Module | Chạy ở | Trách nhiệm | Được import |
|---|---|---|---|
| `shared` | browser + Node | zod schema, type, hằng số, palette preset, bảng màu hạt | không import module nào |
| `core` | browser + Node | Toàn bộ thuật toán pixel. Chỉ dùng `Uint8Array`, không dùng `Buffer`/`fs` | `shared` |
| `store` | Node | Đọc/ghi `DATA_DIR`, version, proposal, khoá file, nhật ký chi phí | `core`, `shared` |
| `providers` | Node | Gọi API ảnh, router, retry, ngân sách | `shared` |
| `tools` | Node | Logic nghiệp vụ của từng tool | `core`, `store`, `providers`, `shared` |
| `mcp` / `cli` / `bridge` | Node | Lớp vỏ: chuyển đổi giao thức | `tools` (bridge dùng thêm `store` để đọc head và tính diff) |
| `integrations/aseprite` | Lua trong Aseprite | Extension đồng bộ + script batch `doc.json ↔ .aseprite` | Không import code TS. Chỉ nói chuyện qua giao thức bridge (mục 9) |

Quy tắc này được **kiểm tra tự động bằng `dependency-cruiser`** trong `pnpm lint`. Ví dụ: nếu `core` import `fs` thì lint báo lỗi.

---

## 3. Mô hình dữ liệu

### 3.1 `PixelDoc` — định dạng chuẩn của một tác phẩm

```ts
type Purpose = 'game' | 'print' | 'digital' | 'craft'

interface PixelDoc {
  v: 1
  width: number                 // 1..256
  height: number                // 1..256
  palette: string[]             // "#rrggbbaa"; palette[0] luôn = "#00000000" (trong suốt); ≤ 256 màu
  layers: Layer[]               // dưới → trên
  frames: Frame[]               // ≥ 1
  cels: Record<string, string>  // key "layerId:frameId" → base64(RLE(chỉ số palette))
  meta: { purpose: Purpose; title?: string; tags?: AnimTag[] }
}
interface Layer { id: string; name: string; visible: boolean; opacity: number; locked: boolean; origin?: 'user' | 'ai' | 'claude' }
interface Frame { id: string; durationMs: number }
interface AnimTag { name: string; from: number; to: number }   // ví dụ "walk" từ frame 0 đến 3
```

- **Trong bộ nhớ:** mỗi cel được giải nén thành `Uint8Array(width*height)`. Giá trị mỗi phần tử là chỉ số trong palette.
- **RLE:** chuỗi cặp `[độ dài dải (varint), chỉ số màu (u8)]`, sau đó mã hoá base64. Ảnh pixel art có nhiều vùng cùng màu nên RLE nén rất tốt.
- **Bất biến**, được kiểm bằng `core.validateDoc()` trước mỗi lần ghi:
  - `palette[0]` là màu trong suốt.
  - Mọi chỉ số < `palette.length`.
  - Mỗi cặp layer × frame có đúng một cel.
  - Các id là duy nhất.
  - Kích thước và số màu nằm trong giới hạn.

### 3.2 Trên đĩa

Art nằm trong thư mục của từng dự án; `DATA_DIR` (mặc định `D:\SquarelArt-data`) chỉ giữ log, usage, file phiên và art cũ.

```
<thư mục dự án>/squarel_art/
  .gitignore                          theo dõi project.json và versions/; bỏ qua .lock, *.tmp, .work-*.json, proposals/, exports/, work.aseprite, thumb.png, .*.importing/
  <art id>/
    project.json                      { slug, name, purpose, createdAt, updatedAt, head: "v000042" }
    thumb.png                         ảnh nhỏ frame 0 (cạnh dài ≤ 128), ghi lại sau mỗi lần tạo/commit
    versions/index.jsonl              mỗi version 1 dòng: { id, parent, ts, source, label, bytes }
    versions/v000042.json.gz          { id, parent, ts, source, label, doc: PixelDoc }
    proposals/<pid>/meta.json         xem mục 3.3
    proposals/<pid>/raw-1.png …       ảnh gốc provider trả về
    proposals/<pid>/v1.json …         biến thể đã chuẩn hoá (pixels + palette + metrics)
    proposals/<pid>/sheet.png         ảnh ghép các biến thể, có đánh số
    assets/                           ảnh tham chiếu đã sao chép vào art
    exports/<preset>-<ts>.<ext>       file đã xuất
    work.aseprite                     file làm việc cho chế độ trao đổi qua file (sinh tự động)
    .lock                             khoá ghi (proper-lockfile)
  .<art id>.importing/                thư mục tạm của art_import (dọn khi lỗi; .gitignore bỏ qua nếu tiến trình bị chết giữa chừng)

DATA_DIR/
  config.json                         tuỳ chọn: ghi đè cấu hình mặc định
  inbox/                              thả ảnh chụp / ảnh tham chiếu vào đây
  logs/mcp.log  logs/bridge.log
  usage.jsonl                         mỗi lần gọi provider ảnh 1 dòng
  run/mcp-<pid>.json                  file phiên của từng tiến trình MCP (mục 8)
  workspaces/<id>.json                chỉ mục dự án: { schema: 1, id, name, folder, createdAt } (mục 3.5)
  projects/<slug>/                    art cũ (chỉ đọc), cùng cấu trúc như <art id>/ ở trên; art_import chuyển vào dự án
```

- **`slug` (id art):** khớp `^[a-z0-9][a-z0-9-]{0,63}$`. Mọi đường dẫn được resolve và kiểm tra vẫn nằm trong `squarel_art/` của dự án, để chặn path traversal. Tham chiếu một art là `ref` = `<id dự án>/<id art>`.
- **`source`** của version là một trong: `claude` | `editor` | `ai` | `cli` | `import`. Extension Aseprite dùng giá trị này để đặt tên transaction (ví dụ "Claude: …") và hiện thông báo.
- **Vị trí quyết định dự án:** art thuộc dự án chứa thư mục `squarel_art/` đó; `project.json` của art không có trường `workspace`. Art cũ trong `DATA_DIR/projects` hiện ở mục **Art cũ** của launcher cho tới khi được chuyển vào một dự án.
- **`usage.jsonl`**, mỗi dòng: `{ ts, provider, model, op, units, unitKind: 'neuron'|'credit'|'none', usd, project, proposal, ok }`.

### 3.3 Proposal (đề xuất do AI tạo)

```ts
interface ProposalMeta {
  id: string                         // "p_7f3a"
  createdAt: string
  kind: 'generate' | 'edit' | 'animate'
  baseVersion: string                // version lúc yêu cầu
  request: { prompt: string; width: number; height: number; palette?: string; quality: 'free' | 'high'; region?: Rect }
  provider: string; model: string; costUsd: number
  variants: { n: number; raw: string; normalized: string; metrics: NormalizeReport }[]
  status: 'open' | 'accepted' | 'discarded'
  acceptedVariant?: number; acceptedInVersion?: string
}
```

### 3.4 Ghi an toàn khi có nhiều tiến trình
`squarel-mcp`, `pnpm bridge` và CLI có thể là **nhiều tiến trình khác nhau cùng ghi vào một project**. Mỗi lần commit đi theo trình tự:

1. Lấy khoá `.lock`. Khoá tự hết hạn sau 10 giây nếu tiến trình giữ khoá bị crash.
2. Đọc `project.json.head` rồi so với `baseVersion` người gọi đưa vào.
   - Nếu khác: trả lỗi `CONFLICT` kèm head hiện tại. Người gọi tự đọc lại và thử lại.
3. Ghi file version vào file tạm, rồi `rename` sang tên thật. Rename là thao tác nguyên tử.
4. Ghi thêm 1 dòng vào `index.jsonl`.
5. Cập nhật `project.json` theo cách tạm + rename.
6. Nhả khoá.

Tool phía Claude không giữ bản doc cũ: **luôn đọc head ngay trước khi sửa**, nên gần như không gặp `CONFLICT`. Nếu vẫn gặp thì tự thử lại tối đa 3 lần.

---

### 3.5 Dự án (workspace)

Trong code, "project" là **một art** (một canvas). Cấp gom nhiều art cho cùng một mục đích (game, bộ sticker, bản in) tên là **workspace**; giao diện gọi là "Dự án". Thiết kế đầy đủ: [superpowers/specs/2026-11-24-workspaces-design.md](superpowers/specs/2026-11-24-workspaces-design.md).

```
<thư mục dự án>/
  AGENTS.md                 khối <!-- squarel:begin … squarel:end --> do launcher quản lý (brief)
  CLAUDE.md                 có dòng "@AGENTS.md"
  .squarel/project.json     { schema: 1, id, name, description?, brief?, defaults?: { purpose?, width?, height?, palette? }, repos?, exportDir? }
  .squarel/arts.md          danh mục art, Squarel tự sinh
```

- **Nguồn sự thật** là `.squarel/project.json` (launcher ghi, Squarel chỉ đọc; trường lạ được giữ nguyên). Module: `src/store/workspace.ts` (đọc cấu hình, dò thư mục, chỉ mục, danh mục).
- **Đọc dễ dãi:** file có thể bị sửa tay, nên chỉ bắt buộc `id` hợp lệ và `name` không rỗng (cắt còn 80 ký tự); thiếu `schema` thì coi là 1. Trường nào sai (`defaults.width: 0`, bảng màu lạ, `description` không phải chuỗi...) thì bỏ riêng trường đó và ghi log cảnh báo, không bỏ cả dự án. Tên bảng màu so không phân biệt hoa thường, bỏ qua `-` và `_` (`PICO-8` → `pico8`).
- **Nhận dự án:** lúc MCP khởi động, dò ngược từ `CLAUDE_PROJECT_DIR` (không có thì `process.cwd()`) lên tối đa 32 cấp tới khi gặp `.squarel/project.json`. File hỏng (không đọc được, thiếu `id`/`name`) thì ghi log cảnh báo và coi như không có dự án. Việc nhận dự án không cần `DATA_DIR/workspaces/<id>.json`.
- **Chỉ mục `DATA_DIR/workspaces/<id>.json`** do launcher quản lý (tạo khi thêm, xóa khi gỡ dự án). Squarel không bao giờ tạo mục thiếu, để dự án đã gỡ vẫn bị gỡ. Squarel chỉ sửa mục có sẵn khi thư mục mà mục đó trỏ tới không còn `.squarel/project.json` cùng `id` (thư mục đã bị chuyển); mục còn sống không bao giờ bị chuyển sang bản sao. CLI dò dự án từ `SQUAREL_PROJECT_DIR`, không có thì `INIT_CWD` (thư mục nơi chạy `pnpm`), rồi `process.cwd()`. `pnpm bridge` độc lập không có dự án nào: nó phục vụ art theo `ref` của các dự án trong chỉ mục `DATA_DIR/workspaces`.
- **Mặc định:** `art_create` lấy `width`, `height`, `purpose`, `palette` từ `defaults` khi bỏ trống; không có dự án mà thiếu kích thước thì báo `INVALID`. Art mới (kể cả `photo_to_pixel` tạo art mới) thuộc dự án nhờ vị trí: nằm trong `<dự án>/squarel_art/`, `project.json` của art không còn trường `workspace`. Mỗi lần gọi tool, file cấu hình được đọc lại nên sửa trong launcher có hiệu lực ngay.
- **Danh mục `.squarel/arts.md`:** sinh lại sau mỗi commit (kể cả từ bridge ở tiến trình khác, vì hook nằm trong `Store`), sau `art_import`, sau `export` và lúc MCP khởi động (chạy nền, không chờ trước khi kết nối, để thư viện lớn không làm chậm khởi động; phần hướng dẫn cho Claude chỉ đọc `project.json` của từng art). Ghi tạm + rename; lỗi chỉ ghi log, không làm hỏng commit.
- **Xuất file:** art thuộc dự án có `exportDir` thì `export` chép thêm các file vào `<thư mục>/<exportDir>` (tự tạo thư mục). Quy tắc chung với launcher: `exportDir` phải là đường dẫn tương đối tới thư mục con nằm hẳn bên trong thư mục dự án; rỗng, `.`, đường dẫn tuyệt đối, `..` hoặc `../x` đều bị từ chối (thư mục tên `..assets` thì được). `exportDir` sai không làm hỏng lệnh `export`: file vẫn ghi vào `exports/`, bước chép bị bỏ qua và kết quả có dòng cảnh báo nêu lý do.

## 4. Các interface chính

### 4.1 Tool dùng chung (`src/tools/types.ts`)

```ts
interface ToolDef<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string                                   // snake_case, ví dụ "add_outline"
  title: string
  description: string                            // viết cho Claude đọc: khi nào dùng, tốn tiền không
  input: I                                       // zod schema
  annotations: { readOnly?: boolean; costly?: boolean; mutates?: boolean }
  handler(ctx: ToolContext, input: z.infer<I>): Promise<ToolResult>
}

interface ToolContext {
  store: Store
  providers: ProviderRouter
  session: { activeProject?: string; workspace?: Workspace }  // mỗi tiến trình MCP giữ một bản riêng; workspace dò lúc khởi động
  config: Config
  log: Logger                                    // không bao giờ ghi ra stdout
  signal: AbortSignal
  progress?(done: number, total: number, message?: string): void
}

interface ToolResult {
  text: string                                   // tóm tắt ngắn cho Claude
  images?: { png: Uint8Array; alt: string }[]    // tối đa 2 ảnh, cạnh dài ≤ 512px
  files?: string[]                               // đường dẫn tuyệt đối của file vừa tạo
  data?: unknown                                 // JSON có cấu trúc (CLI và bridge dùng)
}

class ToolError extends Error {
  constructor(public code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT' | 'BUDGET' | 'NEEDS_CONFIRM' | 'PROVIDER' | 'TIMEOUT', msg: string, public data?: unknown) { super(msg) }
}
```

- Tool đụng tới art nhận tham số tuỳ chọn `art?: string` (id art trong dự án hiện tại). Nếu bỏ trống thì dùng `session.activeProject`. Ngoài một dự án, các tool này báo `NO_PROJECT`.
- Tool có sửa ảnh luôn nhận thêm `preview?: number`, mặc định 256px, đặt 0 để tắt preview.

### 4.2 Store (`src/store`)

```ts
interface Store {
  listProjects(): Promise<ProjectSummary[]>
  createProject(p: { name: string; doc: PixelDoc; source: Source; slug?: string }): Promise<ProjectSummary>   // id trùng thì thêm -2, -3…
  freeSlug(base: string): Promise<string>      // id chưa có thư mục trong store này (≤ 64 ký tự)
  assertWritable(): void                       // ném lý do khi store chỉ đọc (art cũ, id dự án trùng)
  onCommit(fn: (e: { slug; versionId; doc }) => unknown): () => void          // hook sau commit
  readHead(slug: string): Promise<{ versionId: string; doc: PixelDoc }>
  commit(slug: string, c: { baseVersion: string; doc: PixelDoc; source: Source; label: string }): Promise<string>  // trả về versionId mới
  history(slug: string, limit?: number): Promise<VersionInfo[]>
  readVersion(slug: string, id: string): Promise<PixelDoc>
  proposals: ProposalStore
  exports: { write(slug: string, name: string, bytes: Uint8Array): Promise<string> }
  usage: { append(e: UsageEntry): Promise<void>; summary(range: 'today' | 'month'): Promise<UsageSummary> }
}
```

Có thêm hàm tiện ích `withHead(slug, source, label, fn: (doc) => PixelDoc)`. Hàm này gói cả chuỗi đọc head → áp `fn` → commit → tự thử lại khi `CONFLICT`. **Mọi tool sửa ảnh đều dùng hàm này.**

Sau mỗi commit (`commit`, `withHead`, `restore`/`undo`, cả lần tạo project), ngoài khoá, `Store` chạy các hook: ghi `thumb.png` và sinh lại `.squarel/arts.md` của dự án chứa art. Hook mặc định bật ở mọi tiến trình dùng store (`new Store(dir, { hooks: false })` để tắt). Lỗi trong hook chỉ ghi log (`store.log`), không bao giờ làm hỏng commit.

### 4.3 Provider ảnh (`src/providers`)

```ts
interface ImageProvider {
  id: 'cloudflare' | 'retrodiffusion' | 'local-sd' | 'mock'
  capabilities: { generate: boolean; img2img: boolean; inpaint: boolean; animate: boolean; nativePixel: boolean; paletteInput: boolean; maxSide: number }
  quote(req: GenRequest | EditRequest): Promise<{ usd: number; units: number; unitKind: UnitKind }>
  generate(req: GenRequest, signal: AbortSignal): Promise<RawImage[]>
  edit?(req: EditRequest, signal: AbortSignal): Promise<RawImage[]>
  animate?(req: AnimRequest, signal: AbortSignal): Promise<RawImage[]>   // trả về sprite sheet
  health(): Promise<boolean>
}
interface RawImage { png: Uint8Array; width: number; height: number; seed?: number }

interface ProviderRouter {
  pick(task: 'generate' | 'edit' | 'animate', quality: 'free' | 'high'): ImageProvider   // theo cấu hình + capability + health
  budget: { check(quote): void /* ném ToolError BUDGET */; record(entry): Promise<void> }
}
```

| Adapter | Endpoint (kiểm tra lại docs lúc build) | Ghi chú |
|---|---|---|
| `cloudflare` | `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell` | Trả về ảnh base64. Mặc định 4 step, 512px. Đếm neuron để không vượt free tier |
| `retrodiffusion` | API của Retro Diffusion (header token) | `check_cost` để báo giá trước. Hỗ trợ `input_palette`, animation, tileset |
| `local-sd` | `POST http://127.0.0.1:7861/generate`, `/img2img` | Service FastAPI do mình viết. `health()` cho biết service có đang chạy |
| `mock` | Không gọi mạng | Trả ảnh fixture theo seed, giá $0 |

**Quy tắc chung cho mọi adapter:**
- Timeout 90 giây mỗi request.
- Gặp lỗi 429 hoặc 5xx: thử lại 2 lần, giãn cách 1 → 3 giây.
- Tối đa 2 request đồng thời cho mỗi provider (dùng `p-limit`).
- Chuỗi fallback khi `quality:'free'`: `cloudflare` → `local-sd` (nếu `health()` ok) → báo lỗi.
- **Không bao giờ tự nhảy sang provider tốn tiền.**

### 4.4 Chuẩn hoá pixel (`src/core/normalize`)

```ts
function normalize(img: RGBA, opts: {
  target?: { width: number; height: number }   // kích thước đích của doc
  palette?: string[]                            // ép theo palette cho trước
  maxColors?: number                            // mặc định 16 nếu không có palette
  removeBackground?: boolean                    // mặc định true khi ảnh không có alpha
  despeckle?: boolean                           // mặc định true
}): { pixels: Uint8Array; palette: string[]; width: number; height: number; report: NormalizeReport }

interface NormalizeReport { blockSize: number; offset: [number, number]; gridConfidence: number; colorCount: number; transparentRatio: number; warnings: string[] }
```

Thuật toán chi tiết nằm ở mục 7.

### 4.5 Preset xuất file (`src/core/export`)

```ts
interface ExportPreset<O = unknown> {
  id: string; purpose: Purpose; label: string; options: z.ZodType<O>
  run(doc: PixelDoc, opts: O): Promise<{ name: string; bytes: Uint8Array; mime: string }[]>
}
```

| id | Đầu ra |
|---|---|
| `game-png` | PNG 1× trong suốt; `scale` 1/2/4/8 |
| `game-spritesheet` | PNG sheet + JSON theo định dạng Aseprite (array), có `frameTags` |
| `game-gif` | GIF theo `durationMs` của từng frame |
| `print-png` | PNG phóng to nearest-neighbor tới `widthMm`/`heightMm` ở 300 DPI, ghi DPI vào chunk `pHYs` |
| `print-svg` | SVG, mỗi màu là một `<path>` gộp các ô vuông |
| `print-pdf` | PDF 1 trang đúng kích thước in (pdf-lib) |
| `social-avatar` | PNG 512/1024 |
| `social-emoji` | PNG 128 |
| `social-sticker` | WebP 512 (dùng sharp) |
| `social-anim` | GIF / APNG |
| `craft-beads` | PDF mẫu hạt: lưới, ký hiệu, bảng màu theo hãng Perler/Hama, **số hạt mỗi màu**, chia theo bảng ghim 29×29. Kèm CSV |

---

## 5. Danh mục tool

Mọi tool art đều có tham số tuỳ chọn `art` và cần một dự án (ngoài dự án trả `NO_PROJECT`, chỉ `art_list { legacy: true }` vẫn chạy). Cột "Ghi" cho biết tool có tạo version mới không; "$" là tool có thể tốn tiền.

| Tool | Input chính | Ghi | $ | Trả về |
|---|---|---|---|---|
| `art_list` | legacy? | | | danh sách art của dự án; `legacy: true` liệt kê art cũ trong `DATA_DIR/projects` (chạy được ngoài dự án) |
| `art_create` | name, width?, height?, purpose?, palette? (bỏ trống thì lấy mặc định của dự án) | ✓ | | info (có thư mục của art) + ảnh canvas trống |
| `project_info` | — | | | dự án hiện tại: tên, thư mục, mô tả, brief, mặc định, repo, exportDir, art; không có thì hướng dẫn tạo bằng launcher |
| `art_open` | art | | | đặt làm art đang mở + ảnh preview |
| `art_info` | — | | | kích thước, palette, layers, frames, head, thư mục của art |
| `canvas_view` | scale?, layer?, frame?, grid?, coords? | | | **ảnh** (có lưới và toạ độ nếu bật) |
| `palette_view` | — | | | ảnh các ô màu đánh số + danh sách hex |
| `draw_pixels` | layer?, frame?, ops[] (`set`/`line`/`rect`/`ellipse`/`fill`), color (hex hoặc chỉ số) | ✓ | | ảnh sau khi vẽ |
| `layer_add` / `layer_remove` / `layer_merge` / `layer_reorder` / `layer_set` | … | ✓ | | info |
| `recolor` | from, to, layer?, tolerance? | ✓ | | ảnh |
| `apply_palette` | preset \| colors[], dither? | ✓ | | ảnh |
| `reduce_colors` | n | ✓ | | ảnh |
| `add_outline` | color, mode (`outer`/`inner`), layer? | ✓ | | ảnh |
| `remove_background` | tolerance? | ✓ | | ảnh |
| `resize_canvas` / `scale` / `flip` / `rotate90` / `crop_to_content` / `shift_hue` | … | ✓ | | ảnh |
| `photo_to_pixel` | path, width, palette?, colors?, asNewProject? | ✓ | | ảnh |
| `generate_image` | prompt, width?, height?, palette?, variants 1–4, quality, confirm_cost? | | ✓ | proposal id + **ảnh ghép biến thể** + metrics |
| `edit_image` | instruction, region? (rect hoặc `selection`), keep_palette, quality, confirm_cost? | | ✓ | như trên |
| `animate` (P5) | action, frames, direction?, quality, confirm_cost? | | ✓ | như trên |
| `accept_variant` | proposal, variant, layerName? | ✓ | | ảnh canvas + tên layer mới |
| `discard_proposal` | proposal | | | ok |
| `history` | limit? | | | danh sách version (nhãn, nguồn, thời điểm) |
| `undo` | — | ✓ | | quay về version trước bằng cách tạo version mới + ảnh |
| `restore_version` | id | ✓ | | ảnh |
| `open_in_editor` | project? | | | Mở hoặc chuyển tới project trong Aseprite (qua bridge, hoặc qua CLI nếu extension chưa kết nối) |
| `export_presets` | purpose? | | | danh sách preset + options |
| `export` | preset, options | | | đường dẫn file + ảnh xem trước nhỏ; chép thêm vào `exportDir` của dự án nếu có |
| `usage_today` | — | | | $ hôm nay / tháng này, neuron Cloudflare còn lại |

**Giao thức xác nhận chi phí** (bắt buộc với `quality:'high'`):
1. Lần gọi đầu không có `confirm_cost`: tool chạy `quote()`, sau đó ném `NEEDS_CONFIRM` với nội dung "Ước tính $0.12 cho 4 biến thể (Retro Diffusion rd-fast). Hỏi người dùng rồi gọi lại với confirm_cost: true".
2. Claude hỏi bạn. Bạn đồng ý thì Claude gọi lại kèm `confirm_cost: true`.
3. Dù đã xác nhận, nếu tổng chi phí hôm nay vượt `IMAGE_DAILY_BUDGET_USD` thì tool vẫn trả `BUDGET`.

---

## 6. Các luồng chính

### 6.1 Tạo ảnh bằng AI rồi chọn biến thể

```mermaid
sequenceDiagram
  actor U as Bạn
  participant CC as Claude Code
  participant T as squarel-mcp (tools)
  participant P as Cloudflare
  participant S as Store (DATA_DIR)
  participant E as Aseprite (qua bridge)
  U->>CC: Tạo hiệp sĩ 32x32, palette PICO-8
  CC->>T: generate_image(prompt, 32, 32, pico8, variants 4)
  T->>T: router.pick + quote + kiểm tra ngân sách
  par tối đa 2 request song song
    T->>P: flux-1-schnell 512px (seed khác nhau)
    P-->>T: PNG
  end
  T->>T: normalize() về 32x32, ép PICO-8, đo metrics
  T->>S: lưu proposal p_7f3 (raw, normalized, sheet)
  T->>S: ghi usage.jsonl
  T-->>CC: tóm tắt + ảnh ghép 4 biến thể
  CC-->>U: Có 4 phương án, bạn chọn số mấy?
  U->>CC: Lấy số 2
  CC->>T: accept_variant(p_7f3, 2)
  T->>S: withHead → thêm layer "AI: hiệp sĩ" → commit v13
  T-->>CC: ảnh canvas mới
  S-->>E: bridge thấy v13 → doc.updated
  E->>E: áp trong transaction "AI: hiệp sĩ"
```

**Chi tiết:**
- **Prompt gửi provider** lấy từ template `src/providers/prompts.ts`: `"pixel art sprite of {subject}, {style}, limited palette, flat colors, crisp hard edges, centered, plain white background, no text, no border"`. Nếu provider nhận palette thì gửi kèm.
- Nếu một biến thể có `gridConfidence < 0.6`, tool sinh lại biến thể đó **1 lần** với seed khác. Vẫn thấp thì giữ lại, kèm cảnh báo trong metrics.
- **Khi accept:**
  - Palette của biến thể được gộp vào palette của doc, chỉ thêm những màu chưa có.
  - Nếu gộp xong vượt 256 màu, hoặc vượt `maxColors` của project, thì ép biến thể về palette hiện tại.
  - Kết quả luôn nằm trong **layer mới**.

### 6.2 Lệnh có quy tắc (ví dụ `add_outline`)
Claude gọi tool → `withHead` → `core.ops.outline(doc, …)` → commit (source `claude`, nhãn "Claude: viền đen ngoài") → trả ảnh preview.
- Thời gian: vài mili giây. Chi phí: $0.

### 6.3 Vẽ trong Aseprite song song với Claude

```mermaid
sequenceDiagram
  participant A as Aseprite (extension)
  participant B as squarel-bridge
  participant S as Store
  participant T as squarel-mcp
  A->>B: cels (base v20) sau 500ms ngừng vẽ
  B->>B: diff với v20 → patch
  B->>S: commit → v21
  B-->>A: ack v21
  Note over A: bạn vẽ tiếp (chưa gửi)
  T->>S: add_outline trên head v21 → v22
  S-->>B: chokidar thấy v22 (source claude)
  B-->>A: doc.updated v22
  A->>B: gửi ngay cels đang dở (base v21)
  B->>B: diff với v21 → patch A, rebase lên v22
  B->>S: commit → v23
  B-->>A: rebased v23 (doc đã gộp)
  A->>A: áp v23 trong transaction
```

- **Extension không tự tính diff.** Nó gửi nguyên các cel hiện tại; ảnh ≤ 256×256 nén RLE nên rất nhỏ.
- Bridge dùng `core.diff(baseDoc, incoming)` để tính ra **patch pixel** `(layerId, frameId, x, y, cũ → mới)`, rồi `core.rebase(patch, headDoc)`.
- Nếu layer mà patch nhắm tới đã bị Claude xoá, patch được đặt vào layer mới "Nét vẽ khôi phục". **Không mất nét nào.**
- **Chống vòng lặp gửi qua gửi lại:** khi đang áp doc từ bridge, extension bật cờ `applyingRemote` để bỏ qua sự kiện thay đổi do chính nó gây ra.

### 6.4 Xuất file
`export{preset:'print-png', options:{widthMm:300}}` → `core.export` → `store.exports.write` → trả đường dẫn tuyệt đối kèm ảnh xem trước nhỏ. Từ Aseprite cũng xuất được: menu File → Squarel → Export… gửi `tool { name: 'export' }` qua bridge.

### 6.5 Ảnh chụp → pixel art
`photo_to_pixel{path:'D:\\SquarelArt-data\\inbox\\meo.jpg', width:48, colors:16}`:
1. Kiểm tra file: phải là PNG/JPEG/WebP, ≤ 20MB.
2. `sharp` decode và thu nhỏ bằng bộ lọc `area`.
3. `core.quantize` (OKLab k-means), sau đó `despeckle`.
4. Tạo project mới hoặc thêm layer mới.

Toàn bộ chạy local, $0.

---

## 7. Pipeline chuẩn hoá pixel (chi tiết)

Đầu vào: ảnh RGBA cỡ W×H từ provider (thường 512² hoặc 1024²).

1. **Alpha:** `a < 128` thành 0, còn lại thành 255.
2. **Xoá nền** (khi ảnh không có vùng trong suốt):
   - Lấy màu xuất hiện nhiều nhất trên viền ảnh làm màu nền.
   - Flood-fill từ các mép với ngưỡng ΔE(OKLab) < 0.04, biến vùng đó thành trong suốt.
3. **Dò lưới:**
   - Tính "tín hiệu cạnh" theo hai trục x và y: tại vị trí nào hai pixel kề nhau có ΔE > 0.03.
   - Thử mọi cặp `(s, o)` với kích thước ô `s` từ 2 đến 64 và độ lệch `o` từ 0 đến s−1. Điểm của mỗi cặp = tỉ lệ cạnh rơi đúng bội số của `s` tính từ `o`.
   - Chọn cặp có điểm cao nhất. **`gridConfidence`** = điểm đó, phạt thêm nếu kết quả mâu thuẫn giữa trục x và y.
4. **Thu về lưới gốc:**
   - Mỗi ô `s×s` lấy **màu xuất hiện nhiều nhất** (mode), sau khi đã gom sơ bộ về 64 màu để lọc nhiễu.
   - Một ô được tính là trong suốt nếu > 50% pixel của nó trong suốt.
5. **Về kích thước đích:** nếu kích thước sau bước 4 khác `target`, resample bằng cách lấy mode theo vùng. Không lấy trung bình, để không sinh màu lai.
6. **Lượng tử hoá màu:**
   - Có palette đích: mỗi màu map tới màu gần nhất trong không gian OKLab.
   - Không có: chạy k-means++ trong OKLab với seed cố định (kết quả lặp lại được), `k = maxColors`, sau đó gộp các cụm có ΔE < 0.02.
7. **Despeckle:** pixel đứng một mình mà 8 ô xung quanh cùng một màu khác thì đổi theo màu đó.
8. **Báo cáo:** trả về `NormalizeReport`. Cảnh báo khi `gridConfidence < 0.6`, khi `colorCount` bị cắt nhiều, hoặc khi `transparentRatio > 0.95` (ảnh gần như trống).

Các ngưỡng trên là giá trị khởi điểm, sẽ được tinh chỉnh bằng `evals/`. **Cùng một đầu vào luôn cho cùng một đầu ra.**

---

## 8. MCP server (`src/mcp`)

- **Khởi động:** `src/mcp/index.ts`
  1. Nạp `.env` từ thư mục gốc repo. Đường dẫn resolve qua `import.meta.url`, không phụ thuộc thư mục hiện hành (cwd).
  2. Khởi tạo `store`, `providers`, logger. Logger ghi bằng pino ra stderr và `DATA_DIR/logs/mcp.log`.
  3. Dò dự án (mục 3.5), đặt `session.workspace`, sinh lại `.squarel/arts.md`.
  4. `new McpServer({ name: 'squarel', version }, { instructions })`. Có dự án thì `instructions` thêm một đoạn: tên, thư mục, mặc định, số art và tối đa 5 art mới nhất, brief ở `AGENTS.md`, danh mục ở `.squarel/arts.md`, `art_list` chỉ hiện art của dự án (`legacy: true` để xem art cũ). Không có dự án thì đoạn đó là `NO_PROJECT_TEXT` kèm số art cũ chờ `art_import`; thư mục là git worktree thì thêm đoạn nói art nằm ở checkout chính; trùng id thì thêm đoạn báo ghi bị chặn.
  5. Gọi `registerTool` cho từng `ToolDef`.
  6. `connect(new StdioServerTransport())`.
- **Chuyển kết quả sang MCP:**
  - `ToolResult.text` thành content `text`.
  - Mỗi ảnh thành content `{ type: 'image', data: base64, mimeType: 'image/png' }`.
  - `ToolError` thành kết quả `isError: true`, nội dung `"[CODE] thông điệp"` để Claude biết cách xử lý.
- **Annotations:**
  - Tool chỉ đọc: `readOnlyHint: true`.
  - Tool AI: `openWorldHint: true`.
  - Không tool nào xoá dữ liệu thật, vì lịch sử chỉ thêm, không sửa.
- **Tiến độ:** nếu request có `progressToken`, gửi `notifications/progress` sau mỗi biến thể xong.
- **Giới hạn:** mỗi tool AI có hạn chót nội bộ 110 giây. Tới hạn thì trả về các biến thể đã xong và ghi chú phần còn thiếu.
- **Cấm ghi ra stdout** (`console.log`), vì stdout đang dùng cho giao thức. Biome có rule chặn `console.log` trong `src/**`.

**File phiên (cho launcher):** mỗi tiến trình MCP ghi `DATA_DIR/run/mcp-<pid>.json` gồm `pid`, `cwd`, `version`, `startedAt`, `updatedAt`, `lastTool?`, `lastToolAt?`, `bridge` (`own` | `shared` | `none`), `workspace?: { id, name }` (dự án dò được lúc khởi động). Ghi lại mỗi 10 giây và sau mỗi lần gọi tool, xoá khi thoát. Launcher coi file là cũ sau 30 giây. Chi tiết: [integrations.md](integrations.md#file-phiên-mcp).

`.mcp.json` ở gốc repo:
```json
{
  "mcpServers": {
    "squarel": {
      "command": "node",
      "args": ["--import", "tsx", "src/mcp/index.ts"]
    }
  }
}
```
Gọi thẳng `node` thay vì `pnpm`/`npx` để tránh phải bọc `cmd /c` trên Windows. Bản build đổi thành `"args": ["dist/mcp.js"]`.

---

## 9. Tích hợp Aseprite

### 9.1 Thành phần

**`src/bridge`** (Node):
- WebSocket server `ws://127.0.0.1:4321/bridge`, dùng thư viện `ws`.
- `chokidar` theo dõi `projects/*/project.json` (debounce 100ms), để biết khi tiến trình khác vừa tạo version mới.
- Gọi Aseprite CLI qua `execa`, dùng cho `open_in_editor` và chế độ trao đổi qua file.
- **Cách khởi động:**
  - Khi khởi động, `squarel-mcp` thử bind cổng.
  - Nếu gặp `EADDRINUSE` (đã có bridge khác chạy) thì bỏ qua. Bridge kia vẫn thấy mọi thay đổi nhờ chokidar.
  - `pnpm bridge` chạy bridge riêng, khi bạn muốn vẽ mà không mở Claude Code.

**Extension `integrations/aseprite/squarel/`:**

| File | Vai trò |
|---|---|
| `package.json` | Manifest của extension: tên, phiên bản, khai báo script |
| `plugin.lua` | `init(plugin)`: tạo menu **File → Squarel** (extension không thêm được menu cấp cao nhất), tự kết nối, heartbeat `ping` 5 giây + watchdog nối lại, lưu cấu hình trong `plugin.preferences`. Lỗi trong `init` được tự in ra vì Aseprite bỏ qua chúng |
| `bridge.lua` | WebSocket client, tự kết nối lại (chờ 1s, tăng dần tới 30s), hàng đợi tin nhắn |
| `sync.lua` | Áp `PixelDoc` vào sprite, đọc cel từ sprite, theo dõi `sprite.events` |
| `codec.lua` | base64 + RLE, cùng định dạng với `src/core/codec` |

**Script batch `integrations/aseprite/cli/`:**
- Gồm `doc-to-aseprite.lua` và `aseprite-to-doc.lua`, dùng chung `sync.lua` và `codec.lua`.
- Chạy bằng `aseprite -b --script-param in=… --script-param out=… --script <file>`.

`pnpm aseprite:pack` nén thư mục extension thành `squarel.aseprite-extension`. Nhấp đúp file này để cài vào Aseprite.

### 9.2 Ánh xạ `PixelDoc` ↔ sprite Aseprite

| PixelDoc | Aseprite |
|---|---|
| `width`, `height` | `sprite.width`, `sprite.height` |
| `palette` (index 0 trong suốt) | `sprite.palettes[1]`, `ColorMode.INDEXED`, `sprite.transparentColor = 0` |
| `layers` (dưới → trên) | `sprite.layers`. Chỉ layer thường; layer nhóm chưa hỗ trợ |
| `Layer.id` | `layer.properties("squarel").id`. Nhờ vậy giữ nguyên id khi đổi tên hoặc kéo đổi thứ tự |
| `visible` / `opacity` / `locked` | `layer.isVisible` / `layer.opacity` (0–255) / `not layer.isEditable` |
| `frames[].durationMs` | `frame.duration` (đơn vị giây) |
| `cels` | `cel.image` ở chế độ INDEXED. **Khi đọc:** chép ảnh vào bộ đệm cỡ toàn canvas tại `cel.position`. **Khi ghi:** dùng ảnh cỡ toàn canvas đặt tại (0,0) |
| `meta.tags` | `sprite.tags` |
| ref + `baseVersion` | `sprite.properties("squarel")` |

### 9.3 Giao thức bridge (JSON qua WebSocket)

| Hướng | Tin nhắn | Ý nghĩa |
|---|---|---|
| extension → bridge | `hello { client:'aseprite', ext, app, protocol: 2 }` | Bắt tay. Thiếu `protocol: 2` thì bridge gửi `error { code: 'extension-outdated' }` rồi đóng kết nối |
| bridge → extension | `welcome { server, version, protocol: 2, arts }` | Trả danh sách art của mọi dự án (`arts`: `{ ref, project, projectName, art, name, head }[]`) |
| extension → bridge | `open { ref }` | Mở một art; `ref` là `<id dự án>/<id art>` |
| bridge → extension | `doc { ref, versionId, doc }` | Toàn bộ PixelDoc (cel dạng RLE base64) |
| extension → bridge | `cels { ref, baseVersion, doc, label? }` | Trạng thái hiện tại sau khi bạn vẽ |
| bridge → extension | `ack { ref, versionId }` | Ghi thành công |
| bridge → extension | `rebased { ref, versionId, doc, warnings }` | Đã gộp với một thay đổi mới hơn; extension áp lại doc này |
| bridge → extension | `doc.updated { ref, versionId, source, label, doc }` | Claude, AI hoặc CLI vừa tạo version mới |
| bridge → extension | `open.request { ref }` | `open_in_editor` yêu cầu mở art |
| client → bridge | `status` | Hỏi ai đang kết nối. Bridge trả `status { version, clients }`, mỗi client là `{ name, ext?, app?, ref?, version?, connectedAt, lastSeen }`; `version` là id version PixelDoc client nhận hoặc ghi gần nhất, không phải phiên bản công cụ (đó là `app`). Launcher dùng để biết Aseprite đã kết nối chưa |
| extension → bridge | `tool { id, name, input, ref? }` | Menu Xuất file, Lịch sử… gọi lại tool; `ref` chọn dự án và art, thiếu thì bị từ chối với `NO_PROJECT`. Bridge trả `tool_result { id, ok, text, files? }` |
| hai chiều | `error { code, message }` | Báo lỗi |

**Quy tắc phía extension:**
- **Áp doc từ bridge** (`doc`, `doc.updated`, `rebased`): làm trong `app.transaction("Claude: <label>")` để gộp thành một bước undo. Trong lúc áp, bật cờ `applyingRemote` để bỏ qua sự kiện do chính mình gây ra.
- **Khi bạn vẽ:**
  - Mỗi sự kiện `change` từ `sprite.events` đặt lại bộ đếm 500ms; hết 500ms thì gửi `cels`.
  - Nếu `doc.updated` tới trong lúc còn thay đổi chưa gửi: gửi `cels` ngay, bridge sẽ trả `rebased`.
- **Mất kết nối:** vẫn vẽ bình thường. Extension phát hiện mất kết nối bằng heartbeat (không nhận pong trong 15 giây, hoặc gửi bị lỗi), vì Aseprite có thể không báo CLOSE khi bridge bị tắt đột ngột. Khi nối lại, mọi sprite đang liên kết gửi `cels` kèm `baseVersion` cũ và bridge tự rebase.

### 9.4 `open_in_editor` và chế độ trao đổi qua file

1. **Extension đang kết nối:** bridge gửi `open.request`.
2. **Extension chưa kết nối:**
   - chạy `aseprite -b --script doc-to-aseprite.lua` để tạo `work.aseprite`, có `baseVersion` ghi trong properties;
   - mở Aseprite: `ASEPRITE_PATH work.aseprite`.
3. **Chế độ trao đổi qua file** (dùng khi extension không chạy):
   1. Bridge theo dõi `work.aseprite`.
   2. Khi file được lưu: chạy `aseprite -b --script aseprite-to-doc.lua`, so với `baseVersion` để ra patch, rebase rồi commit với source `editor`.
   3. `work.aseprite` chỉ được ghi lại bản mới **khi Aseprite không mở file đó**, để không ghi đè lúc bạn đang sửa.

### 9.5 Cần kiểm chứng trong spike (1 ngày)

- `WebSocket` trong extension Lua: kết nối tới `ws://127.0.0.1`, gửi/nhận text, tự kết nối lại.
- `sprite.events:on('change')`:
  - có bắn đúng lúc không;
  - có phân biệt được thay đổi do undo/redo không.
- Tốc độ ghi chỉ số vào `Image` INDEXED cỡ 256×256 (`image.bytes` hoặc `drawPixel`).
- `app.transaction` có gộp được nhiều thao tác thành một bước undo không.
- `properties` có lưu được trên sprite và layer, và có được ghi vào file `.aseprite` không.
- Script có bị hộp thoại bảo mật của Aseprite hỏi quyền mạng/file không, và cấp quyền một lần thế nào.

Nếu thiếu `WebSocket` hoặc sự kiện thay đổi: dừng ở chế độ trao đổi qua file (9.4) và cân nhắc Pixelorama.

## 10. Cấu hình & khởi chạy

`.env` (repo chỉ commit `.env.example`):
```
DATA_DIR=D:\SquarelArt-data
IMAGE_PROVIDER=cloudflare            # cloudflare | local-sd | mock
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=                # quyền Workers AI
RETRO_DIFFUSION_API_KEY=             # tuỳ chọn
LOCAL_SD_URL=http://127.0.0.1:7861   # tuỳ chọn
IMAGE_DAILY_BUDGET_USD=1
PREVIEW_DEFAULT_PX=256
BRIDGE_PORT=4321
ASEPRITE_PATH=C:\Program Files\Aseprite\Aseprite.exe
```

Các script trong `package.json`:

| Script | Làm gì |
|---|---|
| `mcp` | `node --import tsx src/mcp/index.ts` (chạy tay để debug) |
| `bridge` | Chạy bridge riêng: `node --import tsx src/bridge/index.ts` |
| `aseprite:pack` | Nén `integrations/aseprite/squarel/` thành `squarel.aseprite-extension` |
| `aseprite:test` | Kiểm tra `doc.json → .aseprite → doc.json` qua Aseprite CLI (chỉ chạy khi có `ASEPRITE_PATH`) |
| `build` | `tsdown` cho mcp/cli/bridge |
| `test` / `eval` / `lint` | vitest / chạy `evals/` / biome + dependency-cruiser + tsc |
| `local-sd` | `uvicorn services.local_sd.app:app --port 7861` (cần Python + CUDA) |

**Thư viện:**

| Nhóm | Thư viện |
|---|---|
| Runtime & công cụ build | Node 22 LTS, TypeScript, pnpm, tsx, tsdown |
| MCP | `@modelcontextprotocol/sdk`, `zod` |
| Bridge | `ws`, `chokidar`, `execa` (gọi Aseprite CLI) |
| Xử lý file | `proper-lockfile`, `fflate` (gzip, chạy cả trình duyệt lẫn Node), `sharp` (chỉ Node: decode ảnh ngoài, WebP) |
| Encode ảnh và tài liệu | `fast-png`, `gifenc`, `pdf-lib` |
| Tiện ích | `p-limit`, `commander` (CLI), `pino` |
| Extension Aseprite | Lua, chỉ dùng API scripting có sẵn của Aseprite, không thư viện ngoài |
| Kiểm thử & chất lượng | vitest, biome, dependency-cruiser |

---

## 11. Lỗi & log

| Tình huống | Xử lý |
|---|---|
| Input sai schema | zod báo lỗi → `INVALID`, kèm tên trường sai |
| Art không tồn tại / chưa mở art | `NOT_FOUND`, gợi ý gọi `art_list` hoặc `art_open` |
| Hai tiến trình ghi cùng lúc | `withHead` tự thử lại 3 lần. Vẫn lỗi thì trả `CONFLICT` |
| Provider lỗi hoặc timeout | Thử lại 2 lần, rồi fallback nếu `quality:'free'`. Hết cách thì trả `PROVIDER`, kèm lời khuyên (ví dụ "Cloudflare hết free tier hôm nay; bật local-sd hoặc dùng quality high") |
| Vượt ngân sách | `BUDGET`, kèm số đã tiêu hôm nay và trần |
| Cần xác nhận chi phí | `NEEDS_CONFIRM`, kèm báo giá |
| Doc vi phạm bất biến | Không commit, ghi log `error` kèm diff. Lỗi này là bug, cần sửa code |

Log dạng JSON (pino), xoay vòng theo ngày, giữ 14 ngày. **Không bao giờ ghi API key**; logger có danh sách che các trường nhạy cảm.

---

## 12. Bảo mật

- **Bí mật:**
  - Key chỉ nằm trong `.env`. Không tool nào trả key về cho Claude.
  - `.gitignore` chặn `.env` và `DATA_DIR`.
- **Đường dẫn:**
  - Slug được kiểm bằng regex, mọi đường dẫn được resolve rồi so tiền tố với `DATA_DIR`.
  - `photo_to_pixel` chỉ đọc file ảnh: kiểm tra magic bytes, kích thước ≤ 20MB.
- **Bridge:**
  - Chỉ nghe `127.0.0.1`.
  - **Từ chối mọi Origin của trang web.** Trình duyệt luôn gửi Origin là địa chỉ trang (`http(s)://…`, `file://`, `null`). Bridge chỉ nhận kết nối không có Origin, hoặc có Origin `ws://127.0.0.1:<port>` / `ws://localhost:<port>`, là giá trị mà ixwebsocket trong Aseprite tự gửi (`isLocalClientOrigin`).
  - Token tuỳ chọn, lưu trong `DATA_DIR/bridge.token`.
- **Prompt injection:**
  - Chữ nằm trong ảnh hay trong file chỉ là dữ liệu.
  - Tool không có quyền chạy lệnh shell.
  - Chặn chi phí nằm trong code (`confirm_cost`, ngân sách), nên dù Claude bị dụ cũng không vượt được.

---

## 13. Kiểm thử theo lớp

| Lớp | Cách test | Ví dụ |
|---|---|---|
| `core` | vitest + golden image + property test (fast-check) | RLE: nén rồi giải nén ra đúng như cũ; `normalize` trên ảnh fixture khớp golden; mọi pixel thuộc palette; flood fill không tràn ra ngoài vùng |
| `store` | vitest trên `DATA_DIR` tạm | commit tuần tự; 2 tiến trình (child_process) cùng commit thì đúng 1 bên bị `CONFLICT`; ghi nửa chừng không để lại file hỏng |
| `providers` | Contract test với fixture HTTP ghi sẵn (`msw`) | Cloudflare trả base64 → `RawImage`; 429 → thử lại; `mock` cho kết quả theo seed |
| `tools` | Gọi handler trực tiếp với ctx giả | `undo` không mất lịch sử; `NEEDS_CONFIRM` khi `quality:'high'`; `BUDGET` khi vượt trần |
| `mcp` | Client của MCP SDK, chạy server qua stdio | `listTools` có đủ tool; `art_create` → `canvas_view` trả content ảnh; stdout không có rác |
| `bridge` | WebSocket client giả lập extension, viết bằng Node | Claude sửa → nhận `doc.updated`; gửi `cels` → có version mới; hai bên sửa cùng lúc → rebase không mất pixel; kết nối có `Origin` bị từ chối |
| `integrations/aseprite` | Aseprite CLI (`pnpm aseprite:test`, CI bỏ qua) + kịch bản tay | `doc.json → .aseprite → doc.json` giống hệt; Claude sửa → hiện ngay trong Aseprite; Ctrl+Z trong Aseprite được đồng bộ ngược |
| Chất lượng AI | `pnpm eval` (chạy tay) | ~50 prompt × provider → bảng `gridConfidence`, số màu, độ sạch alpha + ảnh để chấm tay |

---

## 14. Nếu sau này lên SaaS

| Bản cá nhân | Thay bằng khi lên SaaS |
|---|---|
| Claude Code làm chatbot | Vòng lặp agent gọi Claude Messages API trong server, **dùng lại `src/tools`** |
| `squarel-mcp` | Giữ nguyên. Có thể mở thành MCP công khai cho người dùng nâng cao |
| `src/store` (file) | Postgres + R2, **cùng interface `Store`** |
| Bridge + Aseprite | **Editor web tự viết** (giấy phép Aseprite không cho nhúng). Editor web là một client khác của cùng giao thức bridge. Thêm API server nhiều người dùng + đăng nhập (Better Auth) |
| `usage.jsonl` + ngân sách | Credit ledger kiểu Modal |
| `local-sd` trên laptop | GPU service trên Modal/RunPod |

Chi tiết xem [kế hoạch SaaS](plans/2026-11-22-saas-plan.md).
