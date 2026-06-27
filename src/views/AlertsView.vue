<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useChartStore } from '../stores/chartStore';
import { useStockStore } from '../stores/stockStore';
import { getBuySignals, getSellSignals } from '../utils/analysis';
import { formatMoney, formatPct, formatVolume, moveClass } from '../utils/formatters';

const router = useRouter();
const stockStore = useStockStore();
const chartStore = useChartStore();

const buySignals = computed(() => getBuySignals(stockStore.hotStocks));
const sellSignals = computed(() => getSellSignals(stockStore.hotStocks));

async function openChart(stock) {
  await chartStore.openStock(stock);
  router.push('/chart');
}
</script>

<template>
  <section class="view-stack">
    <div class="alert-grid">
      <article class="panel alert-panel">
        <div class="section-head">
          <h2>買進觀察</h2>
          <span class="count-badge buy">{{ buySignals.length }}</span>
        </div>
        <div class="signal-list">
          <button
            v-for="stock in buySignals"
            :key="`buy-${stock.code}`"
            class="signal-row"
            type="button"
            @click="openChart(stock)"
          >
            <span>
              <strong>{{ stock.name }}</strong>
              <small>{{ stock.code }} · {{ stock.reason }}</small>
            </span>
            <b :class="moveClass(stock.chgPct)">{{ formatPct(stock.chgPct) }}</b>
          </button>
          <div v-if="!buySignals.length" class="empty-state">目前沒有明顯買進訊號</div>
        </div>
      </article>

      <article class="panel alert-panel">
        <div class="section-head">
          <h2>賣出提醒</h2>
          <span class="count-badge sell">{{ sellSignals.length }}</span>
        </div>
        <div class="signal-list">
          <button
            v-for="stock in sellSignals"
            :key="`sell-${stock.code}`"
            class="signal-row"
            type="button"
            @click="openChart(stock)"
          >
            <span>
              <strong>{{ stock.name }}</strong>
              <small>{{ stock.code }} · {{ stock.reason }}</small>
            </span>
            <b :class="moveClass(stock.chgPct)">{{ formatPct(stock.chgPct) }}</b>
          </button>
          <div v-if="!sellSignals.length" class="empty-state">目前沒有明顯賣出訊號</div>
        </div>
      </article>
    </div>

    <article class="panel">
      <div class="section-head">
        <h2>訊號規則</h2>
      </div>
      <div class="rule-list">
        <div>
          <span>買進觀察</span>
          <strong>漲幅大於 1.2% 且買盤大於 58%</strong>
        </div>
        <div>
          <span>賣出提醒</span>
          <strong>跌幅小於 -1.2% 或賣盤大於 62%</strong>
        </div>
        <div>
          <span>成交量參考</span>
          <strong>{{ formatVolume(stockStore.marketStats.totalVolume) }}</strong>
        </div>
        <div>
          <span>前100平均</span>
          <strong>{{ formatMoney(stockStore.hotStocks[0]?.price || 0, 2) }} 起</strong>
        </div>
      </div>
    </article>
  </section>
</template>
