<script setup>
import { reactive, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { useChartStore } from '../stores/chartStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { formatDateTime, formatMoney, formatPct, moveClass } from '../utils/formatters';

const router = useRouter();
const portfolioStore = usePortfolioStore();
const chartStore = useChartStore();
const form = reactive(createEmptyForm());

watch(() => portfolioStore.draft, draft => {
  if (!draft) return;
  Object.assign(form, createEmptyForm(), draft);
}, { deep: true });

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

function editHolding(holding) {
  Object.assign(form, {
    id: holding.id,
    code: holding.code,
    name: holding.name,
    buyPrice: holding.buyPrice,
    shares: holding.shares,
    buyDate: holding.buyDate
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function save() {
  try {
    portfolioStore.saveHolding(form);
    resetForm();
    showToast('已儲存');
  } catch (error) {
    showToast(error?.message || '儲存失敗');
  }
}

async function remove(holding) {
  try {
    await showConfirmDialog({
      title: '刪除持股',
      message: `${holding.name} ${holding.code}`
    });
    portfolioStore.removeHolding(holding.id);
  } catch (error) {
    // User cancelled.
  }
}

async function refresh() {
  await portfolioStore.refreshQuotes();
  showToast('已更新');
}

async function openChart(holding) {
  await chartStore.openStock({
    code: holding.code,
    name: holding.name,
    price: holding.currentPrice || holding.buyPrice
  });
  router.push('/chart');
}
</script>

<template>
  <section class="view-stack">
    <div class="summary-grid">
      <div class="summary-tile">
        <span>總成本</span>
        <strong>{{ formatMoney(portfolioStore.summary.cost) }}</strong>
      </div>
      <div class="summary-tile">
        <span>市值</span>
        <strong>{{ formatMoney(portfolioStore.summary.value) }}</strong>
      </div>
      <div class="summary-tile">
        <span>損益</span>
        <strong :class="moveClass(portfolioStore.summary.pnl)">
          {{ formatMoney(portfolioStore.summary.pnl) }}
        </strong>
      </div>
      <div class="summary-tile">
        <span>報酬率</span>
        <strong :class="moveClass(portfolioStore.summary.returnPct)">
          {{ formatPct(portfolioStore.summary.returnPct) }}
        </strong>
      </div>
    </div>

    <van-form class="panel form-panel" @submit="save">
      <div class="section-head">
        <h2>{{ form.id ? '編輯持股' : '新增持股' }}</h2>
        <button class="text-action" type="button" @click="resetForm">清空</button>
      </div>
      <van-cell-group inset>
        <van-field v-model="form.code" name="code" label="代號" placeholder="2330" required />
        <van-field v-model="form.name" name="name" label="名稱" placeholder="台積電" required />
        <van-field v-model="form.buyPrice" name="buyPrice" label="買進價" type="number" required />
        <van-field v-model="form.shares" name="shares" label="股數" type="number" required />
        <van-field v-model="form.buyDate" name="buyDate" label="日期" type="date" required />
      </van-cell-group>
      <div class="button-row">
        <van-button block plain type="primary" native-type="button" :loading="portfolioStore.loading" @click="refresh">
          更新現價
        </van-button>
        <van-button block type="primary" native-type="submit">儲存</van-button>
      </div>
    </van-form>

    <div class="holding-list">
      <van-swipe-cell v-for="holding in portfolioStore.holdings" :key="holding.id">
        <article class="panel holding-card" @click="openChart(holding)">
          <div>
            <h3>{{ holding.name }}</h3>
            <span class="subtle">{{ holding.code }} · {{ holding.shares.toLocaleString() }} 股</span>
          </div>
          <div class="holding-price">
            <strong>{{ formatMoney(holding.currentPrice || holding.buyPrice, 2) }}</strong>
            <span :class="moveClass(((holding.currentPrice || holding.buyPrice) - holding.buyPrice) * holding.shares)">
              {{ formatPct((((holding.currentPrice || holding.buyPrice) - holding.buyPrice) / holding.buyPrice) * 100) }}
            </span>
          </div>
          <div class="holding-meta">
            <span>成本 {{ formatMoney(holding.buyPrice * holding.shares) }}</span>
            <span>{{ formatDateTime(holding.updatedAt) }}</span>
          </div>
        </article>
        <template #right>
          <button class="swipe-action edit" type="button" @click="editHolding(holding)">編輯</button>
          <button class="swipe-action delete" type="button" @click="remove(holding)">刪除</button>
        </template>
      </van-swipe-cell>
    </div>
  </section>
</template>
