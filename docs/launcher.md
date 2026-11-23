# Squarel Art Launcher

Launcher là một app Windows (Electron) để cài, chạy và theo dõi Squarel mà không cần gõ lệnh. Squarel vẫn chạy đủ khi không có launcher: launcher chỉ gọi đúng những lệnh mà [hướng dẫn cài đặt](setup.md) bảo bạn gõ.

**Launcher làm gì:**
- Cài Squarel và công cụ nền (Git, Node, pnpm) qua `winget`. Bạn luôn thấy lệnh và tự bấm "Cài".
- Ghi `.env` của Squarel qua màn hình Cài đặt. Khoá API bị che.
- Đăng ký server `squarel` với Claude Code, chép skill, chạy thử MCP.
- Giữ bridge (`ws://127.0.0.1:4321/bridge`) khi chưa có ai giữ, và hiện ai đang kết nối.
- Mở Aseprite và các tích hợp khác, cài extension, build Aseprite từ source.
- Health check mỗi 10 phút khi đang mở.
- Cập nhật: launcher tự cập nhật từ GitHub Release, rồi đưa Squarel lên đúng tag cùng phiên bản.

## Tải và cài

1. Vào trang [Releases](https://github.com/t1tc01-personal/squarel-art-2/releases), tải `Squarel-Art-Launcher-Setup-X.Y.Z.exe`.
2. Chạy file. Bộ cài **không ký số**, nên lần đầu Windows SmartScreen sẽ chặn: bấm **More info → Run anyway**.
3. Bộ cài hỏi thư mục cài. Mặc định cài cho riêng tài khoản của bạn, không cần quyền admin.
4. Mở **Squarel Art Launcher** từ Start menu. Lần đầu launcher chạy wizard 4 bước.

## Wizard lần đầu

| Bước | Việc |
|---|---|
| 1. Chào mừng | Chọn **Cài mới** (launcher clone Squarel vào `%LOCALAPPDATA%\SquarelArt\app`) hoặc **Dùng repo đã clone** (trỏ vào thư mục có `package.json` tên `squarel-art`). Chọn `DATA_DIR` |
| 2. Cài công cụ | Kiểm tra Git, Node ≥ 22.18, pnpm. Thiếu thì cài bằng `winget` trong một cửa sổ terminal: Windows hỏi quyền admin, winget hỏi điều khoản, bạn tự trả lời. Sau đó clone (nếu cài mới) và `pnpm install` |
| 3. Cấu hình | Ghi `.env`, kiểm tra token Cloudflare (miễn phí), chọn tích hợp. Aseprite: build, đã có, hoặc bỏ qua |
| 4. Kết nối Claude | `claude mcp add squarel --scope user …`, chép skill vào `~/.claude/skills`, chạy thử MCP, cài extension của tích hợp đã chọn |

Đóng wizard giữa chừng thì lần sau mở lại đúng bước đó.

Máy **không có winget** (Windows LTSC, máy công ty, Windows Sandbox): wizard hiện bước "Cài App Installer" với nút mở Microsoft Store, kèm link bộ cài chính thức của Git và Node. Cài xong bấm "Kiểm tra lại". Launcher không tự tải và chạy file cài.

Claude Code: nếu chưa có, launcher mở bộ cài chính thức trong cửa sổ PowerShell để bạn xem. Sau đó chạy `claude` một lần để đăng nhập. Launcher không đăng nhập thay bạn.

## Các màn hình

Ảnh chụp thiết kế nằm trong [`docs/launcher/screens/`](launcher/screens/).

| Màn hình | Có gì | Ảnh |
|---|---|---|
| Trang chủ | Nút mở nhanh các công cụ, project gần đây, panel **Kết nối** (bridge, Aseprite, phiên Claude Code) | [app-home](launcher/screens/app-home.png) |
| Thư viện tích hợp | Mọi tích hợp đọc từ `integrations/*/integration.json`, bật/tắt, cài | [app-library](launcher/screens/app-library.png) |
| Trang tích hợp (vd. Aseprite) | Tổng quan, Cập nhật, Health check, Cài đặt của riêng tích hợp | [app-tool-aseprite](launcher/screens/app-tool-aseprite.png) |
| Hệ thống | Tab **Thành phần** (phiên bản, cập nhật), **Health check**, **Nhật ký** | [app-system](launcher/screens/app-system.png), [tab-health](launcher/screens/tab-health.png), [tab-logs](launcher/screens/tab-logs.png) |
| Cài đặt | Ghi vào `.env` của Squarel và tuỳ chọn của launcher | [tab-settings](launcher/screens/tab-settings.png) |
| Wizard | 4 bước ở trên | [setup-1](launcher/screens/setup-1-welcome.png) · [2](launcher/screens/setup-2-tools.png) · [3](launcher/screens/setup-3-config.png) · [4](launcher/screens/setup-4-claude.png) |

**Khay hệ thống:** bấm trái mở launcher. Bấm phải có menu mở nhanh công cụ và **Thoát**. "Thoát" chỉ dừng bridge mà chính launcher đang giữ.

## Cài đặt

| Mục | Ghi vào | Ghi chú |
|---|---|---|
| Thư mục dữ liệu | `DATA_DIR` trong `.env` | Project, lịch sử, log. Nên để trong OneDrive để tự backup |
| Ảnh AI | `IMAGE_PROVIDER`, `CLOUDFLARE_*`, `LOCAL_SD_URL`, `RETRO_DIFFUSION_API_KEY`, `IMAGE_DAILY_BUDGET_USD` | Khoá hiện dạng che |
| Aseprite | `ASEPRITE_PATH` | Chỉ hiện khi bật tích hợp Aseprite |
| Cổng bridge | `BRIDGE_PORT` | Mặc định 4321. Đổi cổng thì launcher tự khởi động lại bridge |
| Thu xuống khay khi đóng cửa sổ | `state.json` | Giữ bridge chạy để Aseprite vẫn đồng bộ |
| Khởi động cùng Windows | `state.json` + mục khởi động của Windows | Mở launcher ẩn dưới khay khi đăng nhập |

Nút **Mở file .env** mở thư mục chứa `.env` để bạn sửa bằng tay. Launcher giữ nguyên chú thích và thứ tự dòng.

## Dữ liệu nằm ở đâu

| Nơi | Có gì |
|---|---|
| `%APPDATA%\SquarelArt Launcher\state.json` | Đường dẫn Squarel, chế độ cài, bước wizard, tích hợp đã chọn, tuỳ chọn khay/khởi động |
| `%APPDATA%\SquarelArt Launcher\logs\` | Log của launcher (`launcher-YYYY-MM-DD.log`), tự xoá log cũ. Khoá API bị che |
| `%APPDATA%\SquarelArt Launcher\integrations\` | Tích hợp riêng của bạn (ngoài repo) |
| `%LOCALAPPDATA%\SquarelArt\app` | Squarel khi chọn **Cài mới** |
| `%LOCALAPPDATA%\SquarelArt\tools\<id>` | Source và bản build công cụ, ví dụ Aseprite |
| `.env` trong thư mục Squarel | Cấu hình Squarel. Đây vẫn là nguồn sự thật duy nhất |
| `DATA_DIR` | Project, version, log của Squarel |

Gỡ launcher (Settings → Apps) **không** xoá các thư mục trên. Muốn xoá sạch thì xoá tay.

## Chạy từ source

Launcher nằm trong `launcher/`, có `package.json` riêng, không thuộc workspace gốc. Người chỉ dùng Squarel không phải tải Electron.

```powershell
pnpm --dir launcher install
```

```powershell
pnpm --dir launcher dev
```

**Clone mới:** pnpm 11 chặn script cài đặt của thư viện nếu chưa được cho phép. `launcher/pnpm-workspace.yaml` đã có `allowBuilds` cho `electron` (tải file chạy Electron) và `esbuild`. Nếu `pnpm install` vẫn báo `Ignored build scripts: electron`, hoặc `pnpm dev` báo "Electron failed to install correctly", chạy:

```powershell
pnpm --dir launcher approve-builds
```

Chọn `electron`, rồi chạy lại `pnpm --dir launcher install`.

| Lệnh (trong `launcher/`) | Việc |
|---|---|
| `pnpm dev` | Chạy launcher có hot reload |
| `pnpm check` | Typecheck + Biome + unit test (vitest) |
| `pnpm build` | Build vào `out/` |
| `pnpm e2e` | Test giao diện (Playwright cho Electron). Cần `pnpm build` trước |
| `pnpm dist` | Build bộ cài vào `dist/`, xem [docs/release.md](release.md) |

Chạy từ source thì launcher lấy phiên bản trong `launcher/package.json` và **không** tự đổi tag của repo.

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| SmartScreen chặn bộ cài | Bấm **More info → Run anyway**. Bộ cài chưa ký số |
| Wizard báo không có `winget` | Cài **App Installer** từ Microsoft Store, hoặc cài Git/Node bằng bộ cài chính thức, rồi bấm "Kiểm tra lại" |
| Cài xong Git/Node mà launcher vẫn báo thiếu | Bấm "Kiểm tra lại". Launcher đọc lại `PATH` từ registry. Nếu vẫn thiếu, đóng hẳn launcher (khay → Thoát) rồi mở lại |
| Panel Kết nối báo bridge tắt | Có thể cổng 4321 đang bị chương trình khác giữ. Xem tab Hệ thống → Health check, hoặc đổi **Cổng bridge** trong Cài đặt |
| Aseprite không thấy Squarel | Kiểm tra extension đã cài (trang Aseprite → Health check). Extension tự nối lại bridge trong khoảng 10 giây |
| Claude Code không thấy `squarel` | Hệ thống → Health check → "Claude Code thấy server squarel" → bấm sửa. Hoặc chạy `claude mcp list` |
| Muốn gửi log khi báo lỗi | Hệ thống → Nhật ký. Khoá API đã được che, nhưng vẫn nên đọc lại trước khi gửi |
| Cập nhật launcher không chạy | Launcher kiểm tra lúc mở và mỗi 6 giờ. Tải nền xong mới hiện nút cài. Có thể tải bộ cài mới từ Releases và cài đè |
