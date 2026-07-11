import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

const MAX_ERRORS = 80;

export const useSystemStore = defineStore('system', () => {
  const updateAvailable = ref(false);
  const errors = ref([]);

  const errorCount = computed(() => errors.value.length);
  const latestError = computed(() => errors.value[0] || null);

  function setUpdateAvailable(value = true) {
    updateAvailable.value = value;
  }

  function applyUpdate() {
    const updater = window.__twstockApplyUpdate;
    if (typeof updater === 'function') {
      updater();
      return;
    }
    window.location.reload();
  }

  function recordError(error, context = 'frontend') {
    const message = error?.message || String(error || '');
    if (!message) return;
    errors.value.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      context,
      message,
      stack: error?.stack || '',
      time: new Date().toISOString(),
      url: typeof location !== 'undefined' ? location.href : ''
    });
    errors.value = errors.value.slice(0, MAX_ERRORS);
  }

  function clearErrors() {
    errors.value = [];
  }

  return {
    updateAvailable,
    errors,
    errorCount,
    latestError,
    setUpdateAvailable,
    applyUpdate,
    recordError,
    clearErrors
  };
});
