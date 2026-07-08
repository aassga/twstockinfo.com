<script setup>
import { computed, ref } from 'vue';
import { formatNumber } from '../utils/formatters';
import { buildTechnicalSummary } from '../utils/technicalAnalysis';

const props = defineProps({
  candles: { type: Array, default: () => [] },
  interval: { type: String, default: 'D' },
  loading: { type: Boolean, default: false },
  compact: { type: Boolean, default: false }
});

const active = ref('ma');
const tabs = [
  { key: 'ma', label: 'MA' },
  { key: 'rsi', label: 'RSI' },
  { key: 'macd', label: 'MACD' },
  { key: 'kd', label: 'KD' },
  { key: 'bollinger', label: '布林通道' },
  { key: 'volume', label: '量價訊號' },
  { key: 'levels', label: '支撐壓力' }
];

const summary = computed(() => {
  if (props.loading) return null;
  return buildTechnicalSummary(props.candles, { interval: props.interval });
});

const cards = computed(() => {
  const data = summary.value;
  if (!data) return [];
  if (active.value === 'ma') {
    return [
      { label: '趨勢', value: data.trend.label, detail: `收盤 ${num(data.latestClose)}`, tone: data.trend.type },
      { label: data.maLabels.short, value: num(data.ma5), detail: '短線均線', tone: compareTone(data.latestClose, data.ma5) },
      { label: data.maLabels.mid, value: num(data.ma20), detail: '中期均線', tone: compareTone(data.latestClose, data.ma20) },
      { label: data.maLabels.long, value: num(data.ma60), detail: '長期均線', tone: compareTone(data.latestClose, data.ma60) }
    ];
  }
  if (active.value === 'rsi') {
    return [
      { label: 'RSI 14', value: num(data.rsi), detail: data.momentum.label, tone: rsiTone(data.rsi) },
      { label: '動能', value: data.momentum.label, detail: '搭配 RSI 與 MACD 判斷', tone: data.momentum.type },
      { label: '漲跌', value: pct(data.changePct, 2), detail: '相對上一根 K 線', tone: signTone(data.changePct) }
    ];
  }
  if (active.value === 'macd') {
    const histogram = data.macd?.histogram;
    return [
      { label: 'MACD 柱', value: signed(histogram), detail: 'DIF - DEA', tone: signTone(histogram) },
      { label: 'DIF', value: signed(data.macd?.macd), detail: '短長期 EMA 差', tone: signTone(data.macd?.macd) },
      { label: 'DEA', value: signed(data.macd?.signal), detail: 'MACD 訊號線', tone: signTone(data.macd?.signal) },
      { label: '訊號', value: histogram > 0 ? '偏多' : histogram < 0 ? '偏空' : '中性', detail: data.momentum.label, tone: signTone(histogram) }
    ];
  }
  if (active.value === 'kd') {
    return [
      { label: 'K 值', value: num(data.kd?.k), detail: data.kdSignal.label, tone: kdTone(data.kd?.k) },
      { label: 'D 值', value: num(data.kd?.d), detail: '慢速隨機指標', tone: kdTone(data.kd?.d) },
      { label: 'J 值', value: num(data.kd?.j), detail: '3K - 2D', tone: signTone(Number(data.kd?.j || 0) - 50) },
      { label: '訊號', value: data.kdSignal.label, detail: 'KD 適合觀察短線轉折', tone: data.kdSignal.type }
    ];
  }
  if (active.value === 'bollinger') {
    const bollinger = data.bollinger || {};
    return [
      { label: '上軌', value: num(bollinger.upper), detail: '20MA + 2σ', tone: compareTone(data.latestClose, bollinger.upper) },
      { label: '中軌', value: num(bollinger.middle), detail: '20MA', tone: compareTone(data.latestClose, bollinger.middle) },
      { label: '下軌', value: num(bollinger.lower), detail: '20MA - 2σ', tone: compareTone(data.latestClose, bollinger.lower) },
      { label: '帶寬', value: pct(bollinger.widthPct, 2), detail: data.bollingerSignal.label, tone: data.bollingerSignal.type }
    ];
  }
  if (active.value === 'volume') {
    return [
      { label: '量價', value: data.volumeSignal.label, detail: data.priceVolumeNote, tone: data.volumeSignal.type },
      { label: '量比', value: pct(data.volumeRatio, 0), detail: '今日量 / 20 根均量', tone: Number(data.volumeRatio || 0) >= 100 ? 'up' : 'neutral' },
      { label: '5 均量', value: num(data.volumeMa5, 0), detail: '短線成交量均線', tone: compareTone(data.volumeMa5, data.volumeMa20) },
      { label: '20 均量', value: num(data.volumeMa20 || data.avgVolume20, 0), detail: '中期成交量均線', tone: 'neutral' },
      { label: '漲跌', value: pct(data.changePct, 2), detail: '量價搭配用', tone: signTone(data.changePct) }
    ];
  }
  const levels = data.supportResistance || {};
  return [
    { label: '支撐', value: num(levels.support), detail: `距離 ${pct(levels.supportDistancePct, 2)}`, tone: 'down' },
    { label: '壓力', value: num(levels.resistance), detail: `距離 ${pct(levels.resistanceDistancePct, 2)}`, tone: 'up' },
    { label: '目前價', value: num(data.latestClose), detail: data.intervalLabel, tone: 'neutral' },
    { label: '區間', value: levels.support && levels.resistance ? `${num(levels.support)} - ${num(levels.resistance)}` : '--', detail: '近 80 根 K 線估算', tone: 'neutral' }
  ];
});

const note = computed(() => {
  const data = summary.value;
  if (!data) return props.loading ? '載入走勢資料中...' : '載入走勢圖後顯示技術摘要。';
  if (active.value === 'levels') return '支撐壓力以近期 K 線高低點估算，適合做觀察區間，不是固定買賣點。';
  if (active.value === 'ma') return `均線摘要：${data.trend.label}。`;
  if (active.value === 'rsi') return `RSI 動能摘要：${data.momentum.label}。`;
  if (active.value === 'macd') return 'MACD 適合觀察動能轉折，需搭配價格位置與成交量。';
  if (active.value === 'kd') return `KD 摘要：${data.kdSignal.label}。`;
  if (active.value === 'bollinger') return `布林通道摘要：${data.bollingerSignal.label}，觀察價格是否沿上/下軌擴張或回到中軌。`;
  return data.priceVolumeNote;
});

function num(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? formatNumber(number, digits) : '--';
}

function signed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${number > 0 ? '+' : ''}${formatNumber(number, 2)}`;
}

function pct(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${number > 0 ? '+' : ''}${formatNumber(number, digits)}%`;
}

function signTone(value) {
  const number = Number(value);
  if (number > 0) return 'up';
  if (number < 0) return 'down';
  return 'neutral';
}

function compareTone(price, baseline) {
  if (!Number.isFinite(Number(price)) || !Number.isFinite(Number(baseline))) return 'neutral';
  return Number(price) >= Number(baseline) ? 'up' : 'down';
}

function rsiTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'neutral';
  if (number >= 70) return 'up';
  if (number <= 30) return 'down';
  return 'neutral';
}

function kdTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'neutral';
  if (number >= 80) return 'up';
  if (number <= 20) return 'down';
  return 'neutral';
}
</script>

<template>
  <div class="technical-summary" :class="{ compact }">
    <div class="technical-summary-head">
      <div>
        <div class="technical-summary-title">走勢圖技術指標摘要</div>
        <div class="technical-summary-sub">由 K 線資料即時計算，可切換 MA、RSI、MACD、KD、布林、量價與支撐壓力。</div>
      </div>
      <span v-if="summary" class="signal-pill" :class="summary.volumeSignal.type">
        {{ summary.volumeSignal.label }}
      </span>
    </div>

    <div class="technical-switch-row" role="tablist" aria-label="技術指標切換">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="quick-btn technical-switch-btn"
        :class="{ active: active === tab.key }"
        type="button"
        @click="active = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="summary" class="technical-card-grid">
      <div
        v-for="card in cards"
        :key="card.label"
        class="technical-card"
        :class="card.tone"
      >
        <div class="technical-card-label">{{ card.label }}</div>
        <div class="technical-card-value">{{ card.value }}</div>
        <div class="technical-card-detail">{{ card.detail }}</div>
      </div>
    </div>
    <div v-else class="technical-card-grid">
      <div class="technical-card neutral">
        <div class="technical-card-label">技術摘要</div>
        <div class="technical-card-value">--</div>
        <div class="technical-card-detail">{{ note }}</div>
      </div>
    </div>

    <div class="technical-note">{{ note }}</div>
  </div>
</template>
