<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import DesktopLayout from './layouts/DesktopLayout.vue';
import MobileLayout from './layouts/MobileLayout.vue';
import { useBreakpoints } from './composables/useBreakpoints';
import { useMarketStore } from './stores/marketStore';
import { usePortfolioStore } from './stores/portfolioStore';
import { useStockStore } from './stores/stockStore';

const { isMobile } = useBreakpoints();
const marketStore = useMarketStore();
const portfolioStore = usePortfolioStore();
const stockStore = useStockStore();
const timers = [];

onMounted(() => {
  portfolioStore.loadPortfolio();
  marketStore.loadMarket();
  stockStore.loadAllStocks();
  timers.push(setInterval(() => marketStore.loadMarket(), 30000));
  timers.push(setInterval(() => stockStore.loadAllStocks({ silent: true }), 60000));
  timers.push(setInterval(() => portfolioStore.refreshQuotes(), 30000));
});

onBeforeUnmount(() => {
  timers.forEach(timer => clearInterval(timer));
});
</script>

<template>
  <MobileLayout v-if="isMobile" />
  <DesktopLayout v-else />
</template>
