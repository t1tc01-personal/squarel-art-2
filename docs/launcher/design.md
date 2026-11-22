# Launcher — thông số giao diện (xuất từ Figma)

Nguồn: Figma file `AWBBKBpJ02xrY41bo45Ais`. Ảnh chụp từng màn hình trong [screens/](screens/).

| Ảnh | Màn hình |
|---|---|
| `setup-1-welcome.png` … `setup-4-claude.png` | Wizard 4 bước. Bố cục cũ có thanh bước bên trái; giữ nguyên nội dung và kiểu, bỏ qua thanh icon |
| `app-home.png`, `app-library.png`, `app-tool-aseprite.png`, `app-tool-aseprite-menu.png`, `app-system.png` | Ứng dụng: thanh icon trái + nội dung + panel Kết nối phải |
| `tab-health.png`, `tab-logs.png`, `tab-settings.png` | Nội dung các tab Health check, Nhật ký, Cấu hình. Ảnh dùng sidebar chữ cũ: chỉ lấy phần nội dung, đặt vào khung mới |

## Token màu (CSS variable = tên biến Figma, `/` → `-`)

```css
--bg-app: #0D0E12;       --bg-sidebar: #111318;   --bg-surface: #171A21;   --bg-surface-2: #1F232C;  --bg-input: #0F1116;
--border-default: #2A2F3A; --border-strong: #3A4150;
--text-primary: #ECEEF3;  --text-secondary: #9AA1B1; --text-muted: #646B7A; --text-on-accent: #0D0E12;
--accent-primary: #29ADFF; --accent-primary-soft: #0F2A3D; --accent-brand: #FFEC27;
--status-ok: #00E436;  --status-ok-soft: #0B2A16;  --status-warn: #FFA300; --status-warn-soft: #2E2109;
--status-error: #FF004D; --status-error-soft: #33101C; --status-idle: #646B7A; --status-idle-soft: #1F232C;
--space-4: 4px; --space-8: 8px; --space-12: 12px; --space-16: 16px; --space-24: 24px; --space-32: 32px;
--radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;
```

Màu riêng: logo tích hợp Aseprite `#FF77A8`. Nền nút ▾ của LaunchButton `#3A3410`.

## Kiểu chữ

| Tên | Font | Cỡ / dòng |
|---|---|---|
| UI/Display | Geist SemiBold | 28 / 36, letter-spacing −1% |
| Pixel/Title (chỉ chữ "SQUAREL") | Pixelify Sans SemiBold | 22 / 28 |
| UI/H1 | Geist SemiBold | 20 / 28 |
| UI/H2 | Geist SemiBold | 15 / 22 |
| UI/Body | Geist Regular | 13 / 20 |
| UI/Body Strong | Geist Medium | 13 / 20 |
| UI/Small | Geist Regular | 12 / 16 |
| UI/Label (chữ hoa) | Geist Medium | 11 / 14, letter-spacing 6% |
| Mono/Small | Geist Mono Regular | 12 / 16 |
| Mono/Value | Geist Mono Medium | 13 / 18 |

Pixelify Sans thiếu một số dấu tiếng Việt: không dùng cho chữ tiếng Việt.

## Icon pixel (8×8, `#` = điểm vẽ, phóng ×2 thành 16px; tô bằng màu hiện tại)

```
home     ...##... ..####.. .######. ######## .##..##. .##..##. .##..##. .######.
box      .######. #......# ######## #......# #..##..# #......# #......# ########
heart    .##..##. ######## ######## ######## .######. ..####.. ...##... ........
gear     ...##... .#.##.#. ..####.. ####.### ###.#### ..####.. .#.##.#. ...##...
list     ........ ##.##### ........ ##.##### ........ ##.##### ........ ........
play     .#...... .##..... .###.... .####... .####... .###.... .##..... .#......
check    ........ .......# ......## #....##. ##..##.. .####... ..##.... ........
cross    ........ .#....#. ..#..#.. ...##... ...##... ..#..#.. .#....#. ........
alert    ...##... ...##... ..####.. ..#..#.. .##..##. .######. ##.##.## ########
refresh  ..####.. .#....## #.....## #....... #......# .#....#. ..####.. ........
folder   ........ ###..... #..####. ######## #......# #......# ######## ........
plug     .#..#... .#..#... ######.. ######.. .####... ..##.... ..##.... ..##....
grid     ###.###. ###.###. ###.###. ........ ###.###. ###.###. ###.###. ........
pencil   .....##. ....#..# ...#..#. ..#..#.. .#..#... #..#.... ##.#.... ###.....
plus     ...##... ...##... ...##... ######## ######## ...##... ...##... ...##...
collapse #....... #..#.... #...#... #.#####. #...#... #..#.... #....... ........
chevron  ........ ........ #......# .#....#. ..#..#.. ...##... ........ ........
cloud    ........ ...###.. ..#...#. .#.....# #......# #......# .######. ........
chip     .#.#.#.. ######## #......# #.####.# #.####.# #......# ######## .#.#.#..
bolt     ....##.. ...##... ..##.... .######. ....##.. ...##... ..##.... .##.....
link     ........ .###.... #...#... #..###.. .###..#. ...#...# ....###. ........
sparkle  ...#.... ...#.... .#####.. ...#.... ...#..#. ......#. ....#### ......#.
```

Logo "S" (lưới 6×7, ô 3px, màu `--accent-brand`): `.####.` `#....#` `#.....` `.####.` `.....#` `#....#` `.####.`

Sprite ví dụ cho thẻ project (8×8, ô 9px, nền bo 10px):
- knight `..####..` `.######.` `.#.##.#.` `.######.` `..####..` `.######.` `#.####.#` `..#..#..` — màu `#C2C3C7` trên `#1F232C`
- slime `........` `..####..` `.######.` `##.##.##` `########` `########` `.######.` `........` — `#00E436` trên `#0B2A16`
- apple `...##...` `....#...` `.######.` `########` `########` `########` `.######.` `..####..` — `#FF004D` trên `#1D2B53`

Banner pixel: nền gradient `#1C2B54 → #0D0F1C`, ô 8px. Gồm sao `#FFF1E8`, mặt trăng `#FFEC27`, ba lớp đồi `#1D2B53` / `#3B2A5A` / `#0F1A2E` (dạng sóng sin), và hiệp sĩ `#29ADFF` đứng bên phải. Có thể vẽ bằng `<canvas>` hoặc SVG sinh lúc chạy.

## Kích thước bố cục

- Cửa sổ 1280×800. Thanh tiêu đề cao 36px, nền `--bg-sidebar`, viền dưới. Bên trái là logo 16px + "Squarel Art Launcher" (UI/Small); bên phải là 3 nút cửa sổ 36×28.
- **Thanh icon trái** rộng 64px, nền `--bg-sidebar`, viền phải. Từ trên xuống:
  - logo;
  - các mục 56×48, mỗi mục có ô 44×44 bo `--radius-md`. Mục đang chọn: nền `--bg-surface-2`, vạch trái 3×24 màu `--accent-brand`; icon 20px.
- **Vùng nội dung:** padding 20/32.
- **Panel Kết nối** 272×740: bọc lề 12px, nền `--bg-surface`, bo `--radius-lg`.
  - Đầu panel: tiêu đề "Kết nối" (UI/H2), dòng tóm tắt có chấm 6px, nút thu gọn.
  - Thanh tab 3 icon: tab đang chọn có gạch dưới 28×2 màu `--accent-brand`.
  - Nhóm: icon + tên + số lượng.
  - Dòng: avatar 34px bo 8px, chấm trạng thái 10×10 vuông bo 2px ở góc dưới phải; tiêu đề UI/Body Strong, phụ đề UI/Small.
- **StatusPill:** padding 3/8, bo 4px, nền màu `-soft`, chấm vuông 6px, chữ UI/Label cùng màu.
- **Button:** MD padding 8/16, bo `--radius-sm`; LG padding 12/24, bo `--radius-md`.
  - Primary: nền `--accent-primary`, chữ `--text-on-accent`.
  - Secondary: nền `--bg-surface-2`, viền `--border-strong`.
  - Ghost: trong suốt, chữ `--text-secondary`.
  - Danger: nền `--status-error-soft`, chữ `--status-error`.
- **LaunchButton:** khối vàng `--accent-brand`, padding 16/24/16/28, bo `--radius-lg`, chữ UI/H1 `--text-on-accent` kèm icon play 20px. Nút ▾ rộng 56px nền `#3A3410` cách 6px. Menu mở lên trên: rộng 240px, nền `--bg-surface-2`, viền `--border-strong`, bóng đổ.
- **SubTabs:** nền `--bg-sidebar`, viền, bo `--radius-md`, padding 4. Tab đang chọn: nền `--bg-surface-2`, gạch dưới vàng. Có thể kèm chấm đỏ 6px (cần chú ý).
- **Field:** nhãn UI/Label `--text-secondary`. Ô nhập nền `--bg-input`, viền `--border-default` (hợp lệ: `--status-ok`, lỗi: `--status-error`), giá trị Mono/Value, hành động bên phải UI/Body Strong `--accent-primary`. Chú thích UI/Small `--text-muted`.
- **Card:** nền `--bg-surface`, viền `--border-default`, bo `--radius-lg`, padding 20.
