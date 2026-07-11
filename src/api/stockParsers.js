const STOCK_CODE_PATTERN = /^\d{4,6}[A-Z]?$/;

export function parseAllStocks(data) {
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

export function parseOtcStocks(data) {
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
