import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { stockApi } from '../api/stockApi';

export const useTopVolumeStore = defineStore('topVolume', () => {
  const rows = ref([]);
  const loading = ref(false);
  const error = ref('');
  const updatedAt = ref('');

  const tradeDate = computed(() => rows.value[0]?.date || '');
  const leader = computed(() => rows.value[0] || null);
  const summary = computed(() => ({
    totalVolume: rows.value.reduce((sum, row) => sum + Number(row.volume || 0), 0),
    totalTransaction: rows.value.reduce((sum, row) => sum + Number(row.transaction || 0), 0)
  }));

  async function loadTopVolume({ silent = false } = {}) {
    if (loading.value) return;
    loading.value = true;
    if (!silent) error.value = '';

    try {
      rows.value = await stockApi.topVolume();
      updatedAt.value = new Date().toISOString();
    } catch (err) {
      error.value = err?.message || '成交量前二十名讀取失敗';
    } finally {
      loading.value = false;
    }
  }

  return {
    rows,
    loading,
    error,
    updatedAt,
    tradeDate,
    leader,
    summary,
    loadTopVolume
  };
});
