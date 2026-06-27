<script setup>
import { computed, onMounted } from 'vue';
import { useInstitutionalStore } from '../stores/institutionalStore';
import { useMarketStore } from '../stores/marketStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { useStockStore } from '../stores/stockStore';
import { buildMarketAnalysis } from '../utils/analysis';
import { formatPct, formatSigned, moveClass } from '../utils/formatters';

const marketStore = useMarketStore();
const stockStore = useStockStore();
const portfolioStore = usePortfolioStore();
const institutionalStore = useInstitutionalStore();

onMounted(() => {
  if (!institutionalStore.rows.length) institutionalStore.loadInstitutional({ silent: true });
});

const analysis = computed(() => buildMarketAnalysis({
  market: marketStore.market,
  marketStats: stockStore.marketStats,
  hotStocks: stockStore.hotStocks,
  portfolioSummary: portfolioStore.summary,
  institutionalTotal: institutionalStore.total
}));

const riskLevel = computed(() => {
  if (marketStore.market.changePct < -0.8 || stockStore.marketStats.upRatio < 40 || institutionalStore.total < -30) return '偏高';
  if (marketStore.market.changePct > 0.8 && stockStore.marketStats.upRatio > 60 && institutionalStore.total > 20) return '偏低';
  return '中性';
});
</script>

<template>
  <section class="view-stack">
    <div class="summary-grid">
      <div class="summary-tile">
        <span>盤勢風險</span>
        <strong>{{ riskLevel }}</strong>
      </div>
      <div class="summary-tile">
        <span>上漲比例</span>
        <strong>{{ stockStore.marketStats.upRatio }}%</strong>
      </div>
      <div class="summary-tile">
        <span>法人合計</span>
        <strong :class="moveClass(institutionalStore.total)">
          {{ formatSigned(institutionalStore.total, 2, '億') }}
        </strong>
      </div>
      <div class="summary-tile">
        <span>持股報酬</span>
        <strong :class="moveClass(portfolioStore.summary.returnPct)">
          {{ formatPct(portfolioStore.summary.returnPct) }}
        </strong>
      </div>
    </div>

    <article class="panel ai-panel">
      <div class="section-head">
        <h2>AI 分析</h2>
      </div>
      <ol class="analysis-list">
        <li v-for="item in analysis" :key="item">{{ item }}</li>
      </ol>
    </article>

    <article class="panel">
      <div class="section-head">
        <h2>下一步觀察</h2>
      </div>
      <div class="rule-list">
        <div>
          <span>強勢股</span>
          <strong>觀察是否帶量突破並守住當日均價</strong>
        </div>
        <div>
          <span>弱勢股</span>
          <strong>若跌破前低，優先檢查持股風險</strong>
        </div>
        <div>
          <span>法人</span>
          <strong>買超延續比單日買超更重要</strong>
        </div>
      </div>
    </article>
  </section>
</template>
