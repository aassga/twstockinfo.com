import { apiFetch } from './http';

export const stockApi = {
  market: () => fetchMarketRealtime().catch(() => apiFetch('/twse/exchangeReport/MI_INDEX').then(parseMarket)),
  allStocks: () => apiFetch('/twse/exchangeReport/STOCK_DAY_ALL').then(parseAllStocks),
  topVolume: () => fetchRealtimeTopVolume().catch(() => apiFetch('/twse/exchangeReport/MI_INDEX20').then(parseTopVolume)),
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

  try {
    const quote = await stockApi.quoteOtc(code);
    if (quote.name) return quote;
  } catch (error) {
    // Fall back to Yahoo chart metadata when TWSE MIS is temporarily blocked.
  }

  try {
    return await fetchYahooRealtimeQuote(code, 'TW');
  } catch (error) {
    return fetchYahooRealtimeQuote(code, 'TWO');
  }
}

async function fetchQuotes(codes, exchange = 'tse') {
  const uniqueCodes = [...new Set(
    codes
      .map(code => String(code || '').trim())
      .filter(code => /^\d{4,6}$/.test(code))
  )];

  if (!uniqueCodes.length) return [];

  const chunks = chunkArray(uniqueCodes, 50);
  const groups = await Promise.all(chunks.map(async chunk => {
    try {
      const exCh = chunk.map(code => `${exchange}_${code}.tw`).join('|');
      return await apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`)
        .then(parseQuotes);
    } catch (error) {
      return fetchYahooRealtimeQuotes(chunk);
    }
  }));

  return groups.flat();
}

async function fetchMarketRealtime() {
  const data = await apiFetch(`/yahoo/v8/finance/chart/${encodeURIComponent('^TWII')}?range=1d&interval=1m&includePrePost=false&_=${Date.now()}`);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const price = parseNumber(meta.regularMarketPrice);
  const prev = parseNumber(meta.chartPreviousClose ?? meta.previousClose);

  if (!price || !prev) throw new Error('無法取得即時加權指數');

  const change = Number((price - prev).toFixed(2));
  const changePct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;

  return {
    taiex: price,
    change,
    changePct,
    sign: change < 0 ? '-' : '+',
    source: 'yahoo',
    time: meta.regularMarketTime ? formatUnixTime(meta.regularMarketTime) : ''
  };
}

async function fetchRealtimeTopVolume() {
  const baseRows = await apiFetch('/twse/exchangeReport/STOCK_DAY_ALL').then(parseAllStocks);
  const candidates = baseRows.slice(0, 300);
  const quotes = await fetchQuotes(candidates.map(stock => stock.code));
  const quoteByCode = new Map(quotes.map(quote => [String(quote.code), quote]));

  const rows = candidates.map(stock => {
    const quote = quoteByCode.get(stock.code);
    if (!quote) return null;

    const close = Number(quote.price || stock.price || 0);
    return {
      date: quote.date || todayTaiwanDate(),
      code: stock.code,
      name: quote.name || stock.name,
      volume: Number(quote.volume || stock.volume || 0),
      transaction: Number(quote.transaction || stock.transaction || 0),
      open: Number(quote.open || stock.open || close),
      high: Number(quote.high || stock.high || close),
      low: Number(quote.low || stock.low || close),
      close,
      change: Number(quote.change || 0),
      bid: Number(quote.bid || stock.bid || close),
      ask: Number(quote.ask || stock.ask || close),
      source: quote.source || 'realtime'
    };
  }).filter(row => row?.code && row.name && row.volume > 0);

  if (!rows.length) throw new Error('無法取得即時成交量排行');

  return rows
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 20)
    .map((row, index) => ({ ...row, rank: index + 1 }));
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
    const transaction = parseNumber(read(row, ['Transaction', '成交筆數']));
    const high = parseNumber(read(row, ['HighestPrice', '最高價']), price);
    const low = parseNumber(read(row, ['LowestPrice', '最低價']), price);
    const open = parseNumber(read(row, ['OpeningPrice', '開盤價']), price);
    const bid = parseNumber(read(row, ['LastBestBidPrice', '最後揭示買價']), price);
    const ask = parseNumber(read(row, ['LastBestAskPrice', '最後揭示賣價']), price);

    if (!/^\d{4,6}$/.test(code) || price <= 0) continue;

    const prev = price - change;
    const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
    result.push({
      code,
      name,
      price,
      change,
      chgPct,
      open,
      high,
      low,
      volume,
      transaction,
      bid,
      ask,
      amountHundredMillion: Number((value / 100000000).toFixed(2))
    });
  }

  return result.sort((a, b) => b.volume - a.volume).slice(0, 300);
}

function parseTopVolume(data) {
  const rows = normalizeTwseRows(data);

  return rows.map((row, index) => {
    const code = String(read(row, ['Code', '證券代號']) || '').trim();
    const name = String(read(row, ['Name', '證券名稱']) || '').trim();
    const dir = read(row, ['Dir', '漲跌(+/-)']);

    return {
      rank: parseNumber(read(row, ['Rank', '排名']), index + 1),
      date: String(read(row, ['Date', '日期']) || '').trim(),
      code,
      name,
      volume: parseNumber(read(row, ['TradeVolume', '成交股數'])),
      transaction: parseNumber(read(row, ['Transaction', '成交筆數'])),
      open: parseNumber(read(row, ['OpeningPrice', '開盤價'])),
      high: parseNumber(read(row, ['HighestPrice', '最高價'])),
      low: parseNumber(read(row, ['LowestPrice', '最低價'])),
      close: parseNumber(read(row, ['ClosingPrice', '收盤價'])),
      change: signedChangeByDirection(read(row, ['Change', '漲跌價差']), dir),
      bid: parseNumber(read(row, ['LastBestBidPrice', '最後揭示買價'])),
      ask: parseNumber(read(row, ['LastBestAskPrice', '最後揭示賣價']))
    };
  }).filter(row => row.code && row.name)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 20);
}

function parseQuote(data, code) {
  const item = data?.msgArray?.[0];
  if (!item?.c || !item?.n) {
    throw new Error(`找不到股票：${code}`);
  }

  const prev = parseNumber(item.y);
  const price = resolveMisPrice(item, prev);
  const change = Number((price - prev).toFixed(2));
  const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
  const bidVol = String(item.g || '').split('_').filter(Boolean).map(Number);
  const askVol = String(item.f || '').split('_').filter(Boolean).map(Number);
  const bidTotal = bidVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
  const askTotal = askVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
  const buyPct = bidTotal + askTotal > 0 ? Math.round((bidTotal / (bidTotal + askTotal)) * 100) : 50;
  const volume = parseNumber(item.v) * 1000;

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
    transaction: parseNumber(item.mt || item.m || item.tn),
    bid: parseFirstBookPrice(item.b),
    ask: parseFirstBookPrice(item.a),
    amountHundredMillion: Number(((price * volume) / 100000000).toFixed(2)),
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
    const price = resolveMisPrice(item, prev);
    const change = Number((price - prev).toFixed(2));
    const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
    const bidVol = String(item.g || '').split('_').filter(Boolean).map(Number);
    const askVol = String(item.f || '').split('_').filter(Boolean).map(Number);
    const bidTotal = bidVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
    const askTotal = askVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
    const buyPct = bidTotal + askTotal > 0 ? Math.round((bidTotal / (bidTotal + askTotal)) * 100) : 50;
    const volume = parseNumber(item.v) * 1000;

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
      transaction: parseNumber(item.mt || item.m || item.tn),
      bid: parseFirstBookPrice(item.b),
      ask: parseFirstBookPrice(item.a),
      amountHundredMillion: Number(((price * volume) / 100000000).toFixed(2)),
      buyPct,
      sellPct: 100 - buyPct,
      volRatio: Math.min(100, Math.round((parseNumber(item.tv) / Math.max(parseNumber(item.v, 1), 1)) * 100)),
      time: item.t || '',
      date: item.d || ''
    };
  }).filter(Boolean);
}

function resolveMisPrice(item, fallback = 0) {
  const tradedPrice = parseNumber(firstMeaningful(item?.z), NaN);
  if (Number.isFinite(tradedPrice) && tradedPrice > 0) return tradedPrice;

  const previousTradePrice = parseNumber(firstMeaningful(item?.pz), NaN);
  if (Number.isFinite(previousTradePrice) && previousTradePrice > 0) return previousTradePrice;

  const bestBid = parseFirstBookPrice(item?.b);
  const bestAsk = parseFirstBookPrice(item?.a);
  if (bestBid > 0 && bestAsk > 0) return Number(((bestBid + bestAsk) / 2).toFixed(2));
  if (bestBid > 0) return bestBid;
  if (bestAsk > 0) return bestAsk;

  return fallback;
}

function parseFirstBookPrice(value) {
  return parseNumber(String(value || '').split('_').find(Boolean), 0);
}

function firstMeaningful(value) {
  const text = String(value ?? '').trim();
  return text && text !== '-' ? text : '';
}

async function fetchYahooRealtimeQuotes(codes) {
  const results = await mapLimit(codes, 6, async code => {
    try {
      return await fetchYahooRealtimeQuote(code, 'TW');
    } catch (error) {
      try {
        return await fetchYahooRealtimeQuote(code, 'TWO');
      } catch (fallbackError) {
        return null;
      }
    }
  });

  return results.filter(Boolean);
}

async function fetchYahooRealtimeQuote(code, market = 'TW') {
  const data = await apiFetch(`/yahoo/v8/finance/chart/${encodeURIComponent(`${code}.${market}`)}?range=1d&interval=1m&includePrePost=false&_=${Date.now()}`);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const symbol = String(meta.symbol || `${code}.${market}`);
  const parsedCode = symbol.match(/^(\d{4,6})\./)?.[1] || String(code);
  const price = parseNumber(meta.regularMarketPrice);
  const prev = parseNumber(meta.chartPreviousClose ?? meta.previousClose);

  if (!price || !prev) throw new Error(`無法取得 Yahoo 即時報價：${code}`);

  const change = Number((price - prev).toFixed(2));
  const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
  const volume = parseNumber(meta.regularMarketVolume);

  return {
    code: parsedCode,
    name: '',
    exchange: market === 'TWO' ? 'otc' : 'tse',
    price,
    prev,
    change,
    chgPct,
    open: firstFiniteNumber(quote.open, price),
    high: parseNumber(meta.regularMarketDayHigh, price),
    low: parseNumber(meta.regularMarketDayLow, price),
    volume,
    transaction: 0,
    bid: price,
    ask: price,
    amountHundredMillion: Number(((price * volume) / 100000000).toFixed(2)),
    buyPct: 50,
    sellPct: 50,
    volRatio: 50,
    time: meta.regularMarketTime ? formatUnixTime(meta.regularMarketTime) : '',
    date: meta.regularMarketTime ? formatUnixDate(meta.regularMarketTime) : '',
    source: 'yahoo'
  };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapLimit(items, limit, mapper) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

function firstFiniteNumber(values, fallback = 0) {
  if (!Array.isArray(values)) return fallback;
  const value = values.find(item => Number.isFinite(Number(item)));
  return value === undefined ? fallback : Number(value);
}

function formatUnixTime(seconds) {
  return new Date(Number(seconds) * 1000).toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei'
  });
}

function formatUnixDate(seconds) {
  const date = new Date(Number(seconds) * 1000);
  const formatter = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Taipei'
  });
  return formatter.format(date).replace(/\//g, '');
}

function todayTaiwanDate() {
  const formatter = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Taipei'
  });
  return formatter.format(new Date()).replace(/\//g, '');
}

function isNegativeMarketMove(value) {
  return /-|－|−|▼|跌|down/i.test(String(value ?? ''));
}

function signedChangeByDirection(value, direction) {
  const number = Math.abs(parseNumber(value));
  const text = String(direction ?? '');
  if (/X|不比價/i.test(text)) return 0;
  if (isNegativeMarketMove(text)) return Number((-number).toFixed(2));
  if (/\+|▲|漲|red|up/i.test(text)) return Number(number.toFixed(2));
  return parseNumber(value);
}

function toHundredMillion(value) {
  return Number((parseNumber(value) / 100000000).toFixed(2));
}
