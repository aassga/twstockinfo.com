<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IconInfoCircle, IconRefresh, IconTable } from '@tabler/icons-vue';
import SourceBadge from '../components/SourceBadge.vue';
import { useTopVolumeStore } from '../stores/topVolumeStore';
import { formatDateTime, formatMoney, formatNumber, formatPct, formatSigned, formatVolume, moveClass } from '../utils/formatters';

const router = useRouter();
const topVolumeStore = useTopVolumeStore();

onMounted(() => {
  if (!topVolumeStore.rows.length) topVolumeStore.loadTopVolume();
});

function openQuote(stock) {
  router.push({ path: '/quote', query: { code: stock.code } });
}

function formatTradeDate(value) {
  const text = String(value || '');
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
  }
  return text || '--';
}

function changeMark(value) {
  const number = Number(value || 0);
  if (number > 0) return '▲';
  if (number < 0) return '▼';
  return '';
}

function changePct(stock) {
  const close = Number(stock?.close || 0);
  const change = Number(stock?.change || 0);
  const previous = close - change;
  return previous > 0 ? (change / previous) * 100 : 0;
}

</script>

<template>
  <section class="tab-content active top-volume-view">
    <div class="page-title-row">
      <div class="page-title">
        <IconTable class="title-icon" :stroke-width="2" />
        每日成交量前二十名證券
      </div>
      <div class="page-actions">
        <button
          class="btn"
          :class="{ 'is-refreshing': topVolumeStore.loading }"
          type="button"
          :disabled="topVolumeStore.loading"
          @click="topVolumeStore.loadTopVolume()"
        >
          <IconRefresh class="btn-icon" :stroke-width="2" />
          重新整理
        </button>
      </div>
    </div>

    <div class="volume-overview-grid">
      <div class="volume-overview-card accent-blue">
        <div class="volume-overview-label">資料更新日期</div>
        <div class="volume-overview-value">{{ formatTradeDate(topVolumeStore.tradeDate) }}</div>
      </div>
      <div class="volume-overview-card accent-red">
        <div class="volume-overview-label">成交量第一排名</div>
        <div class="volume-overview-value">
          {{ topVolumeStore.leader ? `${topVolumeStore.leader.code} ${topVolumeStore.leader.name}` : '--' }}
        </div>
        <div class="volume-overview-sub">
          {{ topVolumeStore.leader ? `${formatNumber(topVolumeStore.leader.volume)} 股` : '--' }}
        </div>
      </div>
      <div class="volume-overview-card accent-green">
        <div class="volume-overview-label">總股數</div>
        <div class="volume-overview-value">{{ formatNumber(topVolumeStore.summary.totalVolume) }}</div>
      </div>
      <div class="volume-overview-card">
        <div class="volume-overview-label">前20成交總筆數</div>
        <div class="volume-overview-value">{{ formatNumber(topVolumeStore.summary.totalTransaction) }}</div>
      </div>
    </div>

    <div class="table-hint">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      點擊股票名稱可以看即時報價與走勢圖
    </div>

    <div class="hot-data-meta">
      <span>最後更新：{{ topVolumeStore.updatedAt ? formatDateTime(topVolumeStore.updatedAt) : '--' }}</span>
      <SourceBadge source="TWSE 每日成交量前二十名證券" />
    </div>

    <div v-if="topVolumeStore.error" class="empty-state volume-empty-state">
      {{ topVolumeStore.error }}
    </div>

    <div v-else class="table-wrapper">
      <table class="stock-table volume-rank-table">
        <thead>
          <tr>
            <th>#</th>
            <th>代號</th>
            <th>名稱</th>
            <th>成交股數</th>
            <th>成交筆數</th>
            <th>開盤</th>
            <th>最高</th>
            <th>最低</th>
            <th>收盤</th>
            <th>漲跌 / 漲跌%</th>
            <th>買價</th>
            <th>賣價</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="topVolumeStore.loading && !topVolumeStore.rows.length">
            <td colspan="13" class="volume-loading-cell">載入中...</td>
          </tr>
          <tr
            v-for="stock in topVolumeStore.rows"
            :key="stock.code"
            class="clickable-row"
            @click="openQuote(stock)"
          >
            <td class="rank-cell">{{ stock.rank }}</td>
            <td>{{ stock.code }}</td>
            <td>
              <button class="stock-link" type="button" @click.stop="openQuote(stock)">
                {{ stock.name }}
              </button>
            </td>
            <td>
              <div class="volume-stack">
                <span>{{ formatNumber(stock.volume) }}</span>
                <small>{{ formatVolume(stock.volume) }} 股</small>
              </div>
            </td>
            <td>{{ formatNumber(stock.transaction) }}</td>
            <td>{{ formatMoney(stock.open, 2) }}</td>
            <td>{{ formatMoney(stock.high, 2) }}</td>
            <td>{{ formatMoney(stock.low, 2) }}</td>
            <td>{{ formatMoney(stock.close, 2) }}</td>
            <td class="move-cell" :class="moveClass(stock.change).replace('is-', '')">
              <div class="move-stack">
                <span>{{ changeMark(stock.change) }} {{ formatSigned(stock.change, 2) }}</span>
                <small>{{ formatPct(changePct(stock)) }}</small>
              </div>
            </td>
            <td>{{ formatMoney(stock.bid, 2) }}</td>
            <td>{{ formatMoney(stock.ask, 2) }}</td>
            <td>
              <button class="btn xs" type="button" @click.stop="openQuote(stock)">報價</button>
            </td>
          </tr>
          <tr v-if="!topVolumeStore.loading && !topVolumeStore.rows.length">
            <td colspan="13" class="volume-loading-cell">尚無資料</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
