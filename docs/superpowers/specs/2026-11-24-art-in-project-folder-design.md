# Art nằm trong thư mục Dự án: thiết kế

Ngày: 2026-11-24. Thay thế §3.2, một phần §4 và §5 của [2026-11-24-workspaces-design.md](2026-11-24-workspaces-design.md) (Dự án tied to a folder). Phần AGENTS.md, CLAUDE.md, `.squarel/project.json`, nhận dự án bằng cách dò ngược thư mục, Mở Claude: giữ nguyên.

## 1. Mục đích

Hiện có hai thứ cùng tên "project" mà không liên quan gì về vị trí. **Dự án** là một thư mục (`.squarel/project.json`). Còn "project" trong Squarel thực ra là **một bức art**, nằm ở `DATA_DIR/projects/<slug>/`, chung chỗ với log và ngân sách AI. Người dùng mở Claude trong thư mục dự án, vẽ, rồi art lại nằm ở một nơi khác hẳn. Art thuộc dự án chỉ nhờ một trường `workspace` trong DATA_DIR.

Sau thay đổi này: **art của dự án nằm trong thư mục dự án**, ở `<thư mục>/squarel_art/`, mỗi art một thư mục với bố cục như trước. Không có dự án thì không vẽ art. DATA_DIR chỉ còn giữ những thứ không thuộc dự án nào.

## 2. Mục tiêu, không làm, không được phép

Mục tiêu:
- Mỗi dự án có `squarel_art/`, tạo tự động khi chưa có. Trong đó, mỗi art là `squarel_art/<art-id>/` với `project.json`, `versions/`, `proposals/`, `exports/`, `work.aseprite`, `thumb.png` như hiện nay.
- Art chỉ được tạo, sửa, xuất khi Claude (hoặc CLI) đang ở trong một dự án.
- Mỗi art có định danh duy nhất trên máy là **`<id dự án>/<id art>`**. Id dự án là `id` trong `.squarel/project.json`. Id art là tên thư mục (slug), duy nhất trong dự án.
- Bridge Aseprite (một tiến trình cho mọi phiên), extension Aseprite và launcher đều dùng định danh này.
- Art cũ trong `DATA_DIR/projects` không mất. Người dùng chuyển chúng vào dự án, kèm cả lịch sử, bằng một thao tác rõ ràng.
- Từ ngữ thống nhất: **Dự án** (project) và **Art** (art), cả trong tên tool lẫn giao diện.

Không làm (lần này):
- Không tự động chuyển art cũ.
- Không chuyển art giữa hai dự án. Chỉ có chiều art cũ → dự án.
- Không đồng bộ đám mây, không tìm kiếm ngữ nghĩa.

Không được phép (anti-goal):
- Không xoá art cũ trước khi bản chép trong dự án đã được kiểm tra đầy đủ.
- Không tạo `squarel_art/` ở thư mục không phải dự án (ví dụ thư mục người dùng, gốc ổ đĩa).
- Ngoài file xuất chép sang `exportDir` đã có, Squarel chỉ ghi vào `<thư mục>/squarel_art/` và `<thư mục>/.squarel/`.
- Gỡ dự án khỏi launcher không xoá gì (như cũ).

## 3. Các hướng đã cân nhắc (định danh art khi có nhiều dự án)

- **Theo mã dự án/art (đã chọn, người dùng chốt):** `game-dungeon/hero`. Ngắn, dễ đọc, không có đường dẫn trong giao thức bridge. Đổi lại cần biết thư mục của từng id dự án (§5.3) và phải xử lý trùng id khi thư mục bị chép (§5.5).
- **Theo thư mục + tên:** mỗi lời gọi bridge kèm đường dẫn dự án. Không cần sổ đăng ký, nhưng đường dẫn đi vào giao thức và bridge phải kiểm tra chặt. Không chọn.
- **Mỗi dự án một bridge:** loại vì Aseprite chỉ kết nối một cổng.
- **Tên art duy nhất toàn máy:** loại vì phải quét mọi dự án và vẫn trùng khi clone repo.

Chỗ lưu art khi Claude mở ngoài dự án: người dùng chọn **bắt buộc có dự án** (không giữ "Chưa phân loại" ở DATA_DIR, không tự tạo `squarel_art/` ở thư mục bất kỳ).

## 4. Dữ liệu

### 4.1 Thư mục dự án

```
<thư mục>/
  AGENTS.md, CLAUDE.md          như cũ
  .squarel/project.json         như cũ (id, name, brief, defaults, repos, exportDir)
  .squarel/arts.md              danh mục, giờ đọc từ squarel_art/
  squarel_art/
    .gitignore                  launcher/Squarel tạo khi tạo squarel_art
    <art-id>/
      project.json              { slug, name, purpose, createdAt, updatedAt, head }
      versions/v000001.json.gz …
      proposals/  exports/  work.aseprite  thumb.png
```

- `squarel_art/` được tạo khi launcher tạo dự án (mục "Launcher sẽ ghi" có dòng này), hoặc khi Squarel ghi art đầu tiên mà thư mục chưa có. Squarel không tạo nó chỉ vì đã nhận ra dự án.
- `squarel_art/.gitignore` (chỉ tạo khi chưa có, không bao giờ ghi đè):
  ```
  */.lock
  *.tmp
  */.work-*.json
  */proposals/
  */exports/
  */work.aseprite
  */thumb.png
  ```
  Git theo dõi `project.json` và `versions/` của mỗi art. Git chỉ đóng vai bản sao lưu: không hỗ trợ gộp lịch sử của cùng một art từ hai nhánh hay hai bản clone. Số version đánh tuần tự, nên hai nơi cùng ghi một art sẽ xung đột. Docs ghi rõ giới hạn "mỗi art một nơi ghi". Bản AI đề xuất, file xuất, file làm việc của Aseprite và thumb là dữ liệu sinh ra hoặc nặng. Ai cần file xuất trong repo thì dùng `exportDir` như cũ.
- `project.json` của art bỏ trường `workspace`: art thuộc dự án nào là do vị trí thư mục. Squarel bỏ qua trường này khi đọc art cũ.
- Id art: `^[a-z0-9][a-z0-9-]{0,63}$`, duy nhất trong `squarel_art/` (trùng thì thêm `-2`, `-3` như hiện nay).

### 4.2 DATA_DIR

Giữ: `logs/`, `usage.jsonl` (ngân sách AI dùng chung cả máy), `run/` (file phiên), `inbox/` (ảnh người dùng thả vào), `workspaces/<id>.json` (sổ dự án cho launcher), token bridge.

`projects/` trở thành **art cũ**: chỉ đọc, chỉ dùng để chuyển vào dự án. Không có tool nào tạo art mới ở đây.

File phiên `run/mcp-<pid>.json`: `workspace` thêm `folder` (đường dẫn tuyệt đối của thư mục dự án).

## 5. Squarel

### 5.1 Store

- Store của một phiên có gốc art là `<thư mục dự án>/squarel_art`, và vẫn biết DATA_DIR cho usage, inbox, log.
- Đọc art cũ dùng một Store chỉ đọc có gốc `DATA_DIR/projects`.
- Hook sau commit (thumb, danh mục) chạy như cũ trên gốc mới.
- Khoá ghi (`.lock`) giữ nguyên, nên hai phiên Claude cùng một dự án vẫn an toàn.

### 5.2 Tool và từ ngữ

Đổi tên cho khớp giao diện (thay đổi phá vỡ, lên 0.4.0):

| Cũ | Mới |
|---|---|
| `project_list` | `art_list` (art của dự án hiện tại; `legacy: true` liệt kê art cũ chờ chuyển) |
| `project_create` | `art_create` (mặc định lấy từ dự án như hiện nay) |
| `project_open` | `art_open` |
| `project_info` | `art_info` |
| `workspace_info` | `project_info` (thông tin Dự án) |
| `workspace_add_art` | `art_import` `{ slug }`: chuyển một art cũ vào dự án hiện tại |

- Tham số `project` (slug art) ở các tool khác đổi thành `art`.
- Kết quả tool và thông báo hiện định danh đầy đủ `<dự án>/<art>` khi có ích (ví dụ khi mở trong Aseprite).
- **Ngoài dự án:** mọi tool đọc hoặc ghi art trả lỗi rõ, kèm hướng dẫn: tạo dự án trong launcher (Dự án → Dự án mới) rồi mở Claude ở thư mục đó. Riêng `art_list { legacy: true }` vẫn chạy để người dùng thấy art cũ của mình. Các tool không đụng art (`usage_today`, `export_presets`) chạy bình thường.
- Server instructions: có dự án thì như hiện nay. Không có dự án thì nói ngay từ đầu là cần dự án, và có bao nhiêu art cũ đang chờ chuyển.
- `photo_to_pixel` với `asNewProject` tạo art trong dự án hiện tại; ngoài dự án thì báo lỗi như trên.
- Skill `pixel-new`, `pixel-art`, `pixel-from-photo`, `pixel-export` và docs (`tools.md`, `architecture.md`, `integrations.md`, README) cập nhật tên tool và quy tắc bắt buộc dự án.

### 5.3 Bridge (nhiều dự án)

Bridge (do launcher giữ, hoặc do MCP đầu tiên mở) biết thư mục của từng id dự án qua hai nguồn, theo thứ tự:
1. File phiên MCP đang sống (`DATA_DIR/run/mcp-*.json` có `workspace.folder`).
2. Sổ `DATA_DIR/workspaces/<id>.json`.

Ánh xạ đã biết được giữ suốt thời gian bridge chạy, để Aseprite vẫn đồng bộ sau khi phiên Claude đã đóng. Squarel vẫn **không** tự thêm dự án vào sổ: "Gỡ khỏi launcher" vẫn là gỡ hẳn khỏi danh sách. Một dự án đã gỡ vẫn vẽ được khi có phiên Claude mở ở đó.

Mỗi gốc `squarel_art/` đã biết được theo dõi (thay cho việc theo dõi duy nhất `DATA_DIR/projects`). Danh sách gốc được làm mới khi `run/` hoặc `workspaces/` thay đổi.

Trước khi dùng một thư mục, bridge kiểm tra: thư mục tồn tại, có `.squarel/project.json` hợp lệ, và `id` trong đó đúng là id đang tra. Nếu không thì từ chối, kèm lỗi rõ.

Giao thức (phiên bản 2):
- `slug` trong mọi message được thay bằng `ref` = `<id dự án>/<id art>`.
- `welcome` và `projects` trả danh sách art `{ ref, project, projectName, art, name, head }`.
- `hello` từ extension cũ (không khai báo giao thức 2) nhận `error` với mã `extension-outdated` và hướng dẫn cập nhật. Bridge không cố phục vụ giao thức cũ.
- MCP gửi lệnh mở qua bridge (`openViaBridge`) bằng `ref`.

Extension Aseprite (`integrations/aseprite/squarel/plugin.lua`): dùng `ref`; menu chọn art nhóm theo dự án; thông báo "chưa có art" nhắc mở Claude trong một dự án.

### 5.4 Worktree và bản checkout của cùng dự án (người dùng chốt: dùng chung bản chính)

Claude Code (desktop, `claude --worktree`) thường chạy phiên trong git worktree. Mọi worktree mang cùng `.squarel/project.json`, tức cùng id. Worktree là **cùng một dự án**, và art luôn ghi về `squarel_art/` của **bản chính**.

- **Nhận ra worktree mà không chạy git.** Đi từ thư mục dự án lên tới gốc repo (thư mục có `.git`). Nếu `.git` là file `gitdir: <...>/.git/worktrees/<tên>`, thì đọc `commondir` trong thư mục đó để ra `.git` chung. Gốc bản chính là thư mục cha của `.git` chung (repo bare thì không áp dụng).
- **Thư mục dự án ở bản chính** = gốc bản chính + đường dẫn tương đối của thư mục dự án so với gốc worktree, vì dự án có thể nằm ở thư mục con của repo. Nếu ở đó có `.squarel/project.json` cùng id thì **gốc art là `<bản chính>/squarel_art`**. Nếu không có (ví dụ dự án mới chỉ có trong nhánh) thì worktree tự là gốc art.
- File phiên MCP ghi `workspace.folder` là thư mục đã giải ra (bản chính). Vì vậy bridge chỉ thấy một thư mục cho id đó.
- Server instructions trong worktree nói rõ:
  - art thật nằm ở `<bản chính>/squarel_art`;
  - `squarel_art/` của worktree chỉ là bản checkout, đừng đọc hay sửa bằng tool file;
  - art mới hiện thành thay đổi chưa commit ở bản chính, không nằm trong nhánh của worktree.
- Kết quả `art_create` và `art_info` trả đường dẫn thật của art.
- `AGENTS.md`, brief, mặc định, `exportDir` vẫn đọc từ thư mục dự án của worktree, vì đó là code của nhánh. Riêng file xuất chép sang `exportDir` thì dùng `exportDir` của worktree, để file xuất đi theo nhánh đang làm.

### 5.5 Id dự án trùng

Launcher đã chọn id chưa ai dùng khi tạo dự án. Ngoài worktree (§5.4), trùng chỉ xảy ra khi người dùng chép cả thư mục dự án hoặc clone repo lần thứ hai: hai thư mục không chung `.git`.
- Bridge gặp hai thư mục khác nhau cùng id (từ hai nguồn ở §5.3, cả hai đều tồn tại và đều khai báo id đó): từ chối id đó, lỗi nêu cả hai thư mục và cách sửa (đổi id trong `.squarel/project.json` của bản chép, hoặc Cài đặt dự án trong launcher).
- MCP lúc khởi động: nếu sổ có cùng id trỏ tới một thư mục khác vẫn còn khai báo id đó, thì instructions cảnh báo trùng và các tool ghi art bị chặn cho tới khi đổi id. Các tool chỉ đọc vẫn chạy.
- Launcher: thẻ dự án hiện cảnh báo trùng id. Trang Cài đặt cho đổi id; đổi xong thì cập nhật sổ.

### 5.6 Chuyển art cũ vào dự án (`art_import`)

- Một hàm duy nhất trong Squarel. Tool `art_import` gọi nó, CLI cũng có lệnh tương ứng để launcher chạy.
- Các bước:
  1. Khoá art nguồn.
  2. Chép thư mục vào `squarel_art/.<id>.importing`.
  3. Kiểm tra số file và kích thước khớp, đọc được `head`.
  4. Đổi tên thành `squarel_art/<id>`; trùng id thì thêm `-2`… và báo id mới.
  5. Bỏ trường `workspace` trong `project.json`.
  6. Xoá nguồn.
- Cùng ổ đĩa thì có thể dùng rename, nhưng vẫn kiểm tra như trên.
- Lỗi ở bất kỳ bước nào thì xoá thư mục tạm, giữ nguyên nguồn.
- Sau khi chuyển: thumb và danh mục được sinh lại.

### 5.7 Xuất file

Mặc định vào `squarel_art/<art>/exports/`. Chép thêm sang `exportDir` và quy tắc kiểm tra thư mục xuất giữ nguyên.

## 6. Launcher

- **Tạo dự án:** thêm `squarel_art/` và `squarel_art/.gitignore` vào "Launcher sẽ ghi" (tạo mới hay giữ nguyên).
- **Đọc art:** trang Dự án, chi tiết, thumb, đếm art, art mới nhất: đọc từ `<thư mục>/squarel_art/*/project.json`, không đọc DATA_DIR nữa. Thư mục không truy cập được thì thẻ báo lỗi như hiện nay.
- **Art cũ:** thẻ "Chưa phân loại" đổi thành **"Art cũ"**, chỉ hiện khi `DATA_DIR/projects` còn art. Trang của nó liệt kê art cũ (thumb nếu có), mỗi art có nút **Chuyển vào dự án…**: chọn dự án, xác nhận, rồi chạy lệnh CLI ở §5.6 như một tác vụ có tiến trình (cách launcher đã chạy các tác vụ khác). Xong thì danh sách tự làm mới.
- **Những chỗ đang liệt kê art** gom art từ mọi dự án trong sổ, mỗi art kèm tên dự án, mở art bằng `ref`:
  - "Project gần đây" ở Trang chủ, đổi thành "Art gần đây";
  - bộ chọn "Mở project…" ở trang Aseprite, đổi thành "Mở art…";
  - thao tác "Mở {art mới nhất}" (`recentProject` trong `actions.ts`).

  Không thêm trang thư viện art mới. Trang "Thư viện tích hợp" giữ nguyên.
- **Gỡ dự án:** vẫn không xoá gì. Hộp xác nhận nói rõ art nằm trong `squarel_art/` của thư mục và vẫn còn đó; xoá thư mục là mất art.
- **Panel Kết nối:** client Aseprite hiện art đang mở theo `<dự án>/<art>`.
- Health có thêm kiểm tra phiên bản extension Aseprite có hỗ trợ giao thức 2 (dựa vào `hello.ext` hoặc phiên bản file extension). Nếu cũ thì có nút cập nhật như các bản sửa khác.

## 7. Phát hành

- Phiên bản 0.4.0 cho Squarel, launcher và extension.
- CHANGELOG ghi rõ các thay đổi phá vỡ: tên tool, bắt buộc dự án, giao thức bridge 2. Kèm hướng dẫn chuyển art cũ.

## 8. Kiểm thử

- **Squarel (vitest):**
  - Store với gốc `squarel_art` (tạo lười, `.gitignore` không ghi đè).
  - Tool ngoài dự án báo lỗi; `art_list { legacy }` vẫn chạy.
  - Đổi tên tool và tham số.
  - `art_import`: thành công, trùng id, lỗi giữa chừng giữ nguồn, nguồn đang bị khoá.
  - Danh mục đọc từ gốc mới.
  - Bridge: tra id qua file phiên rồi sổ, giữ ánh xạ sau khi phiên đóng, từ chối thư mục sai id, từ chối id trùng, theo dõi nhiều gốc (commit từ tiến trình khác tới được Aseprite), extension cũ nhận `extension-outdated`.
  - Instructions khi không có dự án và khi trùng id.
  - Worktree:
    - nhận ra từ file `.git` và `commondir`;
    - dự án nằm ở thư mục con của repo;
    - bản chính có dự án cùng id thì ghi về bản chính;
    - bản chính không có dự án thì worktree tự là gốc art;
    - file phiên ghi thư mục bản chính;
    - bridge không coi worktree là trùng id;
    - hai bản clone không chung `.git` thì vẫn là trùng.
- **Launcher (vitest):**
  - Đọc art từ thư mục dự án.
  - Danh sách art cũ.
  - Lệnh chuyển art (argv, chỉ chạy sau khi bấm).
  - Art gần đây và bộ chọn art gom nhiều dự án.
  - "Launcher sẽ ghi" có `squarel_art`.
  - Cảnh báo trùng id.
- **Launcher e2e (fake mode):**
  - Tạo dự án thấy `squarel_art/.gitignore`.
  - Trang Art cũ → Chuyển vào dự án → art hiện trong chi tiết dự án.
  - Trang chủ và bộ chọn art hiện art của hai dự án.
- **Thử trên máy thật:**
  - Bản cài launcher, mở Claude ở dự án, `/pixel-new` tạo art trong `squarel_art/`.
  - Mở trong Aseprite, vẽ, nét quay về thành version mới.
  - Hai dự án mở song song cùng có art tên `hero`.
  - Phiên Claude desktop trong worktree của dự án tạo art, và art nằm ở `squarel_art/` của bản chính.

## 9. Để builder tự quyết

- Tên nội bộ trong code (`workspace` hay `project`), miễn tên tool và giao diện theo §5.2.
- Có nhận tham số cũ `project` làm bí danh của `art` trong một phiên bản hay không.
- Cách bridge theo dõi nhiều gốc: một watcher hay nhiều.
- Tên và cú pháp lệnh CLI cho §5.6.
- Cách làm mới danh sách gốc của bridge (watch hay quét định kỳ).
- Khi người dùng chọn một thư mục worktree lúc tạo dự án trong launcher: cảnh báo và gợi ý thư mục bản chính, hay tự đổi sang bản chính.

## 10. Builder tự chốt sau vòng soát

- **Git chỉ đóng vai sao lưu** (§4.1). Không gộp lịch sử version của cùng một art giữa các nhánh hay các bản clone. Đổi được việc này thì phải đổi cả cách đánh số version, vượt quá yêu cầu "quản lý như trước".
- **Không thêm trang thư viện art** (§6). Trang "Thư viện" của launcher là thư viện tích hợp. Chỉ ba chỗ đang liệt kê art được sửa.
- **Art cũ không mở được trong Aseprite cho tới khi chuyển vào dự án.** Giao thức 2 chỉ có `ref` của art trong dự án.
