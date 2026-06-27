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
  base: command === 'serve' ? '/' : './',
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
        description: '台股搜尋、持股追蹤與走勢圖工具',
        theme_color: '#f6f8fb',
        background_color: '#f6f8fb',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
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
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.includes('workers.dev'),
            handler: 'NetworkOnly',
            options: {
              cacheName: 'stock-api-network-only'
            }
          }
        ]
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
