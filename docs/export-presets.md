# Preset xuất file

Bảng đầy đủ các tuỳ chọn nằm cuối [tools.md](tools.md) (tự sinh). File được ghi vào `DATA_DIR/projects/<slug>/exports/`.

| Preset | Dùng cho | Ghi chú kỹ thuật |
|---|---|---|
| `game-png` | Engine game (Godot, Unity, GameMaker) | PNG RGBA trong suốt; mỗi frame một file; `scale` nguyên (nearest-neighbor) |
| `game-spritesheet` | Animation trong engine | PNG sheet + JSON **giống định dạng "array" của Aseprite** (`frames[].frame/duration`, `meta.frameTags`) |
| `game-gif` | Xem trước animation | GIF, nền trong suốt (index 0), lặp vô hạn, delay theo từng frame |
| `print-png` | In áo, poster, POD | Phóng nearest-neighbor tới gần `widthMm` ở `dpi` (mặc định 300); ghi DPI vào chunk `pHYs` |
| `print-svg` | In khổ lớn, cắt decal | Mỗi màu là một `<path>` gồm các dải ngang; `shape-rendering="crispEdges"` |
| `print-pdf` | Gửi nhà in | PDF vector (pdf-lib), trang đúng kích thước in cộng lề |
| `social-avatar` | Ảnh đại diện | PNG vuông 512/1024, scale nguyên lớn nhất vừa khung, căn giữa |
| `social-emoji` | Emoji Discord/Slack | PNG 128 (đổi được) |
| `social-sticker` | Sticker Telegram/Zalo | WebP lossless 512 (chuyển từ PNG bằng sharp) |
| `social-anim` | Ảnh động chat | GIF ×8 |
| `craft-beads` | Hạt Perler/Hama | PDF: trang chú giải (ký hiệu, mã, tên, **số hạt**), mỗi bảng ghim 29×29 một trang, kẻ lưới đậm mỗi 5 ô; kèm CSV |

## Lưu ý in ấn

- Pixel bán trong suốt sẽ ra màu nhạt khi in: nên dùng palette đặc.
- Muốn đúng kích thước in chính xác, chọn `widthMm` sao cho số pixel thực ≈ `widthMm / 25.4 × dpi` chia hết cho chiều rộng canvas. Tool có báo lại kích thước thật.

## Lưu ý mẫu hạt

Mã màu hạt trong `src/shared/beads.ts` là **giá trị gần đúng** (hãng không công bố mã sRGB chính thức). Hãy so với bảng màu thật trước khi mua.
