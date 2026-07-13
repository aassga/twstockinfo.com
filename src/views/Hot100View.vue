<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { IconFlame, IconInfoCircle, IconSelector, IconSparkles, IconStar, IconStarFilled } from '@tabler/icons-vue';
import AutoRefreshCountdown from '../components/AutoRefreshCountdown.vue';
import SourceBadge from '../components/SourceBadge.vue';
import { useFavoriteStore } from '../stores/favoriteStore';
import { useStockStore } from '../stores/stockStore';
import { formatDateTime, formatMoney, formatPct, formatVolume, moveClass } from '../utils/formatters';

const router = useRouter();
const stockStore = useStockStore();
const favoriteStore = useFavoriteStore();
const hotRefreshMs = 30000;
const hotRefreshResetKey = ref(0);
const filters = [
  { key: 'all', label: '全部' },
  { key: 'buy', label: '🔴 強力買入' },
  { key: 'sell', label: '🟢 強力賣出' },
  { key: 'up', label: '▲ 上漲' },
  { key: 'down', label: '▼ 下跌' },
  { key: 'priceUpVolumeUp', label: '價漲量增' },
  { key: 'priceDownVolumeDown', label: '價跌量縮' },
  { key: 'priceDownVolumeUp', label: '價跌量增' },
  { key: 'priceUpVolumeDown', label: '價漲量縮' }
];
const columns = [
  { key: 'price', label: '股價' },
  { key: 'chg', label: '漲跌%' },
  { key: 'vol', label: '成交量' },
  { key: 'buy', label: '買入%' },
  { key: 'sell', label: '賣出%' },
  { key: 'force', label: '力道比例' },
  { key: 'volRatio', label: '量比%' }
];

function openQuote(stock) {
  router.push({ path: '/quote', query: { code: stock.code } });
}

function direction(stock) {
  if (stock.buyPct >= 65) return { text: '強買', type: 'buy' };
  if (stock.sellPct >= 65) return { text: '強賣', type: 'sell' };
  return { text: '均衡', type: 'neutral' };
}
function flashClass(stock, key) {
  return stockStore.hotCellFlashClass(stock.code, key);
}

function realtimeMeta() {
  return `MIS 即時報價 ${stockStore.hotRealtimeCount} 檔`;
}

function formatVolRatio(stock) {
  const value = Number(stock?.volRatio);
  return Number.isFinite(value) && value > 0 ? `${Math.round(value)}%` : '--';
}

async function refreshHot100() {
  if (stockStore.loadingAll) return;
  try {
    await stockStore.loadAllStocks({ force: true });
  } finally {
    hotRefreshResetKey.value += 1;
  }
}
</script>

<template>
  <section class="tab-content active">
    <div class="page-title-row">
      <div class="page-title">
        <IconFlame class="title-icon" :stroke-width="2" />
        前100名熱門台股
      </div>
      <div class="page-actions">
        <input v-model="stockStore.hotSearch" class="table-search-input" placeholder="搜尋代號或名稱" />
        <AutoRefreshCountdown
          :interval-ms="hotRefreshMs"
          :loading="stockStore.loadingAll"
          :reset-key="hotRefreshResetKey"
          @refresh="refreshHot100"
        />
      </div>
    </div>

    <div class="filter-row">
      <button
        v-for="filter in filters"
        :key="filter.key"
        class="filter-btn"
        :class="{ active: stockStore.hotFilter === filter.key }"
        type="button"
        @click="stockStore.setHotFilter(filter.key)"
      >
        {{ filter.label }}
      </button>
    </div>

    <div class="table-hint">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      點擊股票名稱可以看即時報價與走勢圖，按星星加入我的最愛
    </div>

    <div class="hot-data-meta">
      <span>最後更新：{{ stockStore.hotUpdatedAt ? formatDateTime(stockStore.hotUpdatedAt) : '--' }}</span>
      <SourceBadge source="TWSE MIS" />
      <SourceBadge source="HiStock rank" />
      <SourceBadge source="Yahoo Chart" />
      <span>{{ realtimeMeta() }}</span>
    </div>

    <div class="table-wrapper">
      <table class="stock-table">
        <thead>
          <tr>
            <th>#</th>
            <th>代號</th>
            <th>名稱</th>
            <th v-for="column in columns" :key="column.key">
              <button class="sort-th" type="button" :class="{ active: stockStore.hotSort.key === column.key }" @click="stockStore.setHotSort(column.key)">
                <span>{{ column.label }}</span>
                <IconSelector class="inline-icon" :stroke-width="2" />
              </button>
            </th>
            <th>買賣力道</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(stock, index) in stockStore.hotStocks.slice(0, 100)" :key="stock.code">
            <td>{{ index + 1 }}</td>
            <td>{{ stock.code }}</td>
            <td>
              <button class="stock-link" type="button" @click="openQuote(stock)">
                {{ stock.name }}
              </button>
              <span style="color:var(--text-3);font-size:11px;margin-left:4px">{{ stock.sector }}</span>
            </td>
            <td :class="flashClass(stock, 'price')">{{ formatMoney(stock.price, 2) }}</td>
            <td class="move-cell" :class="[moveClass(stock.chgPct).replace('is-', ''), flashClass(stock, 'chg')]">
              {{ stock.chgPct > 0 ? '▲' : stock.chgPct < 0 ? '▼' : '' }} {{ formatPct(stock.chgPct) }}
            </td>
            <td :class="flashClass(stock, 'vol')">{{ formatVolume(stock.volume) }}</td>
            <td :class="flashClass(stock, 'buy')">{{ Math.round(stock.buyPct) }}%</td>
            <td :class="flashClass(stock, 'sell')">{{ Math.round(stock.sellPct) }}%</td>
            <td :class="flashClass(stock, 'force')">
              <div class="bar-mini">
                <div class="bar-mini-track">
                  <div
                    class="bar-mini-fill"
                    :class="stock.buyPct >= stock.sellPct ? 'buy' : 'sell'"
                    :style="{ width: `${Math.max(stock.buyPct, stock.sellPct)}%` }"
                  ></div>
                </div>
                <span>{{ Math.round(Math.max(stock.buyPct, stock.sellPct)) }}%</span>
              </div>
            </td>
            <td :class="flashClass(stock, 'volRatio')">{{ formatVolRatio(stock) }}</td>
            <td>
              <span class="direction-pill" :class="direction(stock).type">
                {{ direction(stock).text }}
              </span>
            </td>
            <td>
              <div class="table-actions">
                <button
                  class="favorite-btn"
                  :class="{ active: favoriteStore.isFavorite(stock.code) }"
                  type="button"
                  :title="favoriteStore.isFavorite(stock.code) ? '取消我的最愛' : '加入我的最愛'"
                  @click="favoriteStore.toggleFavorite(stock)"
                >
                  <IconStarFilled v-if="favoriteStore.isFavorite(stock.code)" class="btn-icon" :stroke-width="2" />
                  <IconStar v-else class="btn-icon" :stroke-width="2" />
                </button>
                <button class="btn xs" type="button" @click="openQuote(stock)">報價</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="table-footer">
      <button class="btn" type="button">
        <IconSparkles class="btn-icon" :stroke-width="2" />
        AI 精選推薦
      </button>
      <div class="ai-pick-result">
        <div class="ai-box-header">
          <IconSparkles class="inline-icon" :stroke-width="2" />
          AI 精選結果
        </div>
        <div class="ai-content">
          <span class="hint">依目前前100熱門股排序，優先觀察量價同步且買賣力道明確的個股。</span>
        </div>
      </div>
    </div>
  </section>
</template>
