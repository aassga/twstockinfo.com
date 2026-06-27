<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { useChartStore } from '../stores/chartStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { useStockStore } from '../stores/stockStore';
import { formatMoney, formatPct, formatVolume, moveClass } from '../utils/formatters';
import { quickStocks } from '../utils/stockMeta';

const router = useRouter();
const stockStore = useStockStore();
const portfolioStore = usePortfolioStore();
const chartStore = useChartStore();
const query = ref(stockStore.searchQuery || '');
const stock = computed(() => stockStore.currentStock);

async function submit(value = query.value) {
  if (!value) return;
  try {
    const result = await stockStore.searchStock(value);
    query.value = result.code;
  } catch (error) {
    showToast(error?.message || '查詢失敗');
  }
}

function addToPortfolio() {
  if (!stock.value) return;
  portfolioStore.setDraftFromStock(stock.value);
  router.push('/portfolio');
}

async function openChart() {
  if (!stock.value) return;
  await chartStore.openStock(stock.value);
  router.push('/chart');
}
</script>

<template>
  <section class="view-stack">
    <van-search
      v-model="query"
      shape="round"
      placeholder="輸入股票代號或名稱"
      :show-action="true"
      @search="submit"
    >
      <template #action>
        <button class="text-action" type="button" @click="submit()">搜尋</button>
      </template>
    </van-search>

    <div class="quick-row">
      <button
        v-for="item in quickStocks"
        :key="item.code"
        class="quick-chip"
        type="button"
        @click="submit(item.code)"
      >
        <span>{{ item.name }}</span>
        <strong>{{ item.code }}</strong>
      </button>
    </div>

    <van-skeleton v-if="stockStore.loadingQuote" title :row="5" />

    <article v-else-if="stock" class="panel stock-panel">
      <div class="stock-heading">
        <div>
          <div class="stock-code">{{ stock.code }}</div>
          <h1>{{ stock.name }}</h1>
          <span class="subtle">{{ stock.sector }}</span>
        </div>
        <div class="price-box">
          <strong>{{ formatMoney(stock.price, 2) }}</strong>
          <span :class="moveClass(stock.chgPct)">{{ formatPct(stock.chgPct) }}</span>
        </div>
      </div>

      <div class="metric-grid three">
        <div>
          <span>開盤</span>
          <strong>{{ formatMoney(stock.open, 2) }}</strong>
        </div>
        <div>
          <span>最高</span>
          <strong>{{ formatMoney(stock.high, 2) }}</strong>
        </div>
        <div>
          <span>最低</span>
          <strong>{{ formatMoney(stock.low, 2) }}</strong>
        </div>
      </div>

      <div class="trade-force">
        <div class="force-row">
          <span>買盤</span>
          <div class="force-track"><i class="buy" :style="{ width: `${stock.buyPct}%` }" /></div>
          <strong>{{ stock.buyPct }}%</strong>
        </div>
        <div class="force-row">
          <span>賣盤</span>
          <div class="force-track"><i class="sell" :style="{ width: `${stock.sellPct}%` }" /></div>
          <strong>{{ stock.sellPct }}%</strong>
        </div>
      </div>

      <div class="button-row">
        <van-button block plain type="primary" @click="addToPortfolio">加入持股</van-button>
        <van-button block type="primary" @click="openChart">走勢圖</van-button>
      </div>
    </article>

    <article v-else class="panel quiet-panel">
      <strong>台股資訊</strong>
      <span>熱門股與持股資料會自動同步到下方頁籤。</span>
    </article>

    <section class="panel">
      <div class="section-head">
        <h2>熱門成交</h2>
        <router-link to="/hot100">全部</router-link>
      </div>
      <div class="compact-list">
        <button
          v-for="item in stockStore.hotStocks.slice(0, 5)"
          :key="item.code"
          class="stock-row"
          type="button"
          @click="submit(item.code)"
        >
          <span>
            <strong>{{ item.name }}</strong>
            <small>{{ item.code }} · {{ formatVolume(item.volume) }}</small>
          </span>
          <b :class="moveClass(item.chgPct)">{{ formatPct(item.chgPct) }}</b>
        </button>
      </div>
    </section>
  </section>
</template>
