<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useMarketStore } from '../stores/marketStore';
import { useStockStore } from '../stores/stockStore';
import { visibleNavItems } from '../router/navItems';
import { formatNumber, formatPct, formatVolume, moveClass } from '../utils/formatters';

const route = useRoute();
const marketStore = useMarketStore();
const stockStore = useStockStore();
const title = computed(() => route.meta.title || '台股資訊');

function refresh() {
  marketStore.loadMarket();
  stockStore.loadAllStocks({ silent: true });
}
</script>

<template>
  <el-container class="desktop-shell">
    <el-aside width="224px" class="desktop-aside">
      <div class="desktop-brand">
        <span class="desktop-brand-mark">📈</span>
        <span>台股資訊</span>
      </div>
      <el-menu router :default-active="route.path" class="desktop-menu">
        <el-menu-item v-for="item in visibleNavItems" :key="item.path" :index="item.path">
          <component :is="item.icon" class="nav-menu-icon" :size="22" :stroke-width="2" />
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="desktop-header">
        <div>
          <div class="desktop-title">{{ title }}</div>
          <div class="desktop-subtitle">Vue 3 + Vite 重構第一階段</div>
        </div>
        <div class="desktop-market">
          <div class="desktop-market-item">
            <span>加權指數</span>
            <strong :class="moveClass(marketStore.market.change)">
              {{ formatNumber(marketStore.market.taiex, 2) }}
            </strong>
          </div>
          <div class="desktop-market-item">
            <span>漲跌幅</span>
            <strong :class="moveClass(marketStore.market.changePct)">
              {{ formatPct(marketStore.market.changePct) }}
            </strong>
          </div>
          <div class="desktop-market-item">
            <span>成交量</span>
            <strong>{{ formatVolume(stockStore.marketStats.totalVolume) }}</strong>
          </div>
          <el-button type="primary" plain @click="refresh">更新</el-button>
        </div>
      </el-header>

      <el-main class="desktop-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
