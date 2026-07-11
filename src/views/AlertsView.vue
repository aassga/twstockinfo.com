<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IconBell,
  IconBellRinging,
  IconCheck,
  IconClock,
  IconInfoCircle,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconTrendingDown,
  IconTrendingUp,
  IconVolume
} from '@tabler/icons-vue';
import SourceBadge from '../components/SourceBadge.vue';
import { useNotificationStore } from '../stores/notificationStore';
import { useStockStore } from '../stores/stockStore';
import { formatDateTime, formatMoney, formatPct, moveClass } from '../utils/formatters';

const router = useRouter();
const stockStore = useStockStore();
const notificationStore = useNotificationStore();
const activeFilter = ref('all');
const showAi = ref(false);

const filters = computed(() => [
  { key: 'all', label: '全部', count: notificationStore.notifications.length },
  { key: 'unread', label: '未讀', count: notificationStore.unreadCount },
  { key: 'buy', label: '買入', count: countByType('buy') },
  { key: 'sell', label: '賣出', count: countByType('sell') },
  { key: 'volume', label: '量價', count: countByTypes(['volume', 'momentum']) },
  { key: 'risk', label: '風險', count: countByType('risk') }
]);

const filteredNotifications = computed(() => {
  const key = activeFilter.value;
  return notificationStore.notifications.filter(item => {
    if (key === 'all') return true;
    if (key === 'unread') return !item.read;
    if (key === 'volume') return item.type === 'volume' || item.type === 'momentum';
    return item.type === key;
  });
});

const summaryCards = computed(() => [
  {
    label: '未讀通知',
    value: notificationStore.unreadCount,
    detail: notificationStore.criticalCount ? `${notificationStore.criticalCount} 則重要` : '沒有重要未讀',
    tone: notificationStore.unreadCount ? 'warning' : 'good'
  },
  {
    label: '買入提醒',
    value: countByType('buy'),
    detail: '買方力道偏強',
    tone: 'buy'
  },
  {
    label: '賣出提醒',
    value: countByType('sell'),
    detail: '賣壓偏高',
    tone: 'sell'
  },
  {
    label: '最後掃描',
    value: notificationStore.lastEvaluatedAt ? formatDateTime(notificationStore.lastEvaluatedAt) : '--',
    detail: '依前100熱門與即時報價更新',
    tone: 'neutral'
  }
]);

onMounted(async () => {
  notificationStore.loadNotifications();
  if (!stockStore.allStocks.length) await stockStore.loadAllStocks({ silent: true });
  notificationStore.evaluateStocks(stockStore.allStocks);
});

watch(
  () => stockStore.allStocks,
  rows => notificationStore.evaluateStocks(rows),
  { deep: false }
);

function countByType(type) {
  return notificationStore.notifications.filter(item => item.type === type).length;
}

function countByTypes(types) {
  return notificationStore.notifications.filter(item => types.includes(item.type)).length;
}

async function refreshNotifications() {
  await stockStore.loadAllStocks({ force: true });
  notificationStore.evaluateStocks(stockStore.allStocks);
}

function openQuote(item) {
  notificationStore.markRead(item.id);
  router.push({ path: '/quote', query: { code: item.code } });
}

function iconFor(item) {
  if (item.type === 'buy' || item.type === 'momentum') return IconTrendingUp;
  if (item.type === 'sell' || item.type === 'risk') return IconTrendingDown;
  if (item.type === 'volume') return IconVolume;
  return IconBell;
}

function typeLabel(item) {
  if (item.type === 'buy') return '買入';
  if (item.type === 'sell') return '賣出';
  if (item.type === 'volume') return '量能';
  if (item.type === 'momentum') return '動能';
  if (item.type === 'risk') return '風險';
  return '通知';
}

function severityLabel(severity) {
  if (severity === 'critical') return '重要';
  if (severity === 'high') return '高';
  if (severity === 'medium') return '中';
  return '低';
}
</script>

<template>
  <section class="tab-content active notification-view">
    <div class="page-title-row">
      <div class="page-title">
        <IconBellRinging class="title-icon" :stroke-width="2" />
        通知中心
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :disabled="!notificationStore.unreadCount" @click="notificationStore.markAllRead()">
          <IconCheck class="btn-icon" :stroke-width="2" />
          全部已讀
        </button>
        <button
          class="btn"
          :class="{ 'is-refreshing': stockStore.loadingAll }"
          type="button"
          :disabled="stockStore.loadingAll"
          @click="refreshNotifications"
        >
          <IconRefresh class="btn-icon" :stroke-width="2" />
          重新掃描
        </button>
      </div>
    </div>

    <div class="notification-summary-grid">
      <article v-for="card in summaryCards" :key="card.label" class="notification-summary-card" :class="card.tone">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <em>{{ card.detail }}</em>
      </article>
    </div>

    <div class="filter-row notification-filter-row">
      <button
        v-for="filter in filters"
        :key="filter.key"
        class="filter-btn"
        :class="{ active: activeFilter === filter.key }"
        type="button"
        @click="activeFilter = filter.key"
      >
        {{ filter.label }}
        <span>{{ filter.count }}</span>
      </button>
    </div>

    <div class="notification-panel">
      <div class="notification-panel-head">
        <div>
          <h3>即時訊號通知</h3>
          <p>依 TWSE MIS 買賣力道、量比與量價訊號建立站內通知。</p>
        </div>
        <button class="btn" type="button" :disabled="!notificationStore.notifications.some(item => item.read)" @click="notificationStore.clearRead()">
          <IconTrash class="btn-icon" :stroke-width="2" />
          清除已讀
        </button>
      </div>

      <div v-if="filteredNotifications.length" class="notification-list">
        <article
          v-for="item in filteredNotifications"
          :key="item.id"
          class="notification-item"
          :class="[item.type, item.severity, { unread: !item.read }]"
        >
          <button class="notification-main" type="button" @click="openQuote(item)">
            <span class="notification-icon">
              <component :is="iconFor(item)" class="inline-icon" :stroke-width="2" />
            </span>
            <span class="notification-body">
              <span class="notification-title-row">
                <strong>{{ item.title }}</strong>
                <span class="notification-tag">{{ typeLabel(item) }}</span>
                <span class="notification-tag severity">{{ severityLabel(item.severity) }}</span>
              </span>
              <span class="notification-stock">{{ item.code }} {{ item.name }} <em>{{ item.sector }}</em></span>
              <span class="notification-message">{{ item.message }}</span>
              <span class="notification-meta">
                <IconClock class="inline-icon" :stroke-width="2" />
                {{ formatDateTime(item.updatedAt) }}
                <SourceBadge :source="item.source || 'TWSE MIS'" />
              </span>
            </span>
            <span class="notification-metric">
              <strong>{{ item.metricValue }}</strong>
              <em>{{ item.metricLabel }}</em>
              <small :class="moveClass(item.chgPct).replace('is-', '')">{{ formatPct(item.chgPct) }}</small>
              <small>{{ formatMoney(item.price, 2) }}</small>
            </span>
          </button>
          <div class="notification-actions">
            <button class="btn xs" type="button" @click="item.read ? notificationStore.markUnread(item.id) : notificationStore.markRead(item.id)">
              {{ item.read ? '標未讀' : '已讀' }}
            </button>
            <button class="icon-btn danger" type="button" title="刪除通知" @click="notificationStore.removeNotification(item.id)">
              <IconTrash class="btn-icon" :stroke-width="2" />
            </button>
          </div>
        </article>
      </div>

      <div v-else class="empty-state notification-empty">
        <IconBell class="title-icon" :stroke-width="2" />
        <strong>目前沒有符合條件的通知</strong>
        <span>可按「重新掃描」更新前100熱門與即時報價後重新判斷。</span>
      </div>
    </div>

    <div class="table-hint">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      通知僅代表市場訊號觸發，不等於投資建議。買賣力道優先採用 TWSE MIS 可驗證資料；量比與量價訊號使用 Yahoo Chart 輔助。
    </div>

    <div class="table-footer">
      <button class="btn" type="button" @click="showAi = !showAi">
        <IconSparkles class="btn-icon" :stroke-width="2" />
        AI 解讀通知
      </button>
      <div v-if="showAi" class="ai-pick-result">
        <div class="ai-box-header">
          <IconSparkles class="inline-icon" :stroke-width="2" />
          AI 通知摘要
        </div>
        <div class="ai-content">
          先看重要未讀，再看同一檔股票是否同時出現買賣力道、量比與價量訊號。若只有單一訊號，建議回到即時報價或走勢圖確認支撐壓力與成交量。
        </div>
      </div>
    </div>
  </section>
</template>
