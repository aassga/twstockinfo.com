import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { stockApi } from '../api/stockApi';

export const useInstitutionalStore = defineStore('institutional', () => {
  const rows = ref([]);
  const byCode = ref({});
  const trendByCode = ref({});
  const codeLoading = ref({});
  const trendLoading = ref({});
  const summary = ref({
    foreign: 0,
    trust: 0,
    dealer: 0
  });
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref('');
  let activeRequest = null;
  const codeRequests = new Map();
  const trendRequests = new Map();

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
    if (codeRequests.has(normalizedCode)) return codeRequests.get(normalizedCode);

    codeLoading.value = { ...codeLoading.value, [normalizedCode]: true };

    const request = stockApi.institutionalByCode(normalizedCode)
      .then(row => {
        byCode.value = {
          ...byCode.value,
          [normalizedCode]: {
            ...row,
            name: row.name || rows.value.find(item => item.code === normalizedCode)?.name || ''
          }
        };
        return byCode.value[normalizedCode];
      })
      .catch(() => {
        const fallback = rows.value.find(item => item.code === normalizedCode) || null;
        if (fallback) {
          byCode.value = { ...byCode.value, [normalizedCode]: fallback };
        }
        return fallback;
      })
      .finally(() => {
        codeLoading.value = { ...codeLoading.value, [normalizedCode]: false };
        codeRequests.delete(normalizedCode);
      });

    codeRequests.set(normalizedCode, request);
    return request;
  }

  async function loadInstitutionalTrendByCode(code, { force = false } = {}) {
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) return [];
    if (!force && trendByCode.value[normalizedCode]) return trendByCode.value[normalizedCode];
    if (trendRequests.has(normalizedCode)) return trendRequests.get(normalizedCode);

    trendLoading.value = { ...trendLoading.value, [normalizedCode]: true };

    const request = stockApi.institutionalTrend(normalizedCode)
      .then(trendRows => {
        const fallbackName = byCode.value[normalizedCode]?.name || rows.value.find(item => item.code === normalizedCode)?.name || '';
        const normalizedRows = trendRows.map(row => ({
          ...row,
          name: row.name || fallbackName
        }));
        trendByCode.value = {
          ...trendByCode.value,
          [normalizedCode]: normalizedRows
        };
        if (normalizedRows[0]) {
          byCode.value = {
            ...byCode.value,
            [normalizedCode]: {
              ...normalizedRows[0],
              name: normalizedRows[0].name || fallbackName
            }
          };
        }
        return normalizedRows;
      })
      .catch(() => {
        const fallback = byCode.value[normalizedCode] || rows.value.find(item => item.code === normalizedCode) || null;
        const fallbackRows = fallback ? [fallback] : [];
        trendByCode.value = { ...trendByCode.value, [normalizedCode]: fallbackRows };
        return fallbackRows;
      })
      .finally(() => {
        trendLoading.value = { ...trendLoading.value, [normalizedCode]: false };
        trendRequests.delete(normalizedCode);
      });

    trendRequests.set(normalizedCode, request);
    return request;
  }

  return {
    rows,
    byCode,
    trendByCode,
    codeLoading,
    trendLoading,
    summary,
    total,
    topBuy,
    topSell,
    loading,
    loaded,
    error,
    loadInstitutional,
    loadInstitutionalByCode,
    loadInstitutionalTrendByCode
  };
});
