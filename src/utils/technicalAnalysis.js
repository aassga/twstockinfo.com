const MA_SHORT = 5;
const MA_MID = 20;
const MA_LONG = 60;
const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

export function buildTechnicalSummary(candles = [], options = {}) {
  const interval = normalizeInterval(options.interval);
  const rows = candles
    .map(row => ({
      ...row,
      close: Number(row.close || 0),
      volume: Number(row.volume || 0)
    }))
    .filter(row => row.close > 0);

  const latest = rows.at(-1);
  const previous = rows.at(-2);
  if (!latest) return null;

  const closes = rows.map(row => row.close);
  const volumes = rows.map(row => row.volume);
  const ma5 = movingAverage(closes, MA_SHORT);
  const ma20 = movingAverage(closes, MA_MID);
  const ma60 = movingAverage(closes, MA_LONG);
  const avgVolume20 = movingAverage(volumes.slice(0, -1), MA_MID);
  const volumeRatio = avgVolume20 > 0 ? (latest.volume / avgVolume20) * 100 : null;
  const rsi = calculateRsi(closes, RSI_PERIOD);
  const macd = calculateMacd(closes);
  const supportResistance = calculateSupportResistance(rows, latest.close);
  const changePct = previous?.close
    ? ((latest.close - previous.close) / previous.close) * 100
    : null;

  return {
    latestClose: latest.close,
    changePct,
    ma5,
    ma20,
    ma60,
    rsi,
    macd,
    supportResistance,
    volumeRatio,
    avgVolume20,
    interval,
    intervalLabel: intervalLabel(interval),
    trend: classifyTrend(latest.close, ma5, ma20, ma60, interval),
    momentum: classifyMomentum(rsi, macd?.histogram, interval),
    volumeSignal: classifyPriceVolume(changePct, volumeRatio),
    priceVolumeNote: priceVolumeNote(changePct, volumeRatio, interval),
    maLabels: maLabels(interval)
  };
}

function movingAverage(values, period) {
  const sample = values
    .filter(value => Number.isFinite(value) && value > 0)
    .slice(-period);
  if (sample.length < period) return null;
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
}

function calculateRsi(values, period) {
  if (values.length <= period) return null;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  const sample = changes.slice(-period);
  const gains = sample.reduce((sum, value) => sum + Math.max(value, 0), 0) / period;
  const losses = sample.reduce((sum, value) => sum + Math.max(-value, 0), 0) / period;
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function calculateMacd(values) {
  const fast = emaSeries(values, MACD_FAST);
  const slow = emaSeries(values, MACD_SLOW);
  const macdLine = values.map((_, index) => {
    if (!Number.isFinite(fast[index]) || !Number.isFinite(slow[index])) return null;
    return fast[index] - slow[index];
  });
  const signalLine = emaSeries(macdLine.filter(value => value !== null), MACD_SIGNAL);
  const macdValue = macdLine.at(-1);
  const signalValue = signalLine.at(-1);
  if (!Number.isFinite(macdValue) || !Number.isFinite(signalValue)) return null;
  return {
    macd: macdValue,
    signal: signalValue,
    histogram: macdValue - signalValue
  };
}

function calculateSupportResistance(rows, latestClose) {
  const sample = rows
    .slice(-80)
    .map(row => ({
      high: Number(row.high || row.close || 0),
      low: Number(row.low || row.close || 0),
      close: Number(row.close || 0)
    }))
    .filter(row => row.high > 0 && row.low > 0 && row.close > 0);

  if (!sample.length || !Number.isFinite(latestClose)) {
    return {
      support: null,
      resistance: null,
      supportDistancePct: null,
      resistanceDistancePct: null
    };
  }

  const lows = sample.map(row => row.low).filter(value => value <= latestClose);
  const highs = sample.map(row => row.high).filter(value => value >= latestClose);
  const fallbackLow = Math.min(...sample.map(row => row.low));
  const fallbackHigh = Math.max(...sample.map(row => row.high));
  const support = lows.length ? Math.max(...lows) : fallbackLow;
  const resistance = highs.length ? Math.min(...highs) : fallbackHigh;

  return {
    support,
    resistance,
    supportDistancePct: support > 0 ? ((latestClose - support) / support) * 100 : null,
    resistanceDistancePct: latestClose > 0 ? ((resistance - latestClose) / latestClose) * 100 : null
  };
}

function emaSeries(values, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  let previous = null;

  values.forEach(value => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      result.push(null);
      return;
    }
    previous = previous === null ? number : (number - previous) * multiplier + previous;
    result.push(previous);
  });

  return result;
}

function normalizeInterval(interval) {
  if (interval === '60') return '60';
  if (interval === '240') return '240';
  return 'D';
}

function intervalLabel(interval) {
  if (interval === '60') return '1小時';
  if (interval === '240') return '4小時';
  return '日線';
}

function maLabels(interval) {
  if (interval === '60') return { short: '5小時均線', mid: '20小時均線', long: '60小時均線' };
  if (interval === '240') return { short: '5根4時K均線', mid: '20根4時K均線', long: '60根4時K均線' };
  return { short: 'MA5', mid: 'MA20', long: 'MA60' };
}

function classifyTrend(price, ma5, ma20, ma60, interval) {
  if (!ma5 || !ma20) return { label: '資料不足', type: 'neutral' };
  const shortPrefix = interval === 'D' ? '' : '短線';
  if (price > ma5 && ma5 > ma20 && (!ma60 || ma20 > ma60)) {
    return { label: `${shortPrefix}多頭排列`, type: 'up' };
  }
  if (price < ma5 && ma5 < ma20 && (!ma60 || ma20 < ma60)) {
    return { label: `${shortPrefix}空頭排列`, type: 'down' };
  }
  if (price >= ma20) return { label: `${shortPrefix}偏多整理`, type: 'up' };
  return { label: `${shortPrefix}偏弱整理`, type: 'down' };
}

function classifyMomentum(rsi, macdHistogram, interval) {
  if (!Number.isFinite(rsi)) return { label: '資料不足', type: 'neutral' };
  const prefix = interval === 'D' ? '' : '短線';
  if (rsi >= 70) return { label: `${prefix}偏熱`, type: 'up' };
  if (rsi <= 30) return { label: `${prefix}偏冷`, type: 'down' };
  if (Number.isFinite(macdHistogram) && macdHistogram > 0) return { label: '動能轉強', type: 'up' };
  if (Number.isFinite(macdHistogram) && macdHistogram < 0) return { label: '動能轉弱', type: 'down' };
  return { label: '中性', type: 'neutral' };
}

function classifyPriceVolume(changePct, volumeRatio) {
  if (!Number.isFinite(changePct) || !Number.isFinite(volumeRatio)) {
    return { label: '量價待確認', type: 'neutral' };
  }
  const volumeUp = volumeRatio >= 100;
  if (changePct > 0 && volumeUp) return { label: '價漲量增', type: 'up' };
  if (changePct > 0 && !volumeUp) return { label: '價漲量縮', type: 'neutral' };
  if (changePct < 0 && volumeUp) return { label: '價跌量增', type: 'down' };
  if (changePct < 0 && !volumeUp) return { label: '價跌量縮', type: 'neutral' };
  return { label: '平盤整理', type: 'neutral' };
}

function priceVolumeNote(changePct, volumeRatio, interval) {
  const scope = interval === 'D' ? '日線' : `${intervalLabel(interval)}K`;
  if (!Number.isFinite(changePct) || !Number.isFinite(volumeRatio)) {
    return '需要完整成交量資料後才能判斷量增或量縮。';
  }
  if (changePct < 0 && volumeRatio < 100) {
    return `${scope}價格下跌但量能低於近20根均量，偏向賣壓縮小，仍需等止跌訊號。`;
  }
  if (changePct < 0 && volumeRatio >= 100) {
    return `${scope}價格下跌且量能放大，代表賣壓較明顯，需留意支撐是否失守。`;
  }
  if (changePct > 0 && volumeRatio >= 100) {
    return `${scope}價格上漲且量能放大，短線動能較明確。`;
  }
  if (changePct > 0 && volumeRatio < 100) {
    return `${scope}價格上漲但量能不足，追價前適合等待補量確認。`;
  }
  return `${scope}價格接近平盤，觀察後續量能是否放大。`;
}
