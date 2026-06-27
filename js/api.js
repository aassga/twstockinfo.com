// js/api.js — GitHub Pages 版（透過 Cloudflare Worker）

const API_KEY_STORAGE = 'tw_stock_api_key';

// ── API Key 管理 ──────────────────────────────
function getApiKey() {
  localStorage.removeItem(API_KEY_STORAGE);
  return '';
}

// ── proxy base (from config.js) ───────────────
function getProxy() {
  const base = (typeof CONFIG !== 'undefined' && CONFIG.PROXY_BASE) ? CONFIG.PROXY_BASE : '';
  if (!base || base.includes('yourname')) {
    throw new Error('請先設定 Cloudflare Worker 網址（js/config.js）');
  }
  return base.replace(/\/$/, '');
}

// ── fetch helper ──────────────────────────────
async function apiFetch(path) {
  const proxy = getProxy();
  const r = await fetch(proxy + path);
  if (!r.ok) {
    if (path.startsWith('/yahoo/') && r.status === 404) {
      throw new Error('Worker 尚未部署圖表代理 /yahoo/*，請將新版 worker/twse-proxy.js 部署到 Cloudflare Worker');
    }
    throw new Error(`HTTP ${r.status}`);
  }
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch(e) {
    throw new Error(`回應不是 JSON：${text.slice(0, 80)}`);
  }
}

// ── TWSE API wrappers ─────────────────────────
const TWSE = {
  market:        () => apiFetch('/twse/exchangeReport/MI_INDEX').then(parseMarket),
  allStocks:     () => apiFetch('/twse/exchangeReport/STOCK_DAY_ALL').then(parseAllStocks),
  quote:      code => apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw&json=1&delay=0&_=${Date.now()}`).then(d => parseQuote(d, code)),
  quoteOtc:   code => apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=otc_${code}.tw&json=1&delay=0&_=${Date.now()}`).then(d => parseQuote(d, code)),
  institutional: () => fetchLatestTwseRwd('/rwd/zh/fund/T86', '&selectType=ALLBUT0999').then(parseInst),
  instSummary:   () => fetchLatestTwseRwd('/rwd/zh/fund/BFI82U').then(parseInstSummary),
  chart:      (code, interval = 'D', exchange = '') => fetchYahooChart(code, interval, exchange),
};

// ── Parse helpers ─────────────────────────────
function parseMarket(data) {
  const taiex = data.find(d => d['指數'] && d['指數'].includes('加權'));
  return {
    taiex:     taiex ? taiex['收盤指數']    : '--',
    change:    taiex ? taiex['漲跌點數']    : '0',
    changePct: taiex ? taiex['漲跌百分比'] : '0',
    sign:      taiex ? taiex['漲跌']        : '+',
  };
}

function parseAllStocks(data) {
  const result = [];
  for (const d of data) {
    try {
      const code   = d['Code']   || '';
      const name   = d['Name']   || '';
      const close  = parseFloat((d['ClosingPrice'] || '0').replace(/,/g, '')) || 0;
      const change = parseFloat((d['Change']       || '0').replace(/,/g, '')) || 0;
      const volume = parseInt  ((d['TradeVolume']  || '0').replace(/,/g, '')) || 0;
      if (close <= 0 || !/^\d{4,6}$/.test(code)) continue;
      const prev   = close - change;
      const chgPct = prev !== 0 ? parseFloat((change / prev * 100).toFixed(2)) : 0;
      result.push({ code, name, price: close, change, chgPct, volume });
    } catch(e) {}
  }
  result.sort((a, b) => b.volume - a.volume);
  return result.slice(0, 200);
}

async function parseQuoteAuto(code) {
  // 自動判斷上市/上櫃
  try {
    const d = await apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw&json=1&delay=0&_=${Date.now()}`);
    if (d.msgArray && d.msgArray.length) {
      const quote = parseQuote(d, code);
      if (quote.name) return quote;
    }
  } catch(e) {}
  const d2 = await apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=otc_${code}.tw&json=1&delay=0&_=${Date.now()}`);
  return parseQuote(d2, code);
}

function parseQuote(data, code) {
  const arr = data.msgArray || [];
  if (!arr.length) throw new Error('找不到股票: ' + code);
  const s    = arr[0];
  if (!s.c || !s.n) throw new Error('找不到股票: ' + code);
  const prev = parseFloat(s.y || '0') || 0;
  const raw  = s.z && s.z !== '-' ? s.z : String(prev);
  const close = parseFloat(raw) || prev;
  const chg   = parseFloat((close - prev).toFixed(2));
  const chgP  = prev ? parseFloat((chg / prev * 100).toFixed(2)) : 0;

  const bidVol = (s.g || '').split('_').filter(Boolean).map(Number);
  const askVol = (s.f || '').split('_').filter(Boolean).map(Number);
  const totalB = bidVol.slice(0, 5).reduce((a, b) => a + b, 0) || 1;
  const totalA = askVol.slice(0, 5).reduce((a, b) => a + b, 0) || 1;
  const buyPct = Math.round(totalB / (totalB + totalA) * 100);

  return {
    code:     s.c || code,
    name:     s.n || '',
    exchange: s.ex || '',
    price:    close, prev, change: chg, chgPct: chgP,
    open:     parseFloat(s.o || close) || close,
    high:     parseFloat(s.h || close) || close,
    low:      parseFloat(s.l || close) || close,
    volume:   parseInt((s.v || '0').replace(/,/g, '')) || 0,
    buyPct,   sellPct: 100 - buyPct,
    volRatio: Math.min(100, Math.round(parseInt(s.tv || 0) / Math.max(parseInt((s.v || '1').replace(/,/g, '')), 1) * 100)),
    time:     s.t || '', date: s.d || '',
  };
}

async function fetchYahooChart(code, interval, exchange = '') {
  const market = String(exchange || '').toLowerCase() === 'otc' ? 'TWO' : 'TW';
  try {
    return await fetchYahooChartBySymbol(`${code}.${market}`, interval);
  } catch(e) {
    if (market === 'TW') return fetchYahooChartBySymbol(`${code}.TWO`, interval);
    throw e;
  }
}

async function fetchYahooChartBySymbol(symbol, interval) {
  const params = getYahooChartParams(interval);
  const data = await apiFetch(`/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?range=${params.range}&interval=${params.interval}&includePrePost=false`);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || '無法取得走勢圖資料');

  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const rows = timestamps.map((time, i) => ({
    time: Number(time) * 1000,
    open: Number(quote.open?.[i]),
    high: Number(quote.high?.[i]),
    low: Number(quote.low?.[i]),
    close: Number(quote.close?.[i]),
    volume: Number(quote.volume?.[i] || 0),
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
    currency: result.meta?.currency || 'TWD',
  };
}

function getYahooChartParams(interval) {
  if (interval === '60') return { range: '1mo', interval: '60m' };
  if (interval === '240') return { range: '3mo', interval: '60m' };
  return { range: '1y', interval: '1d' };
}

function aggregateCandles(rows, size) {
  const result = [];
  for (let i = 0; i < rows.length; i += size) {
    const group = rows.slice(i, i + size);
    if (!group.length) continue;
    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(row => row.high)),
      low: Math.min(...group.map(row => row.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, row) => sum + Number(row.volume || 0), 0),
    });
  }
  return result;
}

function parseInst(data) {
  const rows = normalizeTwseRows(data);
  const result = [];
  for (const d of rows.slice(0, 120)) {
    try {
      const toB = v => parseFloat((String(v || '0').replace(/,/g, '').replace('+', '')) || '0') / 1e8;
      const foreign = toB(d['外陸資買賣超股數(不含外資自營商)'] || d['外資買賣超股數']);
      const trust   = toB(d['投信買賣超股數']);
      const dealer  = toB(d['自營商買賣超股數(自行買賣)'] || d['自營商買賣超股數']);
      result.push({
        code:    d['證券代號'] || '',
        name:    d['證券名稱'] || '',
        foreign: parseFloat(foreign.toFixed(2)),
        trust:   parseFloat(trust.toFixed(2)),
        dealer:  parseFloat(dealer.toFixed(2)),
        total:   parseFloat((foreign + trust + dealer).toFixed(2)),
      });
    } catch(e) {}
  }
  result.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return result.slice(0, 30);
}

function parseInstSummary(data) {
  const rows = normalizeTwseRows(data);
  const toB = (d, key = '買賣差額') => {
    try { return parseFloat((String(d[key] || '0').replace(/,/g, '')) || '0') / 1e8; } catch(e) { return 0; }
  };
  const foreign = rows.find(d => /外資|外陸/.test(String(d['單位名稱'] || '')));
  const trust   = rows.find(d => /投信/.test(String(d['單位名稱'] || '')));
  const dealerRows = rows.filter(d => /自營商/.test(String(d['單位名稱'] || '')));
  const dealerTotal = dealerRows.reduce((sum, row) => sum + toB(row), 0);
  return {
    foreign: parseFloat((toB(foreign || {})).toFixed(2)),
    trust:   parseFloat((toB(trust   || {})).toFixed(2)),
    dealer:  parseFloat(dealerTotal.toFixed(2)),
  };
}

async function fetchLatestTwseRwd(path, extraParams = '') {
  const dates = getRecentTaiwanDates(10);
  let lastError = null;

  for (const date of dates) {
    try {
      const data = await apiFetch(`${path}?response=json&date=${date}${extraParams}`);
      if (data?.stat === 'OK' && Array.isArray(data.data) && data.data.length) {
        return data;
      }
      lastError = new Error(data?.stat || '沒有符合條件的資料');
    } catch(e) {
      lastError = e;
    }
  }

  throw lastError || new Error('無法取得 TWSE 資料');
}

function getRecentTaiwanDates(days) {
  const result = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    result.push(`${y}${m}${day}`);
  }
  return result;
}

function normalizeTwseRows(data) {
  if (Array.isArray(data)) return data;
  if (!data || !Array.isArray(data.fields) || !Array.isArray(data.data)) return [];
  return data.data.map(row => Object.fromEntries(data.fields.map((field, i) => [field, row[i]])));
}

// ── Claude AI ─────────────────────────────────
async function callClaude(prompt, system = '') {
  const key = getApiKey();
  let proxy;
  try { proxy = getProxy(); } catch(e) { return '❌ ' + e.message; }
  const body = { model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] };
  if (system) body.system = system;

  let r;
  try {
    r = await fetch(`${proxy}/claude`, {
      method:  'POST',
      headers: key
        ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
        : { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch(netErr) {
    return `❌ 網路錯誤：無法連線到 Worker。請確認 Cloudflare Worker 已正常部署。(${netErr.message})`;
  }
  let data;
  let rawText = '';
  try {
    rawText = await r.text();
    data = rawText ? JSON.parse(rawText) : null;
  } catch(e) {
    return `❌ 回應解析失敗 (HTTP ${r.status})`;
  }
  if (!r.ok) {
    if (r.status === 401) {
      const errMsg = formatErrorDetail(data?.error || data || rawText);
      return `❌ 認證失敗：${errMsg}`;
    }
    if (r.status === 429) return '⏳ 請求過於頻繁，請稍後再試。';
    const errMsg = formatErrorDetail(data?.error || data || rawText);
    return `❌ 錯誤 (${r.status})：${errMsg}`;
  }
  if (data?.error) {
    return `❌ 錯誤：${formatErrorDetail(data.error)}`;
  }
  return data?.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '無回應';
}

async function runAI({ spinnerId, contentId, resultBoxId = null, prompt, system = '', localFallback = null }) {
  const spinner = document.getElementById(spinnerId);
  const content = document.getElementById(contentId);
  if (resultBoxId) document.getElementById(resultBoxId).style.display = 'block';
  spinner.style.display = 'inline-block';
  content.innerHTML = '<span class="hint">AI 分析中，請稍候...</span>';
  try {
    let result = await callClaude(prompt, system);
    if (typeof localFallback === 'function' && shouldUseLocalFallback(result)) {
      result = `${getFallbackNotice(result)}\n\n${localFallback()}`;
    }
    content.innerHTML = escHtml(result).replace(/\n/g, '<br>');
  } catch(e) {
    const msg = e?.message || JSON.stringify(e) || '未知錯誤';
    if (typeof localFallback === 'function') {
      const result = `⚠️ AI 服務暫時無法使用，已改用本地規則分析。\n\n${localFallback()}`;
      content.innerHTML = escHtml(result).replace(/\n/g, '<br>');
    } else {
      content.innerHTML = `❌ 連線失敗：${escHtml(msg)}`;
    }
  } finally {
    spinner.style.display = 'none';
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatErrorDetail(value) {
  if (!value) return '未知錯誤';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  if (Array.isArray(value)) {
    return value.map(formatErrorDetail).filter(Boolean).join('\n') || '未知錯誤';
  }
  if (typeof value === 'object') {
    const parts = [];
    for (const key of ['message', 'detail', 'type', 'code']) {
      if (typeof value[key] === 'string' && value[key]) parts.push(value[key]);
    }
    if (value.error && value.error !== value) parts.push(formatErrorDetail(value.error));
    if (parts.length) return [...new Set(parts)].join(' / ');
    try { return JSON.stringify(value, null, 2); } catch(e) { return String(value); }
  }
  return String(value);
}

function shouldUseLocalFallback(message) {
  const text = String(message || '');
  return /credit balance|Plans & Billing|invalid_request_error|額度不足|尚未設定 API Key|API Key 無效|認證失敗|missing_api_key|無法連線到 Worker|網路錯誤/i.test(text);
}

function getFallbackNotice(message) {
  const text = String(message || '');
  if (/credit balance|Plans & Billing|額度不足/i.test(text)) {
    return '⚠️ Anthropic API 額度不足，已改用本地規則分析。';
  }
  if (/missing_api_key|尚未設定 API Key/i.test(text)) {
    return '⚠️ Cloudflare Worker 尚未讀到 ANTHROPIC_API_KEY Secret，已改用本地規則分析。';
  }
  if (/API Key 無效|認證失敗|401/i.test(text)) {
    return '⚠️ Anthropic API Key 尚未可用，已改用本地規則分析。';
  }
  return '⚠️ AI 服務暫時無法使用，已改用本地規則分析。';
}

// quote with auto fallback
TWSE.quoteAuto = parseQuoteAuto;
