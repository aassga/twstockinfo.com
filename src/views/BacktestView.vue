<script setup>
import { computed, ref } from 'vue';
import { showToast } from 'vant';
import 'vant/es/toast/style';
import {
  IconChartDots,
  IconInfoCircle,
  IconSearch,
  IconTrendingUp
} from '@tabler/icons-vue';
import SourceBadge from '../components/SourceBadge.vue';
import { fetchFundamentalSnapshotPhased } from '../api/fundamentalApi';
import { stockApi } from '../api/stockApi';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { useStockStore } from '../stores/stockStore';
import { buildStrategyBacktest } from '../utils/backtest';
import { formatMoney, formatPct, moveClass } from '../utils/formatters';
import { quickStocks } from '../utils/stockMeta';

const stockStore = useStockStore();
const institutionalStore = useInstitutionalStore();
const query = ref(stockStore.currentStock?.code || stockStore.activeCode || '2330');
const stock = ref(null);
const candles = ref([]);
const institutionalRows = ref([]);
const marginRows = ref([]);
const loading = ref(false);
const error = ref('');
const loadSteps = ref({
  quote: '待查詢',
  chart: '待查詢',
  institutional: '待查詢',
  margin: '待查詢'
});

const results = computed(() =>
  buildStrategyBacktest({
    candles: candles.value,
    institutionalTrend: institutionalRows.value,
    marginRows: marginRows.value
  })
);
const bestSummary = computed(() => {
  const rows = results.value.flatMap(strategy =>
    strategy.windows.map(window => ({
      strategy: strategy.label,
      ...window
    }))
  ).filter(row => row.samples >= 2 && Number.isFinite(row.avgReturn));

  return rows.sort((a, b) => Number(b.avgReturn) - Number(a.avgReturn))[0] || null;
});
const totalSignals = computed(() => results.value.reduce((sum, row) => sum + row.events.length, 0));
const latestSignal = computed(() =>
  results.value
    .map(row => row.latestEvent ? { ...row.latestEvent, strategy: row.label } : null)
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null
);
const hasResult = computed(() => stock.value && candles.value.length);

async function runBacktest(value = query.value) {
  const input = String(value || '').trim();
  if (!input || loading.value) return;

  loading.value = true;
  error.value = '';
  candles.value = [];
  institutionalRows.value = [];
  marginRows.value = [];
  loadSteps.value = {
    quote: '查詢中',
    chart: '待查詢',
    institutional: '待查詢',
    margin: '待查詢'
  };

  try {
    const nextStock = await stockStore.searchStock(input);
    stock.value = nextStock;
    query.value = nextStock.code;
    loadSteps.value.quote = '完成';

    loadSteps.value.chart = '查詢中';
    const chartResult = await stockApi.chart(nextStock.code, '1Y', nextStock.exchange || '');
    candles.value = chartResult.candles || [];
    loadSteps.value.chart = candles.value.length ? '完成' : '無資料';

    loadSteps.value.institutional = '查詢中';
    institutionalRows.value = await institutionalStore.loadInstitutionalTrendByCode(nextStock.code, { force: true }).catch(() => []);
    loadSteps.value.institutional = institutionalRows.value.length ? '完成' : '無資料';

    loadSteps.value.margin = '查詢中';
    const snapshot = await fetchFundamentalSnapshotPhased(nextStock, () => {}).catch(() => null);
    marginRows.value = snapshot?.marginTrading?.recentRows || [];
    loadSteps.value.margin = marginRows.value.length ? '完成' : '無資料';
  } catch (err) {
    error.value = err?.message || '回測資料取得失敗';
    showToast(error.value);
  } finally {
    loading.value = false;
  }
}

function quickSearch(code) {
  query.value = code;
  runBacktest(code);
}

function signalTone(value) {
  return moveClass(value).replace('is-', '');
}

function formatReturn(value) {
  return Number.isFinite(Number(value)) ? formatPct(Number(value), 2) : '--';
}

function formatWinRate(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(value)}%` : '--';
}

function formatSamples(value) {
  return Number(value || 0).toLocaleString('zh-TW');
}

function stepClass(value) {
  if (value === '完成') return 'done';
  if (value === '查詢中') return 'loading';
  if (value === '無資料') return 'warning';
  return 'idle';
}
</script>

<template>
  <section class="tab-content active backtest-view">
    <div class="page-title">
      <IconChartDots class="title-icon" :stroke-width="2" />
      回測 / 策略驗證
    </div>
    <div class="page-purpose">
      驗證訊號發生後 1 / 3 / 5 / 10 日的平均報酬與勝率，用歷史統計檢查策略是否真的有參考價值。
    </div>

    <div class="search-bar">
      <input
        v-model="query"
        placeholder="輸入股票代號或名稱，例如：2330 或 台積電"
        @keydown.enter="runBacktest()"
      />
      <button class="primary-btn" type="button" :disabled="loading" @click="runBacktest()">
        <IconSearch class="btn-icon" :stroke-width="2" />
        {{ loading ? '回測中' : '開始回測' }}
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

    <div class="source-row">
      <SourceBadge source="Yahoo Chart" label="股價報酬" />
      <SourceBadge source="TWSE / HiStock" label="法人趨勢" />
      <SourceBadge source="FinMind" label="融資融券" />
      <SourceBadge source="本機策略模型" label="本機策略模型（推估）" type="computed" />
    </div>

    <div class="backtest-step-grid">
      <article v-for="(value, key) in loadSteps" :key="key" class="backtest-step" :class="stepClass(value)">
        <span>{{ key === 'quote' ? '報價' : key === 'chart' ? '走勢' : key === 'institutional' ? '法人' : '融資' }}</span>
        <strong>{{ value }}</strong>
      </article>
    </div>

    <div v-if="error" class="health-note">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      {{ error }}
    </div>

    <template v-if="hasResult">
      <div class="backtest-hero">
        <div>
          <span>回測標的</span>
          <strong>{{ stock.code }} {{ stock.name || '' }}</strong>
          <em>{{ candles.length }} 根日 K，法人 {{ institutionalRows.length }} 筆，融資 {{ marginRows.length }} 筆</em>
        </div>
        <div>
          <span>目前股價</span>
          <strong>{{ formatMoney(stock.price, 2) }}</strong>
          <em :class="signalTone(stock.chgPct)">{{ formatPct(stock.chgPct || 0) }}</em>
        </div>
        <div>
          <span>總訊號數</span>
          <strong>{{ totalSignals }}</strong>
          <em>{{ latestSignal ? `最近 ${latestSignal.date}：${latestSignal.strategy}` : '目前樣本不足' }}</em>
        </div>
        <div>
          <span>最佳統計</span>
          <strong>{{ bestSummary ? formatReturn(bestSummary.avgReturn) : '--' }}</strong>
          <em>{{ bestSummary ? `${bestSummary.strategy} / ${bestSummary.days} 日` : '至少需要 2 筆樣本' }}</em>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table backtest-table">
          <thead>
            <tr>
              <th>策略</th>
              <th>樣本</th>
              <th>1日</th>
              <th>3日</th>
              <th>5日</th>
              <th>10日</th>
              <th>最近訊號</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="strategy in results" :key="strategy.key">
              <td>
                <strong>{{ strategy.label }}</strong>
                <span>{{ strategy.description }}</span>
              </td>
              <td>{{ formatSamples(strategy.events.length) }}</td>
              <td v-for="window in strategy.windows" :key="window.days">
                <strong :class="signalTone(window.avgReturn)">
                  {{ formatReturn(window.avgReturn) }}
                </strong>
                <span>勝率 {{ formatWinRate(window.winRate) }} / {{ window.samples }} 筆</span>
              </td>
              <td>
                <strong>{{ strategy.latestEvent?.date || '--' }}</strong>
                <span>{{ strategy.latestEvent?.signal || '尚無訊號' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="backtest-card-grid">
        <article v-for="strategy in results" :key="`${strategy.key}-events`" class="backtest-card">
          <div class="panel-title">
            <IconTrendingUp class="inline-icon" :stroke-width="2" />
            {{ strategy.label }}
          </div>
          <div v-if="strategy.events.length" class="backtest-event-list">
            <div v-for="event in strategy.events.slice(-5).reverse()" :key="`${strategy.key}-${event.date}`">
              <span>{{ event.date }}</span>
              <strong>{{ event.signal }}</strong>
              <em>
                1日 {{ formatReturn(event.returns[1]) }} /
                5日 {{ formatReturn(event.returns[5]) }} /
                10日 {{ formatReturn(event.returns[10]) }}
              </em>
            </div>
          </div>
          <div v-else class="hint">
            樣本不足，代表近一年沒有符合此策略的歷史訊號，或資料來源尚未提供。
          </div>
        </article>
      </div>
    </template>

    <div v-else-if="!loading" class="empty-state">
      <IconChartDots class="title-icon" :size="42" :stroke-width="1.8" />
      <span>輸入股票代號開始回測</span>
      <em>第一版使用近一年日線與可取得的法人 / 融資資料。</em>
    </div>
  </section>
</template>
