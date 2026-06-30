import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

function devRootIndexFallback() {
  return {
    name: 'dev-root-index-fallback',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/') req.url = '/index.html';
        next();
      });
    }
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/twstockinfo.com/',
  appType: 'spa',
  plugins: [
    devRootIndexFallback(),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/app.svg'],
      manifest: {
        name: '台股資訊儀表板',
        short_name: '台股資訊',
        description: '台股搜尋分析、持股追蹤、前100熱門台股、即時走勢圖、買賣提醒、三大法人與 AI 市場分析工具。',
        lang: 'zh-TW',
        dir: 'ltr',
        categories: ['finance', 'business', 'productivity'],
        theme_color: '#0f131c',
        background_color: '#0f131c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/twstockinfo.com/',
        scope: '/twstockinfo.com/',
        icons: [
          {
            src: 'icons/app.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico}']
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
}));
