export function getBuySignals(stocks = []) {
  return stocks
    .filter(stock => stock.chgPct > 1.2 && stock.buyPct >= 58)
    .slice(0, 12)
    .map(stock => ({
      ...stock,
      reason: `漲幅 ${stock.chgPct.toFixed(2)}%，買盤 ${Math.round(stock.buyPct)}%`
    }));
}

export function getSellSignals(stocks = []) {
  return stocks
    .filter(stock => stock.chgPct < -1.2 || stock.sellPct >= 62)
    .slice(0, 12)
    .map(stock => ({
      ...stock,
      reason: `跌幅 ${stock.chgPct.toFixed(2)}%，賣盤 ${Math.round(stock.sellPct)}%`
    }));
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
