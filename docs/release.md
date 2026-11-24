# Build và phát hành launcher

Một số phiên bản và một tag `vX.Y.Z` cho mỗi bản phát hành, dùng chung cho Squarel và launcher. Launcher bản X cài Squarel ở tag X.

## Build exe trên máy

```powershell
pnpm --dir launcher install
```

```powershell
pnpm --dir launcher dist
```

`dist` chạy lần lượt:
1. `electron-vite build` → `launcher/out/`;
2. `scripts/make-icon.mts` → `launcher/build/icon.ico`, vẽ từ bitmap logo của khay (repo không chứa file icon);
3. `electron-builder --win --publish never` → `launcher/dist/`.

| File trong `launcher/dist/` | Là gì |
|---|---|
| `Squarel-Art-Launcher-Setup-X.Y.Z.exe` | Bộ cài NSIS (~120 MB), cài cho riêng người dùng, cho chọn thư mục |
| `Squarel-Art-Launcher-Setup-X.Y.Z.exe.blockmap` | Cho `electron-updater` tải phần thay đổi |
| `latest.yml` | Feed cập nhật: phiên bản, sha512, kích thước |
| `win-unpacked/` | App đã giải nén, chạy thử được không cần cài |

`launcher/out/`, `launcher/dist/` và `launcher/build/` nằm trong `.gitignore`. Không commit chúng.

**Trong bộ cài có gì** (cấu hình ở `launcher/electron-builder.yml`):
- `app.asar`: chỉ `out/**` (main, preload, renderer đã bundle), `package.json` và thư viện chạy của main (`@modelcontextprotocol/sdk`, `electron-updater`, `ws`, `zod` và phụ thuộc của chúng). Không có source map, file `.ts`, React hay font (đã bundle vào renderer).
- `resources/LICENSE.md`: nút "Giấy phép" trong Cài đặt mở file này.
- `resources/app-update.yml`: trỏ về GitHub Release của `t1tc01-personal/squarel-art-2`.
- **Không bao giờ** có `.env`, `vendor/`, file Aseprite, log, `.superpowers/` hay dữ liệu test. Aseprite theo EULA riêng: không đóng gói, không tải lên Release.

Kiểm tra nhanh nội dung `app.asar`:

```powershell
npx @electron/asar list "launcher\dist\win-unpacked\resources\app.asar"
```

## SmartScreen

Bộ cài **không ký số**. Lần cài đầu, Windows SmartScreen hiện "Windows protected your PC". Bấm **More info → Run anyway**. Ghi câu này vào ghi chú của mỗi Release.

## Phát hành

Làm theo thứ tự:

1. Tăng `version` ở **cả hai** file: `package.json` và `launcher/package.json`. Hai số phải giống nhau.
2. Chạy kiểm tra:

   ```powershell
   pnpm check
   ```

   ```powershell
   pnpm --dir launcher check
   ```

   ```powershell
   pnpm --dir launcher build; pnpm --dir launcher e2e
   ```

3. Commit và merge vào `main`. Chỉ gắn tag cho commit **đã nằm trên `main`**.
4. Tạo và đẩy tag. **Chỉ làm khi chủ dự án đồng ý**, vì Release là công khai:

   ```powershell
   git tag v0.4.0
   ```

   ```powershell
   git push origin v0.4.0
   ```

5. GitHub Actions (`.github/workflows/release.yml`) chạy trên `windows-latest`:

   | Job | Quyền | Việc |
   |---|---|---|
   | `check` | `contents: read` | `pnpm install` → `pnpm check`; `pnpm --dir launcher install` → `pnpm --dir launcher check` |
   | `release` | `contents: write` | So tag với hai `package.json`, build launcher, `electron-builder --publish always` bằng `GITHUB_TOKEN` → tải lên một Release **nháp** (`releaseType: draft`) |

6. Mở trang Releases, mở bản **nháp** của tag, kiểm tra có đủ:
   - `Squarel-Art-Launcher-Setup-X.Y.Z.exe`;
   - `Squarel-Art-Launcher-Setup-X.Y.Z.exe.blockmap`;
   - `latest.yml`.
7. Thêm ghi chú phát hành và dòng SmartScreen ở trên.
8. Bấm **Publish release**. Chỉ khi đó Release mới công khai và launcher đã cài mới thấy bản cập nhật (bản nháp không có trong feed của `electron-updater`).

Workflow chạy khi đẩy tag `v*`, không dùng secret nào ngoài `GITHUB_TOKEN`. Lần chạy đầu tiên trên một tag thật mới là bài thử thật của workflow. Trước đó có thể chạy thử bằng tay: tab **Actions → release → Run workflow** (`workflow_dispatch`) chạy job `check` và job `dry-run` (build launcher, `electron-builder --publish never`), chỉ với quyền `contents: read`, không tạo Release và không tải lên gì. Trong workflow, giá trị như tên tag được truyền qua `env` (`$env:TAG`), không viết `${{ }}` thẳng trong script. Các action được ghim theo SHA commit đầy đủ; muốn nâng phiên bản action thì đổi cả SHA lẫn chú thích phiên bản.

`publish` trong `electron-builder.yml` phải trùng với feed trong `launcher/src/main/updates/updater-config.ts` (`github`, `t1tc01-personal`, `squarel-art-2`). Đổi một chỗ thì đổi cả hai.

## Thử trên máy sạch: Windows Sandbox

Windows Sandbox có sẵn trên Windows 11 Pro (bật trong *Turn Windows features on or off*). Sandbox **không có winget**, nên đây là bài thử nhánh "không có winget" của wizard.

1. Build bộ cài: `pnpm --dir launcher dist`.
2. Chạy:

   ```powershell
   powershell -ExecutionPolicy Bypass -File launcher\test\sandbox\open-sandbox.ps1
   ```

   Script điền đường dẫn tuyệt đối của `launcher\dist` vào bản sao của `launcher\test\sandbox\squarel.wsb` (ghi vào `%TEMP%`), rồi mở Sandbox. File `.wsb` trong repo chỉ có chỗ trống `__LAUNCHER_DIST__`, không chứa đường dẫn của máy nào.
3. Trong Sandbox, `C:\SquarelDist` là `launcher\dist` (chỉ đọc). Chạy bộ cài từ đó.
4. Build Aseprite trong Sandbox quá nặng: chọn "Đã có Aseprite" hoặc "Bỏ qua".

## Đã thử

### Tự động (khi làm bản 0.2.0)

- [x] `pnpm --dir launcher dist` tạo `launcher/dist/Squarel-Art-Launcher-Setup-0.2.0.exe` (123 056 547 byte, ~117 MB), `.blockmap` và `latest.yml` (`version: 0.2.0`).
- [x] `resources/` của bản build có `app.asar`, `LICENSE.md`, `app-update.yml` (provider github, owner `t1tc01-personal`, repo `squarel-art-2`).
- [x] `app.asar` có 2 271 mục: `out/` (main, preload, renderer), `package.json` và 108 gói thư viện chạy của main. Không có `.env`, `vendor/`, log, `.superpowers/`, source map, file `.ts`, React, font package hay đường dẫn thư mục người dùng. Mục "fixtures" duy nhất là `json-schema-traverse/spec/fixtures/schema.js` của thư viện bên thứ ba.
- [x] `pnpm check`, `pnpm --dir launcher check`, `pnpm --dir launcher e2e` xanh.

### Thủ công trên máy thật (chủ dự án làm, chưa làm)

- [ ] Cài exe, qua cảnh báo SmartScreen ("More info → Run anyway").
- [ ] Đi hết wizard ở chế độ "Dùng repo đã clone" trỏ vào repo này → tới Trang chủ, panel Kết nối hiện bridge và Aseprite.
- [ ] Bấm mở Aseprite từ launcher: Aseprite thật mở lên (spawn tách khỏi launcher), đóng launcher thì Aseprite vẫn chạy.
- [ ] Cài đặt → Giới thiệu → "PolyForm Shield 1.0.0 (LICENSE.md)" mở được `resources\LICENSE.md` của bản đã cài.
- [ ] Mở một project gần đây: `open_in_editor` gửi qua bridge, Aseprite mở đúng project.
- [ ] Bước cài công cụ trong wizard: cửa sổ terminal (`cmd /c start`) mở đúng, đường dẫn có dấu cách không vỡ.
- [ ] winget hỏi quyền admin và điều khoản trong cửa sổ đó, trả lời được.
- [ ] Cài xong Git/Node, bấm "Kiểm tra lại": launcher thấy công cụ mới nhờ đọc lại `PATH` từ registry, không cần mở lại.
- [ ] `winget` là App Execution Alias trong `%LOCALAPPDATA%\Microsoft\WindowsApps`: launcher chạy được.
- [ ] Khay: biểu tượng hiện, bấm trái mở cửa sổ, menu bấm phải đủ mục, "Thoát" tắt hẳn và dừng bridge của launcher.
- [ ] Bật "Khởi động cùng Windows": có mục khởi động (Task Manager → Startup apps), đăng nhập lại thì launcher mở ẩn dưới khay.
- [ ] Cập nhật launcher: cài bản cũ, phát hành bản mới, launcher tải nền rồi chỉ cài khi bấm "Khởi động lại để cập nhật" (`quitAndInstall`), khởi động lại đúng bản mới. Thoát launcher bình thường thì **không** tự cài.
- [ ] Cập nhật Squarel (chỉ làm được sau khi tag `v0.2.0` đã có trên GitHub): repo Squarel ở tag cũ hơn, bấm Cập nhật → `git fetch --tags --force`, `git checkout v0.2.0`, `pnpm install`, rồi cài lại extension. Thử hai lần: lần đầu để Aseprite **đang mở** (extension bị bỏ qua, có dòng nhắc đóng Aseprite, nút đổi thành "Hoàn tất cập nhật"); lần sau đóng Aseprite rồi bấm **"Hoàn tất cập nhật"** → extension được cài, nút biến mất.
- [ ] "Cài mới" trong wizard (chỉ sau khi phát hành): clone đúng tag `v0.2.0` vào `%LOCALAPPDATA%\SquarelArt\app` rồi `pnpm install`.
- [ ] Windows Sandbox: cài exe, wizard hiện nhánh "không có winget".
