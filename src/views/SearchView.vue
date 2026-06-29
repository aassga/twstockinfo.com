<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IconBriefcase,
  IconChartCandle,
  IconMinus,
  IconSearch,
  IconShield,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconTrendingDown,
  IconTrendingUp,
  IconWorld
} from '@tabler/icons-vue';
import { useChartStore } from '../stores/chartStore';
import { useFavoriteStore } from '../stores/favoriteStore';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { useStockStore } from '../stores/stockStore';
import { formatMoney, formatNumber, formatPct, formatSigned, moveClass } from '../utils/formatters';
import { quickStocks } from '../utils/stockMeta';

const router = useRouter();
const stockStore = useStockStore();
const portfolioStore = usePortfolioStore();
const chartStore = useChartStore();
const favoriteStore = useFavoriteStore();
const institutionalStore = useInstitutionalStore();
const query = ref(stockStore.searchQuery || '');
const aiText = ref('點擊「AI 深度分析」取得個股分析報告');

const stock = computed(() => stockStore.currentStock);
const inst = computed(() => institutionalStore.rows.find(row => row.code === stock.value?.code) || null);
const dominantBuy = computed(() => Number(stock.value?.buyPct || 0) >= Number(stock.value?.sellPct || 0));
const changeClass = computed(() => moveClass(stock.value?.chgPct).replace('is-', ''));
const quoteMetrics = computed(() => {
  const current = stock.value;
  if (!current) return [];

  const trend = moveClass(current.change).replace('is-', '');
  const high = Number(current.high || 0);
  const low = Number(current.low || 0);
  const range = high && low ? Number((high - low).toFixed(2)) : 0;
  const amount = Number(current.amountHundredMillion || 0);

  return [
    { label: '股價', value: formatPriceValue(current.price), detail: '目前成交', tone: 'price' },
    { label: '漲跌', value: formatSigned(current.change, 2), detail: '較昨收', tone: trend },
    { label: '漲跌幅(%)', value: formatPct(current.chgPct), detail: '百分比變動', tone: trend },
    { label: '最高', value: formatPriceValue(high), detail: '盤中高點', tone: 'high' },
    { label: '最低', value: formatPriceValue(low), detail: '盤中低點', tone: 'low' },
    { label: '價差', value: formatPriceValue(range), detail: '最高 - 最低', tone: 'range' },
    { label: '成交量(張)', value: formatPlainNumber(Number(current.volume || 0) / 1000), detail: '累計張數', tone: 'volume' },
    { label: '成交金額(億)', value: formatPlainNumber(amount, 2), detail: '累計成交值', tone: 'amount' }
  ];
});

function formatPriceValue(value) {
  const number = Number(value || 0);
  return number > 0 ? formatMoney(number, 2) : '--';
}

function formatPlainNumber(value, digits = 0) {
  const number = Number(value || 0);
  return number > 0 ? formatNumber(number, digits) : '--';
}

function formatInstValue(value) {
  if (!inst.value && institutionalStore.loading) return '載入中';
  if (!inst.value && institutionalStore.loaded) return '無資料';
  return formatSigned(value || 0, 2, '億');
}

function barWidth(value) {
  return `${Math.min(Math.max(Number(value || 0), 0), 100)}%`;
}

async function submit(value = query.value) {
  if (!value) return;
  const result = await stockStore.searchStock(value);
  query.value = result.code;
  if (!institutionalStore.loaded) {
    await institutionalStore.loadInstitutional({ silent: true });
  }
}

function quickSearch(code) {
  submit(code);
}

function addToPortfolio() {
  if (!stock.value) return;
  portfolioStore.setDraftFromStock(stock.value);
  router.push('/portfolio');
}

function toggleFavorite() {
  if (!stock.value) return;
  favoriteStore.toggleFavorite(stock.value);
}

async function openChart() {
  if (!stock.value) return;
  await chartStore.openStock(stock.value);
  router.push('/chart');
}

function analyze(type) {
  if (!stock.value) return;
  const s = stock.value;
  const instTotal = inst.value?.total || 0;
  if (type === 'tech') {
    aiText.value = [
      `${s.code} ${s.name} 技術面觀察`,
      `目前漲跌幅 ${formatPct(s.chgPct)}，量比 ${Math.round(s.volRatio || 0)}%。`,
      `買賣力道為買入 ${Math.round(s.buyPct)}% / 賣出 ${Math.round(s.sellPct)}%。`,
      s.chgPct >= 0 ? '價格偏強，若量能延續可觀察突破後是否站穩。' : '價格偏弱，先觀察是否止跌並守住前低。'
    ].join('\n');
    return;
  }
  if (type === 'risk') {
    aiText.value = [
      `${s.code} ${s.name} 風險評估`,
      `法人合計 ${formatSigned(instTotal, 2, '億')}。`,
      s.sellPct >= 62 ? '賣方力道偏高，短線需提高防守。' : '目前未見明顯單邊賣壓。',
      '此分析為本機規則推估，不構成投資建議。'
    ].join('\n');
    return;
  }
  aiText.value = [
    `${s.code} ${s.name} 個股深度分析`,
    `產業：${s.sector}，現價 ${formatMoney(s.price, 2)}，漲跌幅 ${formatPct(s.chgPct)}。`,
    `籌碼面：買入 ${Math.round(s.buyPct)}%，賣出 ${Math.round(s.sellPct)}%，${dominantBuy.value ? '買入主導' : '賣出主導'}。`,
    `法人面：外資 ${formatSigned(inst.value?.foreign || 0, 2, '億')}，投信 ${formatSigned(inst.value?.trust || 0, 2, '億')}，自營商 ${formatSigned(inst.value?.dealer || 0, 2, '億')}。`,
    '操作上建議搭配走勢圖確認支撐壓力與量能延續。'
  ].join('\n');
}
</script>

<template>
  <section class="tab-content active">
    <div class="page-title">
      <IconSearch class="title-icon" :stroke-width="2" />
      股票搜尋分析
    </div>

    <div class="search-row">
      <input
        v-model="query"
        class="search-input"
        placeholder="輸入股票代號或名稱，例如：2330 或 台積電"
        @keydown.enter="submit()"
      />
      <button class="btn primary" type="button" @click="submit()">
        <IconSearch class="btn-icon" :stroke-width="2" />
        搜尋
      </button>
    </div>

    <div class="quick-picks">
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

    <div v-if="stock" class="search-result">
      <div class="result-header">
        <div class="result-meta">
          <div class="result-code">{{ stock.code }}</div>
          <div class="result-name">{{ stock.name }}</div>
          <div class="result-sector">{{ stock.sector }}</div>
        </div>
        <div class="result-price-block">
          <div class="result-price">{{ formatMoney(stock.price, 2) }}</div>
          <div class="result-chg" :class="changeClass">
            {{ stock.chgPct >= 0 ? '▲' : '▼' }} {{ formatSigned(stock.change, 2) }}
            ({{ formatPct(stock.chgPct) }})
          </div>
        </div>
        <div class="result-dominant">
          <span class="dominant-label">當前主力</span>
          <span class="dominant-tag" :class="dominantBuy ? 'buy' : 'sell'">
            {{ dominantBuy ? '買入主導' : '賣出主導' }}
          </span>
        </div>
      </div>

      <div class="quote-metrics-panel" aria-label="個股即時指標">
        <div
          v-for="metric in quoteMetrics"
          :key="metric.label"
          class="quote-metric-cell"
          :class="metric.tone"
        >
          <div class="quote-metric-label">{{ metric.label }}</div>
          <div class="quote-metric-value">{{ metric.value }}</div>
          <div class="quote-metric-detail">{{ metric.detail }}</div>
        </div>
      </div>

      <div class="result-body">
        <div class="result-col">
          <div class="col-title">買賣力道</div>
          <div class="buysell-bars">
            <div class="bs-row">
              <span class="bs-label buy">買入</span>
              <div class="bs-track"><div class="bs-fill buy" :style="{ width: `${stock.buyPct}%` }"></div></div>
              <span class="bs-pct buy">{{ Math.round(stock.buyPct) }}%</span>
            </div>
            <div class="bs-row">
              <span class="bs-label sell">賣出</span>
              <div class="bs-track"><div class="bs-fill sell" :style="{ width: `${stock.sellPct}%` }"></div></div>
              <span class="bs-pct sell">{{ Math.round(stock.sellPct) }}%</span>
            </div>
            <div class="bs-row">
              <span class="bs-label vol">量比</span>
              <div class="bs-track"><div class="bs-fill vol" :style="{ width: barWidth(stock.volRatio) }"></div></div>
              <span class="bs-pct vol">{{ Math.round(stock.volRatio) }}%</span>
            </div>
          </div>
          <div class="vs-summary">
            <IconTrendingUp v-if="dominantBuy" class="inline-icon" :stroke-width="2" />
            <IconTrendingDown v-else class="inline-icon" :stroke-width="2" />
            {{ dominantBuy ? '買方較強，市場偏多' : '賣方較強，留意拉回' }}
          </div>
        </div>

        <div class="result-col">
          <div class="col-title">三大法人</div>
          <div class="inst-cards">
            <div class="inst-card">
              <div class="inst-icon foreign"><IconWorld class="inline-icon" :stroke-width="2" /></div>
              <div class="inst-info">
                <div class="inst-name">外資</div>
                <div class="inst-val" :class="moveClass(inst?.foreign).replace('is-', '')">
                  {{ formatInstValue(inst?.foreign) }}
                </div>
              </div>
            </div>
            <div class="inst-card">
              <div class="inst-icon trust"><IconTrendingUp class="inline-icon" :stroke-width="2" /></div>
              <div class="inst-info">
                <div class="inst-name">投信</div>
                <div class="inst-val" :class="moveClass(inst?.trust).replace('is-', '')">
                  {{ formatInstValue(inst?.trust) }}
                </div>
              </div>
            </div>
            <div class="inst-card">
              <div class="inst-icon dealer"><IconMinus class="inline-icon" :stroke-width="2" /></div>
              <div class="inst-info">
                <div class="inst-name">自營商</div>
                <div class="inst-val" :class="moveClass(inst?.dealer).replace('is-', '')">
                  {{ formatInstValue(inst?.dealer) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="ai-box">
        <div class="ai-box-header">
          <IconSparkles class="inline-icon" :stroke-width="2" />
          AI 個股深度分析
        </div>
        <div class="ai-content">
          <span v-if="!aiText" class="hint">點擊「AI 深度分析」取得個股分析報告</span>
          <span v-else>{{ aiText }}</span>
        </div>
      </div>

      <div class="result-actions">
        <button class="btn" type="button" @click="addToPortfolio">
          <IconBriefcase class="btn-icon" :stroke-width="2" />
          加入持股
        </button>
        <button
          class="btn"
          :class="{ 'favorite-action-active': favoriteStore.isFavorite(stock.code) }"
          type="button"
          @click="toggleFavorite"
        >
          <IconStarFilled v-if="favoriteStore.isFavorite(stock.code)" class="btn-icon" :stroke-width="2" />
          <IconStar v-else class="btn-icon" :stroke-width="2" />
          {{ favoriteStore.isFavorite(stock.code) ? '已加入我的最愛' : '加入我的最愛' }}
        </button>
        <button class="btn" type="button" @click="openChart">
          <IconChartCandle class="btn-icon" :stroke-width="2" />
          走勢圖
        </button>
        <button class="btn primary" type="button" @click="analyze('deep')">
          <IconSparkles class="btn-icon" :stroke-width="2" />
          AI 深度分析
        </button>
        <button class="btn" type="button" @click="analyze('tech')">
          <IconTrendingUp class="btn-icon" :stroke-width="2" />
          技術面分析
        </button>
        <button class="btn" type="button" @click="analyze('risk')">
          <IconShield class="btn-icon" :stroke-width="2" />
          風險評估
        </button>
      </div>
    </div>

    <div v-else class="empty-state">
      <IconChartCandle class="title-icon" :size="48" :stroke-width="1.8" />
      <p>輸入股票代號或名稱開始分析</p>
      <small>支援台股代號搜尋，例如 2330、2317、0050</small>
    </div>
  </section>
</template>
