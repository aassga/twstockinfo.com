<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useChartStore } from '../stores/chartStore';
import { useMarketStore } from '../stores/marketStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { useStockStore } from '../stores/stockStore';
import { visibleNavItems } from '../router/navItems';

const route = useRoute();
const marketStore = useMarketStore();
const stockStore = useStockStore();
const portfolioStore = usePortfolioStore();
const chartStore = useChartStore();
const title = computed(() => route.meta.title || '台股資訊');

async function refresh() {
  await Promise.allSettled([
    marketStore.loadMarket(),
    stockStore.loadAllStocks({ silent: true }),
    portfolioStore.refreshQuotes(),
    chartStore.stock ? chartStore.loadChart() : Promise.resolve()
  ]);
}
</script>

<template>
  <div class="mobile-shell">
    <van-nav-bar fixed placeholder safe-area-inset-top :title="title">
      <template #right>
        <button class="plain-icon-button" type="button" aria-label="更新" @click="refresh">
          ↻
        </button>
      </template>
    </van-nav-bar>

    <main class="mobile-content">
      <router-view />
    </main>

    <van-tabbar route fixed placeholder safe-area-inset-bottom class="mobile-tabbar">
      <van-tabbar-item v-for="item in visibleNavItems" :key="item.path" :to="item.path">
        <template #icon>
          <component :is="item.icon" :size="21" :stroke-width="2" />
        </template>
        {{ item.label }}
      </van-tabbar-item>
    </van-tabbar>
  </div>
</template>
