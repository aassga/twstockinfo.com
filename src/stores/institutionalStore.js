import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { stockApi } from '../api/stockApi';

export const useInstitutionalStore = defineStore('institutional', () => {
  const rows = ref([]);
  const summary = ref({
    foreign: 0,
    trust: 0,
    dealer: 0
  });
  const loading = ref(false);
  const error = ref('');

  const total = computed(() => Number((summary.value.foreign + summary.value.trust + summary.value.dealer).toFixed(2)));
  const topBuy = computed(() => rows.value.filter(row => row.total > 0).slice(0, 10));
  const topSell = computed(() => rows.value.filter(row => row.total < 0).slice(0, 10));

  async function loadInstitutional({ silent = false } = {}) {
    if (loading.value) return;
    loading.value = true;
    if (!silent) error.value = '';

    try {
      const [nextRows, nextSummary] = await Promise.all([
        stockApi.institutional(),
        stockApi.instSummary()
      ]);
      rows.value = nextRows;
      summary.value = nextSummary;
    } catch (err) {
      error.value = err?.message || '法人資料讀取失敗';
    } finally {
      loading.value = false;
    }
  }

  return {
    rows,
    summary,
    total,
    topBuy,
    topSell,
    loading,
    error,
    loadInstitutional
  };
});
