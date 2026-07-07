<script setup>
import { computed, ref, watch } from 'vue';
import { showToast } from 'vant';
import { IconChartCandle, IconSearch } from '@tabler/icons-vue';
import StockChart from '../components/StockChart.vue';
import TechnicalSummary from '../components/TechnicalSummary.vue';
import { useChartStore } from '../stores/chartStore';
import { useStockStore } from '../stores/stockStore';

const stockStore = useStockStore();
const chartStore = useChartStore();
const query = ref(chartStore.stock?.code || stockStore.currentStock?.code || '');
const intervals = [
  { label: '1時', value: '60' },
  { label: '4時', value: '240' },
  { label: '1日', value: 'D' }
];
const currentIntervalLabel = computed(() =>
  intervals.find(item => item.value === chartStore.interval)?.label || chartStore.interval
);

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
    showToast(error?.message || '走勢圖取得失敗');
  }
}
</script>

<template>
  <section class="tab-content active">
    <div class="chart-page">
      <div class="chart-header">
        <div>
          <div class="page-title chart-title">
            <IconChartCandle class="title-icon" :stroke-width="2" />
            <span>{{ chartStore.stock ? `${chartStore.stock.code} ${chartStore.stock.name || ''}` : '股票走勢圖' }}</span>
          </div>
          <div class="chart-subtitle">
            {{ chartStore.stock ? `目前週期：${currentIntervalLabel}` : '請從股票列表選擇一檔股票' }}
          </div>
        </div>
        <div class="chart-controls">
          <div class="chart-search">
            <input
              v-model="query"
              class="chart-search-input"
              placeholder="輸入股票代號或名稱"
              @keydown.enter="search"
            />
            <button class="icon-btn chart-search-btn" type="button" title="搜尋走勢圖" @click="search">
              <IconSearch class="btn-icon" :stroke-width="2" />
            </button>
          </div>
          <div class="timeframe-group" role="group" aria-label="走勢圖週期">
            <button
              v-for="item in intervals"
              :key="item.value"
              class="timeframe-btn"
              :class="{ active: chartStore.interval === item.value }"
              type="button"
              @click="chartStore.setInterval(item.value)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
      </div>

      <TechnicalSummary
        :candles="chartStore.candles"
        :interval="chartStore.interval"
        :loading="chartStore.loading"
      />

      <div class="chart-frame">
        <div v-if="!chartStore.stock && !chartStore.loading" class="chart-empty">
          <IconChartCandle class="title-icon" :size="42" :stroke-width="1.8" />
          <span>請搜尋股票或從列表開啟走勢圖</span>
        </div>
        <div v-else-if="chartStore.loading" class="chart-loading">
          <div class="spinner"></div>
          <span>走勢圖載入中...</span>
        </div>
        <div v-else-if="chartStore.error" class="chart-error">
          {{ chartStore.error }}
        </div>
        <StockChart
          v-else
          :candles="chartStore.candles"
          :interval="chartStore.interval"
          :loading="chartStore.loading"
          :error="chartStore.error"
        />
      </div>
    </div>
  </section>
</template>
