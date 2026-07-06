import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { stockApi } from '../api/stockApi';

export const useInstitutionalStore = defineStore('institutional', () => {
  const rows = ref([]);
  const byCode = ref({});
  const codeLoading = ref({});
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

  async function loadInstitutionalByCode(code, { force = false } = {}) {
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) return null;
    if (!force && byCode.value[normalizedCode]) return byCode.value[normalizedCode];

    codeLoading.value = { ...codeLoading.value, [normalizedCode]: true };
    try {
      const row = await stockApi.institutionalByCode(normalizedCode);
      byCode.value = {
        ...byCode.value,
        [normalizedCode]: {
          ...row,
          name: row.name || rows.value.find(item => item.code === normalizedCode)?.name || ''
        }
      };
      return byCode.value[normalizedCode];
    } catch (err) {
      const fallback = rows.value.find(item => item.code === normalizedCode) || null;
      if (fallback) {
        byCode.value = { ...byCode.value, [normalizedCode]: fallback };
      }
      return fallback;
    } finally {
      codeLoading.value = { ...codeLoading.value, [normalizedCode]: false };
    }
  }

  return {
    rows,
    byCode,
    codeLoading,
    summary,
    total,
    topBuy,
    topSell,
    loading,
    loaded,
    error,
    loadInstitutional,
    loadInstitutionalByCode
  };
});
