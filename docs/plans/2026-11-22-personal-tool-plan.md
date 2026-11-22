# Squarel Art (bản cá nhân) — Bộ tool pixel art cắm vào Claude Code + Aseprite

> Ngày lập: 2026-11-22. Thư mục dự án: `D:\code\squarel-art-2`.
> **Trạng thái:** **đã triển khai v0.1** (2026-11-22): P0–P4 và phần lớn P5 (CLI, eval, local-sd, skill). Chưa đóng gói thành plugin Claude Code. Chưa kiểm chứng trên Aseprite thật và API ảnh thật (xem README).
> **Thay đổi 2026-11-22:**
> 1. Bỏ chatbot tự viết. Chuyển sang **MCP server + skill cắm vào Claude Code**.
> 2. Bỏ editor web tự viết. Chuyển sang **Aseprite + extension Lua** đồng bộ hai chiều ([đánh giá](../editor-options.md)).
>
> **Tài liệu liên quan:**
> - [Kiến trúc chi tiết](../architecture.md)
> - [Kế hoạch SaaS](2026-11-22-saas-plan.md) (để dành). Các mục "của bản SaaS" nhắc trong file này đều nằm ở đó.

## 1. Context

Ban đầu dự án định làm SaaS. Bạn đổi sang tool chạy cá nhân vì lo chi phí AI, rồi chọn **cắm thẳng vào Claude Code** thay vì tự xây chatbot. Cuối cùng bạn chọn **dùng Aseprite** để vẽ tay thay vì tự viết editor.

**Mục tiêu:** trên máy của bạn (Windows, i7-10750H, RAM 16GB, GTX 1650 4GB):
- Chat với Claude Code để tạo, sửa và xuất pixel art dùng ngay cho 4 mục đích: game, in ấn/POD, ảnh số/social, mẫu thủ công.
- Khi cần vẽ tay thì mở **Aseprite**. Claude sửa gì cũng hiện ngay trong Aseprite; bạn vẽ gì Claude cũng thấy.

**Lý do của từng lựa chọn:**
- **Claude Code làm chatbot:**
  - Không phải viết chat UI hay vòng lặp agent.
  - Không tốn tiền chat riêng nếu bạn đăng nhập bằng gói Pro/Max. Nếu Claude Code tính tiền theo API thì token vẫn bị tính như thường.
  - Claude Code tự chạy script và xử lý hàng loạt được.
- **Aseprite để vẽ tay:**
  - Công cụ vẽ tốt nhất cho pixel art.
  - Có sẵn chế độ palette chỉ số (indexed), khớp với `PixelDoc`.
  - Được bảo trì tích cực.
  - Tích hợp khoảng 1 tuần, thay vì tự viết editor mất khoảng 2 tuần.

**Giữ từ bản SaaS (phần lõi):**
- `PixelDoc` chỉ dùng màu indexed.
- Bộ chuẩn hoá pixel.
- `ImageProvider` + các adapter.
- Tách lệnh có quy tắc ($0) khỏi lệnh AI.
- AI luôn ra layer mới.
- Mọi thay đổi đều thành version.
- Các preset xuất file.

**Bỏ:**
- Chatbot trong app, API key Claude.
- Editor web tự viết. Chỉ làm khi quay lại hướng SaaS.
- Đăng nhập, credit, thanh toán, server online.

**Coi là thất bại:**
- Ảnh "giả pixel".
- AI ghi đè tác phẩm hoặc làm mất nét vẽ tay.
- Tốn tiền tạo ảnh mà không biết.
- Đốt hết lượt dùng của gói Claude vì ảnh preview quá to.

## 2. Kiến trúc (chi tiết ở [architecture.md](../architecture.md))

```
Claude Code (chat)                         Aseprite + extension "Squarel" (Lua)
   │ MCP stdio                                  │ WebSocket 127.0.0.1:4321
   ▼                                            ▼
src/mcp (MCP server) ── chạy kèm ──► src/bridge (bridge server: WebSocket + theo dõi file)
   └──────────────┬─────────────────────────────┘
                  ▼
   src/tools  ← LỚP TOOL DÙNG CHUNG (MCP, CLI, bridge cùng gọi)
      ├─ src/core       pixel-core (TS thuần)
      ├─ src/providers  cloudflare · retrodiffusion · local-sd · mock
      └─ src/store      DATA_DIR, version, khoá file, nhật ký chi phí
                  ▼
DATA_DIR/projects/<slug>/…  (mặc định D:\SquarelArt-data)
```

**Bridge chạy ở đâu:**
- Bridge được bật **ngay trong tiến trình `squarel-mcp`** nếu cổng 4321 còn trống. Mở Claude Code là Aseprite kết nối được luôn.
- Muốn vẽ trong Aseprite mà không mở Claude Code thì chạy riêng `pnpm bridge`.

**Cấu trúc repo** (1 `package.json`, TypeScript, pnpm):
```
src/core/        PixelDoc, RLE, grid-detect, downsample, quantize OKLab, palette-map, dither, outline, bg-remove, diff/patch, encoders PNG/GIF/SVG/PDF
src/providers/   ImageProvider interface, router, adapters, ngân sách
src/store/       project/version/proposal trên file, khoá file, usage.jsonl
src/tools/       định nghĩa tool dùng chung (zod) + handler
src/mcp/         MCP server stdio (@modelcontextprotocol/sdk)
src/bridge/      WebSocket server (ws) + chokidar + gọi Aseprite CLI
src/cli/         CLI `squarel`
src/shared/      zod schemas, palette presets, bảng màu hạt Perler/Hama
integrations/aseprite/squarel/   extension Aseprite (package.json, plugin.lua, bridge.lua, sync.lua, codec.lua)
integrations/aseprite/cli/       script Lua chạy ở chế độ batch: doc.json ↔ .aseprite
.claude/skills/pixel-art/SKILL.md
.mcp.json
services/local-sd/  (tuỳ chọn) Python FastAPI + diffusers
evals/, docs/
```

## 3. Cắm vào Claude Code

**MCP server:** khai báo trong `.mcp.json` ở gốc repo, chạy bằng `node --import tsx src/mcp/index.ts`. Gọi thẳng `node` để tránh phải bọc `cmd /c` trên Windows.

**Biến môi trường (`.env`):**

| Biến | Dùng để làm gì |
|---|---|
| `DATA_DIR` | Thư mục lưu dữ liệu |
| `IMAGE_PROVIDER` | Provider mặc định: `cloudflare`, `local-sd` hoặc `mock` |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Tạo ảnh qua Cloudflare Workers AI |
| `RETRO_DIFFUSION_API_KEY` | Tạo ảnh chất lượng cao (tuỳ chọn) |
| `IMAGE_DAILY_BUDGET_USD` | Trần chi phí ảnh mỗi ngày, mặc định $1 |
| `ASEPRITE_PATH` | Đường dẫn file chạy Aseprite, ví dụ `C:\Program Files\Aseprite\Aseprite.exe` |
| `BRIDGE_PORT` | Cổng của bridge, mặc định 4321 |

**Skill `pixel-art`** dạy Claude Code quy trình làm việc:
- Luôn gọi `canvas_view` trước khi sửa và sau khi sửa.
- Ưu tiên lệnh có quy tắc.
- Kích thước và palette nên dùng cho từng mục đích.
- **Hỏi bạn trước khi dùng provider tốn tiền.**
- Muốn bạn vẽ tay thì gọi `open_in_editor`.
- Có checklist trước khi xuất file.

**Lệnh tắt:** `/pixel-new`, `/pixel-from-photo`, `/pixel-export`.

**Đóng gói plugin (P5):** gộp MCP server, skill và file extension Aseprite.

## 4. Danh mục tool (MCP)

Mọi tool đều trả về text tóm tắt. Tool sửa ảnh trả thêm ảnh preview: mặc định 256px, tối đa 512px, phóng to bằng nearest-neighbor, có tuỳ chọn hiện lưới và toạ độ.

| Nhóm | Tool |
|---|---|
| Project | `project_list` · `project_create` · `project_open` · `project_info` |
| Xem | `canvas_view` → ảnh PNG · `palette_view` |
| Vẽ trực tiếp | `draw_pixels{ops: set·line·rect·ellipse·fill}` · `layer_add/remove/merge/reorder/set` |
| Có quy tắc ($0) | `recolor` · `apply_palette` · `reduce_colors` · `add_outline` · `remove_background` · `resize_canvas` · `scale` · `flip` · `rotate90` · `crop_to_content` · `shift_hue` |
| Ảnh → pixel ($0) | `photo_to_pixel{path,width,palette?,colors?}` |
| AI ảnh | `generate_image` · `edit_image` → đề xuất + bảng ghép biến thể · `accept_variant` → **layer mới** · `discard_proposal` |
| Lịch sử | `history` · `undo` (tạo version mới, không mất lịch sử) · `restore_version` |
| **Editor** | **`open_in_editor{project?}`**: mở hoặc chuyển tới project đó trong Aseprite (mục 6) |
| Xuất file | `export_presets` · `export{preset,options}` |
| Chi phí | `usage_today` |

**Bảo vệ chi phí:**
- `quality:'high'` (Retro Diffusion) từ chối chạy nếu thiếu `confirm_cost:true`. Lần gọi đầu tool trả về báo giá, để Claude hỏi bạn trước.
- Chạm `IMAGE_DAILY_BUDGET_USD` thì tool từ chối và báo rõ lý do.

## 5. Claude Code và Aseprite dùng chung project

**`src/store` là nơi duy nhất ghi file.** Mọi thay đổi đều thành một version có nhãn. Nguồn của version là một trong `claude` | `editor` | `ai` | `cli`. Lịch sử không bao giờ bị ghi đè.

**Khi Claude sửa:**
1. Bridge gửi doc mới sang Aseprite.
2. Extension thay layers/cels trong **một transaction** có tên "Claude: …". Nhờ vậy Ctrl+Z trong Aseprite hoàn tác được thay đổi của Claude, và lần undo đó cũng được đồng bộ ngược về.

**Khi bạn vẽ trong Aseprite:**
1. Extension chờ ~500ms sau nét vẽ cuối, rồi gửi các cel hiện tại kèm `baseVersion`.
2. Bridge so với version gốc để tính ra **patch pixel**, sau đó **rebase** lên head mới nhất rồi commit.
3. Nếu trong lúc đó Claude cũng vừa sửa, bridge trả về doc đã gộp và extension áp lại. **Không mất nét nào của cả hai bên.**

**Kết quả AI** được Accept qua chat ("lấy biến thể 2") và hiện trong Aseprite dưới dạng layer mới "AI: …".

## 6. Aseprite + extension "Squarel"

**Cài đặt:**
1. Mua Aseprite ($19.99) hoặc tự build cho cá nhân.
2. `pnpm aseprite:pack` tạo ra file `squarel.aseprite-extension`.
3. Nhấp đúp file đó để cài.

**Menu `Squarel` trong Aseprite:**
- Kết nối / Ngắt
- Mở project…
- Đồng bộ ngay
- Xuất file… (gọi tool `export` qua bridge)
- Lịch sử… (quay lại version)

**Tự kết nối khi Aseprite mở.** Mỗi sprite được gắn với project của nó qua `sprite.properties("squarel")`, lưu `slug` và `baseVersion`.

**`open_in_editor`:**
- Nếu extension đang kết nối: gửi lệnh mở hoặc chuyển tới project đó.
- Nếu chưa: tạo `work.aseprite` bằng Aseprite CLI (script Lua ở chế độ batch), rồi mở Aseprite với file đó. Extension tự kết nối sau khi Aseprite mở.

**Chế độ dự phòng khi extension chưa cài hoặc bị lỗi** — trao đổi qua file:
1. Bạn bấm Save `work.aseprite`.
2. Bridge thấy file đổi, gọi Aseprite CLI đọc file ra `doc.json`.
3. Bridge tính patch, rebase rồi commit.

Hạn chế: Claude sửa thì Aseprite không tự tải lại, bạn phải mở lại file.

**Tuỳ chọn (P5):** trang xem trước chỉ đọc (canvas + lưới đề xuất AI) do bridge phục vụ, mở được trong khung Browser của app Claude.

**Bước đầu bắt buộc: spike 1 ngày** để kiểm chứng API Lua của Aseprite:
- `WebSocket` client;
- sự kiện `sprite.events` khi sprite thay đổi;
- ghi chỉ số vào ảnh INDEXED (`Image`), có đủ nhanh không;
- `app.transaction`;
- `properties`;
- chạy batch `aseprite -b --script`.

Nếu thiếu thứ gì thì phương án thay thế là chỉ dùng chế độ trao đổi qua file, hoặc chuyển sang Pixelorama.

## 7. Lưu trữ (file thường, dễ backup bằng OneDrive/Google Drive)

```
DATA_DIR/
  inbox/                    thả ảnh chụp/ảnh tham chiếu vào đây
  logs/                     mcp.log, bridge.log
  projects/<slug>/
    project.json            tên, mục đích, version hiện tại
    versions/               index.jsonl + v000123.json.gz (snapshot PixelDoc kèm nhãn, nguồn)
    proposals/<id>/         biến thể AI (PNG gốc + đã chuẩn hoá + meta + sheet.png)
    assets/                 ảnh tham chiếu, ảnh gốc từ provider
    exports/                file đã xuất
    work.aseprite           file làm việc cho chế độ trao đổi qua file (sinh tự động)
    .lock
  usage.jsonl               mỗi lần gọi provider ảnh 1 dòng
```

## 8. AI ảnh — ưu tiên miễn phí

| Provider | Dùng cho | Chi phí |
|---|---|---|
| **cloudflare** (Workers AI, FLUX.1-schnell; img2img/inpainting nếu có) | Mặc định cho tạo ảnh và sửa ảnh | Free 10.000 neuron/ngày. Mình ước tính ~230 ảnh 512px/ngày |
| **retrodiffusion** (tuỳ chọn) | `quality:'high'`: pixel art chuẩn, ép palette, animation, tileset | `rd-fast` khoảng $0.03/ảnh, luôn hỏi trước |
| **local-sd** (tuỳ chọn) | Chạy offline trên GTX 1650 (SD1.5 + LoRA pixel art) | $0, mất 20–60 giây/ảnh |
| **mock** | Lúc code và test | $0 |

Mọi ảnh, từ provider nào, đều qua **bộ chuẩn hoá pixel**:
1. dò lưới;
2. lấy màu xuất hiện nhiều nhất (mode) trong mỗi ô;
3. ép palette trong OKLab;
4. làm sạch alpha.

Kết quả kèm `gridConfidence`. Nếu chỉ số thấp, tool tự thử lại một lần.

## 9. Xuất file
Giống mục 4.5 của bản SaaS:
- **Game:** PNG, scale, sprite sheet + JSON kiểu Aseprite, GIF.
- **In ấn:** 300 DPI, SVG, PDF.
- **Social:** avatar, emoji, sticker WebP, GIF/APNG.
- **Thủ công:** PDF mẫu hạt Perler/Hama, có đếm số hạt.

File được ghi vào `exports/`. Xuất được từ chat, hoặc từ menu Squarel trong Aseprite.

## 10. Lộ trình (1 người + AI hỗ trợ, ước lượng)

| Giai đoạn | Thời gian | Nội dung | Xong khi |
|---|---|---|---|
| **P0 Khung** | 2–3 ngày | Repo, biome + vitest, `PixelDoc` + RLE + encode PNG, `src/store`, MCP server với `project_create` / `project_open` / `canvas_view`, `.mcp.json` | Trong Claude Code: "tạo canvas 32×32" → Claude thấy được ảnh |
| **P1 Tool lõi** | ~1–1,5 tuần | `draw_pixels`, layers, lệnh có quy tắc, history/undo, xuất PNG/scale, `photo_to_pixel`, skill `pixel-art` v1 | Tạo, sửa, xuất **chỉ bằng chat** |
| **P2 AI ảnh** | ~1,5 tuần | Adapter mock/cloudflare/retrodiffusion, `normalize()`, proposals + Accept vào layer mới, ngân sách + `confirm_cost`, `usage_today`, `evals/` | "Tạo hiệp sĩ 32×32" → các biến thể sạch → "lấy số 2" → layer mới |
| **P3 Nối Aseprite** | ~1 tuần | Spike 1 ngày → script batch `doc.json ↔ .aseprite` → `open_in_editor` + chế độ trao đổi qua file → extension Lua + bridge WebSocket đồng bộ trực tiếp | Vẽ trong Aseprite và Claude sửa xen kẽ trên cùng project, không mất nét nào; Ctrl+Z trong Aseprite hoàn tác được thay đổi của Claude |
| **P4 Xuất file 4 mục đích** | ~1 tuần | Các preset ở mục 9, `/pixel-export`, menu Xuất trong Aseprite | File mở được bằng Aseprite/Inkscape, đúng DPI, đếm đúng số hạt |
| **P5 Đóng gói & mở rộng** | sau | Plugin Claude Code, CLI `squarel`, trang xem trước, local-sd trên GTX 1650, animation | Khi cần |

Tổng cộng khoảng **4–5 tuần** bán thời gian. Dùng được thật bằng chat từ cuối P1, khoảng tuần thứ 2.

## 11. Chi phí

| Hạng mục | Chi phí |
|---|---|
| Aseprite | **$19.99 một lần**, hoặc $0 nếu tự build từ source để dùng cá nhân |
| Chat | Nằm trong gói Claude của bạn (có giới hạn lượt theo khung giờ). Ảnh preview tốn lượt, nên mặc định để nhỏ |
| Tạo/sửa ảnh qua Cloudflare free tier | **$0** nếu dưới ~230 ảnh/ngày |
| Retro Diffusion (tuỳ chọn) | Khoảng $0.03/ảnh, luôn hỏi trước |
| Hạ tầng | **$0** |

## 12. Tài liệu
- `README.md`: cài đặt, thêm MCP vào Claude Code, cài extension Aseprite, lấy key, backup `DATA_DIR`.
- `docs/architecture.md`, `docs/editor-options.md`.
- `docs/aseprite.md`: cài extension, menu Squarel, chế độ dự phòng, xử lý sự cố.
- `docs/tools.md`: tự sinh từ schema zod.
- `docs/pixel-pipeline.md`, `docs/providers.md`, `docs/export-presets.md`.
- `.claude/skills/pixel-art/SKILL.md`.
- `docs/plans/`.

## 13. Kiểm chứng
- **pixel-core:** golden-image test + property test (mọi pixel thuộc palette, số màu ≤ N, alpha chỉ 0/255). Thêm test diff/patch/rebase.
- **tools:** gọi thẳng handler với một `DATA_DIR` tạm. Phải chứng minh được:
  - version được tạo đúng;
  - undo không mất lịch sử;
  - đổi `baseVersion` thì tool đọc lại bản mới;
  - `confirm_cost` chặn được provider tốn tiền.
- **MCP:** client của MCP SDK chạy server qua stdio: liệt kê tool, gọi `project_create` → `canvas_view` trả về ảnh.
- **Bridge:** test bằng một WebSocket client giả lập extension, viết bằng Node:
  - Claude sửa → client nhận `doc.updated`;
  - client gửi cel → có version mới;
  - hai bên sửa cùng lúc → rebase không mất pixel.
- **Aseprite:**
  - Chỉ chạy trên máy có Aseprite, CI bỏ qua: chuyển `doc.json → .aseprite → doc.json` qua CLI và kết quả phải giống hệt ban đầu.
  - Kịch bản tay:
    1. mở project trong Aseprite;
    2. Claude "thêm viền đen" → hiện ngay;
    3. vẽ thêm → Claude `canvas_view` thấy nét mới;
    4. Ctrl+Z trong Aseprite → Claude thấy đã hoàn tác.
- **Kịch bản đầy đủ trong Claude Code** (provider mock):
  1. tạo hiệp sĩ 32×32;
  2. lấy biến thể;
  3. thêm viền;
  4. undo;
  5. xuất sprite sheet + PNG 300 DPI + PDF mẫu hạt;
  6. kiểm tra file bằng Aseprite, Inkscape và exiftool.
- **`pnpm eval`** (chạy tay) để so sánh chất lượng ảnh giữa các provider.

## 14. Để lại cho lúc build
- Kết quả spike Aseprite (mục 6) quyết định có làm đồng bộ trực tiếp ngay ở P3 hay chỉ trao đổi qua file trước.
- Model img2img/inpainting cụ thể trên Workers AI.
- Thuật toán dò lưới chi tiết.
- Kích thước preview mặc định.

## 15. Nếu sau này quay lại làm SaaS
- `src/tools` giữ nguyên.
- Thêm vòng lặp agent gọi Claude Messages API.
- `src/store` đổi từ file sang Postgres + R2.
- **Phải viết editor web** vì giấy phép không cho nhúng Aseprite. Có thể dùng lại giao thức bridge: editor web chỉ là một client khác của cùng giao thức đó.
- Chi tiết xem [kế hoạch SaaS](2026-11-22-saas-plan.md).
