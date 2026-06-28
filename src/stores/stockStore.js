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
  const hotCellFlashes = ref({});
  const hotUpdatedAt = ref('');
  const hotRealtimeCount = ref(0);
  const loadingAll = ref(false);
  const loadingQuote = ref(false);
  const error = ref('');
  let hotFlashTimer = null;

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
        if (hotFilter.value === 'buy' && stock.buyPct < 65) return false;
        if (hotFilter.value === 'sell' && stock.sellPct < 65) return false;
        if (!keyword) return true;
        return stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword);
      })
      .slice()
      .sort((a, b) => {
        const left = Number(sortValue(a, key));
        const right = Number(sortValue(b, key));
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
      const poolRows = rows.map(enrichStock);
      const result = await hydrateHotRealtimeQuotes(poolRows);
      const nextRows = result.rows;
      hotRealtimeCount.value = result.realtimeCount;
      hotUpdatedAt.value = new Date().toISOString();
      markHotCellFlashes(allStocks.value, nextRows);
      allStocks.value = nextRows;
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
        ...quote,
        amountHundredMillion: found?.amountHundredMillion || quote.amountHundredMillion
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

  async function hydrateHotRealtimeQuotes(rows) {
    const topRows = rows.slice()
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 100);
    const quoteByCode = new Map();

    try {
      const quotes = await stockApi.quotes(topRows.map(stock => stock.code));
      quotes.forEach(quote => {
        quoteByCode.set(String(quote.code), quote);
      });
    } catch (error) {
      // Keep STOCK_DAY_ALL data if the batch quote endpoint is temporarily unavailable.
    }

    const missingRows = topRows.filter(stock => !quoteByCode.has(stock.code));
    if (missingRows.length) {
      const fallbackQuotes = await mapLimit(missingRows, 8, async stock => {
        try {
          return await stockApi.quoteAuto(stock.code);
        } catch (error) {
          return null;
        }
      });

      fallbackQuotes.filter(Boolean).forEach(quote => {
        quoteByCode.set(String(quote.code), quote);
      });
    }

    return {
      realtimeCount: quoteByCode.size,
      rows: rows.map(stock => {
        const quote = quoteByCode.get(stock.code);
        if (!quote) return { ...stock, isRealtime: false };
        return enrichStock({
          ...stock,
          ...quote,
          sector: stock.sector,
          isRealtime: true
        });
      })
    };
  }

  async function mapLimit(items, limit, mapper) {
    const results = [];
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  function hotCellFlashClass(code, key) {
    const type = hotCellFlashes.value[`${code}:${key}`];
    return type ? `data-flash-${type}` : '';
  }

  function markHotCellFlashes(previousRows, nextRows) {
    if (!previousRows.length) return;

    const previousByCode = new Map(previousRows.map(stock => [stock.code, stock]));
    const nextFlashes = {};

    for (const stock of nextRows) {
      const previous = previousByCode.get(stock.code);
      if (!previous) continue;

      markFlash(nextFlashes, stock.code, 'price', previous.price, stock.price);
      markFlash(nextFlashes, stock.code, 'chg', previous.chgPct, stock.chgPct);
      markFlash(nextFlashes, stock.code, 'vol', previous.volume, stock.volume);
      markFlash(nextFlashes, stock.code, 'buy', previous.buyPct, stock.buyPct);
      markFlash(nextFlashes, stock.code, 'sell', previous.sellPct, stock.sellPct, true);
      markFlash(nextFlashes, stock.code, 'force', Math.max(previous.buyPct, previous.sellPct), Math.max(stock.buyPct, stock.sellPct));
      markFlash(nextFlashes, stock.code, 'volRatio', previous.volRatio, stock.volRatio);
    }

    hotCellFlashes.value = nextFlashes;
    if (hotFlashTimer) clearTimeout(hotFlashTimer);
    hotFlashTimer = setTimeout(() => {
      hotCellFlashes.value = {};
      hotFlashTimer = null;
    }, 1300);
  }

  function markFlash(target, code, key, previousValue, nextValue, invert = false) {
    const previous = Number(previousValue || 0);
    const next = Number(nextValue || 0);
    if (!Number.isFinite(previous) || !Number.isFinite(next)) return;
    if (Math.abs(next - previous) < 0.0001) return;

    const rising = next > previous;
    target[`${code}:${key}`] = rising !== invert ? 'up' : 'dn';
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

  function sortValue(stock, key) {
    if (key === 'chg') return stock.chgPct;
    if (key === 'vol') return stock.volume;
    if (key === 'buy') return stock.buyPct;
    if (key === 'sell') return stock.sellPct;
    if (key === 'force') return Math.max(stock.buyPct, stock.sellPct);
    return stock[key] ?? 0;
  }

  return {
    allStocks,
    currentStock,
    searchQuery,
    hotSearch,
    hotFilter,
    hotSort,
    hotCellFlashes,
    hotUpdatedAt,
    hotRealtimeCount,
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
    hotCellFlashClass,
    enrichStock
  };
});
