import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { readCollection, writeCollection } from '../repositories/localDataRepository';

export const useFavoriteStore = defineStore('favorites', () => {
  const favorites = ref([]);

  const favoriteCodes = computed(() => new Set(favorites.value.map(stock => stock.code)));

  function loadFavorites() {
    const rows = readCollection('favorites');
    favorites.value = Array.isArray(rows) ? rows.map(normalizeFavorite).filter(Boolean) : [];
  }

  function persist() {
    writeCollection('favorites', favorites.value);
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

  function reorderFavorite(sourceCode, targetCode) {
    const source = String(sourceCode || '').trim();
    const target = String(targetCode || '').trim();
    if (!source || !target || source === target) return false;

    const fromIndex = favorites.value.findIndex(stock => stock.code === source);
    const toIndex = favorites.value.findIndex(stock => stock.code === target);
    if (fromIndex < 0 || toIndex < 0) return false;

    const next = [...favorites.value];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    favorites.value = next;
    persist();
    return true;
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
      volRatio: normalizeOptionalNumber(stock?.volRatio),
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

  function normalizeOptionalNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  return {
    favorites,
    favoriteCodes,
    loadFavorites,
    isFavorite,
    toggleFavorite,
    addFavorite,
    removeFavorite,
    reorderFavorite
  };
});
