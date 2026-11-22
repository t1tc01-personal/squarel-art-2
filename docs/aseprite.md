# Aseprite + extension Squarel

## Cài đặt

1. Cài Aseprite 1.3 trở lên. Hai cách:
   - Tự build từ source để dùng cá nhân: chạy `pnpm aseprite:build`. Script tải source, tải Skia, build, rồi ghi `ASEPRITE_PATH`. Xem [setup.md, mục 6.1a](setup.md#61a-tự-build-bằng-pnpm-asepritebuild).
   - Mua (khoảng $19.99).

   **Bản trial không dùng được**, vì nó tắt scripting và tắt lưu file.
2. Đóng gói extension:

   ```powershell
   pnpm aseprite:pack
   ```

   Lệnh này tạo ra file `squarel.aseprite-extension`.
3. Nhấp đúp file đó, hoặc vào Aseprite → *Edit → Preferences → Extensions → Add Extension*.
4. Nếu Aseprite hỏi quyền cho script (mạng, file), chọn cho phép và *Trust* extension Squarel.

**Cập nhật extension** sau khi sửa code trong `integrations/aseprite/squarel/`: lệnh dưới chép thẳng vào thư mục extension của Aseprite và giữ nguyên cài đặt. Sau đó khởi động lại Aseprite, vì extension chỉ được nạp lúc khởi động.

```powershell
pnpm aseprite:pack -- --install
```

## Menu **File → Squarel**

Aseprite không cho extension thêm menu riêng lên thanh menu, nên các mục nằm trong **File → Squarel**, ngay dưới *Scripts*.

| Mục | Việc |
|---|---|
| Connect / Disconnect | Kết nối tới bridge `ws://127.0.0.1:4321/bridge`. Mặc định tự kết nối khi mở Aseprite |
| Open project… | Chọn project và mở thành sprite |
| Sync now | Gửi ngay trạng thái sprite hiện tại |
| Export… | Gọi tool `export` qua bridge. File được ghi vào `DATA_DIR/projects/<slug>/exports` |
| Settings… | Đổi cổng, token (tuỳ chọn), bật/tắt tự kết nối |

## Cách đồng bộ

- **Claude (hoặc AI, CLI) tạo version mới:**
  - Bridge gửi `doc.updated`.
  - Extension áp toàn bộ thay đổi trong **một transaction** tên "Claude: …", nên **Ctrl+Z** trong Aseprite hoàn tác được.
- **Bạn vẽ:**
  - Mỗi lần sprite thay đổi, extension đặt lại hẹn giờ 0,5 giây; hết 0,5 giây thì gửi `cels` (trạng thái toàn sprite kèm `baseVersion`).
  - Bridge tính diff pixel so với `baseVersion`, rebase lên version mới nhất rồi commit với nguồn `editor`.
- **Hai bên sửa cùng lúc:**
  - Bridge trả `rebased` kèm doc đã gộp.
  - Nét bạn vẽ trên layer mà Claude vừa xoá được chuyển sang layer "Nét vẽ khôi phục".
- **Mất kết nối** (bridge tắt, Claude Code mở lại…): cứ vẽ tiếp.
  - Cứ 5 giây extension gửi `ping`. Không có phản hồi trong 15 giây, hoặc gửi bị lỗi, thì nó mở kết nối mới. Không dựa vào sự kiện CLOSE, vì Aseprite trên Windows có lúc không báo sự kiện này khi bridge bị tắt đột ngột.
  - Khi nối lại, mỗi sprite đang liên kết gửi `cels` kèm `baseVersion` cũ. Bridge gộp nét vẽ lúc offline và tiếp tục đẩy thay đổi của Claude.
  - Đã đo với Aseprite thật: kết nối lại trong khoảng 1 giây sau khi bridge chạy lại.

### Ánh xạ dữ liệu

| Squarel | Aseprite |
|---|---|
| palette (index 0 trong suốt) | palette của sprite, Indexed, `transparentColor = 0` |
| layer (id cố định) | layer thường; id lưu trong `layer.properties.squarel_id` |
| frame | frame (`duration` tính bằng giây); id lưu trong `sprite.properties.squarel_frames` |
| slug / version gốc | `sprite.properties.squarel_slug` / `squarel_base` |

**Giới hạn:**
- Sprite phải ở chế độ **Indexed**.
- Layer nhóm và layer tham chiếu bị bỏ qua.
- Xoá một frame ở giữa trong Aseprite có thể làm lệch id các frame phía sau. Thêm hoặc xoá frame ở cuối thì an toàn.

## Khi không cài extension: trao đổi qua file

1. Đặt `ASEPRITE_PATH` trong `.env`.
2. Tool `open_in_editor`:
   - gọi Aseprite CLI để tạo `projects/<slug>/work.aseprite`;
   - mở Aseprite với file đó.
3. Mỗi lần bạn **Ctrl+S**, bridge đọc file qua CLI rồi tính diff, rebase và commit.

Claude sửa thì Aseprite không tự tải lại: mở lại file để thấy thay đổi.

## Kiểm tra với Aseprite thật

```powershell
pnpm aseprite:test
```

Lệnh này chuyển `doc.json → .aseprite → doc.json` và yêu cầu kết quả giống hệt ban đầu. Test tự động trong `pnpm test` chạy extension trên **fengari** (máy ảo Lua trong Node) với API Aseprite giả lập. Lệnh này kiểm tra trên Aseprite thật.

## Bảo mật

- Bridge chỉ nghe `127.0.0.1`.
- Bridge chặn mọi trang web:
  - Trình duyệt luôn gửi header `Origin` là địa chỉ của trang (`http(s)://…`, `file://`, `null`), và bridge từ chối mọi Origin như vậy.
  - Bridge chỉ nhận kết nối không có `Origin` (công cụ Node), hoặc có `Origin: ws://127.0.0.1:<port>` / `ws://localhost:<port>`. Đây là header mà thư viện WebSocket của Aseprite (ixwebsocket) tự gửi.
  - Trình duyệt không bao giờ gửi `Origin` dạng `ws://`.
- Muốn thêm token: ghi chuỗi bất kỳ vào `DATA_DIR/bridge.token`, rồi nhập cùng chuỗi đó trong *File → Squarel → Settings…*.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| "Squarel needs Indexed color mode" | Vào *Sprite → Color Mode → Indexed* |
| Không kết nối được | Phải có Claude Code (đang mở repo) hoặc `pnpm bridge` đang chạy. Kiểm tra cổng 4321 có bị chương trình khác chiếm không |
| `Port 4321 is already in use` khi chạy `pnpm bridge` | Đã có bridge chạy kèm Claude Code. Không cần chạy thêm |
| Thay đổi không về | Xem `DATA_DIR/logs/bridge-*.log` hoặc `mcp-*.log`. Các dòng `editor connected` / `editor hello` / `editor opened project` / `editor edit` cho biết Aseprite đã kết nối, đã mở project nào, và đã gửi gì về |
| Không thấy *File → Squarel* | Extension chưa cài, hoặc đang dùng bản trial (trial tắt scripting) |
| Cần biết extension đang làm gì | Mở Aseprite từ PowerShell với biến log, rồi xem file `squarel-aseprite.log`. Lệnh ở ngay dưới bảng. Mọi lỗi của extension cũng hiện trong cửa sổ Console của Aseprite |

```powershell
$env:SQUAREL_ASEPRITE_LOG = "$env:TEMP\squarel-aseprite.log"; & "<đường dẫn>\aseprite.exe"
```
