# Provider ảnh

Mọi provider đều cài đặt cùng interface `ImageProvider` (`src/providers/types.ts`). Router (`src/providers/router.ts`) chọn provider theo chất lượng được yêu cầu.

## `quality: "free"` (mặc định)

Router thử theo thứ tự:
1. `IMAGE_PROVIDER` trong `.env`;
2. `cloudflare`;
3. `local-sd` (chỉ khi `/health` trả lời).

Router không bao giờ tự chuyển sang provider trả phí.

## `quality: "high"`

Chỉ dùng Retro Diffusion. Các tool bắt buộc làm theo **giao thức báo giá**:
1. Lần gọi đầu trả `NEEDS_CONFIRM` kèm giá.
2. Hỏi người dùng.
3. Gọi lại với `confirm_cost: true`.

## Các provider

| Provider | Model | Tạo | Sửa | Inpaint | Animation | Ra pixel thật | Chi phí |
|---|---|---|---|---|---|---|---|
| `cloudflare` | FLUX.1-schnell; SD 1.5 img2img/inpainting | ✓ | ✓ | ✓ | – | qua chuẩn hoá | Free 10.000 neuron/ngày. FLUX khoảng 43 neuron/ảnh 512px |
| `retrodiffusion` | `rd_fast__default` (đổi qua `RETRO_DIFFUSION_STYLE`), animation `animation__four_angle_walking` | ✓ | ✓ | – | ✓ | ✓ (native) | Credit. `check_cost` báo giá miễn phí; quy đổi USD bằng `RETRO_DIFFUSION_USD_PER_CREDIT` (mặc định 0.01) |
| `local-sd` | SD 1.5 (+LoRA) trên GPU của máy | ✓ | ✓ | ✓ | – | qua chuẩn hoá | $0 |
| `mock` | ảnh giả định sẵn (sprite đối xứng trên nền magenta) | ✓ | ✓ | ✓ | ✓ | qua chuẩn hoá | $0, không cần mạng |

## Prompt

Với model đa năng (`src/providers/prompts.ts`), prompt yêu cầu nền **magenta (#ff00ff)** phẳng. Bộ chuẩn hoá dùng màu này làm "phông xanh" để xoá nền. Nếu dùng nền trắng, các điểm sáng màu trắng của sprite nằm sát viền sẽ bị xoá nhầm.

## Ngân sách

- Mọi lần gọi provider được ghi vào `DATA_DIR/usage.jsonl`.
- Cloudflare trong free tier được tính $0.
- Khi tổng tiền thật trong ngày cộng với lần gọi mới vượt `IMAGE_DAILY_BUDGET_USD`, tool trả lỗi `BUDGET`.
- Tool `usage_today` cho xem số tiền đã dùng.

## Cần kiểm tra lại khi nâng cấp

Endpoint và tên trường của Cloudflare (img2img/inpainting nhận mảng byte) và của Retro Diffusion (`prompt_style`, `input_palette`, `check_cost`, `base64_images`) được lấy từ tài liệu công khai năm 2026. Các phần này có test hợp đồng với fetch giả (`test/providers.test.ts`), nhưng **chưa gọi thử API thật**. Lần đầu dùng, hãy chạy:

```powershell
pnpm eval -- --provider cloudflare --yes
```

## Thêm provider mới

1. Cài đặt `ImageProvider`: `generate`, tuỳ chọn `edit`/`animate`, `quote`, `health`, `configured`.
2. Đăng ký trong `defaultProviders()` (`router.ts`).
3. Viết test hợp đồng với fetch giả.
