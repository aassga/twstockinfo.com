<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  IconChartLine,
  IconChevronDown,
  IconChevronUp,
  IconDatabase,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-vue";
import { fetchFundamentalSnapshotPhased } from "../api/fundamentalApi";
import DataStatusGrid from "../components/DataStatusGrid.vue";
import SourceBadge from "../components/SourceBadge.vue";
import StockChart from "../components/StockChart.vue";
import { useChartStore } from "../stores/chartStore";
import { useInstitutionalStore } from "../stores/institutionalStore";
import { useStockStore } from "../stores/stockStore";
import { quoteSourceMeta } from "../utils/dataSources";
import {
  formatMoney,
  formatNumber,
  formatPct,
  formatSigned,
  formatVolume,
  moveClass,
} from "../utils/formatters";
import { quickStocks } from "../utils/stockMeta";

const stockStore = useStockStore();
const chartStore = useChartStore();
const institutionalStore = useInstitutionalStore();
const route = useRoute();

const query = ref(stockStore.currentStock?.code || stockStore.activeCode || "");
const loading = ref(false);
const isManualRefreshing = ref(false);
const error = ref("");
const fundamentalSnapshot = ref(null);
const fundamentalError = ref("");
const candidates = ref([]);
const showCandidates = ref(false);
const activePanel = ref("chart");
const activeRange = ref("D");
const panelTabsEl = ref(null);
const rangeTabsEl = ref(null);
const candidateLimit = 20;
const liveQuoteRefreshMs = 5000;
const stockCodePattern = /^\d{4,6}[a-z]?$/i;
let candidateTimer = null;
let searchRunId = 0;
let liveQuoteTimer = null;
let liveQuoteRefreshing = false;

const panels = [
  { label: "報價", value: "quote" },
  { label: "走勢", value: "chart" },
  { label: "五檔", value: "depth" },
  { label: "內外盤", value: "trades" },
  { label: "法人", value: "institutional" },
  { label: "基本面", value: "fundamental" },
  { label: "AI 摘要", value: "ai" },
];

const ranges = [
  { label: "1時", value: "60" },
  { label: "4時", value: "240" },
  { label: "1日", value: "D" },
];

const stock = computed(() => stockStore.currentStock);
const tradeFlow = computed(() => stock.value?.tradeFlow || null);
const tradeFlowBadgeType = computed(() => {
  if (tradeFlow.value?.reliable) return "computed";
  if (tradeFlow.value?.available) return "estimated";
  return "unknown";
});
const tradeFlowNoticeTitle = computed(() => {
  if (tradeFlow.value?.reliable) return "輪詢重建中";
  if (tradeFlow.value?.available) return "樣本累積中";
  return "等待成交快照";
});
const tone = computed(() => moveClass(stock.value?.chgPct).replace("is-", ""));
const quoteSource = computed(() => quoteSourceMeta(stock.value));
const institutionalTrend = computed(() => {
  const code = stock.value?.code;
  return code ? institutionalStore.trendByCode[code] || [] : [];
});
const institutionalRow = computed(() => {
  const code = stock.value?.code;
  if (!code) return null;
  return (
    institutionalStore.byCode[code] ||
    institutionalStore.rows.find((row) => row.code === code) ||
    institutionalTrend.value[0] ||
    null
  );
});
const institutionalLoading = computed(() => {
  const code = stock.value?.code;
  return Boolean(
    code &&
      (institutionalStore.codeLoading[code] ||
        institutionalStore.trendLoading[code] ||
        institutionalStore.loading)
  );
});
const fundamentalLoading = computed(() => fundamentalSnapshot.value?.isPartial);
const statusCards = computed(() => {
  const chartReady =
    stock.value?.code &&
    chartStore.stock?.code === stock.value.code &&
    chartStore.candles.length > 0;
  return [
    {
      label: "報價",
      value: stock.value?.price
        ? quoteSource.value.type === "realtime"
          ? "即時完成"
          : "備援資料"
        : "無資料",
      source: quoteSource.value.label,
      status: stock.value?.price
        ? quoteSource.value.type === "realtime"
          ? "done"
          : "fallback"
        : "idle",
    },
    {
      label: "走勢",
      value: chartStore.loading
        ? "載入中"
        : chartStore.error
          ? "無資料"
          : chartReady
            ? "走勢完成"
            : "待查詢",
      source: "Yahoo Chart",
      status: chartStore.loading
        ? "loading"
        : chartStore.error
          ? "error"
          : chartReady
            ? "done"
            : "idle",
    },
    {
      label: "法人",
      value: institutionalLoading.value
        ? "載入中"
        : institutionalRow.value || institutionalTrend.value.length
          ? "法人完成"
          : "無資料",
      source: institutionalRow.value?.source === "histock" ? "HiStock / TWSE" : "TWSE / HiStock",
      status: institutionalLoading.value
        ? "loading"
        : institutionalRow.value || institutionalTrend.value.length
          ? "done"
          : "idle",
    },
    {
      label: "基本面",
      value: fundamentalLoading.value
        ? stageText(fundamentalSnapshot.value?.loadingStage)
        : fundamentalError.value
          ? "無資料"
          : fundamentalSnapshot.value
            ? "基本面完成"
            : "待查詢",
      source: fundamentalSnapshot.value?.source || "TWSE/TPEX OpenAPI + FinMind",
      status: fundamentalLoading.value
        ? "loading"
        : fundamentalError.value
          ? "error"
          : fundamentalSnapshot.value
            ? "done"
            : "idle",
    },
  ];
});
const marketTime = computed(() => {
  const raw = [stock.value?.date, stock.value?.time].filter(Boolean).join(" ");
  return raw || "--";
});
const referencePrice = computed(() => Number(stock.value?.prev || 0));
const limitUp = computed(() =>
  referencePrice.value ? roundPrice(referencePrice.value * 1.1) : 0
);
const limitDown = computed(() =>
  referencePrice.value ? roundPrice(referencePrice.value * 0.9) : 0
);
const amplitude = computed(() => {
  const high = Number(stock.value?.high || 0);
  const low = Number(stock.value?.low || 0);
  const prev = referencePrice.value;
  return high > 0 && low > 0 && prev > 0 ? ((high - low) / prev) * 100 : null;
});
const avgPrice = computed(() => {
  const amount = Number(stock.value?.amountHundredMillion || 0) * 100000000;
  const volume = Number(stock.value?.volume || 0);
  return amount > 0 && volume > 0 ? amount / volume : 0;
});
const quoteMetrics = computed(() => [
  { label: "成交", value: money(stock.value?.price), tone: tone.value },
  { label: "漲跌", value: signedMoney(stock.value?.change), tone: tone.value },
  {
    label: "幅度",
    value: formatPct(stock.value?.chgPct || 0),
    tone: tone.value,
  },
  {
    label: "單量",
    value: formatNumber(stock.value?.transaction || 0, 0),
    tone: "neutral",
  },
  {
    label: "總量",
    value: formatVolume(stock.value?.volume || 0),
    tone: "neutral highlight",
  },
  {
    label: "均價",
    value: avgPrice.value ? money(avgPrice.value) : "--",
    tone: "neutral",
  },
  {
    label: tradeFlow.value?.reliable ? "外盤" : "買入",
    value: `${Math.round(stock.value?.buyPct || 0)}%`,
    tone: "up",
  },
  {
    label: tradeFlow.value?.reliable ? "內盤" : "賣出",
    value: `${Math.round(stock.value?.sellPct || 0)}%`,
    tone: "down",
  },
  {
    label: "振幅",
    value:
      amplitude.value === null ? "--" : `${formatNumber(amplitude.value, 2)}%`,
    tone: "highlight",
  },
  {
    label: "跌停",
    value: limitDown.value ? money(limitDown.value) : "--",
    tone: "down-block",
  },
  {
    label: "漲停",
    value: limitUp.value ? money(limitUp.value) : "--",
    tone: "up-block",
  },
  {
    label: "參考",
    value: referencePrice.value ? money(referencePrice.value) : "--",
    tone: "ref-block",
  },
]);
const depthRows = computed(() => {
  const asks = (stock.value?.askLevels || [])
    .map((row) => ({ ...row, side: "ask" }))
    .reverse();
  const bids = (stock.value?.bidLevels || []).map((row) => ({
    ...row,
    side: "bid",
  }));
  const rows = [...asks, ...bids];
  const maxVolume = Math.max(...rows.map((row) => Number(row.volume || 0)), 1);
  return rows.map((row) => ({
    ...row,
    width: `${Math.max(6, (Number(row.volume || 0) / maxVolume) * 100)}%`,
  }));
});
const tradeFlowCards = computed(() => {
  const flow = tradeFlow.value || {};
  const hasFlow = Number(flow.classifiedLots || 0) > 0;
  const buyPct = Math.round(flow.activeBuyPct || stock.value?.buyPct || 0);
  const sellPct = Math.round(flow.activeSellPct || stock.value?.sellPct || 0);
  const flowSuffix = flow.reliable ? "主動買進" : "推估 / 樣本累積";
  return [
    {
      label: "外盤",
      value: hasFlow ? formatNumber(flow.activeBuyLots || 0, 0) : "--",
      detail: hasFlow ? `${buyPct}% ${flowSuffix}` : "等待成交快照",
      tone: "up"
    },
    {
      label: "內盤",
      value: hasFlow ? formatNumber(flow.activeSellLots || 0, 0) : "--",
      detail: hasFlow ? `${sellPct}% ${flow.reliable ? "主動賣出" : "推估 / 樣本累積"}` : "等待成交快照",
      tone: "down"
    },
    {
      label: "中性",
      value: flow.available ? formatNumber(flow.neutralLots || 0, 0) : "--",
      detail: "成交價落在買賣價中間或無法分類",
      tone: "neutral"
    },
    {
      label: `最近成交${flow.observedTicks ? ` ${flow.observedTicks} 筆` : ""}`,
      value: flow.lastTradePrice ? money(flow.lastTradePrice) : "--",
      detail: flow.lastTradeVolume ? `${flow.lastTradeVolume} 張 / ${tradeSideText(flow.lastTradeSide)}` : "等待新成交",
      tone: flow.lastTradeSide === "outer" ? "up" : flow.lastTradeSide === "inner" ? "down" : "neutral"
    }
  ];
});
const tradeRows = computed(() => tradeFlow.value?.ticks || []);
const institutionalWindows = computed(() =>
  [5, 10, 20].map((days) => summarizeInstitutional(institutionalTrend.value, days))
);
const aiSummary = computed(() => {
  if (!stock.value) return [];
  const rows = [
    `${stock.value.code} ${stock.value.name || ""} 目前股價 ${money(stock.value.price)}，漲跌 ${formatPct(stock.value.chgPct || 0)}。`,
  ];
  if (institutionalRow.value) {
    rows.push(
      `單日法人合計 ${formatSigned(institutionalRow.value.total || 0, 0, "張")}，外資 ${formatSigned(institutionalRow.value.foreign || 0, 0, "張")}、投信 ${formatSigned(institutionalRow.value.trust || 0, 0, "張")}、自營商 ${formatSigned(institutionalRow.value.dealer || 0, 0, "張")}。`
    );
  }
  const fiveDay = institutionalWindows.value[0];
  if (fiveDay.count) {
    rows.push(`近 ${fiveDay.count} 日法人累計 ${formatSigned(fiveDay.total, 0, "張")}，可用來觀察籌碼是否延續。`);
  }
  if (fundamentalSnapshot.value && !fundamentalSnapshot.value.isPartial) {
    rows.push(
      `基本面評分 ${fundamentalSnapshot.value.score}，完整度 ${fundamentalSnapshot.value.dataCompleteness}%，${fundamentalSnapshot.value.verdict}`
    );
  }
  return rows;
});

watch(query, (value) => {
  clearTimeout(candidateTimer);
  const input = String(value || "").trim();
  if (!input || stockCodePattern.test(input)) {
    candidates.value = [];
    showCandidates.value = false;
    return;
  }

  candidateTimer = setTimeout(async () => {
    const rows = await stockStore
      .findStockCandidates(input, candidateLimit)
      .catch(() => []);
    candidates.value = rows;
    showCandidates.value = rows.length > 0;
  }, 180);
});

watch(
  () => route.query.code,
  (code) => {
    const normalized = normalizeRouteCode(code);
    if (normalized && normalized !== stock.value?.code) runSearch(normalized);
  }
);

onMounted(() => {
  const routeCode = normalizeRouteCode(route.query.code);
  if (routeCode) {
    query.value = routeCode;
    runSearch(routeCode);
  } else {
    const initialCode = stock.value?.code || stockStore.activeCode;
    if (initialCode) {
      query.value = initialCode;
      if (stock.value?.code === initialCode) {
        openChart(stock.value);
        loadStockCenterData(stock.value, searchRunId);
        refreshLiveQuote();
      } else {
        runSearch(initialCode);
      }
    }
  }
  startLiveQuoteRefresh();
  alignActiveTab(panelTabsEl, activePanel.value, panels, 1);
  alignActiveTab(rangeTabsEl, activeRange.value, ranges, ranges.length);
});

onBeforeUnmount(() => {
  stopLiveQuoteRefresh();
});

async function submit(value = query.value) {
  const input = String(value || "").trim();
  if (!input) return;

  if (!stockCodePattern.test(input)) {
    const rows = await stockStore
      .findStockCandidates(input, candidateLimit)
      .catch(() => []);
    const normalized = normalizeSearchText(input);
    const exact = rows.find(
      (row) =>
        normalizeSearchText(row.code) === normalized ||
        normalizeSearchText(row.name) === normalized
    );
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
  error.value = "";
  showCandidates.value = false;
  try {
    const nextStock = await stockStore.searchStock(code, { force: true });
    if (runId !== searchRunId) return;
    query.value = nextStock.code;
    fundamentalSnapshot.value = null;
    fundamentalError.value = "";
    await openChart(nextStock);
    loadStockCenterData(nextStock, runId);
    restartLiveQuoteRefresh();
  } catch (err) {
    if (runId === searchRunId) error.value = err?.message || "報價取得失敗";
  } finally {
    if (runId === searchRunId) loading.value = false;
  }
}

async function openChart(nextStock = stock.value) {
  if (!nextStock?.code) return;
  await chartStore.openStock(nextStock, activeRange.value);
}

async function setRange(value) {
  activeRange.value = value;
  alignActiveTab(rangeTabsEl, value, ranges, ranges.length);
  if (stock.value?.code) await chartStore.openStock(stock.value, value);
}

async function manualRefreshQuote() {
  if (isManualRefreshing.value || !stock.value?.code) return;
  isManualRefreshing.value = true;
  error.value = "";
  try {
    await stockStore.refreshCurrentStock({ force: true, silent: true });
    if (stock.value?.code) {
      loadStockCenterData(stock.value, ++searchRunId, { force: true });
    }
    restartLiveQuoteRefresh();
  } catch (err) {
    error.value = err?.message || "報價更新失敗";
  } finally {
    isManualRefreshing.value = false;
  }
}

async function loadStockCenterData(nextStock, runId = searchRunId, { force = false } = {}) {
  if (!nextStock?.code) return;
  void loadInstitutional(nextStock.code, { force });
  void loadFundamental(nextStock, runId);
}

async function loadInstitutional(code, { force = false } = {}) {
  if (!institutionalStore.loaded) {
    await institutionalStore.loadInstitutional({ silent: true });
  }
  await Promise.allSettled([
    institutionalStore.loadInstitutionalByCode(code, { force }),
    institutionalStore.loadInstitutionalTrendByCode(code, { force }),
  ]);
}

async function loadFundamental(nextStock, runId) {
  fundamentalError.value = "";
  try {
    const snapshot = await fetchFundamentalSnapshotPhased(nextStock, (nextSnapshot) => {
      if (runId === searchRunId) fundamentalSnapshot.value = nextSnapshot;
    });
    if (runId === searchRunId) fundamentalSnapshot.value = snapshot;
  } catch (err) {
    if (runId === searchRunId) {
      fundamentalError.value = err?.message || "基本面資料取得失敗";
      fundamentalSnapshot.value = null;
    }
  }
}

function startLiveQuoteRefresh() {
  if (typeof window === "undefined") return;
  stopLiveQuoteRefresh();
  liveQuoteTimer = window.setInterval(refreshLiveQuote, liveQuoteRefreshMs);
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function stopLiveQuoteRefresh() {
  if (liveQuoteTimer) {
    window.clearInterval(liveQuoteTimer);
    liveQuoteTimer = null;
  }
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }
}

function restartLiveQuoteRefresh() {
  startLiveQuoteRefresh();
}

function handleVisibilityChange() {
  if (!document.hidden) refreshLiveQuote();
}

async function refreshLiveQuote() {
  if (liveQuoteRefreshing || !stock.value?.code) return;
  if (typeof document !== "undefined" && document.hidden) return;

  liveQuoteRefreshing = true;
  try {
    await stockStore.refreshCurrentStock({ silent: true, force: true });
  } catch (_error) {
    // Keep the last quote visible if the realtime endpoint briefly fails.
  } finally {
    liveQuoteRefreshing = false;
  }
}

function quickSearch(code) {
  query.value = code;
  submit(code);
}

function setPanel(value) {
  activePanel.value = value;
  alignActiveTab(panelTabsEl, value, panels, 1);
  if (!stock.value?.code) return;
  if (value === "institutional") void loadInstitutional(stock.value.code);
  if (value === "fundamental" || value === "ai") void loadFundamental(stock.value, searchRunId);
}

function alignActiveTab(containerRef, value, items, resetThroughIndex = 0) {
  nextTick(() => {
    const container = containerRef.value;
    if (!container) return;

    const index = items.findIndex((item) => item.value === value);
    if (index >= 0 && index <= resetThroughIndex) {
      container.scrollTo({ left: 0, behavior: "smooth" });
      return;
    }

    const target = container.querySelector(`[data-tab-value="${value}"]`);
    if (!target) return;

    const styles = window.getComputedStyle(container);
    const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
    const targetLeft = target.offsetLeft;
    const targetRight = targetLeft + target.offsetWidth;
    const visibleLeft = container.scrollLeft + paddingLeft;
    const visibleRight = container.scrollLeft + container.clientWidth - paddingRight;

    if (targetLeft < visibleLeft) {
      container.scrollTo({ left: Math.max(0, targetLeft - paddingLeft), behavior: "smooth" });
    } else if (targetRight > visibleRight) {
      container.scrollTo({
        left: targetRight - container.clientWidth + paddingRight,
        behavior: "smooth",
      });
    }
  });
}

function selectCandidate(item) {
  runSearch(item.code);
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeRouteCode(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return String(text || "").trim().toUpperCase();
}

function stageText(stage) {
  if (stage === "quote") return "報價完成";
  if (stage === "overview") return "財務指標載入中";
  if (stage === "statements") return "三大財報載入中";
  return "載入中";
}

function statusText(status) {
  if (status === "good") return "良好";
  if (status === "watch") return "觀察";
  if (status === "neutral") return "中性";
  if (status === "risk") return "風險";
  return "待查";
}

function tradeSideText(side) {
  if (side === "outer") return "外盤";
  if (side === "inner") return "內盤";
  return "中性";
}

function summarizeInstitutional(rows, days) {
  const sample = rows.slice(0, days);
  const sum = sample.reduce(
    (acc, row) => ({
      foreign: acc.foreign + Number(row.foreign || 0),
      trust: acc.trust + Number(row.trust || 0),
      dealer: acc.dealer + Number(row.dealer || 0),
      total: acc.total + Number(row.total || 0),
    }),
    { foreign: 0, trust: 0, dealer: 0, total: 0 }
  );
  return { days, count: sample.length, ...sum };
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? formatMoney(number, 2) : "--";
}

function signedMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return formatSigned(number, 2);
}

function roundPrice(value) {
  return Number(Number(value || 0).toFixed(2));
}
</script>

<template>
  <section class="tab-content active quote-view">
    <div class="page-title-row">
      <div class="page-title quote-title">
        <IconChartLine class="title-icon" :stroke-width="2" />
        個股即時報價
      </div>
      <div class="page-actions">
        <button
          class="btn"
          :class="{ 'is-refreshing': isManualRefreshing }"
          type="button"
          :disabled="isManualRefreshing || !stock"
          @click="manualRefreshQuote"
        >
          <IconRefresh class="btn-icon" :stroke-width="2" />
          重新整理
        </button>
      </div>
    </div>
    <div class="search-row quote-search-row">
      <input
        v-model="query"
        class="search-input"
        placeholder="輸入股票代號或名稱，例如：3105 或 穩懋"
        @keyup.enter="submit()"
      />
      <button
        class="btn primary"
        type="button"
        :disabled="loading"
        @click="submit()"
      >
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

    <div v-if="showCandidates" class="search-candidates quote-candidates">
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
        <span class="candidate-price">{{
          item.price ? formatMoney(item.price, 2) : "--"
        }}</span>
      </button>
    </div>

    <div v-if="error" class="empty-state volume-empty-state">{{ error }}</div>

    <div v-if="!stock && !error" class="empty-state quote-empty">
      <IconDatabase class="title-icon" :stroke-width="2" />
      <div>輸入股票後顯示即時報價</div>
      <span class="hint">包含當日走勢、五檔價量與詳細報價。</span>
    </div>

    <template v-if="stock">
      <section class="quote-tape" :class="tone">
        <div>
          <div class="quote-stock-name">
            {{ stock.name || stock.code }} <span>[{{ stock.code }}]</span>
          </div>
          <div class="quote-time">時 {{ marketTime }}</div>
          <SourceBadge :label="quoteSource.label" :type="quoteSource.type" variant="quote" />
        </div>
        <div class="quote-main-price">
          <strong>{{ money(stock.price) }}</strong>
          <span
            >{{ signedMoney(stock.change) }} /
            {{ formatPct(stock.chgPct || 0) }}</span
          >
        </div>
      </section>

      <section class="quote-detail-section">
        <div class="quote-detail-head">
          <div class="quote-section-title">詳細報價</div>
          <SourceBadge :label="quoteSource.label" :type="quoteSource.type" variant="quote" />
        </div>
        <div class="quote-detail-grid">
          <div
            v-for="item in quoteMetrics"
            :key="item.label"
            class="quote-detail-cell"
            :class="item.tone"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <DataStatusGrid :items="statusCards" />

      <section
        class="quote-workspace"
        :class="{ single: ['institutional', 'fundamental', 'ai'].includes(activePanel) }"
      >
        <div class="quote-chart-panel">
          <div ref="panelTabsEl" class="quote-panel-tabs">
            <button
              v-for="panel in panels"
              :key="panel.value"
              class="quote-panel-tab"
              :class="{ active: activePanel === panel.value }"
              :data-tab-value="panel.value"
              type="button"
              @click="setPanel(panel.value)"
            >
              {{ panel.label }}
            </button>
          </div>

          <div v-if="activePanel === 'quote'" class="quote-overview-panel">
            <div class="quote-overview-grid">
              <div class="quote-side-card">
                <span>最高 / 最低</span>
                <strong>{{ money(stock.high) }}</strong>
                <em>最低 {{ money(stock.low) }}</em>
              </div>
              <div class="quote-side-card">
                <span>開盤 / 參考</span>
                <strong>{{ money(stock.open) }}</strong>
                <em>參考 {{ money(stock.prev) }}</em>
              </div>
              <div class="quote-side-card">
                <span>{{ tradeFlow?.reliable ? "內外盤力道" : "買賣力道" }}</span>
                <strong>{{ Math.round(stock.buyPct || 0) }}%</strong>
                <em>{{ tradeFlow?.reliable ? "外盤占比" : stock.forceSourceLabel || "五檔委買委賣" }}</em>
                <div class="quote-force-line">
                  <i class="buy" :style="{ width: `${stock.buyPct || 0}%` }"></i>
                  <i class="sell" :style="{ width: `${stock.sellPct || 0}%` }"></i>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="activePanel === 'chart'" class="quote-chart-section">
            <div ref="rangeTabsEl" class="quote-range-tabs">
              <button
                v-for="item in ranges"
                :key="item.value"
                class="quote-range-btn"
                :class="{ active: activeRange === item.value }"
                :data-tab-value="item.value"
                type="button"
                @click="setRange(item.value)"
              >
                {{ item.label }}
              </button>
            </div>
            <div class="chart-frame quote-chart-frame">
              <div v-if="chartStore.loading" class="chart-loading">
                <div class="spinner"></div>
                <span>走勢圖載入中...</span>
              </div>
              <div v-else-if="chartStore.error" class="chart-error">
                {{ chartStore.error }}
              </div>
              <StockChart
                v-else
                :candles="chartStore.candles"
                :interval="chartStore.interval"
                :loading="chartStore.loading"
                :error="chartStore.error"
              />
            </div>
          </div>

          <div v-else-if="activePanel === 'depth'" class="quote-depth-panel">
            <div v-if="depthRows.length" class="quote-depth-list">
              <div
                v-for="row in depthRows"
                :key="`${row.side}-${row.price}`"
                class="quote-depth-row"
                :class="row.side"
              >
                <span class="depth-price">{{
                  formatNumber(row.price, 2)
                }}</span>
                <div class="depth-bar-track">
                  <i :style="{ width: row.width }"></i>
                </div>
                <strong>{{ formatNumber(row.volume, 0) }}</strong>
              </div>
            </div>
            <div v-else class="hint depth-empty">
              目前資料來源未提供五檔明細。
            </div>
          </div>

          <div v-else-if="activePanel === 'trades'" class="quote-trades-panel">
            <div class="quote-info-head">
              <div>
                <div class="quote-section-title">內外盤監測 / 成交快照</div>
                <span class="hint">{{ tradeFlow?.note || "等待 TWSE MIS 新成交資料。" }}</span>
              </div>
              <SourceBadge
                :source="tradeFlow?.sourceLabel || 'TWSE MIS 即時報價監測中'"
                :type="tradeFlowBadgeType"
                variant="quote"
              />
            </div>

            <div class="trade-flow-notice" :class="tradeFlow?.reliable ? 'ready' : 'pending'">
              <strong>{{ tradeFlowNoticeTitle }}</strong>
              <span>
                TWSE MIS 目前不是完整逐筆成交 API；此處以每 5 秒報價快照重建成交方向。
                若樣本不足，買入占比 / 賣出占比會先維持五檔委託量推估。
              </span>
            </div>

            <div class="trade-flow-grid">
              <div
                v-for="item in tradeFlowCards"
                :key="item.label"
                class="trade-flow-card"
                :class="item.tone"
              >
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
                <em>{{ item.detail }}</em>
              </div>
            </div>

            <div v-if="tradeRows.length" class="trade-tick-list">
              <div class="trade-tick-head">
                <span>時間</span>
                <span>成交價</span>
                <span>張數</span>
                <span>判定</span>
              </div>
              <div
                v-for="tick in tradeRows"
                :key="tick.key"
                class="trade-tick-row"
                :class="tick.side"
              >
                <span>{{ tick.time || "--" }}</span>
                <strong>{{ money(tick.price) }}</strong>
                <span>{{ formatNumber(tick.volume || 0, 0) }}</span>
                <em>{{ tick.sideLabel || tradeSideText(tick.side) }}</em>
              </div>
            </div>
            <div v-else class="hint depth-empty">
              尚未捕捉到新成交。開盤時保持此頁開啟，系統會每 5 秒更新並累積外盤/內盤。
            </div>
          </div>

          <div v-else-if="activePanel === 'institutional'" class="quote-info-panel">
            <div class="quote-info-head">
              <div>
                <div class="quote-section-title">法人與籌碼趨勢</div>
                <span class="hint">單日法人與近 5 / 10 / 20 日累計買賣超。</span>
              </div>
              <SourceBadge
                :source="institutionalRow?.source === 'histock' ? 'HiStock / TWSE' : 'TWSE / HiStock'"
                :label="institutionalLoading ? '法人載入中' : institutionalRow ? '法人資料完成' : '法人資料待查'"
                :type="institutionalRow ? 'official' : 'unknown'"
                variant="quote"
              />
            </div>
            <div class="quote-inst-grid">
              <div class="quote-inst-card">
                <span>外資</span>
                <strong :class="moveClass(institutionalRow?.foreign).replace('is-', '')">
                  {{ institutionalRow ? formatSigned(institutionalRow.foreign || 0, 0, "張") : "--" }}
                </strong>
              </div>
              <div class="quote-inst-card">
                <span>投信</span>
                <strong :class="moveClass(institutionalRow?.trust).replace('is-', '')">
                  {{ institutionalRow ? formatSigned(institutionalRow.trust || 0, 0, "張") : "--" }}
                </strong>
              </div>
              <div class="quote-inst-card">
                <span>自營商</span>
                <strong :class="moveClass(institutionalRow?.dealer).replace('is-', '')">
                  {{ institutionalRow ? formatSigned(institutionalRow.dealer || 0, 0, "張") : "--" }}
                </strong>
              </div>
              <div class="quote-inst-card">
                <span>合計</span>
                <strong :class="moveClass(institutionalRow?.total).replace('is-', '')">
                  {{ institutionalRow ? formatSigned(institutionalRow.total || 0, 0, "張") : "--" }}
                </strong>
              </div>
            </div>
            <div class="quote-window-grid">
              <div
                v-for="item in institutionalWindows"
                :key="item.days"
                class="quote-window-card"
              >
                <span>近 {{ item.days }} 日</span>
                <strong :class="moveClass(item.total).replace('is-', '')">
                  {{ item.count ? formatSigned(item.total, 0, "張") : "--" }}
                </strong>
                <em>
                  外 {{ formatSigned(item.foreign, 0, "張") }} / 投
                  {{ formatSigned(item.trust, 0, "張") }} / 自
                  {{ formatSigned(item.dealer, 0, "張") }}
                </em>
              </div>
            </div>
          </div>

          <div v-else-if="activePanel === 'fundamental'" class="quote-info-panel">
            <div class="quote-info-head">
              <div>
                <div class="quote-section-title">基本面摘要</div>
                <span class="hint">估值、營收、獲利能力與現金流，來源與完整分析頁一致。</span>
              </div>
              <SourceBadge
                :source="fundamentalSnapshot?.source || 'TWSE/TPEX OpenAPI + FinMind'"
                :label="fundamentalLoading ? stageText(fundamentalSnapshot?.loadingStage) : fundamentalSnapshot ? `財報完整度 ${fundamentalSnapshot.dataCompleteness}%` : fundamentalError || '財報待查詢'"
                :type="fundamentalSnapshot ? 'financial' : fundamentalError ? 'fallback' : 'unknown'"
                variant="quote"
              />
            </div>
            <div v-if="fundamentalSnapshot" class="quote-fundamental-grid">
              <div
                v-for="item in fundamentalSnapshot.highlights"
                :key="item.label"
                class="quote-fundamental-card"
              >
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
                <em>{{ item.detail }}</em>
              </div>
              <div
                v-for="metric in fundamentalSnapshot.metrics.slice(0, 6)"
                :key="metric.label"
                class="quote-fundamental-card compact"
                :class="metric.status"
              >
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
                <em>{{ statusText(metric.status) }}</em>
              </div>
            </div>
            <div v-else class="hint depth-empty">
              {{ fundamentalError || "基本面資料載入中..." }}
            </div>
          </div>

          <div v-else class="quote-info-panel">
            <div class="quote-info-head">
              <div>
                <div class="quote-section-title">AI 摘要</div>
                <span class="hint">先用已載入的報價、法人與基本面資料產生本機摘要。</span>
              </div>
              <SourceBadge source="本機摘要" label="本機摘要（推估）" type="computed" variant="quote" />
            </div>
            <ol class="quote-ai-list">
              <li v-for="item in aiSummary" :key="item">{{ item }}</li>
            </ol>
          </div>
        </div>

        <aside
          v-if="['quote', 'chart', 'depth', 'trades'].includes(activePanel)"
          class="quote-side-panel"
        >
          <div class="quote-side-card">
            <span>最高</span>
            <strong class="up">{{ money(stock.high) }}</strong>
            <em>最低 {{ money(stock.low) }}</em>
          </div>
          <div class="quote-side-card">
            <span>開盤</span>
            <strong>{{ money(stock.open) }}</strong>
            <em>參考 {{ money(stock.prev) }}</em>
          </div>
          <div class="quote-side-card">
            <span>買賣力道</span>
            <strong>{{ Math.round(stock.buyPct || 0) }}%</strong>
            <div class="quote-force-line">
              <i class="buy" :style="{ width: `${stock.buyPct || 0}%` }"></i>
              <i class="sell" :style="{ width: `${stock.sellPct || 0}%` }"></i>
            </div>
          </div>
        </aside>
      </section>
    </template>
  </section>
</template>
