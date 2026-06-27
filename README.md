# 台股資訊儀表板

Vue 3 + Vite 版本的台股資訊工具，第一階段已建立行動版/PWA 架構，並保留原本靜態版在 `legacy/`。

## 技術組合

- Vue 3 + Vite
- Pinia 狀態管理
- Vue Router
- SCSS
- Vant 行動端 UI
- Element Plus 桌機端 UI
- Tabler Icons
- vite-plugin-pwa
- Cloudflare Worker 作為 TWSE / Yahoo Finance / Claude proxy

## 本機開發

```bash
npm install
npm run dev
```

預設網址：

```text
http://127.0.0.1:5173/
```

## Production Build

```bash
npm run build
```

輸出目錄：

```text
dist/
```

GitHub Pages 應部署 `dist/`，不要直接部署 Vue 原始碼。

## GitHub Pages

已加入 GitHub Actions workflow：

```text
.github/workflows/deploy-pages.yml
```

Repo 的 GitHub Pages 設定請選：

```text
Settings -> Pages -> Source: GitHub Actions
```

目前 Vite production build 使用相對路徑 `./`，可支援 GitHub Pages 專案路徑與自訂網域。若未來要固定成自訂網域根目錄，也可以改成 `base: '/'`。

## Worker

前端預設使用：

```text
https://twse-proxy.98412060.workers.dev
```

可用 `.env.local` 覆蓋：

```bash
VITE_PROXY_BASE=https://your-worker.workers.dev
```

Worker 程式仍位於：

```text
worker/twse-proxy.js
```

## 舊版靜態站

原本的 HTML / CSS / JS 版本已移到：

```text
legacy/
```

後續重構可以持續參考舊版功能，不會和新的 Vite 根目錄互相干擾。

## 第一階段範圍

- 建立 Vue 3 + Vite 專案骨架
- 建立 Pinia stores 與共用 API 模組
- 建立手機版搜尋、持股、熱門排行、走勢圖主要流程
- 建立桌機版 Element Plus 外框
- 補回買賣提醒、三大法人、AI 分析入口
- 套用黑色風格與一致的側欄圖示
- 加入 PWA manifest、service worker 與 GitHub Pages Actions
- favicon / PWA icon 使用 `📈`
