import { defineStore } from 'pinia';
import { ref } from 'vue';
import { stockApi } from '../api/stockApi';

export const useChartStore = defineStore('chart', () => {
  const stock = ref(null);
  const interval = ref('D');
  const candles = ref([]);
  const loading = ref(false);
  const error = ref('');
  let chartRequestId = 0;

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
    const requestId = ++chartRequestId;
    const requestStock = stock.value;
    const requestInterval = interval.value;

    loading.value = true;
    error.value = '';
    try {
      const result = await stockApi.chart(requestStock.code, requestInterval, requestStock.exchange);
      if (requestId !== chartRequestId) return;
      candles.value = result.candles;
    } catch (err) {
      if (requestId !== chartRequestId) return;
      candles.value = [];
      error.value = err?.message || '走勢圖取得失敗';
    } finally {
      if (requestId === chartRequestId) loading.value = false;
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
