import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { stockApi } from '../api/stockApi';
import { getSector } from '../utils/stockMeta';

export const useStockStore = defineStore('stocks', () => {
  const allStocks = ref([]);
  const currentStock = ref(null);
  const searchQuery = ref('');
  const hotSearch = ref('');
  const hotFilter = ref('all');
  const hotSort = ref({ key: 'volume', direction: 'desc' });
  const loadingAll = ref(false);
  const loadingQuote = ref(false);
  const error = ref('');

  const marketStats = computed(() => {
    const rows = allStocks.value;
    const upCount = rows.filter(stock => stock.chgPct >= 0).length;
    const totalVolume = rows.reduce((sum, stock) => sum + Number(stock.volume || 0), 0);
    return {
      upRatio: rows.length ? Math.round((upCount / rows.length) * 100) : 0,
      totalVolume
    };
  });

  const hotStocks = computed(() => {
    const keyword = hotSearch.value.trim().toLowerCase();
    const { key, direction } = hotSort.value;
    const factor = direction === 'asc' ? 1 : -1;

    return allStocks.value
      .filter(stock => {
        if (hotFilter.value === 'up' && stock.chgPct < 0) return false;
        if (hotFilter.value === 'down' && stock.chgPct >= 0) return false;
        if (!keyword) return true;
        return stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword);
      })
      .slice()
      .sort((a, b) => {
        const left = Number(a[key] ?? 0);
        const right = Number(b[key] ?? 0);
        if (left === right) return a.code.localeCompare(b.code);
        return (left - right) * factor;
      });
  });

  async function loadAllStocks({ silent = false } = {}) {
    if (loadingAll.value) return;
    loadingAll.value = true;
    if (!silent) error.value = '';

    try {
      const rows = await stockApi.allStocks();
      allStocks.value = rows.map(enrichStock);
    } catch (err) {
      error.value = err?.message || '股票清單讀取失敗';
    } finally {
      loadingAll.value = false;
    }
  }

  async function searchStock(query = searchQuery.value) {
    const input = String(query || '').trim();
    if (!input) return null;

    loadingQuote.value = true;
    error.value = '';
    searchQuery.value = input;

    try {
      const found = findStock(input);
      const code = found?.code || input.match(/\d{4,6}/)?.[0] || input;
      const quote = await stockApi.quoteAuto(code);
      currentStock.value = enrichStock({
        ...found,
        ...quote
      });
      return currentStock.value;
    } catch (err) {
      error.value = err?.message || '股票查詢失敗';
      throw err;
    } finally {
      loadingQuote.value = false;
    }
  }

  async function refreshCurrentStock() {
    if (!currentStock.value) return null;
    return searchStock(currentStock.value.code);
  }

  function findStock(query) {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) return null;
    return allStocks.value.find(stock =>
      stock.code === normalized ||
      stock.name.toLowerCase().includes(normalized) ||
      normalized.includes(stock.code)
    ) || null;
  }

  function setHotSort(key) {
    if (hotSort.value.key === key) {
      hotSort.value.direction = hotSort.value.direction === 'asc' ? 'desc' : 'asc';
      return;
    }
    hotSort.value = { key, direction: 'desc' };
  }

  function enrichStock(stock) {
    const chgPct = Number(stock.chgPct || 0);
    const buyPct = Number(stock.buyPct ?? stock.buy ?? (chgPct >= 0 ? Math.min(80, 50 + Math.abs(chgPct) * 5) : Math.max(20, 50 - Math.abs(chgPct) * 5)));
    const sellPct = Number(stock.sellPct ?? stock.sell ?? (100 - buyPct));

    return {
      ...stock,
      code: String(stock.code || ''),
      name: stock.name || '',
      price: Number(stock.price || 0),
      change: Number(stock.change || 0),
      chgPct,
      volume: Number(stock.volume || 0),
      sector: stock.sector || getSector(stock.code),
      buyPct,
      sellPct,
      volRatio: Number(stock.volRatio || 50)
    };
  }

  return {
    allStocks,
    currentStock,
    searchQuery,
    hotSearch,
    hotFilter,
    hotSort,
    hotStocks,
    marketStats,
    loadingAll,
    loadingQuote,
    error,
    loadAllStocks,
    searchStock,
    refreshCurrentStock,
    findStock,
    setHotSort,
    enrichStock
  };
});
