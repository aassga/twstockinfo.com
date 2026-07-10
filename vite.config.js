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

export default defineConfig(({ command }) => {
  const disablePwa = process.env.DISABLE_PWA === 'true';

  return {
    base: command === 'serve' ? '/' : '/twstockinfo.com/',
    appType: 'spa',
    plugins: [
      devRootIndexFallback(),
      vue(),
      disablePwa ? null : VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/app.svg',
        'icons/app.png',
        'icons/icon-180.png',
        'icons/icon-192.png',
        'icons/icon-512.png'
      ],
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
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
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
    ].filter(Boolean),
    resolve: disablePwa
      ? {
          alias: {
            'virtual:pwa-register': '/src/pwaRegisterStub.js'
          }
        }
      : undefined,
    server: {
      host: '0.0.0.0',
      port: 5173,
      headers: {
        'Cache-Control': 'no-store'
      }
    },
    preview: {
      host: '0.0.0.0',
      port: 4173
    }
  };
});
