<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
import { stockApi } from '../api/stockApi';
import { fetchFundamentalSnapshotPhased, fetchIndustryPeerStocks } from '../api/fundamentalApi';
import SourceBadge from '../components/SourceBadge.vue';
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
const peerRows = ref([]);
const peerSnapshots = ref([]);
const peerLoading = ref(false);
const peerLoaded = ref(false);
const peerStage = ref('idle');
const currentMarketStock = ref(null);
const candidateLimit = 20;
const stockCodePattern = /^\d{4,6}[a-z]?$/i;
let candidateTimer = null;
let candidateRequestId = 0;
let searchRunId = 0;

const tabs = [
  { key: 'overview', label: '總覽', icon: IconReportAnalytics },
  { key: 'metrics', label: '財務指標', icon: IconChartBar },
  { key: 'statements', label: '三大財報', icon: IconTable },
  { key: 'peers', label: '同業比較', icon: IconChartBar },
  { key: 'events', label: '事件 / 股利', icon: IconClipboardData },
  { key: 'qualitative', label: '質化分析', icon: IconShieldCheck },
  { key: 'ai', label: 'AI 長期觀點', icon: IconBrain }
];

const company = computed(() => snapshot.value?.company || null);
const changeClass = computed(() => moveClass(company.value?.chgPct).replace('is-', ''));
const revenueTrend = computed(() => snapshot.value?.revenueTrend || null);
const financialTrends = computed(() => snapshot.value?.financialTrends || null);
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
const peerComparison = computed(() => {
  const result = buildPeerComparison(comparisonStock.value, peerRows.value, snapshot.value, peerSnapshots.value);
  return result && (result.count || result.peerFundamentalCount) ? result : null;
});
const peerRankingRows = computed(() => buildPeerRankingRows(comparisonStock.value, peerRows.value, snapshot.value, peerSnapshots.value));
const peerStrengthRows = computed(() => buildPeerStrengthRows(comparisonStock.value, peerRows.value, snapshot.value, peerSnapshots.value));
const comparisonStock = computed(() => {
  const code = company.value?.code || stockStore.currentStock?.code || currentMarketStock.value?.code;
  const listMarket = (stockStore.allStocks || []).find(row => String(row.code) === String(code));
  return {
    ...(company.value || {}),
    ...(listMarket || {}),
    ...(String(stockStore.currentStock?.code) === String(code) ? stockStore.currentStock : {}),
    ...(String(currentMarketStock.value?.code) === String(code) ? currentMarketStock.value : {})
  };
});
const peerStatusText = computed(() => {
  if (peerStage.value === 'industry') return '正在取得官方同業清單...';
  if (peerStage.value === 'fundamental') return '同業行情已載入，正在補同業基本面...';
  if (peerStage.value === 'empty') return '同產業樣本不足';
  return peerLoading.value ? '同業比較載入中...' : '';
});
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

onMounted(() => {
  document.addEventListener('pointerdown', handleCandidateOutsideClick, true);
  const routeCode = normalizeRouteCode(route.query.code);
  const initialCode = routeCode || stockStore.currentStock?.code || stockStore.activeCode || query.value;
  if (initialCode) runSearch(String(initialCode).trim().toUpperCase());
});

onBeforeUnmount(() => {
  clearTimeout(candidateTimer);
  document.removeEventListener('pointerdown', handleCandidateOutsideClick, true);
});

watch(
  () => route.query.code,
  code => {
    const normalized = normalizeRouteCode(code);
    if (normalized && normalized !== query.value) runSearch(normalized);
  }
);

watch(activeTab, tab => {
  if (tab !== 'peers' || !snapshot.value || peerLoaded.value || peerLoading.value) return;
  void loadPeerFundamentals(company.value, searchRunId);
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
  closeCandidates();

  try {
    const stock = await stockStore.searchStock(code);
    if (runId !== searchRunId) return;
    currentMarketStock.value = stock;
    query.value = stock.code;
    activeTab.value = 'overview';
    snapshot.value = null;
    peerRows.value = [];
    peerSnapshots.value = [];
    peerLoading.value = false;
    peerLoaded.value = false;
    peerStage.value = 'idle';
    const finalSnapshot = await fetchFundamentalSnapshotPhased(stock, nextSnapshot => {
      if (runId !== searchRunId) return;
      snapshot.value = nextSnapshot;
    });
    if (runId !== searchRunId) return;
    snapshot.value = finalSnapshot;
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

async function loadPeerFundamentals(current, runId) {
  const sector = current?.sector || current?.industry;
  peerLoading.value = true;
  peerStage.value = 'industry';
  peerLoaded.value = false;
  const officialPeers = await fetchIndustryPeerStocks(current, stockStore.allStocks, 8).catch(() => []);
  if (runId !== searchRunId) return;
  const peers = officialPeers.length
    ? officialPeers.slice(0, 6)
    : (stockStore.allStocks || [])
      .filter(row => row?.code !== current?.code && (row?.sector === sector || row?.industry === sector))
      .sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0))
      .slice(0, 6);

  if (!sector || !peers.length) {
    peerRows.value = [];
    peerSnapshots.value = [];
    peerLoaded.value = true;
    peerStage.value = 'empty';
    peerLoading.value = false;
    return;
  }

  peerRows.value = peers;
  const hydratedMarketRows = await hydratePeerMarketRows([comparisonStock.value, ...peers]);
  if (runId !== searchRunId) return;
  const hydratedCurrent = hydratedMarketRows.find(row => String(row.code) === String(current?.code));
  if (hydratedCurrent) currentMarketStock.value = hydratedCurrent;
  const hydratedPeers = hydratedMarketRows.filter(row => String(row.code) !== String(current?.code));
  peerRows.value = hydratedPeers;
  peerStage.value = 'fundamental';
  try {
    const results = await Promise.allSettled(hydratedPeers.map(peer => fetchFundamentalSnapshotPhased(peer, () => {})));
    if (runId !== searchRunId) return;
    peerSnapshots.value = results
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => result.value);
    peerLoaded.value = true;
    peerStage.value = 'done';
  } finally {
    if (runId === searchRunId) peerLoading.value = false;
  }
}

async function hydratePeerMarketRows(rows) {
  const sourceByCode = new Map();
  (rows || []).filter(row => row?.code).forEach(row => sourceByCode.set(String(row.code), row));
  const sourceRows = [...sourceByCode.values()];
  if (!sourceRows.length) return [];
  const codes = sourceRows.map(row => row.code);
  const quotedRows = await stockStore.refreshStocksByCodes(codes).catch(() => []);
  const allByCode = new Map((stockStore.allStocks || []).map(row => [String(row.code), row]));
  quotedRows.forEach(row => allByCode.set(String(row.code), row));

  const mergedRows = sourceRows.map(row => {
    const market = allByCode.get(String(row.code)) || {};
    return stockStore.enrichStock({
      ...row,
      ...market,
      code: row.code,
      name: market.name || row.name,
      sector: row.sector || market.sector,
      industry: row.industry || market.industry
    });
  });

  const needVolumeRatio = mergedRows.filter(row => !Number(row.volRatio || 0) && Number(row.volume || 0) > 0);
  if (!needVolumeRatio.length) return mergedRows;

  const ratioRows = await stockApi.volumeRatios(needVolumeRatio).catch(() => []);
  if (!ratioRows.length) return mergedRows;

  const ratioByCode = new Map(ratioRows.map(row => [String(row.code), row]));
  return mergedRows.map(row => ratioByCode.has(String(row.code))
    ? stockStore.enrichStock({ ...row, ...ratioByCode.get(String(row.code)) })
    : row);
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

function plainPct(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '--';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('zh-TW', {
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

function fillStatusClass(status) {
  if (status === 'filled') return 'good';
  if (status === 'partial' || status === 'upcoming') return 'watch';
  if (status === 'notFilled') return 'risk';
  return 'neutral';
}

function financialBarWidth(row, key, fallbackMax = 1) {
  const value = Math.abs(Number(row?.[key] || 0));
  const max = Math.max(Number(fallbackMax || 1), 1);
  if (!value) return '4%';
  return `${Math.max(5, Math.min(100, Math.round((value / max) * 100)))}%`;
}

function financialTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'neutral';
  return number > 0 ? 'good' : 'risk';
}

function formatTrendAmount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) return '--';
  const abs = Math.abs(number);
  const sign = number > 0 ? '+' : '-';
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}億`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 1 })}萬`;
  return `${sign}${abs.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`;
}

function eventStatusText(status) {
  return status === 'upcoming' ? '即將' : '最近';
}

function eventTypeText(type) {
  if (type === 'major') return '重大訊息';
  if (type === 'news') return '新聞';
  if (type === 'dividend') return '除權息';
  if (type === 'disclosure') return '公告';
  if (type === 'attention') return '注意股';
  if (type === 'disposition') return '處置股';
  if (type === 'revenue') return '月營收';
  if (type === 'valuation') return '估值';
  if (type === 'margin') return '信用';
  if (type === 'financial') return '財報';
  return '事件';
}

function eventTypeClass(type) {
  if (type === 'major') return 'risk';
  if (type === 'attention') return 'watch';
  if (type === 'disposition') return 'risk';
  if (type === 'news') return 'neutral';
  if (type === 'dividend') return 'good';
  if (type === 'margin') return 'watch';
  if (type === 'financial') return 'watch';
  return 'neutral';
}

function openEventLink(link) {
  if (!link) return;
  window.open(link, '_blank', 'noopener,noreferrer');
}

function buildPeerComparison(current, allStocks, currentSnapshot, snapshots) {
  if (!current) return null;
  const sector = current.sector || current.industry || '同產業';
  const stockRows = (allStocks || [])
    .filter(row => row?.code !== current.code)
    .slice(0, 50);
  const snapshotRows = (snapshots || []).map(item => item.company).filter(Boolean);
  const marketRows = stockRows.length ? stockRows : snapshotRows;
  const fundamentalRows = snapshots || [];

  return {
    sector,
    count: marketRows.length,
    peerFundamentalCount: fundamentalRows.length,
    stockChangePct: marketMetric(current.chgPct),
    avgChangePct: average(marketRows.map(row => marketMetric(row.chgPct))),
    stockVolRatio: marketMetric(current.volRatio),
    avgVolRatio: average(marketRows.map(row => marketMetric(row.volRatio))),
    stockBuyPct: marketMetric(current.buyPct),
    avgBuyPct: average(marketRows.map(row => marketMetric(row.buyPct))),
    currentPe: highlightValue(currentSnapshot, '本益比'),
    avgPeerPe: average(fundamentalRows.map(item => highlightValue(item, '本益比'))),
    currentRoe: metricValue(currentSnapshot, '年化 ROE'),
    avgPeerRoe: average(fundamentalRows.map(item => metricValue(item, '年化 ROE'))),
    currentYield: highlightValue(currentSnapshot, '殖利率'),
    avgPeerYield: average(fundamentalRows.map(item => highlightValue(item, '殖利率'))),
    currentRevenueYoy: metricValue(currentSnapshot, '月營收 YoY'),
    avgPeerRevenueYoy: average(fundamentalRows.map(item => metricValue(item, '月營收 YoY')))
  };
}

function buildPeerRankingRows(current, peers, currentSnapshot, snapshots) {
  if (!current) return [];
  if (!(peers || []).length && !(snapshots || []).length) return [];
  const marketRows = [current, ...(peers || [])];
  const fundamentalRows = [currentSnapshot, ...(snapshots || [])].filter(Boolean);
  const currentPe = highlightValue(currentSnapshot, '本益比');
  const currentYield = highlightValue(currentSnapshot, '殖利率');
  const currentEps = metricValue(currentSnapshot, 'EPS');
  const currentRevenueYoy = metricValue(currentSnapshot, '月營收 YoY');

  return [
    createPeerRankRow({
      label: '漲跌幅',
      period: '即時',
      value: Number(current.chgPct),
      average: average((peers || []).map(row => Number(row.chgPct))),
      values: marketRows.map(row => Number(row.chgPct)),
      format: 'pct',
      order: 'desc'
    }),
    createPeerRankRow({
      label: '每股盈餘',
      period: '近一年',
      value: currentEps,
      average: average((snapshots || []).map(item => metricValue(item, 'EPS'))),
      values: fundamentalRows.map(item => metricValue(item, 'EPS')),
      format: 'number',
      order: 'desc'
    }),
    createPeerRankRow({
      label: '現金殖利率',
      period: '近一年',
      value: currentYield,
      average: average((snapshots || []).map(item => highlightValue(item, '殖利率'))),
      values: fundamentalRows.map(item => highlightValue(item, '殖利率')),
      format: 'pct',
      order: 'desc'
    }),
    createPeerRankRow({
      label: '本益比',
      period: '近一年',
      value: currentPe,
      average: average((snapshots || []).map(item => highlightValue(item, '本益比'))),
      values: fundamentalRows.map(item => highlightValue(item, '本益比')),
      format: 'number',
      order: 'asc'
    }),
    {
      label: '法人買賣超',
      period: '近 5 日',
      value: null,
      average: null,
      rank: null,
      total: 0,
      format: 'number',
      note: '待接三大法人同業資料'
    },
    createPeerRankRow({
      label: '營收年增率',
      period: '最新月',
      value: currentRevenueYoy,
      average: average((snapshots || []).map(item => metricValue(item, '月營收 YoY'))),
      values: fundamentalRows.map(item => metricValue(item, '月營收 YoY')),
      format: 'pct',
      order: 'desc'
    })
  ];
}

function buildPeerStrengthRows(current, peers, currentSnapshot, snapshots) {
  if (!current) return [];
  const snapshotByCode = new Map(
    [currentSnapshot, ...(snapshots || [])]
      .filter(Boolean)
      .map(item => [String(item.company?.code || '').trim(), item])
  );

  return [current, ...(peers || [])]
    .filter(row => row?.code)
    .map(row => {
      const snap = snapshotByCode.get(String(row.code));
      const chgPct = marketMetric(row.chgPct);
      const volRatio = marketMetric(row.volRatio);
      const buyPct = marketMetric(row.buyPct);
      const revenueYoy = metricValue(snap, '????YoY');
      const roe = metricValue(snap, '撟游? ROE');
      const strengthScore = [
        Number.isFinite(chgPct) ? chgPct * 2 : 0,
        Number.isFinite(volRatio) ? Math.min(volRatio, 300) / 20 : 0,
        Number.isFinite(buyPct) ? (buyPct - 50) / 10 : 0,
        Number.isFinite(revenueYoy) ? Math.max(Math.min(revenueYoy, 60), -60) / 20 : 0,
        Number.isFinite(roe) ? Math.max(Math.min(roe, 40), -20) / 20 : 0
      ].reduce((sum, value) => sum + value, 0);

      return {
        code: row.code,
        name: row.name || snap?.company?.name || row.code,
        sector: row.sector || snap?.company?.sector || '',
        chgPct,
        volRatio,
        buyPct,
        revenueYoy,
        roe,
        strengthScore,
        isCurrent: String(row.code) === String(current.code)
      };
    })
    .sort((a, b) => b.strengthScore - a.strengthScore)
    .slice(0, 12);
}

function createPeerRankRow({ label, period, value, average: avg, values, format, order }) {
  const rank = rankAmong(value, values, order);
  return {
    label,
    period,
    value,
    average: avg,
    rank: rank.rank,
    total: rank.total,
    format,
    note: rank.rank ? `${order === 'asc' ? '低值優先' : '高值優先'}排序` : '樣本不足'
  };
}

function rankAmong(value, values, order = 'desc') {
  const currentValue = Number(value);
  const valid = values.map(Number).filter(Number.isFinite);
  if (!Number.isFinite(currentValue) || !valid.length) return { rank: null, total: valid.length };
  const sorted = valid.slice().sort((a, b) => order === 'asc' ? a - b : b - a);
  const rank = sorted.findIndex(item => order === 'asc' ? currentValue <= item : currentValue >= item) + 1;
  return { rank: rank || null, total: valid.length };
}

function peerMetricDisplay(row, key = 'value') {
  const value = Number(row?.[key]);
  if (!Number.isFinite(value)) return '--';
  return row.format === 'pct' ? pct(value, 2) : valuationDisplay({ current: value }, 2);
}

function marketMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function marketPct(value, digits = 0) {
  const number = marketMetric(value);
  if (number === null) return '--';
  return `${number.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`;
}

function marketNumber(value, digits = 2) {
  const number = marketMetric(value);
  if (number === null) return '--';
  return number.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function peerRankLabel(row) {
  return row?.rank && row?.total ? `${row.rank}/${row.total}` : '--';
}

function metricValue(target, label) {
  const item = target?.metrics?.find(metric => metric.label === label);
  return numericDisplayValue(item?.value);
}

function highlightValue(target, label) {
  const item = target?.highlights?.find(metric => metric.label === label);
  return numericDisplayValue(item?.value);
}

function numericDisplayValue(value) {
  if (value === null || value === undefined) return null;
  const number = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
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
            <button v-if="item.link" class="btn xs" type="button" @click="openEventLink(item.link)">開啟</button>
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
        <div v-if="financialTrends?.available" class="financial-trend-panel">
          <div class="financial-trend-head">
            <div>
              <span>財報歷史趨勢</span>
              <strong>{{ financialTrends.label }}</strong>
            </div>
            <em>
              <SourceBadge :source="financialTrends.source" />
              最新 {{ financialTrends.latestDate }}
            </em>
          </div>
          <div class="financial-trend-summary">
            <div v-for="item in financialTrends.summary" :key="item.label" class="financial-trend-card" :class="item.status">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <em>{{ item.detail }}</em>
            </div>
          </div>
          <div class="financial-trend-table">
            <div class="financial-trend-row head">
              <span>季度</span>
              <span>EPS</span>
              <span>年化 ROE</span>
              <span>毛利率</span>
              <span>營益率</span>
              <span>淨利率</span>
              <span>自由現金流</span>
              <span>負債比</span>
            </div>
            <div v-for="row in financialTrends.rows" :key="row.date" class="financial-trend-row">
              <span>
                <strong>{{ row.label }}</strong>
                <em>{{ row.date }}</em>
              </span>
              <span>
                <strong>{{ valuationDisplay({ current: row.eps }) }}</strong>
                <i class="mini-bar neutral" :style="{ width: financialBarWidth(row, 'eps', financialTrends.ranges.epsMax) }"></i>
              </span>
              <span>
                <strong>{{ pct(row.roe, 2) }}</strong>
                <i class="mini-bar good" :style="{ width: financialBarWidth(row, 'roe', financialTrends.ranges.roeMax) }"></i>
              </span>
              <span>
                <strong>{{ pct(row.grossMargin, 2) }}</strong>
                <i class="mini-bar good" :style="{ width: financialBarWidth(row, 'grossMargin', financialTrends.ranges.marginMax) }"></i>
              </span>
              <span>
                <strong>{{ pct(row.operatingMargin, 2) }}</strong>
                <i class="mini-bar watch" :style="{ width: financialBarWidth(row, 'operatingMargin', financialTrends.ranges.marginMax) }"></i>
              </span>
              <span>
                <strong>{{ pct(row.netMargin, 2) }}</strong>
                <i class="mini-bar neutral" :style="{ width: financialBarWidth(row, 'netMargin', financialTrends.ranges.marginMax) }"></i>
              </span>
              <span>
                <strong :class="financialTone(row.freeCashFlow)">{{ formatTrendAmount(row.freeCashFlow) }}</strong>
                <i class="mini-bar" :class="financialTone(row.freeCashFlow)" :style="{ width: financialBarWidth(row, 'freeCashFlow', financialTrends.ranges.cashFlowMax) }"></i>
              </span>
              <span>
                <strong>{{ pct(row.debtRatio, 2) }}</strong>
                <i class="mini-bar watch" :style="{ width: financialBarWidth(row, 'debtRatio', financialTrends.ranges.debtMax) }"></i>
              </span>
            </div>
          </div>
          <div v-if="financialTrends.annualRoeRows?.length" class="annual-roe-strip">
            <div class="annual-roe-head">
              <span>ROE 近 5 年</span>
              <em>以年度淨利 / 平均權益估算，當年度未滿 4 季時以已揭露季度呈現。</em>
            </div>
            <div class="annual-roe-list">
              <div v-for="row in financialTrends.annualRoeRows" :key="row.year" class="annual-roe-card">
                <span>{{ row.year }}</span>
                <strong>{{ pct(row.roe, 2) }}</strong>
                <em>{{ row.quarterCount }} 季資料</em>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="financialTrends && !financialTrends.available" class="hint">財報歷史趨勢尚未取得，會先以最新一期財報判斷。</div>
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

      <div v-if="activeTab === 'peers'" class="fundamental-panel">
        <div class="source-row">
          <SourceBadge source="TWSE/TPEX OpenAPI + FinMind + TWSE MIS" label="同業比較資料源" type="financial" />
          <span class="source-badge">產業：{{ peerComparison?.sector || company.sector || '--' }}</span>
          <span class="source-badge">樣本：{{ peerComparison?.count || 0 }} 檔</span>
          <span class="source-badge">基本面樣本：{{ peerComparison?.peerFundamentalCount || 0 }} 檔</span>
          <span v-if="peerLoading || peerStatusText" class="source-badge">{{ peerStatusText }}</span>
        </div>
        <div v-if="peerLoading && !peerRows.length" class="peer-loading-card">
          <strong>正在建立同業比較</strong>
          <span>{{ peerStatusText }}</span>
        </div>
        <div v-if="peerLoading && peerRows.length" class="hint">{{ peerStatusText }}</div>
        <div v-if="peerRankingRows.length" class="peer-rank-card-grid">
          <div v-for="row in peerRankingRows" :key="row.label" class="peer-rank-card">
            <span>{{ row.period }}</span>
            <strong>{{ row.label }}</strong>
            <em>{{ peerRankLabel(row) }}</em>
            <small>{{ row.note }}</small>
          </div>
        </div>
        <div v-if="peerRankingRows.length" class="peer-ranking-table">
          <div class="peer-ranking-row head">
            <span>指標</span>
            <span>本股</span>
            <span>同業平均</span>
            <span>排名</span>
          </div>
          <div v-for="row in peerRankingRows" :key="`table-${row.label}`" class="peer-ranking-row">
            <span>
              <strong>{{ row.label }}</strong>
              <em>{{ row.period }}</em>
            </span>
            <span>{{ peerMetricDisplay(row, 'value') }}</span>
            <span>{{ peerMetricDisplay(row, 'average') }}</span>
            <span>{{ peerRankLabel(row) }}</span>
          </div>
        </div>
        <div v-if="peerComparison" class="peer-grid">
          <div>
            <span>漲跌幅</span>
            <strong :class="moveClass(peerComparison.stockChangePct).replace('is-', '')">{{ pct(peerComparison.stockChangePct, 2) }}</strong>
            <em>同業平均 {{ pct(peerComparison.avgChangePct, 2) }}</em>
          </div>
          <div>
            <span>量比</span>
            <strong>{{ marketPct(peerComparison.stockVolRatio, 0) }}</strong>
            <em>同業平均 {{ marketPct(peerComparison.avgVolRatio, 0) }}</em>
          </div>
          <div>
            <span>買入占比</span>
            <strong>{{ marketPct(peerComparison.stockBuyPct, 0) }}</strong>
            <em>同業平均 {{ marketPct(peerComparison.avgBuyPct, 0) }}</em>
          </div>
          <div>
            <span>本益比</span>
            <strong>{{ valuationDisplay({ current: peerComparison.currentPe }) }}</strong>
            <em>同業平均 {{ valuationDisplay({ current: peerComparison.avgPeerPe }) }}</em>
          </div>
          <div>
            <span>ROE</span>
            <strong>{{ pct(peerComparison.currentRoe, 2) }}</strong>
            <em>同業平均 {{ pct(peerComparison.avgPeerRoe, 2) }}</em>
          </div>
          <div>
            <span>殖利率</span>
            <strong>{{ pct(peerComparison.currentYield, 2) }}</strong>
            <em>同業平均 {{ pct(peerComparison.avgPeerYield, 2) }}</em>
          </div>
          <div>
            <span>月營收 YoY</span>
            <strong>{{ pct(peerComparison.currentRevenueYoy, 2) }}</strong>
            <em>同業平均 {{ pct(peerComparison.avgPeerRevenueYoy, 2) }}</em>
          </div>
        </div>
        <div v-if="peerStrengthRows.length" class="peer-strength-panel">
          <div class="peer-strength-head">
            <div>
              <span>同族群強弱排行</span>
              <strong>{{ peerComparison?.sector || company.sector || '同產業' }}</strong>
            </div>
            <em>綜合漲跌幅、量比、買入占比、營收 YoY 與 ROE 排序</em>
          </div>
          <div class="peer-strength-table">
            <div class="peer-strength-row head">
              <span>#</span>
              <span>股票</span>
              <span>漲跌</span>
              <span>量比</span>
              <span>買入</span>
              <span>營收 YoY</span>
              <span>強弱分數</span>
            </div>
            <div v-for="(row, index) in peerStrengthRows" :key="row.code" class="peer-strength-row" :class="{ current: row.isCurrent }">
              <span>{{ index + 1 }}</span>
              <span>
                <strong>{{ row.code }} {{ row.name }}</strong>
                <em>{{ row.sector || '--' }}</em>
              </span>
              <span :class="moveClass(row.chgPct).replace('is-', '')">{{ pct(row.chgPct, 2) }}</span>
              <span>{{ marketPct(row.volRatio, 0) }}</span>
              <span>{{ marketPct(row.buyPct, 0) }}</span>
              <span :class="moveClass(row.revenueYoy).replace('is-', '')">{{ pct(row.revenueYoy, 2) }}</span>
              <span>{{ marketNumber(row.strengthScore, 2) }}</span>
            </div>
          </div>
        </div>
        <div v-if="!peerLoading && !peerComparison && !peerRankingRows.length && !peerStrengthRows.length" class="hint">同產業樣本不足，暫時無法建立比較。</div>
      </div>

      <div v-if="activeTab === 'events'" class="fundamental-panel">
        <div v-if="eventCalendar.length" class="event-calendar-list fundamental-event-calendar">
          <div v-for="item in eventCalendar" :key="`${item.date}-${item.title}`" class="event-calendar-item" :class="[item.status, item.type]">
            <div>
              <span>
                {{ item.date }}
                <b class="event-type-pill" :class="eventTypeClass(item.type)">{{ eventTypeText(item.type) }}</b>
              </span>
              <strong>{{ item.title }}</strong>
            </div>
            <em>{{ item.detail }}</em>
            <small>
              {{ eventStatusText(item.status) }}
              <SourceBadge :source="item.source" />
            </small>
            <button v-if="item.link" class="btn xs event-link-btn" type="button" @click="openEventLink(item.link)">
              {{ item.linkLabel || '查看原文' }}
            </button>
          </div>
        </div>
        <div v-else class="hint">目前沒有可顯示的近期事件。</div>
        <div class="event-source-note">
          <span>已接入：</span>
          <SourceBadge source="MOPS 重大訊息 OpenAPI" />
          <SourceBadge source="FinMind TaiwanStockNews" />
          <SourceBadge source="TWSE/TPEX 注意處置 OpenAPI" />
          <SourceBadge source="TWSE/TPEX 除權息 OpenAPI" />
          <SourceBadge source="FinMind 月營收 / 財報 / 估值 / 信用事件" />
          <span>法說會：官方 OpenAPI 尚未提供穩定個股法說會來源，後續可接 TDCC IR Platform 或 MOPS 來源。</span>
        </div>
        <div v-if="dividendStability?.available" class="dividend-stability fundamental-dividend-stability">
          <div class="dividend-main-card" :class="dividendStability.tone">
            <span>{{ dividendStability.label }}</span>
            <strong>{{ valuationDisplay({ current: dividendStability.latestCashDividend }) }} 元</strong>
            <em>連續配息 {{ dividendStability.consecutiveYears }} 年 / 近 5 年平均 {{ valuationDisplay({ current: dividendStability.avg5CashDividend }) }} 元 / {{ dividendStability.sourceBreakdown?.label || '來源待確認' }}</em>
          </div>
          <div class="dividend-info-grid">
            <div>
              <span>最新除息日</span>
              <strong>{{ dividendStability.latestExDate || '--' }}</strong>
              <em>發放日 {{ dividendStability.latestPaymentDate || '--' }}</em>
            </div>
            <div :class="fillStatusClass(dividendStability.fillStatus?.status)">
              <span>填息狀態</span>
              <strong>{{ dividendStability.fillStatus?.label || '待判斷' }}</strong>
              <em>
                {{
                  dividendStability.fillStatus?.targetPrice
                    ? `目標 ${formatMoney(dividendStability.fillStatus.targetPrice, 2)} / 最新 ${formatMoney(dividendStability.fillStatus.currentPrice, 2)}`
                    : dividendStability.fillStatus?.source || '需除息日前收盤價'
                }}
              </em>
            </div>
            <div>
              <span>現金殖利率</span>
              <strong>{{ plainPct(dividendStability.dividendYield) }}</strong>
              <em>以最新年度現金股利 / 目前股價估算</em>
            </div>
            <div>
              <span>配息率</span>
              <strong>{{ plainPct(dividendStability.payoutRatio) }}</strong>
              <em>{{ dividendStability.payoutRatioSource || '待 EPS 資料' }}</em>
            </div>
            <div>
              <span>盈餘配發</span>
              <strong>{{ plainPct(dividendStability.sourceBreakdown?.earningsRatio, 0) }}</strong>
              <em>現金 {{ valuationDisplay({ current: dividendStability.sourceBreakdown?.cashFromEarnings }) }} 元</em>
            </div>
            <div>
              <span>資本公積 / 公積</span>
              <strong>{{ plainPct(dividendStability.sourceBreakdown?.capitalReserveRatio, 0) }}</strong>
              <em>現金 {{ valuationDisplay({ current: dividendStability.sourceBreakdown?.cashFromCapitalReserve }) }} 元</em>
            </div>
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
        <div v-else class="hint">股利穩定度尚無足夠資料。</div>
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
