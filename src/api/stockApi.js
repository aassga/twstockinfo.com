import { apiFetch, apiTextFetch } from './http';

const STOCK_PROFILE_FALLBACKS = {
  3289: { name: '宜特', exchange: 'otc', sector: '其他電' }
};

export const stockApi = {
  market: () => fetchMarketRealtime().catch(() => apiFetch('/twse/exchangeReport/MI_INDEX').then(parseMarket)),
  allStocks: () => fetchAllStocks(),
  topVolume: () => apiFetch('/rwd/zh/afterTrading/MI_INDEX20?response=json').then(parseTopVolume),
  quote: code => apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw&json=1&delay=0&_=${Date.now()}`).then(data => parseQuote(data, code)),
  quoteOtc: code => apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=otc_${code}.tw&json=1&delay=0&_=${Date.now()}`).then(data => parseQuote(data, code)),
  quotes: (codes, exchange = 'tse') => fetchQuotes(codes, exchange),
  quoteAuto,
  institutional: () => fetchLatestTwseRwd('/rwd/zh/fund/T86', '&selectType=ALLBUT0999').then(parseInstitutional),
  institutionalByCode: code => fetchInstitutionalByCode(code),
  instSummary: () => fetchLatestTwseRwd('/rwd/zh/fund/BFI82U').then(parseInstitutionalSummary),
  chart: (code, interval = 'D', exchange = '') => fetchYahooChart(code, interval, exchange)
};

async function fetchAllStocks() {
  const [listed, otc] = await Promise.all([
    apiFetch('/twse/exchangeReport/STOCK_DAY_ALL').then(parseAllStocks),
    apiFetch('/tpex/openapi/v1/tpex_mainboard_daily_close_quotes').then(parseOtcStocks).catch(() => [])
  ]);

  return [...listed, ...otc]
    .sort((a, b) => b.volume - a.volume);
}

async function quoteAuto(code, { withVolumeRatio = false } = {}) {
  let quote = null;

  try {
    quote = await stockApi.quote(code);
    return withVolumeRatio ? enrichWithVolumeRatio(quote) : quote;
  } catch (error) {
    // Listed stocks are tried first, then OTC.
  }

  try {
    quote = await stockApi.quoteOtc(code);
    return withVolumeRatio ? enrichWithVolumeRatio(quote) : quote;
  } catch (error) {
    // Fall back to Yahoo chart metadata when TWSE MIS is temporarily blocked.
  }

  try {
    quote = await fetchYahooRealtimeQuote(code, 'TW');
    quote = await attachStockProfile(quote);
    return withVolumeRatio ? enrichWithVolumeRatio(quote) : quote;
  } catch (error) {
    quote = await fetchYahooRealtimeQuote(code, 'TWO');
    quote = await attachStockProfile(quote);
    return withVolumeRatio ? enrichWithVolumeRatio(quote) : quote;
  }
}

async function attachStockProfile(quote) {
  if (!quote || quote.name) return quote;

  const fallback = STOCK_PROFILE_FALLBACKS[String(quote.code)] || {};
  try {
    const profile = await fetchSinotradeProfile(quote.code);
    return {
      ...quote,
      ...profile,
      name: profile.name || fallback.name || quote.name,
      exchange: profile.exchange || fallback.exchange || quote.exchange,
      sector: profile.sector || fallback.sector || quote.sector
    };
  } catch (error) {
    return {
      ...quote,
      ...fallback,
      name: fallback.name || quote.name
    };
  }
}

async function fetchSinotradeProfile(code) {
  const normalizedCode = String(code || '').trim();
  if (!/^\d{4,6}$/.test(normalizedCode)) throw new Error('股票代號格式不正確');

  const html = await apiTextFetch(`/sinotrade/richclub/stock/${encodeURIComponent(normalizedCode)}?_=${Date.now()}`);
  return parseSinotradeProfileHtml(html, normalizedCode);
}

function parseSinotradeProfileHtml(html, code) {
  const match = String(html || '').match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('無法解析永豐個股資料');

  const data = JSON.parse(decodeHtmlEntities(match[1]));
  const result = data?.props?.pageProps?.result || {};
  const stock = result.stock?.[0] || result.data?.[0] || result.souvenirData || {};
  const name = String(stock.Name || stock.name || '').trim();
  if (!name) throw new Error(`找不到股票名稱：${code}`);

  return {
    code,
    name,
    exchange: String(stock.Exchange || '').toLowerCase() === 'otc' ? 'otc' : '',
    sector: String(stock.industry || stock.industryName || '').trim()
  };
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
      return [];
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
      exchange: 'tse',
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

  return result.sort((a, b) => b.volume - a.volume);
}

function parseOtcStocks(data) {
  const rows = Array.isArray(data) ? data : [];
  const result = [];

  for (const row of rows) {
    const code = String(read(row, ['SecuritiesCompanyCode', '證券代號']) || '').trim();
    const name = String(read(row, ['CompanyName', '證券名稱']) || '').trim();
    const price = parseNumber(read(row, ['Close', '收盤']));
    const change = parseNumber(read(row, ['Change', '漲跌']));
    const volume = parseNumber(read(row, ['TradingShares', '成交股數']));
    const value = parseNumber(read(row, ['TransactionAmount', '成交金額']));
    const transaction = parseNumber(read(row, ['TransactionNumber', '成交筆數']));
    const high = parseNumber(read(row, ['High', '最高']), price);
    const low = parseNumber(read(row, ['Low', '最低']), price);
    const open = parseNumber(read(row, ['Open', '開盤']), price);
    const bid = parseNumber(read(row, ['LatestBidPrice', '最後買價']), price);
    const ask = parseNumber(read(row, ['LatesAskPrice', 'LatestAskPrice', '最後賣價']), price);

    if (!/^\d{4,6}[A-Z]?$/.test(code) || !name || price <= 0) continue;

    const prev = price - change;
    const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
    result.push({
      code,
      name,
      exchange: 'otc',
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

  return result;
}

function parseTopVolume(data) {
  const rows = Array.isArray(data?.data)
    ? data.data.map(row => ({
      Rank: row[0],
      Code: row[1],
      Name: row[2],
      TradeVolume: row[3],
      Transaction: row[4],
      OpeningPrice: row[5],
      HighestPrice: row[6],
      LowestPrice: row[7],
      ClosingPrice: row[8],
      Dir: row[9],
      Change: row[10],
      LastBestBidPrice: row[11],
      LastBestAskPrice: row[12],
      Date: data.date
    }))
    : normalizeTwseRows(data);

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

async function enrichWithVolumeRatio(quote) {
  try {
    const market = String(quote.exchange || '').toLowerCase() === 'otc' ? 'TWO' : 'TW';
    const avgVolume = await fetchAverageDailyVolume(quote.code, market, quote.date);
    if (avgVolume > 0) {
      return {
        ...quote,
        volRatio: Number(((Number(quote.volume || 0) / avgVolume) * 100).toFixed(1)),
        avgVolume20: Math.round(avgVolume)
      };
    }
  } catch (error) {
    // Keep the realtime quote if historical volume is temporarily unavailable.
  }
  return quote;
}

async function fetchAverageDailyVolume(code, market = 'TW', currentDate = '') {
  const data = await apiFetch(`/yahoo/v8/finance/chart/${encodeURIComponent(`${code}.${market}`)}?range=1mo&interval=1d&includePrePost=false&_=${Date.now()}`);
  const result = data?.chart?.result?.[0];
  const volumes = result?.indicators?.quote?.[0]?.volume || [];
  const timestamps = result?.timestamp || [];
  const normalizedCurrentDate = normalizeCompactDate(currentDate);

  const rows = timestamps.map((timestamp, index) => ({
    date: formatUnixDate(timestamp),
    volume: Number(volumes[index] || 0)
  })).filter(row =>
    row.volume > 0 &&
    (!normalizedCurrentDate || row.date !== normalizedCurrentDate)
  );

  const sample = rows.slice(-20);
  if (!sample.length) return 0;
  return sample.reduce((sum, row) => sum + row.volume, 0) / sample.length;
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
    const foreign = toLots(read(row, ['外陸資買賣超股數(不含外資自營商)', '外資買賣超股數']));
    const trust = toLots(read(row, ['投信買賣超股數']));
    const dealer = toLots(read(row, ['自營商買賣超股數', '自營商買賣超股數(自行買賣)']));
    return {
      code: String(read(row, ['證券代號']) || ''),
      name: String(read(row, ['證券名稱']) || '').trim(),
      foreign,
      trust,
      dealer,
      total: foreign + trust + dealer,
      unit: '張',
      source: 'twse'
    };
  }).filter(row => row.code && row.name)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

async function fetchInstitutionalByCode(code) {
  const normalizedCode = String(code || '').trim();
  if (!/^\d{4,6}$/.test(normalizedCode)) throw new Error('股票代號格式不正確');

  const html = await apiTextFetch(`/histock/stock/chips.aspx?no=${encodeURIComponent(normalizedCode)}&_=${Date.now()}`);
  return parseInstitutionalTrendHtml(html, normalizedCode);
}

function parseInstitutionalTrendHtml(html, code) {
  const text = String(html || '');
  const rowMatch = text.match(/<tr[^>]*>\s*<td[^>]*>\s*(20\d{2}\/\d{2}\/\d{2})\s*<\/td>([\s\S]*?)<\/tr>/i);
  if (!rowMatch) throw new Error('無法解析法人買賣超資料');

  const cells = [...rowMatch[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(match => stripHtml(match[1]))
    .map(value => parseNumber(value));

  if (cells.length < 5) throw new Error('法人買賣超欄位不足');

  const [foreign, trust, dealerSelf, dealerHedge, reportedTotal] = cells;
  const dealer = dealerSelf + dealerHedge;
  const total = Number.isFinite(reportedTotal) ? reportedTotal : foreign + trust + dealer;

  return {
    code,
    name: '',
    date: rowMatch[1],
    foreign,
    trust,
    dealer,
    total,
    unit: '張',
    source: 'histock'
  };
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

function normalizeCompactDate(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(0, 8);
  return '';
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

function toLots(value) {
  return Math.round(parseNumber(value) / 1000);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
