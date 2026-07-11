import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

const STORAGE_KEY = 'tw_stock_notifications';
const MAX_NOTIFICATIONS = 160;
const BUY_THRESHOLD = 70;
const SELL_THRESHOLD = 65;
const HIGH_VOLUME_RATIO = 180;

export const useNotificationStore = defineStore('notifications', () => {
  const notifications = ref([]);
  const lastEvaluatedAt = ref('');

  const unreadCount = computed(() => notifications.value.filter(item => !item.read).length);
  const criticalCount = computed(() => notifications.value.filter(item => !item.read && item.severity === 'critical').length);
  const latest = computed(() => notifications.value.slice(0, 12));

  function loadNotifications() {
    if (typeof localStorage === 'undefined') return;
    try {
      const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      notifications.value = Array.isArray(rows) ? rows.map(normalizeNotification).filter(Boolean) : [];
    } catch (error) {
      notifications.value = [];
    }
  }

  function persist() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.value.slice(0, MAX_NOTIFICATIONS)));
  }

  function evaluateStocks(stocks = []) {
    const rows = Array.isArray(stocks) ? stocks : [];
    if (!rows.length) return;

    const candidates = rows.flatMap(buildStockNotifications);
    if (!candidates.length) {
      lastEvaluatedAt.value = new Date().toISOString();
      return;
    }

    candidates.forEach(upsertNotification);
    notifications.value = notifications.value
      .slice()
      .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, MAX_NOTIFICATIONS);

    lastEvaluatedAt.value = new Date().toISOString();
    persist();
  }

  function buildStockNotifications(stock) {
    if (!stock?.code || !Number(stock.price || 0)) return [];

    const rows = [];
    const buyPct = Number(stock.buyPct || 0);
    const sellPct = Number(stock.sellPct || 0);
    const chgPct = Number(stock.chgPct || 0);
    const volRatio = Number(stock.volRatio || 0);
    const forceReliable = stock.forceReliable === true;
    const source = stock.forceSourceLabel || (forceReliable ? 'TWSE MIS' : '推估');

    if (forceReliable && buyPct >= BUY_THRESHOLD) {
      rows.push(createNotification(stock, {
        type: 'buy',
        severity: buyPct >= 78 ? 'critical' : 'high',
        title: '高買入提醒',
        message: `${forceName(stock, 'buy')} ${Math.round(buyPct)}%，短線買方力道偏強。`,
        metricLabel: forceName(stock, 'buy'),
        metricValue: `${Math.round(buyPct)}%`,
        source
      }));
    }

    if (forceReliable && sellPct >= SELL_THRESHOLD) {
      rows.push(createNotification(stock, {
        type: 'sell',
        severity: sellPct >= 75 ? 'critical' : 'high',
        title: '高賣出提醒',
        message: `${forceName(stock, 'sell')} ${Math.round(sellPct)}%，短線賣壓偏高。`,
        metricLabel: forceName(stock, 'sell'),
        metricValue: `${Math.round(sellPct)}%`,
        source
      }));
    }

    if (volRatio >= HIGH_VOLUME_RATIO) {
      rows.push(createNotification(stock, {
        type: 'volume',
        severity: volRatio >= 260 ? 'critical' : 'medium',
        title: '成交量異常放大',
        message: `量比 ${Math.round(volRatio)}%，成交量明顯高於近期平均。`,
        metricLabel: '量比',
        metricValue: `${Math.round(volRatio)}%`,
        source: 'Yahoo Chart'
      }));
    }

    if (chgPct <= -3 && volRatio >= 120) {
      rows.push(createNotification(stock, {
        type: 'risk',
        severity: chgPct <= -6 ? 'critical' : 'medium',
        title: '價跌量增風險',
        message: `跌幅 ${formatSignedPct(chgPct)} 且量比 ${Math.round(volRatio)}%，留意賣壓延續。`,
        metricLabel: '跌幅',
        metricValue: formatSignedPct(chgPct),
        source: 'TWSE MIS + Yahoo Chart'
      }));
    }

    if (chgPct >= 3 && volRatio >= 120) {
      rows.push(createNotification(stock, {
        type: 'momentum',
        severity: chgPct >= 6 ? 'high' : 'medium',
        title: '價漲量增動能',
        message: `漲幅 ${formatSignedPct(chgPct)} 且量比 ${Math.round(volRatio)}%，留意帶量突破是否延續。`,
        metricLabel: '漲幅',
        metricValue: formatSignedPct(chgPct),
        source: 'TWSE MIS + Yahoo Chart'
      }));
    }

    return rows;
  }

  function createNotification(stock, payload) {
    const today = new Date().toISOString().slice(0, 10);
    const id = `${today}:${payload.type}:${stock.code}`;
    const now = new Date().toISOString();
    return {
      id,
      code: String(stock.code || ''),
      name: stock.name || '',
      sector: stock.sector || '',
      type: payload.type,
      severity: payload.severity,
      title: payload.title,
      message: payload.message,
      metricLabel: payload.metricLabel,
      metricValue: payload.metricValue,
      source: payload.source,
      price: Number(stock.price || 0),
      change: Number(stock.change || 0),
      chgPct: Number(stock.chgPct || 0),
      createdAt: now,
      updatedAt: now,
      read: false
    };
  }

  function upsertNotification(next) {
    const index = notifications.value.findIndex(item => item.id === next.id);
    if (index < 0) {
      notifications.value.unshift(next);
      return;
    }

    const previous = notifications.value[index];
    notifications.value[index] = {
      ...previous,
      ...next,
      createdAt: previous.createdAt,
      read: previous.read && previous.metricValue === next.metricValue
    };
  }

  function markRead(id) {
    updateReadState(id, true);
  }

  function markUnread(id) {
    updateReadState(id, false);
  }

  function markAllRead() {
    notifications.value = notifications.value.map(item => ({ ...item, read: true }));
    persist();
  }

  function clearRead() {
    notifications.value = notifications.value.filter(item => !item.read);
    persist();
  }

  function removeNotification(id) {
    notifications.value = notifications.value.filter(item => item.id !== id);
    persist();
  }

  function clearAll() {
    notifications.value = [];
    persist();
  }

  function updateReadState(id, read) {
    notifications.value = notifications.value.map(item => item.id === id ? { ...item, read } : item);
    persist();
  }

  function normalizeNotification(item) {
    if (!item?.id || !item?.code) return null;
    return {
      id: String(item.id),
      code: String(item.code),
      name: String(item.name || ''),
      sector: String(item.sector || ''),
      type: item.type || 'info',
      severity: item.severity || 'medium',
      title: String(item.title || '通知'),
      message: String(item.message || ''),
      metricLabel: String(item.metricLabel || ''),
      metricValue: String(item.metricValue || ''),
      source: String(item.source || ''),
      price: Number(item.price || 0),
      change: Number(item.change || 0),
      chgPct: Number(item.chgPct || 0),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      read: item.read === true
    };
  }

  function severityWeight(severity) {
    if (severity === 'critical') return 4;
    if (severity === 'high') return 3;
    if (severity === 'medium') return 2;
    return 1;
  }

  function forceName(stock, side) {
    const isTradeFlow = stock?.forceSource === 'twse-mis-trade-flow';
    if (side === 'buy') return isTradeFlow ? '外盤佔比' : '買入佔比';
    return isTradeFlow ? '內盤佔比' : '賣出佔比';
  }

  function formatSignedPct(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? '+' : '';
    return `${sign}${number.toFixed(2)}%`;
  }

  return {
    notifications,
    unreadCount,
    criticalCount,
    latest,
    lastEvaluatedAt,
    loadNotifications,
    evaluateStocks,
    markRead,
    markUnread,
    markAllRead,
    clearRead,
    removeNotification,
    clearAll
  };
});
