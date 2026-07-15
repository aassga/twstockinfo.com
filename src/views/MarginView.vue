<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IconAlertTriangle, IconChartBar, IconInfoCircle, IconRefresh, IconSearch } from '@tabler/icons-vue';
import { fetchFundamentalSnapshotPhased } from '../api/fundamentalApi';
import SourceBadge from '../components/SourceBadge.vue';
import { useStockStore } from '../stores/stockStore';
import { formatDateTime, formatNumber, formatSigned, moveClass } from '../utils/formatters';
import { quickStocks } from '../utils/stockMeta';

const stockStore = useStockStore();
const route = useRoute();
const router = useRouter();
const query = ref(stockStore.currentStock?.code || stockStore.activeCode || '');
const stock = ref(null);
const snapshot = ref(null);
const loading = ref(false);
const error = ref('');
const candidates = ref([]);
const showCandidates = ref(false);
const candidateLimit = 20;
const stockCodePattern = /^\d{4,6}[a-z]?$/i;
let candidateTimer = null;
let candidateRequestId = 0;
let searchRunId = 0;

const marginTrading = computed(() => snapshot.value?.marginTrading || null);
const recentRows = computed(() => marginTrading.value?.recentRows || []);
const latestDateText = computed(() => marginTrading.value?.latestDate || '--');
const creditRiskRows = computed(() => buildCreditRiskRows(marginTrading.value));

watch(query, value => {
  clearTimeout(candidateTimer);
  const requestId = ++candidateRequestId;
  const input = String(value || '').trim();
  if (!input || stockCodePattern.test(input)) {
    candidates.value = [];
    showCandidates.value = false;
    return;
  }

  candidateTimer = setTimeout(async () => {
    const rows = await stockStore.findStockCandidates(input, candidateLimit).catch(() => []);
    if (requestId !== candidateRequestId || input !== String(query.value || '').trim()) return;
    candidates.value = rows;
    showCandidates.value = rows.length > 0;
  }, 180);
});

watch(
  () => route.query.code,
  code => {
    const normalized = normalizeRouteCode(code);
    if (normalized && normalized !== query.value) runSearch(normalized);
  }
);

onMounted(() => {
  document.addEventListener('click', handleCandidateOutsideClick);
  const routeCode = normalizeRouteCode(route.query.code);
  const initialCode = routeCode || stockStore.currentStock?.code || stockStore.activeCode || query.value;
  if (initialCode) runSearch(String(initialCode).trim().toUpperCase());
});

onBeforeUnmount(() => {
  clearTimeout(candidateTimer);
  document.removeEventListener('click', handleCandidateOutsideClick);
});

async function submit(value = query.value) {
  const input = String(value || '').trim();
  if (!input) return;
  const requestId = closeCandidates();

  if (!stockCodePattern.test(input)) {
    const rows = await stockStore.findStockCandidates(input, candidateLimit).catch(() => []);
    if (requestId !== candidateRequestId || input !== String(query.value || '').trim()) return;
    const normalized = normalizeSearchText(input);
    const exact = rows.find(row => normalizeSearchText(row.code) === normalized || normalizeSearchText(row.name) === normalized);
    if (exact) return runSearch(exact.code);
    if (rows.length === 1) return runSearch(rows[0].code);
    if (rows.length > 1) {
      candidates.value = rows;
      showCandidates.value = true;
      return;
    }
  }

  return runSearch(input.toUpperCase());
}

async function runSearch(code) {
  const runId = ++searchRunId;
  loading.value = true;
  error.value = '';
  snapshot.value = null;
  closeCandidates();

  try {
    const nextStock = await stockStore.searchStock(code);
    if (runId !== searchRunId) return;
    stock.value = nextStock;
    query.value = nextStock.code;
    router.replace({ path: '/margin', query: { code: nextStock.code } });
    const finalSnapshot = await fetchFundamentalSnapshotPhased(nextStock, nextSnapshot => {
      if (runId === searchRunId) snapshot.value = nextSnapshot;
    });
    if (runId !== searchRunId) return;
    snapshot.value = finalSnapshot;
  } catch (err) {
    if (runId !== searchRunId) return;
    error.value = err?.message || '信用籌碼資料讀取失敗';
  } finally {
    if (runId === searchRunId) loading.value = false;
  }
}

function selectCandidate(item) {
  runSearch(item.code);
}

function closeCandidates() {
  clearTimeout(candidateTimer);
  candidateRequestId += 1;
  candidates.value = [];
  showCandidates.value = false;
  return candidateRequestId;
}

function handleCandidateOutsideClick(event) {
  if (!showCandidates.value) return;
  if (event.target?.closest?.('.search-row, .search-candidates')) return;
  closeCandidates();
}

function quickSearch(code) {
  query.value = code;
  submit(code);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeRouteCode(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return String(text || '').trim().toUpperCase();
}

function signedClass(value) {
  return moveClass(value).replace('is-', '');
}

function formatShares(value) {
  return `${formatNumber(value || 0, 0)} 張`;
}

function formatRatio(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}%` : '--';
}

function formatAmount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) return '--';
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toLocaleString('zh-TW', { maximumFractionDigits: 2 })} 億`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 1 })} 萬`;
  return number.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

function buyAfterSaleText(value) {
  const text = String(value || '').trim();
  if (text === '＊') return '限先買後賣';
  if (text === 'Y') return '可先賣後買';
  return '可當沖';
}

function buildCreditRiskRows(data) {
  if (!data?.available) return [];
  return [
    {
      label: '融資熱度',
      value: formatSigned(data.margin5Change || 0, 0, '張'),
      detail: '近 5 日融資變化',
      status: data.margin5Change > 0 ? 'watch' : data.margin5Change < 0 ? 'good' : 'neutral'
    },
    {
      label: '融券壓力',
      value: formatSigned(data.short5Change || 0, 0, '張'),
      detail: '近 5 日融券變化',
      status: data.short5Change > 0 ? 'risk' : data.short5Change < 0 ? 'good' : 'neutral'
    },
    {
      label: '券資比',
      value: formatRatio(data.shortMarginRatio),
      detail: '融券餘額 / 融資餘額',
      status: data.shortMarginRatio >= 30 ? 'risk' : data.shortMarginRatio >= 15 ? 'watch' : 'neutral'
    },
    {
      label: '借券賣壓',
      value: formatSigned(data.sblShortSaleBalanceChange || 0, 0, '張'),
      detail: `借券賣出餘額 ${formatShares(data.sblShortSaleBalance || 0)}`,
      status: data.sblShortSaleBalanceChange > 0 ? 'risk' : data.sblShortSaleBalanceChange < 0 ? 'good' : 'neutral'
    },
    {
      label: '當沖熱度',
      value: formatRatio(data.dayTradingRatio),
      detail: `當沖量 ${formatShares(data.dayTradingVolume || 0)}`,
      status: data.dayTradingRatio >= 35 ? 'risk' : data.dayTradingRatio >= 20 ? 'watch' : 'neutral'
    },
    {
      label: '現股當沖成交比重',
      value: formatRatio(data.dayTradingValueRatio),
      detail: buyAfterSaleText(data.dayTradingBuyAfterSale),
      status: data.dayTradingValueRatio >= 35 ? 'risk' : data.dayTradingValueRatio >= 20 ? 'watch' : 'neutral'
    }
  ];
}
</script>

<template>
  <section class="tab-content active margin-view">
    <div class="page-title-row">
      <div class="page-title">
        <IconChartBar class="title-icon" :stroke-width="2" />
        信用籌碼
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :disabled="loading || !stock?.code" @click="runSearch(stock.code)">
          <IconRefresh class="btn-icon" :stroke-width="2" />
          重新整理
        </button>
      </div>
    </div>

    <div class="search-row fundamental-search">
      <input
        v-model="query"
        class="search-input"
        placeholder="輸入股票代號或名稱，例如：2330 或 台積電"
        @keyup.enter="submit()"
      />
      <button class="btn primary" type="button" :disabled="loading" @click="submit()">
        <IconSearch class="btn-icon" :stroke-width="2" />
        搜尋
      </button>
    </div>

    <div class="quick-row">
      <span class="quick-label">熱門：</span>
      <button v-for="item in quickStocks" :key="item.code" class="quick-btn" type="button" @click="quickSearch(item.code)">
        {{ item.name }} {{ item.code }}
      </button>
    </div>

    <div v-if="showCandidates" class="search-candidates">
      <button v-for="item in candidates" :key="item.code" type="button" class="candidate-row" @click="selectCandidate(item)">
        <span>{{ item.code }}</span>
        <strong>{{ item.name }}</strong>
        <em>{{ item.sector }}</em>
        <small>{{ item.price ? `$${item.price}` : '--' }}</small>
      </button>
    </div>

    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-if="loading && !snapshot" class="empty-state">信用籌碼資料載入中...</div>

    <template v-if="stock && snapshot">
      <div class="margin-hero">
        <div>
          <span>{{ stock.code }}</span>
          <strong>{{ stock.name || stock.code }}</strong>
          <em>{{ stock.sector || '未分類' }}</em>
        </div>
        <div>
          <span>最新資料日</span>
          <strong>{{ latestDateText }}</strong>
          <SourceBadge :source="marginTrading?.source || 'FinMind'" />
        </div>
        <div :class="marginTrading?.tone">
          <span>信用狀態</span>
          <strong>{{ marginTrading?.label || '待資料' }}</strong>
          <em>{{ loading ? '資料更新中' : `本機整理 ${formatDateTime(snapshot.updatedAt)}` }}</em>
        </div>
      </div>

      <div v-if="marginTrading?.available" class="margin-card-grid">
        <div class="margin-card">
          <span>融資餘額</span>
          <strong>{{ formatShares(marginTrading.marginBalance) }}</strong>
          <em :class="signedClass(marginTrading.marginChange)">日變化 {{ formatSigned(marginTrading.marginChange || 0, 0, '張') }}</em>
        </div>
        <div class="margin-card">
          <span>融券餘額</span>
          <strong>{{ formatShares(marginTrading.shortBalance) }}</strong>
          <em :class="signedClass(marginTrading.shortChange)">日變化 {{ formatSigned(marginTrading.shortChange || 0, 0, '張') }}</em>
        </div>
        <div class="margin-card">
          <span>券資比</span>
          <strong>{{ formatRatio(marginTrading.shortMarginRatio) }}</strong>
          <em>融券 / 融資</em>
        </div>
        <div class="margin-card">
          <span>借券成交量</span>
          <strong>{{ formatShares(marginTrading.lendingVolume) }}</strong>
          <em>平均費率 {{ marginTrading.lendingFeeAvg ? formatRatio(marginTrading.lendingFeeAvg) : '--' }}</em>
        </div>
        <div class="margin-card">
          <span>借券賣出餘額</span>
          <strong>{{ formatShares(marginTrading.sblShortSaleBalance) }}</strong>
          <em :class="signedClass(marginTrading.sblShortSaleBalanceChange)">日變化 {{ formatSigned(marginTrading.sblShortSaleBalanceChange || 0, 0, '張') }}</em>
        </div>
        <div class="margin-card">
          <span>借券賣出量</span>
          <strong>{{ formatShares(marginTrading.sblShortSaleSell) }}</strong>
          <em>借券回補 {{ formatShares(marginTrading.sblShortSaleReturn || 0) }}</em>
        </div>
        <div class="margin-card">
          <span>當沖比例</span>
          <strong>{{ formatRatio(marginTrading.dayTradingRatio) }}</strong>
          <em>{{ marginTrading.dayTradingDate || '--' }} / {{ formatShares(marginTrading.dayTradingVolume || 0) }}</em>
        </div>
        <div class="margin-card">
          <span>現股當沖成交比重</span>
          <strong>{{ formatRatio(marginTrading.dayTradingValueRatio) }}</strong>
          <em>{{ buyAfterSaleText(marginTrading.dayTradingBuyAfterSale) }} / {{ formatAmount(marginTrading.dayTradingValue) }}</em>
        </div>
      </div>

      <div v-if="marginTrading?.available" class="margin-window-grid">
        <div>
          <span>近 5 日融資</span>
          <strong :class="signedClass(marginTrading.margin5Change)">{{ formatSigned(marginTrading.margin5Change || 0, 0, '張') }}</strong>
          <em>融券 {{ formatSigned(marginTrading.short5Change || 0, 0, '張') }}</em>
        </div>
        <div>
          <span>近 10 日融資</span>
          <strong :class="signedClass(marginTrading.margin10Change)">{{ formatSigned(marginTrading.margin10Change || 0, 0, '張') }}</strong>
          <em>融券 {{ formatSigned(marginTrading.short10Change || 0, 0, '張') }}</em>
        </div>
        <div>
          <span>近 20 日融資</span>
          <strong :class="signedClass(marginTrading.margin20Change)">{{ formatSigned(marginTrading.margin20Change || 0, 0, '張') }}</strong>
          <em>融券 {{ formatSigned(marginTrading.short20Change || 0, 0, '張') }}</em>
        </div>
      </div>

      <div v-if="creditRiskRows.length" class="risk-check-grid margin-risk-grid">
        <div v-for="item in creditRiskRows" :key="item.label" class="risk-check" :class="item.status">
          <IconAlertTriangle class="inline-icon" :stroke-width="2" />
          <div>
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <em>{{ item.detail }}</em>
          </div>
        </div>
      </div>

      <div class="table-hint">
        <IconInfoCircle class="inline-icon" :stroke-width="2" />
        融資融券、借券賣出與當沖量值資料來源為 FinMind；當沖量值通常於收盤後更新，盤中不視為即時資料。
      </div>

      <div v-if="recentRows.length" class="table-wrapper margin-table-wrap">
        <div class="margin-table-header">
          <div>
            <span>近 20 日信用交易明細</span>
            <strong>{{ stock.code }} {{ stock.name || '' }}</strong>
          </div>
          <SourceBadge :source="marginTrading?.source || 'FinMind'" />
        </div>
        <table class="stock-table margin-stock-table">
          <thead>
            <tr>
              <th>#</th>
              <th>日期</th>
              <th>融資餘額</th>
              <th>融資增減</th>
              <th>融券餘額</th>
              <th>融券增減</th>
              <th>資券相抵</th>
              <th>借券賣出餘額</th>
              <th>借券賣出量</th>
              <th>當沖比例</th>
              <th>現股當沖成交比重</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in recentRows.slice().reverse()" :key="row.date">
              <td>{{ index + 1 }}</td>
              <td>{{ row.date }}</td>
              <td>{{ formatShares(row.marginBalance) }}</td>
              <td :class="signedClass(row.marginChange)">{{ formatSigned(row.marginChange || 0, 0, '張') }}</td>
              <td>{{ formatShares(row.shortBalance) }}</td>
              <td :class="signedClass(row.shortChange)">{{ formatSigned(row.shortChange || 0, 0, '張') }}</td>
              <td>{{ formatShares(row.offset) }}</td>
              <td :class="signedClass(row.sblShortSaleBalanceChange)">{{ formatShares(row.sblShortSaleBalance) }}</td>
              <td>{{ formatShares(row.sblShortSaleSell) }}</td>
              <td>{{ formatRatio(row.dayTradingRatio) }}</td>
              <td>{{ formatRatio(row.dayTradingValueRatio) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state">尚未取得融資融券趨勢資料。</div>
    </template>
  </section>
</template>
