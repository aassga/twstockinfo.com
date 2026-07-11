import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { stockApi } from '../api/stockApi';
import { readCollection, writeCollection } from '../repositories/localDataRepository';
import { getSector } from '../utils/stockMeta';

export const useStockStore = defineStore('stocks', () => {
  const defaultHotSort = { key: 'volume', direction: 'desc' };
  const volumeRatioRefreshMs = 30 * 60 * 1000;
  const volumeRatioLimit = 100;
  const stockCodePattern = /\d{4,6}[a-z]?/i;
  const allStocks = ref([]);
  const currentStock = ref(null);
  const activeCode = ref(readActiveCode());
  const searchQuery = ref('');
  const hotSearch = ref('');
  const hotFilter = ref('all');
  const hotSort = ref({ ...defaultHotSort });
  const hotCellFlashes = ref({});
  const hotUpdatedAt = ref('');
  const hotRealtimeCount = ref(0);
  const loadingAll = ref(false);
  const loadingQuote = ref(false);
  const error = ref('');
  const stockList = ref([]);
  let hotFlashTimer = null;
  let allStocksRequest = null;
  let stockListRequest = null;
  let volumeRatioRequest = null;
  let volumeRatioRequestId = 0;
  let volumeRatioUpdatedAt = 0;
  let searchRequestId = 0;

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
        if (!matchesHotFilter(stock, hotFilter.value)) return false;
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

  async function loadAllStocks({ silent = false, force = false } = {}) {
    if (allStocksRequest) return allStocksRequest;
    loadingAll.value = true;
    if (!silent) error.value = '';

    allStocksRequest = stockApi.allStocks({ force })
      .then(rows => {
        const nextRows = preserveVolumeRatios(rows.map(stock => enrichStock({
          ...stock,
          isRealtime: String(stock.source || '').startsWith('twse-mis')
        })));
        hotRealtimeCount.value = nextRows.filter(stock => stock.isRealtime).length;
        hotUpdatedAt.value = new Date().toISOString();
        markHotCellFlashes(allStocks.value, nextRows);
        allStocks.value = nextRows;
        refreshVolumeRatios(nextRows);
      })
      .catch(err => {
        error.value = err?.message || '股票清單讀取失敗';
      })
      .finally(() => {
        loadingAll.value = false;
        allStocksRequest = null;
      });

    return allStocksRequest;
  }

  async function searchStock(query = searchQuery.value, options = {}) {
    const input = String(query || '').trim();
    if (!input) return null;
    const silent = options.silent === true;
    const force = options.force === true;

    const requestId = ++searchRequestId;
    if (!silent) loadingQuote.value = true;
    if (!silent) error.value = '';
    searchQuery.value = input;

    try {
      if (!allStocks.value.length) {
        await loadAllStocks({ silent: true });
      }
      const found = findStock(input);
      const code = found?.code || input.match(stockCodePattern)?.[0]?.toUpperCase() || input.toUpperCase();
      const quote = await stockApi.quoteAuto(code, { withVolumeRatio: true, force });
      const nextStock = enrichStock({
        ...found,
        ...quote,
        name: quote.name || found?.name || '',
        amountHundredMillion: found?.amountHundredMillion || quote.amountHundredMillion
      });
      if (requestId === searchRequestId) setCurrentStock(nextStock);
      return nextStock;
    } catch (err) {
      error.value = err?.message || '股票查詢失敗';
      throw err;
    } finally {
      if (requestId === searchRequestId) loadingQuote.value = false;
    }
  }

  async function refreshCurrentStock(options = {}) {
    if (!currentStock.value) return null;
    return searchStock(currentStock.value.code, options);
  }

  async function findStockCandidates(query, limit = 8) {
    const normalized = normalizeSearchText(query);
    if (!normalized) return [];

    const rows = await getSearchRows();
    return rows
      .map(stock => ({ stock, score: candidateScore(stock, normalized) }))
      .filter(item => item.score < 99)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return Number(b.stock.volume || 0) - Number(a.stock.volume || 0);
      })
      .slice(0, limit)
      .map(item => item.stock);
  }

  async function getSearchRows() {
    if (!stockList.value.length) {
      if (!stockListRequest) {
        stockListRequest = stockApi.stockList()
          .then(rows => {
            stockList.value = rows.map(enrichStock);
            return stockList.value;
          })
          .finally(() => {
            stockListRequest = null;
          });
      }
      await stockListRequest.catch(() => []);
    }

    const rowsByCode = new Map(stockList.value.map(stock => [stock.code, stock]));
    allStocks.value.forEach(stock => {
      rowsByCode.set(stock.code, {
        ...rowsByCode.get(stock.code),
        ...stock
      });
    });
    return [...rowsByCode.values()];
  }

  function findStock(query) {
    const normalized = normalizeSearchText(query);
    if (!normalized) return null;
    const stocks = allStocks.value;
    const exact = stocks.find(stock =>
      normalizeSearchText(stock.code) === normalized ||
      normalizeSearchText(stock.name) === normalized
    );
    if (exact) return exact;

    const startsWith = stocks.find(stock =>
      normalizeSearchText(stock.name).startsWith(normalized)
    );
    if (startsWith) return startsWith;

    return stocks.find(stock => {
      const code = normalizeSearchText(stock.code);
      const name = normalizeSearchText(stock.name);
      return code.includes(normalized) || name.includes(normalized) || normalized.includes(code);
    }) || null;
  }

  function setHotSort(key) {
    if (hotSort.value.key === key) {
      hotSort.value.direction = hotSort.value.direction === 'asc' ? 'desc' : 'asc';
      return;
    }
    hotSort.value = { key, direction: 'desc' };
  }

  function setHotFilter(key) {
    hotFilter.value = key;
    if (key === 'all') {
      hotSort.value = { ...defaultHotSort };
    }
  }

  function matchesHotFilter(stock, filter) {
    if (filter === 'up') return stock.chgPct > 0;
    if (filter === 'down') return stock.chgPct < 0;
    if (filter === 'buy') return stock.buyPct >= 65;
    if (filter === 'sell') return stock.sellPct >= 65;
    if (filter === 'priceUpVolumeUp') return priceVolumeSignal(stock) === 'priceUpVolumeUp';
    if (filter === 'priceDownVolumeDown') return priceVolumeSignal(stock) === 'priceDownVolumeDown';
    if (filter === 'priceDownVolumeUp') return priceVolumeSignal(stock) === 'priceDownVolumeUp';
    if (filter === 'priceUpVolumeDown') return priceVolumeSignal(stock) === 'priceUpVolumeDown';
    return true;
  }

  function priceVolumeSignal(stock) {
    const chgPct = Number(stock?.chgPct || 0);
    const volRatio = Number(stock?.volRatio || 0);
    if (!Number.isFinite(chgPct) || !Number.isFinite(volRatio)) return '';
    if (chgPct === 0 || volRatio <= 0) return '';
    const volumeExpanded = volRatio >= 100;
    if (chgPct > 0 && volumeExpanded) return 'priceUpVolumeUp';
    if (chgPct < 0 && !volumeExpanded) return 'priceDownVolumeDown';
    if (chgPct < 0 && volumeExpanded) return 'priceDownVolumeUp';
    if (chgPct > 0 && !volumeExpanded) return 'priceUpVolumeDown';
    return '';
  }

  async function refreshVolumeRatios(rows, { force = false } = {}) {
    if (volumeRatioRequest) return volumeRatioRequest;

    const targets = rows
      .filter(stock => Number(stock.volume || 0) > 0)
      .sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0))
      .slice(0, volumeRatioLimit);

    const now = Date.now();
    const hasMissingRatio = targets.some(stock => !Number(stock.volRatio || 0));
    if (!force && volumeRatioUpdatedAt && now - volumeRatioUpdatedAt < volumeRatioRefreshMs && !hasMissingRatio) return;
    if (!targets.length) return;

    const requestId = ++volumeRatioRequestId;
    volumeRatioRequest = stockApi.volumeRatios(targets)
      .catch(() => [])
      .finally(() => {
        volumeRatioRequest = null;
      });
    const enrichedRows = await volumeRatioRequest;

    if (requestId !== volumeRatioRequestId || !enrichedRows.length) return;

    const enrichedByCode = new Map(enrichedRows.map(stock => [stock.code, stock]));
    const nextRows = allStocks.value.map(stock => {
      const enriched = enrichedByCode.get(stock.code);
      return enriched ? enrichStock({ ...stock, ...enriched }) : stock;
    });

    volumeRatioUpdatedAt = Date.now();
    markHotCellFlashes(allStocks.value, nextRows);
    allStocks.value = nextRows;
  }

  function preserveVolumeRatios(nextRows) {
    const previousByCode = new Map(allStocks.value.map(stock => [stock.code, stock]));
    return nextRows.map(stock => {
      const previous = previousByCode.get(stock.code);
      if (!previous?.volRatio) return stock;
      return {
        ...stock,
        volRatio: previous.volRatio,
        avgVolume20: previous.avgVolume20
      };
    });
  }

  async function refreshStocksByCodes(codes, { force = false } = {}) {
    const requestedCodes = new Set(
      codes
        .map(code => String(code || '').trim())
        .filter(Boolean)
    );
    if (!requestedCodes.size) return [];

    loadingAll.value = true;
    error.value = '';
    try {
      const requestedRows = (await stockApi.priceRows([...requestedCodes], { force })).map(enrichStock);
      const nextByCode = new Map(allStocks.value.map(stock => [stock.code, stock]));

      requestedRows.forEach(stock => {
        nextByCode.set(stock.code, {
          ...nextByCode.get(stock.code),
          ...stock,
          isRealtime: String(stock.source || '').startsWith('twse-mis')
        });
      });

      allStocks.value = [...nextByCode.values()]
        .sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0));

      if (currentStock.value?.code && nextByCode.has(currentStock.value.code)) {
        currentStock.value = enrichStock({
          ...currentStock.value,
          ...nextByCode.get(currentStock.value.code)
        });
      }

      return requestedRows;
    } catch (err) {
      error.value = err?.message || '股票報價更新失敗';
      return [];
    } finally {
      loadingAll.value = false;
    }
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
      forceSource: stock.forceSource || '',
      forceSourceLabel: stock.forceSourceLabel || '',
      forceReliable: stock.forceReliable === true,
      tradeFlow: stock.tradeFlow || null,
      volRatio: normalizeOptionalNumber(stock.volRatio)
    };
  }

  function setCurrentStock(stock) {
    const nextStock = enrichStock(stock);
    currentStock.value = nextStock;
    activeCode.value = nextStock.code;
    writeActiveCode(nextStock.code);
  }

  function loadLocalState() {
    activeCode.value = readActiveCode();
  }

  function normalizeOptionalNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function sortValue(stock, key) {
    if (key === 'chg') return stock.chgPct;
    if (key === 'vol') return stock.volume;
    if (key === 'buy') return stock.buyPct;
    if (key === 'sell') return stock.sellPct;
    if (key === 'force') return Math.max(stock.buyPct, stock.sellPct);
    return stock[key] ?? 0;
  }

  function normalizeSearchText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  function candidateScore(stock, normalized) {
    const code = normalizeSearchText(stock.code);
    const name = normalizeSearchText(stock.name);
    if (code === normalized || name === normalized) return 0;
    if (code.startsWith(normalized)) return 1;
    if (name.startsWith(normalized)) return 2;
    if (code.includes(normalized)) return 3;
    if (name.includes(normalized)) return 4;
    if (normalized.includes(code)) return 5;
    return 99;
  }

  function readActiveCode() {
    return String(readCollection('activeStockCode') || '').trim().toUpperCase();
  }

  function writeActiveCode(code) {
    const value = String(code || '').trim().toUpperCase();
    if (value) writeCollection('activeStockCode', value);
  }

  return {
    allStocks,
    currentStock,
    activeCode,
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
    findStockCandidates,
    refreshCurrentStock,
    refreshStocksByCodes,
    findStock,
    setCurrentStock,
    loadLocalState,
    setHotFilter,
    setHotSort,
    hotCellFlashClass,
    enrichStock
  };
});
