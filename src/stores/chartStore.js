import { defineStore } from 'pinia';
import { ref } from 'vue';
import { stockApi } from '../api/stockApi';

export const useChartStore = defineStore('chart', () => {
  const stock = ref(null);
  const interval = ref('D');
  const candles = ref([]);
  const loading = ref(false);
  const error = ref('');

  async function openStock(nextStock, nextInterval = interval.value) {
    if (!nextStock?.code) return;
    stock.value = nextStock;
    interval.value = nextInterval;
    await loadChart();
  }

  async function setInterval(nextInterval) {
    interval.value = nextInterval;
    if (stock.value) await loadChart();
  }

  async function loadChart() {
    if (!stock.value?.code) return;
    loading.value = true;
    error.value = '';
    try {
      const result = await stockApi.chart(stock.value.code, interval.value, stock.value.exchange);
      candles.value = result.candles;
    } catch (err) {
      candles.value = [];
      error.value = err?.message || '走勢圖讀取失敗';
    } finally {
      loading.value = false;
    }
  }

  return {
    stock,
    interval,
    candles,
    loading,
    error,
    openStock,
    setInterval,
    loadChart
  };
});
