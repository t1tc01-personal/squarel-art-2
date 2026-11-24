# Hướng dẫn cài đặt từ đầu đến cuối (Windows)

Làm lần lượt từ trên xuống. Mỗi bước có một lệnh kiểm tra: bước đó chạy đúng thì mới sang bước sau.

| Bước | Bắt buộc? | Tốn tiền? | Thời gian |
|---|---|---|---|
| [1. Node, pnpm, Git](#1-cài-node-pnpm-git) | Bắt buộc | Không | 10 phút |
| [2. Cài thư viện và chạy test](#2-cài-thư-viện-và-chạy-test) | Bắt buộc | Không | 5 phút |
| [3. File `.env` và chế độ thử `mock`](#3-tạo-file-env-chạy-thử-bằng-mock) | Bắt buộc | Không | 5 phút |
| [4. Cắm vào Claude Code](#4-cắm-vào-claude-code) | Bắt buộc | Nằm trong gói Claude của bạn | 5 phút |
| [5. Cloudflare Workers AI (tạo ảnh AI miễn phí)](#5-cloudflare-workers-ai-tạo-ảnh-ai-miễn-phí) | Nên có | Không (free tier) | 10 phút |
| [6. Aseprite + extension Squarel (vẽ tay)](#6-aseprite--extension-squarel-vẽ-tay) | Nên có | Không, nếu tự build bằng `pnpm aseprite:build` (hoặc ~$20 nếu mua) | 1 giờ nếu tự build, 20 phút nếu mua |
| [7. Retro Diffusion (ảnh chất lượng cao)](#7-retro-diffusion-tuỳ-chọn-trả-phí) | Tuỳ chọn | Có, tính theo ảnh | 10 phút |
| [8. GPU của máy: local-sd](#8-gpu-của-máy-local-sd-tuỳ-chọn) | Tuỳ chọn | Không | 30–60 phút |
| [9. Dùng ở dự án khác, backup](#9-dùng-ở-dự-án-khác-và-backup) | Tuỳ chọn | Không | 5 phút |

Không có Cloudflare hay Aseprite thì vẫn dùng được: Claude vẫn vẽ, sửa, chuyển ảnh chụp thành pixel art và xuất file. Chỉ thiếu phần AI tạo ảnh và phần vẽ tay.

## Cách nhanh: dùng launcher

Trên Windows, **Squarel Art Launcher** làm thay bạn phần lớn các bước dưới đây:

| Bước trong hướng dẫn này | Launcher làm |
|---|---|
| 1. Node, pnpm, Git | Có: cài bằng `winget` (bạn tự bấm đồng ý) |
| 2. Cài thư viện | Có: clone Squarel (hoặc dùng repo đã clone) và `pnpm install` |
| 3. File `.env` | Có: màn hình Cấu hình và Cài đặt |
| 4. Cắm vào Claude Code | Có: `claude mcp add`, chép skill, chạy thử MCP. Bạn vẫn tự đăng nhập `claude` |
| 5. Cloudflare | Một phần: bạn tự lấy token (mục 5), launcher kiểm tra token |
| 6. Aseprite | Có: build hoặc trỏ vào bản đã có, cài extension |
| 7, 8 | Không: làm tay theo hướng dẫn |

1. Tải `Squarel-Art-Launcher-Setup-X.Y.Z.exe` ở trang [Releases](https://github.com/t1tc01-personal/squarel-art-2/releases).
2. Chạy file. SmartScreen chặn thì bấm **More info → Run anyway** (bộ cài chưa ký số).
3. Đi hết wizard 4 bước.

Chi tiết ở [docs/launcher.md](launcher.md). Muốn tự làm từng bước thì đọc tiếp bên dưới.

Mọi lệnh bên dưới chạy trong **PowerShell**, tại thư mục repo (nơi bạn đã clone, viết là `<thư mục repo>` trong các lệnh; thay bằng đường dẫn thật), trừ khi có ghi khác.

---

## 1. Cài Node, pnpm, Git

1. Cài Node.js LTS (cần bản **22.18 trở lên**, vì code chạy file `.ts` trực tiếp):

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

2. Cài Git (Claude Code trên Windows cũng cần Git):

   ```powershell
   winget install Git.Git
   ```

3. **Đóng PowerShell và mở lại** để nhận PATH mới, rồi cài pnpm:

   ```powershell
   npm install -g pnpm
   ```

**Kiểm tra:** ba lệnh dưới đều in ra số phiên bản. `node -v` phải ≥ `v22.18`.

```powershell
node -v
```

```powershell
pnpm -v
```

```powershell
git --version
```

## 2. Cài thư viện và chạy test

```powershell
cd <thư mục repo>
```

```powershell
pnpm install
```

```powershell
pnpm check
```

**Kiểm tra:** `pnpm check` kết thúc bằng dòng kiểu `Tests  73 passed`. Lệnh này chạy typecheck, lint và toàn bộ test, không gọi mạng, không tốn tiền.

## 3. Tạo file `.env`, chạy thử bằng `mock`

1. Tạo file cấu hình (nếu đã có `.env` thì bỏ qua lệnh này):

   ```powershell
   Copy-Item .env.example .env
   ```

2. Mở `.env` bằng Notepad hoặc VS Code. Lúc này chỉ sửa hai dòng:

   ```
   DATA_DIR=D:\SquarelArt-data
   IMAGE_PROVIDER=mock
   ```

   - `DATA_DIR` là nơi lưu mọi project, lịch sử, file xuất. Thư mục tự được tạo. Muốn có backup tự động thì đặt trong OneDrive hoặc Google Drive, ví dụ `C:\Users\<tên>\OneDrive\SquarelArt-data`.
   - `mock` là provider giả: tạo ảnh mẫu ngay, không cần mạng, $0. Dùng để kiểm tra mọi thứ trước khi có key thật.

3. Thử bằng CLI:

   ```powershell
   pnpm cli art_create --name "Thu" --width 32 --height 32
   ```

   ```powershell
   pnpm cli generate_image --art thu --prompt "a red apple" --variants 2
   ```

   ```powershell
   pnpm cli usage_today
   ```

**Kiểm tra:**
- Lệnh thứ hai in `Proposal p_… (generate, mock/mock, cost ~$0.000)` và ghi ra file `squarel-generate_image-1.png` trong thư mục hiện tại. Mở file đó xem: là bảng 2 biến thể đánh số.
- `usage_today` in `Providers: mock (default), cloudflare [not configured], …`.
- Xoá hai file `squarel-*.png` vừa tạo nếu không cần.

## 4. Cắm vào Claude Code

Repo đã có sẵn `.mcp.json` khai báo server `squarel`, và 4 skill trong `.claude/skills/`. Không cần cài gì thêm cho Claude Code.

1. Mở Claude Code **tại thư mục repo**:
   - App Claude desktop: tab **Code** → chọn thư mục `<thư mục repo>`.
   - Hoặc trong terminal: `cd <thư mục repo>` rồi gõ `claude`.
2. Lần đầu, Claude Code hỏi có cho phép MCP server `squarel` của project không. Chọn **cho phép**.
3. Gõ vào ô chat:

   > gọi tool usage_today của squarel

**Kiểm tra:** Claude trả lời bằng nội dung giống lệnh `pnpm cli usage_today` ở bước 3. Sau đó thử:

> /pixel-new một quả táo 32×32 cho game, palette PICO-8

Claude sẽ tạo canvas, gọi AI (đang là `mock`), cho bạn xem các biến thể đánh số và hỏi chọn cái nào.

Nếu Claude không thấy tool `squarel`, xem [Xử lý sự cố](#xử-lý-sự-cố).

## 5. Cloudflare Workers AI (tạo ảnh AI miễn phí)

Free tier của Workers AI là **10.000 neuron mỗi ngày**. Một ảnh FLUX.1-schnell 512px tốn khoảng 43 neuron, tức khoảng 230 ảnh/ngày. Ở gói Free, khi hết quota thì API báo lỗi chứ **không tự tính tiền**. Quota làm mới lúc 00:00 UTC, tức 7:00 sáng giờ Việt Nam.

1. Tạo tài khoản tại <https://dash.cloudflare.com/sign-up>. Không cần thẻ.
2. Trong dashboard, mở **AI → Workers AI**, bấm **Use REST API**.
3. Bấm **Create a Workers AI API Token**. Cloudflare điền sẵn quyền **Workers AI – Read** và **Workers AI – Edit**. Giữ nguyên, bấm **Create API Token**.
4. **Copy token ngay.** Token chỉ hiện một lần; mất thì phải tạo token mới.
5. Cũng trên trang đó, copy **Account ID**.
6. Điền vào `.env`, và đổi provider mặc định sang Cloudflare:

   ```
   IMAGE_PROVIDER=cloudflare
   CLOUDFLARE_ACCOUNT_ID=<Account ID>
   CLOUDFLARE_API_TOKEN=<token>
   ```

   Nếu tự tạo token ở *Manage account → Account API tokens* thay vì dùng nút ở bước 3, nhớ cấp đủ hai quyền Workers AI – Read và Workers AI – Edit.

**Kiểm tra** (gọi API thật, tốn khoảng 43 neuron miễn phí):

```powershell
pnpm cli generate_image --art thu --prompt "a red apple" --variants 1 --provider cloudflare
```

Kết quả đúng: `Proposal p_… (generate, cloudflare/…)`. Mở file `squarel-generate_image-1.png`: phải là pixel art sạch trên nền trong suốt.

Muốn kiểm tra kỹ hơn, chạy bộ eval: 10 prompt × 2 biến thể, khoảng 900 neuron (9% quota ngày):

```powershell
pnpm eval -- --provider cloudflare --yes
```

Báo cáo nằm ở `evals\out\<thời điểm>\report.md`, kèm ảnh mỗi prompt.

**Lưu ý:** phần gọi Cloudflare mới chỉ được test với dữ liệu giả, đây là lần đầu chạy với API thật. Nếu lỗi `400` hoặc báo sai tên trường, gửi Claude nội dung lỗi in trên màn hình để sửa `src/providers/cloudflare.ts`.

## 6. Aseprite + extension Squarel (vẽ tay)

### 6.1. Có Aseprite

**Bản dùng thử (trial) không dùng được:** trial tắt chức năng lưu file và tắt scripting, nên extension Squarel và chế độ trao đổi qua file đều không chạy. Chọn một trong hai cách:

- **Tự build từ source bằng script của repo** (miễn phí). Xem [6.1a](#61a-tự-build-bằng-pnpm-asepritebuild), rồi bỏ qua 6.2.
- **Mua** (khoảng $19.99, trả một lần) trên Steam, itch.io hoặc <https://www.aseprite.org>. Rồi làm tiếp 6.2.

Cần **Aseprite 1.3 trở lên**: extension dùng WebSocket và `properties`, chỉ có từ 1.3.

### 6.1a. Tự build bằng `pnpm aseprite:build`

Script `scripts/aseprite-build.ts` làm đúng các bước trong `INSTALL.md` của Aseprite, nhưng tự động:

1. Kiểm tra trình biên dịch C++ (MSVC), CMake, Ninja, Git và dung lượng đĩa trống.
2. Clone source Aseprite (kèm submodule) vào `vendor\aseprite`, ở **bản phát hành ổn định mới nhất**. Chạy lại lần sau thì nó cập nhật lên bản mới.
3. Tải Skia dựng sẵn đúng phiên bản source yêu cầu, vào `vendor\deps`.
4. Cấu hình bằng CMake rồi build bằng Ninja.
5. Ghi `ASEPRITE_PATH=…\vendor\aseprite\build\bin\aseprite.exe` vào `.env`.

**Giấy phép:** EULA của Aseprite cho phép tự build **để dùng cá nhân**, không được chia sẻ bản build hay source. Thư mục `vendor\` đã nằm trong `.gitignore`: đừng commit hay gửi nó cho người khác.

**Cần khoảng 10GB đĩa trống:** khoảng 7GB cho Build Tools (cài một lần, ở ổ C), khoảng 3GB cho source và bản build.

Các bước:

1. Kiểm tra máy đã có gì:

   ```powershell
   pnpm aseprite:build -- --check
   ```

2. Nếu thiếu Visual Studio, CMake hoặc Ninja, cài bằng lệnh dưới. Nó gọi `winget` để cài **Visual Studio 2022 Build Tools**, chỉ gồm phần cần thiết: trình biên dịch C++, Windows 11 SDK, CMake và Ninja.
   - Windows sẽ hỏi quyền admin.
   - winget hỏi bạn đồng ý điều khoản: tự đọc rồi gõ `Y`.
   - Trình cài Visual Studio mở cửa sổ riêng với các mục đã chọn sẵn: bạn bấm **Install** (hoặc **Modify**) ở đó. Lệnh không tự đồng ý điều khoản và không cài ngầm.
   - Cài xong có thể phải khởi động lại máy.

   ```powershell
   pnpm aseprite:build -- --install-deps --check
   ```

   Muốn tự cài thay vì dùng lệnh trên: tải [Visual Studio 2022](https://visualstudio.microsoft.com/downloads/) (bản Community hoặc Build Tools), chọn workload **Desktop development with C++**, và tick đủ hai mục **Windows 11 SDK (10.0.26100)** và **C++ CMake tools for Windows**.

3. Build. Lần đầu mất 15–40 phút. Tải về khoảng 1GB.

   ```powershell
   pnpm aseprite:build
   ```

   Kết quả đúng: dòng `✓ Aseprite 1.3.x …` và `✓ ASEPRITE_PATH written to .env`.

4. Mở Aseprite vừa build bằng file `vendor\aseprite\build\bin\aseprite.exe`. Có thể chuột phải → *Pin to Start* hoặc tạo shortcut ra desktop.

Các tuỳ chọn khác:

| Lệnh | Việc |
|---|---|
| `pnpm aseprite:build` (chạy lại) | Cập nhật lên bản ổn định mới nhất và build lại. Chỉ biên dịch phần thay đổi nên nhanh hơn nhiều |
| `pnpm aseprite:build -- --ref v1.3.18.6` | Build đúng một phiên bản. `--ref main` để lấy code mới nhất (có thể chưa ổn định) |
| `pnpm aseprite:build -- --clean` | Xoá thư mục build, build lại từ đầu (dùng khi build lỗi lạ) |
| `pnpm aseprite:build -- --src D:\aseprite` | Đặt source ở chỗ khác thay vì `vendor\aseprite` |
| `pnpm aseprite:build -- --no-env` | Không sửa `.env` |
| `pnpm aseprite:build -- --help` | Xem trợ giúp |

Khi build lỗi: chạy lại với `--clean`. Nếu vẫn lỗi, gửi Claude khoảng 50 dòng cuối của output.

Build xong thì sang [6.3](#63-cài-extension); bước 6.2 đã được script làm.

### 6.2. Khai báo đường dẫn Aseprite (khi mua bản cài sẵn)

Tìm file `Aseprite.exe`:

| Cài từ | Đường dẫn thường gặp |
|---|---|
| Steam | `C:\Program Files (x86)\Steam\steamapps\common\Aseprite\Aseprite.exe` (Steam → chuột phải Aseprite → *Manage → Browse local files*) |
| Bộ cài từ aseprite.org | `C:\Program Files\Aseprite\Aseprite.exe` |
| itch.io | Thư mục bạn chọn |
| Tự build bằng `pnpm aseprite:build` | `<thư mục repo>\vendor\aseprite\build\bin\aseprite.exe` (script tự ghi vào `.env`) |

Ghi vào `.env`:

```
ASEPRITE_PATH=C:\Program Files (x86)\Steam\steamapps\common\Aseprite\Aseprite.exe
```

**Kiểm tra:** lệnh dưới chuyển một project sang `.aseprite` rồi đọc lại bằng Aseprite thật, và báo lỗi nếu kết quả khác bản gốc:

```powershell
pnpm aseprite:test
```

Đây cũng là lần đầu chạy với Aseprite thật. Nếu lỗi, gửi Claude toàn bộ output để sửa `integrations/aseprite/`.

### 6.3. Cài extension

1. Đóng gói:

   ```powershell
   pnpm aseprite:pack
   ```

   Lệnh này tạo `squarel.aseprite-extension` ở thư mục repo.
2. Nhấp đúp file đó, hoặc trong Aseprite vào **Edit → Preferences → Extensions → Add Extension** và chọn file.
3. Khởi động lại Aseprite. Menu **File** có thêm mục **Squarel** (ngay dưới *Scripts*).
4. Lần đầu extension kết nối mạng hoặc đọc file, Aseprite hiện cảnh báo bảo mật. Tick ô tin tưởng script này (*Give full trust…*) rồi cho phép.

### 6.4. Thử đồng bộ hai chiều

1. Mở Claude Code ở repo (bước 4). Server MCP tự bật bridge ở `ws://127.0.0.1:4321/bridge`.
   Muốn vẽ trong Aseprite mà không mở Claude Code thì chạy bridge riêng:

   ```powershell
   pnpm bridge
   ```

2. Trong Aseprite: **File → Squarel → Open project…** → chọn `thu`. Hoặc bảo Claude: "mở project thu trong Aseprite".
3. Bảo Claude: "thêm viền đen". Viền phải hiện ngay trong Aseprite. Bấm **Ctrl+Z** trong Aseprite để hoàn tác bước đó.
4. Vẽ vài nét trong Aseprite, chờ khoảng 1 giây, rồi hỏi Claude: "mình vừa vẽ gì?". Claude phải thấy nét vẽ của bạn.

Chi tiết về đồng bộ, giới hạn và bảo mật ở [aseprite.md](aseprite.md).

## 7. Retro Diffusion (tuỳ chọn, trả phí)

Retro Diffusion là model chuyên pixel art: ra ảnh đúng lưới ngay từ đầu, ép palette, làm được animation. Giá vào khoảng $0.015–0.18 mỗi ảnh tuỳ model. Tool **chỉ** dùng nó khi bạn yêu cầu `quality: "high"`, luôn báo giá trước và chờ bạn đồng ý.

1. Tạo tài khoản ở <https://www.retrodiffusion.ai> và nạp credit.
2. Trong tài khoản, vào phần API / developer và tạo API key.
3. Điền vào `.env`:

   ```
   RETRO_DIFFUSION_API_KEY=<key>
   IMAGE_DAILY_BUDGET_USD=1
   ```

   - `IMAGE_DAILY_BUDGET_USD`: trần tiền ảnh mỗi ngày. Vượt trần thì tool từ chối và báo lỗi `BUDGET`.
   - `RETRO_DIFFUSION_USD_PER_CREDIT` (mặc định `0.01`): giá 1 credit theo bảng giá lúc bạn mua. Đặt đúng để số $ báo trước và trần chi phí tính cho chính xác.
   - `RETRO_DIFFUSION_STYLE` (mặc định `rd_fast__default`), `RETRO_DIFFUSION_ANIM_STYLE` (mặc định `animation__four_angle_walking`): đổi model khi cần.

**Kiểm tra:** lệnh đầu chỉ hỏi giá, **không tốn tiền**. Nó phải báo lỗi `[NEEDS_CONFIRM]` kèm số tiền:

```powershell
pnpm cli generate_image --art thu --prompt "a red apple" --variants 1 --quality high
```

Đồng ý với giá đó thì chạy thật (**tốn tiền**):

```powershell
pnpm cli generate_image --art thu --prompt "a red apple" --variants 1 --quality high --confirm_cost true
```

Trong Claude Code, quy trình này tự động: Claude báo giá và hỏi bạn trước khi gọi.

**Lưu ý:** phần gọi Retro Diffusion mới chỉ được test với dữ liệu giả. Nếu API báo lỗi tên trường, gửi Claude nội dung lỗi để sửa `src/providers/retrodiffusion.ts`.

## 8. GPU của máy: local-sd (tuỳ chọn)

Chạy Stable Diffusion 1.5 trên GPU NVIDIA của máy (GTX 1650 4GB chạy được, khoảng 20–60 giây/ảnh). Miễn phí, không cần mạng sau lần tải model đầu tiên (~4GB). Chất lượng kém Cloudflare FLUX; chủ yếu dùng khi offline hoặc hết quota Cloudflare.

1. Cập nhật driver NVIDIA mới nhất.
2. Cài Python 3.11:

   ```powershell
   winget install Python.Python.3.11
   ```

3. Làm theo [services/local-sd/README.md](../services/local-sd/README.md): tạo venv, cài PyTorch bản CUDA, cài thư viện, chạy `uvicorn` ở cổng 7861.
4. Trong `.env`:
   - `IMAGE_PROVIDER=local-sd` nếu muốn dùng nó làm mặc định;
   - hoặc giữ `cloudflare`, khi đó local-sd tự làm dự phòng lúc Cloudflare lỗi (miễn là service đang chạy).

**Kiểm tra:**

```powershell
pnpm cli generate_image --art thu --prompt "a red apple" --variants 1 --provider local-sd
```

Service local-sd mới được kiểm tra cú pháp, chưa chạy thật. Nếu lỗi, gửi Claude output của cửa sổ `uvicorn`.

## 9. Dùng ở dự án khác và backup

**Dùng Squarel khi mở Claude Code ở thư mục khác.** Lệnh dưới thêm server cho mọi project của bạn. `.env` vẫn được đọc từ thư mục repo này, nên không phải cấu hình lại:

```powershell
claude mcp add squarel --scope user -- node <thư mục repo>\src\mcp\index.ts
```

Các skill `/pixel-new`, `/pixel-export`… nằm trong repo này nên chỉ có khi mở Claude Code ở đây. Muốn dùng mọi nơi, copy thư mục `.claude\skills\pixel-*` vào `C:\Users\<tên>\.claude\skills\`.

**Backup:** mọi thứ nằm trong `DATA_DIR`, gồm project, mọi version, đề xuất AI, file xuất và `usage.jsonl`. Đặt `DATA_DIR` trong OneDrive/Google Drive, hoặc copy thư mục đó định kỳ. Không cần backup gì khác.

---

## Checklist cuối

- [ ] `pnpm check` qua hết test
- [ ] Claude Code gọi được `usage_today`
- [ ] `/pixel-new` chạy với `mock`
- [ ] Cloudflare tạo được ảnh thật, `usage_today` báo neuron đã dùng
- [ ] `pnpm aseprite:test` qua
- [ ] Menu Squarel có trong Aseprite; Claude sửa thì Aseprite cập nhật, bạn vẽ thì Claude thấy
- [ ] (Tuỳ chọn) Retro Diffusion báo giá `NEEDS_CONFIRM` đúng
- [ ] (Tuỳ chọn) local-sd tạo được ảnh

## Xử lý sự cố

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `Unknown file extension ".ts"` hoặc lỗi cú pháp khi chạy `pnpm …` | Node quá cũ. Cần ≥ 22.18; kiểm tra `node -v` |
| `pnpm` không nhận lệnh sau khi cài | Đóng PowerShell, mở lại |
| `pnpm install` lỗi ở `sharp` | Chạy lại `pnpm install`; nếu vẫn lỗi, xoá `node_modules` rồi cài lại |
| Claude không thấy tool `squarel` | Phải mở Claude Code đúng thư mục repo (có `.mcp.json`) và đã cho phép server. Kiểm tra bằng `claude mcp list` trong terminal. Xem log `DATA_DIR\logs\mcp-*.log` |
| `cloudflare [not configured]` trong `usage_today` | Thiếu hoặc sai tên biến `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` trong `.env`. Sửa xong phải mở lại phiên Claude Code để server đọc lại `.env` |
| Cloudflare lỗi `401` / `403` | Token sai, đã bị xoá, hoặc thiếu quyền Workers AI. Tạo token mới (bước 5) |
| Cloudflare báo hết quota | Đã dùng hết 10.000 neuron hôm nay. Chờ đến 7:00 sáng, hoặc dùng `local-sd` / `mock` |
| `pnpm aseprite:build` báo `missing: Visual Studio…` | Chạy `pnpm aseprite:build -- --install-deps --check` (bước 6.1a), rồi bấm Install trong cửa sổ Visual Studio Installer |
| Build Aseprite lỗi giữa chừng | Chạy lại với `--clean`. Nếu vẫn lỗi, gửi Claude phần cuối output |
| Không có menu Squarel trong Aseprite | Đang dùng bản trial, Aseprite cũ hơn 1.3, hoặc chưa cài extension (bước 6.3) |
| Aseprite không kết nối | Cần Claude Code đang mở ở repo hoặc `pnpm bridge` đang chạy. Xem thêm [aseprite.md](aseprite.md#xử-lý-sự-cố) |
| `Port 4321 is already in use` | Bridge đã chạy kèm Claude Code, không cần chạy `pnpm bridge` nữa. Nếu do chương trình khác, đổi `BRIDGE_PORT` trong `.env` và trong *File → Squarel → Settings…* |
| Tool báo `[BUDGET]` | Đã chạm `IMAGE_DAILY_BUDGET_USD` hôm nay. Tăng trần trong `.env` hoặc chờ sang ngày |

Mọi lỗi đều được ghi vào `DATA_DIR\logs\` (đã che key). Khi nhờ Claude sửa lỗi, gửi kèm file log tương ứng.
