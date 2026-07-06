const BUY_SIGNAL_THRESHOLD = 70;
const SELL_SIGNAL_THRESHOLD = 65;

export function getBuySignals(stocks = []) {
  return stocks
    .filter(stock => isReliableForce(stock) && stock.buyPct >= BUY_SIGNAL_THRESHOLD)
    .sort((a, b) => Number(b.buyPct || 0) - Number(a.buyPct || 0))
    .slice(0, 12)
    .map(stock => ({
      ...stock,
      reason: `買入佔比 ${Math.round(stock.buyPct)}%，來源：${stock.forceSourceLabel || 'TWSE MIS'}`
    }));
}

export function getSellSignals(stocks = []) {
  return stocks
    .filter(stock => isReliableForce(stock) && stock.sellPct >= SELL_SIGNAL_THRESHOLD)
    .sort((a, b) => Number(b.sellPct || 0) - Number(a.sellPct || 0))
    .slice(0, 12)
    .map(stock => ({
      ...stock,
      reason: `賣出佔比 ${Math.round(stock.sellPct)}%，來源：${stock.forceSourceLabel || 'TWSE MIS'}`
    }));
}

function isReliableForce(stock) {
  return stock?.forceReliable === true && String(stock?.forceSource || '') === 'twse-mis-book';
}

export function buildMarketAnalysis({ market, marketStats, hotStocks, portfolioSummary, institutionalTotal }) {
  const upRatio = Number(marketStats?.upRatio || 0);
  const indexChange = Number(market?.changePct || 0);
  const topStrong = hotStocks?.filter(stock => stock.chgPct > 1).slice(0, 5) || [];
  const topWeak = hotStocks?.filter(stock => stock.chgPct < -1).slice(0, 5) || [];
  const portfolioReturn = Number(portfolioSummary?.returnPct || 0);

  const direction = indexChange > 0.4 && upRatio >= 55
    ? '盤勢偏多，短線資金仍在風險資產內輪動。'
    : indexChange < -0.4 && upRatio < 45
      ? '盤勢偏弱，建議提高現金水位並避免追高。'
      : '盤勢偏整理，操作上適合縮小部位並等待量價確認。';

  const institution = institutionalTotal > 20
    ? '法人合計買超偏正向，可優先觀察買超是否延續。'
    : institutionalTotal < -20
      ? '法人合計賣超偏保守，強勢股也需要留意回檔風險。'
      : '法人籌碼方向不明顯，短線仍以價格與量能為主要依據。';

  const portfolio = portfolioReturn > 5
    ? '持股已有明顯獲利，適合檢查停利與移動停損。'
    : portfolioReturn < -5
      ? '持股承壓，建議重新檢查買進理由與風險上限。'
      : '持股損益接近中性，重點在汰弱留強。';

  return [
    direction,
    institution,
    portfolio,
    topStrong.length ? `強勢觀察：${topStrong.map(stock => `${stock.name}(${stock.code})`).join('、')}。` : '目前強勢股訊號不多。',
    topWeak.length ? `弱勢留意：${topWeak.map(stock => `${stock.name}(${stock.code})`).join('、')}。` : '目前弱勢股壓力有限。',
    '以上為本機規則分析，不構成投資建議。'
  ];
}
