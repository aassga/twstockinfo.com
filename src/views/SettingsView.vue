<script setup>
import { computed, ref } from 'vue';
import { config } from '../config';
import {
  exportLocalData,
  importLocalData,
  readCollection
} from '../repositories/localDataRepository';
import { useFavoriteStore } from '../stores/favoriteStore';
import { useNotificationStore } from '../stores/notificationStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { useStockStore } from '../stores/stockStore';

const portfolioStore = usePortfolioStore();
const favoriteStore = useFavoriteStore();
const notificationStore = useNotificationStore();
const stockStore = useStockStore();

const restoreInput = ref(null);
const backupRevision = ref(0);
const backupMessage = ref('');

const collectionLabels = {
  portfolioHoldings: '持股',
  favorites: '我的最愛',
  notifications: '通知',
  activeStockCode: '目前個股',
  misOutageUntil: 'MIS 暫停狀態'
};

const backupSummary = computed(() => {
  backupRevision.value;
  const holdings = readCollection('portfolioHoldings');
  const favorites = readCollection('favorites');
  const notifications = readCollection('notifications');
  const activeCode = readCollection('activeStockCode');

  return [
    {
      label: '我的持股',
      value: Array.isArray(holdings) ? holdings.length : 0,
      unit: '筆',
      detail: '買進價、股數、日期與現價'
    },
    {
      label: '我的最愛',
      value: Array.isArray(favorites) ? favorites.length : 0,
      unit: '檔',
      detail: '收藏股票清單'
    },
    {
      label: '通知紀錄',
      value: Array.isArray(notifications) ? notifications.length : 0,
      unit: '筆',
      detail: '買賣提醒與已讀狀態'
    },
    {
      label: '目前個股',
      value: activeCode || '--',
      unit: '',
      detail: '最近查詢代號'
    }
  ];
});

function exportBackup() {
  const payload = exportLocalData();
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  downloadFile(
    `twstockinfo-backup-${date}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
  backupMessage.value = `已匯出完整備份：${formatBackupTime(payload.exportedAt)}`;
}

function triggerRestore() {
  restoreInput.value?.click();
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    if (payload?.schema !== 'twstockinfo.local-data.v1' || !payload?.collections) {
      throw new Error('備份格式不正確，請選擇 twstockinfo 匯出的 JSON 備份。');
    }

    const confirmed = window.confirm('還原備份會覆蓋目前本機持股、我的最愛與通知資料，確定繼續？');
    if (!confirmed) return;

    const written = importLocalData(payload);
    portfolioStore.loadPortfolio();
    favoriteStore.loadFavorites();
    notificationStore.loadNotifications();
    stockStore.loadLocalState();
    backupRevision.value += 1;

    const labelText = written.map(key => collectionLabels[key] || key).join('、');
    backupMessage.value = `已還原 ${written.length} 個資料集合：${labelText || '無可還原資料'}`;
  } catch (error) {
    const message = error?.message || '還原失敗，請確認檔案內容。';
    backupMessage.value = message;
    window.alert(message);
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function formatBackupTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', { hour12: false });
}
</script>

<template>
  <section class="view-stack">
    <article class="panel">
      <div class="section-head">
        <div>
          <h2>備份 / 還原</h2>
          <p class="section-desc">統一管理本機持股、我的最愛、通知與目前個股代號。</p>
        </div>
      </div>

      <div class="backup-summary-grid">
        <div
          v-for="item in backupSummary"
          :key="item.label"
          class="backup-summary-card"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}<small v-if="item.unit">{{ item.unit }}</small></strong>
          <em>{{ item.detail }}</em>
        </div>
      </div>

      <div class="backup-actions">
        <button class="btn primary" type="button" @click="exportBackup">匯出完整備份</button>
        <button class="btn" type="button" @click="triggerRestore">還原備份</button>
        <input
          ref="restoreInput"
          class="sr-only"
          type="file"
          accept="application/json,.json"
          @change="restoreBackup"
        >
      </div>

      <p v-if="backupMessage" class="backup-message">{{ backupMessage }}</p>
      <p class="backup-note">備份只包含本機資料，不包含 API Key、Cloudflare Worker Secret 或瀏覽器快取。</p>
    </article>

    <article class="panel">
      <div class="section-head">
        <h2>資料代理</h2>
      </div>
      <div class="setting-row">
        <span>Worker</span>
        <strong>{{ config.proxyBase }}</strong>
      </div>
    </article>

    <article class="panel">
      <div class="section-head">
        <h2>版本狀態</h2>
      </div>
      <div class="setting-row">
        <span>前端</span>
        <strong>Vue 3 + Vite</strong>
      </div>
      <div class="setting-row">
        <span>行動 UI</span>
        <strong>Vant</strong>
      </div>
      <div class="setting-row">
        <span>PC UI</span>
        <strong>自訂 CSS</strong>
      </div>
      <div class="setting-row">
        <span>舊版檔案</span>
        <strong>legacy/</strong>
      </div>
    </article>
  </section>
</template>
