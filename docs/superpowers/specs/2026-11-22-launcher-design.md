# Squarel Art Launcher — bản thiết kế

> Ngày: 2026-11-22 · Trạng thái: chờ duyệt
>
> Giao diện: [Figma — Squarel Art Personal (Launcher)](https://www.figma.com/design/AWBBKBpJ02xrY41bo45Ais/Squarel-Art-Personal---Launcher-?node-id=0-1)
> - Trang "Launcher": 4 màn hình thiết lập lần đầu, 5 màn hình ứng dụng, các component.
> - Trang "Lưu trữ v1": nội dung chi tiết của các tab Health check, Nhật ký, Cấu hình. Bố cục cũ, nội dung vẫn dùng.

## 1. Mục đích và lý do

Squarel Art hiện là một repo: MCP server cho Claude Code, bridge WebSocket, extension Aseprite, các script. Cài nó trên một máy mới cần làm theo khoảng 9 bước trong [docs/setup.md](../../setup.md): Node, pnpm, Git, `.env`, Cloudflare, build Aseprite, cài extension, đăng ký với Claude Code.

Chủ dự án muốn **cài lại dễ trên nhiều máy** và **chia sẻ cho người khác**. Ai thích thì clone repo, ai không thì tải bộ cài về dùng luôn.

Launcher là một ứng dụng desktop kiểu Riot Client, làm 4 việc:
1. **Lần đầu mở:** hướng dẫn từng bước, tự cài các công cụ còn thiếu, nhận cấu hình qua giao diện.
2. **Hằng ngày:** theo dõi các kết nối (phiên Claude Code, bridge, Aseprite, dịch vụ ảnh) và chạy health check.
3. **Quản lý và cập nhật:** hiện phiên bản từng thành phần, kiểm tra bản mới, cập nhật hoặc build lại.
4. **Mở công cụ:** nút "Mở Aseprite ▾".

**Làm việc vẫn diễn ra trong Claude Code.** Launcher không có khung chat và không vẽ.

**Phải mở rộng được:** sau Aseprite sẽ có thêm công cụ khác. Thêm một công cụ phải là việc khai báo, không phải sửa giao diện.

## 2. Mục tiêu, không làm, và những điều coi là thất bại

**Mục tiêu**
- Máy Windows mới, chưa có gì: tải bộ cài → mở launcher → làm theo wizard → dùng được Squarel trong Claude Code. Người dùng không phải gõ lệnh nào, ngoài việc đăng nhập Claude Code.
- Máy đã clone repo: launcher nhận đúng thư mục đó, không tải lại.
- Nhìn một màn hình là biết thứ gì đang chạy, thứ gì hỏng, và có nút sửa.
- Mỗi thành phần có phiên bản đang dùng, bản mới nhất, và nút cập nhật.
- Thêm một công cụ mới bằng một file khai báo. Launcher tự có icon trên thanh trái, trang riêng, dòng trong panel Kết nối, các health check và nút Mở.

**Không làm trong bản này**
- macOS và Linux. Code vẫn tách phần phụ thuộc Windows để sau thêm được.
- Ký số (code signing) bộ cài.
- Tải tích hợp do cộng đồng viết từ mạng. Tab "Cộng đồng" chỉ là chỗ để sẵn.
- Tự cài local-sd (Python, CUDA torch, model ~4GB) *(quyết định của người viết)*. Launcher chỉ phát hiện `LOCAL_SD_URL` có trả lời `/health` hay không, rồi hiện trạng thái và link tới hướng dẫn. Lựa chọn "GPU của máy" trong wizard chỉ bật khi phát hiện thấy service đang chạy.
- Chat, vẽ, hay xem project bên trong launcher.
- Tự đăng nhập Claude Code thay người dùng.
- Nhiều người dùng trên một máy, telemetry, gửi dữ liệu về đâu đó.

**Coi là thất bại, dù chạy được**
- Launcher tự gọi API trả phí, hoặc health check làm tốn tiền hay tốn quota. Kiểm tra chỉ dùng endpoint miễn phí.
- Cài thứ lớn mà không hỏi. Mọi thao tác cài phải hiện dung lượng và thời gian ước tính, rồi chờ người dùng bấm.
- Phát tán bản Aseprite đã build, hoặc lưu source Aseprite trong repo. EULA chỉ cho tự build để dùng cá nhân.
- Lưu khoá API ở chỗ khác ngoài `.env` của Squarel, hoặc ghi khoá ra log.
- Đụng vào dữ liệu project (`DATA_DIR/projects`) ngoài việc đọc để hiển thị.

## 3. Ràng buộc

- Windows 11 là nền tảng chính. Máy tham chiếu: i7-10750H, RAM 16GB, GTX 1650.
- Squarel chạy bằng **Node hệ thống ≥ 22.18**: Claude Code khởi động MCP server bằng lệnh `node`. Vì vậy Node là thành phần bắt buộc dù launcher có Node riêng bên trong Electron.
- Aseprite phải build trên chính máy người dùng, cần VS 2022 Build Tools (~7GB). Bản trial không dùng được.
- Repo: `github.com/t1tc01-personal/squarel-art-2`. Bộ cài phát hành trên GitHub Releases của repo này.
- Một người duy trì cùng AI, nên ưu tiên ít ngôn ngữ, ít bộ phận.

## 4. Các phương án đã cân nhắc

**Công nghệ giao diện**

| Phương án | Ưu | Nhược | Chọn |
|---|---|---|---|
| **A. Electron + React** | Cùng TypeScript với repo. `electron-builder` ra bộ cài, `electron-updater` tự cập nhật từ GitHub Releases | Bộ cài nặng ~80–100MB | ✓ |
| B. Tauri | Bộ cài 5–10MB | Lõi viết bằng Rust, muốn dùng code TS phải gọi sang Node: hai ngôn ngữ, nhiều bộ phận hơn | |
| C. Web local + exe gói bằng Node (SEA) | Ít code nhất | Trông như tab trình duyệt, không giống ứng dụng | |

**Phân phối:** chọn **cả hai**.
- Bộ cài trên GitHub Releases, do chủ dự án build bằng CI.
- Người clone repo vẫn chạy được launcher từ source.

**Cách launcher nói chuyện với Squarel**

| Phương án | Chọn |
|---|---|
| Import thẳng module TS của Squarel vào Electron | |
| **Chỉ qua các "hợp đồng" ổn định: lệnh CLI, WebSocket của bridge, file trong `DATA_DIR`, file `.env`** | ✓ |

Lý do chọn cách thứ hai:
- Launcher và Squarel cập nhật độc lập với nhau. Launcher cũ vẫn điều khiển được Squarel mới.
- Squarel chạy file `.ts` trực tiếp nhờ Node hệ thống. Node gắn trong Electron có thể là bản khác, nên không dựa vào nó.

**Cách khai báo một tích hợp**

| Phương án | Chọn |
|---|---|
| Module TypeScript cho mỗi công cụ | |
| **File `integration.json` khai báo + các lệnh có sẵn trong repo Squarel** | ✓ |

Lý do: giao diện dựng hoàn toàn từ dữ liệu. File khai báo kiểm tra được bằng schema. Launcher chỉ chạy những lệnh nằm trong thư mục Squarel trên máy, không chạy code tải từ nơi khác.

## 5. Bố cục và màn hình (đã chốt qua Figma)

**Khung chung**, cửa sổ 1280×800:
- Thanh tiêu đề riêng.
- **Thanh icon bên trái**, từ trên xuống:
  - logo;
  - Trang chủ;
  - Thư viện tích hợp;
  - ─ (vạch ngăn), rồi **mỗi tích hợp đã cài một icon**, theo thứ tự trong cấu hình;
  - ➕ (mở Thư viện);
  - dưới cùng: **Hệ thống** và **Cấu hình**.
- **Vùng nội dung** ở giữa.
- **Panel Kết nối** bên phải, rộng 272px, thu gọn được.

**Phong cách**
- Nền tối. Màu nhấn lấy từ palette PICO-8. Icon pixel 16px.
- Font: Geist cho chữ giao diện, Geist Mono cho phiên bản và log. Pixelify Sans chỉ dùng cho chữ "SQUAREL", vì font này thiếu một số dấu tiếng Việt.
- Token màu, khoảng cách và kiểu chữ là các biến trong Figma. Code tạo CSS variables cùng tên với các biến đó.

**Màn hình**

| Màn hình | Nội dung chính |
|---|---|
| Thiết lập 1 · Chào mừng | Chọn "Cài mới" (mặc định `%LOCALAPPDATA%\SquarelArt\app`) hay "Dùng repo đã clone" (chọn thư mục). Chọn `DATA_DIR` |
| Thiết lập 2 · Cài công cụ | Danh sách thành phần, trạng thái và tiến độ từng dòng, log trực tiếp |
| Thiết lập 3 · Cấu hình | Nguồn ảnh AI (Cloudflare / GPU máy / Mock), token Cloudflare có nút kiểm tra, Retro Diffusion và trần chi phí, **chọn các tích hợp muốn cài**. Với Aseprite: tự build, đã có (chỉ đường dẫn), hoặc bỏ qua. *Figma vẫn vẽ phần Aseprite riêng; khi làm thì đổi thành danh sách tích hợp.* |
| Thiết lập 4 · Kết nối Claude | Checklist: Claude Code đã cài, đăng ký MCP, chép skill, chạy thử MCP, tích hợp đang build. Câu lệnh mẫu để thử |
| Trang chủ | Banner (có gì mới), project gần đây (đọc từ `DATA_DIR`), câu lệnh mẫu để thử trong Claude Code |
| Thư viện tích hợp | Lưới thẻ: đã cài / sắp có / tích hợp của bạn. Lọc theo tab |
| Trang một tích hợp | Tên + tab (Tổng quan · Cập nhật · Health · Cài đặt). Banner trạng thái, **nút Mở ▾** góc dưới trái kèm menu các lệnh mở, 3 thẻ (cập nhật, extension, hoạt động hôm nay) |
| Hệ thống | Tab Thành phần (bảng phiên bản và cập nhật của phần lõi) · Health check · Nhật ký |
| Cấu hình | Dữ liệu, ảnh AI, bridge, thu xuống khay, khởi động cùng Windows |

**Panel Kết nối** chia ba nhóm:
- **Claude Code:** mỗi phiên một dòng, ghi thư mục và thao tác gần nhất.
- **Công cụ:** tích hợp đang kết nối bridge, kèm project đang mở.
- **Dịch vụ:** bridge, Cloudflare (số neuron còn lại), Retro Diffusion.

Mỗi dòng có chấm trạng thái: xanh lá = hoạt động, xanh dương = đang làm việc, cam = cần chú ý, xám = tắt.

**Khay hệ thống:** đóng cửa sổ thì launcher thu xuống khay (bật/tắt được trong Cấu hình). Menu chuột phải gồm: Mở launcher, Mở <tích hợp>…, Trạng thái bridge, Thoát. Thoát thì dừng bridge do launcher giữ.

## 6. Kiến trúc

```
Squarel Art Launcher (Electron)
├─ main process (Node trong Electron)
│   ├─ Supervisor   giữ tiến trình con: bridge (node src/bridge/index.ts), các lệnh cài/build
│   ├─ Registry     đọc thành phần lõi + integrations/*/integration.json → mô hình dữ liệu thống nhất
│   ├─ Checks       chạy health check, lịch 10 phút/lần khi đang mở
│   ├─ Updates      electron-updater (launcher) · git tag (Squarel, Aseprite) · winget (công cụ nền)
│   ├─ Presence     WS client tới bridge ("launcher") + đọc DATA_DIR/run/*.json (phiên MCP)
│   ├─ EnvStore     đọc/ghi .env của Squarel (giữ nguyên dòng, chú thích, thứ tự)
│   └─ Tray, IPC    API có danh sách cho phép, typed, tới renderer
└─ renderer (React + Vite, sandbox, contextIsolation, không nodeIntegration)
     màn hình theo Figma, dựng từ dữ liệu Registry/Checks/Presence
```

**Nơi lưu**
- Trạng thái riêng của launcher: `%APPDATA%\SquarelArt Launcher\state.json`. Gồm đường dẫn Squarel, chế độ cài, wizard đang ở bước nào, lần kiểm tra cuối, danh sách tích hợp đã chọn.
- Cấu hình Squarel: vẫn là `.env` trong thư mục Squarel, giữ một nguồn sự thật.
- Source và bản build công cụ: `%LOCALAPPDATA%\SquarelArt\tools\<id>`. Launcher truyền `--src` cho `aseprite:build`. Người dùng CLI vẫn dùng mặc định `vendor/`.

**Vị trí code:** thư mục `launcher/` trong repo, có `package.json` riêng, **không** nằm trong workspace gốc. Nhờ vậy người clone chỉ để dùng Squarel không phải tải Electron. Chạy từ source:

```powershell
pnpm --dir launcher install
```

```powershell
pnpm --dir launcher dev
```

**Phiên bản** *(quyết định của người viết)*: một số phiên bản và một tag `vX.Y.Z` cho mỗi bản phát hành, áp cho cả Squarel lẫn launcher. **Bình thường hai bên luôn đi cùng nhau.**
- Bản phát hành đầu tiên là `v0.2.0`. Repo hiện chưa có tag nào.
- Launcher bản X, khi ở chế độ "Cài mới", cài Squarel ở tag X.
- **Cập nhật** là một luồng: launcher tự cập nhật lên Y, khởi động lại, rồi đưa Squarel lên đúng tag Y (`git fetch --tags` → `git checkout vY` → `pnpm install` → cài lại extension của các tích hợp). Nút "Cập nhật" của riêng Squarel cũng đưa Squarel về **tag trùng phiên bản launcher**, không nhảy lên tag mới hơn.
- **Tương thích:** launcher ghi rõ phiên bản schema `integration.json` mà nó hiểu (bản này: `1`). Nếu Squarel mới hơn launcher, vẫn dùng bình thường, vì các hợp đồng CLI/bridge/file chỉ thêm, không đổi nghĩa. Tích hợp có `schema` lạ thì hiện "Cần launcher mới hơn" và bỏ qua tích hợp đó.
- Launcher chạy từ source (`pnpm --dir launcher dev`) lấy phiên bản trong `launcher/package.json`, và **không** tự đổi tag của repo.
- Nếu thư mục là repo clone đang ở một nhánh (ví dụ `main`), launcher ghi "đang theo nhánh main". Khi đó cập nhật là `git pull --ff-only`, không ép chuyển sang tag. Nếu có thay đổi chưa commit thì không cập nhật, chỉ báo.

**Ai giữ bridge** *(quyết định của người viết)*: ai mở trước thì giữ cổng 4321. Squarel vẫn chạy đủ mà không cần launcher.
- MCP server giữ nguyên cách hiện tại: cổng trống thì tự mở bridge trong tiến trình của nó.
- Launcher mở lên mà thấy cổng đã có người giữ thì kết nối vào như client `launcher` để theo dõi. Khi kết nối đó mất (ví dụ phiên Claude Code giữ bridge đã đóng), launcher **thử chiếm cổng ngay** và chạy bridge của mình. Extension Aseprite có watchdog nên tự nối lại trong khoảng 10 giây.
- "Thoát" trên khay chỉ dừng bridge mà chính launcher đang giữ.

## 7. Mô hình mở rộng: thành phần và tích hợp

Mọi thứ launcher quản lý đều là một **thành phần**, với cùng một giao diện:

```ts
interface Component {
  id: string                    // "node", "claude-code", "squarel", "aseprite"
  name: string; description: string; icon: IconRef
  kind: 'core' | 'integration'
  required: boolean
  detect(): Promise<{ installed: boolean; version?: string; path?: string }>
  latest?(): Promise<string | undefined>
  install?: InstallOption[]     // nhiều cách cài; người dùng chọn
  update?(to: string): Task
  checks: CheckSpec[]
}
```

- **Thành phần lõi** (Node, pnpm, Git, Claude Code, VS Build Tools, Squarel, local-sd) được viết sẵn trong code launcher.
- **Tích hợp** được đọc từ `integrations/<id>/integration.json` trong thư mục Squarel, kiểm tra bằng schema zod. Ví dụ cho Aseprite:

```json
{
  "schema": 1,
  "id": "aseprite",
  "name": "Aseprite",
  "description": "Vẽ tay, đồng bộ trực tiếp hai chiều với Claude.",
  "icon": "icon.png",
  "accent": "#FF77A8",
  "platforms": ["win32"],
  "detect": {
    "env": "ASEPRITE_PATH",
    "candidates": ["%ProgramFiles(x86)%\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe", "%ProgramFiles%\\Aseprite\\Aseprite.exe"],
    "version": { "args": ["-b", "--version"], "pattern": "Aseprite (\\S+)" }
  },
  "latest": { "type": "git-tags", "repo": "https://github.com/aseprite/aseprite.git", "stable": true },
  "install": [
    { "id": "build", "label": "Tự build từ source", "note": "Miễn phí, dùng cá nhân. ~7GB Build Tools, ~6 phút build.",
      "run": ["pnpm", "aseprite:build", "--", "--src", "{toolsDir}", "--install-deps"] },
    { "id": "existing", "label": "Đã có Aseprite", "pickFile": "aseprite.exe", "setEnv": "ASEPRITE_PATH" }
  ],
  "update": { "run": ["pnpm", "aseprite:build", "--", "--src", "{toolsDir}", "--ref", "{version}"], "requiresClosed": "aseprite.exe" },
  "extension": {
    "version": { "source": "integrations/aseprite/squarel/package.json", "installed": "%APPDATA%\\Aseprite\\extensions\\squarel\\package.json" },
    "install": { "run": ["pnpm", "aseprite:pack", "--", "--install"], "requiresClosed": "aseprite.exe" }
  },
  "bridge": { "client": "aseprite" },
  "launch": [
    { "id": "open", "label": "Mở Aseprite", "default": true, "run": ["{exe}"] },
    { "id": "open-project", "label": "Mở project…", "pickProject": true, "bridgeTool": "open_in_editor" },
    { "id": "open-recent", "label": "Mở {recentProject}", "bridgeTool": "open_in_editor" },
    { "id": "open-plain", "label": "Mở không đồng bộ", "run": ["{exe}"], "env": { "SQUAREL_NO_SYNC": "1" } },
    { "id": "folder", "label": "Mở thư mục cài đặt", "reveal": "{exeDir}" }
  ],
  "checks": [
    { "id": "installed", "label": "Đã cài và chạy được", "builtin": "detect" },
    { "id": "connected", "label": "Đã kết nối bridge", "builtin": "bridge-client" },
    { "id": "extension", "label": "Extension đúng phiên bản", "builtin": "extension-version" },
    { "id": "roundtrip", "label": "Chuyển đổi không mất dữ liệu", "run": ["pnpm", "aseprite:test"], "manual": true }
  ]
}
```

**Quy tắc**
- `run` luôn là mảng (không qua shell) và chạy trong thư mục Squarel.
- Biến thay thế chỉ gồm danh sách cố định: `{toolsDir}`, `{exe}`, `{exeDir}`, `{version}`, `{recentProject}`.
- `builtin` là các health check có sẵn trong launcher.
- `bridgeTool` gửi lệnh `tool` qua bridge, giống cách Claude gọi.

**Thêm một công cụ mới cần:**
1. Thư mục `integrations/<id>/` gồm `integration.json`, `icon.png` 16×16, và extension/script của công cụ nếu có.
2. Nếu công cụ đồng bộ trực tiếp: một client nói giao thức bridge hiện có (`hello` với `client: "<id>"`, `open`, `cels`, `ping`).
3. Không phải sửa code launcher. Thanh icon, trang, nút Mở, health check và dòng trong panel Kết nối đều dựng từ file khai báo.

**Nguồn của Thư viện tích hợp** *(quyết định của người viết)*
- **Có sẵn:** mọi `integrations/<id>/integration.json` trong thư mục Squarel.
- **Sắp có:** danh mục cố định `integrations/catalog.json` (id, tên, mô tả, icon, `status: "coming-soon"`), đi theo phiên bản Squarel.
- **Tích hợp của bạn:** thư mục `%APPDATA%\SquarelArt Launcher\integrations\<id>\`, nằm **ngoài** repo. Nhờ vậy nó không làm repo có thay đổi chưa commit, và không bị mất khi cập nhật tag. Launcher được chạy lệnh từ đúng hai nơi: thư mục Squarel, và thư mục tích hợp của người dùng. Lệnh của tích hợp người dùng chạy với thư mục làm việc là thư mục tích hợp đó.
- **"Đã cài"** = người dùng đã chọn tích hợp đó (lưu trong `state.json`) **và** `detect` tìm thấy công cụ.

Tài liệu cho người viết tích hợp: `docs/integrations.md` (mới).

## 8. Những thay đổi cần trong Squarel

| Thay đổi | Lý do |
|---|---|
| Bridge thêm thông điệp `status` (trả về danh sách client: tên, phiên bản, project đang mở, lần ping cuối; cùng phiên bản bridge) | Panel Kết nối và health check cần biết ai đang kết nối |
| MCP server ghi file `DATA_DIR/run/mcp-<pid>.json` (pid, thư mục làm việc, thời điểm bắt đầu, tool gần nhất, cập nhật mỗi 10 giây và sau mỗi lần gọi tool), xoá khi thoát | Hiện các phiên Claude Code trong panel. Launcher bỏ file của tiến trình đã chết hoặc cũ hơn 30 giây |
| Khi cổng bridge đã có tiến trình khác giữ, `open_in_editor` của MCP gửi `tool open_in_editor` sang bridge đó qua WebSocket. Hiện tại nó chỉ trả về một câu thông báo | Khi launcher giữ bridge, Claude vẫn mở được project trong Aseprite (đường này đã thử bằng tay hôm 2026-11-22) |
| Đưa phần khai báo Aseprite thành `integrations/aseprite/integration.json` + `icon.png`. Thư mục `integrations/aseprite/` hiện có giữ nguyên | Tích hợp đầu tiên theo mô hình mới |
| Extension Aseprite bỏ qua tự kết nối khi có biến môi trường `SQUAREL_NO_SYNC=1` | Lệnh "Mở không đồng bộ" trong menu Mở ▾ |
| `aseprite:build` thêm `--json-progress`: in từng dòng JSON (bước, phần trăm, thông báo) | Launcher hiện tiến độ mà không phải đoán từ output của Ninja |

Mọi thay đổi trên đều có test vitest như phần còn lại của repo.

## 9. Thiết lập lần đầu (wizard)

Wizard chạy khi chưa có `state.json`, hoặc khi thiếu một thành phần bắt buộc. Đóng giữa chừng thì lần sau mở lại đúng bước đó.

1. **Chào mừng:** chọn chế độ cài và `DATA_DIR`. Với chế độ "repo đã clone", kiểm tra thư mục có `package.json` tên `squarel-art`.
2. **Cài công cụ:** làm lần lượt:
   - phát hiện Git, Node ≥ 22.18, pnpm;
   - cài thứ còn thiếu bằng `winget`: hiện lệnh, dung lượng, chờ người dùng bấm "Cài". Windows sẽ hỏi quyền admin và winget sẽ hỏi đồng ý điều khoản; người dùng tự trả lời trong cửa sổ terminal mà launcher mở;
   - nếu máy **không có winget** (một số bản Windows LTSC hoặc máy công ty) *(quyết định của người viết)*: wizard hiện một bước "Cài App Installer", có nút mở Microsoft Store và nút "Kiểm tra lại". Ngoài ra có link tải trực tiếp bộ cài chính thức của từng công cụ (Git, Node LTS) để người dùng tự cài rồi bấm "Kiểm tra lại". Launcher không tự tải và chạy file cài khi không có winget;
   - clone Squarel ở tag của bản launcher (chế độ cài mới);
   - chạy `pnpm install`.

   Claude Code: nếu chưa có, hiện nút chạy bộ cài chính thức trong một cửa sổ PowerShell để người dùng tự xem, kèm dòng nhắc chạy `claude` một lần để đăng nhập. Launcher không đăng nhập thay.
3. **Cấu hình:**
   - ghi `.env`;
   - kiểm tra token Cloudflare bằng endpoint verify (miễn phí);
   - chọn tích hợp và cách cài. Aseprite: build (chạy nền, tiếp tục được sang bước 4), đã có, hoặc bỏ qua.
4. **Kết nối Claude:**
   - `claude mcp add squarel --scope user -- node <squarel>/src/mcp/index.ts`, nếu đã có thì cập nhật đường dẫn;
   - chép 4 skill vào `~/.claude/skills`;
   - chạy thử MCP qua stdio: khởi động, đọc danh sách tool, so số tool;
   - kiểm tra `claude mcp list` thấy `squarel`;
   - cài extension của các tích hợp đã chọn.

## 10. Health check

| Nhóm | Kiểm tra | Cách làm (không tốn tiền) |
|---|---|---|
| Claude | Claude Code đã cài | `claude --version` |
| | Claude Code thấy server `squarel` | `claude mcp list` |
| | MCP server khởi động | Mở stdio, `initialize` + `tools/list`, đo thời gian |
| Bridge & công cụ | Bridge nghe cổng | WS `hello` + `status` |
| | Mỗi tích hợp | Các `checks` trong file khai báo |
| Ảnh AI | Token Cloudflare | Endpoint verify token |
| | Retro Diffusion | Chỉ kiểm tra có key hay không. Không gọi `check_cost` tự động |
| Máy | `DATA_DIR` ghi được | Ghi rồi xoá một file tạm |
| | Dung lượng đĩa | `statfs` |

Mỗi kết quả có mức Đạt / Cảnh báo / Lỗi, một dòng giải thích, và nút sửa nếu có cách sửa tự động (cài lại, đăng ký lại, mở Cấu hình).

## 11. Cập nhật

- **Launcher:** `electron-updater` với provider GitHub. Kiểm tra lúc mở và mỗi 6 giờ. Tải nền, hỏi rồi khởi động lại. Bộ cài không ký số nên lần cài đầu SmartScreen sẽ cảnh báo; tài liệu hướng dẫn bấm "More info → Run anyway".
- **Squarel:** theo tag, xem §6. Sau khi cập nhật thì chạy lại health check.
- **Tích hợp:**
  - kiểm tra `latest` (git tags) lúc mở launcher;
  - có bản mới thì báo ở thanh trái (ô đỏ trên tab Cập nhật);
  - cập nhật chạy `update.run`;
  - `requiresClosed` thì nhắc đóng công cụ trước.
- **Công cụ nền:** chỉ báo phiên bản và yêu cầu tối thiểu. Cập nhật qua winget khi người dùng bấm.

## 12. Bảo mật

- Renderer: sandbox, `contextIsolation`, không `nodeIntegration`, không tải nội dung từ mạng (trừ kiểm tra phiên bản ở main process). IPC chỉ gồm một danh sách lệnh cố định, có kiểm tra tham số bằng zod.
- Chỉ chạy lệnh từ file khai báo trong thư mục Squarel đã chọn, dạng mảng, không qua shell. Đường dẫn và biến được thay thế bằng danh sách cố định.
- Khoá API chỉ nằm trong `.env`. Giao diện che khoá; log che khoá như logger hiện tại của Squarel.
- Bridge vẫn chỉ nghe `127.0.0.1` với quy tắc Origin hiện có. Launcher kết nối như một client tên `launcher`.

## 13. Đóng gói và phát hành

- Từ source: `pnpm --dir launcher build` tạo bộ cài NSIS (`Squarel-Art-Launcher-Setup-X.Y.Z.exe`) và bản portable.
- **GitHub Actions** (`windows-latest`, khi push tag `v*`): chạy `pnpm check` của Squarel, test của launcher, build launcher, rồi đẩy bộ cài + `latest.yml` lên GitHub Release của tag đó.
- Tài liệu mới:
  - `docs/launcher.md`: dùng launcher;
  - `docs/release.md`: cách build exe trên máy và cách phát hành (chủ dự án đã yêu cầu tài liệu này);
  - `docs/integrations.md`: viết tích hợp.

## 14. Kiểm chứng

- **Unit (vitest)**, cả Squarel và launcher:
  - schema `integration.json`;
  - so sánh phiên bản;
  - thay biến trong `run`;
  - EnvStore giữ nguyên chú thích và thứ tự dòng;
  - bộ chạy health check với lệnh giả;
  - `status` của bridge, file phiên MCP, `open_in_editor` khi bridge thuộc tiến trình khác.
- **Giao diện:** Playwright cho Electron. Môi trường giả: thành phần trả về phiên bản cố định, bridge giả, không gọi mạng. Kiểm tra wizard đi hết 4 bước, trang tích hợp dựng đúng từ file khai báo mẫu, panel Kết nối cập nhật khi có client.
- **Trên máy sạch:** chạy bộ cài trong **Windows Sandbox** (có sẵn trên Windows 11 Pro) để thử nguyên luồng máy mới. Windows Sandbox **không có winget**, nên đây đồng thời là bài thử cho nhánh "không có winget" ở §9. Muốn thử nhánh có winget thì dùng một file `.wsb` cài App Installer khi khởi động (script để trong `launcher/test/sandbox/`). Build Aseprite trong Sandbox có thể quá nặng, nên thử "Đã có Aseprite" hoặc "Bỏ qua" ở đó, và thử build trên máy thật.
- **Token thiết kế:** các biến màu, khoảng cách và kiểu chữ trong Figma được xuất một lần thành `launcher/src/renderer/tokens.css`, để người làm không cần quyền xem Figma mới dựng được giao diện. Ảnh chụp từng màn hình để trong `docs/launcher/screens/`.
- **Thủ công trên máy thật:**
  - bridge do launcher giữ, Claude Code mở sau: MCP dùng chung bridge, `open_in_editor` mở được project;
  - tắt launcher: Aseprite tự nối lại khi bridge chạy lại;
  - cập nhật Squarel từ tag cũ lên tag mới.

## 15. Quyết định đã chốt với chủ dự án

**Repo `t1tc01-personal/squarel-art-2` được chuyển sang công khai** (chốt ngày 2026-11-22). Nhờ vậy cả ba chỗ cần truy cập ẩn danh (clone Squarel trên máy mới, `electron-updater`, `git fetch --tags`) chạy đúng như thiết kế, không cần token.

Hệ quả cần nhớ:
- Mọi thứ đã commit, kể cả lịch sử commit và email tác giả của commit, đều xem được công khai.
- `.env`, `vendor/` (source và bản build Aseprite) và dữ liệu project vẫn nằm ngoài git, như `.gitignore` hiện tại.
- **Giấy phép:** PolyForm Shield 1.0.0 (`LICENSE.md`, chốt ngày 2026-11-22). Ai cũng dùng được, kể cả để làm ra sản phẩm thương mại, nhưng không được dùng code để cung cấp sản phẩm cạnh tranh. Bộ cài launcher kèm `LICENSE.md`, và màn hình "Giới thiệu" hiện link tới file này.
- Từ bản này, `test/repo-hygiene.test.ts` chặn việc commit khoá, file `.env`, `vendor/`, log, email cá nhân, và đường dẫn thư mục người dùng Windows.

## 16. Để lại cho người làm

- Thư viện UI cụ thể trong renderer (component tự viết theo Figma hay dùng thư viện headless), cách tổ chức state.
- Đặt tên kênh IPC, cấu trúc thư mục bên trong `launcher/`.
- Chi tiết trạng thái lỗi của từng màn hình, menu khay hệ thống, hộp thoại cập nhật: chưa vẽ trong Figma. Theo đúng token và component sẵn có.
- Có làm bản portable hay chỉ bộ cài NSIS.
- Lịch kiểm tra cụ thể (10 phút / 6 giờ là đề xuất).
