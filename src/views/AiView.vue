<script setup>
import { computed, ref } from 'vue';
import { IconBrain, IconRefresh, IconSparkles } from '@tabler/icons-vue';
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
const quickAnswer = ref('');

const analysis = computed(() => buildMarketAnalysis({
  market: marketStore.market,
  marketStats: stockStore.marketStats,
  hotStocks: stockStore.hotStocks,
  portfolioSummary: portfolioStore.summary,
  institutionalTotal: institutionalStore.total
}));

const direction = computed(() => {
  if (marketStore.market.changePct > 0.4 && stockStore.marketStats.upRatio >= 55) {
    return { icon: '📈', title: '偏多格局', sub: '市場買盤相對積極', type: 'long', pill: '偏多' };
  }
  if (marketStore.market.changePct < -0.4 && stockStore.marketStats.upRatio < 45) {
    return { icon: '📉', title: '偏空格局', sub: '市場賣壓相對明顯', type: 'short', pill: '偏空' };
  }
  return { icon: '⚖️', title: '分析中...', sub: '正在評估市場狀況', type: 'neutral', pill: '中性' };
});

function askAI(topic) {
  const text = {
    short: `短線策略：目前加權指數漲跌幅 ${formatPct(marketStore.market.changePct)}，市場買超比 ${stockStore.marketStats.upRatio}%。建議優先觀察量價同步的強勢股，避免追高乖離過大的標的。`,
    theme: `主流族群：可從前100熱門股中觀察成交量集中且買盤佔比偏高的族群，並搭配法人買超延續性確認。`,
    outlook: `後市展望：三大法人合計 ${formatSigned(institutionalStore.total, 2, '億')}。若法人買超延續，指數支撐較強；若轉賣超，應降低部位。`,
    risk: `風險評估：持股報酬 ${formatPct(portfolioStore.summary.returnPct)}，法人 ${formatSigned(institutionalStore.total, 2, '億')}。若同時出現法人賣超與市場買超比下滑，需提高現金水位。`
  };
  quickAnswer.value = text[topic];
}
</script>

<template>
  <section class="tab-content active">
    <div class="page-title">
      <IconBrain class="title-icon" :stroke-width="2" />
      AI 市場分析
    </div>

    <div class="direction-row">
      <div class="direction-card" :class="direction.type">
        <div class="direction-icon">{{ direction.icon }}</div>
        <div class="direction-body">
          <div class="direction-title">{{ direction.title }}</div>
          <div class="direction-sub">{{ direction.sub }}</div>
        </div>
        <div class="direction-signal">
          <span class="signal-pill" :class="direction.type">{{ direction.pill }}</span>
        </div>
      </div>
    </div>

    <div class="ai-full-box">
      <div class="ai-box-header">
        <IconSparkles class="inline-icon" :stroke-width="2" />
        <span>AI 市場完整分析報告</span>
      </div>
      <div class="ai-content">
        <ol>
          <li v-for="item in analysis" :key="item">{{ item }}</li>
        </ol>
        <p style="margin-top:12px">
          市場買超比 {{ stockStore.marketStats.upRatio }}%，法人合計
          <span :class="moveClass(institutionalStore.total).replace('is-', '')">
            {{ formatSigned(institutionalStore.total, 2, '億') }}
          </span>。
        </p>
      </div>
    </div>

    <div class="ai-quick-btns">
      <div class="quick-btn-label">快速提問：</div>
      <button class="btn" type="button" @click="askAI('short')">短線策略</button>
      <button class="btn" type="button" @click="askAI('theme')">主流族群</button>
      <button class="btn" type="button" @click="askAI('outlook')">後市展望</button>
      <button class="btn" type="button" @click="askAI('risk')">風險評估</button>
      <button class="btn primary" type="button" @click="quickAnswer = ''">
        <IconRefresh class="btn-icon" :stroke-width="2" />
        重新分析
      </button>
    </div>

    <div v-if="quickAnswer" class="ai-pick-result">
      <div class="ai-box-header">
        <IconSparkles class="inline-icon" :stroke-width="2" />
        AI 回覆
      </div>
      <div class="ai-content">{{ quickAnswer }}</div>
    </div>
  </section>
</template>
