<script setup>
import { computed, ref } from 'vue';
import {
  IconActivityHeartbeat,
  IconAlertTriangle,
  IconDatabaseSearch,
  IconRefresh,
  IconTrash
} from '@tabler/icons-vue';
import { apiFetch, apiTextFetch, clearApiHttpCache, getApiHttpCacheStats } from '../api/http';
import { apiHealthState, clearApiHealth } from '../api/apiHealth';
import { useSystemStore } from '../stores/systemStore';
import SourceBadge from '../components/SourceBadge.vue';
import { config } from '../config';

const EXPECTED_PROXY_VERSION = '2026-07-11-health-v1';
const MONITORED_SOURCES = [
  {
    key: 'proxy',
    groupKey: 'proxy',
    label: 'Worker Proxy',
    source: 'Cloudflare Worker',
    requirement: 'proxy-status 應回傳新版版本號'
  },
  {
    key: 'mis',
    groupKey: 'twse-mis',
    label: 'TWSE MIS',
    source: 'TWSE MIS 即時報價',
    requirement: '即時報價主來源'
  },
  {
    key: 'yahoo',
    groupKey: 'yahoo-chart',
    label: 'Yahoo Chart',
    source: 'Yahoo Chart',
    requirement: '走勢圖與 K 線資料'
  },
  {
    key: 'finmind',
    groupKey: 'finmind',
    label: 'FinMind',
    source: 'FinMind',
    requirement: '財報、籌碼、信用交易補充'
  },
  {
    key: 'tpex',
    groupKey: 'tpex-openapi',
    label: 'TPEX',
    source: 'TPEX OpenAPI',
    requirement: '上櫃股日資料與估值資料，需注意 rate limit'
  }
];

const systemStore = useSystemStore();
const checkRows = ref(createCheckRows());
const isChecking = ref(false);
const lastCheckedAt = ref('');

const cacheStats = computed(() => getApiHttpCacheStats());
const groups = computed(() =>
  Object.values(apiHealthState.groups)
    .slice()
    .sort((a, b) => {
      if (b.error !== a.error) return b.error - a.error;
      return String(b.lastUpdatedAt || '').localeCompare(String(a.lastUpdatedAt || ''));
    })
);
const recentCalls = computed(() => apiHealthState.calls.slice(0, 30));
const frontendErrors = computed(() => systemStore.errors.slice(0, 12));
const monitoredSourceRows = computed(() =>
  MONITORED_SOURCES.map(item => {
    const group = apiHealthState.groups[item.groupKey] || {};
    const checkRow = checkRows.value.find(row => row.key === item.key) || {};
    const status = monitoredStatus(group, checkRow);
    return {
      ...item,
      status,
      statusText: monitoredStatusText(status),
      lastSuccessAt: group.lastSuccessAt || checkRow.successAt || '',
      lastErrorAt: group.lastErrorAt || checkRow.failedAt || '',
      failures: Number(group.error || 0),
      cacheHits: Number(group.cache || 0),
      deduped: Number(group.deduped || 0),
      durationMs: group.lastDurationMs || checkRow.durationMs || 0,
      note: monitoredNote(item, group, checkRow)
    };
  })
);
const healthSummary = computed(() => {
  const total = apiHealthState.counters.success + apiHealthState.counters.error;
  const okRate = total ? Math.round((apiHealthState.counters.success / total) * 100) : 100;
  const activeErrors = groups.value.filter(group => group.lastStatus === 'error').length;
  return {
    total,
    okRate,
    activeErrors,
    status: activeErrors ? '需檢查' : '正常'
  };
});

async function runAllChecks() {
  if (isChecking.value) return;
  isChecking.value = true;
  checkRows.value = createCheckRows();

  try {
    for (const row of checkRows.value) {
      await runCheck(row);
      await sleep(120);
    }
    lastCheckedAt.value = new Date().toISOString();
  } finally {
    isChecking.value = false;
  }
}

async function runCheck(row) {
  row.status = 'loading';
  row.message = '檢查中';
  row.durationMs = 0;
  row.error = '';
  const startedAt = Date.now();

  try {
    if (row.kind === 'json') {
      const data = await apiFetch(row.path, { ttlMs: 0 });
      applyCheckDetail(row, data);
    } else {
      const text = await apiTextFetch(row.path, { ttlMs: 0 });
      applyCheckDetail(row, text);
    }
    row.status = 'done';
    row.message = '可取得';
    row.successAt = new Date().toISOString();
  } catch (error) {
    row.status = 'error';
    row.message = '請求失敗';
    row.error = error?.message || String(error);
    row.failedAt = new Date().toISOString();
  } finally {
    row.durationMs = Date.now() - startedAt;
  }
}

function clearRuntimeCache() {
  clearApiHttpCache();
}

function resetHealthLog() {
  clearApiHealth();
  systemStore.clearErrors();
  checkRows.value = createCheckRows();
  lastCheckedAt.value = '';
}

function createCheckRows() {
  return [
    {
      key: 'proxy',
      label: 'Worker Proxy',
      source: 'Cloudflare Worker',
      path: '/proxy-status',
      kind: 'json',
      status: 'idle',
      message: '待檢查',
      detail: ''
    },
    {
      key: 'mis',
      label: '即時報價',
      source: 'TWSE MIS 即時報價',
      path: `/mis/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent('tse_2330.tw')}&json=1&delay=0`,
      kind: 'json',
      status: 'idle',
      message: '待檢查',
      detail: ''
    },
    {
      key: 'yahoo',
      label: '走勢圖',
      source: 'Yahoo Chart',
      path: `/yahoo/v8/finance/chart/${encodeURIComponent('2330.TW')}?range=1d&interval=1m&includePrePost=false`,
      kind: 'json',
      status: 'idle',
      message: '待檢查',
      detail: ''
    },
    {
      key: 'twse-stock',
      label: '上市日資料',
      source: 'TWSE OpenAPI',
      path: '/twse/exchangeReport/STOCK_DAY_ALL',
      kind: 'json',
      status: 'idle',
      message: '待檢查',
      detail: ''
    },
    {
      key: 'twse-volume',
      label: '成交量前 20',
      source: 'TWSE 盤後排行',
      path: '/rwd/zh/afterTrading/MI_INDEX20?response=json',
      kind: 'json',
      status: 'idle',
      message: '待檢查',
      detail: ''
    },
    {
      key: 'tpex',
      label: '上櫃日資料',
      source: 'TPEX OpenAPI',
      path: '/tpex/openapi/v1/tpex_mainboard_daily_close_quotes',
      kind: 'json',
      status: 'idle',
      message: '待檢查',
      detail: ''
    },
    {
      key: 'finmind',
      label: '財務資料',
      source: 'FinMind',
      path: `/finmind/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=2330&start_date=${recentStartDate()}`,
      kind: 'json',
      status: 'idle',
      message: '待檢查',
      detail: ''
    },
    {
      key: 'histock',
      label: '排行輔助',
      source: 'HiStock',
      path: '/histock/stock/rank.aspx?p=all',
      kind: 'text',
      status: 'idle',
      message: '待檢查',
      detail: ''
    }
  ];
}

function applyCheckDetail(row, payload) {
  if (row.key === 'proxy') {
    const version = payload?.version || '';
    const features = payload?.features || {};
    const enabledCount = Object.values(features).filter(Boolean).length;
    row.proxyVersion = version;
    row.versionOk = version === EXPECTED_PROXY_VERSION;
    row.detail = version
      ? `Worker ${row.versionOk ? '新版' : '版本不符'}：${version}，功能 ${enabledCount} 項`
      : 'Worker 可連通，但尚未回傳版本號，可能尚未部署新版';
    return;
  }

  if (row.key === 'tpex') {
    const count = Array.isArray(payload) ? payload.length : 0;
    row.detail = count ? `取得 ${count} 筆，上櫃來源正常` : '可連通，但回傳資料為空';
    return;
  }

  if (row.key === 'mis') {
    const count = Array.isArray(payload?.msgArray) ? payload.msgArray.length : 0;
    row.detail = count ? `取得 ${count} 筆即時報價` : '可連通，但未取得報價陣列';
    return;
  }

  if (row.key === 'yahoo') {
    const result = payload?.chart?.result?.[0];
    row.detail = result ? '走勢圖資料正常' : '可連通，但 Yahoo chart 沒有 result';
    return;
  }

  if (row.key === 'finmind') {
    const count = Array.isArray(payload?.data) ? payload.data.length : 0;
    row.detail = count ? `取得 ${count} 筆 FinMind 資料` : '可連通，但 FinMind data 為空';
    return;
  }

  if (typeof payload === 'string') {
    row.detail = `取得文字內容 ${payload.length} bytes`;
  }
}

function monitoredStatus(group, checkRow) {
  if (checkRow.status === 'loading' || group.lastStatus === 'loading') return 'loading';
  if (checkRow.key === 'proxy' && checkRow.status === 'done' && checkRow.versionOk === false) return 'warning';
  if (checkRow.status === 'error' || group.lastStatus === 'error') return 'error';
  if (group.lastStatus === 'cache' || group.lastStatus === 'deduped') return 'cache';
  if (checkRow.status === 'done' || group.success > 0) return 'done';
  return 'idle';
}

function monitoredStatusText(status) {
  if (status === 'done') return '正常';
  if (status === 'loading') return '檢查中';
  if (status === 'error') return '異常';
  if (status === 'cache') return '快取中';
  if (status === 'warning') return '需部署';
  return '待檢查';
}

function monitoredNote(item, group, checkRow) {
  const errorText = `${checkRow.error || ''} ${group.lastError || ''}`;
  if (item.key === 'tpex' && /429|rate limit|too many/i.test(errorText)) {
    return 'TPEX 可能被 rate limit，請稍後再試或依賴快取資料';
  }
  if (item.key === 'proxy' && checkRow.status === 'done' && checkRow.versionOk === false) {
    return checkRow.detail || 'Worker 尚未部署新版 proxy-status';
  }
  return checkRow.detail || group.lastError || item.requirement;
}

function recentStartDate() {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  return date.toISOString().slice(0, 10);
}

function statusText(status) {
  if (status === 'done' || status === 'success') return '正常';
  if (status === 'loading') return '檢查中';
  if (status === 'error') return '異常';
  if (status === 'cache') return '快取';
  if (status === 'deduped') return '合併';
  return '待檢查';
}

function statusClass(status) {
  if (status === 'done' || status === 'success') return 'done';
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  if (status === 'warning') return 'warning';
  if (status === 'cache' || status === 'deduped') return 'cache';
  return 'idle';
}

function formatDateTime(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatPath(path) {
  const value = String(path || '');
  return value.length > 92 ? `${value.slice(0, 92)}...` : value;
}

function formatErrorMessage(error) {
  const value = String(error?.message || error || '');
  return value.length > 120 ? `${value.slice(0, 120)}...` : value || '--';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
</script>

<template>
  <section class="tab-content active data-health-view">
    <div class="section-toolbar">
      <div class="page-title">
        <IconDatabaseSearch class="title-icon" :stroke-width="2" />
        資料健康檢查
      </div>
      <div class="toolbar-actions">
        <button class="btn primary" type="button" :disabled="isChecking" @click="runAllChecks">
          <IconActivityHeartbeat class="btn-icon" :stroke-width="2" />
          執行檢查
        </button>
        <button class="btn" type="button" @click="clearRuntimeCache">
          <IconRefresh class="btn-icon" :stroke-width="2" />
          清除 API 快取
        </button>
        <button class="btn" type="button" @click="resetHealthLog">
          <IconTrash class="btn-icon" :stroke-width="2" />
          清除紀錄
        </button>
      </div>
    </div>

    <div class="health-summary-grid">
      <article class="health-summary-card" :class="{ error: healthSummary.activeErrors }">
        <span>整體狀態</span>
        <strong>{{ healthSummary.status }}</strong>
        <em>成功率 {{ healthSummary.okRate }}%</em>
      </article>
      <article class="health-summary-card">
        <span>Worker</span>
        <strong>{{ config.proxyBase }}</strong>
        <em>所有跨網域資料統一經過此 proxy</em>
      </article>
      <article class="health-summary-card">
        <span>執行中 / 快取</span>
        <strong>{{ cacheStats.inflight }} / {{ cacheStats.cached }}</strong>
        <em>in-flight 請求會自動合併</em>
      </article>
      <article class="health-summary-card">
        <span>最後檢查</span>
        <strong>{{ formatDateTime(lastCheckedAt || apiHealthState.lastUpdatedAt) }}</strong>
        <em>最近 {{ recentCalls.length }} 筆請求保留在本機</em>
      </article>
      <article class="health-summary-card" :class="{ error: systemStore.errorCount }">
        <span>前端錯誤</span>
        <strong>{{ systemStore.errorCount }}</strong>
        <em>{{ systemStore.latestError?.context || '目前無錯誤' }}</em>
      </article>
      <article class="health-summary-card" :class="{ cache: systemStore.updateAvailable }">
        <span>PWA 版本</span>
        <strong>{{ systemStore.updateAvailable ? '可更新' : '目前版本' }}</strong>
        <em>{{ systemStore.updateAvailable ? '有新版快取等待套用' : '尚未收到更新提示' }}</em>
      </article>
    </div>

    <div class="table-hint">
      本地開發若看到 <strong>ERR_CACHE_READ_FAILURE 304</strong>，通常是 Chrome / Vite / Service Worker 舊快取；目前 dev server 已設定 no-store，必要時再清除瀏覽器站台資料。
    </div>

    <section class="health-section">
      <div class="section-title">核心來源狀態</div>
      <div class="table-wrap">
        <table class="data-table health-source-table">
          <thead>
            <tr>
              <th>來源</th>
              <th>狀態</th>
              <th>最後成功</th>
              <th>失敗次數</th>
              <th>快取 / 合併</th>
              <th>最後耗時</th>
              <th>說明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in monitoredSourceRows" :key="row.key">
              <td>
                <strong>{{ row.label }}</strong>
                <SourceBadge :source="row.source" />
              </td>
              <td>
                <span class="status-pill" :class="statusClass(row.status)">
                  {{ row.statusText }}
                </span>
              </td>
              <td>{{ formatDateTime(row.lastSuccessAt) }}</td>
              <td :class="{ up: row.failures > 0 }">{{ row.failures }}</td>
              <td>{{ row.cacheHits }} / {{ row.deduped }}</td>
              <td>{{ row.durationMs || 0 }}ms</td>
              <td class="health-path-cell" :title="row.note">{{ row.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="health-section">
      <div class="section-title">來源連通檢查</div>
      <div class="health-check-grid">
        <article
          v-for="row in checkRows"
          :key="row.key"
          class="health-check-card"
          :class="statusClass(row.status)"
        >
          <div>
            <strong>{{ row.label }}</strong>
            <SourceBadge :source="row.source" />
          </div>
          <span>{{ row.message }} · {{ row.durationMs || 0 }}ms</span>
          <em>{{ row.error || row.detail || formatPath(row.path) }}</em>
        </article>
      </div>
    </section>

    <section class="health-section">
      <div class="section-toolbar compact">
        <div>
          <div class="section-title">前端錯誤收集</div>
          <p class="section-desc">
            自動捕捉 window.error 與 unhandledrejection，方便排查白畫面、資料卡住與非預期例外。
          </p>
        </div>
        <button class="btn" type="button" :disabled="!systemStore.errorCount" @click="systemStore.clearErrors">
          <IconTrash class="btn-icon" :stroke-width="2" />
          清除前端錯誤
        </button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>時間</th>
              <th>位置</th>
              <th>訊息</th>
              <th>頁面</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="error in frontendErrors" :key="error.id">
              <td>{{ formatDateTime(error.time) }}</td>
              <td>{{ error.context }}</td>
              <td class="health-error-cell" :title="error.stack || error.message">
                {{ formatErrorMessage(error.message) }}
              </td>
              <td class="health-path-cell" :title="error.url">{{ formatPath(error.url) }}</td>
            </tr>
            <tr v-if="!frontendErrors.length">
              <td colspan="4" class="empty-cell">目前沒有前端錯誤紀錄。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="health-section">
      <div class="section-title">來源狀態總覽</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>來源</th>
              <th>狀態</th>
              <th>成功</th>
              <th>失敗</th>
              <th>快取</th>
              <th>合併</th>
              <th>最後耗時</th>
              <th>最後錯誤</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in groups" :key="group.key">
              <td>
                <strong>{{ group.label }}</strong>
                <SourceBadge :source="group.source" />
              </td>
              <td>
                <span class="status-pill" :class="statusClass(group.lastStatus)">
                  {{ statusText(group.lastStatus) }}
                </span>
              </td>
              <td>{{ group.success }}</td>
              <td class="up">{{ group.error }}</td>
              <td>{{ group.cache }}</td>
              <td>{{ group.deduped }}</td>
              <td>{{ group.lastDurationMs || 0 }}ms</td>
              <td class="health-error-cell">{{ group.lastError || '--' }}</td>
            </tr>
            <tr v-if="!groups.length">
              <td colspan="8" class="empty-cell">尚未有 API 請求紀錄。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="health-section">
      <div class="section-title">最近請求</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>時間</th>
              <th>來源</th>
              <th>狀態</th>
              <th>耗時</th>
              <th>路徑</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="call in recentCalls" :key="call.id">
              <td>{{ formatDateTime(call.startedAtText) }}</td>
              <td>{{ call.label }}</td>
              <td>
                <span class="status-pill" :class="statusClass(call.status)">
                  {{ statusText(call.status) }}
                </span>
              </td>
              <td>{{ call.durationMs || 0 }}ms</td>
              <td class="health-path-cell" :title="call.path">
                {{ call.error || formatPath(call.path) }}
              </td>
            </tr>
            <tr v-if="!recentCalls.length">
              <td colspan="5" class="empty-cell">尚未有最近請求。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="health-note">
      <IconAlertTriangle class="inline-icon" :stroke-width="2" />
      資料健康頁只檢查來源連通與請求狀態；若某檔個股沒有資料，仍需看該來源是否支援該股票代號或交易所。
    </div>
  </section>
</template>
