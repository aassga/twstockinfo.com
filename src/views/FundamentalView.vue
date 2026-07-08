<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  IconBrain,
  IconChartBar,
  IconClipboardData,
  IconInfoCircle,
  IconReportAnalytics,
  IconSearch,
  IconShieldCheck,
  IconTable
} from '@tabler/icons-vue';
import { fetchFundamentalSnapshotPhased } from '../api/fundamentalApi';
import { useStockStore } from '../stores/stockStore';
import { formatDateTime, formatMoney, formatPct, formatVolume, moveClass } from '../utils/formatters';
import { quickStocks } from '../utils/stockMeta';

const stockStore = useStockStore();
const route = useRoute();
const query = ref(stockStore.currentStock?.code || stockStore.activeCode || '');
const snapshot = ref(null);
const loading = ref(false);
const error = ref('');
const activeTab = ref('overview');
const candidates = ref([]);
const showCandidates = ref(false);
const candidateLimit = 20;
const stockCodePattern = /^\d{4,6}[a-z]?$/i;
let candidateTimer = null;
let searchRunId = 0;

const tabs = [
  { key: 'overview', label: '總覽', icon: IconReportAnalytics },
  { key: 'metrics', label: '財務指標', icon: IconChartBar },
  { key: 'statements', label: '三大財報', icon: IconTable },
  { key: 'qualitative', label: '質化分析', icon: IconShieldCheck },
  { key: 'ai', label: 'AI 長期觀點', icon: IconBrain }
];

const company = computed(() => snapshot.value?.company || null);
const changeClass = computed(() => moveClass(company.value?.chgPct).replace('is-', ''));
const revenueTrend = computed(() => snapshot.value?.revenueTrend || null);
const revenueTrendMax = computed(() => {
  const values = revenueTrend.value?.rows?.map(row => Number(row.revenue || 0)).filter(Number.isFinite) || [];
  return values.length ? Math.max(...values) : 0;
});
const valuationHistory = computed(() => snapshot.value?.valuationHistory || null);
const dividendStability = computed(() => snapshot.value?.dividendStability || null);
const dividendMax = computed(() => {
  const values = dividendStability.value?.rows?.map(row => Number(row.cashDividend || 0)).filter(Number.isFinite) || [];
  return values.length ? Math.max(...values) : 0;
});
const eventCalendar = computed(() => snapshot.value?.eventCalendar || []);
const scoreModel = computed(() => snapshot.value?.scoreModel || null);
const loadingStageText = computed(() => {
  if (!loading.value || !snapshot.value?.isPartial) return '';
  const stage = snapshot.value.loadingStage;
  if (stage === 'quote') return '即時報價已載入，正在取得估值與營收資料...';
  if (stage === 'overview') return '估值與營收已載入，正在取得三大財報與現金流...';
  if (stage === 'statements') return '三大財報已載入，正在補齊治理、股利與總體資料...';
  return '資料載入中...';
});

watch(query, value => {
  clearTimeout(candidateTimer);
  const input = String(value || '').trim();
  if (!input || stockCodePattern.test(input)) {
    candidates.value = [];
    showCandidates.value = false;
    return;
  }

  candidateTimer = setTimeout(async () => {
    const rows = await stockStore.findStockCandidates(input, candidateLimit).catch(() => []);
    candidates.value = rows;
    showCandidates.value = rows.length > 0;
  }, 180);
});

onMounted(() => {
  const routeCode = normalizeRouteCode(route.query.code);
  const initialCode = routeCode || stockStore.currentStock?.code || stockStore.activeCode || query.value;
  if (initialCode) runSearch(String(initialCode).trim().toUpperCase());
});

watch(
  () => route.query.code,
  code => {
    const normalized = normalizeRouteCode(code);
    if (normalized && normalized !== query.value) runSearch(normalized);
  }
);

async function submit(value = query.value) {
  const input = String(value || '').trim();
  if (!input) return;

  if (!stockCodePattern.test(input)) {
    const rows = await stockStore.findStockCandidates(input, candidateLimit).catch(() => []);
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
  showCandidates.value = false;

  try {
    const stock = await stockStore.searchStock(code);
    if (runId !== searchRunId) return;
    query.value = stock.code;
    activeTab.value = 'overview';
    snapshot.value = null;
    await fetchFundamentalSnapshotPhased(stock, nextSnapshot => {
      if (runId !== searchRunId) return;
      snapshot.value = nextSnapshot;
    });
  } catch (err) {
    if (runId !== searchRunId) return;
    error.value = err?.message || '基本面資料讀取失敗';
  } finally {
    if (runId === searchRunId) loading.value = false;
  }
}

function selectCandidate(stock) {
  runSearch(stock.code);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeRouteCode(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return String(text || '').trim().toUpperCase();
}

function quickSearch(code) {
  query.value = code;
  submit(code);
}

function statusText(status) {
  if (status === 'good') return '良好';
  if (status === 'watch') return '觀察';
  if (status === 'neutral') return '中性';
  if (status === 'risk') return '留意';
  if (status === 'pending') return '待接';
  return status || '待補';
}

function pct(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number > 0 ? '+' : ''}${number.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%` : '--';
}

function formatRevenueAmount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) return '--';
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}億`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toLocaleString('zh-TW', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}萬`;
  return number.toLocaleString('zh-TW');
}

function revenueBarWidth(row) {
  const max = Number(revenueTrendMax.value || 0);
  const value = Number(row?.revenue || 0);
  if (!max || !value) return '4%';
  return `${Math.max(6, Math.round((value / max) * 100))}%`;
}

function revenueTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'neutral';
  return number > 0 ? 'up' : 'down';
}

function valuationWidth(metric) {
  const min = Number(metric?.min || 0);
  const max = Number(metric?.max || 0);
  const current = Number(metric?.current || 0);
  if (!min || !max || max <= min || !current) return '50%';
  return `${Math.min(100, Math.max(0, Math.round(((current - min) / (max - min)) * 100)))}%`;
}

function valuationDisplay(metric, digits = 2) {
  const value = Number(metric?.current || 0);
  return Number.isFinite(value) && value ? value.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }) : '--';
}

function dividendBarWidth(row) {
  const max = Number(dividendMax.value || 0);
  const value = Number(row?.cashDividend || 0);
  if (!max || !value) return '4%';
  return `${Math.max(6, Math.round((value / max) * 100))}%`;
}

function eventStatusText(status) {
  return status === 'upcoming' ? '即將' : '最近';
}
</script>

<template>
  <section class="tab-content active fundamental-view">
    <div class="page-title">
      <IconReportAnalytics class="title-icon" :stroke-width="2" />
      基本面分析
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
      <button
        v-for="item in quickStocks"
        :key="item.code"
        class="quick-btn"
        type="button"
        @click="quickSearch(item.code)"
      >
        {{ item.name }} {{ item.code }}
      </button>
    </div>

    <div v-if="showCandidates" class="search-candidates fundamental-candidates">
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
    </div>

    <div v-if="error" class="empty-state volume-empty-state">{{ error }}</div>

    <div v-if="!snapshot && !error" class="empty-state fundamental-empty">
      <IconClipboardData class="title-icon" :stroke-width="2" />
      <div>輸入股票後建立基本面研究框架</div>
      <span class="hint">包含總體經濟、產業前景、公司治理、三大財報與 AI 長期觀點。</span>
    </div>

    <template v-if="snapshot">
      <div class="fundamental-hero">
        <div class="fundamental-company">
          <div class="fundamental-code">{{ company.code }}</div>
          <div class="fundamental-name">{{ company.name || company.code }}</div>
          <span class="sector-pill">{{ company.sector || '產業待補' }}</span>
        </div>

        <div class="fundamental-price">
          <div>{{ formatMoney(company.price, 2) }}</div>
          <span :class="changeClass">{{ formatPct(company.chgPct) }}</span>
        </div>

        <div class="fundamental-score">
          <div class="score-value">{{ snapshot.score ?? '--' }}</div>
          <div class="score-label">{{ snapshot.scoreLabel }}</div>
          <div class="score-meter">
            <div class="score-meter-fill" :style="{ width: `${snapshot.dataCompleteness}%` }"></div>
          </div>
          <span>資料完整度 {{ snapshot.dataCompleteness }}%</span>
        </div>
      </div>

      <div class="table-hint">
        <IconInfoCircle class="inline-icon" :stroke-width="2" />
        基本面頁面偏長期投資判斷；即時價量訊號仍建議回到股票搜尋或前100熱門觀察。
      </div>

      <div v-if="loadingStageText" class="table-hint fundamental-loading-hint">
        <IconInfoCircle class="inline-icon" :stroke-width="2" />
        {{ loadingStageText }}
      </div>

      <div class="fundamental-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="fundamental-tab"
          :class="{ active: activeTab === tab.key }"
          type="button"
          @click="activeTab = tab.key"
        >
          <component :is="tab.icon" class="inline-icon" :stroke-width="2" />
          {{ tab.label }}
        </button>
      </div>

      <div v-if="activeTab === 'overview'" class="fundamental-panel">
        <div class="fundamental-verdict">{{ snapshot.verdict }}</div>
        <div class="fundamental-card-grid">
          <div v-for="item in snapshot.highlights" :key="item.label" class="fundamental-card">
            <div class="fundamental-card-label">{{ item.label }}</div>
            <div class="fundamental-card-value">{{ item.value }}</div>
            <div class="fundamental-card-detail">{{ item.detail }}</div>
          </div>
        </div>
        <div class="fundamental-card-grid compact">
          <div class="fundamental-card">
            <div class="fundamental-card-label">成交量</div>
            <div class="fundamental-card-value">{{ formatVolume(company.volume) }}</div>
            <div class="fundamental-card-detail">即時行情</div>
          </div>
          <div class="fundamental-card">
            <div class="fundamental-card-label">更新時間</div>
            <div class="fundamental-card-value">{{ formatDateTime(snapshot.updatedAt) }}</div>
            <div class="fundamental-card-detail">本機整理時間</div>
          </div>
        </div>
        <div v-if="scoreModel" class="score-model-grid fundamental-score-model">
          <div v-for="item in scoreModel.items" :key="item.label" class="score-model-row" :class="item.status">
            <div>
              <span>{{ item.label }}</span>
              <strong>{{ item.score }} / {{ item.max }}</strong>
            </div>
            <div class="score-model-track">
              <i :style="{ width: `${item.pct}%` }"></i>
            </div>
            <em>{{ item.detail }}</em>
          </div>
        </div>
        <div v-if="eventCalendar.length" class="event-calendar-list fundamental-event-calendar">
          <div v-for="item in eventCalendar" :key="`${item.date}-${item.title}`" class="event-calendar-item" :class="item.status">
            <div>
              <span>{{ item.date }}</span>
              <strong>{{ item.title }}</strong>
            </div>
            <em>{{ item.detail }}</em>
            <small>{{ eventStatusText(item.status) }} · {{ item.source }}</small>
          </div>
        </div>
        <div v-if="revenueTrend?.available" class="revenue-trend fundamental-revenue-trend">
          <div class="revenue-trend-summary">
            <div class="revenue-trend-card" :class="revenueTrend.tone">
              <span>最新月營收</span>
              <strong>{{ formatRevenueAmount(revenueTrend.latestRevenue) }}</strong>
              <em>{{ revenueTrend.latestMonth }}</em>
            </div>
            <div class="revenue-trend-card" :class="revenueTone(revenueTrend.latestYoy)">
              <span>YoY</span>
              <strong>{{ pct(revenueTrend.latestYoy, 2) }}</strong>
              <em>去年同月</em>
            </div>
            <div class="revenue-trend-card" :class="revenueTone(revenueTrend.latestMom)">
              <span>MoM</span>
              <strong>{{ pct(revenueTrend.latestMom, 2) }}</strong>
              <em>上月比較</em>
            </div>
            <div class="revenue-trend-card" :class="revenueTrend.tone">
              <span>動能</span>
              <strong>{{ revenueTrend.label }}</strong>
              <em>連續正成長 {{ revenueTrend.positiveStreak }} 個月</em>
            </div>
          </div>
          <div class="revenue-bars">
            <div v-for="row in revenueTrend.rows" :key="row.month" class="revenue-bar-row">
              <span>{{ row.month }}</span>
              <div class="revenue-bar-track">
                <i :class="revenueTone(row.yoy)" :style="{ width: revenueBarWidth(row) }"></i>
              </div>
              <strong :class="revenueTone(row.yoy)">{{ pct(row.yoy, 1) }}</strong>
            </div>
          </div>
        </div>
        <div v-if="valuationHistory?.available" class="valuation-range-list fundamental-valuation-range">
          <div
            v-for="metric in [valuationHistory.pe, valuationHistory.pb, valuationHistory.dividendYield]"
            :key="metric.label"
            class="valuation-range-row"
          >
            <div>
              <span>{{ metric.label }}</span>
              <strong>{{ valuationDisplay(metric) }}{{ metric.label === '殖利率' ? '%' : '' }}</strong>
            </div>
            <div class="valuation-range-track">
              <i :style="{ left: valuationWidth(metric) }"></i>
            </div>
            <em>低 {{ valuationDisplay({ current: metric.min }) }} / 均 {{ valuationDisplay({ current: metric.avg }) }} / 高 {{ valuationDisplay({ current: metric.max }) }}</em>
            <small>近一年百分位 {{ Number.isFinite(metric.percentile) ? `${metric.percentile}%` : '--' }}</small>
          </div>
        </div>
        <div v-if="dividendStability?.available" class="dividend-stability fundamental-dividend-stability">
          <div class="dividend-main-card" :class="dividendStability.tone">
            <span>{{ dividendStability.label }}</span>
            <strong>{{ valuationDisplay({ current: dividendStability.latestCashDividend }) }} 元</strong>
            <em>連續配息 {{ dividendStability.consecutiveYears }} 年 / 近 5 年平均 {{ valuationDisplay({ current: dividendStability.avg5CashDividend }) }} 元</em>
          </div>
          <div class="dividend-bars">
            <div v-for="row in dividendStability.rows" :key="row.year" class="dividend-bar-row">
              <span>{{ row.year }}</span>
              <div class="dividend-bar-track">
                <i :style="{ width: dividendBarWidth(row) }"></i>
              </div>
              <strong>{{ valuationDisplay({ current: row.cashDividend }) }}</strong>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'metrics'" class="fundamental-panel">
        <div class="fundamental-metric-grid">
          <div v-for="metric in snapshot.metrics" :key="metric.label" class="fundamental-metric">
            <div class="metric-head">
              <span>{{ metric.label }}</span>
              <span class="status-pill" :class="metric.status">{{ statusText(metric.status) }}</span>
            </div>
            <div class="metric-value">{{ metric.value }}</div>
            <div class="metric-meaning">{{ metric.meaning }}</div>
            <div class="metric-rule">{{ metric.rule }}</div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'statements'" class="fundamental-panel">
        <div class="statement-grid">
          <div v-for="section in snapshot.statements" :key="section.title" class="statement-card">
            <div class="statement-title">{{ section.title }}</div>
            <div v-for="row in section.rows" :key="row.label" class="statement-row">
              <div>
                <span>{{ row.label }}</span>
                <small>{{ row.note }}</small>
              </div>
              <span class="statement-value">{{ row.value }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'qualitative'" class="fundamental-panel">
        <div class="qualitative-list">
          <div v-for="item in snapshot.qualitative" :key="item.title" class="qualitative-item">
            <div class="qualitative-title">
              <span>{{ item.title }}</span>
              <span class="status-pill">{{ item.status }}</span>
            </div>
            <p>{{ item.body }}</p>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'ai'" class="fundamental-panel">
        <div class="ai-full-box">
          <div class="ai-box-header">
            <IconBrain class="inline-icon" :stroke-width="2" />
            AI 長期投資檢核
          </div>
          <div class="ai-content">
            <ol>
              <li v-for="item in snapshot.aiConclusion" :key="item">{{ item }}</li>
            </ol>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
