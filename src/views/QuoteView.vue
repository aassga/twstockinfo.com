<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import StockChart from "../components/StockChart.vue";
import { useChartStore } from "../stores/chartStore";
import { useInstitutionalStore } from "../stores/institutionalStore";
import { useStockStore } from "../stores/stockStore";
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
const tone = computed(() => moveClass(stock.value?.chgPct).replace("is-", ""));
const quoteSource = computed(() => sourceMeta(stock.value));
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
    label: "買入",
    value: `${Math.round(stock.value?.buyPct || 0)}%`,
    tone: "up",
  },
  {
    label: "賣出",
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
    await stockStore.refreshCurrentStock({ silent: true });
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
  if (!stock.value?.code) return;
  if (value === "institutional") void loadInstitutional(stock.value.code);
  if (value === "fundamental" || value === "ai") void loadFundamental(stock.value, searchRunId);
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

function sourceMeta(current) {
  const source = String(current?.source || "");
  if (source.startsWith("twse-mis")) return { label: "TWSE MIS 即時報價", type: "realtime" };
  if (source.includes("yahoo")) return { label: "Yahoo 備援報價", type: "fallback" };
  if (source.includes("histock")) return { label: "HiStock 排行輔助", type: "fallback" };
  if (source.includes("openapi")) return { label: "交易所 OpenAPI 備援", type: "fallback" };
  return { label: "資料來源待確認", type: "unknown" };
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
          <div class="quote-source-badge" :class="quoteSource.type">
            {{ quoteSource.label }}
          </div>
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
          <span class="quote-source-badge" :class="quoteSource.type">
            {{ quoteSource.label }}
          </span>
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
          <div class="quote-panel-tabs">
            <button
              v-for="panel in panels"
              :key="panel.value"
              class="quote-panel-tab"
              :class="{ active: activePanel === panel.value }"
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
                <span>買賣力道</span>
                <strong>{{ Math.round(stock.buyPct || 0) }}%</strong>
                <div class="quote-force-line">
                  <i class="buy" :style="{ width: `${stock.buyPct || 0}%` }"></i>
                  <i class="sell" :style="{ width: `${stock.sellPct || 0}%` }"></i>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="activePanel === 'chart'" class="quote-chart-section">
            <div class="quote-range-tabs">
              <button
                v-for="item in ranges"
                :key="item.value"
                class="quote-range-btn"
                :class="{ active: activeRange === item.value }"
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

          <div v-else-if="activePanel === 'institutional'" class="quote-info-panel">
            <div class="quote-info-head">
              <div>
                <div class="quote-section-title">法人與籌碼趨勢</div>
                <span class="hint">單日法人與近 5 / 10 / 20 日累計買賣超。</span>
              </div>
              <span class="quote-source-badge" :class="institutionalRow ? 'realtime' : 'unknown'">
                {{ institutionalLoading ? "載入中" : institutionalRow ? "法人完成" : "無資料" }}
              </span>
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
              <span
                class="quote-source-badge"
                :class="fundamentalSnapshot ? 'realtime' : fundamentalError ? 'fallback' : 'unknown'"
              >
                {{
                  fundamentalLoading
                    ? stageText(fundamentalSnapshot?.loadingStage)
                    : fundamentalSnapshot
                      ? `完整度 ${fundamentalSnapshot.dataCompleteness}%`
                      : fundamentalError || "待查詢"
                }}
              </span>
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
              <span class="quote-source-badge unknown">本機摘要</span>
            </div>
            <ol class="quote-ai-list">
              <li v-for="item in aiSummary" :key="item">{{ item }}</li>
            </ol>
          </div>
        </div>

        <aside
          v-if="['quote', 'chart', 'depth'].includes(activePanel)"
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
