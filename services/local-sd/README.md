# local-sd (optional)

Chạy Stable Diffusion 1.5 ngay trên GPU của máy (GTX 1650 4GB vẫn chạy được, khoảng 20–60 giây/ảnh). Squarel gọi service này qua provider `local-sd`. Dùng $0, không cần mạng sau khi tải model.

## Cài đặt (Windows, PowerShell)

```powershell
cd services\local-sd
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

## Chạy

```powershell
$env:SD_LORA = "D:\models\my-pixel-lora.safetensors"   # tuỳ chọn: LoRA pixel art dành cho SD 1.5 (không dùng LoRA SDXL)
uvicorn app:app --host 127.0.0.1 --port 7861
```

Lần đầu chạy, model (~4GB) được tải về cache của Hugging Face.

Sau đó trong `.env` của repo:

```
IMAGE_PROVIDER=local-sd
LOCAL_SD_URL=http://127.0.0.1:7861
```

Nếu vẫn để `IMAGE_PROVIDER=cloudflare`, `local-sd` được dùng làm dự phòng khi Cloudflare lỗi (chỉ khi `/health` trả lời).

## Giấy phép

SD 1.5 dùng giấy phép CreativeML OpenRAIL-M (được dùng thương mại kèm điều kiện). Mỗi LoRA có giấy phép riêng: kiểm tra trước khi bán sản phẩm.
