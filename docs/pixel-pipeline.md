# Chuẩn hoá pixel (`src/core/normalize.ts`)

Mọi ảnh từ provider và mọi ảnh chụp đều đi qua `normalize(rgba, options)`. Kết quả là ảnh chỉ số (indexed), kèm palette và báo cáo chất lượng.

## Các bước

1. **Alpha nhị phân:** `a < 128` thành 0, còn lại thành 255.
2. **Xoá nền** (mặc định bật khi ảnh không có vùng trong suốt):
   - Màu chiếm ≥30% viền ảnh được coi là nền.
   - Flood-fill từ mép ảnh với ngưỡng ΔE(OKLab) < 0.06.
3. **Dò lưới:**
   - Tính "tín hiệu cạnh" trên cột và hàng: hai pixel kề nhau có ΔE > 0.03.
   - Với mỗi cặp kích thước ô `s` (từ 2 đến 64) và độ lệch `o`, tính điểm `(tỉ lệ cạnh rơi đúng bội số của s − 1/s) / (1 − 1/s)`. Phần trừ 1/s loại bỏ phần trùng do ngẫu nhiên.
   - Khi điểm gần bằng nhau, ưu tiên `s` lớn hơn (vì lưới 16 cũng đạt điểm tối đa ở 8).
   - Nếu hai trục x và y cho kết quả lệch nhau, độ tin cậy bị nhân 0,6.
   - Nếu độ tin cậy < 0.35, coi như không có lưới.
4. **Thu về lưới gốc:**
   - Mỗi ô lấy **màu xuất hiện nhiều nhất** (gom theo nhóm 5 bit mỗi kênh), bỏ ¼ viền ô để tránh pixel bị khử răng cưa.
   - Một ô được coi là trong suốt khi hơn nửa số pixel của nó trong suốt.
5. **Về kích thước đích:**
   - Resample bằng màu chiếm đa số theo vùng (không lấy trung bình), nên không sinh màu lai.
   - Giữ tỉ lệ khung hình, căn giữa, phần thừa để trong suốt.
6. **Lượng tử hoá màu:**
   - Có palette: mỗi màu về màu gần nhất trong OKLab.
   - Không có palette: chạy k-means++ trong OKLab với seed cố định, sau đó gộp các cụm có ΔE < 0.02.
7. **Despeckle:**
   - Chỉ xoá chấm lạc nằm giữa vùng trong suốt.
   - Giữ nguyên pixel đơn lẻ **bên trong** sprite (mắt, điểm sáng): đó là chi tiết có chủ ý.
8. **Báo cáo:**
   - `{blockSize, offset, gridConfidence, colorCount, transparentRatio, backgroundRemoved, warnings}`.
   - Cảnh báo khi `gridConfidence < 0.6`, hoặc ảnh gần như trống.

`generate_image` tự sinh lại **một lần** những biến thể có `gridConfidence < 0.6`. Việc này chỉ áp dụng cho provider miễn phí và không ra pixel thật sẵn.

**Cùng một đầu vào luôn cho cùng một đầu ra:** không có phần nào dùng số ngẫu nhiên không có seed.

## Ảnh chụp → pixel (`photo_to_pixel`)

1. `sharp` xoay ảnh theo EXIF và thu nhỏ (lanczos3, contain) về kích thước đích.
2. Chạy `normalize`. Ở kích thước này không còn lưới để dò, nên chủ yếu là lượng tử hoá màu và despeckle.
3. Xoá nền là tuỳ chọn.

## Kiểm thử

`test/core.test.ts`:
- khôi phục đúng sprite 8×8 từ ảnh phóng to 16× có nhiễu (ảnh kiểu AI);
- lưới bị lệch offset, ép palette;
- kết quả không đổi giữa các lần chạy;
- property test: mọi pixel thuộc palette, số màu ≤ N.
