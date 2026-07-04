# 🔧 Supabase 設定教學（5 分鐘完成）

## 步驟 1：建立免費帳號

1. 前往 [https://supabase.com](https://supabase.com)
2. 點擊 **「Start your project」** → 用 GitHub 或 Email 註冊（完全免費）
3. 登入後點擊 **「New project」**
4. 填寫：
   - **Project name**：例如 `symptom-db`
   - **Database password**：設一個強密碼（記下來備用）
   - **Region**：選 `Northeast Asia (Tokyo)` 最近
5. 點擊 **「Create new project」**，等待約 1 分鐘

---

## 步驟 2：建立資料表（SQL）

1. 在左側選單點 **「SQL Editor」**
2. 點擊 **「New query」**
3. 貼上以下 SQL 並點擊 **「Run」**：

```sql
-- 建立圖片資料表
CREATE TABLE symptom_images (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT DEFAULT '',
  image_url   TEXT NOT NULL,
  symptoms    TEXT[] DEFAULT '{}',
  ocr_text    TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 開啟 Row Level Security
ALTER TABLE symptom_images ENABLE ROW LEVEL SECURITY;

-- 允許所有人讀取、新增、刪除（無帳號系統）
CREATE POLICY "Public access" ON symptom_images
  FOR ALL USING (true) WITH CHECK (true);
```

出現 **「Success. No rows returned」** 代表成功。

---

## 步驟 3：建立圖片儲存空間（Storage）

1. 在左側選單點 **「Storage」**
2. 點擊 **「New bucket」**
3. 填寫：
   - **Name**：`symptom-images`（必須完全一樣！）
   - 勾選 **「Public bucket」**（公開，讓圖片能被顯示）
4. 點擊 **「Save」**

---

## 步驟 4：取得連線資訊

1. 在左側選單點 **「Project Settings」**（齒輪圖示）
2. 點擊 **「API」**
3. 找到這兩個值並複製：

| 欄位 | 位置 | 說明 |
|---|---|---|
| **Project URL** | `Project URL` 欄位 | 長得像 `https://abcdef.supabase.co` |
| **Anon Key** | `Project API keys` → `anon public` | 很長的 JWT 字串 |

---

## 步驟 5：輸入到 App

1. 用瀏覽器開啟 `index.html`（直接雙點擊）
2. 出現設定視窗，貼上剛才複製的 **Project URL** 和 **Anon Key**
3. 點擊 **「開始使用」**

✅ **完成！** 現在可以上傳圖片並用症狀搜尋了。

---

## 免費額度說明

| 項目 | 免費額度 | 說明 |
|---|---|---|
| 資料庫 | 500 MB | 足夠儲存數千筆記錄 |
| 圖片儲存 | 1 GB | 約可儲存 500~2000 張醫療圖片 |
| 頻寬 | 5 GB / 月 | 一般使用完全夠用 |
| 資料無期限 | ✅ 永久 | 只要帳號存在，資料不消失 |

> ⚠️ **Supabase 免費專案如果連續 7 天沒有使用（沒有任何請求），會進入休眠**
> 解決方法：只要打開 App 查詢一次就會喚醒（幾秒鐘）
> 或升級到 Pro ($25/月) 就不會休眠。

---

## 常見問題

**Q: 上傳圖片失敗？**
→ 確認 Storage bucket 名稱是否為 `symptom-images`（完全一樣，包含連字號）
→ 確認 bucket 有勾選 Public

**Q: 看得到資料表但搜不到圖片？**
→ 確認 SQL 中的 Policy 有執行成功

**Q: OCR 辨識很慢？**
→ 第一次使用需下載中文語言包（約 30 MB），下載後快取到瀏覽器就不需再下載
