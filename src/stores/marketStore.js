import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { stockApi } from '../api/stockApi';

export const useMarketStore = defineStore('market', () => {
  const loading = ref(false);
  const error = ref('');
  const market = ref({
    taiex: 0,
    change: 0,
    changePct: 0,
    sign: '+'
  });

  const isUp = computed(() => market.value.sign !== '-' && Number(market.value.change) >= 0);

  async function loadMarket() {
    loading.value = true;
    error.value = '';
    try {
      market.value = await stockApi.market();
    } catch (err) {
      error.value = err?.message || '市場資料讀取失敗';
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    error,
    market,
    isUp,
    loadMarket
  };
});
