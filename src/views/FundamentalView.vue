<script setup>
import { computed, ref, watch } from 'vue';
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
import { fetchFundamentalSnapshot } from '../api/fundamentalApi';
import { useStockStore } from '../stores/stockStore';
import { formatDateTime, formatMoney, formatPct, formatVolume, moveClass } from '../utils/formatters';
import { quickStocks } from '../utils/stockMeta';

const stockStore = useStockStore();
const query = ref(stockStore.currentStock?.code || '');
const snapshot = ref(null);
const loading = ref(false);
const error = ref('');
const activeTab = ref('overview');
const candidates = ref([]);
const showCandidates = ref(false);
const candidateLimit = 20;
const stockCodePattern = /^\d{4,6}[a-z]?$/i;
let candidateTimer = null;

const tabs = [
  { key: 'overview', label: '總覽', icon: IconReportAnalytics },
  { key: 'metrics', label: '財務指標', icon: IconChartBar },
  { key: 'statements', label: '三大財報', icon: IconTable },
  { key: 'qualitative', label: '質化分析', icon: IconShieldCheck },
  { key: 'ai', label: 'AI 長期觀點', icon: IconBrain }
];

const company = computed(() => snapshot.value?.company || null);
const changeClass = computed(() => moveClass(company.value?.chgPct).replace('is-', ''));

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
  loading.value = true;
  error.value = '';
  showCandidates.value = false;

  try {
    const stock = await stockStore.searchStock(code);
    query.value = stock.code;
    snapshot.value = await fetchFundamentalSnapshot(stock);
    activeTab.value = 'overview';
  } catch (err) {
    error.value = err?.message || '基本面資料讀取失敗';
  } finally {
    loading.value = false;
  }
}

function selectCandidate(stock) {
  runSearch(stock.code);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
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
