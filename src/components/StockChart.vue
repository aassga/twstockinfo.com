<script setup>
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
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

let canvas;
let resizeObserver;

onMounted(() => {
  canvas = document.querySelector('[data-stock-chart]');
  resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(canvas.parentElement);
  draw();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

watch(() => [props.candles, props.interval, props.loading, props.error], () => nextTick(draw), { deep: true });

function draw() {
  if (!canvas) return;
  const frame = canvas.parentElement;
  const width = frame.clientWidth || 320;
  const height = frame.clientHeight || 360;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height);

  if (props.loading) return drawMessage(ctx, width, height, '載入中');
  if (props.error) return drawMessage(ctx, width, height, props.error);
  if (!props.candles.length) return drawMessage(ctx, width, height, '尚未選擇股票');

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

  const priceMin = Math.min(...props.candles.map(row => row.low));
  const priceMax = Math.max(...props.candles.map(row => row.high));
  const pad = Math.max((priceMax - priceMin) * 0.08, priceMax * 0.01);
  const min = priceMin - pad;
  const max = priceMax + pad;
  const volumeMax = Math.max(...props.candles.map(row => row.volume || 0), 1);
  const step = layout.plotWidth / Math.max(props.candles.length, 1);
  const candleWidth = Math.max(2, Math.min(9, step * 0.58));
  const volumeTop = layout.top + layout.priceHeight + layout.gap;
  const yPrice = value => layout.top + ((max - value) / (max - min || 1)) * layout.priceHeight;
  const yVolume = value => volumeTop + layout.volumeHeight - (value / volumeMax) * layout.volumeHeight;

  drawGrid(ctx, layout, width, height, min, max, volumeTop);

  props.candles.forEach((row, index) => {
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
    ctx.globalAlpha = 0.24;
    ctx.fillRect(x - candleWidth / 2, yVolume(row.volume || 0), candleWidth, volumeTop + layout.volumeHeight - yVolume(row.volume || 0));
    ctx.globalAlpha = 1;
  });

  drawAxes(ctx, layout, width, height, min, max);
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

function drawAxes(ctx, layout, width, height, min, max) {
  const first = props.candles[0];
  const last = props.candles[props.candles.length - 1];
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

function drawMessage(ctx, width, height, message) {
  ctx.fillStyle = '#aeb8c8';
  ctx.font = '14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(message, width / 2, height / 2);
  ctx.textAlign = 'left';
}
</script>

<template>
  <div class="stock-chart-frame">
    <canvas data-stock-chart aria-label="股票走勢圖"></canvas>
  </div>
</template>
