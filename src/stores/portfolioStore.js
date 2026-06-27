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
    const id = payload.id || createId();
    const previous = holdings.value.find(holding => holding.id === id);
    const holding = {
      ...previous,
      id,
      code: String(payload.code || '').trim().padStart(4, '0'),
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
      const updated = await Promise.all(holdings.value.map(async holding => {
        try {
          const quote = await stockApi.quoteAuto(holding.code);
          return {
            ...holding,
            name: quote.name || holding.name,
            currentPrice: quote.price,
            updatedAt: new Date().toISOString()
          };
        } catch (err) {
          return holding;
        }
      }));
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

  return {
    holdings,
    loading,
    draft,
    error,
    summary,
    loadPortfolio,
    saveHolding,
    removeHolding,
    setDraftFromStock,
    clearDraft,
    refreshQuotes
  };
});
