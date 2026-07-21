<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IconBriefcase,
  IconDeviceFloppy,
  IconFileCode,
  IconFileSpreadsheet,
  IconInfoCircle,
  IconRefresh,
  IconSelector
} from '@tabler/icons-vue';
import { stockApi } from '../api/stockApi';
import AutoRefreshCountdown from '../components/AutoRefreshCountdown.vue';
import { usePortfolioStore } from '../stores/portfolioStore';
import { useStockStore } from '../stores/stockStore';
import { formatDateTime, formatMoney, formatPct, moveClass } from '../utils/formatters';

const router = useRouter();
const portfolioStore = usePortfolioStore();
const stockStore = useStockStore();
const form = reactive(createEmptyForm());
const importInput = ref(null);
const isRefreshingQuotes = ref(false);
const portfolioRefreshResetKey = ref(0);
const portfolioRefreshMs = 15000;
const portfolioSort = ref({ key: '', direction: 'desc' });
const leadingSortableColumns = [
  { key: 'buyPrice', label: '買進價' },
  { key: 'shares', label: '股數' }
];
const trailingSortableColumns = [
  { key: 'currentPrice', label: '現價' },
  { key: 'marketValue', label: '市值' },
  { key: 'pnl', label: '損益' },
  { key: 'returnPct', label: '報酬率' }
];
const sortedHoldings = computed(() => {
  const { key, direction } = portfolioSort.value;
  if (!key) return portfolioStore.holdings;

  const factor = direction === 'asc' ? 1 : -1;
  return portfolioStore.holdings.slice().sort((a, b) => {
    const left = portfolioSortValue(a, key);
    const right = portfolioSortValue(b, key);
    if (left === right) return String(a.code).localeCompare(String(b.code));
    return (left > right ? 1 : -1) * factor;
  });
});
let codeLookupTimer = null;
let codeLookupRun = 0;

watch(() => portfolioStore.draft, draft => {
  if (!draft) return;
  Object.assign(form, createEmptyForm(), draft);
}, { deep: true });

watch(() => form.code, code => {
  const normalized = String(code || '').trim();
  codeLookupRun += 1;
  clearTimeout(codeLookupTimer);

  if (!normalized) {
    form.name = '';
    return;
  }

  if (!/^\d{4,6}[A-Z]?$/i.test(normalized)) {
    form.name = '';
    return;
  }

  const cached = stockStore.findStock(normalized);
  form.name = cached?.name || '';

  const run = codeLookupRun;
  codeLookupTimer = setTimeout(async () => {
    try {
      const quote = await stockApi.quoteAuto(normalized);
      if (run !== codeLookupRun || String(form.code || '').trim() !== normalized) return;
      if (quote?.name) form.name = quote.name;
    } catch (error) {
      // Keep the name field editable if the code cannot be resolved.
    }
  }, 350);
});

function createEmptyForm() {
  return {
    id: '',
    code: '',
    name: '',
    buyPrice: '',
    shares: '',
    buyDate: new Date().toISOString().slice(0, 10)
  };
}

function resetForm() {
  Object.assign(form, createEmptyForm());
  portfolioStore.clearDraft();
}

function save(event) {
  event.preventDefault();
  portfolioStore.saveHolding(form);
  resetForm();
}

function editHolding(holding) {
  Object.assign(form, {
    id: holding.id,
    code: holding.code,
    name: holding.name,
    buyPrice: holding.buyPrice,
    shares: holding.shares,
    buyDate: holding.buyDate
  });
}

function removeHolding(holding) {
  if (window.confirm(`刪除 ${holding.name} ${holding.code}？`)) {
    portfolioStore.removeHolding(holding.id);
  }
}

async function refresh() {
  if (isRefreshingQuotes.value) return;
  isRefreshingQuotes.value = true;
  try {
    await portfolioStore.refreshQuotes({ force: true });
  } finally {
    isRefreshingQuotes.value = false;
    portfolioRefreshResetKey.value += 1;
  }
}

function handlePortfolioRefresh() {
  return refresh();
}

function openQuote(holding) {
  router.push({ path: '/quote', query: { code: holding.code } });
}

function exportJson() {
  downloadFile('portfolio.json', JSON.stringify(portfolioStore.holdings, null, 2), 'application/json');
}

function triggerImport() {
  importInput.value?.click();
}

async function importJson(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    if (portfolioStore.holdings.length && !window.confirm('匯入 JSON 會取代目前持股，確定要繼續嗎？')) return;
    const count = portfolioStore.importHoldings(payload);
    window.alert(`已匯入 ${count} 筆持股`);
  } catch (error) {
    window.alert(error?.message || '匯入 JSON 失敗，請確認檔案格式。');
  }
}

function exportCsv() {
  const rows = portfolioStore.holdings.map(holding => [
    holding.code,
    holding.name,
    holding.buyPrice,
    holding.shares,
    holding.buyDate,
    holding.currentPrice || '',
    ((holding.currentPrice || holding.buyPrice) * holding.shares).toFixed(0),
    (((holding.currentPrice || holding.buyPrice) - holding.buyPrice) * holding.shares).toFixed(0)
  ]);
  const csv = [['代號', '名稱', '買進價', '股數', '買進日期', '現價', '市值', '損益'], ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadFile('portfolio.csv', csv, 'text/csv;charset=utf-8');
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function holdingPnl(holding) {
  return ((holding.currentPrice || holding.buyPrice) - holding.buyPrice) * holding.shares;
}

function holdingReturn(holding) {
  return holding.buyPrice ? (((holding.currentPrice || holding.buyPrice) - holding.buyPrice) / holding.buyPrice) * 100 : 0;
}

function setPortfolioSort(key) {
  if (portfolioSort.value.key === key) {
    portfolioSort.value.direction = portfolioSort.value.direction === 'asc' ? 'desc' : 'asc';
    return;
  }
  portfolioSort.value = { key, direction: 'desc' };
}

function portfolioSortValue(holding, key) {
  if (key === 'buyPrice') return Number(holding.buyPrice || 0);
  if (key === 'shares') return Number(holding.shares || 0);
  if (key === 'currentPrice') return Number(holding.currentPrice || holding.buyPrice || 0);
  if (key === 'marketValue') return Number((holding.currentPrice || holding.buyPrice || 0) * (holding.shares || 0));
  if (key === 'pnl') return holdingPnl(holding);
  if (key === 'returnPct') return holdingReturn(holding);
  return 0;
}
</script>

<template>
  <section class="tab-content active">
    <div class="page-title-row">
      <div class="page-title">
        <IconBriefcase class="title-icon" :stroke-width="2" />
        我的持股
      </div>
      <div class="page-actions">
        <AutoRefreshCountdown
          :interval-ms="portfolioRefreshMs"
          :loading="isRefreshingQuotes || portfolioStore.loading"
          :enabled="Boolean(portfolioStore.holdings.length)"
          :reset-key="portfolioRefreshResetKey"
          @refresh="handlePortfolioRefresh"
        />
        <button
          v-if="false"
          class="btn"
          :class="{ 'is-refreshing': isRefreshingQuotes }"
          type="button"
          :disabled="isRefreshingQuotes"
          @click="refresh"
        >
          <IconRefresh class="btn-icon" :stroke-width="2" />
          更新現價
        </button>
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json"
          style="display:none"
          @change="importJson"
        />
        <button class="btn" type="button" @click="triggerImport">
          <IconFileCode class="btn-icon" :stroke-width="2" />
          匯入 JSON
        </button>
        <button class="btn" type="button" @click="exportJson">
          <IconFileCode class="btn-icon" :stroke-width="2" />
          匯出 JSON
        </button>
        <button class="btn" type="button" @click="exportCsv">
          <IconFileSpreadsheet class="btn-icon" :stroke-width="2" />
          匯出 CSV
        </button>
      </div>
    </div>

    <div class="portfolio-grid">
      <form class="portfolio-form" @submit="save">
        <div class="form-title">{{ form.id ? '編輯持股' : '新增持股' }}</div>
        <div class="form-grid">
          <label class="form-field">
            <span>股票代號</span>
            <input v-model.trim="form.code" class="form-input" inputmode="numeric" placeholder="2330" required />
          </label>
          <label class="form-field">
            <span>股票名稱</span>
            <input v-model="form.name" class="form-input" placeholder="台積電" required />
          </label>
          <label class="form-field">
            <span>買進價</span>
            <input v-model="form.buyPrice" class="form-input" type="number" min="0" step="0.01" placeholder="580" required />
          </label>
          <label class="form-field">
            <span>股數</span>
            <input v-model="form.shares" class="form-input" type="number" min="1" step="1" placeholder="1000" required />
          </label>
          <label class="form-field">
            <span>買進日期</span>
            <input v-model="form.buyDate" class="form-input" type="date" required />
          </label>
        </div>
        <div class="form-actions">
          <button class="btn primary" type="submit">
            <IconDeviceFloppy class="btn-icon" :stroke-width="2" />
            儲存持股
          </button>
          <button class="btn" type="button" @click="resetForm">取消編輯</button>
        </div>
      </form>

      <div class="portfolio-summary">
        <div class="summary-card">
          <div class="summary-label">總成本</div>
          <div class="summary-value">{{ formatMoney(portfolioStore.summary.cost) }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">目前市值</div>
          <div class="summary-value">{{ formatMoney(portfolioStore.summary.value) }}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">未實現損益</div>
          <div class="summary-value" :class="moveClass(portfolioStore.summary.pnl).replace('is-', '')">
            {{ formatMoney(portfolioStore.summary.pnl) }}
          </div>
        </div>
        <div class="summary-card">
          <div class="summary-label">報酬率</div>
          <div class="summary-value" :class="moveClass(portfolioStore.summary.returnPct).replace('is-', '')">
            {{ formatPct(portfolioStore.summary.returnPct) }}
          </div>
        </div>
      </div>
    </div>

    <div class="table-hint">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      點擊股票名稱可以看即時報價與走勢圖
    </div>
    <div class="table-wrapper portfolio-table-wrap">
      <table class="stock-table">
        <thead>
          <tr>
            <th>代號</th>
            <th>名稱</th>
            <th v-for="column in leadingSortableColumns" :key="column.key">
              <button class="sort-th" type="button" :class="{ active: portfolioSort.key === column.key }" @click="setPortfolioSort(column.key)">
                <span>{{ column.label }}</span>
                <IconSelector class="inline-icon" :stroke-width="2" />
              </button>
            </th>
            <th>買進日期</th>
            <th v-for="column in trailingSortableColumns" :key="column.key">
              <button class="sort-th" type="button" :class="{ active: portfolioSort.key === column.key }" @click="setPortfolioSort(column.key)">
                <span>{{ column.label }}</span>
                <IconSelector class="inline-icon" :stroke-width="2" />
              </button>
            </th>
            <th>更新時間</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!portfolioStore.holdings.length">
            <td colspan="11" style="text-align:center;color:var(--text-3);padding:28px">尚未新增持股</td>
          </tr>
          <tr v-for="holding in sortedHoldings" :key="holding.id">
            <td>{{ holding.code }}</td>
            <td>
              <button class="stock-link" type="button" @click="openQuote(holding)">{{ holding.name }}</button>
            </td>
            <td>{{ formatMoney(holding.buyPrice, 2) }}</td>
            <td>{{ Number(holding.shares).toLocaleString() }}</td>
            <td>{{ holding.buyDate }}</td>
            <td>{{ formatMoney(holding.currentPrice || holding.buyPrice, 2) }}</td>
            <td>{{ formatMoney((holding.currentPrice || holding.buyPrice) * holding.shares) }}</td>
            <td class="portfolio-pnl-cell" :class="moveClass(holdingPnl(holding)).replace('is-', '')">{{ formatMoney(holdingPnl(holding)) }}</td>
            <td class="portfolio-pnl-cell" :class="moveClass(holdingReturn(holding)).replace('is-', '')">{{ formatPct(holdingReturn(holding)) }}</td>
            <td>{{ formatDateTime(holding.updatedAt) }}</td>
            <td>
              <div class="row-actions">
                <button class="btn xs" type="button" @click="editHolding(holding)">編輯</button>
                <button class="btn xs" type="button" @click="removeHolding(holding)">刪除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
