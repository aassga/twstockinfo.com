import { apiFetch } from './http';

export const stockApi = {
  market: () => apiFetch('/twse/exchangeReport/MI_INDEX').then(parseMarket),
  allStocks: () => apiFetch('/twse/exchangeReport/STOCK_DAY_ALL').then(parseAllStocks),
  quote: code => apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw&json=1&delay=0&_=${Date.now()}`).then(data => parseQuote(data, code)),
  quoteOtc: code => apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=otc_${code}.tw&json=1&delay=0&_=${Date.now()}`).then(data => parseQuote(data, code)),
  quotes: codes => fetchQuotes(codes),
  quoteAuto,
  institutional: () => fetchLatestTwseRwd('/rwd/zh/fund/T86', '&selectType=ALLBUT0999').then(parseInstitutional),
  instSummary: () => fetchLatestTwseRwd('/rwd/zh/fund/BFI82U').then(parseInstitutionalSummary),
  chart: (code, interval = 'D', exchange = '') => fetchYahooChart(code, interval, exchange)
};

async function quoteAuto(code) {
  try {
    const quote = await stockApi.quote(code);
    if (quote.name) return quote;
  } catch (error) {
    // Listed stocks are tried first, then OTC.
  }
  return stockApi.quoteOtc(code);
}

async function fetchQuotes(codes, exchange = 'tse') {
  const uniqueCodes = [...new Set(
    codes
      .map(code => String(code || '').trim())
      .filter(code => /^\d{4,6}$/.test(code))
  )];

  if (!uniqueCodes.length) return [];

  const chunks = chunkArray(uniqueCodes, 50);
  const groups = await Promise.all(chunks.map(chunk => {
    const exCh = chunk.map(code => `${exchange}_${code}.tw`).join('|');
    return apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`)
      .then(parseQuotes);
  }));

  return groups.flat();
}

function parseMarket(data) {
  const rows = Array.isArray(data) ? data : [];
  const weighted = rows.find(row => Object.values(row).some(value => String(value).includes('發行量加權股價指數')));
  const row = weighted || rows[0] || {};
  const taiex = parseNumber(read(row, ['收盤指數', '收盤價', '指數', 'Index']));
  const rawChange = read(row, ['漲跌點數', '漲跌', 'Change']);
  const rawChangePct = read(row, ['漲跌百分比', '漲跌幅', 'ChangePercent']);
  const rawSign = read(row, ['漲跌(+/-)', '漲跌符號', 'Sign']);
  const changeValue = parseNumber(rawChange);
  const changePctValue = parseNumber(rawChangePct);
  const negative = isNegativeMarketMove(rawSign) ||
    isNegativeMarketMove(rawChange) ||
    changeValue < 0 ||
    changePctValue < 0;
  const sign = negative ? '-' : '+';
  const change = Number((Math.abs(changeValue) * (negative ? -1 : 1)).toFixed(2));
  const changePct = Number((Math.abs(changePctValue) * (negative ? -1 : 1)).toFixed(2));

  return {
    taiex,
    change,
    changePct,
    sign
  };
}

function parseAllStocks(data) {
  const rows = Array.isArray(data) ? data : [];
  const result = [];

  for (const row of rows) {
    const code = String(read(row, ['Code', '證券代號']) || '').trim();
    const name = String(read(row, ['Name', '證券名稱']) || '').trim();
    const price = parseNumber(read(row, ['ClosingPrice', '收盤價']));
    const change = parseNumber(read(row, ['Change', '漲跌價差']));
    const volume = parseNumber(read(row, ['TradeVolume', '成交股數']));
    const value = parseNumber(read(row, ['TradeValue', '成交金額']));
    const high = parseNumber(read(row, ['HighestPrice', '最高價']), price);
    const low = parseNumber(read(row, ['LowestPrice', '最低價']), price);

    if (!/^\d{4,6}$/.test(code) || price <= 0) continue;

    const prev = price - change;
    const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
    result.push({
      code,
      name,
      price,
      change,
      chgPct,
      high,
      low,
      volume,
      amountHundredMillion: Number((value / 100000000).toFixed(2))
    });
  }

  return result.sort((a, b) => b.volume - a.volume).slice(0, 300);
}

function parseQuote(data, code) {
  const item = data?.msgArray?.[0];
  if (!item?.c || !item?.n) {
    throw new Error(`找不到股票：${code}`);
  }

  const prev = parseNumber(item.y);
  const price = parseNumber(item.z && item.z !== '-' ? item.z : item.y, prev);
  const change = Number((price - prev).toFixed(2));
  const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
  const bidVol = String(item.g || '').split('_').filter(Boolean).map(Number);
  const askVol = String(item.f || '').split('_').filter(Boolean).map(Number);
  const bidTotal = bidVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
  const askTotal = askVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
  const buyPct = bidTotal + askTotal > 0 ? Math.round((bidTotal / (bidTotal + askTotal)) * 100) : 50;
  const volume = parseNumber(item.v);

  return {
    code: item.c || code,
    name: item.n || '',
    exchange: item.ex || '',
    price,
    prev,
    change,
    chgPct,
    open: parseNumber(item.o, price),
    high: parseNumber(item.h, price),
    low: parseNumber(item.l, price),
    volume,
    amountHundredMillion: Number(((price * volume * 1000) / 100000000).toFixed(2)),
    buyPct,
    sellPct: 100 - buyPct,
    volRatio: Math.min(100, Math.round((parseNumber(item.tv) / Math.max(parseNumber(item.v, 1), 1)) * 100)),
    time: item.t || '',
    date: item.d || ''
  };
}

function parseQuotes(data) {
  const rows = Array.isArray(data?.msgArray) ? data.msgArray : [];
  return rows.map(item => {
    if (!item?.c || !item?.n) return null;

    const prev = parseNumber(item.y);
    const price = parseNumber(item.z && item.z !== '-' ? item.z : item.y, prev);
    const change = Number((price - prev).toFixed(2));
    const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
    const bidVol = String(item.g || '').split('_').filter(Boolean).map(Number);
    const askVol = String(item.f || '').split('_').filter(Boolean).map(Number);
    const bidTotal = bidVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
    const askTotal = askVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
    const buyPct = bidTotal + askTotal > 0 ? Math.round((bidTotal / (bidTotal + askTotal)) * 100) : 50;
    const volume = parseNumber(item.v);

    return {
      code: item.c,
      name: item.n || '',
      exchange: item.ex || '',
      price,
      prev,
      change,
      chgPct,
      open: parseNumber(item.o, price),
      high: parseNumber(item.h, price),
      low: parseNumber(item.l, price),
      volume,
      amountHundredMillion: Number(((price * volume * 1000) / 100000000).toFixed(2)),
      buyPct,
      sellPct: 100 - buyPct,
      volRatio: Math.min(100, Math.round((parseNumber(item.tv) / Math.max(parseNumber(item.v, 1), 1)) * 100)),
      time: item.t || '',
      date: item.d || ''
    };
  }).filter(Boolean);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchYahooChart(code, interval, exchange = '') {
  const market = String(exchange || '').toLowerCase() === 'otc' ? 'TWO' : 'TW';
  try {
    return await fetchYahooChartBySymbol(`${code}.${market}`, interval);
  } catch (error) {
    if (market === 'TW') return fetchYahooChartBySymbol(`${code}.TWO`, interval);
    throw error;
  }
}

async function fetchYahooChartBySymbol(symbol, interval) {
  const params = getYahooChartParams(interval);
  const data = await apiFetch(`/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?range=${params.range}&interval=${params.interval}&includePrePost=false`);
  const result = data?.chart?.result?.[0];

  if (!result) {
    throw new Error(data?.chart?.error?.description || '無法取得走勢圖資料');
  }

  const quote = result.indicators?.quote?.[0] || {};
  const rows = (result.timestamp || []).map((timestamp, index) => ({
    time: Number(timestamp) * 1000,
    open: Number(quote.open?.[index]),
    high: Number(quote.high?.[index]),
    low: Number(quote.low?.[index]),
    close: Number(quote.close?.[index]),
    volume: Number(quote.volume?.[index] || 0)
  })).filter(row =>
    Number.isFinite(row.open) &&
    Number.isFinite(row.high) &&
    Number.isFinite(row.low) &&
    Number.isFinite(row.close)
  );

  const candles = interval === '240' ? aggregateCandles(rows, 4) : rows;
  if (!candles.length) throw new Error('無走勢圖資料');

  return {
    symbol,
    candles,
    currency: result.meta?.currency || 'TWD'
  };
}

function getYahooChartParams(interval) {
  if (interval === '60') return { range: '1mo', interval: '60m' };
  if (interval === '240') return { range: '3mo', interval: '60m' };
  return { range: '1y', interval: '1d' };
}

function aggregateCandles(rows, size) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) {
    const group = rows.slice(index, index + size);
    if (!group.length) continue;
    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(row => row.high)),
      low: Math.min(...group.map(row => row.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, row) => sum + Number(row.volume || 0), 0)
    });
  }
  return result;
}

function parseInstitutional(data) {
  const rows = normalizeTwseRows(data);
  return rows.map(row => {
    const foreign = toHundredMillion(read(row, ['外陸資買賣超股數(不含外資自營商)', '外資買賣超股數']));
    const trust = toHundredMillion(read(row, ['投信買賣超股數']));
    const dealer = toHundredMillion(read(row, ['自營商買賣超股數', '自營商買賣超股數(自行買賣)']));
    return {
      code: String(read(row, ['證券代號']) || ''),
      name: String(read(row, ['證券名稱']) || ''),
      foreign,
      trust,
      dealer,
      total: Number((foreign + trust + dealer).toFixed(2))
    };
  }).filter(row => row.code && row.name)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function parseInstitutionalSummary(data) {
  const rows = normalizeTwseRows(data);
  const foreign = rows.find(row => /外資|外陸/.test(String(read(row, ['單位名稱']) || '')));
  const trust = rows.find(row => /投信/.test(String(read(row, ['單位名稱']) || '')));
  const dealers = rows.filter(row => /自營商/.test(String(read(row, ['單位名稱']) || '')));

  return {
    foreign: toHundredMillion(read(foreign, ['買賣差額'])),
    trust: toHundredMillion(read(trust, ['買賣差額'])),
    dealer: Number(dealers.reduce((sum, row) => sum + toHundredMillion(read(row, ['買賣差額'])), 0).toFixed(2))
  };
}

async function fetchLatestTwseRwd(path, extraParams = '') {
  let lastError = null;

  for (const date of getRecentTaiwanDates(10)) {
    try {
      const data = await apiFetch(`${path}?response=json&date=${date}${extraParams}`);
      if (data?.stat === 'OK' && Array.isArray(data.data) && data.data.length) return data;
      lastError = new Error(data?.stat || '沒有符合條件的資料');
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('無法取得 TWSE 資料');
}

function getRecentTaiwanDates(days) {
  const result = [];
  const now = new Date();

  for (let index = 0; index < days; index += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    result.push(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`);
  }

  return result;
}

function normalizeTwseRows(data) {
  if (Array.isArray(data)) return data;
  if (!data || !Array.isArray(data.fields) || !Array.isArray(data.data)) return [];
  return data.data.map(row => Object.fromEntries(data.fields.map((field, index) => [field, row[index]])));
}

function read(row, keys) {
  if (!row) return '';
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return '';
}

function parseNumber(value, fallback = 0) {
  const normalized = String(value ?? '')
    .replace(/,/g, '')
    .replace(/[－−]/g, '-')
    .replace(/[＋]/g, '+');
  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) ? number : fallback;
}

function isNegativeMarketMove(value) {
  return /-|－|−|▼|跌|down/i.test(String(value ?? ''));
}

function toHundredMillion(value) {
  return Number((parseNumber(value) / 100000000).toFixed(2));
}
