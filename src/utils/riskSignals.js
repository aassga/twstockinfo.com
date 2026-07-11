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
    sellPressureRisk(current),
    peRisk(fundamental),
    movingAverageRisk(technical, 'ma20'),
    movingAverageRisk(technical, 'ma60'),
    volumeRisk(current, technical),
    revenueRisk(fundamental),
    grossMarginRisk(fundamental),
    institutionalSellRisk(institutional, institutionalTrend),
    marginRisk(fundamental),
    marginUsageRisk(fundamental),
    attentionDispositionRisk(fundamental),
    cashFlowRisk(fundamental)
  ];
}

function sellPressureRisk(current) {
  const sellPct = numberOrNull(current?.sellPct);
  const reliable = Boolean(current?.tradeFlow?.reliable);
  if (!isValid(sellPct)) return pending('賣壓 / 內盤', '待查', '尚未取得買賣力道');

  return {
    label: reliable ? '內盤偏高' : '賣壓偏高',
    value: `${formatNumber(sellPct, 0)}%`,
    detail: reliable ? '以 MIS 快照重建內外盤判斷' : '目前仍屬五檔委託量推估',
    status: sellPct >= 70 ? 'risk' : sellPct >= 60 ? 'watch' : 'good'
  };
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
  const negativeStreak = countNegativeStreak((trend?.rows || []).map(row => numberOrNull(row.yoy)).reverse());
  return {
    label: '營收連續衰退',
    value: negativeStreak > 0 ? `連 ${negativeStreak} 月` : formatPct(yoy),
    detail: isValid(avg3) ? `最新 YoY ${formatPct(yoy)}，近 3 月平均 ${formatPct(avg3)}` : '以最新月營收 YoY 判斷',
    status: negativeStreak >= 3 || yoy <= -10 || (isValid(avg3) && avg3 < -5) ? 'risk' : negativeStreak >= 1 || yoy < 0 ? 'watch' : 'good'
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
  const declineStreak = countConsecutiveDeclines(rows.map(row => numberOrNull(row.grossMargin)));
  return {
    label: '毛利率連續下降',
    value: `${formatNumber(latestMargin, 2)}%`,
    detail: isValid(diff) ? `較上期 ${formatSigned(diff, 2, ' 個百分點')}；連續下降 ${declineStreak} 期` : '以最新季度毛利率判斷',
    status: declineStreak >= 3 || (isValid(diff) && diff <= -3) ? 'risk' : declineStreak >= 1 || (isValid(diff) && diff < 0) ? 'watch' : 'good'
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

function marginUsageRisk(fundamental) {
  const margin = fundamental?.marginTrading;
  if (!margin?.available) return pending('融資使用率異常', '待查', '尚未取得融資餘額');

  const usage = numberOrNull(margin.marginUsageRatio);
  if (isValid(usage)) {
    return {
      label: '融資使用率異常',
      value: `${formatNumber(usage, 2)}%`,
      detail: '以融資餘額 / 可融資額度或流通股數判斷',
      status: usage >= 45 ? 'risk' : usage >= 30 ? 'watch' : 'good'
    };
  }

  const balance = numberOrNull(margin.marginBalance);
  const change5 = numberOrNull(margin.margin5Change);
  const pressure = isValid(balance) && balance > 0 && isValid(change5)
    ? (change5 / balance) * 100
    : null;
  if (!isValid(pressure)) return pending('融資使用率異常', '待查', '缺流通股數，暫無法計算正式使用率');

  return {
    label: '融資使用率異常',
    value: `${formatSigned(pressure, 2, '%')}`,
    detail: `尚未接流通股數，先以近 5 日融資增幅 / 餘額替代；餘額 ${formatNumber(balance, 0)} 張`,
    status: pressure >= 12 ? 'risk' : pressure >= 6 ? 'watch' : 'good'
  };
}

function movingAverageRisk(technical, key) {
  const label = key === 'ma60' ? '跌破 MA60' : '跌破 MA20';
  const lineLabel = key === 'ma60' ? 'MA60' : 'MA20';
  const lineValue = numberOrNull(technical?.[key]);
  const latestClose = numberOrNull(technical?.latestClose);
  if (!isValid(latestClose) || !isValid(lineValue)) return pending(label, '待查', `${lineLabel} 資料不足`);

  const distance = ((latestClose - lineValue) / lineValue) * 100;
  return {
    label,
    value: latestClose < lineValue ? '跌破' : '站上',
    detail: `${lineLabel} ${formatNumber(lineValue, 2)}，乖離 ${formatSigned(distance, 2, '%')}`,
    status: distance < -2 ? 'risk' : distance < 0 ? 'watch' : 'good'
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

function attentionDispositionRisk(fundamental) {
  const events = Array.isArray(fundamental?.attentionEvents) ? fundamental.attentionEvents : [];
  const disposition = events.find(row => row?.type === 'disposition');
  const attention = events.find(row => row?.type === 'attention');
  if (!events.length) {
    return {
      label: '注意 / 處置股',
      value: '無',
      detail: '近期未取得注意或處置公告',
      status: 'good'
    };
  }

  const latest = disposition || attention || events[0];
  return {
    label: '注意 / 處置股',
    value: disposition ? '處置' : '注意',
    detail: `${latest.date || '--'} ${latest.title || latest.detail || '有公告'}`,
    status: disposition ? 'risk' : 'watch'
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

function countConsecutiveDeclines(values) {
  const normalized = (Array.isArray(values) ? values : []).filter(isValid);
  let streak = 0;
  for (let index = normalized.length - 1; index > 0; index -= 1) {
    if (normalized[index] < normalized[index - 1]) streak += 1;
    else break;
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
