<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IconAlertTriangle,
  IconBrain,
  IconLayoutDashboard,
  IconReportAnalytics,
  IconSearch,
  IconShieldCheck
} from '@tabler/icons-vue';
import { fetchFundamentalSnapshotPhased } from '../api/fundamentalApi';
import DataStatusGrid from '../components/DataStatusGrid.vue';
import StockChart from '../components/StockChart.vue';
import TechnicalSummary from '../components/TechnicalSummary.vue';
import { useChartStore } from '../stores/chartStore';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { useStockStore } from '../stores/stockStore';
import { formatMoney, formatNumber, formatPct, formatSigned, moveClass } from '../utils/formatters';
import { quickStocks } from '../utils/stockMeta';

const stockStore = useStockStore();
const chartStore = useChartStore();
const institutionalStore = useInstitutionalStore();
const router = useRouter();

const query = ref(stockStore.currentStock?.code || chartStore.stock?.code || stockStore.activeCode || '');
const error = ref('');
const snapshot = ref(null);
const candidates = ref([]);
const showCandidates = ref(false);
const loadStatus = ref(createLoadStatus());
const candidateLimit = 20;
const stockCodePattern = /^\d{4,6}[a-z]?$/i;
let candidateTimer = null;
let searchRunId = 0;

const stock = computed(() => stockStore.currentStock);
const isBusy = computed(() => Object.values(loadStatus.value).some(item => item.status === 'loading'));
const inst = computed(() => {
  const code = stock.value?.code;
  if (!code) return null;
  return institutionalStore.byCode[code] || institutionalStore.rows.find(row => row.code === code) || null;
});
const instTrend = computed(() => {
  const code = stock.value?.code;
  if (!code) return [];
  return institutionalStore.trendByCode[code] || [];
});
const loadingSteps = computed(() => {
  const code = stock.value?.code;
  const chartReady = code && chartStore.stock?.code === code && chartStore.candles.length > 0;
  const chartLoading = code && chartStore.stock?.code === code && chartStore.loading;
  const institutionalLoading = code && (
    institutionalStore.codeLoading[code] ||
    institutionalStore.trendLoading[code]
  );

  return [
    normalizeStep('quote', {
      key: 'quote',
      label: '報價',
      status: stock.value?.price ? 'done' : 'idle',
      message: stock.value?.price ? '報價完成' : '待查詢',
      source: sourceText(stock.value?.source || 'TWSE MIS')
    }),
    normalizeStep('chart', {
      key: 'chart',
      label: '走勢',
      status: chartLoading ? 'loading' : chartStore.error ? 'error' : chartReady ? 'done' : 'idle',
      message: chartLoading ? '走勢載入中' : chartStore.error || (chartReady ? '走勢完成' : '待查詢'),
      source: 'Yahoo Chart'
    }),
    normalizeStep('institutional', {
      key: 'institutional',
      label: '法人',
      status: institutionalLoading ? 'loading' : inst.value || instTrend.value.length ? 'done' : 'idle',
      message: institutionalLoading ? '法人載入中' : inst.value || instTrend.value.length ? '法人完成' : '待查詢',
      source: inst.value?.source === 'histock' ? 'HiStock / TWSE' : 'TWSE OpenAPI'
    }),
    normalizeStep('fundamental', {
      key: 'fundamental',
      label: '基本面',
      status: snapshot.value?.isPartial ? 'loading' : snapshot.value ? 'done' : 'idle',
      message: snapshot.value?.isPartial ? stageText(snapshot.value.loadingStage) : snapshot.value ? '基本面完成' : '待查詢',
      source: snapshot.value?.source || 'TWSE OpenAPI / FinMind'
    })
  ];
});
const priceTone = computed(() => moveClass(stock.value?.chgPct).replace('is-', ''));
const dominantForce = computed(() => {
  const buy = Number(stock.value?.buyPct || 0);
  const sell = Number(stock.value?.sellPct || 0);
  if (buy >= 65) return { label: '買入主導', type: 'up' };
  if (sell >= 65) return { label: '賣出主導', type: 'down' };
  return { label: '多空均衡', type: 'neutral' };
});
const executiveSummary = computed(() => buildExecutiveSummary(stock.value, snapshot.value, inst.value, instTrendSummary.value));
const riskChecks = computed(() => buildRiskChecks(stock.value, snapshot.value, inst.value));
const instTrendSummary = computed(() => [5, 10, 20].map(days => summarizeInstitutionalTrend(instTrend.value, days)));
const summaryMetrics = computed(() => snapshot.value?.metrics?.slice(0, 4) || []);
const summarySignals = computed(() => {
  const revenue = snapshot.value?.revenueTrend;
  const valuation = snapshot.value?.valuationHistory;
  const dividend = snapshot.value?.dividendStability;

  return [
    {
      label: '營收動能',
      value: revenue?.available ? revenue.label : '待查',
      detail: revenue?.available ? `YoY ${pct(revenue.latestYoy, 2)}` : '到基本面頁查看月營收趨勢',
      status: revenue?.available ? Number(revenue.latestYoy || 0) >= 0 ? 'good' : 'risk' : 'pending'
    },
    {
      label: '估值水位',
      value: valuation?.available && Number.isFinite(valuation.pe?.percentile) ? `${valuation.pe.percentile}%` : '待查',
      detail: valuation?.available ? '本益比近一年百分位' : '到基本面頁查看歷史區間',
      status: valuation?.available && valuation.pe?.percentile <= 35 ? 'good' : valuation?.available && valuation.pe?.percentile >= 75 ? 'risk' : 'watch'
    },
    {
      label: '股利穩定',
      value: dividend?.available ? dividend.label : '待查',
      detail: dividend?.available ? `連續配息 ${dividend.consecutiveYears} 年` : '到基本面頁查看股利紀錄',
      status: dividend?.tone === 'good' ? 'good' : dividend?.tone === 'risk' ? 'risk' : dividend?.available ? 'watch' : 'pending'
    }
  ];
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
  const initialCode = stock.value?.code || chartStore.stock?.code || stockStore.activeCode || query.value;
  if (initialCode) runSearch(String(initialCode).trim().toUpperCase());
});

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
  error.value = '';
  snapshot.value = null;
  showCandidates.value = false;
  loadStatus.value = createLoadStatus('quote');

  try {
    setLoadStatus('quote', 'loading', '取得即時報價');
    const nextStock = await stockStore.searchStock(code);
    if (runId !== searchRunId) return;
    query.value = nextStock.code;
    setLoadStatus('quote', 'done', '報價完成');

    setLoadStatus('chart', 'loading', '載入 K 線與成交量');
    setLoadStatus('institutional', 'loading', '載入法人與籌碼趨勢');
    setLoadStatus('fundamental', 'loading', '載入財務與估值資料');

    const chartTask = chartStore.openStock(nextStock)
      .then(() => setLoadStatus('chart', 'done', '走勢完成'))
      .catch(err => setLoadStatus('chart', 'error', err?.message || '走勢取得失敗'));

    const institutionalTask = loadInstitutional(nextStock.code)
      .then(() => setLoadStatus('institutional', 'done', '法人完成'))
      .catch(err => setLoadStatus('institutional', 'error', err?.message || '法人取得失敗'));

    const fundamentalTask = fetchFundamentalSnapshotPhased(nextStock, nextSnapshot => {
      if (runId === searchRunId) {
        snapshot.value = nextSnapshot;
        setLoadStatus('fundamental', 'loading', stageText(nextSnapshot?.loadingStage));
      }
    })
      .then(() => {
        setLoadStatus('fundamental', 'done', '基本面完成');
      })
      .catch(err => setLoadStatus('fundamental', 'error', err?.message || '基本面取得失敗'));

    await Promise.allSettled([chartTask, institutionalTask, fundamentalTask]);
    if (runId === searchRunId) syncLoadStatusFromData();
  } catch (err) {
    if (runId === searchRunId) {
      error.value = err?.message || '分析資料取得失敗';
      setLoadStatus('quote', 'error', error.value);
    }
  }
}

async function loadInstitutional(code) {
  if (!institutionalStore.loaded) await institutionalStore.loadInstitutional({ silent: true });
  await institutionalStore.loadInstitutionalTrendByCode(code);
}

function quickSearch(code) {
  query.value = code;
  submit(code);
}

function openFundamental() {
  if (!stock.value?.code) return;
  router.push({ path: '/fundamental', query: { code: stock.value.code } });
}

function selectCandidate(item) {
  runSearch(item.code);
}

function createLoadStatus(activeKey = '') {
  return {
    quote: { status: activeKey === 'quote' ? 'loading' : 'idle', message: activeKey === 'quote' ? '等待報價' : '待查詢' },
    chart: { status: 'idle', message: '待查詢' },
    institutional: { status: 'idle', message: '待查詢' },
    fundamental: { status: 'idle', message: '待查詢' }
  };
}

function setLoadStatus(key, status, message) {
  loadStatus.value = {
    ...loadStatus.value,
    [key]: { status, message }
  };
}

function normalizeStep(key, actual) {
  const flow = loadStatus.value[key] || {};
  if (flow.status === 'loading' || flow.status === 'error') {
    return {
      ...actual,
      ...flow,
      source: actual.source
    };
  }
  if (flow.status === 'done' && actual.status === 'idle') {
    return {
      ...actual,
      ...flow,
      source: actual.source
    };
  }
  return actual;
}

function syncLoadStatusFromData() {
  if (stock.value?.price && loadStatus.value.quote.status !== 'error') {
    setLoadStatus('quote', 'done', '報價完成');
  }
  if (chartStore.stock?.code === stock.value?.code && chartStore.candles.length && loadStatus.value.chart.status !== 'error') {
    setLoadStatus('chart', 'done', '走勢完成');
  }
  if ((inst.value || instTrend.value.length) && loadStatus.value.institutional.status !== 'error') {
    setLoadStatus('institutional', 'done', '法人完成');
  }
  if (snapshot.value && !snapshot.value.isPartial && loadStatus.value.fundamental.status !== 'error') {
    setLoadStatus('fundamental', 'done', '基本面完成');
  }
}

function stageText(stage) {
  if (stage === 'quote') return '報價完成，整理基本資料';
  if (stage === 'overview') return '財務指標載入中';
  if (stage === 'statements') return '三大財報載入中';
  return '基本面資料載入中';
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function pct(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number > 0 ? '+' : ''}${formatNumber(number, digits)}%` : '--';
}

function sourceText(value) {
  return String(value || '').replace('twse-mis', 'TWSE MIS').replace('histock', 'HiStock').replace('yahoo', 'Yahoo');
}

function statusText(status) {
  if (status === 'good') return '良好';
  if (status === 'watch') return '觀察';
  if (status === 'neutral') return '中性';
  if (status === 'risk') return '風險';
  if (status === 'pending') return '待接';
  return status || '待查';
}

function summarizeInstitutionalTrend(rows, days) {
  const sample = rows.slice(0, days);
  const sum = sample.reduce((acc, row) => ({
    foreign: acc.foreign + Number(row.foreign || 0),
    trust: acc.trust + Number(row.trust || 0),
    dealer: acc.dealer + Number(row.dealer || 0),
    total: acc.total + Number(row.total || 0)
  }), { foreign: 0, trust: 0, dealer: 0, total: 0 });
  return { days, count: sample.length, ...sum };
}

function buildExecutiveSummary(current, fundamental, institutional, trendSummary) {
  if (!current) return [];
  const rows = [
    `${current.code} ${current.name || ''} 目前股價 ${formatMoney(current.price, 2)}，漲跌 ${formatPct(current.chgPct)}。`
  ];
  if (institutional) rows.push(`單日法人合計 ${formatSigned(institutional.total || 0, 0, '張')}，外資 ${formatSigned(institutional.foreign || 0, 0, '張')}、投信 ${formatSigned(institutional.trust || 0, 0, '張')}、自營商 ${formatSigned(institutional.dealer || 0, 0, '張')}。`);
  const fiveDay = trendSummary?.[0];
  if (fiveDay?.count) rows.push(`近 ${fiveDay.count} 日法人累計 ${formatSigned(fiveDay.total, 0, '張')}，用來判斷籌碼是否延續。`);
  if (fundamental) rows.push(`基本面評分 ${fundamental.score} 分，資料完整度 ${fundamental.dataCompleteness}%，結論：${fundamental.verdict}`);
  return rows;
}

function buildRiskChecks(current, fundamental, institutional) {
  if (!current) return [];
  const sellPct = Number(current.sellPct || 0);
  const chgPct = Number(current.chgPct || 0);
  const volRatio = Number(current.volRatio || 0);
  const score = Number(fundamental?.score || 0);
  const instTotal = Number(institutional?.total || 0);

  return [
    {
      label: '賣壓',
      value: sellPct >= 65 ? '偏高' : '可控',
      detail: `賣出占比 ${Math.round(sellPct)}%`,
      status: sellPct >= 65 ? 'risk' : 'good'
    },
    {
      label: '量價',
      value: volRatio >= 100 ? '量增' : volRatio > 0 ? '量縮' : '待資料',
      detail: volRatio ? `量比 ${pct(volRatio)}` : '等待成交量資料',
      status: chgPct < 0 && volRatio >= 100 ? 'risk' : 'watch'
    },
    {
      label: '法人',
      value: instTotal < 0 ? '賣超' : instTotal > 0 ? '買超' : '中性',
      detail: institutional ? `合計 ${formatSigned(instTotal, 0, '張')}` : '尚未取得',
      status: instTotal < 0 ? 'risk' : instTotal > 0 ? 'good' : 'neutral'
    },
    {
      label: '基本面',
      value: fundamental ? fundamental.scoreLabel : '載入中',
      detail: fundamental ? `評分 ${score} / 完整度 ${fundamental.dataCompleteness}%` : '等待財務資料',
      status: !fundamental ? 'pending' : score >= 80 ? 'good' : score >= 60 ? 'watch' : 'risk'
    }
  ];
}

</script>

<template>
  <section class="tab-content active complete-analysis-view">
    <div class="page-title">
      <IconLayoutDashboard class="title-icon" :stroke-width="2" />
      個股完整分析
    </div>

    <div class="search-row complete-search">
      <input
        v-model="query"
        class="search-input"
        placeholder="輸入股票代號或名稱，例如：2330 或 台積電"
        @keyup.enter="submit()"
      />
      <button class="btn primary" type="button" :disabled="isBusy" @click="submit()">
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

    <div v-if="showCandidates" class="search-candidates complete-candidates">
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

    <div v-if="!stock && !error" class="empty-state complete-empty">
      <IconReportAnalytics class="title-icon" :stroke-width="2" />
      <div>輸入股票後開始完整分析</div>
      <span class="hint">會依序載入報價、走勢、法人籌碼與基本面資料。</span>
    </div>

    <template v-if="stock">
      <div class="complete-mobile-tape" :class="priceTone">
        <div>
          <strong>{{ stock.code }} {{ stock.name || '' }}</strong>
          <span>{{ stock.sector || '未分類' }}</span>
        </div>
        <div>
          <strong>{{ formatMoney(stock.price, 2) }}</strong>
          <span>{{ formatPct(stock.chgPct) }}</span>
        </div>
      </div>

      <DataStatusGrid :items="loadingSteps" />

      <div class="complete-hero">
        <div class="complete-company">
          <div class="complete-code">{{ stock.code }}</div>
          <div class="complete-name">{{ stock.name || stock.code }}</div>
          <span class="sector-pill">{{ stock.sector || '未分類' }}</span>
          <span class="source-badge">來源：{{ sourceText(stock.source || 'TWSE MIS') }}</span>
        </div>
        <div class="complete-price">
          <span>股價</span>
          <strong>{{ formatMoney(stock.price, 2) }}</strong>
          <em :class="priceTone">{{ formatPct(stock.chgPct) }}</em>
        </div>
        <div class="complete-force">
          <span>買賣力道</span>
          <strong>{{ dominantForce.label }}</strong>
          <div class="complete-force-bars">
            <div><span>買入 {{ Math.round(stock.buyPct) }}%</span><i :style="{ width: `${stock.buyPct}%` }" class="buy"></i></div>
            <div><span>賣出 {{ Math.round(stock.sellPct) }}%</span><i :style="{ width: `${stock.sellPct}%` }" class="sell"></i></div>
          </div>
        </div>
        <div class="complete-score">
          <span>基本面</span>
          <strong>{{ snapshot?.score ?? '--' }}</strong>
          <em>{{ snapshot?.scoreLabel || loadStatus.fundamental.message || '待查詢' }}</em>
        </div>
      </div>

      <div class="complete-grid">
        <div class="complete-panel wide">
          <div class="panel-title">
            <IconBrain class="inline-icon" :stroke-width="2" />
            分析摘要
          </div>
          <ol class="complete-summary-list">
            <li v-for="item in executiveSummary" :key="item">{{ item }}</li>
          </ol>
        </div>

        <div class="complete-panel">
          <div class="panel-title">
            <IconAlertTriangle class="inline-icon" :stroke-width="2" />
            風險檢查
          </div>
          <div class="risk-check-grid">
            <div v-for="item in riskChecks" :key="item.label" class="risk-check" :class="item.status">
              <div>{{ item.label }}</div>
              <strong>{{ item.value }}</strong>
              <span>{{ item.detail }}</span>
            </div>
          </div>
        </div>

        <div class="complete-panel wide">
          <TechnicalSummary
            compact
            :candles="chartStore.candles"
            :interval="chartStore.interval"
            :loading="chartStore.loading"
          />
          <div class="source-row">
            <span class="source-badge">來源：Yahoo Chart</span>
            <span class="source-badge">計算：本機技術指標</span>
          </div>
          <div class="chart-frame complete-chart-frame">
            <div v-if="chartStore.loading" class="chart-loading">
              <div class="spinner"></div>
              <span>走勢圖載入中...</span>
            </div>
            <div v-else-if="chartStore.error" class="chart-error">{{ chartStore.error }}</div>
            <StockChart
              v-else
              :candles="chartStore.candles"
              :interval="chartStore.interval"
              :loading="chartStore.loading"
              :error="chartStore.error"
            />
          </div>
        </div>

        <div class="complete-panel">
          <div class="panel-title">
            <IconShieldCheck class="inline-icon" :stroke-width="2" />
            籌碼趨勢
          </div>
          <div class="source-row">
            <span class="source-badge">來源：HiStock / TWSE</span>
          </div>
          <div class="inst-cards complete-inst">
            <div class="inst-card">
              <div class="inst-info">
                <div class="inst-name">外資</div>
                <div class="inst-val" :class="moveClass(inst?.foreign).replace('is-', '')">
                  {{ inst ? formatSigned(inst.foreign || 0, 0, '張') : '--' }}
                </div>
              </div>
            </div>
            <div class="inst-card">
              <div class="inst-info">
                <div class="inst-name">投信</div>
                <div class="inst-val" :class="moveClass(inst?.trust).replace('is-', '')">
                  {{ inst ? formatSigned(inst.trust || 0, 0, '張') : '--' }}
                </div>
              </div>
            </div>
            <div class="inst-card">
              <div class="inst-info">
                <div class="inst-name">自營商</div>
                <div class="inst-val" :class="moveClass(inst?.dealer).replace('is-', '')">
                  {{ inst ? formatSigned(inst.dealer || 0, 0, '張') : '--' }}
                </div>
              </div>
            </div>
          </div>
          <div class="trend-window-grid">
            <div v-for="item in instTrendSummary" :key="item.days" class="trend-window">
              <span>近 {{ item.days }} 日</span>
              <strong :class="moveClass(item.total).replace('is-', '')">{{ formatSigned(item.total, 0, '張') }}</strong>
              <em>外 {{ formatSigned(item.foreign, 0, '張') }} / 投 {{ formatSigned(item.trust, 0, '張') }} / 自 {{ formatSigned(item.dealer, 0, '張') }}</em>
            </div>
          </div>
        </div>

        <div class="complete-panel wide">
          <div class="panel-title-row compact-panel-title-row">
            <div class="panel-title">
              <IconReportAnalytics class="inline-icon" :stroke-width="2" />
              基本面摘要
            </div>
            <button class="btn xs" type="button" @click="openFundamental">
              查看完整基本面
            </button>
          </div>
          <div class="source-row">
            <span class="source-badge">來源：{{ snapshot?.source || 'TWSE OpenAPI / FinMind' }}</span>
            <span class="source-badge">完整度：{{ snapshot ? `${snapshot.dataCompleteness}%` : '--' }}</span>
          </div>
          <div v-if="snapshot" class="complete-fundamental-summary">
            <div class="fundamental-score-summary" :class="snapshot.score >= 75 ? 'good' : snapshot.score >= 55 ? 'watch' : 'risk'">
              <span>長期體質評分</span>
              <strong>{{ snapshot.score ?? '--' }}</strong>
              <em>{{ snapshot.scoreLabel || snapshot.verdict }}</em>
            </div>
            <div>
              <span>結論</span>
              <p>{{ snapshot.verdict }}</p>
            </div>
          </div>
          <div v-if="snapshot" class="complete-fundamental-grid">
            <div v-for="item in snapshot.highlights" :key="item.label" class="fundamental-card">
              <div class="fundamental-card-label">{{ item.label }}</div>
              <div class="fundamental-card-value">{{ item.value }}</div>
              <div class="fundamental-card-detail">{{ item.detail }}</div>
            </div>
          </div>
          <div v-if="snapshot" class="complete-metric-strip compact">
            <div v-for="metric in summaryMetrics" :key="metric.label" class="complete-metric" :class="metric.status">
              <span>{{ metric.label }}</span>
              <strong>{{ metric.value }}</strong>
              <em>{{ statusText(metric.status) }}</em>
            </div>
          </div>
          <div v-if="snapshot" class="complete-metric-strip compact">
            <div v-for="item in summarySignals" :key="item.label" class="complete-metric" :class="item.status">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <em>{{ item.detail }}</em>
            </div>
          </div>
          <div v-else class="hint">{{ loadStatus.fundamental.message }}</div>
        </div>

        <div class="complete-panel">
          <div class="panel-title">資料可信度</div>
          <div class="data-source-list">
            <div><span>即時報價</span><strong>{{ sourceText(stock.source || 'TWSE MIS') }}</strong></div>
            <div><span>走勢圖</span><strong>Yahoo Chart</strong></div>
            <div><span>法人籌碼</span><strong>{{ inst?.source === 'histock' ? 'HiStock' : 'TWSE OpenAPI' }}</strong></div>
            <div><span>基本面</span><strong>{{ snapshot?.source || 'TWSE OpenAPI / FinMind' }}</strong></div>
            <div><span>技術指標</span><strong>本機由 K 線計算</strong></div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
