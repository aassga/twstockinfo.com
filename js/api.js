// js/api.js — GitHub Pages 版（透過 Cloudflare Worker）

const API_KEY_STORAGE = 'tw_stock_api_key';

// ── API Key 管理 ──────────────────────────────
function getApiKey()  { return localStorage.getItem(API_KEY_STORAGE) || ''; }

function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key.startsWith('sk-ant-')) {
    showApiStatus('格式錯誤，請輸入正確的 Anthropic API Key (sk-ant-...)', true);
    return;
  }
  localStorage.setItem(API_KEY_STORAGE, key);
  showApiStatus('✓ API Key 儲存成功，AI 分析功能已啟用', false);
  setTimeout(() => toggleSettings(), 1200);
}

function showApiStatus(msg, isError) {
  const el = document.getElementById('apiStatus');
  el.textContent = msg;
  el.className = 'settings-status' + (isError ? ' error' : '');
}

function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const key = getApiKey();
    if (key) document.getElementById('apiKeyInput').value = key;
  }
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
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── TWSE API wrappers ─────────────────────────
const TWSE = {
  market:        () => apiFetch('/twse/exchangeReport/MI_INDEX').then(parseMarket),
  allStocks:     () => apiFetch('/twse/exchangeReport/STOCK_DAY_ALL').then(parseAllStocks),
  quote:      code => apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw&json=1&delay=0&_=${Date.now()}`).then(d => parseQuote(d, code)),
  quoteOtc:   code => apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=otc_${code}.tw&json=1&delay=0&_=${Date.now()}`).then(d => parseQuote(d, code)),
  institutional: () => apiFetch('/twse/fund/T86').then(parseInst),
  instSummary:   () => apiFetch('/twse/fund/BFI82U').then(parseInstSummary),
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
    if (d.msgArray && d.msgArray.length) return parseQuote(d, code);
  } catch(e) {}
  const d2 = await apiFetch(`/mis/stock/api/getStockInfo.jsp?ex_ch=otc_${code}.tw&json=1&delay=0&_=${Date.now()}`);
  return parseQuote(d2, code);
}

function parseQuote(data, code) {
  const arr = data.msgArray || [];
  if (!arr.length) throw new Error('找不到股票: ' + code);
  const s    = arr[0];
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

function parseInst(data) {
  const result = [];
  for (const d of data.slice(0, 80)) {
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
  const toB = (d, key = '買賣差額') => {
    try { return parseFloat((String(d[key] || '0').replace(/,/g, '')) || '0') / 1e8; } catch(e) { return 0; }
  };
  const foreign = data.find(d => /外資|外陸/.test(String(d['單位名稱'] || '')));
  const trust   = data.find(d => /投信/.test(String(d['單位名稱'] || '')));
  const dealer  = data.find(d => /自營商/.test(String(d['單位名稱'] || '')) && !/自行/.test(String(d['單位名稱'] || '')));
  return {
    foreign: parseFloat((toB(foreign || {})).toFixed(2)),
    trust:   parseFloat((toB(trust   || {})).toFixed(2)),
    dealer:  parseFloat((toB(dealer  || {})).toFixed(2)),
  };
}

// ── Claude AI ─────────────────────────────────
async function callClaude(prompt, system = '') {
  const key = getApiKey();
  if (!key) return '⚠️ 尚未設定 API Key。請點擊右上角 ⚙️ 齒輪圖示輸入 Anthropic API Key。';
  const proxy = getProxy();
  const body  = { model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] };
  if (system) body.system = system;

  const r = await fetch(`${proxy}/claude`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
    body:    JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401) return '❌ API Key 無效或已過期，請重新設定。';
    if (r.status === 429) return '⏳ 請求過於頻繁，請稍後再試。';
    return `❌ 錯誤：${data.error || '未知錯誤'}`;
  }
  return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '無回應';
}

async function runAI({ spinnerId, contentId, resultBoxId = null, prompt, system = '' }) {
  const spinner = document.getElementById(spinnerId);
  const content = document.getElementById(contentId);
  if (resultBoxId) document.getElementById(resultBoxId).style.display = 'block';
  spinner.style.display = 'inline-block';
  content.innerHTML = '<span class="hint">AI 分析中，請稍候...</span>';
  try {
    const result = await callClaude(prompt, system);
    content.innerHTML = escHtml(result).replace(/\n/g, '<br>');
  } catch(e) {
    content.innerHTML = `❌ 連線失敗：${e.message}`;
  } finally {
    spinner.style.display = 'none';
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// quote with auto fallback
TWSE.quoteAuto = parseQuoteAuto;
