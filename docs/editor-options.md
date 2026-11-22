# Đánh giá: dùng editor pixel art có sẵn thay cho editor tự viết

> Ngày: 2026-11-22. Bối cảnh: [kế hoạch cá nhân](plans/2026-11-22-personal-tool-plan.md) có giai đoạn P3 tự viết editor web (~2 tuần). Tài liệu này xem có nên thay P3 bằng một editor có sẵn hay không.
> Trạng thái: **đã chọn Aseprite** (2026-11-22). Kế hoạch và kiến trúc đã được cập nhật theo lựa chọn này.

## 1. Editor cần làm được gì trong hệ thống này

1. **Đồng bộ hai chiều với Claude.** Claude sửa thì editor thấy ngay. Bạn vẽ thì Claude đọc được nét mới nhất, và không bên nào ghi đè bên kia.
2. **Đúng mô hình dữ liệu:** có palette chỉ số (indexed), layers, frames. Cần như vậy để chuyển qua lại với `PixelDoc` mà không mất gì.
3. **Vẽ tay tốt.**
4. **Chi phí & giấy phép:** dùng cá nhân được, và nếu sau này làm SaaS thì có dùng lại được không.
5. **Công sức tích hợp**, và dự án editor đó còn được bảo trì hay không.

## 2. So sánh

| | **Aseprite** | **Pixelorama** | **Piskel** | **Tự viết** (kế hoạch hiện tại) |
|---|---|---|---|---|
| Loại | App desktop (C++) | Desktop + bản web (Godot) | Web (JavaScript) | Web (React) |
| Giá / giấy phép | **$19.99 một lần**. Hoặc tự build từ source miễn phí cho cá nhân. EULA cấm phân phối lại bản build | **MIT, miễn phí** | Apache-2.0, miễn phí | Của bạn |
| Chất lượng công cụ vẽ | Chuẩn của dân pixel art, đầy đủ nhất | Khá đầy đủ: layers, frames, palette, tilemap | Cơ bản | Tối giản, tự làm dần |
| Palette chỉ số (indexed) | **Có sẵn**, khớp `PixelDoc` | Có chế độ giới hạn theo palette (cần kiểm lại) | Không | Có |
| Mở rộng | Extension viết bằng **Lua**: truy cập Sprite/Layer/Cel/Image, có sự kiện khi sprite thay đổi, có lớp WebSocket | Extension viết bằng **GDScript** qua `ExtensionsApi`. Tài liệu cho bản 1.x nằm trong source code | Phải fork rồi sửa thẳng code | Toàn quyền |
| Mở trong khung Browser của app Claude | Không, là cửa sổ riêng | Bản web mở được nhưng nặng; extension trên bản web chưa rõ | Có | Có |
| Đề xuất AI (Accept/Discard) | Qua chat. Có thể thêm layer "AI: …" ẩn sẵn để xem trước | Qua chat | Qua chat | Có panel riêng |
| Công sức tích hợp | **~3–5 ngày** | ~4–6 ngày, cộng thời gian học GDScript | ~5–8 ngày, codebase cũ | ~2 tuần |
| Dùng lại khi làm SaaS | **Không** (EULA) | Nhúng được bản web (MIT) nhưng nặng | Nhúng được | Dùng tiếp |
| Bảo trì | Rất tích cực | Tích cực: v1.1.10 ra 6/2026, v1.2 đang beta | Không rõ, cập nhật thưa | Bạn tự lo |

Các loại khác đã loại:
- **LibreSprite** (GPL): fork từ bản Aseprite cũ, chỉ có bản desktop, phát triển chậm hơn.
- **Pixcil**, **Pixa.Pics**: nhỏ, ít khả năng mở rộng.

## 3. Cách nối editor có sẵn với hệ thống

Có hai cách. Cả hai đều dùng lại cơ chế đã có trong [kiến trúc](architecture.md): `src/store`, version chỉ thêm không sửa, và rebase theo patch.

**Cách 1 — Bridge trực tiếp** (tốt nhất, cần extension):
- Server local có thêm một endpoint `ws://127.0.0.1:4321/bridge`. Extension trong editor kết nối tới endpoint này khi editor mở.
- **Khi Claude tạo version mới:**
  - Server gửi `doc.updated { versionId, palette, layers[{ id, name, cels[{ frame, indices }] }] }`.
  - Extension thay các cel bên trong **một transaction** của editor, nên Ctrl+Z trong editor hoàn tác được thay đổi của Claude.
- **Khi bạn vẽ:**
  - Extension bắt sự kiện thay đổi (debounce khoảng 500ms) rồi gửi `editor.changed { baseVersion, patch }`.
  - Server rebase patch lên head mới nhất, commit với source `editor`.

**Cách 2 — Trao đổi qua file** (không cần extension, dùng được với mọi editor):
1. Tool mới `open_in_editor`:
   - xuất head ra file làm việc (`.aseprite`, `.pxo` hoặc `.png`), kèm ghi lại version gốc;
   - mở editor với file đó.
2. Khi bạn bấm Save:
   - Bộ theo dõi file (watcher) đọc file;
   - so với version gốc để ra **patch**;
   - rebase patch lên head;
   - commit.
3. Hạn chế:
   - Claude sửa thì editor **không tự tải lại**, bạn phải mở lại file.
   - Dùng PNG thì chỉ còn 1 layer.

Ưu điểm lớn của cách 2: làm được trước, khoảng 2 ngày, sau đó nâng lên cách 1.

## 4. Đề xuất

**Bản cá nhân nên dùng Aseprite + extension Lua (cách 1), có cách 2 làm phương án dự phòng.**
- **Lý do chọn:**
  - Công cụ vẽ tốt nhất.
  - Palette chỉ số có sẵn, khớp đúng `PixelDoc`.
  - Được bảo trì tích cực.
  - Tích cực hợp chỉ mất khoảng 3–5 ngày thay vì 2 tuần.
- **Đánh đổi:**
  - Tốn $19.99, hoặc tự build miễn phí.
  - Là cửa sổ riêng, không nằm trong app Claude.
  - Không dùng lại được cho SaaS.
- **Lựa chọn miễn phí:** Pixelorama. Làm cách 2 trước, sau đó viết extension GDScript.
- **Editor web tự viết:** chỉ làm khi quay lại hướng SaaS. Lúc đó đằng nào cũng phải có editor trong trình duyệt.

**Bước đầu bắt buộc: spike 1 ngày** để kiểm chứng các API của Aseprite trước khi cam kết:
- extension mở được kết nối WebSocket tới server local;
- bắt được sự kiện sprite thay đổi;
- ghi được dữ liệu chỉ số vào cel trong một transaction;
- đặt được palette ở chế độ indexed.

Nếu một trong các điểm này không làm được, chuyển sang Pixelorama hoặc dùng cách 2.

## 5. Ảnh hưởng tới kế hoạch (nếu chọn Aseprite)

| | Trước | Sau |
|---|---|---|
| P3 | Editor web tự viết, ~2 tuần | **Nối với editor, ~1 tuần:** spike 1 ngày → `open_in_editor` + trao đổi qua file → extension Lua + bridge WebSocket |
| Tổng thời gian | ~5–6 tuần | **~4–5 tuần** |
| Kiến trúc | `src/editor/web` (React) | Bỏ `src/editor/web`. `src/editor/server` thu gọn thành **bridge server** (WebSocket + watcher). Thêm `integrations/aseprite/` (extension Lua) |
| Tuỳ chọn thêm | — | Trang xem trước chỉ đọc (canvas + lưới đề xuất AI) trong khung Browser, ~1–2 ngày |

## Nguồn
- Aseprite: [API scripting](https://github.com/aseprite/api), [changelog API](https://www.aseprite.org/api/Changes), [FAQ về giấy phép](https://community.aseprite.org/faq), [Wikipedia](https://en.wikipedia.org/wiki/Aseprite)
- Pixelorama: [devlog v1.1.10 / v1.2 beta](https://orama-interactive.itch.io/pixelorama/devlog/1504423/pixelorama-v1110-is-out-v12-enters-its-beta-stage), [Extension API](https://Orama-Interactive.github.io/Pixelorama-Docs/extension_system/extension_api)
- Piskel: [GitHub](https://github.com/piskelapp/piskel)
