<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IconBell, IconInfoCircle, IconRefresh, IconSparkles, IconTrendingDown, IconTrendingUp } from '@tabler/icons-vue';
import { useStockStore } from '../stores/stockStore';
import { getBuySignals, getSellSignals } from '../utils/analysis';
import { formatPct } from '../utils/formatters';

const router = useRouter();
const stockStore = useStockStore();
const showAi = ref(false);

const buySignals = computed(() => getBuySignals(stockStore.hotStocks).slice(0, 8));
const sellSignals = computed(() => getSellSignals(stockStore.hotStocks).slice(0, 8));

function forceLabel(stock, side) {
  const isTradeFlow = stock?.forceSource === 'twse-mis-trade-flow';
  if (side === 'buy') return isTradeFlow ? '外盤佔比' : '買入佔比';
  return isTradeFlow ? '內盤佔比' : '賣出佔比';
}

function openQuote(stock) {
  router.push({ path: '/quote', query: { code: stock.code } });
}
</script>

<template>
  <section class="tab-content active">
    <div class="page-title-row">
      <div class="page-title">
        <IconBell class="title-icon" :stroke-width="2" />
        買賣提醒
      </div>
      <div class="page-actions">
        <button
          class="btn"
          :class="{ 'is-refreshing': stockStore.loadingAll }"
          type="button"
          :disabled="stockStore.loadingAll"
          @click="stockStore.loadAllStocks({ force: true })"
        >
          <IconRefresh class="btn-icon" :stroke-width="2" />
          重新整理
        </button>
      </div>
    </div>

    <div class="alerts-grid">
      <div class="alerts-col">
        <div class="alerts-col-header buy">
          <IconTrendingUp class="inline-icon" :stroke-width="2" />
          <span>高買入提醒</span>
          <span class="alert-badge buy">強力買入 ≥70%</span>
        </div>
        <div class="alert-list">
          <div v-for="stock in buySignals" :key="`buy-${stock.code}`" class="alert-item" @click="openQuote(stock)">
            <div class="alert-icon buy"><IconTrendingUp class="inline-icon" :stroke-width="2" /></div>
            <div>
              <div class="alert-stock-name">{{ stock.code }} {{ stock.name }}</div>
              <div class="alert-detail">{{ stock.sector }} · {{ formatPct(stock.chgPct) }}</div>
              <div class="alert-detail">{{ stock.forceSourceLabel || 'TWSE MIS 五檔委買/委賣量' }}</div>
            </div>
            <div class="alert-right">
              <div class="alert-pct buy">{{ Math.round(stock.buyPct) }}%</div>
              <div class="alert-detail">{{ forceLabel(stock, 'buy') }}</div>
            </div>
          </div>
          <div v-if="!buySignals.length" class="empty-state" style="padding:24px">目前沒有買入提醒</div>
        </div>
      </div>

      <div class="alerts-col">
        <div class="alerts-col-header sell">
          <IconTrendingDown class="inline-icon" :stroke-width="2" />
          <span>高賣出提醒</span>
          <span class="alert-badge sell">強力賣出 ≥65%</span>
        </div>
        <div class="alert-list">
          <div v-for="stock in sellSignals" :key="`sell-${stock.code}`" class="alert-item" @click="openQuote(stock)">
            <div class="alert-icon sell"><IconTrendingDown class="inline-icon" :stroke-width="2" /></div>
            <div>
              <div class="alert-stock-name">{{ stock.code }} {{ stock.name }}</div>
              <div class="alert-detail">{{ stock.sector }} · {{ formatPct(stock.chgPct) }}</div>
              <div class="alert-detail">{{ stock.forceSourceLabel || 'TWSE MIS 五檔委買/委賣量' }}</div>
            </div>
            <div class="alert-right">
              <div class="alert-pct sell">{{ Math.round(stock.sellPct) }}%</div>
              <div class="alert-detail">{{ forceLabel(stock, 'sell') }}</div>
            </div>
          </div>
          <div v-if="!sellSignals.length" class="empty-state" style="padding:24px">目前沒有賣出提醒</div>
        </div>
      </div>
    </div>

    <div class="table-hint">
      <IconInfoCircle class="inline-icon" :stroke-width="2" />
      買賣提醒優先採用 TWSE MIS 成交快照分類；尚未捕捉新成交時才退回五檔委買/委賣量。HiStock/Yahoo 推估資料不列入提醒。
    </div>

    <div class="table-footer" style="margin-top:1.5rem">
      <button class="btn" type="button" @click="showAi = true">
        <IconSparkles class="btn-icon" :stroke-width="2" />
        AI 解讀買賣訊號
      </button>
      <div v-if="showAi" class="ai-pick-result">
        <div class="ai-box-header">
          <IconSparkles class="inline-icon" :stroke-width="2" />
          AI 訊號解讀
        </div>
        <div class="ai-content">
          高買入訊號代表短線動能偏強；高賣出訊號代表籌碼偏保守。請搭配即時報價與走勢圖確認是否帶量突破或跌破支撐。
        </div>
      </div>
    </div>
  </section>
</template>
