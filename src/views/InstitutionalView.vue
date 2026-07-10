<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IconBuildingBank, IconInfoCircle, IconSearch, IconSparkles } from '@tabler/icons-vue';
import { stockApi } from '../api/stockApi';
import SourceBadge from '../components/SourceBadge.vue';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { useStockStore } from '../stores/stockStore';
import { formatMoney, formatSigned, moveClass } from '../utils/formatters';

const router = useRouter();
const institutionalStore = useInstitutionalStore();
const stockStore = useStockStore();
const showAi = ref(false);
const pageSize = 20;
const currentPage = ref(1);
const query = ref('');
const candidates = ref([]);
const showCandidates = ref(false);
const candidateMessage = ref('');
const searchLoading = ref(false);
const selectedCode = ref('');
const priceRelationRows = ref([]);
const priceRelationLoading = ref(false);
const priceRelationError = ref('');
const candidateLimit = 20;
const stockCodePattern = /^\d{4,6}[a-z]?$/i;
const taipeiDateKeyFormatter = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
let candidateTimer = null;

const totalRows = computed(() => institutionalStore.rows.length);
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize)));
const pageStart = computed(() => totalRows.value ? (currentPage.value - 1) * pageSize + 1 : 0);
const pageEnd = computed(() => Math.min(currentPage.value * pageSize, totalRows.value));
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return institutionalStore.rows.slice(start, start + pageSize);
});
const visiblePages = computed(() => {
  const pages = [];
  const start = Math.max(1, currentPage.value - 2);
  const end = Math.min(totalPages.value, start + 4);
  const normalizedStart = Math.max(1, end - 4);
  for (let page = normalizedStart; page <= end; page += 1) pages.push(page);
  return pages;
});
const selectedInstitutional = computed(() => {
  const code = selectedCode.value;
  if (!code) return null;
  return institutionalStore.byCode[code] || institutionalStore.rows.find(row => row.code === code) || null;
});
const selectedTrend = computed(() => {
  const code = selectedCode.value;
  return code ? institutionalStore.trendByCode[code] || [] : [];
});
const selectedLoading = computed(() => {
  const code = selectedCode.value;
  return Boolean(code && (institutionalStore.codeLoading[code] || institutionalStore.trendLoading[code] || searchLoading.value));
});
const selectedTrendSummary = computed(() => [5, 10, 20].map(days => summarizeTrend(selectedTrend.value, days)));
const selectedTrendChartRows = computed(() => selectedTrend.value.slice(0, 20).reverse());
const relationChartRows = computed(() => buildRelationRows(priceRelationRows.value));
const relationPath = computed(() => {
  const rows = relationChartRows.value;
  if (!rows.length) return '';
  return rows.map((row, index) => `${index === 0 ? 'M' : 'L'} ${row.x} ${row.priceY}`).join(' ');
});
const relationAreaPath = computed(() => {
  const rows = relationChartRows.value;
  if (!rows.length) return '';
  return `${relationPath.value} L ${rows[rows.length - 1].x} 100 L ${rows[0].x} 100 Z`;
});
const relationStats = computed(() => {
  const rows = relationChartRows.value;
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const first = rows[0];
  const totalFlow = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const priceChange = first.close ? ((latest.close - first.close) / first.close) * 100 : 0;
  return {
    latest,
    totalFlow,
    priceChange,
    flowDirection: totalFlow > 0 ? '買超' : totalFlow < 0 ? '賣超' : '中性'
  };
});
const selectedTrendMaxAbs = computed(() => {
  const values = selectedTrendChartRows.value.flatMap(row => [
    Math.abs(Number(row.foreign || 0)),
    Math.abs(Number(row.trust || 0)),
    Math.abs(Number(row.dealer || 0)),
    Math.abs(Number(row.total || 0))
  ]);
  return Math.max(1, ...values);
});
const selectedStreaks = computed(() => [
  buildStreak(selectedTrend.value, 'foreign', '外資'),
  buildStreak(selectedTrend.value, 'trust', '投信'),
  buildStreak(selectedTrend.value, 'dealer', '自營商'),
  buildStreak(selectedTrend.value, 'total', '合計')
]);
const selectedSignal = computed(() => {
  const total = Number(selectedInstitutional.value?.total || 0);
  if (total > 0) return '買超';
  if (total < 0) return '賣超';
  return '混合';
});

onMounted(() => {
  institutionalStore.loadInstitutional();
});

onBeforeUnmount(() => {
  clearTimeout(candidateTimer);
});

watch(totalPages, pages => {
  if (currentPage.value > pages) currentPage.value = pages;
});

watch(query, value => {
  clearTimeout(candidateTimer);
  const input = String(value || '').trim();
  if (!input || stockCodePattern.test(input)) {
    candidates.value = [];
    showCandidates.value = false;
    candidateMessage.value = '';
    return;
  }

  candidateTimer = setTimeout(async () => {
    const rows = await stockStore.findStockCandidates(input, candidateLimit).catch(() => []);
    const normalized = normalizeSearchText(input);
    const exact = rows.find(row => normalizeSearchText(row.code) === normalized || normalizeSearchText(row.name) === normalized);
    candidates.value = exact ? [] : rows;
    showCandidates.value = !exact && rows.length > 0;
    candidateMessage.value = '';
  }, 180);
});

function openQuote(row) {
  router.push({ path: '/quote', query: { code: row.code } });
}

async function submit(value = query.value) {
  const input = String(value || '').trim();
  if (!input) return;

  if (stockCodePattern.test(input)) return runSearch(input.toUpperCase());

  const rows = await stockStore.findStockCandidates(input, candidateLimit).catch(() => []);
  const normalized = normalizeSearchText(input);
  const exact = rows.find(row => normalizeSearchText(row.code) === normalized || normalizeSearchText(row.name) === normalized);
  if (exact) return runSearch(exact.code);
  if (rows.length === 1) return runSearch(rows[0].code);
  if (rows.length > 1) {
    candidates.value = rows;
    showCandidates.value = true;
    candidateMessage.value = '找到多筆相近結果，請選擇一檔股票。';
    return;
  }

  selectedCode.value = '';
  candidates.value = [];
  showCandidates.value = true;
  candidateMessage.value = '找不到符合的股票。';
}

async function runSearch(code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return;

  searchLoading.value = true;
  selectedCode.value = normalizedCode;
  query.value = normalizedCode;
  showCandidates.value = false;
  candidates.value = [];
  candidateMessage.value = '';

  try {
    if (!institutionalStore.loaded) await institutionalStore.loadInstitutional({ silent: true });
    await Promise.allSettled([
      institutionalStore.loadInstitutionalByCode(normalizedCode, { force: true }),
      institutionalStore.loadInstitutionalTrendByCode(normalizedCode, { force: true })
    ]);
    await loadPriceRelation(normalizedCode);
    if (!selectedInstitutional.value && !selectedTrend.value.length) {
      showCandidates.value = true;
      candidateMessage.value = '找不到法人資料，可能尚未公布或非交易所法人統計標的。';
    }
  } finally {
    searchLoading.value = false;
  }
}

function selectCandidate(stock) {
  runSearch(stock.code);
}

async function loadPriceRelation(code) {
  priceRelationLoading.value = true;
  priceRelationError.value = '';
  priceRelationRows.value = [];
  try {
    const trendRows = institutionalStore.trendByCode[code] || [];
    const chart = await stockApi.chart(code, '1Y', selectedInstitutional.value?.exchange || '');
    const priceByDate = new Map(
      chart.candles.map(candle => [normalizeDateKey(candle.date || candle.time), candle])
    );
    priceRelationRows.value = trendRows
      .slice(0, 40)
      .map(row => {
        const candle = priceByDate.get(normalizeDateKey(row.date));
        if (!candle) return null;
        return {
          ...row,
          close: Number(candle.close || 0),
          priceDate: candle.date || row.date
        };
      })
      .filter(row => row && row.close > 0)
      .reverse()
      .slice(-24);
    if (!priceRelationRows.value.length) {
      priceRelationError.value = '股價與法人日期暫時無法對齊';
    }
  } catch (err) {
    priceRelationError.value = err?.message || '股價關係圖載入失敗';
  } finally {
    priceRelationLoading.value = false;
  }
}

function percent(value, positive = true) {
  const number = Math.min(80, Math.max(20, 50 + Math.abs(Number(value || 0)) * 2));
  return positive ? Math.round(number) : Math.round(100 - number);
}

function setPage(page) {
  currentPage.value = Math.min(totalPages.value, Math.max(1, page));
}

function summarizeTrend(rows, days) {
  const sliced = rows.slice(0, days);
  return {
    days,
    count: sliced.length,
    foreign: sumRows(sliced, 'foreign'),
    trust: sumRows(sliced, 'trust'),
    dealer: sumRows(sliced, 'dealer'),
    total: sumRows(sliced, 'total')
  };
}

function buildStreak(rows, key, label) {
  const latest = rows[0];
  const direction = Number(latest?.[key] || 0);
  if (!latest || direction === 0) {
    return { key, label, count: 0, direction: 'flat', text: '無連續' };
  }
  const sign = direction > 0 ? 1 : -1;
  let count = 0;
  for (const row of rows) {
    const value = Number(row[key] || 0);
    if (value === 0 || Math.sign(value) !== sign) break;
    count += 1;
  }
  return {
    key,
    label,
    count,
    direction: sign > 0 ? 'up' : 'down',
    text: `${sign > 0 ? '連買' : '連賣'} ${count} 日`
  };
}

function barHeight(value) {
  const number = Math.abs(Number(value || 0));
  return `${Math.max(3, Math.round((number / selectedTrendMaxAbs.value) * 100))}%`;
}

function buildRelationRows(rows) {
  if (!rows.length) return [];
  const closes = rows.map(row => Number(row.close || 0)).filter(value => value > 0);
  const totals = rows.map(row => Math.abs(Number(row.total || 0)));
  const minClose = Math.min(...closes);
  const maxClose = Math.max(...closes);
  const maxAbsTotal = Math.max(1, ...totals);
  const closeRange = Math.max(1, maxClose - minClose);
  const denominator = Math.max(1, rows.length - 1);

  return rows.map((row, index) => {
    const close = Number(row.close || 0);
    const total = Number(row.total || 0);
    return {
      ...row,
      x: Number(((index / denominator) * 100).toFixed(2)),
      priceY: Number((8 + ((maxClose - close) / closeRange) * 54).toFixed(2)),
      barHeight: `${Math.max(3, Math.round((Math.abs(total) / maxAbsTotal) * 32))}%`,
      barClass: total >= 0 ? 'up' : 'down',
      shortDate: shortDate(row.date)
    };
  });
}

function shortDate(value) {
  return String(value || '').slice(5);
}

function normalizeDateKey(value) {
  if (typeof value === 'number') {
    return taipeiDateKeyFormatter.format(new Date(value)).replace(/\D/g, '').slice(0, 8);
  }
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(0, 8) : '';
}

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}
</script>

<template>
  <section class="tab-content active">
    <div class="page-title">
      <IconBuildingBank class="title-icon" :stroke-width="2" />
      三大法人即時動態
    </div>

    <div class="search-row institutional-search">
      <input
        v-model="query"
        class="search-input"
        placeholder="輸入股票代號或名稱，例如：2330 或 台積電"
        @keydown.enter="submit()"
      />
      <button class="btn primary" type="button" :disabled="searchLoading" @click="submit()">
        <IconSearch class="btn-icon" :stroke-width="2" />
        {{ searchLoading ? '查詢中' : '搜尋' }}
      </button>
    </div>

    <div v-if="showCandidates" class="search-candidates institutional-candidates">
      <button
        v-for="item in candidates"
        :key="item.code"
        class="candidate-item"
        type="button"
        @click="selectCandidate(item)"
      >
        <span class="candidate-code">{{ item.code }}</span>
        <span class="candidate-name">{{ item.name }}</span>
        <span class="candidate-sector">{{ item.sector }}</span>
        <span class="candidate-price">{{ item.price ? formatMoney(item.price, 2) : '--' }}</span>
      </button>
      <div v-if="candidateMessage && !candidates.length" class="candidate-empty">
        {{ candidateMessage }}
      </div>
      <div v-else-if="candidateMessage" class="candidate-note">
        {{ candidateMessage }}
      </div>
    </div>

    <div v-if="selectedCode" class="institutional-result">
      <div class="institutional-result-head">
        <div>
          <span>個股法人查詢</span>
          <strong>
            {{ selectedCode }}
            {{ selectedInstitutional?.name || selectedTrend[0]?.name || '' }}
          </strong>
        </div>
        <button class="btn xs" type="button" @click="openQuote({ code: selectedCode })">
          看報價
        </button>
      </div>
      <div v-if="selectedLoading" class="institutional-result-loading">法人資料載入中</div>
      <div v-else class="institutional-result-grid">
        <div>
          <span>外資</span>
          <strong :class="moveClass(selectedInstitutional?.foreign).replace('is-', '')">
            {{ selectedInstitutional ? formatSigned(selectedInstitutional.foreign, 0, '張') : '--' }}
          </strong>
        </div>
        <div>
          <span>投信</span>
          <strong :class="moveClass(selectedInstitutional?.trust).replace('is-', '')">
            {{ selectedInstitutional ? formatSigned(selectedInstitutional.trust, 0, '張') : '--' }}
          </strong>
        </div>
        <div>
          <span>自營商</span>
          <strong :class="moveClass(selectedInstitutional?.dealer).replace('is-', '')">
            {{ selectedInstitutional ? formatSigned(selectedInstitutional.dealer, 0, '張') : '--' }}
          </strong>
        </div>
        <div>
          <span>合計</span>
          <strong :class="moveClass(selectedInstitutional?.total).replace('is-', '')">
            {{ selectedInstitutional ? formatSigned(selectedInstitutional.total, 0, '張') : '--' }}
          </strong>
        </div>
        <div>
          <span>訊號</span>
          <strong>{{ selectedSignal }}</strong>
        </div>
      </div>
      <div v-if="selectedTrendSummary.some(item => item.count)" class="institutional-window-grid">
        <div v-for="item in selectedTrendSummary" :key="item.days">
          <span>近 {{ item.days }} 日</span>
          <strong :class="moveClass(item.total).replace('is-', '')">
            {{ item.count ? formatSigned(item.total, 0, '張') : '--' }}
          </strong>
          <em>{{ item.count }} 筆資料</em>
        </div>
      </div>
      <div v-if="selectedTrendChartRows.length" class="institutional-trend-panel">
        <div class="institutional-trend-head">
          <div>
            <span>法人買賣超趨勢</span>
            <strong>近 {{ selectedTrendChartRows.length }} 日合計買賣超</strong>
          </div>
          <SourceBadge source="HiStock 法人明細" />
        </div>
        <div class="institutional-streak-grid">
          <div v-for="item in selectedStreaks" :key="item.key" :class="item.direction">
            <span>{{ item.label }}</span>
            <strong>{{ item.text }}</strong>
          </div>
        </div>
        <div class="institutional-relation-panel">
          <div class="institutional-relation-head">
            <div>
              <span>法人與股價關係圖</span>
              <strong>
                {{
                  relationStats
                    ? `${relationStats.flowDirection} ${formatSigned(relationStats.totalFlow, 0, '張')} / 股價 ${formatSigned(relationStats.priceChange, 2, '%')}`
                    : '等待資料'
                }}
              </strong>
            </div>
            <SourceBadge
              :source="priceRelationLoading ? 'Yahoo Chart' : priceRelationError || 'Yahoo 日 K + HiStock 法人明細'"
              :label="priceRelationLoading ? '股價載入中' : priceRelationError || 'Yahoo 日 K + HiStock 法人明細'"
              :type="priceRelationError ? 'unknown' : 'chart'"
            />
          </div>
          <div v-if="priceRelationLoading" class="institutional-relation-empty">股價關係圖載入中...</div>
          <div v-else-if="relationChartRows.length" class="institutional-relation-chart">
            <svg class="institutional-price-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path v-if="relationAreaPath" :d="relationAreaPath" class="price-area"></path>
              <path v-if="relationPath" :d="relationPath" class="price-line"></path>
            </svg>
            <div class="institutional-flow-layer">
              <div
                v-for="row in relationChartRows"
                :key="`relation-${row.date}`"
                class="institutional-flow-col"
                :title="`${row.date} 收盤 ${formatMoney(row.close, 2)} / 法人 ${formatSigned(row.total, 0, '張')}`"
              >
                <div class="flow-zero-line"></div>
                <i
                  :class="row.barClass"
                  :style="{ height: row.barHeight }"
                ></i>
                <span>{{ row.shortDate }}</span>
              </div>
            </div>
          </div>
          <div v-else class="institutional-relation-empty">
            {{ priceRelationError || '尚無可對齊的股價與法人資料' }}
          </div>
        </div>
        <div class="institutional-bar-chart">
          <div v-for="row in selectedTrendChartRows" :key="row.date" class="institutional-bar-col">
            <div class="institutional-bar-area positive">
              <i
                v-if="Number(row.total || 0) > 0"
                :style="{ height: barHeight(row.total) }"
                :title="`${row.date} 合計 ${formatSigned(row.total, 0, '張')}`"
              ></i>
            </div>
            <div class="institutional-bar-area negative">
              <i
                v-if="Number(row.total || 0) < 0"
                :style="{ height: barHeight(row.total) }"
                :title="`${row.date} 合計 ${formatSigned(row.total, 0, '張')}`"
              ></i>
            </div>
            <span>{{ shortDate(row.date) }}</span>
          </div>
        </div>
        <div class="institutional-trend-table">
          <div class="institutional-trend-table-row head">
            <span>日期</span>
            <span>外資</span>
            <span>投信</span>
            <span>自營商</span>
            <span>合計</span>
          </div>
          <div v-for="row in selectedTrend.slice(0, 10)" :key="`detail-${row.date}`" class="institutional-trend-table-row">
            <span>{{ row.date }}</span>
            <span :class="moveClass(row.foreign).replace('is-', '')">{{ formatSigned(row.foreign, 0, '張') }}</span>
            <span :class="moveClass(row.trust).replace('is-', '')">{{ formatSigned(row.trust, 0, '張') }}</span>
            <span :class="moveClass(row.dealer).replace('is-', '')">{{ formatSigned(row.dealer, 0, '張') }}</span>
            <span :class="moveClass(row.total).replace('is-', '')">{{ formatSigned(row.total, 0, '張') }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="inst-overview">
      <div class="inst-overview-card foreign">
        <div class="inst-ov-label">外資及陸資</div>
        <div class="inst-ov-val" :class="moveClass(institutionalStore.summary.foreign).replace('is-', '')">
          {{ formatSigned(institutionalStore.summary.foreign, 2, '億') }}
        </div>
        <div class="inst-ov-sub">今日淨買超</div>
        <div class="inst-ov-bars">
          <div class="mini-bar-row">
            <span class="mini-bar-label">買</span>
            <div class="mini-bar-track"><div class="mini-bar-fill buy" :style="{ width: `${percent(institutionalStore.summary.foreign)}%` }"></div></div>
            <span class="mini-bar-pct buy">{{ percent(institutionalStore.summary.foreign) }}%</span>
          </div>
          <div class="mini-bar-row">
            <span class="mini-bar-label">賣</span>
            <div class="mini-bar-track"><div class="mini-bar-fill sell" :style="{ width: `${percent(institutionalStore.summary.foreign, false)}%` }"></div></div>
            <span class="mini-bar-pct sell">{{ percent(institutionalStore.summary.foreign, false) }}%</span>
          </div>
        </div>
      </div>

      <div class="inst-overview-card trust">
        <div class="inst-ov-label">投信</div>
        <div class="inst-ov-val" :class="moveClass(institutionalStore.summary.trust).replace('is-', '')">
          {{ formatSigned(institutionalStore.summary.trust, 2, '億') }}
        </div>
        <div class="inst-ov-sub">今日淨買超</div>
        <div class="inst-ov-bars">
          <div class="mini-bar-row">
            <span class="mini-bar-label">買</span>
            <div class="mini-bar-track"><div class="mini-bar-fill buy" :style="{ width: `${percent(institutionalStore.summary.trust)}%` }"></div></div>
            <span class="mini-bar-pct buy">{{ percent(institutionalStore.summary.trust) }}%</span>
          </div>
          <div class="mini-bar-row">
            <span class="mini-bar-label">賣</span>
            <div class="mini-bar-track"><div class="mini-bar-fill sell" :style="{ width: `${percent(institutionalStore.summary.trust, false)}%` }"></div></div>
            <span class="mini-bar-pct sell">{{ percent(institutionalStore.summary.trust, false) }}%</span>
          </div>
        </div>
      </div>

      <div class="inst-overview-card dealer">
        <div class="inst-ov-label">自營商</div>
        <div class="inst-ov-val" :class="moveClass(institutionalStore.summary.dealer).replace('is-', '')">
          {{ formatSigned(institutionalStore.summary.dealer, 2, '億') }}
        </div>
        <div class="inst-ov-sub">今日淨買超</div>
        <div class="inst-ov-bars">
          <div class="mini-bar-row">
            <span class="mini-bar-label">買</span>
            <div class="mini-bar-track"><div class="mini-bar-fill buy" :style="{ width: `${percent(institutionalStore.summary.dealer)}%` }"></div></div>
            <span class="mini-bar-pct buy">{{ percent(institutionalStore.summary.dealer) }}%</span>
          </div>
          <div class="mini-bar-row">
            <span class="mini-bar-label">賣</span>
            <div class="mini-bar-track"><div class="mini-bar-fill sell" :style="{ width: `${percent(institutionalStore.summary.dealer, false)}%` }"></div></div>
            <span class="mini-bar-pct sell">{{ percent(institutionalStore.summary.dealer, false) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section-title" style="margin-top:1.5rem">法人重點布局個股</div>
    <div class="table-hint">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      點擊股票名稱可以看即時報價與走勢圖
    </div>

    <div class="table-wrapper">
      <table class="stock-table">
        <thead>
          <tr>
            <th>代號</th>
            <th>名稱</th>
            <th>外資(張)</th>
            <th>投信(張)</th>
            <th>自營商(張)</th>
            <th>合計(張)</th>
            <th>連續買超</th>
            <th>訊號</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pagedRows" :key="row.code">
            <td>{{ row.code }}</td>
            <td>
              <button class="stock-link" type="button" @click="openQuote(row)">{{ row.name }}</button>
            </td>
            <td :class="moveClass(row.foreign).replace('is-', '')">{{ formatSigned(row.foreign, 0, '張') }}</td>
            <td :class="moveClass(row.trust).replace('is-', '')">{{ formatSigned(row.trust, 0, '張') }}</td>
            <td :class="moveClass(row.dealer).replace('is-', '')">{{ formatSigned(row.dealer, 0, '張') }}</td>
            <td :class="moveClass(row.total).replace('is-', '')">{{ formatSigned(row.total, 0, '張') }}</td>
            <td>當日</td>
            <td>
              <span class="direction-pill" :class="row.total > 0 ? 'buy' : row.total < 0 ? 'sell' : 'neutral'">
                {{ row.total > 0 ? '買超' : row.total < 0 ? '賣超' : '混合' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalRows" class="pagination-bar">
      <div class="pagination-info">
        顯示第 {{ pageStart }}-{{ pageEnd }} 筆，共 {{ totalRows }} 筆
      </div>
      <div class="pagination-controls">
        <button class="btn xs" type="button" :disabled="currentPage === 1" @click="setPage(currentPage - 1)">
          上一頁
        </button>
        <button
          v-for="page in visiblePages"
          :key="page"
          class="btn xs page-btn"
          :class="{ active: page === currentPage }"
          type="button"
          @click="setPage(page)"
        >
          {{ page }}
        </button>
        <button class="btn xs" type="button" :disabled="currentPage === totalPages" @click="setPage(currentPage + 1)">
          下一頁
        </button>
      </div>
    </div>

    <div class="table-footer">
      <button class="btn" type="button" @click="showAi = true">
        <IconSparkles class="btn-icon" :stroke-width="2" />
        AI解讀法人動向
      </button>
      <div v-if="showAi" class="ai-pick-result">
        <div class="ai-box-header">
          <IconSparkles class="inline-icon" :stroke-width="2" />
          AI 法人解讀
        </div>
        <div class="ai-content">
          三大法人合計 {{ formatSigned(institutionalStore.total, 2, '億') }}。若買超集中在大型權值股，通常有助於指數穩定；若賣超擴散，需降低追價風險。
        </div>
      </div>
    </div>
  </section>
</template>
