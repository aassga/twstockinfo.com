import { apiFetch } from './http';
import { stockApi } from './stockApi';

const CACHE_MS = 10 * 60 * 1000;
const SNAPSHOT_CACHE_MS = 5 * 60 * 1000;
const CASHFLOW_SOURCE_NOTE = '資料來源：FinMind TaiwanStockCashFlowsStatement';
const MACRO_SOURCE_NOTE = '資料來源：FinMind TaiwanExchangeRate + TWSE 即時市場資料';
const INCOME_ENDPOINTS = [
  '/twse/opendata/t187ap06_L_basi',
  '/twse/opendata/t187ap06_L_bd',
  '/twse/opendata/t187ap06_L_ci',
  '/twse/opendata/t187ap06_L_fh',
  '/twse/opendata/t187ap06_L_ins',
  '/twse/opendata/t187ap06_L_mim'
];
const BALANCE_ENDPOINTS = [
  '/twse/opendata/t187ap07_L_basi',
  '/twse/opendata/t187ap07_L_bd',
  '/twse/opendata/t187ap07_L_ci',
  '/twse/opendata/t187ap07_L_fh',
  '/twse/opendata/t187ap07_L_ins',
  '/twse/opendata/t187ap07_L_mim'
];
const TPEX_INCOME_ENDPOINTS = [
  '/tpex/openapi/v1/mopsfin_t187ap06_O_basi',
  '/tpex/openapi/v1/mopsfin_t187ap06_O_bd',
  '/tpex/openapi/v1/mopsfin_t187ap06_O_ci',
  '/tpex/openapi/v1/mopsfin_t187ap06_O_fh',
  '/tpex/openapi/v1/mopsfin_t187ap06_O_ins',
  '/tpex/openapi/v1/mopsfin_t187ap06_O_mim'
];
const TPEX_BALANCE_ENDPOINTS = [
  '/tpex/openapi/v1/mopsfin_t187ap07_O_basi',
  '/tpex/openapi/v1/mopsfin_t187ap07_O_bd',
  '/tpex/openapi/v1/mopsfin_t187ap07_O_ci',
  '/tpex/openapi/v1/mopsfin_t187ap07_O_fh',
  '/tpex/openapi/v1/mopsfin_t187ap07_O_ins',
  '/tpex/openapi/v1/mopsfin_t187ap07_O_mim'
];

const cache = new Map();
const snapshotCache = new Map();
const snapshotRequests = new Map();

export async function fetchFundamentalSnapshot(stock) {
  const normalized = normalizeStock(stock);
  const snapshotKey = fundamentalSnapshotKey(normalized);
  const cached = getCachedSnapshot(snapshotKey);
  if (cached) return cached;
  if (snapshotRequests.has(snapshotKey)) return snapshotRequests.get(snapshotKey);

  const promise = fetchFundamentalSnapshotFresh(normalized)
    .then(snapshot => {
      setCachedSnapshot(snapshotKey, snapshot);
      return snapshot;
    })
    .finally(() => {
      snapshotRequests.delete(snapshotKey);
    });

  snapshotRequests.set(snapshotKey, promise);
  return promise;
}

async function fetchFundamentalSnapshotFresh(normalized) {
  const endpoints = fundamentalEndpointsFor(normalized);
  const [
    valuationRows,
    revenueRows,
    epsRows,
    companyRows,
    dividendRows,
    chairmanRows,
    directorRows
  ] = await Promise.all([
    fetchManyRows(endpoints.valuation),
    fetchManyRows(endpoints.revenue),
    fetchManyRows(endpoints.eps),
    fetchManyRows(endpoints.company),
    fetchManyRows(endpoints.dividend),
    fetchManyRows(endpoints.chairman),
    fetchManyRows(endpoints.director)
  ]);

  const code = normalized.code;
  const [incomeRows, balanceRows, cashFlowRows, revenueTrendRows, valuationHistoryRows, dividendHistoryRows, marginRows, lendingRows, macro] = await Promise.all([
    fetchFirstRowsContainingCode(endpoints.income, code),
    fetchFirstRowsContainingCode(endpoints.balance, code),
    fetchCashFlowRows(code),
    fetchRevenueTrendRows(code),
    fetchValuationHistoryRows(code),
    fetchDividendHistoryRows(code),
    fetchMarginRows(code),
    fetchLendingRows(code),
    fetchMacroSnapshot()
  ]);

  return composeFundamentalSnapshot(normalized, {
    valuationRows,
    revenueRows,
    epsRows,
    companyRows,
    dividendRows,
    chairmanRows,
    directorRows,
    incomeRows,
    balanceRows,
    cashFlowRows,
    revenueTrendRows,
    valuationHistoryRows,
    dividendHistoryRows,
    marginRows,
    lendingRows,
    macro,
    stage: 'complete'
  });
}

export async function fetchFundamentalSnapshotPhased(stock, onUpdate = () => {}) {
  const normalized = normalizeStock(stock);
  const snapshotKey = fundamentalSnapshotKey(normalized);
  const cached = getCachedSnapshot(snapshotKey);
  if (cached) {
    onUpdate(cached);
    return cached;
  }
  if (snapshotRequests.has(snapshotKey)) {
    const snapshot = await snapshotRequests.get(snapshotKey);
    onUpdate(snapshot);
    return snapshot;
  }

  const promise = fetchFundamentalSnapshotPhasedFresh(normalized, onUpdate)
    .then(snapshot => {
      setCachedSnapshot(snapshotKey, snapshot);
      return snapshot;
    })
    .finally(() => {
      snapshotRequests.delete(snapshotKey);
    });

  snapshotRequests.set(snapshotKey, promise);
  return promise;
}

export async function fetchIndustryPeerStocks(stock, allStocks = [], limit = 12) {
  const normalized = normalizeStock(stock);
  const twseEndpoints = fundamentalEndpointsFor({ ...normalized, exchange: 'twse' });
  const tpexEndpoints = fundamentalEndpointsFor({ ...normalized, exchange: 'tpex' });
  const [revenueRows, epsRows] = await Promise.all([
    fetchManyRows([...twseEndpoints.revenue, ...tpexEndpoints.revenue]),
    fetchManyRows([...twseEndpoints.eps, ...tpexEndpoints.eps])
  ]);
  const ownIndustryRow = findByCode([...revenueRows, ...epsRows], normalized.code);
  const sector = normalized.sector || read(ownIndustryRow, ['產業別']) || '';
  const sectorKey = normalizeIndustryKey(sector);
  if (!sectorKey) return [];

  const quoteByCode = new Map((allStocks || []).map(row => [String(row.code || '').trim(), row]));
  const rowsByCode = new Map();

  [...revenueRows, ...epsRows].forEach(row => {
    const code = codeOf(row);
    if (!code || code === normalized.code) return;
    const industry = read(row, ['產業別']);
    if (normalizeIndustryKey(industry) !== sectorKey) return;
    const quote = quoteByCode.get(code) || {};
    rowsByCode.set(code, {
      ...quote,
      code,
      name: quote.name || read(row, ['公司名稱', 'CompanyName']) || code,
      sector: industry || sector
    });
  });

  return [...rowsByCode.values()]
    .sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0))
    .slice(0, limit);
}

async function fetchFundamentalSnapshotPhasedFresh(normalized, onUpdate = () => {}) {
  const endpoints = fundamentalEndpointsFor(normalized);
  const rows = {};

  onUpdate(composeFundamentalSnapshot(normalized, {
    ...rows,
    stage: 'quote'
  }));

  const [valuationRows, revenueRows, epsRows, companyRows] = await Promise.all([
    fetchManyRows(endpoints.valuation),
    fetchManyRows(endpoints.revenue),
    fetchManyRows(endpoints.eps),
    fetchManyRows(endpoints.company)
  ]);
  Object.assign(rows, { valuationRows, revenueRows, epsRows, companyRows });
  onUpdate(composeFundamentalSnapshot(normalized, {
    ...rows,
    stage: 'overview'
  }));

  const code = normalized.code;
  const [incomeRows, balanceRows, cashFlowRows, revenueTrendRows, valuationHistoryRows, dividendHistoryRows, marginRows, lendingRows] = await Promise.all([
    fetchFirstRowsContainingCode(endpoints.income, code),
    fetchFirstRowsContainingCode(endpoints.balance, code),
    fetchCashFlowRows(code),
    fetchRevenueTrendRows(code),
    fetchValuationHistoryRows(code),
    fetchDividendHistoryRows(code),
    fetchMarginRows(code),
    fetchLendingRows(code)
  ]);
  Object.assign(rows, { incomeRows, balanceRows, cashFlowRows, revenueTrendRows, valuationHistoryRows, dividendHistoryRows, marginRows, lendingRows });
  onUpdate(composeFundamentalSnapshot(normalized, {
    ...rows,
    stage: 'statements'
  }));

  const [dividendRows, chairmanRows, directorRows, macro] = await Promise.all([
    fetchManyRows(endpoints.dividend),
    fetchManyRows(endpoints.chairman),
    fetchManyRows(endpoints.director),
    fetchMacroSnapshot()
  ]);
  Object.assign(rows, { dividendRows, chairmanRows, directorRows, macro });

  const finalSnapshot = composeFundamentalSnapshot(normalized, {
    ...rows,
    stage: 'complete'
  });
  onUpdate(finalSnapshot);
  return finalSnapshot;
}

function fundamentalSnapshotKey(stock) {
  return `${String(stock.code || '').trim().toUpperCase()}:${String(stock.exchange || stock.market || '').toLowerCase()}`;
}

function getCachedSnapshot(key) {
  const cached = snapshotCache.get(key);
  if (cached?.snapshot && Date.now() - cached.at < SNAPSHOT_CACHE_MS) return cached.snapshot;
  return null;
}

function setCachedSnapshot(key, snapshot) {
  snapshotCache.set(key, { at: Date.now(), snapshot });
}

function composeFundamentalSnapshot(normalized, rows = {}) {
  const code = normalized.code;
  const valuation = findByCode(rows.valuationRows || [], code, ['Code']);
  const revenue = findByCode(rows.revenueRows || [], code);
  const eps = findByCode(rows.epsRows || [], code);
  const company = findByCode(rows.companyRows || [], code);
  const dividend = findByCode(rows.dividendRows || [], code);
  const chairman = findByCode(rows.chairmanRows || [], code);
  const income = findByCode(rows.incomeRows || [], code);
  const balance = findByCode(rows.balanceRows || [], code);
  const cashFlow = summarizeCashFlow(rows.cashFlowRows || []);
  const revenueTrend = summarizeRevenueTrend(rows.revenueTrendRows || [], revenue);
  const valuationHistory = summarizeValuationHistory(rows.valuationHistoryRows || [], valuation);
  const dividendStability = summarizeDividendStability(rows.dividendHistoryRows || [], dividend);
  const marginTrading = summarizeMarginTrading(rows.marginRows || [], rows.lendingRows || []);
  const eventCalendar = buildEventCalendar({ dividendStability, revenueTrend, valuationHistory, marginTrading, cashFlow });
  const directorSummary = summarizeDirectors((rows.directorRows || []).filter(row => codeOf(row) === code));
  const mergedCompany = mergeCompany(normalized, company, revenue, eps);
  const calculated = calculateMetrics({ stock: mergedCompany, valuation, revenue, eps, income, balance, dividend, directorSummary, cashFlow, revenueTrend, valuationHistory, dividendStability });
  const metrics = buildMetricRows(calculated);
  const scoreModel = buildScoreModel(calculated, { marginTrading });
  const score = scoreModel.total;
  const stage = rows.stage || 'complete';

  return {
    updatedAt: new Date().toISOString(),
    loadingStage: stage,
    isPartial: stage !== 'complete',
    company: mergedCompany,
    period: buildPeriod(income, balance, revenue, cashFlow),
    source: 'TWSE/TPEX OpenAPI + FinMind',
    revenueTrend,
    valuationHistory,
    dividendStability,
    marginTrading,
    eventCalendar,
    scoreModel,
    score,
    scoreLabel: stage === 'quote' ? '載入中' : scoreLabel(score),
    dataCompleteness: dataCompleteness({ valuation, revenue, eps, company, dividend, chairman, directorSummary, income, balance, cashFlow, revenueTrend, valuationHistory, dividendStability, marginTrading, macro: rows.macro }),
    verdict: stage === 'quote'
      ? `${mergedCompany.code} ${mergedCompany.name || ''} 即時報價已載入，正在取得估值、營收與財報資料。`
      : buildVerdict(mergedCompany, calculated, score),
    highlights: buildHighlights(mergedCompany, calculated),
    metrics,
    statements: buildStatementSections({ income, balance, cashFlow, calculated }),
    qualitative: buildQualitativeRows(mergedCompany, { chairman, directorSummary, revenue, revenueTrend, dividend, dividendStability, macro: rows.macro }),
    aiConclusion: buildAiConclusion(mergedCompany, calculated, score, rows.macro)
  };
}

function fundamentalEndpointsFor(stock) {
  const isTpex = isTpexStock(stock);
  const isTwse = !isTpex;

  return {
    valuation: isTwse ? ['/twse/exchangeReport/BWIBBU_ALL'] : ['/tpex/openapi/v1/tpex_mainboard_peratio_analysis'],
    revenue: isTwse ? ['/twse/opendata/t187ap05_L'] : ['/tpex/openapi/v1/mopsfin_t187ap05_O'],
    eps: isTwse ? ['/twse/opendata/t187ap14_L'] : ['/tpex/openapi/v1/mopsfin_t187ap14_O'],
    company: isTwse ? ['/twse/opendata/t187ap03_L'] : ['/tpex/openapi/v1/mopsfin_t187ap03_O'],
    dividend: isTwse ? ['/twse/opendata/t187ap45_L'] : ['/tpex/openapi/v1/mopsfin_t187ap39_O'],
    chairman: isTwse ? ['/twse/opendata/t187ap33_L'] : ['/tpex/openapi/v1/mopsfin_t187ap33_O'],
    director: isTwse ? ['/twse/opendata/t187ap11_L'] : ['/tpex/openapi/v1/mopsfin_t187ap11_O'],
    income: isTwse ? INCOME_ENDPOINTS : TPEX_INCOME_ENDPOINTS,
    balance: isTwse ? BALANCE_ENDPOINTS : TPEX_BALANCE_ENDPOINTS
  };
}

function isTpexStock(stock) {
  const exchange = String(stock.exchange || stock.market || stock.source || '').toLowerCase();
  if (exchange.includes('tpex') || exchange.includes('otc') || exchange.includes('two')) return true;
  if (exchange.includes('twse') || exchange.includes('tse')) return false;

  const code = String(stock.code || '').toUpperCase();
  return /[A-Z]$/.test(code) || ['3', '6', '7', '8'].includes(code[0]);
}

async function fetchRows(path) {
  const now = Date.now();
  const cached = cache.get(path);
  if (cached?.rows && now - cached.at < CACHE_MS) return cached.rows;
  if (cached?.promise) return cached.promise;

  const promise = apiFetch(path)
    .then(rows => Array.isArray(rows) ? rows : [])
    .then(rows => {
      cache.set(path, { at: Date.now(), rows });
      return rows;
    })
    .catch(() => []);

  cache.set(path, { at: now, promise });
  return promise;
}

async function fetchManyRows(paths) {
  const groups = await Promise.all(paths.map(fetchRows));
  return groups.flat();
}

async function fetchFirstRowsContainingCode(paths, code) {
  for (const path of paths) {
    const rows = await fetchRows(path);
    if (rows.some(row => codeOf(row) === code)) return rows;
  }

  return [];
}

async function fetchCashFlowRows(code) {
  const path = `/finmind/api/v4/data?dataset=TaiwanStockCashFlowsStatement&data_id=${encodeURIComponent(code)}&start_date=${cashFlowStartDate()}`;
  const now = Date.now();
  const cached = cache.get(path);
  if (cached?.rows && now - cached.at < CACHE_MS) return cached.rows;
  if (cached?.promise) return cached.promise;

  const promise = apiFetch(path)
    .then(result => Array.isArray(result?.data) ? result.data : [])
    .then(rows => {
      cache.set(path, { at: Date.now(), rows });
      return rows;
    })
    .catch(() => []);

  cache.set(path, { at: now, promise });
  return promise;
}

async function fetchRevenueTrendRows(code) {
  const path = `/finmind/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=${encodeURIComponent(code)}&start_date=${revenueTrendStartDate()}`;
  const now = Date.now();
  const cached = cache.get(path);
  if (cached?.rows && now - cached.at < CACHE_MS) return cached.rows;
  if (cached?.promise) return cached.promise;

  const promise = apiFetch(path)
    .then(result => Array.isArray(result?.data) ? result.data : [])
    .then(rows => {
      cache.set(path, { at: Date.now(), rows });
      return rows;
    })
    .catch(() => []);

  cache.set(path, { at: now, promise });
  return promise;
}

async function fetchValuationHistoryRows(code) {
  const path = `/finmind/api/v4/data?dataset=TaiwanStockPER&data_id=${encodeURIComponent(code)}&start_date=${valuationHistoryStartDate()}`;
  const now = Date.now();
  const cached = cache.get(path);
  if (cached?.rows && now - cached.at < CACHE_MS) return cached.rows;
  if (cached?.promise) return cached.promise;

  const promise = apiFetch(path)
    .then(result => Array.isArray(result?.data) ? result.data : [])
    .then(rows => {
      cache.set(path, { at: Date.now(), rows });
      return rows;
    })
    .catch(() => []);

  cache.set(path, { at: now, promise });
  return promise;
}

async function fetchDividendHistoryRows(code) {
  const path = `/finmind/api/v4/data?dataset=TaiwanStockDividend&data_id=${encodeURIComponent(code)}&start_date=${dividendHistoryStartDate()}`;
  const now = Date.now();
  const cached = cache.get(path);
  if (cached?.rows && now - cached.at < CACHE_MS) return cached.rows;
  if (cached?.promise) return cached.promise;

  const promise = apiFetch(path)
    .then(result => Array.isArray(result?.data) ? result.data : [])
    .then(rows => {
      cache.set(path, { at: Date.now(), rows });
      return rows;
    })
    .catch(() => []);

  cache.set(path, { at: now, promise });
  return promise;
}

async function fetchMarginRows(code) {
  const path = `/finmind/api/v4/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${encodeURIComponent(code)}&start_date=${marginStartDate()}`;
  const now = Date.now();
  const cached = cache.get(path);
  if (cached?.rows && now - cached.at < CACHE_MS) return cached.rows;
  if (cached?.promise) return cached.promise;

  const promise = apiFetch(path)
    .then(result => Array.isArray(result?.data) ? result.data : [])
    .then(rows => {
      cache.set(path, { at: Date.now(), rows });
      return rows;
    })
    .catch(() => []);

  cache.set(path, { at: now, promise });
  return promise;
}

async function fetchLendingRows(code) {
  const path = `/finmind/api/v4/data?dataset=TaiwanStockSecuritiesLending&data_id=${encodeURIComponent(code)}&start_date=${marginStartDate()}`;
  const now = Date.now();
  const cached = cache.get(path);
  if (cached?.rows && now - cached.at < CACHE_MS) return cached.rows;
  if (cached?.promise) return cached.promise;

  const promise = apiFetch(path)
    .then(result => Array.isArray(result?.data) ? result.data : [])
    .then(rows => {
      cache.set(path, { at: Date.now(), rows });
      return rows;
    })
    .catch(() => []);

  cache.set(path, { at: now, promise });
  return promise;
}

async function fetchMacroSnapshot() {
  const path = `/finmind/api/v4/data?dataset=TaiwanExchangeRate&data_id=USD&start_date=${macroStartDate()}`;
  const now = Date.now();
  const cached = cache.get(path);
  if (cached?.macro && now - cached.at < CACHE_MS) return cached.macro;
  if (cached?.promise) return cached.promise;

  const promise = Promise.all([
    apiFetch(path).catch(() => null),
    stockApi.market().catch(() => null)
  ])
    .then(([exchangeData, market]) => {
      const exchangeRate = summarizeExchangeRate(exchangeData?.data || []);
      const macro = {
        exchangeRate,
        market: market ? {
          taiex: Number(market.taiex || 0),
          change: Number(market.change || 0),
          changePct: Number(market.changePct || 0),
          updatedAt: market.time || ''
        } : null
      };
      cache.set(path, { at: Date.now(), macro });
      return macro;
    })
    .catch(() => null);

  cache.set(path, { at: now, promise });
  return promise;
}

function cashFlowStartDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return date.toISOString().slice(0, 10);
}

function revenueTrendStartDate() {
  const date = new Date();
  date.setMonth(date.getMonth() - 30);
  return date.toISOString().slice(0, 10);
}

function valuationHistoryStartDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function dividendHistoryStartDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 7);
  return date.toISOString().slice(0, 10);
}

function marginStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 45);
  return date.toISOString().slice(0, 10);
}

function macroStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 45);
  return date.toISOString().slice(0, 10);
}

function normalizeStock(stock) {
  return {
    code: String(stock?.code || '').trim(),
    name: String(stock?.name || '').trim(),
    sector: stock?.sector || '',
    exchange: stock?.exchange || '',
    price: Number(stock?.price || 0),
    change: Number(stock?.change || 0),
    chgPct: Number(stock?.chgPct || 0),
    volume: Number(stock?.volume || 0),
    amountHundredMillion: Number(stock?.amountHundredMillion || 0)
  };
}

function mergeCompany(stock, company, revenue, eps) {
  return {
    ...stock,
    name: read(company, ['公司簡稱', 'CompanyAbbreviation', '公司名稱', 'CompanyName']) || read(revenue, ['公司名稱']) || read(eps, ['公司名稱', 'CompanyName']) || stock.name,
    fullName: read(company, ['公司名稱', 'CompanyName']) || read(eps, ['公司名稱', 'CompanyName']) || '',
    sector: read(revenue, ['產業別']) || read(eps, ['產業別']) || stock.sector,
    chairman: read(company, ['董事長', 'Chairman']) || '',
    generalManager: read(company, ['總經理', 'GeneralManager']) || '',
    spokesperson: read(company, ['發言人', 'Spokesman']) || '',
    listedDate: formatCompactDate(read(company, ['上市日期', 'DateOfListing'])),
    capital: parseNumber(read(company, ['實收資本額', 'Paidin.Capital.NTDollars'])),
    shares: parseNumber(read(company, ['已發行普通股數或TDR原股發行股數', 'IssueShares'])),
    website: read(company, ['網址', 'WebAddress']) || ''
  };
}

function summarizeCashFlow(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const latestDate = rows
    .map(row => row.date)
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!latestDate) return null;

  const latestRows = rows.filter(row => row.date === latestDate);
  const valueOf = (...types) => {
    const row = latestRows.find(item => types.includes(item.type));
    return row ? toThousandUnit(parseNumber(row.value)) : 0;
  };

  const operating = valueOf(
    'CashFlowsFromOperatingActivities',
    'NetCashInflowFromOperatingActivities',
    'CashProvidedByOperatingActivities'
  );
  const investing = valueOf('CashProvidedByInvestingActivities', 'CashFlowsFromInvestingActivities');
  const financing = valueOf('CashFlowsProvidedFromFinancingActivities', 'CashProvidedByFinancingActivities');
  const capitalExpenditure = valueOf('PropertyAndPlantAndEquipment');
  const freeCashFlow = operating + capitalExpenditure;

  return {
    date: latestDate,
    operating,
    investing,
    financing,
    capitalExpenditure,
    freeCashFlow,
    rows: latestRows
  };
}

function summarizeRevenueTrend(rows, fallbackRevenue) {
  const parsed = (Array.isArray(rows) ? rows : [])
    .map(row => {
      const monthKey = revenueMonthKey(row);
      const revenue = parseNumber(read(row, ['revenue', 'Revenue', '營業收入-當月營收']));
      return monthKey && revenue ? { monthKey, revenue } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const byMonth = new Map(parsed.map(row => [row.monthKey, row]));
  const withMoves = parsed.map((row, index) => {
    const previous = parsed[index - 1];
    const previousYear = byMonth.get(previousYearMonthKey(row.monthKey));
    return {
      ...row,
      month: row.monthKey.replace('-', '/'),
      mom: previous?.revenue ? roundPercentChange(row.revenue, previous.revenue) : null,
      yoy: previousYear?.revenue ? roundPercentChange(row.revenue, previousYear.revenue) : null
    };
  });

  const last12 = withMoves.slice(-12);
  const latest = last12.at(-1);
  if (!latest) {
    const fallback = summarizeRevenueFallback(fallbackRevenue);
    return fallback ? {
      ...fallback,
      rows: [fallback],
      source: 'TWSE/TPEX OpenAPI',
      available: true
    } : null;
  }

  const recentWithYoy = last12.filter(row => Number.isFinite(row.yoy));
  const recent3 = recentWithYoy.slice(-3);
  const avg3Yoy = average(recent3.map(row => row.yoy));
  const positiveStreak = countPositiveStreak(last12.map(row => row.yoy));
  const direction = revenueTrendDirection(latest.yoy, avg3Yoy, positiveStreak);

  return {
    available: true,
    source: 'FinMind TaiwanStockMonthRevenue',
    latestMonth: latest.month,
    latestRevenue: latest.revenue,
    latestMom: latest.mom,
    latestYoy: latest.yoy,
    avg3Yoy,
    positiveStreak,
    direction: direction.key,
    label: direction.label,
    tone: direction.tone,
    rows: last12
  };
}

function summarizeRevenueFallback(row) {
  if (!row) return null;
  const revenue = parseNumber(read(row, ['營業收入-當月營收']));
  if (!revenue) return null;
  return {
    monthKey: '',
    month: formatYearMonth(read(row, ['資料年月'])),
    latestMonth: formatYearMonth(read(row, ['資料年月'])),
    latestRevenue: revenue,
    revenue,
    latestMom: parseNumber(read(row, ['營業收入-上月比較增減(%)'])),
    latestYoy: parseNumber(read(row, ['營業收入-去年同月增減(%)'])),
    mom: parseNumber(read(row, ['營業收入-上月比較增減(%)'])),
    yoy: parseNumber(read(row, ['營業收入-去年同月增減(%)'])),
    avg3Yoy: parseNumber(read(row, ['營業收入-去年同月增減(%)'])),
    positiveStreak: parseNumber(read(row, ['營業收入-去年同月增減(%)'])) > 0 ? 1 : 0,
    direction: 'single-month',
    label: '單月資料',
    tone: 'neutral'
  };
}

function revenueMonthKey(row) {
  const date = String(read(row, ['date', 'Date']) || '').trim();
  if (/^\d{4}-\d{2}/.test(date)) return date.slice(0, 7);

  const year = Number(read(row, ['revenue_year', 'year', 'Year']));
  const month = Number(read(row, ['revenue_month', 'month', 'Month']));
  if (year && month) return `${year}-${String(month).padStart(2, '0')}`;

  return '';
}

function previousYearMonthKey(monthKey) {
  const [year, month] = String(monthKey || '').split('-');
  const previousYear = Number(year) - 1;
  return previousYear ? `${previousYear}-${month}` : '';
}

function roundPercentChange(current, previous) {
  const now = Number(current || 0);
  const before = Number(previous || 0);
  return before ? Number((((now - before) / before) * 100).toFixed(2)) : null;
}

function average(values) {
  const rows = values.filter(Number.isFinite);
  if (!rows.length) return null;
  return Number((rows.reduce((sum, value) => sum + value, 0) / rows.length).toFixed(2));
}

function countPositiveStreak(values) {
  let count = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (!Number.isFinite(value) || value <= 0) break;
    count += 1;
  }
  return count;
}

function revenueTrendDirection(latestYoy, avg3Yoy, positiveStreak) {
  if (!Number.isFinite(latestYoy)) return { key: 'unknown', label: '資料待補', tone: 'pending' };
  if (latestYoy >= 10 && Number.isFinite(avg3Yoy) && avg3Yoy >= 5 && positiveStreak >= 3) {
    return { key: 'accelerating', label: '成長延續', tone: 'good' };
  }
  if (latestYoy > 0 && positiveStreak >= 2) return { key: 'positive', label: '轉強觀察', tone: 'watch' };
  if (latestYoy < -10 && Number.isFinite(avg3Yoy) && avg3Yoy < 0) return { key: 'weakening', label: '衰退擴大', tone: 'risk' };
  if (latestYoy < 0) return { key: 'soft', label: '偏弱', tone: 'neutral' };
  return { key: 'stable', label: '持平偏穩', tone: 'neutral' };
}

function summarizeValuationHistory(rows, fallbackValuation) {
  const parsed = (Array.isArray(rows) ? rows : [])
    .map(row => ({
      date: String(read(row, ['date', 'Date']) || '').trim(),
      pe: parseNumber(read(row, ['PER', 'PEratio', 'PriceEarningRatio'])),
      pb: parseNumber(read(row, ['PBR', 'PBratio', 'PriceBookRatio'])),
      dividendYield: parseNumber(read(row, ['dividend_yield', 'DividendYield', 'YieldRatio']))
    }))
    .filter(row => row.date && (row.pe || row.pb || row.dividendYield))
    .sort((a, b) => a.date.localeCompare(b.date));

  const latest = parsed.at(-1);
  if (!latest) {
    const pe = parseNumber(read(fallbackValuation, ['PEratio', 'PriceEarningRatio']));
    const pb = parseNumber(read(fallbackValuation, ['PBratio', 'PriceBookRatio']));
    const dividendYield = parseNumber(read(fallbackValuation, ['DividendYield', 'YieldRatio']));
    if (!pe && !pb && !dividendYield) return null;
    return {
      available: true,
      source: 'TWSE/TPEX OpenAPI',
      latestDate: formatRocDate(read(fallbackValuation, ['Date'])),
      pe: valuationMetric('PE', pe, [pe]),
      pb: valuationMetric('PB', pb, [pb]),
      dividendYield: valuationMetric('殖利率', dividendYield, [dividendYield]),
      label: '單日估值',
      tone: 'neutral'
    };
  }

  const pe = valuationMetric('PE', latest.pe, parsed.map(row => row.pe));
  const pb = valuationMetric('PB', latest.pb, parsed.map(row => row.pb));
  const dividendYield = valuationMetric('殖利率', latest.dividendYield, parsed.map(row => row.dividendYield));
  const pePercentile = Number(pe.percentile || 0);
  const tone = pePercentile >= 80 ? 'risk' : pePercentile >= 60 ? 'watch' : pePercentile <= 25 ? 'good' : 'neutral';

  return {
    available: true,
    source: 'FinMind TaiwanStockPER',
    latestDate: latest.date,
    sampleDays: parsed.length,
    pe,
    pb,
    dividendYield,
    label: tone === 'risk' ? '偏高估' : tone === 'good' ? '相對低估' : tone === 'watch' ? '估值偏高' : '估值中性',
    tone,
    rows: parsed.slice(-60)
  };
}

function summarizeDividendStability(rows, fallbackDividend) {
  const parsed = (Array.isArray(rows) ? rows : [])
    .map(row => ({
      date: String(read(row, ['date', 'Date']) || '').trim(),
      fiscalLabel: String(read(row, ['year', '股利年度']) || '').trim(),
      fiscalYear: dividendFiscalYear(row),
      cashDividend: parseNumber(read(row, ['CashEarningsDistribution', '股東配發-盈餘分配之現金股利(元/股)', 'DividendPerShare'])),
      stockDividend: parseNumber(read(row, ['StockEarningsDistribution'])),
      exDate: String(read(row, ['CashExDividendTradingDate']) || '').trim(),
      paymentDate: String(read(row, ['CashDividendPaymentDate']) || '').trim(),
      announcementDate: String(read(row, ['AnnouncementDate']) || '').trim()
    }))
    .filter(row => row.fiscalYear && (row.cashDividend || row.stockDividend))
    .sort((a, b) => a.fiscalYear - b.fiscalYear || a.date.localeCompare(b.date));

  if (!parsed.length) {
    const cashDividend = parseNumber(read(fallbackDividend, ['股東配發-盈餘分配之現金股利(元/股)', '股東配發內容-盈餘分配之現金股利(元/股)']));
    if (!cashDividend) return null;
    return {
      available: true,
      source: 'TWSE/TPEX OpenAPI',
      latestYear: read(fallbackDividend, ['股利年度']) || '',
      latestCashDividend: cashDividend,
      avg5CashDividend: cashDividend,
      consecutiveYears: 1,
      label: '單年配息',
      tone: 'neutral',
      rows: []
    };
  }

  const byYear = new Map();
  for (const row of parsed) {
    const current = byYear.get(row.fiscalYear) || { year: row.fiscalYear, cashDividend: 0, stockDividend: 0, count: 0 };
    current.cashDividend += row.cashDividend;
    current.stockDividend += row.stockDividend;
    current.count += 1;
    byYear.set(row.fiscalYear, current);
  }

  const annual = Array.from(byYear.values())
    .sort((a, b) => a.year - b.year)
    .map(row => ({
      ...row,
      cashDividend: Number(row.cashDividend.toFixed(4)),
      stockDividend: Number(row.stockDividend.toFixed(4))
    }));
  const latest = annual.at(-1);
  const latestFive = annual.slice(-5);
  const avg5CashDividend = average(latestFive.map(row => row.cashDividend));
  const consecutiveYears = countPositiveStreak(annual.map(row => row.cashDividend));
  const tone = consecutiveYears >= 5 && latest.cashDividend >= (avg5CashDividend || 0) ? 'good'
    : consecutiveYears >= 3 ? 'watch'
      : latest.cashDividend > 0 ? 'neutral'
        : 'risk';

  return {
    available: true,
    source: 'FinMind TaiwanStockDividend',
    latestYear: latest.year,
    latestCashDividend: latest.cashDividend,
    avg5CashDividend,
    consecutiveYears,
    label: tone === 'good' ? '穩定配息' : tone === 'watch' ? '配息延續' : tone === 'risk' ? '配息中斷' : '需觀察',
    tone,
    events: buildDividendEvents(parsed),
    rows: latestFive
  };
}

function buildDividendEvents(rows) {
  return rows
    .slice(-8)
    .flatMap(row => {
      const cashText = row.cashDividend ? `現金股利 ${formatPlain(row.cashDividend, 2)} 元` : '';
      return [
        row.exDate ? {
          date: row.exDate,
          title: '除息交易日',
          type: 'dividend',
          detail: `${row.fiscalLabel || row.fiscalYear} ${cashText}`.trim(),
          source: 'FinMind TaiwanStockDividend'
        } : null,
        row.paymentDate ? {
          date: row.paymentDate,
          title: '現金股利發放日',
          type: 'dividend',
          detail: `${row.fiscalLabel || row.fiscalYear} ${cashText}`.trim(),
          source: 'FinMind TaiwanStockDividend'
        } : null,
        row.announcementDate ? {
          date: row.announcementDate,
          title: '股利公告日',
          type: 'disclosure',
          detail: `${row.fiscalLabel || row.fiscalYear} ${cashText}`.trim(),
          source: 'FinMind TaiwanStockDividend'
        } : null
      ];
    })
    .filter(Boolean);
}

function dividendFiscalYear(row) {
  const yearText = String(read(row, ['year', '股利年度']) || '');
  const rocMatch = yearText.match(/(\d{3})/);
  if (rocMatch) return Number(rocMatch[1]) + 1911;
  const date = String(read(row, ['date', 'Date']) || '');
  if (/^\d{4}/.test(date)) return Number(date.slice(0, 4));
  return 0;
}

function summarizeMarginTrading(marginRows, lendingRows) {
  const margin = (Array.isArray(marginRows) ? marginRows : [])
    .filter(row => row?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const lending = (Array.isArray(lendingRows) ? lendingRows : [])
    .filter(row => row?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const latest = margin.at(-1);
  if (!latest && !lending.length) return null;

  const latestMargin = latest ? {
    date: latest.date,
    marginBalance: parseNumber(latest.MarginPurchaseTodayBalance),
    marginChange: parseNumber(latest.MarginPurchaseTodayBalance) - parseNumber(latest.MarginPurchaseYesterdayBalance),
    shortBalance: parseNumber(latest.ShortSaleTodayBalance),
    shortChange: parseNumber(latest.ShortSaleTodayBalance) - parseNumber(latest.ShortSaleYesterdayBalance),
    offset: parseNumber(latest.OffsetLoanAndShort)
  } : null;
  const latestLendingDate = lending.at(-1)?.date || '';
  const latestLendingRows = latestLendingDate ? lending.filter(row => row.date === latestLendingDate) : [];
  const lendingVolume = latestLendingRows.reduce((sum, row) => sum + parseNumber(row.volume), 0);
  const lendingFeeAvg = average(latestLendingRows.map(row => parseNumber(row.fee_rate)).filter(value => value > 0));
  const recent5 = margin.slice(-5);
  const margin5Change = recent5.length
    ? parseNumber(recent5.at(-1).MarginPurchaseTodayBalance) - parseNumber(recent5[0].MarginPurchaseYesterdayBalance)
    : 0;
  const short5Change = recent5.length
    ? parseNumber(recent5.at(-1).ShortSaleTodayBalance) - parseNumber(recent5[0].ShortSaleYesterdayBalance)
    : 0;
  const tone = margin5Change > 0 && short5Change <= 0 ? 'watch'
    : margin5Change < 0 && short5Change <= 0 ? 'good'
      : short5Change > 0 ? 'risk'
        : 'neutral';

  return {
    available: true,
    source: 'FinMind TaiwanStockMarginPurchaseShortSale + TaiwanStockSecuritiesLending',
    latestDate: latestMargin?.date || latestLendingDate,
    ...latestMargin,
    margin5Change,
    short5Change,
    lendingDate: latestLendingDate,
    lendingVolume,
    lendingFeeAvg,
    label: tone === 'risk' ? '空方壓力升高' : tone === 'good' ? '信用降溫' : tone === 'watch' ? '融資偏熱' : '中性',
    tone
  };
}

function buildEventCalendar({ dividendStability, revenueTrend, valuationHistory, marginTrading, cashFlow }) {
  const events = [];

  if (Array.isArray(dividendStability?.events)) {
    events.push(...dividendStability.events);
  }

  if (revenueTrend?.latestMonth) {
    events.push({
      date: `${String(revenueTrend.latestMonth).replace('/', '-')}-01`,
      title: '月營收更新',
      type: 'revenue',
      detail: `YoY ${formatSignedPercent(revenueTrend.latestYoy)}，近 3 月平均 ${formatSignedPercent(revenueTrend.avg3Yoy)}`,
      source: revenueTrend.source || 'FinMind TaiwanStockMonthRevenue'
    });
  }

  if (valuationHistory?.latestDate) {
    events.push({
      date: valuationHistory.latestDate,
      title: '估值資料更新',
      type: 'valuation',
      detail: `${valuationHistory.label || '估值'}，PE 百分位 ${Number.isFinite(valuationHistory.pe?.percentile) ? `${valuationHistory.pe.percentile}%` : '--'}`,
      source: valuationHistory.source || 'FinMind TaiwanStockPER'
    });
  }

  if (marginTrading?.latestDate) {
    events.push({
      date: marginTrading.latestDate,
      title: '信用交易更新',
      type: 'margin',
      detail: `${marginTrading.label || '融資融券'}，近 5 日融資 ${formatSignedPlain(marginTrading.margin5Change, 0)} 張`,
      source: marginTrading.source || 'FinMind'
    });
  }

  if (cashFlow?.date) {
    events.push({
      date: cashFlow.date,
      title: '現金流量表更新',
      type: 'financial',
      detail: `營業現金流 ${formatMillion(cashFlow.operating)}，自由現金流 ${formatMillion(cashFlow.freeCashFlow)}`,
      source: CASHFLOW_SOURCE_NOTE
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const unique = [];
  const seen = new Set();
  for (const event of events) {
    const date = normalizeEventDate(event.date);
    if (!date) continue;
    const key = `${date}:${event.title}:${event.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      ...event,
      date,
      status: date >= today ? 'upcoming' : 'recent'
    });
  }

  return unique
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'upcoming' ? -1 : 1;
      return a.status === 'upcoming' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
    })
    .slice(0, 10);
}

function normalizeEventDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) return text.replace(/\//g, '-');
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (/^\d{4}\/\d{2}$/.test(text)) return `${text.replace('/', '-')}-01`;
  return '';
}

function valuationMetric(label, current, values) {
  const sample = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  const value = Number(current || 0);
  if (!sample.length || !value) {
    return { label, current: value || null, min: null, max: null, avg: null, percentile: null };
  }

  return {
    label,
    current: value,
    min: Math.min(...sample),
    max: Math.max(...sample),
    avg: Number((sample.reduce((sum, item) => sum + item, 0) / sample.length).toFixed(2)),
    percentile: Number(((sample.filter(item => item <= value).length / sample.length) * 100).toFixed(0))
  };
}

function summarizeExchangeRate(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const sorted = rows
    .filter(row => row?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latest = sorted.at(-1);
  const previous = sorted.at(-2);

  if (!latest) return null;

  const spotMid = averageRate(latest.spot_buy, latest.spot_sell);
  const previousSpotMid = previous ? averageRate(previous.spot_buy, previous.spot_sell) : 0;
  const change = spotMid && previousSpotMid ? Number((spotMid - previousSpotMid).toFixed(4)) : 0;
  const changePct = spotMid && previousSpotMid ? Number(((change / previousSpotMid) * 100).toFixed(2)) : 0;

  return {
    date: latest.date,
    currency: latest.currency || 'USD',
    spotMid,
    spotBuy: Number(latest.spot_buy || 0),
    spotSell: Number(latest.spot_sell || 0),
    change,
    changePct
  };
}

function averageRate(buy, sell) {
  const buyValue = Number(buy || 0);
  const sellValue = Number(sell || 0);
  if (buyValue && sellValue) return Number(((buyValue + sellValue) / 2).toFixed(4));
  return buyValue || sellValue || 0;
}

function calculateMetrics({ stock, valuation, revenue, eps, income, balance, dividend, directorSummary, cashFlow, revenueTrend, valuationHistory, dividendStability }) {
  const operatingRevenue = parseNumber(read(income, ['營業收入'])) || parseNumber(read(eps, ['營業收入']));
  const grossProfit = parseNumber(read(income, ['營業毛利（毛損）淨額', '營業毛利（毛損）']));
  const operatingIncome = parseNumber(read(income, ['營業利益（損失)'])) || parseNumber(read(income, ['營業利益（損失）'])) || parseNumber(read(eps, ['營業利益']));
  const netIncome = parseNumber(read(income, ['淨利（淨損）歸屬於母公司業主'])) || parseNumber(read(income, ['本期淨利（淨損）'])) || parseNumber(read(eps, ['稅後淨利']));
  const totalAssets = parseNumber(read(balance, ['資產總額', '資產總計']));
  const totalLiabilities = parseNumber(read(balance, ['負債總額', '負債總計']));
  const totalEquity = parseNumber(read(balance, ['歸屬於母公司業主之權益合計', '權益總額', '權益總計']));
  const epsValue = parseNumber(read(eps, ['基本每股盈餘(元)'])) || parseNumber(read(income, ['基本每股盈餘（元）']));
  const cashDividend = parseNumber(read(dividend, ['股東配發-盈餘分配之現金股利(元/股)']));
  const officialPe = valuationHistory?.pe?.current || parseNumber(read(valuation, ['PEratio', 'PriceEarningRatio']));
  const estimatedPe = !officialPe && epsValue > 0 && Number(stock?.price || 0) > 0
    ? Number((Number(stock.price) / epsValue).toFixed(2))
    : 0;

  return {
    pe: officialPe || estimatedPe,
    peSource: officialPe ? 'official' : estimatedPe ? 'estimated' : '',
    pb: valuationHistory?.pb?.current || parseNumber(read(valuation, ['PBratio', 'PriceBookRatio'])),
    dividendYield: valuationHistory?.dividendYield?.current || parseNumber(read(valuation, ['DividendYield', 'YieldRatio'])),
    valuationPePercentile: valuationHistory?.pe?.percentile,
    valuationPbPercentile: valuationHistory?.pb?.percentile,
    valuationLabel: valuationHistory?.label || '',
    eps: epsValue,
    cashDividend: dividendStability?.latestCashDividend || cashDividend || parseNumber(read(valuation, ['DividendPerShare'])),
    avg5CashDividend: dividendStability?.avg5CashDividend || 0,
    dividendConsecutiveYears: dividendStability?.consecutiveYears || 0,
    dividendStabilityLabel: dividendStability?.label || '',
    monthlyRevenue: revenueTrend?.latestRevenue || parseNumber(read(revenue, ['營業收入-當月營收'])),
    monthlyRevenueMom: Number.isFinite(revenueTrend?.latestMom) ? revenueTrend.latestMom : parseNumber(read(revenue, ['營業收入-上月比較增減(%)'])),
    monthlyRevenueYoy: Number.isFinite(revenueTrend?.latestYoy) ? revenueTrend.latestYoy : parseNumber(read(revenue, ['營業收入-去年同月增減(%)'])),
    avg3RevenueYoy: Number.isFinite(revenueTrend?.avg3Yoy) ? revenueTrend.avg3Yoy : 0,
    revenuePositiveStreak: revenueTrend?.positiveStreak || 0,
    revenueTrendLabel: revenueTrend?.label || '',
    cumulativeRevenueYoy: parseNumber(read(revenue, ['累計營業收入-前期比較增減(%)'])),
    operatingRevenue,
    grossProfit,
    operatingIncome,
    netIncome,
    totalAssets,
    totalLiabilities,
    totalEquity,
    bookValuePerShare: parseNumber(read(balance, ['每股參考淨值'])),
    grossMargin: ratio(grossProfit, operatingRevenue),
    operatingMargin: ratio(operatingIncome, operatingRevenue),
    roeAnnualized: ratio(netIncome * 4, totalEquity),
    debtRatio: ratio(totalLiabilities, totalAssets),
    operatingCashFlow: cashFlow?.operating || 0,
    investingCashFlow: cashFlow?.investing || 0,
    financingCashFlow: cashFlow?.financing || 0,
    capitalExpenditure: cashFlow?.capitalExpenditure || 0,
    freeCashFlow: cashFlow?.freeCashFlow || 0,
    directorHolding: directorSummary.holding,
    directorPledgeRatio: directorSummary.pledgeRatio,
    dataDates: {
      valuation: formatRocDate(read(valuation, ['Date'])),
      revenue: revenueTrend?.latestMonth || formatYearMonth(read(revenue, ['資料年月'])),
      financial: financialPeriod(income || balance),
      cashFlow: cashFlow?.date || '',
      valuationHistory: valuationHistory?.latestDate || '',
      dividend: read(dividend, ['股利所屬年(季)度']) || ''
    }
  };
}

function buildHighlights(stock, metrics) {
  return [
    {
      label: '本益比',
      value: formatPlain(metrics.pe, 2),
      detail: peDetail(metrics)
    },
    {
      label: '殖利率',
      value: formatPercent(metrics.dividendYield),
      detail: metrics.cashDividend ? `現金股利 ${formatPlain(metrics.cashDividend, 2)} 元/股` : 'TWSE OpenAPI'
    },
    {
      label: '股價淨值比',
      value: formatPlain(metrics.pb, 2),
      detail: metrics.bookValuePerShare ? `每股淨值 ${formatPlain(metrics.bookValuePerShare, 2)}` : 'TWSE OpenAPI'
    },
    {
      label: '月營收 YoY',
      value: formatPercent(metrics.monthlyRevenueYoy),
      detail: metrics.dataDates.revenue || '上市公司月營收'
    },
    {
      label: '營收趨勢',
      value: metrics.revenueTrendLabel || '--',
      detail: Number.isFinite(metrics.avg3RevenueYoy) && metrics.avg3RevenueYoy !== 0
        ? `近 3 月平均 YoY ${formatPercent(metrics.avg3RevenueYoy)}`
        : 'FinMind 月營收趨勢'
    },
    {
      label: '估值區間',
      value: metrics.valuationLabel || '--',
      detail: Number.isFinite(metrics.valuationPePercentile)
        ? `PE 近一年百分位 ${formatPlain(metrics.valuationPePercentile, 0)}%`
        : 'FinMind TaiwanStockPER'
    },
    {
      label: '股利穩定性',
      value: metrics.dividendStabilityLabel || '--',
      detail: metrics.dividendConsecutiveYears
        ? `連續配息 ${formatPlain(metrics.dividendConsecutiveYears, 0)} 年`
        : 'FinMind TaiwanStockDividend'
    }
  ];
}

function peDetail(metrics) {
  if (metrics.peSource === 'estimated') return '官方未提供，以股價/EPS估算';
  if (metrics.dataDates.valuation) return `估值日期 ${metrics.dataDates.valuation}`;
  return 'TWSE OpenAPI';
}

function buildMetricRows(metrics) {
  return [
    metric('EPS', formatPlain(metrics.eps, 2), statusByNumber(metrics.eps, [0, 3, 8]), '每股盈餘', '越高代表單位股本獲利越強，需搭配成長穩定性觀察。'),
    metric('年化 ROE', formatPercent(metrics.roeAnnualized), statusByNumber(metrics.roeAnnualized, [5, 10, 15]), '股東權益報酬率', '長期高於 15% 通常代表資本效率佳。'),
    metric('毛利率', formatPercent(metrics.grossMargin), statusByNumber(metrics.grossMargin, [10, 20, 35]), '產品/服務定價能力', '穩定或提升代表競爭力較強。'),
    metric('營業利益率', formatPercent(metrics.operatingMargin), statusByNumber(metrics.operatingMargin, [5, 10, 20]), '本業獲利能力', '用來排除一次性業外收益干擾。'),
    metric('自由現金流', formatMillion(metrics.freeCashFlow), statusByCashFlow(metrics.freeCashFlow), '營業現金流扣除資本支出', '長期為正代表獲利較能轉成可支配現金。'),
    metric('負債比', formatPercent(metrics.debtRatio), statusByDebt(metrics.debtRatio), '財務槓桿', '過高代表景氣反轉時財務壓力較大。'),
    metric('月營收 YoY', formatPercent(metrics.monthlyRevenueYoy), statusByNumber(metrics.monthlyRevenueYoy, [-5, 0, 10]), '營收成長動能', '連續正成長通常代表需求或市佔較佳。'),
    metric('近 3 月營收 YoY', formatPercent(metrics.avg3RevenueYoy), statusByNumber(metrics.avg3RevenueYoy, [-5, 0, 10]), '月營收趨勢', '比單月 YoY 更能排除一次性波動。'),
    metric('本益比', formatPlain(metrics.pe, 2), statusByPe(metrics.pe), '估值水位', '需與歷史區間、同業與成長率一起比較。'),
    metric('PE 歷史百分位', Number.isFinite(metrics.valuationPePercentile) ? `${formatPlain(metrics.valuationPePercentile, 0)}%` : '--', statusByPercentile(metrics.valuationPePercentile), '近一年相對估值', '百分位越高代表目前 PE 越接近近一年高檔。'),
    metric('連續配息', metrics.dividendConsecutiveYears ? `${formatPlain(metrics.dividendConsecutiveYears, 0)} 年` : '--', statusByDividendStability(metrics.dividendConsecutiveYears), '股利穩定性', '穩定配息通常代表現金流與獲利可預期性較佳。'),
    metric('董監質押比', metrics.directorHolding ? formatPercent(metrics.directorPledgeRatio, true) : '--', statusByDebt(metrics.directorPledgeRatio, metrics.directorHolding > 0), '治理風險', '質押比例過高時，股價劇烈波動可能放大治理風險。')
  ];
}

function metric(label, value, status, meaning, rule) {
  return { label, value, status, meaning, rule };
}

function buildStatementSections({ income, balance, cashFlow, calculated }) {
  return [
    {
      title: '損益表',
      rows: [
        statementRow('營收', formatMillion(calculated.operatingRevenue), '最新季度營業收入'),
        statementRow('毛利', formatMillion(calculated.grossProfit), `毛利率 ${formatPercent(calculated.grossMargin)}`),
        statementRow('營業利益', formatMillion(calculated.operatingIncome), `營益率 ${formatPercent(calculated.operatingMargin)}`),
        statementRow('歸屬母公司淨利', formatMillion(calculated.netIncome), `EPS ${formatPlain(calculated.eps, 2)}`)
      ],
      note: financialPeriod(income)
    },
    {
      title: '資產負債表',
      rows: [
        statementRow('資產總額', formatMillion(calculated.totalAssets), '公司總資產規模'),
        statementRow('負債總額', formatMillion(calculated.totalLiabilities), `負債比 ${formatPercent(calculated.debtRatio)}`),
        statementRow('股東權益', formatMillion(calculated.totalEquity), '歸屬母公司或權益總額'),
        statementRow('每股參考淨值', formatPlain(calculated.bookValuePerShare, 2), 'PB 計算基礎之一')
      ],
      note: financialPeriod(balance)
    },
    {
      title: '現金流量表',
      rows: [
        statementRow('營業現金流', formatMillion(calculated.operatingCashFlow), '本業產生的現金流入或流出'),
        statementRow('投資現金流', formatMillion(calculated.investingCashFlow), '資本支出與投資活動淨額'),
        statementRow('籌資現金流', formatMillion(calculated.financingCashFlow), '借款、還款、股利與籌資活動'),
        statementRow('自由現金流', formatMillion(calculated.freeCashFlow), '營業現金流加上資本支出')
      ],
      note: cashFlow?.date ? `${cashFlow.date}；${CASHFLOW_SOURCE_NOTE}` : CASHFLOW_SOURCE_NOTE
    }
  ];
}

function statementRow(label, value, note) {
  return { label, value, note };
}

function buildQualitativeRows(stock, { chairman, directorSummary, revenue, revenueTrend, dividend, dividendStability, macro }) {
  return [
    {
      title: '總體經濟',
      status: macroStatus(macro),
      body: buildMacroBody(macro)
    },
    {
      title: '產業前景',
      status: stock.sector ? '已取得' : '待補',
      body: stock.sector ? `${stock.sector} 已作為基本分類；後續可再加入同業平均 EPS、ROE 與毛利率比較。` : '尚未取得產業分類。'
    },
    {
      title: '公司治理',
      status: chairman ? '已取得' : '部分',
      body: `${read(chairman, ['董事長', 'Chairman']) || stock.chairman || '董事長資料待補'}；董事長是否兼任總經理：${read(chairman, ['董事長是否兼任總經理']) || '--'}。董監持股 ${directorSummary.holding ? formatPlain(directorSummary.holding, 0) : '--'} 股，質押比 ${directorSummary.holding ? formatPercent(directorSummary.pledgeRatio, true) : '--'}。`
    },
    {
      title: '股利政策',
      status: dividendStability?.available || dividend ? '已取得' : '待補',
      body: dividendStability?.available
        ? `最新年度 ${dividendStability.latestYear || '--'}，現金股利合計 ${formatPlain(dividendStability.latestCashDividend, 2)} 元，近 5 年平均 ${formatPlain(dividendStability.avg5CashDividend, 2)} 元，連續配息 ${dividendStability.consecutiveYears} 年。`
        : dividend ? `最新股利年度 ${read(dividend, ['股利年度']) || '--'}，現金股利 ${formatPlain(parseNumber(read(dividend, ['股東配發-盈餘分配之現金股利(元/股)', '股東配發內容-盈餘分配之現金股利(元/股)'])), 2)} 元/股。` : '尚未取得股利分派資料。'
    },
    {
      title: '營收動能',
      status: revenueTrend?.available || revenue ? '已取得' : '待補',
      body: revenueTrend?.available
        ? `最新月 ${revenueTrend.latestMonth || '--'}，YoY ${formatPercent(revenueTrend.latestYoy)}，MoM ${formatPercent(revenueTrend.latestMom)}，近 3 月平均 YoY ${formatPercent(revenueTrend.avg3Yoy)}，連續正成長 ${revenueTrend.positiveStreak} 個月。`
        : revenue ? `最新月營收 YoY ${formatPercent(parseNumber(read(revenue, ['營業收入-去年同月增減(%)'])))}，MoM ${formatPercent(parseNumber(read(revenue, ['營業收入-上月比較增減(%)'])))}。` : '尚未取得月營收資料。'
    }
  ];
}

function macroStatus(macro) {
  if (macro?.exchangeRate && macro?.market) return '已取得';
  if (macro?.exchangeRate || macro?.market) return '部分';
  return '待接';
}

function buildMacroBody(macro) {
  if (!macro?.exchangeRate && !macro?.market) {
    return '匯率與市場資金環境尚未取得；目前先以公司財務、估值與現金流資料判斷體質。';
  }

  const parts = [];
  if (macro.exchangeRate) {
    const rate = macro.exchangeRate;
    parts.push(
      `美元兌台幣即期中價 ${formatPlain(rate.spotMid, 4)}，日變動 ${formatSignedPlain(rate.change, 4)}（${formatSignedPercent(rate.changePct)}），日期 ${rate.date}`
    );
  }

  if (macro.market) {
    parts.push(
      `加權指數 ${formatPlain(macro.market.taiex, 2)}，漲跌幅 ${formatSignedPercent(macro.market.changePct)}，可作為目前台股資金風險偏好的參考`
    );
  }

  parts.push(`景氣燈號與政策利率仍需下一階段接國發會與央行資料；${MACRO_SOURCE_NOTE}。`);
  return `${parts.join('；')}。`;
}

function buildAiConclusion(stock, metrics, score, macro) {
  const points = [];
  points.push(`${stock.code} ${stock.name || ''} 基本面資料已接入 TWSE OpenAPI，完整度可支撐第一階段長期投資檢核。`);
  points.push(`目前基本面評分為 ${score} 分；EPS ${formatPlain(metrics.eps, 2)}，年化 ROE ${formatPercent(metrics.roeAnnualized)}，負債比 ${formatPercent(metrics.debtRatio)}。`);
  points.push(`獲利能力方面，毛利率 ${formatPercent(metrics.grossMargin)}、營業利益率 ${formatPercent(metrics.operatingMargin)}，可用來判斷本業品質。`);
  points.push(`估值方面，本益比 ${formatPlain(metrics.pe, 2)}、PB ${formatPlain(metrics.pb, 2)}、殖利率 ${formatPercent(metrics.dividendYield)}，需與同業和歷史區間比較。`);
  points.push(`現金流方面，營業現金流 ${formatMillion(metrics.operatingCashFlow)}，自由現金流 ${formatMillion(metrics.freeCashFlow)}；若長期維持為正，代表獲利轉現能力較佳。`);
  if (macro?.exchangeRate || macro?.market) points.push(`總體環境方面，${buildMacroBody(macro)}`);
  return points;
}

function buildVerdict(stock, metrics, score) {
  if (score >= 80) return `${stock.code} ${stock.name} 財務體質初步良好，獲利能力與負債結構具備長期觀察價值，但仍需補現金流確認獲利品質。`;
  if (score >= 60) return `${stock.code} ${stock.name} 基本面初步中性偏穩，建議進一步比較同業估值與營收成長延續性。`;
  return `${stock.code} ${stock.name} 基本面分數偏保守，需留意獲利、負債、估值或營收動能是否存在弱點。`;
}

function buildScoreModel(metrics, { marginTrading } = {}) {
  const items = [
    scoreItem('獲利品質', scoreRange(metrics.roeAnnualized, [5, 10, 15], [4, 10, 18, 25]), 25, `ROE ${formatPercent(metrics.roeAnnualized)}，營益率 ${formatPercent(metrics.operatingMargin)}`),
    scoreItem('成長動能', scoreRange(metrics.avg3RevenueYoy || metrics.monthlyRevenueYoy, [-5, 0, 10], [0, 5, 10, 15]), 15, `近 3 月營收 YoY ${formatPercent(metrics.avg3RevenueYoy || metrics.monthlyRevenueYoy)}`),
    scoreItem('現金流品質', scoreCashFlowQuality(metrics), 15, `營業現金流 ${formatMillion(metrics.operatingCashFlow)}，自由現金流 ${formatMillion(metrics.freeCashFlow)}`),
    scoreItem('估值水位', scoreValuation(metrics), 15, `PE ${formatPlain(metrics.pe, 2)}，歷史百分位 ${Number.isFinite(metrics.valuationPePercentile) ? `${formatPlain(metrics.valuationPePercentile, 0)}%` : '--'}`),
    scoreItem('財務安全', scoreFinancialSafety(metrics), 15, `負債比 ${formatPercent(metrics.debtRatio)}，董監質押 ${formatPercent(metrics.directorPledgeRatio, true)}`),
    scoreItem('股利穩定', scoreDividend(metrics), 10, `連續配息 ${metrics.dividendConsecutiveYears || 0} 年，現金股利 ${formatPlain(metrics.cashDividend, 2)} 元`),
    scoreItem('信用籌碼', scoreMarginTone(marginTrading), 5, marginTrading?.label ? `${marginTrading.label}，近 5 日融資 ${formatSignedPlain(marginTrading.margin5Change, 0)} 張` : '融資融券待資料')
  ];
  const total = Math.round(items.reduce((sum, item) => sum + item.score, 0));
  return {
    total,
    label: scoreLabel(total),
    items
  };
}

function scoreItem(label, score, max, detail) {
  const normalized = Math.max(0, Math.min(max, Math.round(Number(score || 0))));
  return {
    label,
    score: normalized,
    max,
    pct: max ? Math.round((normalized / max) * 100) : 0,
    status: normalized / max >= 0.75 ? 'good' : normalized / max >= 0.5 ? 'watch' : normalized / max >= 0.25 ? 'neutral' : 'risk',
    detail
  };
}

function scoreCashFlowQuality(metrics) {
  if (metrics.operatingCashFlow > 0 && metrics.freeCashFlow > 0) return 15;
  if (metrics.operatingCashFlow > 0) return 9;
  if (metrics.freeCashFlow > 0) return 5;
  return 0;
}

function scoreValuation(metrics) {
  if (Number.isFinite(metrics.valuationPePercentile)) {
    const percentile = Number(metrics.valuationPePercentile);
    if (percentile <= 25) return 15;
    if (percentile <= 50) return 11;
    if (percentile <= 70) return 7;
    if (percentile <= 85) return 4;
    return 1;
  }
  return scorePe(metrics.pe, 15);
}

function scoreFinancialSafety(metrics) {
  return scoreDebt(metrics.debtRatio, 10) + scoreDebt(metrics.directorPledgeRatio, 5);
}

function scoreDividend(metrics) {
  const years = Number(metrics.dividendConsecutiveYears || 0);
  if (years >= 5) return 10;
  if (years >= 3) return 7;
  if (years > 0) return 4;
  return 0;
}

function scoreMarginTone(marginTrading) {
  if (!marginTrading) return 2;
  if (marginTrading.tone === 'good') return 5;
  if (marginTrading.tone === 'neutral') return 3;
  if (marginTrading.tone === 'watch') return 2;
  return 0;
}

function scoreLabel(score) {
  if (score >= 80) return '體質良好';
  if (score >= 60) return '中性偏穩';
  return '需謹慎檢查';
}

function dataCompleteness(values) {
  const checks = [
    values.valuation,
    values.revenue,
    values.eps,
    values.company,
    values.dividend,
    values.chairman,
    values.directorSummary.count > 0,
    values.income,
    values.balance,
    values.cashFlow,
    values.revenueTrend,
    values.valuationHistory,
    values.dividendStability,
    values.marginTrading,
    values.macro?.exchangeRate || values.macro?.market
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function findByCode(rows, code, extraKeys = []) {
  return rows.find(row => codeOf(row, extraKeys) === code) || null;
}

function codeOf(row, extraKeys = []) {
  return String(read(row, [...extraKeys, '公司代號', 'Code', 'SecuritiesCompanyCode', '股票代號', '證券代號']) || '').trim();
}

function read(row, keys) {
  if (!row) return '';
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return '';
}

function normalizeIndustryKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/產業|業/g, '')
    .trim();
}

function parseNumber(value) {
  const normalized = String(value ?? '').replace(/,/g, '').replace(/%/g, '').trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function toThousandUnit(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number / 1000 : 0;
}

function ratio(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  return bottom ? Number(((top / bottom) * 100).toFixed(2)) : 0;
}

function summarizeDirectors(rows) {
  const holding = rows.reduce((sum, row) => sum + parseNumber(read(row, ['目前持股'])), 0);
  const pledge = rows.reduce((sum, row) => sum + parseNumber(read(row, ['設質股數'])), 0);
  return {
    count: rows.length,
    holding,
    pledge,
    pledgeRatio: holding ? Number(((pledge / holding) * 100).toFixed(2)) : 0
  };
}

function statusByNumber(value, thresholds) {
  const number = Number(value || 0);
  if (!number) return 'pending';
  if (number >= thresholds[2]) return 'good';
  if (number >= thresholds[1]) return 'watch';
  if (number >= thresholds[0]) return 'neutral';
  return 'risk';
}

function statusByDebt(value, allowZero = false) {
  const number = Number(value || 0);
  if (!number && !allowZero) return 'pending';
  if (number <= 35) return 'good';
  if (number <= 55) return 'watch';
  if (number <= 70) return 'neutral';
  return 'risk';
}

function statusByPe(value) {
  const number = Number(value || 0);
  if (!number) return 'pending';
  if (number <= 20) return 'good';
  if (number <= 35) return 'watch';
  if (number <= 50) return 'neutral';
  return 'risk';
}

function statusByPercentile(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'pending';
  if (number >= 80) return 'risk';
  if (number >= 60) return 'watch';
  if (number <= 25) return 'good';
  return 'neutral';
}

function statusByDividendStability(value) {
  const number = Number(value || 0);
  if (!number) return 'pending';
  if (number >= 5) return 'good';
  if (number >= 3) return 'watch';
  return 'neutral';
}

function statusByCashFlow(value) {
  const number = Number(value || 0);
  if (!number) return 'pending';
  return number > 0 ? 'good' : 'risk';
}

function scoreRange(value, thresholds, points) {
  const number = Number(value || 0);
  if (!number) return 0;
  if (number >= thresholds[2]) return points[3];
  if (number >= thresholds[1]) return points[2];
  if (number >= thresholds[0]) return points[1];
  return points[0];
}

function scoreDebt(value, max) {
  const number = Number(value || 0);
  if (!number) return 0;
  if (number <= 35) return max;
  if (number <= 55) return Math.round(max * 0.7);
  if (number <= 70) return Math.round(max * 0.4);
  return Math.round(max * 0.15);
}

function scorePe(value, max) {
  const number = Number(value || 0);
  if (!number) return 0;
  if (number <= 20) return max;
  if (number <= 35) return Math.round(max * 0.75);
  if (number <= 50) return Math.round(max * 0.45);
  return Math.round(max * 0.2);
}

function formatPlain(value, digits = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) return '--';
  return number.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatPercent(value, allowZero = false) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || (number === 0 && !allowZero)) return '--';
  return `${number.toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

function formatSignedPlain(value, digits = 2) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '--';
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toLocaleString('zh-TW', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

function formatSignedPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '--';
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

function formatMillion(value) {
  const number = Number(value || 0);
  if (!number) return '--';
  return `${formatPlain(number / 1000, 0)} 百萬`;
}

function formatRocDate(value) {
  const text = String(value || '').replace(/\D/g, '');
  if (text.length !== 7) return '';
  const year = Number(text.slice(0, 3)) + 1911;
  return `${year}/${text.slice(3, 5)}/${text.slice(5, 7)}`;
}

function formatCompactDate(value) {
  const text = String(value || '').replace(/\D/g, '');
  if (text.length !== 8) return '';
  return `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
}

function formatYearMonth(value) {
  const text = String(value || '').replace(/\D/g, '');
  if (text.length !== 5) return '';
  const year = Number(text.slice(0, 3)) + 1911;
  return `${year}/${text.slice(3, 5)}`;
}

function financialPeriod(row) {
  if (!row) return '';
  const year = Number(read(row, ['年度', 'Year']) || 0) + 1911;
  const quarter = read(row, ['季別', 'Season']);
  return year && quarter ? `${year} Q${quarter}` : '';
}

function buildPeriod(income, balance, revenue, cashFlow) {
  return {
    financial: financialPeriod(income || balance),
    revenue: formatYearMonth(read(revenue, ['資料年月'])),
    cashFlow: cashFlow?.date || ''
  };
}
