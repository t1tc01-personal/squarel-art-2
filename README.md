# Squarel Art

Bộ công cụ pixel art cắm vào **Claude Code**. Bạn chat để tạo, sửa và xuất ảnh pixel art, rồi vẽ tay trong **Aseprite**. Hai bên tự đồng bộ với nhau.

- **Hơn 40 tool MCP:**
  - vẽ trực tiếp;
  - lệnh có quy tắc, miễn phí và chính xác: đổi màu, viền, palette, giảm màu, xoá nền, lật, xoay, cắt, scale;
  - ảnh chụp → pixel art;
  - AI tạo, sửa và làm animation;
  - lịch sử và undo không mất dữ liệu;
  - xuất file.
- **Mọi ảnh AI đều qua bộ chuẩn hoá pixel:** dò lưới → mỗi ô lấy màu xuất hiện nhiều nhất → ép palette trong OKLab → nền trong suốt. Kết quả luôn là pixel art thật.
- **AI không bao giờ ghi đè.** Kết quả AI là một đề xuất gồm các biến thể đánh số. Bạn chọn thì nó được thêm thành layer mới.
- **Xuất file dùng ngay:**
  - sprite sheet + JSON kiểu Aseprite, GIF;
  - PNG in 300 DPI, SVG, PDF;
  - avatar, emoji, sticker WebP;
  - mẫu hạt Perler/Hama có đếm số hạt và chia theo bảng ghim.
- **Chi phí:**
  - Chat nằm trong gói Claude của bạn.
  - Ảnh AI mặc định dùng Cloudflare Workers AI free tier, hoặc GPU của máy, hoặc `mock`.
  - Retro Diffusion là dịch vụ trả phí: luôn báo giá và chờ bạn đồng ý, kèm trần chi phí mỗi ngày.

## So với dùng MCP Aseprite trực tiếp

Đã có nhiều MCP server cộng đồng cho Aseprite, ví dụ [diivi/aseprite-mcp](https://github.com/diivi/aseprite-mcp), [rkdfx/aseprite-mcp](https://github.com/rkdfx/aseprite-mcp), [pixel-mcp](https://pkg.go.dev/github.com/willibrandon/pixel-mcp) và [aseprite-live-mcp](https://socket.dev/pypi/package/aseprite-live-mcp). Chúng cho **Claude điều khiển Aseprite**: tạo canvas, vẽ, xuất file qua script Lua.

Squarel thì **lo cả quy trình làm ra sản phẩm**. Aseprite chỉ là nơi để bạn vẽ tay.

| | MCP Aseprite | Squarel |
|---|---|---|
| **Tạo hình** | Claude tự đặt từng pixel theo toạ độ. Ổn với hình đơn giản, khó ra một nhân vật đẹp | AI tạo/sửa ảnh, rồi tự **ép về lưới pixel thật và đúng palette**. Có cả ảnh chụp → pixel art |
| **AI có ghi đè tác phẩm không** | Claude sửa thẳng vào file | AI chỉ đưa ra phương án, bạn chọn thì mới thêm thành **layer mới**. Mọi bước có version và undo được |
| **Bạn và Claude cùng sửa** | Claude ghi file lúc bạn đang mở trong Aseprite thì dễ ghi đè lẫn nhau | Đồng bộ trực tiếp hai chiều. Sửa cùng lúc thì **gộp lại, không mất nét nào** |
| **Xuất file thành phẩm** | Những gì Aseprite xuất được: PNG, GIF, sprite sheet | Thêm PNG in 300 DPI, **SVG vector, PDF, mẫu hạt Perler/Hama có đếm hạt**, sticker WebP, avatar/emoji đúng kích cỡ |
| **Chi phí AI** | Không áp dụng | Báo giá trước, chờ bạn đồng ý, có trần chi phí mỗi ngày |
| **Claude "nhìn" ảnh** | Tuỳ từng dự án | Ảnh xem trước phóng to, có lưới và số toạ độ, nên Claude chỉ đúng chỗ cần sửa |
| **Không có Aseprite** | Không chạy được | Vẫn chạy với Claude Code hoặc dòng lệnh. Aseprite không bắt buộc |

**Squarel kém hơn ở đâu:**
- **Chỉ dùng một phần tính năng Aseprite.** Squarel chỉ có màu indexed (tối đa 256 màu) và canvas tối đa 256×256. Nó không có layer nhóm, tilemap, tag animation, slice hay blend mode. MCP Aseprite cho Claude dùng hết các tính năng đó.
- **Nhiều bộ phận hơn:** bridge, extension, kho lưu riêng.
- **Hai bản dữ liệu:** kho Squarel là bản chính. Những gì Squarel không biểu diễn được (tag, slice…) mà bạn tạo trong Aseprite sẽ không được lưu.
- **Dự án mới,** chưa được dùng thực tế nhiều bằng các MCP kia.

**Nên chọn cái nào:**
- Chỉ cần Claude **tự động hoá việc trong Aseprite** (xuất hàng loạt, đổi kích thước, đặt tag animation): MCP Aseprite đơn giản hơn.
- Cần **chat để tạo, sửa rồi xuất pixel art thành sản phẩm** (in áo, sticker, mẫu hạt, asset game) mà AI không phá tác phẩm: dùng Squarel.

Hai cái dùng chung được: cài thêm một MCP Aseprite bên cạnh Squarel cho những việc Squarel không làm.

## Yêu cầu

- Node.js ≥ 22.18 (đã thử với Node 24) và pnpm.
- Claude Code.
- Tuỳ chọn:
  - Aseprite 1.3+ (để vẽ tay);
  - tài khoản Cloudflare (tạo ảnh miễn phí);
  - key Retro Diffusion;
  - Python + GPU NVIDIA (cho [services/local-sd](services/local-sd/README.md)).

## Cài đặt

Lần đầu cài, hoặc cần lấy key Cloudflare / cài Aseprite: làm theo **[hướng dẫn từng bước](docs/setup.md)**. Tóm tắt:

```powershell
pnpm install
```

```powershell
Copy-Item .env.example .env
```

Mở `.env` và điền các biến:

| Biến | Ý nghĩa |
|---|---|
| `DATA_DIR` | Nơi lưu project. Ví dụ `D:\SquarelArt-data`. Nên để trong thư mục OneDrive hoặc Google Drive để được backup |
| `IMAGE_PROVIDER` | `cloudflare` (mặc định), `local-sd` hoặc `mock` (không cần mạng, dùng để thử) |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Dashboard Cloudflare → AI → Workers AI → *Use REST API*. Token cần quyền Workers AI |
| `RETRO_DIFFUSION_API_KEY` | Tuỳ chọn. Chỉ dùng khi bạn chọn `quality: "high"` |
| `IMAGE_DAILY_BUDGET_USD` | Trần chi phí ảnh trả phí mỗi ngày (mặc định 1) |
| `ASEPRITE_PATH` | Ví dụ `C:\Program Files\Aseprite\Aseprite.exe` |

Kiểm tra mọi thứ:

```powershell
pnpm check
```

## Dùng với Claude Code

Mở Claude Code **trong thư mục repo này**. File `.mcp.json` khai báo sẵn server `squarel`. Lần đầu, Claude Code sẽ hỏi bạn có cho phép server này không.

Các skill trong `.claude/skills/` dạy Claude quy trình làm việc. Ví dụ những câu bạn có thể nói:

- "/pixel-new một hiệp sĩ 32×32 cho game, palette PICO-8"
- "thêm viền đen", "đổi áo sang xanh", "giảm còn 8 màu", "undo"
- "/pixel-from-photo meo.jpg làm avatar 48px" (thả ảnh vào `DATA_DIR\inbox`)
- "/pixel-export in lên áo khổ 30cm" hoặc "xuất mẫu hạt Hama"

Muốn dùng server này ở dự án khác:

```powershell
claude mcp add squarel --scope user -- node D:\code\squarel-art-2\src\mcp\index.ts
```

## Vẽ tay trong Aseprite

1. Đóng gói extension:

   ```powershell
   pnpm aseprite:pack
   ```

2. Nhấp đúp file `squarel.aseprite-extension` vừa tạo để cài vào Aseprite.
3. Mở Claude Code. MCP server bật sẵn bridge ở `ws://127.0.0.1:4321/bridge`. Muốn vẽ mà không mở Claude Code thì chạy bridge riêng:

   ```powershell
   pnpm bridge
   ```

4. Trong Aseprite, dùng menu **File → Squarel → Open project…**, hoặc bảo Claude "mở trong Aseprite".

Claude sửa gì cũng hiện ngay trong Aseprite, gộp thành một bước undo. Bạn vẽ gì sẽ được gửi về sau 0,5 giây và Claude thấy được. Khi hai bên sửa cùng lúc, hệ thống gộp lại và không mất nét nào. Chi tiết ở [docs/aseprite.md](docs/aseprite.md).

## CLI

```powershell
pnpm cli tools
```

```powershell
pnpm cli project_create --name "Test" --width 32 --height 32
```

```powershell
pnpm cli export --project test --preset print-png --options '{\"widthMm\":200}'
```

## Lệnh phát triển

| Lệnh | Việc |
|---|---|
| `pnpm test` | Toàn bộ test (vitest): lõi, store đa tiến trình, provider, tool, MCP qua stdio, bridge WebSocket, extension Lua trên fengari |
| `pnpm typecheck` / `pnpm lint` | TypeScript / Biome |
| `pnpm check` | Cả ba lệnh trên |
| `pnpm mcp` | Chạy MCP server bằng tay (để debug) |
| `pnpm eval -- --provider mock` | Đánh giá chất lượng ảnh AI. Với provider thật cần `--yes` |
| `pnpm aseprite:build` | Tự build Aseprite từ source vào `vendor/` (dùng cá nhân) và ghi `ASEPRITE_PATH`. Thêm `-- --check` để chỉ kiểm tra công cụ, `-- --install-deps` để cài VS Build Tools |
| `pnpm aseprite:test` | Thử chuyển đổi thật qua Aseprite CLI (cần `ASEPRITE_PATH`) |
| `pnpm docs:tools` | Sinh lại [docs/tools.md](docs/tools.md) |

## Tài liệu

- [Cài đặt từng bước](docs/setup.md) · [Kiến trúc](docs/architecture.md) · [Kế hoạch](docs/plans/2026-11-22-personal-tool-plan.md) · [Kế hoạch SaaS (để dành)](docs/plans/2026-11-22-saas-plan.md)
- [Danh mục tool](docs/tools.md) · [Aseprite](docs/aseprite.md) · [Provider ảnh](docs/providers.md) · [Chuẩn hoá pixel](docs/pixel-pipeline.md) · [Preset xuất file](docs/export-presets.md)

## Giấy phép

Squarel Art dùng giấy phép **[PolyForm Shield 1.0.0](LICENSE.md)**.

**Được làm:**
- dùng miễn phí cho cá nhân, công việc hay công ty;
- bán sản phẩm làm ra bằng nó (sprite cho game, áo in, sticker…);
- sửa code cho mình dùng;
- chia sẻ lại, miễn là kèm giấy phép này.

**Không được làm:** dùng code này để làm hoặc cung cấp một sản phẩm **cạnh tranh** với Squarel Art, dù bán hay cho miễn phí. Ví dụ: đổi tên rồi phát hành lại, hoặc dựng một dịch vụ tạo pixel art bằng AI dựa trên code này.

**Lưu ý:**
- Giấy phép bảo vệ **code và tài liệu**, không bảo vệ được **ý tưởng**. Người khác vẫn có thể tự viết một công cụ tương tự từ đầu.
- Đây không phải giấy phép "open source" theo định nghĩa OSI. Nó là giấy phép "source-available": công khai code nhưng có giới hạn.
- Thư viện bên thứ ba vẫn theo giấy phép riêng của chúng. Aseprite theo EULA riêng: chỉ tự build để dùng cá nhân.
- Phần này chỉ là tóm tắt, không phải tư vấn pháp lý. Văn bản trong [LICENSE.md](LICENSE.md) là bản có hiệu lực.

## Cấu trúc

```
src/core        thuật toán pixel (TS thuần, không I/O)
src/store       lưu project/version/proposal trên file, khoá giữa các tiến trình
src/providers   Cloudflare · Retro Diffusion · local-sd · mock, router + ngân sách
src/tools       ~41 tool dùng chung (MCP, CLI, bridge)
src/mcp         MCP server stdio
src/bridge      WebSocket bridge + theo dõi file cho Aseprite
src/cli         CLI
integrations/aseprite   extension Lua + script batch
services/local-sd       service Python (tuỳ chọn)
.claude/skills          skill cho Claude Code
```
