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
import SourceBadge from '../components/SourceBadge.vue';
import StockChart from '../components/StockChart.vue';
import TechnicalSummary from '../components/TechnicalSummary.vue';
import { useChartStore } from '../stores/chartStore';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { useStockStore } from '../stores/stockStore';
import { formatMoney, formatNumber, formatPct, formatSigned, moveClass } from '../utils/formatters';
import { buildStockRiskChecks } from '../utils/riskSignals';
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
const analysisSections = [
  { key: 'quote', label: '報價' },
  { key: 'risk', label: '風險' },
  { key: 'events', label: '事件' },
  { key: 'technical', label: '技術' },
  { key: 'chips', label: '籌碼' },
  { key: 'fundamental', label: '基本面' }
];
let candidateTimer = null;
let searchRunId = 0;

const stock = computed(() => stockStore.currentStock);
const tradeFlow = computed(() => stock.value?.tradeFlow || null);
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
  if (buy >= 65) return { label: tradeFlow.value?.reliable ? '外盤主導' : '買入主導', type: 'up' };
  if (sell >= 65) return { label: tradeFlow.value?.reliable ? '內盤主導' : '賣出主導', type: 'down' };
  return { label: '多空均衡', type: 'neutral' };
});
const executiveSummary = computed(() => buildExecutiveSummary(stock.value, snapshot.value, inst.value, instTrendSummary.value));
const riskChecks = computed(() => buildStockRiskChecks({
  current: stock.value,
  fundamental: snapshot.value,
  institutional: inst.value,
  institutionalTrend: instTrend.value,
  candles: chartStore.candles,
  interval: chartStore.interval
}));
const instTrendSummary = computed(() => [5, 10, 20].map(days => summarizeInstitutionalTrend(instTrend.value, days)));
const eventItems = computed(() => snapshot.value?.eventCalendar?.slice(0, 6) || []);
const eventCoverage = computed(() => snapshot.value?.eventCoverage || []);
const timelineGroups = computed(() => groupTimelineItems(buildEventTimeline({
  candles: chartStore.candles,
  institutionalRows: instTrend.value,
  eventRows: snapshot.value?.eventCalendar || [],
  marginRows: snapshot.value?.marginTrading?.recentRows || [],
  revenueTrend: snapshot.value?.revenueTrend,
  financialTrends: snapshot.value?.financialTrends
})).slice(0, 12));
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

function scrollToSection(key) {
  document.getElementById(`analysis-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

function eventTypeText(type) {
  if (type === 'major') return '重大訊息';
  if (type === 'news') return '新聞';
  if (type === 'dividend') return '除權息';
  if (type === 'disclosure') return '公告';
  if (type === 'attention') return '注意股';
  if (type === 'disposition') return '處置股';
  if (type === 'revenue') return '月營收';
  if (type === 'financial') return '財報';
  if (type === 'valuation') return '估值';
  if (type === 'margin') return '信用';
  return '事件';
}

function eventTone(type) {
  if (type === 'major' || type === 'disposition') return 'risk';
  if (type === 'attention' || type === 'financial' || type === 'margin') return 'watch';
  if (type === 'dividend') return 'good';
  return 'neutral';
}

function openEventLink(link) {
  if (!link) return;
  window.open(link, '_blank', 'noopener,noreferrer');
}

function buildEventTimeline({ candles = [], institutionalRows = [], eventRows = [], marginRows = [], revenueTrend = null, financialTrends = null }) {
  const items = [
    ...buildPriceMoveTimeline(candles),
    ...buildInstitutionalTimeline(institutionalRows),
    ...buildMarginTimeline(marginRows),
    ...buildKnownEventTimeline(eventRows),
    ...buildRevenueTimeline(revenueTrend),
    ...buildFinancialTimeline(financialTrends)
  ];

  const seen = new Set();
  return items
    .filter(item => item.date && item.title)
    .sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare) return dateCompare;
      return timelinePriority(a.category) - timelinePriority(b.category);
    })
    .filter(item => {
      const key = `${item.date}:${item.category}:${item.title}:${item.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildPriceMoveTimeline(candles = []) {
  const dailyRows = candles
    .map(normalizeTimelineCandle)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);

  return dailyRows
    .map((row, index) => {
      const previous = dailyRows[index - 1];
      const reference = previous?.close || row.open;
      const changePct = reference ? ((row.close - reference) / reference) * 100 : 0;
      if (!Number.isFinite(changePct) || Math.abs(changePct) < 3) return null;
      return {
        date: row.date,
        category: 'price',
        tone: changePct >= 0 ? 'up' : 'down',
        title: changePct >= 0 ? '股價大漲' : '股價大跌',
        detail: `收盤 ${formatMoney(row.close, 2)}，漲跌 ${formatSigned(changePct, 2, '%')}，成交量 ${formatNumber(row.volume || 0, 0)}`,
        source: 'Yahoo Chart'
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(parseTimelinePct(b.detail)) - Math.abs(parseTimelinePct(a.detail)))
    .slice(0, 10);
}

function buildInstitutionalTimeline(rows = []) {
  return rows
    .filter(row => row?.date)
    .map(row => {
      const total = Number(row.total || 0);
      if (!Number.isFinite(total) || Math.abs(total) < 100) return null;
      return {
        date: normalizeTimelineDate(row.date),
        category: 'institutional',
        tone: total >= 0 ? 'up' : 'down',
        title: total >= 0 ? '法人買超' : '法人賣超',
        detail: `合計 ${formatSigned(total, 0, '張')}，外資 ${formatSigned(row.foreign || 0, 0, '張')}，投信 ${formatSigned(row.trust || 0, 0, '張')}，自營商 ${formatSigned(row.dealer || 0, 0, '張')}`,
        source: row.source === 'histock' ? 'HiStock / TWSE' : 'TWSE / HiStock'
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function buildMarginTimeline(rows = []) {
  return rows
    .filter(row => row?.date)
    .map(row => {
      const marginChange = Number(row.marginChange || 0);
      const shortChange = Number(row.shortChange || 0);
      const hasSignal = Math.abs(marginChange) >= 100 || Math.abs(shortChange) >= 50 || Number(row.dayTradingRatio || 0) >= 20;
      if (!hasSignal) return null;
      return {
        date: normalizeTimelineDate(row.date),
        category: 'margin',
        tone: marginChange > 0 || shortChange > 0 ? 'watch' : 'neutral',
        title: '信用交易變化',
        detail: `融資 ${formatSigned(marginChange, 0, '張')}，融券 ${formatSigned(shortChange, 0, '張')}，當沖比 ${pct(row.dayTradingRatio, 2)}`,
        source: 'FinMind Margin / DayTrading'
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function buildKnownEventTimeline(rows = []) {
  return rows.map(row => ({
    date: normalizeTimelineDate(row.date),
    category: row.type || 'event',
    tone: eventTone(row.type),
    title: row.title,
    detail: row.detail || '',
    source: row.source || '',
    link: row.link,
    linkLabel: row.linkLabel
  }));
}

function buildRevenueTimeline(revenueTrend) {
  if (!revenueTrend?.latestMonth) return [];
  return [{
    date: `${String(revenueTrend.latestMonth).replace('/', '-')}-01`,
    category: 'revenue',
    tone: Number(revenueTrend.latestYoy || 0) >= 0 ? 'up' : 'down',
    title: '月營收公告',
    detail: `YoY ${pct(revenueTrend.latestYoy, 2)}，近 3 月平均 ${pct(revenueTrend.avg3Yoy, 2)}`,
    source: revenueTrend.source || 'FinMind TaiwanStockMonthRevenue',
    link: 'https://mops.twse.com.tw/mops/web/t05st10_ifrs',
    linkLabel: '查詢來源'
  }];
}

function buildFinancialTimeline(financialTrends) {
  const latest = financialTrends?.rows?.[0] || financialTrends?.latest;
  if (!latest?.date) return [];
  const eps = Number(latest.eps ?? latest.basicEps);
  const roe = Number(latest.roe);
  return [{
    date: normalizeTimelineDate(latest.date),
    category: 'financial',
    tone: Number.isFinite(eps) && eps > 0 ? 'neutral' : 'watch',
    title: '財報資料更新',
    detail: `EPS ${Number.isFinite(eps) ? formatNumber(eps, 2) : '--'}，ROE ${Number.isFinite(roe) ? pct(roe, 2) : '--'}`,
    source: 'FinMind / TWSE OpenAPI',
    link: 'https://mops.twse.com.tw/mops/web/t163sb04',
    linkLabel: '查詢來源'
  }];
}

function groupTimelineItems(items = []) {
  const groups = [];
  const byDate = new Map();
  items.forEach(item => {
    const date = normalizeTimelineDate(item.date);
    if (!date) return;
    if (!byDate.has(date)) {
      const group = { date, items: [] };
      byDate.set(date, group);
      groups.push(group);
    }
    byDate.get(date).items.push(item);
  });
  return groups.sort((a, b) => b.date.localeCompare(a.date));
}

function normalizeTimelineCandle(row) {
  const time = Number(row?.time || row?.date || 0);
  const date = normalizeTimelineDate(row?.date) || normalizeTimelineTime(time);
  const open = Number(row?.open);
  const high = Number(row?.high);
  const low = Number(row?.low);
  const close = Number(row?.close);
  if (!date || ![open, high, low, close].every(Number.isFinite)) return null;
  return {
    date,
    time: Number.isFinite(time) && time > 0 ? time : new Date(date).getTime(),
    open,
    high,
    low,
    close,
    volume: Number(row?.volume || 0)
  };
}

function normalizeTimelineDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) return text.replace(/\//g, '-');
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (/^\d{4}\/\d{2}$/.test(text)) return `${text.replace('/', '-')}-01`;
  return normalizeTimelineTime(Number(value || 0));
}

function normalizeTimelineTime(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function timelineCategoryText(category) {
  if (category === 'price') return '股價';
  if (category === 'institutional') return '法人';
  if (category === 'margin') return '融資';
  if (category === 'news') return '新聞';
  if (category === 'major') return '重大訊息';
  if (category === 'revenue') return '月營收';
  if (category === 'financial') return '財報';
  if (category === 'dividend') return '除權息';
  if (category === 'attention') return '注意股';
  if (category === 'disposition') return '處置股';
  return eventTypeText(category);
}

function timelinePriority(category) {
  const order = ['price', 'major', 'news', 'institutional', 'margin', 'revenue', 'financial', 'dividend', 'attention', 'disposition'];
  const index = order.indexOf(category);
  return index >= 0 ? index : 99;
}

function parseTimelinePct(text) {
  const match = String(text || '').match(/[-+]?\d+(?:\.\d+)?%/);
  return match ? Number(match[0].replace('%', '')) : 0;
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
  if (current.tradeFlow?.reliable) {
    rows.push(`成交快照內外盤：外盤 ${Math.round(current.tradeFlow.activeBuyPct || 0)}%、內盤 ${Math.round(current.tradeFlow.activeSellPct || 0)}%，已累積 ${formatNumber(current.tradeFlow.totalLots || 0, 0)} 張可觀察成交。`);
  }
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
      label: current.tradeFlow?.reliable ? '內盤' : '賣壓',
      value: sellPct >= 65 ? '偏高' : '可控',
      detail: `${current.tradeFlow?.reliable ? '內盤占比' : '賣出占比'} ${Math.round(sellPct)}%`,
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
    <div class="page-purpose">
      一次整理單檔股票的報價、技術、籌碼、基本面、事件與風險，適合用來做買賣前檢查與事後回看。
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

      <div class="analysis-section-nav">
        <button
          v-for="item in analysisSections"
          :key="item.key"
          class="quick-btn"
          type="button"
          @click="scrollToSection(item.key)"
        >
          {{ item.label }}
        </button>
      </div>

      <div id="analysis-quote" class="complete-section-anchor"></div>
      <div class="analysis-section-heading">
        <span>報價</span>
        <em>現在價格、漲跌與即時買賣力道</em>
      </div>
      <div class="complete-hero">
        <div class="complete-company">
          <div class="complete-code">{{ stock.code }}</div>
          <div class="complete-name">{{ stock.name || stock.code }}</div>
          <span class="sector-pill">{{ stock.sector || '未分類' }}</span>
          <SourceBadge :source="stock.source || 'TWSE MIS'" />
        </div>
        <div class="complete-price">
          <span>股價</span>
          <strong>{{ formatMoney(stock.price, 2) }}</strong>
          <em :class="priceTone">{{ formatPct(stock.chgPct) }}</em>
        </div>
        <div class="complete-force">
          <span>{{ tradeFlow?.reliable ? '內外盤力道' : '買賣力道' }}</span>
          <strong>{{ dominantForce.label }}</strong>
          <div class="complete-force-bars">
            <div><span>{{ tradeFlow?.reliable ? '外盤' : '買入' }} {{ Math.round(stock.buyPct) }}%</span><i :style="{ width: `${stock.buyPct}%` }" class="buy"></i></div>
            <div><span>{{ tradeFlow?.reliable ? '內盤' : '賣出' }} {{ Math.round(stock.sellPct) }}%</span><i :style="{ width: `${stock.sellPct}%` }" class="sell"></i></div>
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

        <div id="analysis-risk" class="complete-section-anchor"></div>
        <div class="analysis-section-heading">
          <span>風險</span>
          <em>先看是否有賣壓、量價、法人與基本面警訊</em>
        </div>
        <div class="complete-panel">
          <div class="panel-title">
            <IconAlertTriangle class="inline-icon" :stroke-width="2" />
            風險檢查
          </div>
          <div class="risk-check-grid">
            <div v-for="item in riskChecks" :key="item.label" class="risk-check" :class="item.status">
              <div class="risk-check-head">
                <div>{{ item.label }}</div>
                <em>{{ statusText(item.status) }}</em>
              </div>
              <strong>{{ item.value }}</strong>
              <span>{{ item.detail }}</span>
            </div>
          </div>
        </div>

        <div id="analysis-events" class="complete-section-anchor"></div>
        <div class="analysis-section-heading">
          <span>事件</span>
          <em>把股價異動、籌碼、融資與新聞放回同一條時間線</em>
        </div>
        <div class="complete-panel timeline-panel wide">
          <div class="panel-title">
            <IconAlertTriangle class="inline-icon" :stroke-width="2" />
            個股事件時間線
          </div>
          <div class="timeline-subtitle">
            整合股價大漲跌、法人變化、融資變化、新聞 / 重大訊息與財報 / 月營收，協助回看「為什麼漲跌」。
          </div>
          <div v-if="timelineGroups.length" class="stock-event-timeline">
            <div v-for="group in timelineGroups" :key="group.date" class="timeline-day">
              <div class="timeline-date">
                <strong>{{ group.date }}</strong>
                <span>{{ group.items.length }} 則</span>
              </div>
              <div class="timeline-events">
                <article
                  v-for="item in group.items"
                  :key="`${group.date}-${item.category}-${item.title}-${item.detail}`"
                  class="timeline-event"
                  :class="item.tone"
                >
                  <div class="timeline-event-head">
                    <span class="timeline-category">{{ timelineCategoryText(item.category) }}</span>
                    <strong>{{ item.title }}</strong>
                  </div>
                  <p>{{ item.detail }}</p>
                  <div class="timeline-event-meta">
                    <SourceBadge :source="item.source || '資料來源待補'" />
                    <button v-if="item.link" class="btn xs event-link-btn" type="button" @click="openEventLink(item.link)">
                      {{ item.linkLabel || '查看原文' }}
                    </button>
                  </div>
                </article>
              </div>
            </div>
          </div>
          <div v-else class="hint">{{ loadStatus.fundamental.status === 'loading' ? '事件時間線載入中' : '目前沒有可顯示的事件時間線。' }}</div>
          <div v-if="eventCoverage.length" class="event-coverage-grid">
            <span v-for="item in eventCoverage" :key="item.label" :class="item.status">
              {{ item.label }}
            </span>
          </div>
        </div>

        <div id="analysis-technical" class="complete-section-anchor"></div>
        <div class="analysis-section-heading">
          <span>技術</span>
          <em>K 線、成交量與技術指標摘要</em>
        </div>
        <div class="complete-panel wide">
          <TechnicalSummary
            compact
            :candles="chartStore.candles"
            :interval="chartStore.interval"
            :loading="chartStore.loading"
          />
          <div class="source-row">
            <SourceBadge source="Yahoo Chart" />
            <SourceBadge source="本機技術指標" label="本機技術指標（推估）" type="computed" />
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

        <div id="analysis-chips" class="complete-section-anchor"></div>
        <div class="analysis-section-heading">
          <span>籌碼</span>
          <em>法人買賣超與近 5 / 10 / 20 日趨勢</em>
        </div>
        <div class="complete-panel">
          <div class="panel-title">
            <IconShieldCheck class="inline-icon" :stroke-width="2" />
            籌碼趨勢
          </div>
          <div class="source-row">
            <SourceBadge source="HiStock / TWSE" />
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

        <div id="analysis-fundamental" class="complete-section-anchor"></div>
        <div class="analysis-section-heading">
          <span>基本面</span>
          <em>估值、營收、股利與長期體質摘要</em>
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
            <SourceBadge :source="snapshot?.source || 'TWSE OpenAPI / FinMind'" />
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
            <div><span>即時報價</span><SourceBadge :source="stock.source || 'TWSE MIS'" /></div>
            <div><span>走勢圖</span><SourceBadge source="Yahoo Chart" /></div>
            <div><span>法人籌碼</span><SourceBadge :source="inst?.source === 'histock' ? 'HiStock / TWSE' : 'TWSE OpenAPI'" /></div>
            <div><span>基本面</span><SourceBadge :source="snapshot?.source || 'TWSE OpenAPI / FinMind'" /></div>
            <div><span>新聞事件</span><SourceBadge source="MOPS / TWSE / TPEX / FinMind" /></div>
            <div><span>技術指標</span><SourceBadge source="本機由 K 線計算" label="本機由 K 線計算（推估）" type="computed" /></div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
