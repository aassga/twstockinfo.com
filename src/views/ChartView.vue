<script setup>
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import StockChart from '../components/StockChart.vue';
import { useChartStore } from '../stores/chartStore';
import { useStockStore } from '../stores/stockStore';
import { formatMoney, formatPct, moveClass } from '../utils/formatters';

const router = useRouter();
const stockStore = useStockStore();
const chartStore = useChartStore();
const query = ref(chartStore.stock?.code || stockStore.currentStock?.code || '');
const intervals = [
  { label: '1時', value: '60' },
  { label: '4時', value: '240' },
  { label: '1日', value: 'D' }
];

watch(() => chartStore.stock, stock => {
  if (stock?.code) query.value = stock.code;
});

async function search() {
  if (!query.value) return;
  try {
    let stock = stockStore.findStock(query.value);
    if (!stock) stock = await stockStore.searchStock(query.value);
    await chartStore.openStock(stock);
  } catch (error) {
    showToast(error?.message || '走勢圖讀取失敗');
  }
}

async function selectInterval(value) {
  await chartStore.setInterval(value);
}

function backToSearch() {
  if (chartStore.stock?.code) stockStore.searchQuery = chartStore.stock.code;
  router.push('/search');
}
</script>

<template>
  <section class="view-stack">
    <van-search
      v-model="query"
      shape="round"
      placeholder="輸入股票代號或名稱"
      :show-action="true"
      @search="search"
    >
      <template #action>
        <button class="text-action" type="button" @click="search">搜尋</button>
      </template>
    </van-search>

    <article v-if="chartStore.stock" class="panel chart-stock-strip">
      <div>
        <strong>{{ chartStore.stock.name }}</strong>
        <span>{{ chartStore.stock.code }}</span>
      </div>
      <button class="text-action" type="button" @click="backToSearch">明細</button>
    </article>

    <div class="filter-row">
      <button
        v-for="item in intervals"
        :key="item.value"
        :class="{ active: chartStore.interval === item.value }"
        type="button"
        @click="selectInterval(item.value)"
      >
        {{ item.label }}
      </button>
    </div>

    <StockChart
      :candles="chartStore.candles"
      :interval="chartStore.interval"
      :loading="chartStore.loading"
      :error="chartStore.error"
    />

    <div v-if="chartStore.stock" class="metric-grid three">
      <div>
        <span>現價</span>
        <strong>{{ formatMoney(chartStore.stock.price, 2) }}</strong>
      </div>
      <div>
        <span>漲跌幅</span>
        <strong :class="moveClass(chartStore.stock.chgPct)">
          {{ formatPct(chartStore.stock.chgPct) }}
        </strong>
      </div>
      <div>
        <span>K棒數</span>
        <strong>{{ chartStore.candles.length }}</strong>
      </div>
    </div>
  </section>
</template>
