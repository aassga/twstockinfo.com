<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IconRefresh } from '@tabler/icons-vue';
import { visibleNavItems } from '../router/navItems';
import { useChartStore } from '../stores/chartStore';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { useMarketStore } from '../stores/marketStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { useStockStore } from '../stores/stockStore';
import { formatNumber, formatSigned, formatVolume, moveClass } from '../utils/formatters';

const route = useRoute();
const router = useRouter();
const marketStore = useMarketStore();
const stockStore = useStockStore();
const portfolioStore = usePortfolioStore();
const institutionalStore = useInstitutionalStore();
const chartStore = useChartStore();
const now = ref(new Date());
const appIconSrc = `${import.meta.env.BASE_URL}icons/app.svg?v=20260628-2015`;
const isRefreshingAll = ref(false);
let clockTimer;

const marketChangeClass = computed(() => moveClass(marketStore.market.change).replace('is-', ''));
const instClass = computed(() => moveClass(institutionalStore.total).replace('is-', ''));

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 1000);
});

onBeforeUnmount(() => {
  clearInterval(clockTimer);
});

async function refreshAll() {
  if (isRefreshingAll.value) return;
  isRefreshingAll.value = true;
  try {
    await Promise.allSettled([
      marketStore.loadMarket(),
      stockStore.loadAllStocks({ silent: true }),
      portfolioStore.refreshQuotes(),
      institutionalStore.loadInstitutional({ silent: true }),
      chartStore.stock ? chartStore.loadChart() : Promise.resolve()
    ]);
  } finally {
    isRefreshingAll.value = false;
  }
}

function go(path) {
  router.push(path);
}
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <img class="logo-icon" :src="appIconSrc" alt="" aria-hidden="true" />
        <span class="logo-text">台股分析</span>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="item in visibleNavItems"
          :key="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
          type="button"
          @click="go(item.path)"
        >
          <component :is="item.icon" class="nav-icon" :stroke-width="2" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="live-indicator">
          <span class="live-dot"></span>
          <span>即時更新中</span>
        </div>
        <div class="sidebar-time">
          {{ now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="topbar-market">
          <div class="market-item">
            <span class="market-label">加權指數</span>
            <span class="market-value" :class="marketChangeClass">
              {{ formatNumber(marketStore.market.taiex || 0, 2) }}
            </span>
            <span class="market-chg" :class="marketChangeClass">
              {{ formatSigned(marketStore.market.change || 0, 2) }}
              ({{ formatSigned(marketStore.market.changePct || 0, 2, '%') }})
            </span>
          </div>
          <div class="market-divider"></div>
          <div class="market-item">
            <span class="market-label">成交量</span>
            <span class="market-value">{{ formatVolume(stockStore.marketStats.totalVolume) }}</span>
          </div>
          <div class="market-divider"></div>
          <div class="market-item">
            <span class="market-label">市場買超比</span>
            <span class="market-value" :class="stockStore.marketStats.upRatio >= 50 ? 'dn' : 'up'">
              {{ stockStore.marketStats.upRatio }}%
            </span>
          </div>
          <div class="market-divider"></div>
          <div class="market-item">
            <span class="market-label">三大法人合計</span>
            <span class="market-value" :class="instClass">
              {{ formatSigned(institutionalStore.total, 1, '億') }}
            </span>
          </div>
        </div>

        <div class="topbar-actions">
          <button class="icon-btn" title="重新整理" type="button" @click="refreshAll">
            <IconRefresh class="btn-icon" :class="{ 'is-refreshing': isRefreshingAll }" :stroke-width="2" />
          </button>
        </div>
      </header>

      <div class="content">
        <router-view />
      </div>
    </main>

    <nav class="mobile-bottom-nav" aria-label="手機功能切換">
      <button
        v-for="item in visibleNavItems"
        :key="`mobile-${item.path}`"
        class="mobile-bottom-nav-item"
        :class="{ active: route.path === item.path }"
        type="button"
        @click="go(item.path)"
      >
        <component :is="item.icon" class="nav-icon" :stroke-width="2" />
        <span>{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>
