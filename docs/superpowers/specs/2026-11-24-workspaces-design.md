# Dự án (workspace): thiết kế

Ngày: 2026-11-24. Hướng đã chọn: **A, file trong thư mục là gốc**. Figma: section "4 · Dự án (workspace)" trong file Launcher (3 màn: danh sách, Dự án mới, chi tiết, cùng ghi chú hành vi).

## 1. Mục đích

Người dùng mở nhiều phiên Claude Code ở nhiều thư mục khác nhau. Hiện nay mỗi phiên mới không biết mình đang làm cho cái gì: "project" trong Squarel chỉ là một bức art, và art đang mở chỉ được nhớ trong bộ nhớ của từng phiên. Dự án gom nhiều art cho cùng một mục đích (game, bộ sticker, bản in) và gắn với một thư mục. Mở Claude ở thư mục đó (hoặc thư mục con) thì Claude biết ngay: dự án nào, brief ra sao, mặc định gì, đã có những art nào.

Luồng chính: Launcher → **Dự án mới** (tên, thư mục, mô tả, brief, mặc định, repo, nơi nhận file xuất) → **Mở Claude** → người dùng chat luôn.

## 2. Mục tiêu và không làm

Mục tiêu:
- Mở Claude Code trong thư mục dự án hoặc bất kỳ thư mục con nào thì Squarel tự nhận dự án, không cần lệnh nào.
- Ngữ cảnh nằm ở chỗ chuẩn mà mọi agent đọc: `AGENTS.md` (Codex, Cursor, Gemini CLI), `CLAUDE.md` import `@AGENTS.md` (Claude Code), cùng MCP server instructions cho trạng thái đang thay đổi.
- Art mới tạo trong phiên thuộc dự án đó và dùng mặc định của dự án.
- File xuất được chép thêm vào thư mục đích trong dự án (ví dụ repo game).
- Launcher có trang Dự án: danh sách, tạo mới, chi tiết, nút Mở Claude.

Không làm (lần này):
- Không đổi tên tool `project_*`. Trong code "project" vẫn là một art, cấp mới tên là **workspace**. Giao diện gọi là "Dự án" và "Art".
- Không di chuyển art giữa dự án từ launcher (Claude làm qua tool `workspace_add_art`).
- Không tìm kiếm ngữ nghĩa (embedding). Danh mục art dạng file đủ cho search agent; `art_search` để sau.
- Không tạo dự án từ Claude (`workspace_create`), không hook SessionStart.

Không được phép (anti-goal):
- Không xoá hay ghi đè nội dung người dùng: `AGENTS.md` và `CLAUDE.md` có sẵn chỉ được thêm (khối có đánh dấu, một dòng import).
- Gỡ dự án khỏi launcher không xoá thư mục, file hay art.
- Không chạy lệnh ẩn: Mở Claude là cửa sổ terminal nhìn thấy được.

## 3. Định dạng dữ liệu (hợp đồng chung Squarel ↔ launcher)

### 3.1 Trong thư mục dự án

```
<folder>/
  AGENTS.md                 khối <!-- squarel:begin --> … <!-- squarel:end --> do launcher quản lý
  CLAUDE.md                 có dòng "@AGENTS.md"
  .squarel/project.json     cấu hình dự án (nguồn sự thật)
  .squarel/arts.md          danh mục art, Squarel tự sinh
```

`.squarel/project.json`:

```json
{
  "schema": 1,
  "id": "game-dungeon",
  "name": "Game dungeon",
  "description": "Game roguelike 2D…",
  "brief": "Sprite 32×32, viền đen 1px…",
  "defaults": { "purpose": "game", "width": 32, "height": 32, "palette": "pico8" },
  "repos": ["game-client", "D:\\code\\shared-assets"],
  "exportDir": "game-client/assets/sprites"
}
```

- `id`: `^[a-z0-9][a-z0-9-]{0,63}$`, duy nhất trong `DATA_DIR/workspaces`.
- `name` 1–80 ký tự; `description` ≤ 2000; `brief` ≤ 8000.
- `defaults.purpose` ∈ game|print|digital|craft; `width`,`height` 1–256; `palette` là tên preset của Squarel (`pico8`, `sweetie16`, `db16`, `gameboy`, `grayscale4`, `bw`) hoặc bỏ trống (tự do). Mọi trường của `defaults` đều tuỳ chọn.
- `repos`: đường dẫn tương đối (nằm trong thư mục dự án) hoặc tuyệt đối (ở ngoài). Tối đa 20.
- `exportDir`: tương đối, phải nằm trong thư mục dự án sau khi resolve (không `..` thoát ra ngoài). Tuỳ chọn.
- Trường lạ được giữ nguyên khi launcher ghi lại (forward compatible).

Khối quản lý trong `AGENTS.md` (tiếng Anh cho tiêu đề, nội dung là chữ của người dùng):

```markdown
<!-- squarel:begin (managed by Squarel Art Launcher; edits inside this block are replaced) -->
# Game dungeon

Game roguelike 2D…

## Art brief

Sprite 32×32…

## Squarel
- Pixel art for this project is made with the `squarel` MCP tools; new art joins this project automatically.
- Defaults for new art: game, 32×32, palette pico8.
- Art catalog: `.squarel/arts.md`. Exports are also copied to `game-client/assets/sprites`.
- Repos: `game-client` (inside), `D:\code\shared-assets` (outside).
<!-- squarel:end -->
```

Nếu `AGENTS.md` chưa có thì tạo với khối này. Nếu có mà chưa có khối thì chèn khối lên đầu file, giữ nguyên phần còn lại. Nếu đã có khối thì chỉ thay khối.

`CLAUDE.md`: chưa có thì tạo với nội dung `@AGENTS.md\n`. Có rồi mà chưa có dòng `@AGENTS.md` thì thêm dòng đó lên đầu. Không đụng gì khác.

### 3.2 Trong DATA_DIR

- `DATA_DIR/workspaces/<id>.json`: `{ "schema": 1, "id", "name", "folder", "createdAt" }`, chỉ là chỉ mục để launcher liệt kê và Squarel tìm thư mục khi cần cập nhật danh mục. Launcher ghi khi tạo, xoá khi gỡ. Squarel ghi lại (tự sửa) khi gặp thư mục có `.squarel/project.json` mà chỉ mục thiếu hoặc lệch thư mục.
- Art: `DATA_DIR/projects/<slug>/project.json` thêm trường tuỳ chọn `"workspace": "<id>"`. Art không có trường này là **Chưa phân loại**.
- `DATA_DIR/projects/<slug>/thumb.png`: ảnh nhỏ (cạnh dài ≤ 128, frame 0), Squarel ghi lại sau mỗi lần tạo hoặc commit. Launcher hiển thị.

## 4. Squarel (MCP, store, bridge)

- **Nhận dự án:** lúc khởi động, thư mục bắt đầu là `CLAUDE_PROJECT_DIR` nếu có, không thì `process.cwd()`. Dò ngược lên các thư mục cha (tối đa 32 cấp) tới khi gặp `.squarel/project.json` hợp lệ. Không gặp thì không có dự án (mọi thứ như cũ). File hỏng thì ghi log cảnh báo và coi như không có dự án.
- **Server instructions:** thêm đoạn mô tả dự án (tên, thư mục, mặc định, số art và vài art mới nhất, chỗ của brief và danh mục). Không có dự án thì instructions như cũ.
- **project_list:** khi có dự án, chỉ liệt kê art của dự án; tham số `all: true` liệt kê tất cả kèm dự án của từng art.
- **project_create:** `width`, `height`, `purpose`, `palette` lấy từ mặc định của dự án khi bỏ trống (không có dự án và thiếu kích thước thì báo lỗi rõ). Art mới gắn `workspace`. Mọi đường tạo art khác (ví dụ `photo_to_pixel` với `asNewProject`) cũng gắn dự án.
- **Tool mới `workspace_info`** (chỉ đọc): dự án hiện tại (tên, thư mục, mô tả, brief, mặc định, repo, exportDir, danh sách art). Không có dự án thì trả lời rõ là không có và cách tạo (launcher).
- **Tool mới `workspace_add_art`** `{ project }`: chuyển một art (kể cả Chưa phân loại) vào dự án hiện tại.
- **export:** nếu art thuộc dự án có `exportDir` thì chép thêm các file vừa xuất vào `<folder>/<exportDir>` (tạo thư mục nếu cần), trả về cả hai đường dẫn.
- **Danh mục `.squarel/arts.md`:** sinh lại sau khi tạo art, commit, `workspace_add_art`, và lúc MCP khởi động. Áp dụng cho mọi tiến trình dùng store (MCP, bridge khi Aseprite gửi nét vẽ). Ghi kiểu tạm + rename, lỗi ghi không làm hỏng commit.
- **File phiên** `DATA_DIR/run/mcp-<pid>.json` thêm `workspace?: { id, name }`.
- **Skill** `pixel-new` (và `pixel-art`): có dự án thì dùng brief và mặc định, không hỏi lại điều đã có.

## 5. Launcher

### 5.1 Main

- Module `workspaces.ts` thuần (Deps tiêm vào, như các module khác): đọc chỉ mục và thư mục, tạo, cập nhật, gỡ, đọc art của dự án (kèm thumb), art chưa phân loại.
- Kiểm tra đầu vào bằng zod ở IPC; đường dẫn thư mục là tuyệt đối trên máy (không UNC); repo tuyệt đối phải là thư mục tồn tại; `exportDir` không thoát khỏi thư mục dự án.
- Tạo dự án: thư mục chưa có thì tạo. Thư mục đã có `.squarel/project.json` thì **đăng ký lại dự án đó** (không ghi đè), trả về dự án đã có.
- IPC mới: `workspaces:list`, `workspaces:get {id}`, `workspaces:create`, `workspaces:update {id, patch}`, `workspaces:remove {id}`, `workspaces:openClaude {id}`, `workspaces:openFolder {id}`, `workspaces:unassigned`.
- **Mở Claude:** cửa sổ terminal nhìn thấy được (cùng cơ chế `cmd /d /c start` đã có), `cwd` = thư mục dự án, chạy `claude.exe` (đường dẫn tuyệt đối tìm trên PATH) với `--add-dir <repo>` cho mỗi repo ở ngoài thư mục, và biến môi trường `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` khi có repo ngoài. Đường dẫn trong argv được phép có chữ Unicode (tên thư mục tiếng Việt) nhưng vẫn cấm ký tự đặc biệt của cmd (`& | < > ^ % ! " ( )` …). Không tìm thấy Claude Code thì báo lỗi kèm gợi ý cài.
- Panel Kết nối: phiên có `workspace` hiện "Phiên · <tên dự án>".

### 5.2 Giao diện (theo Figma)

- Thanh trái: mục **Dự án** (icon folder) ngay sau Trang chủ.
- **Dự án** (danh sách): thẻ mỗi dự án (thumb tối đa 3 art, mục đích, tên, thư mục, số art, lúc cập nhật, số phiên Claude đang mở, nút Mở Claude và Chi tiết), thẻ **Chưa phân loại**, thẻ **Dự án mới**, thẻ mẹo. Thư mục không còn tồn tại: thẻ báo lỗi, chỉ có Gỡ.
- **Dự án mới**: 2 cột. Trái: Thông tin (tên, thư mục với nút Chọn…, mô tả), Brief cho AI. Phải: Mặc định cho art mới (mục đích, rộng, cao, palette), Repo gắn kèm (thêm/bỏ, nhãn trong thư mục / ở ngoài · --add-dir, thư mục nhận file xuất), Launcher sẽ ghi (tạo mới hay thêm vào cho từng file). Chân: Huỷ, Tạo dự án, Tạo và mở Claude.
- **Chi tiết**: tiêu đề, thư mục, nút Mở Claude (kèm menu: Mở thư mục), tab Tổng quan (lưới art, phiên Claude, repo, brief tóm tắt), Brief (sửa mô tả và brief, lưu ghi lại AGENTS.md), Cài đặt (mặc định, repo, exportDir, Gỡ khỏi launcher có xác nhận).

## 6. Các hướng đã cân nhắc

- **A. File trong thư mục là gốc (đã chọn):** chạy được không cần launcher, với mọi agent và mọi kiểu mở Claude; brief đi cùng repo trong git. Đổi lại thư mục người dùng có thêm vài file.
- **B. Launcher giữ hết, chèn ngữ cảnh lúc mở:** thư mục sạch nhưng mở Claude bằng cách khác là mất ngữ cảnh, chỉ dùng được với Claude.
- **C. Dữ liệu ở DATA_DIR, thư mục chỉ có dấu:** ít file nhất nhưng phụ thuộc client hiển thị MCP instructions; search agent không thấy gì.

## 7. Kiểm thử

- Squarel (vitest): dò ngược thư mục; file hỏng; mặc định khi tạo art; lọc `project_list` và `all`; `workspace_info`, `workspace_add_art`; chép file xuất vào exportDir (và chặn thoát thư mục); danh mục được sinh lại sau commit từ tiến trình khác; instructions có đoạn dự án; presence có workspace.
- Launcher (vitest): ghép khối AGENTS.md (chưa có / có không khối / có khối), CLAUDE.md, giữ trường lạ, kiểm tra đường dẫn, đăng ký lại thư mục đã có, argv Mở Claude (cwd, --add-dir chỉ cho repo ngoài, Unicode được, ký tự cmd bị chặn).
- Launcher e2e (Playwright, fake mode): tạo dự án qua form (stub hộp thoại), file được ghi đúng, thẻ hiện trong danh sách, trang chi tiết hiện art của dự án, Mở Claude mở terminal đúng thư mục và argv, sửa brief ghi lại AGENTS.md, gỡ dự án không xoá file.

## 8. Quyết định builder tự chốt

- Tên trong code: `workspace`; giao diện: "Dự án"/"Art". Lý do: không phá tool `project_*` và skill hiện có.
- `.squarel/project.json` giữ mô tả và brief; `AGENTS.md` chỉ là bản sinh ra (khối quản lý). Sửa trong khối sẽ bị thay ở lần lưu sau; điều này ghi ngay trong dòng mở khối.
- Danh mục art là Markdown để agent nào cũng đọc được; thumb nằm trong DATA_DIR để không làm bẩn repo.

## 9. Ghi chú sau khi triển khai

- Thêm kênh `workspaces:inspectFolder` để form "Launcher sẽ ghi" biết mỗi file sẽ được tạo mới, thêm vào hay giữ nguyên.
- Thư mục dự án mới và repo ở ngoài chỉ nhận đường dẫn chọn qua hộp thoại trong phiên (hoặc thư mục con mới ngay trong thư mục đã chọn), giống cách launcher đã làm với thư mục Squarel và DATA_DIR.
- Squarel không tự tạo chỉ mục `DATA_DIR/workspaces/<id>.json` (gỡ dự án thì giữ nguyên là gỡ). Nó chỉ sửa đường dẫn khi thư mục cũ không còn dự án đó. Id mới không dùng lại id còn nằm trong art hay thư mục nào.
- Quy tắc thư mục xuất dùng chung hai bên: không rỗng, không phải chính thư mục dự án, không tuyệt đối, không thoát ra ngoài. Thư mục xuất sai thì vẫn xuất vào `exports/` và báo cảnh báo, không làm hỏng lần xuất.
- Squarel đọc `.squarel/project.json` dễ dãi: chỉ cần `id` và `name` hợp lệ, trường sai bị bỏ qua kèm cảnh báo; palette so khớp không phân biệt hoa thường và dấu `-`.
- `CLAUDE.md` là symlink hoặc cùng file với `AGENTS.md` thì không bị sửa; `AGENTS.md` là symlink thì ghi vào file đích. Thiếu dòng kết thúc khối thì báo lỗi thay vì chèn khối thứ hai.
- Mở Claude chạy `cmd /d /k call <claude.exe> …` để đường dẫn có dấu cách (tên người dùng Windows) vẫn chạy; đã thử trên máy thật. Lệnh cài winget dùng cùng cách.
- Trang chi tiết có danh sách phiên (`sessionList`), không chỉ số đếm.
