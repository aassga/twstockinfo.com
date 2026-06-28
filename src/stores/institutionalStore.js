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
  const loaded = ref(false);
  const error = ref('');
  let activeRequest = null;

  const total = computed(() => Number((summary.value.foreign + summary.value.trust + summary.value.dealer).toFixed(2)));
  const topBuy = computed(() => rows.value.filter(row => row.total > 0).slice(0, 10));
  const topSell = computed(() => rows.value.filter(row => row.total < 0).slice(0, 10));

  async function loadInstitutional({ silent = false } = {}) {
    if (activeRequest) return activeRequest;
    loading.value = true;
    if (!silent) error.value = '';

    activeRequest = Promise.all([
      stockApi.institutional(),
      stockApi.instSummary()
    ])
      .then(([nextRows, nextSummary]) => {
        rows.value = nextRows;
        summary.value = nextSummary;
        loaded.value = true;
      })
      .catch(err => {
        error.value = err?.message || '法人資料讀取失敗';
      })
      .finally(() => {
        loading.value = false;
        activeRequest = null;
      });

    return activeRequest;
  }

  return {
    rows,
    summary,
    total,
    topBuy,
    topSell,
    loading,
    loaded,
    error,
    loadInstitutional
  };
});
