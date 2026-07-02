import { apiFetch, apiTextFetch } from './http';
import otcStockNames from '../data/otcStockNames.json';

export const stockApi = {
  market: () => fetchMarketRealtime().catch(() => apiFetch('/twse/exchangeReport/MI_INDEX').then(parseMarket)),
  allStocks: () => fetchPriceRows(),
  stockList: () => fetchStockListRows(),
  priceRows: codes => fetchPriceRows(codes),
  topVolume: () => apiFetch('/rwd/zh/afterTrading/MI_INDEX20?response=json').then(parseTopVolume),
  histockRank: codes => fetchHistockRank(codes),
  quoteAuto,
  institutional: () => fetchLatestTwseRwd('/rwd/zh/fund/T86', '&selectType=ALLBUT0999').then(parseInstitutional),
  institutionalByCode: code => fetchInstitutionalByCode(code),
  instSummary: () => fetchLatestTwseRwd('/rwd/zh/fund/BFI82U').then(parseInstitutionalSummary),
  chart: (code, interval = 'D', exchange = '') => fetchYahooChart(code, interval, exchange)
};

const PRICE_ROWS_CACHE_MS = 15000;
const HISTOCK_RANK_CACHE_MS = 15000;
const MIS_QUOTE_CACHE_MS = 15000;
const MIS_OUTAGE_COOLDOWN_MS = 180000;
const MIS_OUTAGE_STORAGE_KEY = 'tw_stock_mis_outage_until';
const MIS_BATCH_CODE_LIMIT = 15;
const MIS_HOT_PRICE_LIMIT = 100;
const STOCK_CODE_PATTERN = /^\d{4,6}[A-Z]?$/;
const OTC_CODE_SET = new Set(
  otcStockNames
    .map(row => String(row.code || '').trim().toUpperCase())
    .filter(Boolean)
);
const FALLBACK_HOT_CODES = [
  '2330', '2406', '00830', '3105', '2409', '3481', '6770', '2303', '6116', '009816',
  '2344', '0050', '00919', '2408', '5274', '2883', '2887', '2337', '2454', '2317',
  '2382', '2308', '6669', '2345', '3034', '3231', '2357', '2379', '3711', '2603',
  '2618', '2609', '2615', '2610', '2002', '1301', '1303', '2881', '2882', '2891'
];
let histockRankCache = {
  at: 0,
  promise: null,
  rows: []
};
let allPriceRowsCache = {
  at: 0,
  promise: null,
  rows: []
};
let stockDayAllCache = {
  at: 0,
  promise: null,
  rows: []
};
let otcDailyCloseCache = {
  at: 0,
  promise: null,
  rows: []
};
const misQuoteCache = new Map();
let misOutageUntil = readMisOutageUntil();
let proxyStatusCache = {
  at: 0,
  promise: null,
  features: null
};

async function fetchPriceRows(codes = []) {
  const wantedCodes = normalizeCodeSet(codes);
  const now = Date.now();

  if (!wantedCodes.size) {
    if (allPriceRowsCache.promise && now - allPriceRowsCache.at < PRICE_ROWS_CACHE_MS) {
      return allPriceRowsCache.promise;
    }
    if (allPriceRowsCache.rows.length && now - allPriceRowsCache.at < PRICE_ROWS_CACHE_MS) {
      return allPriceRowsCache.rows;
    }

    allPriceRowsCache.at = now;
    allPriceRowsCache.promise = fetchFreshPriceRows([])
      .then(rows => {
        allPriceRowsCache.rows = rows;
        return rows;
      })
      .finally(() => {
        allPriceRowsCache.promise = null;
      });

    return allPriceRowsCache.promise;
  }

  return fetchFreshPriceRows([...wantedCodes]);
}

async function fetchFreshPriceRows(codes = []) {
  const wantedCodes = normalizeCodeSet(codes);
  const rankRows = await fetchHistockRank().catch(() => []);
  const targetCodes = wantedCodes.size
    ? [...wantedCodes]
    : (rankRows.length ? rankRows.slice(0, MIS_HOT_PRICE_LIMIT).map(row => row.code) : FALLBACK_HOT_CODES);
  const quoteRows = await fetchMisQuotes(targetCodes).catch(() => []);
  const fallbackRows = await fetchFallbackStockRows(targetCodes, quoteRows).catch(() => []);
  const mergedQuoteRows = mergeFallbackRows(quoteRows, fallbackRows);

  if (wantedCodes.size) {
    return mergeQuoteRows(rankRows.filter(row => wantedCodes.has(row.code)), mergedQuoteRows, targetCodes);
  }

  return mergeQuoteRows(rankRows, mergedQuoteRows, targetCodes);
}

async function fetchHistockRank(codes = []) {
  const rows = await getHistockRankRows();
  const wantedCodes = normalizeCodeSet(codes);
  return wantedCodes.size ? rows.filter(row => wantedCodes.has(row.code)) : rows;
}

function normalizeCodeSet(codes = []) {
  const wantedCodes = new Set(
    codes
      .map(code => String(code || '').trim().toUpperCase())
      .filter(Boolean)
  );
  return wantedCodes;
}

async function getHistockRankRows() {
  const now = Date.now();
  const supportsHistock = await proxySupports('histock');
  if (!supportsHistock) throw new Error('Worker 尚未部署 /histock/*');

  if (histockRankCache.promise && now - histockRankCache.at < HISTOCK_RANK_CACHE_MS) {
    return histockRankCache.promise;
  }
  if (histockRankCache.rows.length && now - histockRankCache.at < HISTOCK_RANK_CACHE_MS) {
    return histockRankCache.rows;
  }

  histockRankCache.at = now;
  histockRankCache.promise = apiTextFetch(`/histock/stock/rank.aspx?p=all&_=${now}`)
    .then(html => {
      const rows = parseHistockRankHtml(html);
      if (!rows.length) throw new Error('HiStock rank 無資料');
      histockRankCache.rows = rows;
      return rows;
    })
    .finally(() => {
      histockRankCache.promise = null;
    });

  return histockRankCache.promise;
}

async function proxySupports(feature) {
  const now = Date.now();
  if (proxyStatusCache.features && now - proxyStatusCache.at < 60000) {
    return proxyStatusCache.features[feature] === true;
  }
  if (!proxyStatusCache.promise) {
    proxyStatusCache.promise = apiFetch('/proxy-status')
      .then(data => {
        proxyStatusCache.at = Date.now();
        proxyStatusCache.features = data?.features || {};
        return proxyStatusCache.features;
      })
      .catch(() => ({}))
      .finally(() => {
        proxyStatusCache.promise = null;
      });
  }

  const features = await proxyStatusCache.promise;
  return features[feature] === true;
}

async function quoteAuto(code, { withVolumeRatio = false } = {}) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const quote = (await fetchPriceRows([normalizedCode]))[0];
  if (!quote) throw new Error(`無法從 TWSE MIS 即時報價取得：${normalizedCode}`);
  return withVolumeRatio ? enrichWithVolumeRatio(quote) : quote;
}

async function fetchMisQuotes(codes = []) {
  const uniqueCodes = [...normalizeCodeSet(codes)].filter(code => STOCK_CODE_PATTERN.test(code));
  if (!uniqueCodes.length) return [];

  const now = Date.now();
  const cachedRows = [];
  const missingCodes = [];

  uniqueCodes.forEach(code => {
    const cached = misQuoteCache.get(code);
    if (cached?.row && now - cached.at < MIS_QUOTE_CACHE_MS) {
      cachedRows.push(cached.row);
    } else {
      missingCodes.push(code);
    }
  });

  if (isMisInOutage()) {
    return cachedRows;
  }

  const chunks = chunkArray(missingCodes, MIS_BATCH_CODE_LIMIT);
  const responses = [];
  for (const chunk of chunks) {
    const response = await fetchMisQuoteChunkSafely(chunk);
    if (response) responses.push(response);
    if (isMisInOutage()) break;
    await sleep(120);
  }
  const rowsByCode = new Map();

  cachedRows.forEach(row => {
    rowsByCode.set(row.code, row);
  });

  responses
    .filter(Boolean)
    .flatMap(parseMisQuotes)
    .forEach(row => {
      misQuoteCache.set(row.code, { at: Date.now(), row });
      if (!rowsByCode.has(row.code)) rowsByCode.set(row.code, row);
    });

  return [...rowsByCode.values()];
}

async function fetchMisQuoteChunkSafely(codes) {
  if (!codes.length) return null;

  try {
    return await fetchMisQuoteChunk(codes);
  } catch (error) {
    if (isUpstreamServerError(error)) {
      markMisOutage();
    }

    return null;
  }
}

function fetchMisQuoteChunk(codes) {
  const exCh = codes
    .map(code => `${getMisExchangePrefix(code)}_${code}.tw`)
    .join('|');
  return apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`);
}

function getMisExchangePrefix(code) {
  return OTC_CODE_SET.has(String(code || '').trim().toUpperCase()) ? 'otc' : 'tse';
}

function parseMisQuotes(data) {
  return (data?.msgArray || [])
    .map(parseMisQuoteItem)
    .filter(Boolean);
}

async function fetchFallbackStockRows(targetCodes = [], quoteRows = []) {
  const quoteCodes = new Set(quoteRows.map(row => row.code));
  const missingCodes = [...normalizeCodeSet(targetCodes)].filter(code => !quoteCodes.has(code));
  if (!missingCodes.length && quoteRows.length) return [];

  const yahooRows = missingCodes.length <= 10
    ? await fetchYahooFallbackQuotes(missingCodes).catch(() => [])
    : [];
  const yahooCodes = new Set(yahooRows.map(row => row.code));
  const remainingCodes = missingCodes.filter(code => !yahooCodes.has(code));
  const rows = await fetchStockListRows();
  const wantedCodes = normalizeCodeSet(remainingCodes.length ? remainingCodes : targetCodes);
  const stockDayRows = rows
    .filter(row => !wantedCodes.size || wantedCodes.has(row.code))
    .map(row => ({
      ...row,
      source: `${row.exchange || 'twse'}-openapi-fallback`
    }));
  return mergeFallbackRows(yahooRows, stockDayRows);
}

async function fetchYahooFallbackQuotes(codes = []) {
  const rows = [];
  for (const code of codes) {
    const row = await fetchYahooFallbackQuote(code).catch(() => null);
    if (row) rows.push(row);
    await sleep(80);
  }
  return rows;
}

async function fetchYahooFallbackQuote(code) {
  try {
    return await fetchYahooFallbackQuoteBySymbol(code, 'TW');
  } catch (error) {
    return fetchYahooFallbackQuoteBySymbol(code, 'TWO');
  }
}

async function fetchYahooFallbackQuoteBySymbol(code, market) {
  const data = await apiFetch(`/yahoo/v8/finance/chart/${encodeURIComponent(`${code}.${market}`)}?range=1d&interval=1m&includePrePost=false&_=${Date.now()}`);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const price = parseNumber(meta.regularMarketPrice);
  const prev = parseNumber(meta.chartPreviousClose ?? meta.previousClose);
  if (price <= 0 || prev <= 0) throw new Error('Yahoo quote unavailable');

  const change = Number((price - prev).toFixed(2));
  const chgPct = Number(((change / prev) * 100).toFixed(2));
  const volumeSeries = result?.indicators?.quote?.[0]?.volume || [];
  const volume = Number(volumeSeries[volumeSeries.length - 1] || meta.regularMarketVolume || 0);

  return {
    code,
    name: meta.shortName || meta.longName || '',
    exchange: market === 'TWO' ? 'otc' : 'tse',
    price,
    prev,
    change,
    chgPct,
    open: parseNumber(meta.regularMarketDayOpen, price),
    high: parseNumber(meta.regularMarketDayHigh, price),
    low: parseNumber(meta.regularMarketDayLow, price),
    volume,
    transaction: 0,
    bid: price,
    ask: price,
    amountHundredMillion: Number(((price * volume) / 100000000).toFixed(2)),
    buyPct: chgPct >= 0 ? 60 : 40,
    sellPct: chgPct >= 0 ? 40 : 60,
    volRatio: 50,
    source: 'yahoo-fallback'
  };
}

async function fetchStockDayAllRows() {
  const now = Date.now();
  if (stockDayAllCache.promise && now - stockDayAllCache.at < 60000) {
    return stockDayAllCache.promise;
  }
  if (stockDayAllCache.rows.length && now - stockDayAllCache.at < 60000) {
    return stockDayAllCache.rows;
  }

  stockDayAllCache.at = now;
  stockDayAllCache.promise = apiFetch('/twse/exchangeReport/STOCK_DAY_ALL')
    .then(parseAllStocks)
    .then(rows => {
      stockDayAllCache.rows = rows;
      return rows;
    })
    .finally(() => {
      stockDayAllCache.promise = null;
    });

  return stockDayAllCache.promise;
}

async function fetchStockListRows() {
  const [twseRows, otcRows] = await Promise.all([
    fetchStockDayAllRows().catch(() => []),
    fetchOtcDailyCloseRows().catch(() => [])
  ]);
  const rowsByCode = new Map();

  [...getLocalOtcNameRows(), ...twseRows, ...otcRows].forEach(row => {
    if (!row?.code) return;
    const current = rowsByCode.get(row.code);
    rowsByCode.set(row.code, {
      ...current,
      ...row,
      name: row.name || current?.name || ''
    });
  });

  return [...rowsByCode.values()]
    .sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0));
}

async function fetchOtcDailyCloseRows() {
  const now = Date.now();
  if (otcDailyCloseCache.promise && now - otcDailyCloseCache.at < 60000) {
    return otcDailyCloseCache.promise;
  }
  if (otcDailyCloseCache.rows.length && now - otcDailyCloseCache.at < 60000) {
    return otcDailyCloseCache.rows;
  }

  otcDailyCloseCache.at = now;
  otcDailyCloseCache.promise = fetchOtcDailyCloseData()
    .then(parseOtcStocks)
    .then(rows => {
      otcDailyCloseCache.rows = rows;
      return rows;
    })
    .finally(() => {
      otcDailyCloseCache.promise = null;
    });

  return otcDailyCloseCache.promise;
}

async function fetchOtcDailyCloseData() {
  const supportsTpex = await proxySupports('tpex');
  if (!supportsTpex) throw new Error('Worker does not support /tpex/*');
  return apiFetch('/tpex/openapi/v1/tpex_mainboard_daily_close_quotes');
}

function getLocalOtcNameRows() {
  return otcStockNames.map(row => ({
    code: String(row.code || '').trim().toUpperCase(),
    name: String(row.name || '').trim(),
    exchange: row.exchange || 'otc',
    source: 'local-tpex-name-index'
  })).filter(row => STOCK_CODE_PATTERN.test(row.code) && row.name);
}

function mergeFallbackRows(quoteRows, fallbackRows) {
  const rowsByCode = new Map(fallbackRows.map(row => [row.code, row]));
  quoteRows.forEach(row => {
    const base = rowsByCode.get(row.code);
    rowsByCode.set(row.code, {
      ...base,
      ...row,
      name: base?.name || row.name || ''
    });
  });
  return [...rowsByCode.values()];
}

function parseMisQuoteItem(item) {
  if (!item?.c || !item?.n || !item?.ex) return null;

  const prev = parseNumber(item.y);
  const price = resolveMisPrice(item, prev);
  if (price <= 0) return null;

  const change = Number((price - prev).toFixed(2));
  const chgPct = prev ? Number(((change / prev) * 100).toFixed(2)) : 0;
  const bidVol = String(item.g || '').split('_').filter(Boolean).map(Number);
  const askVol = String(item.f || '').split('_').filter(Boolean).map(Number);
  const bidTotal = bidVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
  const askTotal = askVol.slice(0, 5).reduce((sum, value) => sum + value, 0);
  const buyPct = bidTotal + askTotal > 0 ? Math.round((bidTotal / (bidTotal + askTotal)) * 100) : 50;
  const volume = Math.round(parseNumber(item.v) * 1000);

  return {
    code: String(item.c),
    name: String(item.n || ''),
    exchange: String(item.ex || ''),
    price,
    prev,
    change,
    chgPct,
    open: parseNumber(item.o, price),
    high: parseNumber(item.h, price),
    low: parseNumber(item.l, price),
    volume,
    transaction: parseNumber(item.ps || item.s),
    bid: parseFirstBookPrice(item.b),
    ask: parseFirstBookPrice(item.a),
    amountHundredMillion: Number(((price * volume) / 100000000).toFixed(2)),
    buyPct,
    sellPct: 100 - buyPct,
    volRatio: 50,
    time: item.t || item.ot || '',
    date: item.d || '',
    source: 'twse-mis'
  };
}

function mergeQuoteRows(baseRows, quoteRows, requestedCodes = []) {
  const baseByCode = new Map(baseRows.map(row => [row.code, row]));
  quoteRows.forEach(row => {
    const base = baseByCode.get(row.code);
    baseByCode.set(row.code, {
      ...base,
      ...row,
      name: row.name || base?.name || ''
    });
  });

  requestedCodes.forEach(code => {
    if (!baseByCode.has(code)) return;
    const row = baseByCode.get(code);
    baseByCode.set(code, {
      ...row,
      source: row.source || 'histock-rank'
    });
  });

  return [...baseByCode.values()]
    .sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0));
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

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function isUpstreamServerError(error) {
  return /HTTP 5\d\d/.test(String(error?.message || error || ''));
}

function isMisInOutage() {
  return Date.now() < misOutageUntil;
}

function markMisOutage() {
  misOutageUntil = Date.now() + MIS_OUTAGE_COOLDOWN_MS;
  writeMisOutageUntil(misOutageUntil);
}

function readMisOutageUntil() {
  if (typeof sessionStorage === 'undefined') return 0;
  const value = Number(sessionStorage.getItem(MIS_OUTAGE_STORAGE_KEY) || 0);
  return Number.isFinite(value) ? value : 0;
}

function writeMisOutageUntil(value) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(MIS_OUTAGE_STORAGE_KEY, String(value));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

    if (!STOCK_CODE_PATTERN.test(code) || price <= 0) continue;

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

    if (!STOCK_CODE_PATTERN.test(code) || !name || price <= 0) continue;

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

function parseHistockRankHtml(html) {
  const tableMatch = String(html || '').match(/<table[^>]+id="CPHB1_gv"[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];

  return [...tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => parseHistockRankRow(match[1]))
    .filter(Boolean);
}

function parseHistockRankRow(html) {
  const cells = [...String(html || '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(match => stripHtml(match[1]));

  if (cells.length < 13) return null;

  const code = cells[0].trim();
  const name = cells[1].trim();
  const price = parseNumber(cells[2]);
  const change = signedChangeByDirection(cells[3], cells[3]);
  const chgPct = signedChangeByDirection(cells[4], cells[4]);
  const prev = parseNumber(cells[10]);
  const volumeLots = parseNumber(cells[11]);

  if (!/^\d{4,6}[A-Z]?$/.test(code) || !name || price <= 0) return null;

  return {
    code,
    name,
    price,
    prev,
    change,
    chgPct,
    open: parseNumber(cells[7], price),
    high: parseNumber(cells[8], price),
    low: parseNumber(cells[9], price),
    volume: Math.round(volumeLots * 1000),
    amountHundredMillion: parseNumber(cells[12]),
    buyPct: chgPct > 0 ? Math.min(80, 50 + Math.abs(chgPct) * 3) : Math.max(20, 50 - Math.abs(chgPct) * 3),
    sellPct: chgPct > 0 ? Math.max(20, 50 - Math.abs(chgPct) * 3) : Math.min(80, 50 + Math.abs(chgPct) * 3),
    volRatio: 50,
    source: 'histock-rank'
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
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!STOCK_CODE_PATTERN.test(normalizedCode)) throw new Error('股票代號格式不正確');

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

