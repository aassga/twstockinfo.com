import { buildTechnicalSummary } from './technicalAnalysis';
import { formatNumber, formatPct, formatSigned } from './formatters';

export function buildStockRiskChecks({
  current = null,
  fundamental = null,
  institutional = null,
  institutionalTrend = [],
  candles = [],
  interval = 'D'
} = {}) {
  if (!current) return [];

  const technical = buildTechnicalSummary(candles, { interval });

  return [
    peRisk(fundamental),
    revenueRisk(fundamental),
    grossMarginRisk(fundamental),
    institutionalSellRisk(institutional, institutionalTrend),
    marginRisk(fundamental),
    monthlyLineRisk(technical),
    volumeRisk(current, technical),
    cashFlowRisk(fundamental)
  ];
}

function peRisk(fundamental) {
  const pe = numberFromMetric(fundamental, ['本益比']);
  if (!isValid(pe) || pe <= 0) {
    return pending('本益比過高', '待查', '尚未取得估值資料');
  }

  return {
    label: '本益比過高',
    value: `${formatNumber(pe, 2)} 倍`,
    detail: pe >= 40 ? '估值偏高，需確認成長是否支撐' : pe >= 25 ? '估值不低，建議與同業比較' : '估值暫未過熱',
    status: pe >= 40 ? 'risk' : pe >= 25 ? 'watch' : 'good'
  };
}

function revenueRisk(fundamental) {
  const trend = fundamental?.revenueTrend;
  const yoy = numberOrNull(trend?.latestYoy);
  if (!isValid(yoy)) return pending('營收衰退', '待查', '尚未取得月營收 YoY');

  const avg3 = numberOrNull(trend?.avg3Yoy);
  return {
    label: '營收衰退',
    value: formatPct(yoy),
    detail: isValid(avg3) ? `近 3 月平均 ${formatPct(avg3)}` : '以最新月營收 YoY 判斷',
    status: yoy <= -10 || (isValid(avg3) && avg3 < -5) ? 'risk' : yoy < 0 ? 'watch' : 'good'
  };
}

function grossMarginRisk(fundamental) {
  const rows = fundamental?.financialTrends?.rows || [];
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const latestMargin = numberOrNull(latest?.grossMargin);
  const previousMargin = numberOrNull(previous?.grossMargin);
  if (!isValid(latestMargin)) return pending('毛利率下降', '待查', '尚未取得財報毛利率');

  const diff = isValid(previousMargin) ? latestMargin - previousMargin : null;
  return {
    label: '毛利率下降',
    value: `${formatNumber(latestMargin, 2)}%`,
    detail: isValid(diff) ? `較上期 ${formatSigned(diff, 2, ' 個百分點')}` : '以最新季度毛利率判斷',
    status: isValid(diff) && diff <= -3 ? 'risk' : isValid(diff) && diff < 0 ? 'watch' : 'good'
  };
}

function institutionalSellRisk(institutional, trendRows = []) {
  const rows = Array.isArray(trendRows) ? trendRows : [];
  const streak = countNegativeStreak(rows.map(row => numberOrNull(row.total)));
  const latestTotal = numberOrNull(rows[0]?.total ?? institutional?.total);
  if (!rows.length && !isValid(latestTotal)) return pending('法人連賣', '待查', '尚未取得法人趨勢');

  return {
    label: '法人連賣',
    value: streak > 0 ? `連賣 ${streak} 日` : '未連賣',
    detail: isValid(latestTotal) ? `最新合計 ${formatSigned(latestTotal, 0, ' 張')}` : '以近幾日法人合計判斷',
    status: streak >= 3 ? 'risk' : streak >= 2 || latestTotal < 0 ? 'watch' : 'good'
  };
}

function marginRisk(fundamental) {
  const margin = fundamental?.marginTrading;
  if (!margin?.available) return pending('融資暴增', '待查', '尚未取得融資融券');

  const change5 = numberOrNull(margin.margin5Change);
  const balance = numberOrNull(margin.marginBalance);
  if (!isValid(change5)) return pending('融資暴增', '待查', '融資增減資料不足');

  const ratio = isValid(balance) && balance > 0 ? (change5 / balance) * 100 : null;
  return {
    label: '融資暴增',
    value: formatSigned(change5, 0, ' 張'),
    detail: isValid(ratio) ? `近 5 日約 ${formatSigned(ratio, 2, '%')}，餘額 ${formatNumber(balance, 0)} 張` : '近 5 日融資餘額變化',
    status: change5 > 0 && ((isValid(ratio) && ratio >= 10) || change5 >= 3000) ? 'risk' : change5 > 0 ? 'watch' : 'good'
  };
}

function monthlyLineRisk(technical) {
  if (!technical?.latestClose || !technical?.ma20) return pending('跌破月線', '待查', 'MA20 資料不足');

  const distance = ((technical.latestClose - technical.ma20) / technical.ma20) * 100;
  return {
    label: '跌破月線',
    value: technical.latestClose < technical.ma20 ? '跌破' : '站上',
    detail: `MA20 ${formatNumber(technical.ma20, 2)}，乖離 ${formatSigned(distance, 2, '%')}`,
    status: distance < 0 ? 'risk' : distance < 2 ? 'watch' : 'good'
  };
}

function volumeRisk(current, technical) {
  const ratio = numberOrNull(technical?.volumeRatio ?? current?.volRatio);
  if (!isValid(ratio) || ratio <= 0) return pending('成交量異常放大', '待查', '量比資料不足');

  return {
    label: '成交量異常放大',
    value: `${formatNumber(ratio, 0)}%`,
    detail: ratio >= 250 ? '量能明顯放大，需留意追價風險' : ratio >= 150 ? '量能高於近期均量' : '量能未明顯異常',
    status: ratio >= 250 ? 'risk' : ratio >= 150 ? 'watch' : 'good'
  };
}

function cashFlowRisk(fundamental) {
  const rows = fundamental?.financialTrends?.rows || [];
  const latest = rows.at(-1);
  const freeCashFlow = numberOrNull(latest?.freeCashFlow ?? numberFromMetric(fundamental, ['自由現金流']));
  if (!isValid(freeCashFlow)) return pending('現金流不佳', '待查', '尚未取得現金流量表');

  const streak = countNegativeStreak(rows.map(row => numberOrNull(row.freeCashFlow)).reverse());
  return {
    label: '現金流不佳',
    value: compactAmount(freeCashFlow),
    detail: streak >= 2 ? `自由現金流連續 ${streak} 期為負` : '以最新自由現金流判斷',
    status: freeCashFlow < 0 && streak >= 2 ? 'risk' : freeCashFlow < 0 ? 'watch' : 'good'
  };
}

function pending(label, value, detail) {
  return { label, value, detail, status: 'pending' };
}

function numberFromMetric(fundamental, labels) {
  const pools = [
    fundamental?.metrics,
    fundamental?.highlights,
    fundamental?.financialTrends?.summary
  ].filter(Array.isArray);

  for (const pool of pools) {
    const item = pool.find(row => labels.some(label => String(row?.label || '').includes(label)));
    const value = numberOrNull(item?.rawValue ?? item?.value);
    if (isValid(value)) return value;
  }
  return null;
}

function countNegativeStreak(values) {
  let streak = 0;
  for (const value of values) {
    if (!isValid(value) || value >= 0) break;
    streak += 1;
  }
  return streak;
}

function compactAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  const abs = Math.abs(number);
  if (abs >= 100000000) return `${formatSigned(number / 100000000, 2, ' 億')}`;
  if (abs >= 1000000) return `${formatSigned(number / 1000000, 0, ' 百萬')}`;
  return formatSigned(number, 0);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function isValid(value) {
  return Number.isFinite(Number(value));
}
