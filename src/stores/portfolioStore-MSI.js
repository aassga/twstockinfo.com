import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { stockApi } from '../api/stockApi';

const STORAGE_KEY = 'tw_stock_portfolio_holdings';

export const usePortfolioStore = defineStore('portfolio', () => {
  const holdings = ref([]);
  const loading = ref(false);
  const draft = ref(null);
  const error = ref('');

  const summary = computed(() => {
    const cost = holdings.value.reduce((sum, holding) => sum + holding.buyPrice * holding.shares, 0);
    const value = holdings.value.reduce((sum, holding) => sum + (holding.currentPrice || holding.buyPrice) * holding.shares, 0);
    const pnl = value - cost;
    return {
      cost,
      value,
      pnl,
      returnPct: cost ? (pnl / cost) * 100 : 0
    };
  });

  function loadPortfolio() {
    if (typeof localStorage === 'undefined') return;
    try {
      holdings.value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (err) {
      holdings.value = [];
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings.value));
  }

  function saveHolding(payload) {
    const now = new Date().toISOString();
    const code = normalizeCode(payload.code);
    const duplicateIndex = !payload.id
      ? holdings.value.findIndex(holding => holding.code === code)
      : -1;
    const duplicate = duplicateIndex >= 0 ? holdings.value[duplicateIndex] : null;
    const id = payload.id || duplicate?.id || createId();
    const previous = holdings.value.find(holding => holding.id === id);
    const holding = {
      ...previous,
      id,
      code,
      name: String(payload.name || '').trim(),
      buyPrice: Number(payload.buyPrice || 0),
      shares: Number(payload.shares || 0),
      buyDate: payload.buyDate || new Date().toISOString().slice(0, 10),
      currentPrice: Number(payload.currentPrice || previous?.currentPrice || payload.buyPrice || 0),
      updatedAt: payload.updatedAt || previous?.updatedAt || now,
      createdAt: previous?.createdAt || now
    };

    if (!holding.code || !holding.name || holding.buyPrice <= 0 || holding.shares <= 0) {
      throw new Error('持股資料不完整');
    }

    if (duplicate) {
      const existingShares = Number(duplicate.shares || 0);
      const addedShares = Number(holding.shares || 0);
      const totalShares = existingShares + addedShares;
      const totalCost = (Number(duplicate.buyPrice || 0) * existingShares) + (Number(holding.buyPrice || 0) * addedShares);
      const mergedHolding = {
        ...duplicate,
        name: holding.name || duplicate.name,
        buyPrice: Number((totalCost / totalShares).toFixed(2)),
        shares: totalShares,
        buyDate: holding.buyDate || duplicate.buyDate,
        currentPrice: Number(duplicate.currentPrice || holding.currentPrice || 0),
        updatedAt: duplicate.updatedAt || holding.updatedAt,
        createdAt: duplicate.createdAt || holding.createdAt
      };

      holdings.value[duplicateIndex] = mergedHolding;
      persist();
      draft.value = null;
      return mergedHolding;
    }

    const index = holdings.value.findIndex(item => item.id === id);
    if (index >= 0) holdings.value[index] = holding;
    else holdings.value.unshift(holding);
    persist();
    draft.value = null;
    return holding;
  }

  function removeHolding(id) {
    holdings.value = holdings.value.filter(holding => holding.id !== id);
    persist();
  }

  function importHoldings(payload) {
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.holdings)
        ? payload.holdings
        : null;

    if (!rows) {
      throw new Error('匯入檔案格式錯誤，請選擇先前匯出的 JSON。');
    }

    const now = new Date().toISOString();
    const nextHoldings = rows.map((row, index) => normalizeImportedHolding(row, index, now));

    if (!nextHoldings.length) {
      throw new Error('匯入檔案沒有持股資料。');
    }

    holdings.value = nextHoldings;
    draft.value = null;
    persist();
    return nextHoldings.length;
  }

  function setDraftFromStock(stock) {
    if (!stock) return;
    draft.value = {
      code: stock.code,
      name: stock.name,
      buyPrice: stock.price || '',
      shares: 1000,
      buyDate: new Date().toISOString().slice(0, 10)
    };
  }

  function clearDraft() {
    draft.value = null;
  }

  async function refreshQuotes() {
    if (loading.value || !holdings.value.length) return;
    loading.value = true;
    error.value = '';
    try {
      const codes = [...new Set(holdings.value.map(holding => holding.code).filter(Boolean))];
      const quotes = await stockApi.priceRows(codes);
      const quoteByCode = new Map(quotes.map(quote => [quote.code, quote]));
      const now = new Date().toISOString();
      const updated = holdings.value.map(holding => {
        const quote = quoteByCode.get(holding.code);
        if (!quote) return holding;

        return {
          ...holding,
          name: quote.name || holding.name,
          currentPrice: quote.price,
          updatedAt: now
        };
      });
      holdings.value = updated;
      persist();
    } catch (err) {
      error.value = err?.message || '持股現價更新失敗';
    } finally {
      loading.value = false;
    }
  }

  function createId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeImportedHolding(row, index, now) {
    const code = normalizeCode(row?.code);
    const name = String(row?.name || '').trim();
    const buyPrice = Number(row?.buyPrice || 0);
    const shares = Number(row?.shares || 0);
    const currentPrice = Number(row?.currentPrice || row?.price || buyPrice || 0);
    const holding = {
      id: String(row?.id || `${now}-${index}`),
      code,
      name,
      buyPrice,
      shares,
      buyDate: row?.buyDate || new Date().toISOString().slice(0, 10),
      currentPrice,
      updatedAt: row?.updatedAt || now,
      createdAt: row?.createdAt || now
    };

    if (!holding.code || !holding.name || holding.buyPrice <= 0 || holding.shares <= 0) {
      throw new Error(`第 ${index + 1} 筆持股資料不完整，請確認代號、名稱、買進價與股數。`);
    }

    return holding;
  }

  function normalizeCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return /^\d+$/.test(code) ? code.padStart(4, '0') : code;
  }

  return {
    holdings,
    loading,
    draft,
    error,
    summary,
    loadPortfolio,
    saveHolding,
    removeHolding,
    importHoldings,
    setDraftFromStock,
    clearDraft,
    refreshQuotes
  };
});
