const RETURN_WINDOWS = [1, 3, 5, 10];

export const BACKTEST_STRATEGIES = [
  {
    key: 'strongBuy',
    label: '強力買入訊號',
    description: '收盤價站上 MA5 / MA20，MA5 高於 MA20，當日上漲且量能放大。'
  },
  {
    key: 'institutionalStreak',
    label: '法人連買',
    description: '三大法人合計連續 3 日買超後，觀察後續報酬。'
  },
  {
    key: 'downVolumeDry',
    label: '價跌量縮',
    description: '股價下跌但成交量低於近 20 日均量，觀察後續反彈機率。'
  },
  {
    key: 'marginSurge',
    label: '融資暴增',
    description: '融資餘額日增幅明顯高於近期平均，觀察後續風險表現。'
  }
];

export function buildStrategyBacktest({ candles = [], institutionalTrend = [], marginRows = [] } = {}) {
  const rows = normalizeCandles(candles);
  const enriched = enrichCandleRows(rows);
  const institutionalByDate = mapInstitutionalTrend(institutionalTrend);
  const marginByDate = mapMarginRows(marginRows);

  return BACKTEST_STRATEGIES.map(strategy => {
    const events = enriched
      .map((row, index) => buildEvent(strategy.key, row, index, enriched, institutionalByDate, marginByDate))
      .filter(Boolean);

    return {
      ...strategy,
      events,
      windows: RETURN_WINDOWS.map(days => summarizeWindow(events, days)),
      latestEvent: events.at(-1) || null
    };
  });
}

function normalizeCandles(candles) {
  return (Array.isArray(candles) ? candles : [])
    .map(row => ({
      date: formatDate(row.time || row.date),
      time: Number(row.time || 0),
      open: Number(row.open || 0),
      high: Number(row.high || row.close || 0),
      low: Number(row.low || row.close || 0),
      close: Number(row.close || 0),
      volume: Number(row.volume || 0)
    }))
    .filter(row => row.date && row.close > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function enrichCandleRows(rows) {
  return rows.map((row, index) => {
    const prev = rows[index - 1];
    const closeValues = rows.slice(0, index + 1).map(item => item.close);
    const volumeValues = rows.slice(0, index).map(item => item.volume).filter(value => value > 0);
    const avgVolume20 = average(volumeValues.slice(-20));
    const chgPct = prev?.close ? ((row.close - prev.close) / prev.close) * 100 : null;
    const volumeRatio = avgVolume20 ? (row.volume / avgVolume20) * 100 : null;
    return {
      ...row,
      index,
      chgPct,
      volumeRatio,
      ma5: movingAverage(closeValues, 5),
      ma20: movingAverage(closeValues, 20),
      ma60: movingAverage(closeValues, 60)
    };
  });
}

function buildEvent(strategyKey, row, index, rows, institutionalByDate, marginByDate) {
  if (index < 20 || index + 1 >= rows.length) return null;

  if (strategyKey === 'strongBuy') {
    const matches = row.close > row.ma5 &&
      row.ma5 > row.ma20 &&
      Number(row.chgPct) >= 1 &&
      Number(row.volumeRatio) >= 120;
    return matches ? buildReturnEvent(row, index, rows, {
      signal: `漲幅 ${formatPct(row.chgPct)}，量比 ${formatPct(row.volumeRatio, 0)}`
    }) : null;
  }

  if (strategyKey === 'institutionalStreak') {
    const streak = countInstitutionalBuyStreak(row.date, rows, institutionalByDate, index);
    return streak >= 3 ? buildReturnEvent(row, index, rows, {
      signal: `法人連買 ${streak} 日`
    }) : null;
  }

  if (strategyKey === 'downVolumeDry') {
    const matches = Number(row.chgPct) <= -1 && Number(row.volumeRatio) > 0 && Number(row.volumeRatio) <= 80;
    return matches ? buildReturnEvent(row, index, rows, {
      signal: `跌幅 ${formatPct(row.chgPct)}，量比 ${formatPct(row.volumeRatio, 0)}`
    }) : null;
  }

  if (strategyKey === 'marginSurge') {
    const current = marginByDate.get(row.date);
    if (!current) return null;
    const recent = previousMarginRows(row.date, marginByDate).slice(-10);
    const avgAbsChange = average(recent.map(item => Math.abs(item.marginChange || 0)).filter(value => value > 0));
    const matches = current.marginChange > 0 && avgAbsChange > 0 && current.marginChange >= Math.max(100, avgAbsChange * 2);
    return matches ? buildReturnEvent(row, index, rows, {
      signal: `融資增加 ${formatNumber(current.marginChange)} 張，約為近期均值 ${avgAbsChange.toFixed(0)} 張的 2 倍以上`
    }) : null;
  }

  return null;
}

function buildReturnEvent(row, index, rows, extra = {}) {
  const returns = {};
  for (const days of RETURN_WINDOWS) {
    const future = rows[index + days];
    returns[days] = future?.close
      ? Number((((future.close - row.close) / row.close) * 100).toFixed(2))
      : null;
  }

  return {
    date: row.date,
    close: row.close,
    volumeRatio: row.volumeRatio,
    chgPct: row.chgPct,
    returns,
    ...extra
  };
}

function summarizeWindow(events, days) {
  const values = events
    .map(event => event.returns[days])
    .filter(value => Number.isFinite(value));
  const wins = values.filter(value => value > 0).length;

  return {
    days,
    samples: values.length,
    avgReturn: values.length ? Number(average(values).toFixed(2)) : null,
    winRate: values.length ? Math.round((wins / values.length) * 100) : null,
    bestReturn: values.length ? Number(Math.max(...values).toFixed(2)) : null,
    worstReturn: values.length ? Number(Math.min(...values).toFixed(2)) : null
  };
}

function mapInstitutionalTrend(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const date = normalizeDate(row.date);
    if (!date) return;
    map.set(date, {
      date,
      total: Number(row.total || 0),
      foreign: Number(row.foreign || 0),
      trust: Number(row.trust || 0),
      dealer: Number(row.dealer || 0)
    });
  });
  return map;
}

function countInstitutionalBuyStreak(date, candleRows, institutionalByDate, index) {
  let streak = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const rowDate = candleRows[cursor]?.date;
    const inst = institutionalByDate.get(rowDate);
    if (!inst) continue;
    if (inst.total <= 0) break;
    streak += 1;
  }
  return institutionalByDate.has(date) ? streak : 0;
}

function mapMarginRows(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const date = normalizeDate(row.date);
    if (!date) return;
    map.set(date, {
      date,
      marginChange: Number(row.marginChange || 0),
      marginBalance: Number(row.marginBalance || 0),
      shortChange: Number(row.shortChange || 0),
      shortBalance: Number(row.shortBalance || 0)
    });
  });
  return map;
}

function previousMarginRows(date, marginByDate) {
  return [...marginByDate.values()]
    .filter(row => row.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function movingAverage(values, period) {
  const sample = values.slice(-period).filter(Number.isFinite);
  if (sample.length < period) return null;
  return average(sample);
}

function average(values) {
  const sample = values.filter(Number.isFinite);
  if (!sample.length) return null;
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
}

function formatDate(value) {
  if (!value) return '';
  if (typeof value === 'string') return normalizeDate(value);
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{3}\/\d{2}\/\d{2}$/.test(text)) {
    const [year, month, day] = text.split('/');
    return `${Number(year) + 1911}-${month}-${day}`;
  }
  return '';
}

function formatPct(value, digits = 2) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}%` : '--';
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}
