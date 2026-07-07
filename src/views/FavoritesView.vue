<script setup>
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IconRefresh, IconStarFilled, IconTrash } from '@tabler/icons-vue';
import { useFavoriteStore } from '../stores/favoriteStore';
import { useStockStore } from '../stores/stockStore';
import { formatDateTime, formatMoney, formatPct, formatVolume, moveClass } from '../utils/formatters';

const router = useRouter();
const favoriteStore = useFavoriteStore();
const stockStore = useStockStore();
const favoriteRows = computed(() => favoriteStore.favorites.map(stock => {
  const latest = stockStore.allStocks.find(row => row.code === stock.code);
  return shouldUseLatestQuote(stock, latest) ? { ...stock, ...latest, savedAt: stock.savedAt } : stock;
}));

onMounted(() => {
  refreshFavorites();
});

function openQuote(stock) {
  router.push({ path: '/quote', query: { code: stock.code } });
}

async function refreshFavorites() {
  const rows = await stockStore.refreshStocksByCodes(favoriteStore.favorites.map(stock => stock.code), { force: true });
  const latestByCode = new Map(rows.map(stock => [stock.code, stock]));

  favoriteStore.favorites.forEach(stock => {
    const latest = latestByCode.get(stock.code);
    if (Number(latest?.price || 0) > 0) favoriteStore.addFavorite({ ...stock, ...latest, savedAt: stock.savedAt });
  });
}

function direction(stock) {
  if (stock.buyPct >= 65) return { text: '強買', type: 'buy' };
  if (stock.sellPct >= 65) return { text: '強賣', type: 'sell' };
  return { text: '均衡', type: 'neutral' };
}
function shouldUseLatestQuote(saved, latest) {
  if (!latest) return false;
  if (Number(latest.price || 0) <= 0) return false;
  if (!Number(saved?.price || 0)) return true;
  return String(latest.source || '') !== 'histock-rank';
}

function formatVolRatio(stock) {
  const value = Number(stock?.volRatio);
  return Number.isFinite(value) && value > 0 ? `${Math.round(value)}%` : '--';
}
</script>

<template>
  <section class="tab-content active favorites-view">
    <div class="page-title-row">
      <div class="page-title">
        <IconStarFilled class="title-icon favorite-title-icon" :stroke-width="2" />
        我的最愛
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :disabled="stockStore.loadingAll" @click="refreshFavorites">
          <IconRefresh class="btn-icon" :stroke-width="2" />
          更新報價
        </button>
      </div>
    </div>

    <div class="hot-data-meta">
      <span>已收藏：{{ favoriteRows.length }} 檔</span>
      <span>從前100熱門表格點擊星星即可加入或取消收藏</span>
    </div>

    <div v-if="!favoriteRows.length" class="empty-state volume-empty-state">
      <IconStarFilled class="title-icon favorite-title-icon" :stroke-width="2" />
      尚未加入我的最愛
    </div>

    <div v-else class="table-wrapper">
      <table class="stock-table">
        <thead>
          <tr>
            <th>#</th>
            <th>代號</th>
            <th>名稱</th>
            <th>股價</th>
            <th>漲跌%</th>
            <th>成交量</th>
            <th>買入%</th>
            <th>賣出%</th>
            <th>量比%</th>
            <th>買賣力道</th>
            <th>加入時間</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(stock, index) in favoriteRows" :key="stock.code">
            <td>{{ index + 1 }}</td>
            <td>{{ stock.code }}</td>
            <td>
              <button class="stock-link" type="button" @click="openQuote(stock)">
                {{ stock.name || stock.code }}
              </button>
              <span v-if="stock.sector" class="table-subtext">{{ stock.sector }}</span>
            </td>
            <td>{{ formatMoney(stock.price, 2) }}</td>
            <td class="move-cell" :class="moveClass(stock.chgPct).replace('is-', '')">
              {{ stock.chgPct > 0 ? '▲' : stock.chgPct < 0 ? '▼' : '' }} {{ formatPct(stock.chgPct) }}
            </td>
            <td>{{ formatVolume(stock.volume) }}</td>
            <td>{{ Math.round(stock.buyPct) }}%</td>
            <td>{{ Math.round(stock.sellPct) }}%</td>
            <td>{{ formatVolRatio(stock) }}</td>
            <td>
              <span class="direction-pill" :class="direction(stock).type">
                {{ direction(stock).text }}
              </span>
            </td>
            <td>{{ formatDateTime(stock.savedAt) }}</td>
            <td>
              <div class="table-actions">
                <button class="btn xs" type="button" @click="openQuote(stock)">報價</button>
                <button class="btn xs icon-only danger" type="button" title="移除我的最愛" @click="favoriteStore.removeFavorite(stock.code)">
                  <IconTrash class="btn-icon" :stroke-width="2" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
