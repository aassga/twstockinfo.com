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
  const [incomeRows, balanceRows, cashFlowRows, macro] = await Promise.all([
    fetchFirstRowsContainingCode(endpoints.income, code),
    fetchFirstRowsContainingCode(endpoints.balance, code),
    fetchCashFlowRows(code),
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
  const [incomeRows, balanceRows, cashFlowRows] = await Promise.all([
    fetchFirstRowsContainingCode(endpoints.income, code),
    fetchFirstRowsContainingCode(endpoints.balance, code),
    fetchCashFlowRows(code)
  ]);
  Object.assign(rows, { incomeRows, balanceRows, cashFlowRows });
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
  const directorSummary = summarizeDirectors((rows.directorRows || []).filter(row => codeOf(row) === code));
  const mergedCompany = mergeCompany(normalized, company, revenue, eps);
  const calculated = calculateMetrics({ stock: mergedCompany, valuation, revenue, eps, income, balance, dividend, directorSummary, cashFlow });
  const metrics = buildMetricRows(calculated);
  const score = calculateScore(calculated);
  const stage = rows.stage || 'complete';

  return {
    updatedAt: new Date().toISOString(),
    loadingStage: stage,
    isPartial: stage !== 'complete',
    company: mergedCompany,
    period: buildPeriod(income, balance, revenue, cashFlow),
    source: 'TWSE/TPEX OpenAPI + FinMind',
    score,
    scoreLabel: stage === 'quote' ? '載入中' : scoreLabel(score),
    dataCompleteness: dataCompleteness({ valuation, revenue, eps, company, dividend, chairman, directorSummary, income, balance, cashFlow, macro: rows.macro }),
    verdict: stage === 'quote'
      ? `${mergedCompany.code} ${mergedCompany.name || ''} 即時報價已載入，正在取得估值、營收與財報資料。`
      : buildVerdict(mergedCompany, calculated, score),
    highlights: buildHighlights(mergedCompany, calculated),
    metrics,
    statements: buildStatementSections({ income, balance, cashFlow, calculated }),
    qualitative: buildQualitativeRows(mergedCompany, { chairman, directorSummary, revenue, dividend, macro: rows.macro }),
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

function calculateMetrics({ stock, valuation, revenue, eps, income, balance, dividend, directorSummary, cashFlow }) {
  const operatingRevenue = parseNumber(read(income, ['營業收入'])) || parseNumber(read(eps, ['營業收入']));
  const grossProfit = parseNumber(read(income, ['營業毛利（毛損）淨額', '營業毛利（毛損）']));
  const operatingIncome = parseNumber(read(income, ['營業利益（損失)'])) || parseNumber(read(income, ['營業利益（損失）'])) || parseNumber(read(eps, ['營業利益']));
  const netIncome = parseNumber(read(income, ['淨利（淨損）歸屬於母公司業主'])) || parseNumber(read(income, ['本期淨利（淨損）'])) || parseNumber(read(eps, ['稅後淨利']));
  const totalAssets = parseNumber(read(balance, ['資產總額', '資產總計']));
  const totalLiabilities = parseNumber(read(balance, ['負債總額', '負債總計']));
  const totalEquity = parseNumber(read(balance, ['歸屬於母公司業主之權益合計', '權益總額', '權益總計']));
  const epsValue = parseNumber(read(eps, ['基本每股盈餘(元)'])) || parseNumber(read(income, ['基本每股盈餘（元）']));
  const cashDividend = parseNumber(read(dividend, ['股東配發-盈餘分配之現金股利(元/股)']));
  const officialPe = parseNumber(read(valuation, ['PEratio', 'PriceEarningRatio']));
  const estimatedPe = !officialPe && epsValue > 0 && Number(stock?.price || 0) > 0
    ? Number((Number(stock.price) / epsValue).toFixed(2))
    : 0;

  return {
    pe: officialPe || estimatedPe,
    peSource: officialPe ? 'official' : estimatedPe ? 'estimated' : '',
    pb: parseNumber(read(valuation, ['PBratio', 'PriceBookRatio'])),
    dividendYield: parseNumber(read(valuation, ['DividendYield', 'YieldRatio'])),
    eps: epsValue,
    cashDividend: cashDividend || parseNumber(read(valuation, ['DividendPerShare'])),
    monthlyRevenue: parseNumber(read(revenue, ['營業收入-當月營收'])),
    monthlyRevenueMom: parseNumber(read(revenue, ['營業收入-上月比較增減(%)'])),
    monthlyRevenueYoy: parseNumber(read(revenue, ['營業收入-去年同月增減(%)'])),
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
      revenue: formatYearMonth(read(revenue, ['資料年月'])),
      financial: financialPeriod(income || balance),
      cashFlow: cashFlow?.date || '',
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
    metric('本益比', formatPlain(metrics.pe, 2), statusByPe(metrics.pe), '估值水位', '需與歷史區間、同業與成長率一起比較。'),
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

function buildQualitativeRows(stock, { chairman, directorSummary, revenue, dividend, macro }) {
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
      status: dividend ? '已取得' : '待補',
      body: dividend ? `最新股利年度 ${read(dividend, ['股利年度']) || '--'}，現金股利 ${formatPlain(parseNumber(read(dividend, ['股東配發-盈餘分配之現金股利(元/股)', '股東配發內容-盈餘分配之現金股利(元/股)'])), 2)} 元/股。` : '尚未取得股利分派資料。'
    },
    {
      title: '營收動能',
      status: revenue ? '已取得' : '待補',
      body: revenue ? `最新月營收 YoY ${formatPercent(parseNumber(read(revenue, ['營業收入-去年同月增減(%)'])))}，MoM ${formatPercent(parseNumber(read(revenue, ['營業收入-上月比較增減(%)'])))}。` : '尚未取得月營收資料。'
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

function calculateScore(metrics) {
  const pieces = [
    scoreRange(metrics.roeAnnualized, [5, 10, 15], [4, 8, 14, 20]),
    scoreRange(metrics.grossMargin, [10, 20, 35], [3, 7, 11, 15]),
    scoreRange(metrics.operatingMargin, [5, 10, 20], [3, 7, 11, 15]),
    scoreDebt(metrics.debtRatio, 15),
    scoreRange(metrics.eps, [0, 3, 8], [0, 5, 8, 10]),
    scoreRange(metrics.monthlyRevenueYoy, [-5, 0, 10], [0, 4, 7, 10]),
    scorePe(metrics.pe, 10),
    scoreDebt(metrics.directorPledgeRatio, 5)
  ];
  return Math.round(pieces.reduce((sum, value) => sum + value, 0));
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
