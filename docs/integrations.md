# Viết tích hợp cho launcher

Launcher dựng icon, trang công cụ, menu mở và các bước kiểm tra của mỗi tích hợp **chỉ từ một file manifest**. Tích hợp mới không cần sửa code launcher.

Schema nằm ở `integrations/schema/integration.schema.ts` (zod, `schema: 1`). Manifest sai schema bị từ chối, không chạy một phần.

## Vị trí file

| Loại | Thư mục |
|---|---|
| Có sẵn trong repo | `integrations/<id>/integration.json` |
| Của người dùng | `%APPDATA%\SquarelArt Launcher\integrations\<id>\integration.json` |

- Tên thư mục phải trùng `id`.
- Icon là file PNG 16×16 nằm cùng thư mục. Trường `icon` trong manifest chỉ là tên file.
- `run` của tích hợp người dùng chạy từ chính thư mục tích hợp. `run` của tích hợp có sẵn chạy từ thư mục Squarel.
- `integrations/catalog.json` liệt kê các tích hợp "sắp có": `{ "schema": 1, "comingSoon": [...] }`. Mỗi mục có `id`, `name`, `description`, `icon` (1–2 ký tự vẽ trên ô màu `accent`, không có file icon), `accent` và `status: "coming-soon"`.

## Quy tắc schema

- `run` luôn là **mảng argv** (ít nhất một phần tử), không phải chuỗi shell.
- Đường dẫn có thể dùng biến môi trường Windows dạng `%VAR%`. Launcher tự mở rộng.
- Schema `strict`: trường lạ bị từ chối. Thêm bất kỳ trường mới nào đều phải nâng lên `schema: 2`.
- `id` khớp `^[a-z][a-z0-9-]{1,31}$`. Áp dụng cho `id` của tích hợp, của từng mục `install`, `launch`, `checks`, và cho `bridge.client`.
- `id` không được trùng trong cùng một danh sách `install`, `launch` hoặc `checks` (và `comingSoon` của catalog).
- `accent` là `#RRGGBB`.
- `icon` phải là tên file `.png` (chỉ gồm chữ, số, `_`, `.`, `-`), không có đường dẫn.
- `platforms` có ít nhất một giá trị trong `win32`, `darwin`, `linux`.
- `launch` có ít nhất một mục và **đúng một** mục có `default: true`.
- Các cặp "đúng một trong": `install[]` là `run` | `pickFile`; `launch[]` là `run` | `bridgeTool` | `reveal`; `checks[]` là `builtin` | `run`.
- `builtin` chỉ nhận `detect`, `bridge-client`, `extension-version`.
- `setEnv` cần `pickFile`. `env` của `launch[]` cần `run`. `pickProject` cần `bridgeTool`.
- `detect` cần `env` hoặc `candidates`; khi có `candidates` thì phải có ít nhất 1 phần tử.
- Check `builtin: "bridge-client"` cần mục `bridge`; check `builtin: "extension-version"` cần mục `extension`.
- `latest.repo` phải là URL `https`.
- Khoá của `launch[].env` khớp `^[A-Za-z_][A-Za-z0-9_]*$`.

## Biến thay thế

Chỉ năm biến sau, viết `{tên}`. Biến khác bị từ chối khi nạp manifest.

| Biến | Giá trị |
|---|---|
| `{toolsDir}` | Thư mục công cụ của launcher |
| `{exe}` | Đường dẫn file chạy đã dò được |
| `{exeDir}` | Thư mục chứa `{exe}` |
| `{version}` | Phiên bản (xem `latest`) |
| `{recentProject}` | Project gần nhất |

- Được dùng trong `label` (của `install`, `launch`, `checks`), trong từng phần tử của `run`, và trong `launch[].reveal`.
- Biến không có giá trị lúc chạy thì báo lỗi.
- Giá trị được chèn nguyên văn, không mở rộng lần hai. Dấu `{` `}` không tạo thành `{tên}` (ví dụ lượng từ regex `{2}`) được giữ nguyên.

## Các trường

### Cấp ngoài

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `schema` | có | Luôn là `1` |
| `id` | có | Trùng tên thư mục |
| `name`, `description` | có | Chuỗi không rỗng |
| `icon` | có | Tên file PNG 16×16 |
| `accent` | có | Màu nhấn `#RRGGBB` |
| `platforms` | có | Hệ điều hành hỗ trợ |
| `detect` | có | Cách tìm bản đã cài |
| `latest` | không | Nguồn phiên bản mới nhất |
| `install` | có | Các cách cài (mảng có thể rỗng) |
| `update` | không | Cách cập nhật |
| `extension` | không | Extension đi kèm cần cài vào công cụ |
| `bridge` | không | `{ "client": "<id>" }`: công cụ nói giao thức bridge, gửi `hello` với `client` này |
| `launch` | có | Menu mở, ít nhất một mục |
| `checks` | có | Các bước kiểm tra (mảng có thể rỗng) |

### `detect`

| Trường | Ý nghĩa |
|---|---|
| `env` | Biến môi trường chứa đường dẫn file chạy (kiểm tra trước) |
| `candidates` | Danh sách đường dẫn thử, cho phép `%VAR%`. Cái nào tồn tại trước thì dùng |
| `version` | `{ "args": [...], "pattern": "<regex>" }`: chạy `exe ...args`, lấy nhóm bắt đầu tiên của `pattern` làm phiên bản |

### `latest`

`{ "type": "git-tags", "repo": "<url>", "stable": true }`. `type` chỉ có `git-tags`. `stable: true` bỏ tag beta/rc.

### `install[]`

| Trường | Ý nghĩa |
|---|---|
| `id`, `label` | Bắt buộc |
| `note` | Ghi chú hiển thị |
| `run` | Lệnh cài |
| `pickFile` | Cho người dùng chọn file chạy có tên này |
| `setEnv` | Lưu đường dẫn đã chọn vào biến môi trường này. Chỉ đi với `pickFile` |

### `update` và `extension.install`

`{ "run": [...], "requiresClosed": "aseprite.exe" }`. Khi tiến trình `requiresClosed` đang chạy, lệnh không được chạy.

### `extension`

| Trường | Ý nghĩa |
|---|---|
| `version.source` | `package.json` của extension trong repo |
| `version.installed` | `package.json` của extension đã cài (cho phép `%VAR%`) |
| `install` | Task như trên |

### `launch[]`

| Trường | Ý nghĩa |
|---|---|
| `id`, `label` | Bắt buộc |
| `default` | `true` cho nút Mở chính |
| `run` | Chạy argv |
| `env` | Biến môi trường thêm cho `run` |
| `bridgeTool` | Gọi tool này qua bridge như Claude gọi. Launcher gửi `tool { name: bridgeTool, input: { art } }`, với `art` là art người dùng chọn khi có `pickProject`, nếu không thì `{recentProject}`. Biến thay thế không áp dụng cho giá trị `bridgeTool` và `env` |
| `pickProject` | Hỏi người dùng chọn project trước, rồi truyền cho `bridgeTool` |
| `reveal` | Mở thư mục này trong trình quản lý file |

### `checks[]`

| Trường | Ý nghĩa |
|---|---|
| `id`, `label` | Bắt buộc |
| `builtin` | Check có sẵn trong launcher |
| `run` | Lệnh tự chọn, đạt khi exit code 0 |
| `manual` | `true` thì chỉ chạy khi người dùng yêu cầu (chậm hoặc can thiệp nhiều) |

Check có sẵn:

| `builtin` | Kiểm tra |
|---|---|
| `detect` | Tìm thấy file chạy |
| `bridge-client` | Client có tên `bridge.client` đang kết nối bridge (hỏi bằng tin nhắn `status`) |
| `extension-version` | Bản extension đã cài so với bản trong repo (`extension.version`) |

## Ví dụ: Aseprite

`integrations/aseprite/integration.json`:

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
      "run": ["pnpm", "aseprite:build", "--", "--src", "{toolsDir}", "--json-progress"] },
    { "id": "existing", "label": "Đã có Aseprite", "pickFile": "aseprite.exe", "setEnv": "ASEPRITE_PATH" }
  ],
  "update": { "run": ["pnpm", "aseprite:build", "--", "--src", "{toolsDir}", "--ref", "{version}", "--json-progress"], "requiresClosed": "aseprite.exe" },
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

## Giao thức bridge

Bridge nghe `ws://127.0.0.1:4321/bridge` (cổng 4321, hoặc `BRIDGE_PORT`) (xem `src/bridge/protocol.ts`). Công cụ nói giao thức này gửi `hello` ngay sau khi nối. Mọi tin nhắn là JSON.

| Hướng | Tin nhắn | Ý nghĩa |
|---|---|---|
| client → bridge | `hello { client, ext?, app?, aseprite? }` | Bắt tay. `app` là phiên bản công cụ; `aseprite` là tên cũ của `app` |
| bridge → client | `welcome { server, version, projects }` | Trả lời `hello` |
| client → bridge | `list` | Xin danh sách project |
| bridge → client | `projects { projects }` | Mỗi phần tử `{ slug, name, head }` |
| client → bridge | `open { slug }` | Mở một project |
| bridge → client | `doc { slug, versionId, doc }` | Toàn bộ PixelDoc |
| client → bridge | `cels { slug, baseVersion, doc, label? }` | Trạng thái sau khi vẽ |
| bridge → client | `ack { slug, versionId }` | Ghi thành công |
| bridge → client | `rebased { slug, versionId, doc, warnings }` | Đã gộp với thay đổi mới hơn |
| bridge → client | `doc.updated { slug, versionId, source, label, doc }` | Có version mới từ nơi khác |
| bridge → client | `open.request { slug }` | `open_in_editor` yêu cầu mở project |
| client → bridge | `tool { id, name, input?, slug? }` | Gọi một tool |
| bridge → client | `tool_result { id, ok, text, files? }` | Kết quả tool |
| client → bridge | `ping` | Giữ kết nối |
| bridge → client | `pong` | Trả lời `ping` |
| client → bridge | `status` | Hỏi ai đang kết nối |
| bridge → client | `status { version, clients }` | `clients` là mảng `{ name, ext?, app?, slug?, version?, connectedAt, lastSeen }`. `name` là `client` trong `hello`. `version` của mỗi client là id version PixelDoc (ví dụ `v000002`) mà client nhận hoặc ghi gần nhất, không phải phiên bản công cụ (đó là `app`) |
| bridge → client | `error { code, message }` | Lỗi |

- Có thể gửi `status` mà không cần `hello` trước. Client chưa gửi `hello` có `name` là `unknown`.
- `bridgeTool` trong `launch` gửi `tool`. Ví dụ `open_in_editor` với `input: { art: "<slug>" }`.
- Chỉ thêm loại tin nhắn hoặc trường mới. Hình dạng tin nhắn đã có không đổi, để client cũ vẫn chạy.
- Bridge chỉ nghe `127.0.0.1` và chặn Origin của trang web (xem [aseprite.md](aseprite.md#bảo-mật)).

## File phiên MCP

Mỗi tiến trình MCP ghi `DATA_DIR/run/mcp-<pid>.json` để launcher biết đang có Claude Code nào chạy.

| Trường | Ý nghĩa |
|---|---|
| `pid` | Mã tiến trình |
| `cwd` | Thư mục làm việc |
| `version` | Phiên bản Squarel |
| `startedAt`, `updatedAt` | Thời điểm (ISO 8601) |
| `lastTool`, `lastToolAt` | Tool vừa gọi gần nhất (có sau lần gọi đầu tiên) |
| `bridge` | `own` (tiến trình này giữ bridge), `shared` (bridge của tiến trình khác), `none` (`SQUAREL_NO_BRIDGE=1`) |
| `workspace` | `{ id, name }` của dự án mà phiên nhận ra từ thư mục (`.squarel/project.json`). Không có khi phiên không thuộc dự án nào. Launcher dùng `name` để hiện "Phiên · <tên dự án>" |

- Ghi lại mỗi 10 giây và sau mỗi lần gọi tool. Xoá khi thoát.
- Chỉ đọc file khớp `^mcp-\d+\.json$`. Ghi nguyên tử có thể để lại file `.tmp` sau khi tiến trình chết đột ngột.
- Launcher coi file là cũ nếu `updatedAt` quá 30 giây.

## Tiến độ và tắt đồng bộ

- `pnpm aseprite:build -- --json-progress` in thêm các dòng `@@progress {json}` cho launcher. Xem [aseprite.md](aseprite.md#tiến-độ-cho-launcher---json-progress).
- Biến môi trường `SQUAREL_NO_SYNC=1` làm extension Aseprite không tự kết nối. Mục `open-plain` trong ví dụ trên dùng nó. Xem [aseprite.md](aseprite.md#mở-không-đồng-bộ-squarel_no_sync).
