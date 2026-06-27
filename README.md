# 台股分析儀表板 — GitHub Pages 版

免費部署到 GitHub Pages，透過 Cloudflare Worker 解決 CORS 問題。

---

## 部署步驟（約 10 分鐘）

### 第一步：部署 Cloudflare Worker（CORS Proxy）

1. 前往 **https://workers.cloudflare.com/** 免費註冊（不需要信用卡）
2. 登入後點擊 **「Create a Worker」**
3. 把 `worker/twse-proxy.js` 的內容全部貼上，覆蓋預設程式碼
4. 點擊 **「Deploy」**
5. 記下你的 Worker 網址，格式類似：
   ```
   https://twse-proxy.yourname.workers.dev
   ```

### 第二步：填入 Worker 網址

開啟 `js/config.js`，把網址填入：

```js
const CONFIG = {
  PROXY_BASE: 'https://twse-proxy.yourname.workers.dev',  // ← 改這裡
};
```

### 第三步：上傳到 GitHub

```bash
# 建立 GitHub repo 後
git init
git add .
git commit -m "init"
git remote add origin https://github.com/你的帳號/taiwan-stock-dashboard.git
git push -u origin main
```

### 第四步：開啟 GitHub Pages

1. 進入 GitHub repo → **Settings** → **Pages**
2. Source 選擇 **Deploy from a branch**
3. Branch 選 **main**，資料夾選 **/ (root)**
4. 點 **Save**
5. 等約 1 分鐘，網址會出現在頁面上：
   ```
   https://你的帳號.github.io/taiwan-stock-dashboard/
   ```

### 第五步：設定 AI 分析（選用）

1. 前往 https://console.anthropic.com/ 取得 API Key
2. 開啟部署好的網頁，點右上角 ⚙️
3. 輸入 `sk-ant-api03-...` 格式的 Key → 儲存

---

## 專案結構

```
taiwan-stock-dashboard/
├── index.html          # 主頁面
├── css/
│   └── style.css       # 暗色主題
├── js/
│   ├── config.js       # ← 填入 Worker 網址
│   ├── data.js         # 產業別對照表
│   ├── api.js          # API 整合（透過 Worker）
│   └── app.js          # 主應用邏輯
└── worker/
    └── twse-proxy.js   # Cloudflare Worker 程式碼
```

---

## 架構說明

```
瀏覽器（GitHub Pages）
    ↓
Cloudflare Worker（免費，處理 CORS）
    ↓           ↓              ↓
TWSE OpenAPI  MIS 即時報價  Anthropic API
```

TWSE 不允許瀏覽器直接呼叫（CORS 限制），
Cloudflare Worker 作為中間層，加上 CORS header 後轉發。

---

## Cloudflare Worker 免費方案限制

| 項目 | 免費額度 |
|------|---------|
| 每日請求數 | 100,000 次 |
| CPU 時間 | 10ms / 次 |
| 費用 | 完全免費 |

個人使用完全足夠，一般一天頂多幾百次請求。
