import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

const STORAGE_KEY = 'tw_stock_favorites';

export const useFavoriteStore = defineStore('favorites', () => {
  const favorites = ref([]);

  const favoriteCodes = computed(() => new Set(favorites.value.map(stock => stock.code)));

  function loadFavorites() {
    if (typeof localStorage === 'undefined') return;
    try {
      const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      favorites.value = Array.isArray(rows) ? rows.map(normalizeFavorite).filter(Boolean) : [];
    } catch (error) {
      favorites.value = [];
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites.value));
  }

  function isFavorite(code) {
    return favoriteCodes.value.has(String(code || '').trim());
  }

  function toggleFavorite(stock) {
    if (!stock?.code) return false;
    if (isFavorite(stock.code)) {
      removeFavorite(stock.code);
      return false;
    }
    addFavorite(stock);
    return true;
  }

  function addFavorite(stock) {
    const next = normalizeFavorite(stock);
    if (!next) return null;

    const index = favorites.value.findIndex(item => item.code === next.code);
    if (index >= 0) favorites.value[index] = mergeFavorite(favorites.value[index], next);
    else favorites.value.unshift(next);

    persist();
    return next;
  }

  function removeFavorite(code) {
    const normalized = String(code || '').trim();
    favorites.value = favorites.value.filter(stock => stock.code !== normalized);
    persist();
  }

  function normalizeFavorite(stock) {
    const code = String(stock?.code || '').trim();
    if (!code) return null;

    return {
      code,
      name: String(stock?.name || '').trim(),
      sector: stock?.sector || '',
      exchange: stock?.exchange || '',
      price: Number(stock?.price || stock?.close || 0),
      change: Number(stock?.change || 0),
      chgPct: Number(stock?.chgPct || 0),
      volume: Number(stock?.volume || 0),
      buyPct: Number(stock?.buyPct || 50),
      sellPct: Number(stock?.sellPct || 50),
      volRatio: Number(stock?.volRatio || 50),
      savedAt: stock?.savedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function mergeFavorite(previous, next) {
    const merged = { ...previous, ...next };
    if (Number(next.price || 0) > 0) return merged;

    return {
      ...merged,
      price: previous.price,
      change: previous.change,
      chgPct: previous.chgPct,
      volume: previous.volume,
      buyPct: previous.buyPct,
      sellPct: previous.sellPct,
      volRatio: previous.volRatio
    };
  }

  return {
    favorites,
    favoriteCodes,
    loadFavorites,
    isFavorite,
    toggleFavorite,
    addFavorite,
    removeFavorite
  };
});
