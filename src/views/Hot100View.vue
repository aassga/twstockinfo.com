<script setup>
import { useRouter } from 'vue-router';
import { useChartStore } from '../stores/chartStore';
import { useStockStore } from '../stores/stockStore';
import { formatMoney, formatPct, formatVolume, moveClass } from '../utils/formatters';

const router = useRouter();
const stockStore = useStockStore();
const chartStore = useChartStore();

async function openChart(stock) {
  await chartStore.openStock(stock);
  router.push('/chart');
}
</script>

<template>
  <section class="view-stack">
    <van-search v-model="stockStore.hotSearch" shape="round" placeholder="搜尋代號或名稱" />

    <div class="filter-row">
      <button :class="{ active: stockStore.hotFilter === 'all' }" type="button" @click="stockStore.hotFilter = 'all'">全部</button>
      <button :class="{ active: stockStore.hotFilter === 'up' }" type="button" @click="stockStore.hotFilter = 'up'">上漲</button>
      <button :class="{ active: stockStore.hotFilter === 'down' }" type="button" @click="stockStore.hotFilter = 'down'">下跌</button>
    </div>

    <div class="sort-row">
      <button type="button" @click="stockStore.setHotSort('volume')">成交量</button>
      <button type="button" @click="stockStore.setHotSort('chgPct')">漲跌幅</button>
      <button type="button" @click="stockStore.setHotSort('price')">股價</button>
      <button type="button" @click="stockStore.setHotSort('buyPct')">買盤</button>
    </div>

    <van-skeleton v-if="stockStore.loadingAll" title :row="8" />

    <div v-else class="ranking-list">
      <button
        v-for="(stock, index) in stockStore.hotStocks.slice(0, 100)"
        :key="stock.code"
        class="ranking-row"
        type="button"
        @click="openChart(stock)"
      >
        <span class="rank">{{ index + 1 }}</span>
        <span class="ranking-main">
          <strong>{{ stock.name }}</strong>
          <small>{{ stock.code }} · {{ stock.sector }} · {{ formatVolume(stock.volume) }}</small>
        </span>
        <span class="ranking-price">
          <strong>{{ formatMoney(stock.price, 2) }}</strong>
          <small :class="moveClass(stock.chgPct)">{{ formatPct(stock.chgPct) }}</small>
        </span>
      </button>
    </div>
  </section>
</template>
