<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { buildTechnicalIndicatorSeries } from '../utils/technicalAnalysis';
import { formatChartTime, formatNumber } from '../utils/formatters';

const props = defineProps({
  candles: {
    type: Array,
    default: () => []
  },
  interval: {
    type: String,
    default: 'D'
  },
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  }
});

const canvasEl = ref(null);
const selectedIndex = ref(-1);
const activeOverlay = ref('ma');
const activePanel = ref('volume');
let canvas;
let resizeObserver;
const hover = {
  active: false,
  x: 0,
  y: 0
};

const drawableCandles = computed(() => props.candles.map(normalizeDrawableCandle).filter(Boolean));
const overlayOptions = [
  { key: 'ma', label: 'MA' },
  { key: 'bollinger', label: '布林' },
  { key: 'levels', label: '支撐壓力' }
];
const panelOptions = [
  { key: 'volume', label: '成交量' },
  { key: 'rsi', label: 'RSI' },
  { key: 'macd', label: 'MACD' },
  { key: 'kd', label: 'KD' }
];

const selectedCandle = computed(() => {
  const candles = drawableCandles.value;
  if (!candles.length) return null;
  const index = selectedIndex.value >= 0 ? selectedIndex.value : candles.length - 1;
  return candles[Math.min(Math.max(index, 0), candles.length - 1)];
});

onMounted(() => {
  canvas = canvasEl.value;
  resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(canvas.parentElement);
  draw();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

watch(() => [props.candles, props.interval, props.loading, props.error], () => nextTick(draw), { deep: true });

function setOverlay(key) {
  activeOverlay.value = key;
  nextTick(draw);
}

function setPanel(key) {
  activePanel.value = key;
  nextTick(draw);
}

function handlePointerDown(event) {
  event.preventDefault();
  canvas?.setPointerCapture?.(event.pointerId);
  updateHover(event);
}

function handlePointerMove(event) {
  if (event.pointerType !== 'mouse' || event.buttons) event.preventDefault();
  updateHover(event);
}

function handlePointerUp(event) {
  canvas?.releasePointerCapture?.(event.pointerId);
}

function updateHover(event) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  hover.active = true;
  hover.x = event.clientX - rect.left;
  hover.y = event.clientY - rect.top;
  draw();
}

function handlePointerLeave(event) {
  if (event.pointerType !== 'mouse') return;
  hover.active = false;
  draw();
}

function draw() {
  if (!canvas) return;
  const frame = canvas.parentElement;
  const rect = frame.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || frame.clientWidth || 320));
  const height = Math.max(1, Math.round(rect.height || frame.clientHeight || 360));
  const dpr = window.devicePixelRatio || 1;
  const nextWidth = Math.floor(width * dpr);
  const nextHeight = Math.floor(height * dpr);
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height);

  if (props.loading) return drawMessage(ctx, width, height, '載入中');
  if (props.error) return drawMessage(ctx, width, height, props.error);
  const candles = drawableCandles.value;
  if (!candles.length) return drawMessage(ctx, width, height, '尚未選擇股票');

  const layout = {
    left: 12,
    right: 48,
    top: 18,
    bottom: 24,
    volumeHeight: Math.max(64, height * 0.22),
    gap: 14
  };
  layout.priceHeight = height - layout.top - layout.bottom - layout.volumeHeight - layout.gap;
  layout.plotWidth = width - layout.left - layout.right;

  const priceMin = Math.min(...candles.map(row => row.low));
  const priceMax = Math.max(...candles.map(row => row.high));
  const {
    ma5,
    ma10,
    ma20,
    ma60,
    bollinger,
    volumeMa5,
    volumeMa20,
    rsi,
    macd,
    kd,
    supportResistance
  } = buildTechnicalIndicatorSeries(candles);
  const pad = Math.max((priceMax - priceMin) * 0.08, priceMax * 0.01);
  const indicatorValues = [
    ...(activeOverlay.value === 'ma' ? [...ma5, ...ma10, ...ma20, ...ma60] : []),
    ...(activeOverlay.value === 'bollinger' ? bollinger.flatMap(row => row ? [row.upper, row.lower] : []) : []),
    ...(activeOverlay.value === 'levels' && supportResistance ? [supportResistance.support, supportResistance.resistance] : [])
  ].filter(Number.isFinite);
  const min = Math.min(priceMin, ...indicatorValues) - pad;
  const max = Math.max(priceMax, ...indicatorValues) + pad;
  const volumeMax = Math.max(...candles.map(row => row.volume || 0), 1);
  const step = layout.plotWidth / Math.max(candles.length, 1);
  const candleWidth = Math.max(2, Math.min(9, step * 0.58));
  const volumeTop = layout.top + layout.priceHeight + layout.gap;
  const yPrice = value => layout.top + ((max - value) / (max - min || 1)) * layout.priceHeight;
  const yVolume = value => volumeTop + layout.volumeHeight - (value / volumeMax) * layout.volumeHeight;

  drawGrid(ctx, layout, width, height, min, max, volumeTop);
  const activeIndex = hover.active ? nearestCandleIndex(layout, step, candles.length) : -1;
  selectedIndex.value = activeIndex;

  candles.forEach((row, index) => {
    const x = layout.left + index * step + step / 2;
    const up = row.close >= row.open;
    const color = up ? '#d64a42' : '#16885d';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, yPrice(row.high));
    ctx.lineTo(x, yPrice(row.low));
    ctx.stroke();
    const bodyTop = yPrice(Math.max(row.open, row.close));
    const bodyBottom = yPrice(Math.min(row.open, row.close));
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, Math.max(2, bodyBottom - bodyTop));
    if (activePanel.value === 'volume') {
      ctx.globalAlpha = 0.24;
      ctx.fillRect(x - candleWidth / 2, yVolume(row.volume || 0), candleWidth, volumeTop + layout.volumeHeight - yVolume(row.volume || 0));
      ctx.globalAlpha = 1;
    }
  });

  if (activeOverlay.value === 'bollinger') {
    drawBollinger(ctx, layout, candles, bollinger, yPrice, step);
  } else if (activeOverlay.value === 'levels') {
    drawSupportResistance(ctx, layout, width, supportResistance, yPrice);
  } else {
    drawLineSeries(ctx, layout, ma60, yPrice, step, '#64748b', 1);
    drawLineSeries(ctx, layout, ma20, yPrice, step, '#60a5fa', 1.25);
    drawLineSeries(ctx, layout, ma10, yPrice, step, '#c084fc', 1.2);
    drawLineSeries(ctx, layout, ma5, yPrice, step, '#facc15', 1.35);
  }

  drawSubPanel(ctx, layout, width, candles, { volumeMa5, volumeMa20, rsi, macd, kd }, yVolume, step, volumeTop);
  drawIndicatorLegend(ctx, layout, volumeTop);
  drawAxes(ctx, layout, width, height, min, max, candles);
  drawHover(ctx, layout, width, height, min, max, step, volumeTop, candles);
}

function drawBackground(ctx, width, height) {
  ctx.fillStyle = '#151a25';
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(ctx, layout, width, height, min, max, volumeTop) {
  ctx.strokeStyle = '#273246';
  ctx.fillStyle = '#aeb8c8';
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';

  for (let index = 0; index <= 4; index += 1) {
    const y = layout.top + (layout.priceHeight / 4) * index;
    ctx.beginPath();
    ctx.moveTo(layout.left, y);
    ctx.lineTo(width - layout.right, y);
    ctx.stroke();
    const value = max - ((max - min) / 4) * index;
    ctx.fillText(formatNumber(value, 2), width - layout.right + 8, y + 4);
  }

  ctx.beginPath();
  ctx.moveTo(layout.left, volumeTop);
  ctx.lineTo(width - layout.right, volumeTop);
  ctx.stroke();
}

function drawAxes(ctx, layout, width, height, min, max, candles) {
  const first = candles[0];
  const last = candles[candles.length - 1];
  const latest = last.close;
  const latestY = layout.top + ((max - latest) / (max - min || 1)) * layout.priceHeight;

  ctx.strokeStyle = '#4a9eff';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(layout.left, latestY);
  ctx.lineTo(width - layout.right, latestY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#aeb8c8';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(formatChartTime(first.time, props.interval), layout.left, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(formatChartTime(last.time, props.interval), width - layout.right, height - 8);
  ctx.textAlign = 'left';
}

function drawHover(ctx, layout, width, height, min, max, step, volumeTop, candles) {
  if (!hover.active || !candles.length) return;

  const plotLeft = layout.left;
  const plotRight = width - layout.right;
  const priceTop = layout.top;
  const priceBottom = layout.top + layout.priceHeight;
  const chartBottom = volumeTop + layout.volumeHeight;

  if (
    hover.x < plotLeft ||
    hover.x > plotRight ||
    hover.y < priceTop ||
    hover.y > priceBottom
  ) {
    return;
  }

  const x = Math.min(Math.max(hover.x, plotLeft), plotRight);
  const y = Math.min(Math.max(hover.y, priceTop), priceBottom);
  const price = max - ((y - layout.top) / layout.priceHeight) * (max - min);
  const nearestIndex = nearestCandleIndex(layout, step, candles.length);
  const row = candles[nearestIndex];
  const candleX = layout.left + nearestIndex * step + step / 2;

  ctx.save();
  ctx.strokeStyle = '#d7dce8';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(candleX, layout.top);
  ctx.lineTo(candleX, chartBottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(layout.left, y);
  ctx.lineTo(plotRight, y);
  ctx.stroke();
  ctx.setLineDash([]);

  const label = formatNumber(price, 2);
  ctx.font = '12px system-ui, sans-serif';
  const labelWidth = Math.max(42, ctx.measureText(label).width + 16);
  const labelHeight = 22;
  const labelX = Math.min(plotRight + 6, width - labelWidth - 4);
  const labelY = Math.min(Math.max(y - labelHeight / 2, 4), height - labelHeight - 4);
  roundRect(ctx, labelX, labelY, labelWidth, labelHeight, 4);
  ctx.fillStyle = '#2d3546';
  ctx.fill();
  ctx.strokeStyle = '#59657a';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, labelX + labelWidth / 2, labelY + labelHeight / 2);

  const info = `${formatChartTime(row.time, props.interval)}  開 ${formatNumber(row.open, 2)}  高 ${formatNumber(row.high, 2)}  低 ${formatNumber(row.low, 2)}  收 ${formatNumber(row.close, 2)}`;
  ctx.font = '12px system-ui, sans-serif';
  const infoWidth = Math.min(ctx.measureText(info).width + 18, plotRight - layout.left);
  const infoX = Math.min(Math.max(candleX - infoWidth / 2, layout.left), plotRight - infoWidth);
  const infoY = layout.top + 8;
  roundRect(ctx, infoX, infoY, infoWidth, 24, 6);
  ctx.fillStyle = 'rgba(21, 26, 37, 0.92)';
  ctx.fill();
  ctx.strokeStyle = '#344058';
  ctx.stroke();
  ctx.fillStyle = '#dbe6f8';
  ctx.textAlign = 'left';
  ctx.fillText(info, infoX + 9, infoY + 12, infoWidth - 18);
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawMessage(ctx, width, height, message) {
  ctx.fillStyle = '#aeb8c8';
  ctx.font = '14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(message, width / 2, height / 2);
  ctx.textAlign = 'left';
}

function nearestCandleIndex(layout, step, count = drawableCandles.value.length) {
  return Math.min(
    count - 1,
    Math.max(0, Math.round((hover.x - layout.left - step / 2) / step))
  );
}

function drawLineSeries(ctx, layout, values, yScale, step, color, lineWidth = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  let started = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      started = false;
      return;
    }
    const x = layout.left + index * step + step / 2;
    const y = yScale(value);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();
}

function drawBollinger(ctx, layout, candles, values, yScale, step) {
  const upper = values.map(row => row?.upper ?? null);
  const lower = values.map(row => row?.lower ?? null);
  const middle = values.map(row => row?.middle ?? null);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  let started = false;
  upper.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = layout.left + index * step + step / 2;
    const y = yScale(value);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  lower.slice().reverse().forEach((value, reverseIndex) => {
    if (!Number.isFinite(value)) return;
    const index = candles.length - 1 - reverseIndex;
    const x = layout.left + index * step + step / 2;
    const y = yScale(value);
    ctx.lineTo(x, y);
  });
  if (started) ctx.fill();
  ctx.globalAlpha = 1;
  drawLineSeries(ctx, layout, upper, yScale, step, '#38bdf8', 0.9);
  drawLineSeries(ctx, layout, middle, yScale, step, '#818cf8', 0.8);
  drawLineSeries(ctx, layout, lower, yScale, step, '#38bdf8', 0.9);
  ctx.restore();
}

function drawVolumeLine(ctx, layout, values, yScale, step, color) {
  ctx.save();
  ctx.globalAlpha = 0.8;
  drawLineSeries(ctx, layout, values, yScale, step, color, 1);
  ctx.restore();
}

function drawSupportResistance(ctx, layout, width, levels, yScale) {
  if (!levels) return;
  const items = [
    ['支撐', levels.support, '#22c55e'],
    ['壓力', levels.resistance, '#ef4444']
  ].filter(([, value]) => Number.isFinite(value));

  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  items.forEach(([label, value, color]) => {
    const y = yScale(value);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(layout.left, y);
    ctx.lineTo(width - layout.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(`${label} ${formatNumber(value, 2)}`, layout.left + 8, y - 6);
  });
  ctx.restore();
}

function drawSubPanel(ctx, layout, width, candles, series, yVolume, step, panelTop) {
  const panelBottom = panelTop + layout.volumeHeight;
  const panelRight = width - layout.right;

  ctx.save();
  ctx.strokeStyle = '#273246';
  ctx.beginPath();
  ctx.moveTo(layout.left, panelBottom);
  ctx.lineTo(panelRight, panelBottom);
  ctx.stroke();

  if (activePanel.value === 'volume') {
    drawVolumeLine(ctx, layout, series.volumeMa20, yVolume, step, '#94a3b8');
    drawVolumeLine(ctx, layout, series.volumeMa5, yVolume, step, '#facc15');
    drawPanelLabel(ctx, layout, '成交量 / VolMA5 / VolMA20');
    ctx.restore();
    return;
  }

  if (activePanel.value === 'rsi') {
    const y = value => panelTop + ((100 - value) / 100) * layout.volumeHeight;
    drawOscillatorGuide(ctx, layout, width, panelTop, [70, 50, 30], y);
    drawLineSeries(ctx, layout, series.rsi, y, step, '#60a5fa', 1.4);
    drawPanelLabel(ctx, layout, 'RSI 14');
    ctx.restore();
    return;
  }

  if (activePanel.value === 'kd') {
    const k = series.kd.map(row => row?.k ?? null);
    const d = series.kd.map(row => row?.d ?? null);
    const y = value => panelTop + ((100 - value) / 100) * layout.volumeHeight;
    drawOscillatorGuide(ctx, layout, width, panelTop, [80, 50, 20], y);
    drawLineSeries(ctx, layout, k, y, step, '#facc15', 1.4);
    drawLineSeries(ctx, layout, d, y, step, '#60a5fa', 1.2);
    drawPanelLabel(ctx, layout, 'KD 9');
    ctx.restore();
    return;
  }

  const histogram = series.macd.map(row => row?.histogram ?? null);
  const dif = series.macd.map(row => row?.macd ?? null);
  const dea = series.macd.map(row => row?.signal ?? null);
  const values = [...histogram, ...dif, ...dea].filter(Number.isFinite);
  const maxAbs = Math.max(...values.map(value => Math.abs(value)), 1);
  const y = value => panelTop + ((maxAbs - value) / (maxAbs * 2 || 1)) * layout.volumeHeight;
  const zeroY = y(0);
  ctx.strokeStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(layout.left, zeroY);
  ctx.lineTo(panelRight, zeroY);
  ctx.stroke();
  histogram.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = layout.left + index * step + step / 2;
    ctx.fillStyle = value >= 0 ? '#ef4444' : '#22c55e';
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x - Math.max(1, step * 0.25), Math.min(zeroY, y(value)), Math.max(1, step * 0.5), Math.abs(y(value) - zeroY) || 1);
    ctx.globalAlpha = 1;
  });
  drawLineSeries(ctx, layout, dif, y, step, '#facc15', 1.3);
  drawLineSeries(ctx, layout, dea, y, step, '#60a5fa', 1.1);
  drawPanelLabel(ctx, layout, 'MACD DIF / DEA');
  ctx.restore();
}

function drawOscillatorGuide(ctx, layout, width, panelTop, levels, yScale) {
  ctx.save();
  ctx.strokeStyle = '#273246';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px system-ui, sans-serif';
  levels.forEach(level => {
    const y = yScale(level);
    ctx.beginPath();
    ctx.moveTo(layout.left, y);
    ctx.lineTo(width - layout.right, y);
    ctx.stroke();
    ctx.fillText(String(level), width - layout.right + 8, y + 3);
  });
  ctx.restore();
}

function drawPanelLabel(ctx, layout, label) {
  ctx.save();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText(label, layout.left, layout.top + layout.priceHeight + layout.gap + 12);
  ctx.restore();
}

function drawIndicatorLegend(ctx, layout, panelTop) {
  const overlayItems = activeOverlay.value === 'bollinger'
    ? [['BB 上中下軌', '#38bdf8']]
    : activeOverlay.value === 'levels'
      ? [['支撐', '#22c55e'], ['壓力', '#ef4444']]
      : [['MA5', '#facc15'], ['MA10', '#c084fc'], ['MA20', '#60a5fa'], ['MA60', '#64748b']];
  const panelItems = activePanel.value === 'volume'
    ? [['VolMA5', '#facc15'], ['VolMA20', '#94a3b8']]
    : activePanel.value === 'rsi'
      ? [['RSI14', '#60a5fa']]
      : activePanel.value === 'kd'
        ? [['K', '#facc15'], ['D', '#60a5fa']]
        : [['DIF', '#facc15'], ['DEA', '#60a5fa'], ['柱', '#ef4444']];
  const items = [...overlayItems, ...panelItems];
  ctx.save();
  ctx.font = '10px system-ui, sans-serif';
  let x = layout.left;
  const y = Math.max(layout.top + 12, panelTop - 8);
  items.forEach(([label, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 7, 12, 2);
    ctx.fillStyle = '#aeb8c8';
    ctx.fillText(label, x + 15, y - 3);
    x += ctx.measureText(label).width + 34;
  });
  ctx.restore();
}

function normalizeDrawableCandle(row) {
  const open = Number(row.open);
  const close = Number(row.close);
  const rawHigh = Number(row.high);
  const rawLow = Number(row.low);
  if (![open, close, rawHigh, rawLow].every(Number.isFinite) || open <= 0 || close <= 0) return null;

  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);
  const high = rawHigh >= bodyHigh ? rawHigh : bodyHigh;
  let low = rawLow > 0 && rawLow <= bodyLow ? rawLow : bodyLow;
  const reference = close || bodyLow;
  if (reference > 0 && bodyLow - low > reference * 0.35) low = bodyLow;

  return {
    ...row,
    open,
    high,
    low,
    close,
    volume: Number(row.volume || 0)
  };
}

function formatChartVolume(value) {
  const number = Number(value || 0);
  if (number >= 100000000) return `${formatNumber(number / 100000000, 2)}億`;
  if (number >= 10000) return `${formatNumber(number / 10000, 1)}萬`;
  return formatNumber(number);
}

function formatReadoutTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const options = props.interval === 'D'
    ? { year: 'numeric', month: '2-digit', day: '2-digit' }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleString('zh-TW', options);
}
</script>

<template>
  <div class="stock-chart-frame">
    <div class="chart-indicator-toolbar">
      <div class="chart-indicator-group" aria-label="主圖指標">
        <button
          v-for="item in overlayOptions"
          :key="item.key"
          class="chart-indicator-btn"
          :class="{ active: activeOverlay === item.key }"
          type="button"
          @click="setOverlay(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="chart-indicator-group" aria-label="副圖指標">
        <button
          v-for="item in panelOptions"
          :key="item.key"
          class="chart-indicator-btn"
          :class="{ active: activePanel === item.key }"
          type="button"
          @click="setPanel(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
    <div v-if="selectedCandle" class="mobile-chart-readout">
      <div>
        <span class="readout-label">時間</span>
        <strong>{{ formatReadoutTime(selectedCandle.time) }}</strong>
      </div>
      <div>
        <span class="readout-label">開</span>
        <strong>{{ formatNumber(selectedCandle.open, 2) }}</strong>
      </div>
      <div>
        <span class="readout-label">高</span>
        <strong>{{ formatNumber(selectedCandle.high, 2) }}</strong>
      </div>
      <div>
        <span class="readout-label">低</span>
        <strong>{{ formatNumber(selectedCandle.low, 2) }}</strong>
      </div>
      <div>
        <span class="readout-label">收</span>
        <strong>{{ formatNumber(selectedCandle.close, 2) }}</strong>
      </div>
      <div>
        <span class="readout-label">量</span>
        <strong>{{ formatChartVolume(selectedCandle.volume) }}</strong>
      </div>
    </div>
    <div class="stock-chart-canvas">
      <canvas
        ref="canvasEl"
        data-stock-chart
        aria-label="股票走勢圖"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointercancel="handlePointerUp"
        @pointerleave="handlePointerLeave"
      ></canvas>
    </div>
  </div>
</template>
