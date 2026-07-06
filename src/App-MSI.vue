<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import DesktopLayout from './layouts/DesktopLayout.vue';
import { useFavoriteStore } from './stores/favoriteStore';
import { useInstitutionalStore } from './stores/institutionalStore';
import { useMarketStore } from './stores/marketStore';
import { usePortfolioStore } from './stores/portfolioStore';
import { useStockStore } from './stores/stockStore';

const marketStore = useMarketStore();
const institutionalStore = useInstitutionalStore();
const portfolioStore = usePortfolioStore();
const favoriteStore = useFavoriteStore();
const stockStore = useStockStore();
const timers = [];

onMounted(() => {
  portfolioStore.loadPortfolio();
  favoriteStore.loadFavorites();
  marketStore.loadMarket();
  stockStore.loadAllStocks();
  institutionalStore.loadInstitutional({ silent: true });
  timers.push(setInterval(() => marketStore.loadMarket(), 30000));
  timers.push(setInterval(() => stockStore.loadAllStocks({ silent: true }), 60000));
  timers.push(setInterval(() => institutionalStore.loadInstitutional({ silent: true }), 180000));
  timers.push(setInterval(() => portfolioStore.refreshQuotes(), 30000));
});

onBeforeUnmount(() => {
  timers.forEach(timer => clearInterval(timer));
});
</script>

<template>
  <DesktopLayout />
</template>
