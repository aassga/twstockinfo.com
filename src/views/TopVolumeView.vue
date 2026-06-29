<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IconInfoCircle, IconRefresh, IconTable } from '@tabler/icons-vue';
import { useChartStore } from '../stores/chartStore';
import { useTopVolumeStore } from '../stores/topVolumeStore';
import { formatDateTime, formatMoney, formatNumber, formatSigned, formatVolume, moveClass } from '../utils/formatters';

const router = useRouter();
const chartStore = useChartStore();
const topVolumeStore = useTopVolumeStore();

onMounted(() => {
  if (!topVolumeStore.rows.length) topVolumeStore.loadTopVolume();
});

async function openChart(stock) {
  await chartStore.openStock({
    code: stock.code,
    name: stock.name,
    exchange: 'tse',
    price: stock.close,
    change: stock.change
  });
  router.push('/chart');
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

function toLots(value) {
  return Number(value || 0) / 1000;
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
        <div class="volume-overview-label">資料日期</div>
        <div class="volume-overview-value">{{ formatTradeDate(topVolumeStore.tradeDate) }}</div>
      </div>
      <div class="volume-overview-card accent-red">
        <div class="volume-overview-label">成交量第一</div>
        <div class="volume-overview-value">
          {{ topVolumeStore.leader ? `${topVolumeStore.leader.code} ${topVolumeStore.leader.name}` : '--' }}
        </div>
        <div class="volume-overview-sub">
          {{ topVolumeStore.leader ? `${formatNumber(toLots(topVolumeStore.leader.volume))} 張` : '--' }}
        </div>
      </div>
      <div class="volume-overview-card accent-green">
        <div class="volume-overview-label">前20總張數</div>
        <div class="volume-overview-value">{{ formatNumber(toLots(topVolumeStore.summary.totalVolume)) }}</div>
      </div>
      <div class="volume-overview-card">
        <div class="volume-overview-label">前20成交筆數</div>
        <div class="volume-overview-value">{{ formatNumber(topVolumeStore.summary.totalTransaction) }}</div>
      </div>
    </div>

    <div class="table-hint">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      點擊股票名稱可以看走勢圖
    </div>

    <div class="hot-data-meta">
      <span>最後更新：{{ topVolumeStore.updatedAt ? formatDateTime(topVolumeStore.updatedAt) : '--' }}</span>
      <span>資料來源：STOCK_DAY_ALL 股票池 + TWSE MIS/Yahoo 即時報價排序，MI_INDEX20 備援</span>
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
            <th>成交量(張)</th>
            <th>成交筆數</th>
            <th>開盤</th>
            <th>最高</th>
            <th>最低</th>
            <th>收盤</th>
            <th>漲跌</th>
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
            @click="openChart(stock)"
          >
            <td class="rank-cell">{{ stock.rank }}</td>
            <td>{{ stock.code }}</td>
            <td>
              <button class="stock-link" type="button" @click.stop="openChart(stock)">
                {{ stock.name }}
              </button>
            </td>
            <td>
              <div class="volume-stack">
                <span>{{ formatNumber(toLots(stock.volume)) }}</span>
                <small>{{ formatVolume(stock.volume) }} 股</small>
              </div>
            </td>
            <td>{{ formatNumber(stock.transaction) }}</td>
            <td>{{ formatMoney(stock.open, 2) }}</td>
            <td>{{ formatMoney(stock.high, 2) }}</td>
            <td>{{ formatMoney(stock.low, 2) }}</td>
            <td>{{ formatMoney(stock.close, 2) }}</td>
            <td class="move-cell" :class="moveClass(stock.change).replace('is-', '')">
              {{ changeMark(stock.change) }} {{ formatSigned(stock.change, 2) }}
            </td>
            <td>{{ formatMoney(stock.bid, 2) }}</td>
            <td>{{ formatMoney(stock.ask, 2) }}</td>
            <td>
              <button class="btn xs" type="button" @click.stop="openChart(stock)">分析</button>
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
