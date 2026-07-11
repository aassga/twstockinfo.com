<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue';
import DesktopLayout from './layouts/DesktopLayout.vue';
import { useFavoriteStore } from './stores/favoriteStore';
import { useInstitutionalStore } from './stores/institutionalStore';
import { useMarketStore } from './stores/marketStore';
import { useNotificationStore } from './stores/notificationStore';
import { usePortfolioStore } from './stores/portfolioStore';
import { useStockStore } from './stores/stockStore';
import { useSystemStore } from './stores/systemStore';

const marketStore = useMarketStore();
const institutionalStore = useInstitutionalStore();
const portfolioStore = usePortfolioStore();
const favoriteStore = useFavoriteStore();
const stockStore = useStockStore();
const notificationStore = useNotificationStore();
const systemStore = useSystemStore();
const timers = [];
const cleanupHandlers = [];

onMounted(() => {
  portfolioStore.loadPortfolio();
  favoriteStore.loadFavorites();
  notificationStore.loadNotifications();
  marketStore.loadMarket();
  stockStore.loadAllStocks();
  institutionalStore.loadInstitutional({ silent: true });
  timers.push(setInterval(() => runWhenVisible(() => marketStore.loadMarket()), 30000));
  timers.push(setInterval(() => runWhenVisible(() => stockStore.loadAllStocks({ silent: true })), 60000));
  timers.push(setInterval(() => runWhenVisible(() => institutionalStore.loadInstitutional({ silent: true })), 180000));
  timers.push(setInterval(() => runWhenVisible(() => portfolioStore.refreshQuotes()), 30000));

  const onUpdateReady = () => systemStore.setUpdateAvailable(true);
  const onError = event => systemStore.recordError(event.error || event.message, 'window.error');
  const onUnhandledRejection = event => systemStore.recordError(event.reason, 'unhandledrejection');
  window.addEventListener('twstock:pwa-update-ready', onUpdateReady);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  cleanupHandlers.push(
    () => window.removeEventListener('twstock:pwa-update-ready', onUpdateReady),
    () => window.removeEventListener('error', onError),
    () => window.removeEventListener('unhandledrejection', onUnhandledRejection)
  );
});

watch(
  () => stockStore.allStocks,
  rows => notificationStore.evaluateStocks(rows),
  { deep: false }
);

onBeforeUnmount(() => {
  timers.forEach(timer => clearInterval(timer));
  cleanupHandlers.forEach(cleanup => cleanup());
});

function runWhenVisible(task) {
  if (typeof document !== 'undefined' && document.hidden) return;
  task();
}
</script>

<template>
  <DesktopLayout />
  <div v-if="systemStore.updateAvailable" class="pwa-update-banner">
    <span>已有新版可用，更新後可避免舊快取造成資料不同步。</span>
    <button type="button" @click="systemStore.applyUpdate()">立即更新</button>
    <button type="button" @click="systemStore.setUpdateAvailable(false)">稍後</button>
  </div>
</template>
