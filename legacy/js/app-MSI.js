// js/app.js — 真實 API 版主應用邏輯

let currentStock   = null;
let allStocksCache = [];
let instCache      = [];
let portfolioHoldings = [];
let isLoadingAllStocks = false;
let isRefreshingQuote  = false;
let isLoadingInst      = false;
let isRefreshingPortfolio = false;
let chartStock = null;
let chartInterval = 'D';
let chartData = [];
let chartHoverIndex = null;
let holdingCodeLookupTimer = null;
let holdingCodeLookupSeq = 0;

const MARKET_REFRESH_MS      = 30000;
const STOCK_LIST_REFRESH_MS  = 60000;
const ACTIVE_QUOTE_REFRESH_MS = 15000;
const INST_REFRESH_MS        = 180000;
const PORTFOLIO_REFRESH_MS   = 30000;
const PORTFOLIO_STORAGE_KEY  = 'tw_stock_portfolio_holdings';

// ─── 初始化 ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initClock();
  initPortfolio();
  initHot100SortHeaders();
  initStockChartCanvas();
  loadMarket();
  loadAllStocks();   // 先拉全部股票清單
  startAutoRefresh();
});

// ─── 導覽列 ───────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
      // 切換時按需載入
      if (tab === 'portfolio') renderPortfolio();
      if (tab === 'hot100'  && allStocksCache.length) renderHot100(getHot100ViewList());
      if (tab === 'chart') renderStockChartPage();
      if (tab === 'alerts'  && allStocksCache.length) renderAlerts();
      if (tab === 'inst')   loadInstitutional();
      if (tab === 'ai')     refreshAiAnalysis();
    });
  });
}

// ─── 時鐘 ─────────────────────────────────
function initClock() {
  const tick = () => {
    document.getElementById('sidebarTime').textContent =
      new Date().toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  };
  tick(); setInterval(tick, 1000);
}

function startAutoRefresh() {
  setInterval(loadMarket, MARKET_REFRESH_MS);
  setInterval(() => loadAllStocks({ silent: true }), STOCK_LIST_REFRESH_MS);
  setInterval(refreshActiveStockQuote, ACTIVE_QUOTE_REFRESH_MS);
  setInterval(refreshInstitutionalData, INST_REFRESH_MS);
  setInterval(() => refreshPortfolioQuotes({ silent: true }), PORTFOLIO_REFRESH_MS);
}

// ─── 全域刷新 ─────────────────────────────
function refreshAll() {
  const btn = document.getElementById('refreshBtn');
  btn.style.animation = 'spin 0.7s linear infinite';
  loadMarket();
  loadAllStocks();
  refreshActiveStockQuote();
  refreshPortfolioQuotes({ silent: true });
  if (getActiveTab() === 'inst') loadInstitutional();
  setTimeout(() => { btn.style.animation = ''; }, 2000);
}

// ─── 大盤 ─────────────────────────────────
async function loadMarket() {
  try {
    const d = await TWSE.market();
    const sign = d.sign === '+' || parseFloat(d.change) >= 0;
    document.getElementById('taiex').textContent    = parseFloat(d.taiex).toLocaleString();
    document.getElementById('taiex').className      = 'market-value ' + priceMoveClass(sign ? 1 : -1);
    document.getElementById('taiex-chg').textContent =
      (sign ? '▲ +' : '▼ ') + Math.abs(parseFloat(d.change)).toFixed(2) +
      ' (' + (sign ? '+' : '') + parseFloat(d.changePct).toFixed(2) + '%)';
    document.getElementById('taiex-chg').className  = 'market-chg ' + priceMoveClass(sign ? 1 : -1);
  } catch(e) {
    console.warn('大盤資料錯誤:', e);
  }
}

// ─── 全部股票（STOCK_DAY_ALL） ────────────
async function loadAllStocks({ silent = false } = {}) {
  if (isLoadingAllStocks) return;
  isLoadingAllStocks = true;
  if (!silent) showLoading('hot100Body', 12, '載入股票資料中...');
  try {
    const raw = await TWSE.allStocks();
    allStocksCache = raw.map(s => ({
      ...s,
      sector: getSector(s.code),
      // buy/sell 先用漲跌方向估算（真實比例需 MIS 即時五檔）
      buy:  s.chgPct >= 0 ? Math.min(80, 50 + Math.abs(s.chgPct) * 5) : Math.max(20, 50 - Math.abs(s.chgPct) * 5),
      sell: s.chgPct >= 0 ? Math.max(20, 50 - Math.abs(s.chgPct) * 5) : Math.min(80, 50 + Math.abs(s.chgPct) * 5),
      volRatio: 50,  // 預設，個股點擊後即時拉取
      foreign: 0, trust: 0, dealer: 0,
    }));

    // 更新市場買超比
    const buyCount  = allStocksCache.filter(s => s.chgPct >= 0).length;
    const buyRatio  = Math.round(buyCount / allStocksCache.length * 100);
    document.getElementById('buy-ratio').textContent = buyRatio + '%';
    document.getElementById('buy-ratio').className   = 'market-value ' + (buyRatio >= 50 ? 'up' : 'dn');
    document.getElementById('volume').textContent    =
      Math.round(allStocksCache.reduce((a, b) => a + b.volume, 0) / 1000).toLocaleString();

    refreshStockViews(!silent);
  } catch(e) {
    console.error('股票清單錯誤:', e);
    if (!silent) showError('hot100Body', 12, '無法取得股票資料，請確認伺服器已啟動');
  } finally {
    isLoadingAllStocks = false;
  }
}

// ─── 搜尋 ─────────────────────────────────
function quickSearch(code) {
  document.getElementById('stockInput').value = code;
  searchStock();
  switchToTab('search');
}

async function searchStock({ preserveAi = false } = {}) {
  const q = document.getElementById('stockInput').value.trim();
  if (!q) return;

  // 先從快取找
  const found = allStocksCache.find(s =>
    s.code === q || s.name.includes(q) || q.includes(s.code)
  );
  const code = found ? found.code : q;

  document.getElementById('searchEmpty').style.display = 'none';
  document.getElementById('searchResult').style.display = 'block';
  document.getElementById('res-code').textContent = code;
  document.getElementById('res-name').textContent = found ? found.name : '載入中...';
  document.getElementById('res-sector').textContent = found ? found.sector : '';
  if (!preserveAi) {
    document.getElementById('stockAiContent').innerHTML = '<span class="hint">點擊「AI 深度分析」取得個股分析報告</span>';
  }

  try {
    const s = await TWSE.quoteAuto(code);
    currentStock = { ...s, sector: getSector(s.code), buy: s.buyPct, sell: s.sellPct, vol: s.volRatio };

    document.getElementById('res-code').textContent = s.code;
    document.getElementById('res-name').textContent = s.name;
    document.getElementById('res-sector').textContent = getSector(s.code);
    document.getElementById('res-price').textContent = `$${s.price.toLocaleString()}`;

    const up = s.chgPct >= 0;
    const chgEl = document.getElementById('res-chg');
    chgEl.textContent = (up ? '▲ +' : '▼ ') + Math.abs(s.change).toFixed(2) +
      ' (' + (up ? '+' : '') + s.chgPct.toFixed(2) + '%)';
    chgEl.className = 'result-chg ' + priceMoveClass(s.chgPct);

    // 買賣力道
    document.getElementById('buy-bar').style.width  = s.buyPct  + '%';
    document.getElementById('sell-bar').style.width = s.sellPct + '%';
    document.getElementById('vol-bar').style.width  = Math.min(100, s.volRatio) + '%';
    document.getElementById('buy-pct').textContent  = s.buyPct  + '%';
    document.getElementById('sell-pct').textContent = s.sellPct + '%';
    document.getElementById('vol-pct').textContent  = Math.min(100, s.volRatio) + '%';

    const dominant = s.buyPct > s.sellPct;
    const tagEl = document.getElementById('res-tag');
    tagEl.textContent = dominant ? '買入主導' : '賣出主導';
    tagEl.className = 'dominant-tag ' + (dominant ? 'buy' : 'sell');

    const summary = document.getElementById('vs-summary');
    if (s.buyPct >= 65) {
      summary.style.background = 'rgba(242,92,92,0.08)';
      summary.innerHTML = '<i class="ti ti-trending-up"></i> 買方強勢，多方佔優';
    } else if (s.sellPct >= 60) {
      summary.style.background = 'rgba(38,208,124,0.08)';
      summary.innerHTML = '<i class="ti ti-trending-down"></i> 賣方強勢，空方佔優';
    } else {
      summary.style.background = '';
      summary.innerHTML = '<i class="ti ti-minus"></i> 買賣均衡，觀望為主';
    }

    // 嘗試法人資料
    loadStockInst(s.code);

  } catch(e) {
    document.getElementById('res-name').textContent = '找不到此股票或市場已收盤';
    console.warn('個股報價錯誤:', e);
  }
}

async function refreshActiveStockQuote() {
  if (!currentStock || getActiveTab() !== 'search' || isRefreshingQuote) return;
  const input = document.getElementById('stockInput');
  if (document.activeElement === input) return;

  isRefreshingQuote = true;
  const originalValue = input.value;
  input.value = currentStock.code;
  try {
    await searchStock({ preserveAi: true });
  } finally {
    input.value = originalValue || currentStock.code;
    isRefreshingQuote = false;
  }
}

async function loadStockInst(code) {
  try {
    if (!instCache.length) {
      instCache = await TWSE.institutional();
    }
    const inst = instCache.find(s => s.code === code);
    if (inst) {
      setInstVal('res-foreign', inst.foreign);
      setInstVal('res-trust',   inst.trust);
      setInstVal('res-dealer',  inst.dealer);
      // 更新 currentStock 的法人資料
      if (currentStock) {
        currentStock.foreign = inst.foreign;
        currentStock.trust   = inst.trust;
        currentStock.dealer  = inst.dealer;
      }
    } else {
      ['res-foreign','res-trust','res-dealer'].forEach(id => {
        document.getElementById(id).textContent = '--';
        document.getElementById(id).className = 'inst-val';
      });
    }
  } catch(e) { /* 法人資料失敗不影響主要功能 */ }
}

function setInstVal(id, val) {
  const el = document.getElementById(id);
  const sign = val >= 0;
  el.textContent = (sign ? '+' : '') + val.toFixed(2) + '億';
  el.className   = 'inst-val ' + (sign ? 'up' : 'dn');
}

// ─── 個股 AI 分析 ────────────────────────
function analyzeStock() {
  if (!currentStock) return;
  const s = currentStock;
  runAI({
    spinnerId: 'stockSpinner', contentId: 'stockAiContent',
    system: '你是專業台股技術分析師，請用繁體中文條列式回答。',
    prompt: `分析台股 ${s.code} ${s.name}（${s.sector}）：
股價 $${s.price}（${s.chgPct >= 0 ? '+' : ''}${s.chgPct}%）
今日最高 $${s.high}，最低 $${s.low}，開盤 $${s.open}
買入佔比 ${s.buyPct || s.buy}%，賣出佔比 ${s.sellPct || s.sell}%
外資 ${s.foreign >= 0 ? '+' : ''}${s.foreign}億，投信 ${s.trust >= 0 ? '+' : ''}${s.trust}億，自營商 ${s.dealer >= 0 ? '+' : ''}${s.dealer}億
請提供：1.趨勢判斷 2.籌碼面解讀 3.短線操作建議（含進場時機） 4.停損停利 5.風險提示`,
    localFallback: () => buildLocalStockAnalysis(s),
  });
}
function analyzeStockTech() {
  if (!currentStock) return;
  const s = currentStock;
  runAI({
    spinnerId: 'stockSpinner', contentId: 'stockAiContent',
    prompt: `台股 ${s.code} ${s.name}，股價 $${s.price}（${s.chgPct >= 0?'+':''}${s.chgPct}%），今日振幅 $${s.low}~$${s.high}。請從技術面分析：1.目前型態 2.支撐壓力 3.量價關係 4.建議觀察的技術訊號。請用繁體中文。`,
    localFallback: () => buildLocalTechAnalysis(s),
  });
}
function analyzeStockRisk() {
  if (!currentStock) return;
  const s = currentStock;
  runAI({
    spinnerId: 'stockSpinner', contentId: 'stockAiContent',
    prompt: `評估台股 ${s.code} ${s.name}（${s.sector}）的風險：買${s.buyPct||s.buy}%，賣${s.sellPct||s.sell}%，外資${s.foreign}億，投信${s.trust}億。請分析：1.籌碼集中度風險 2.法人態度 3.類股系統風險 4.風險等級（低/中/高）。請用繁體中文。`,
    localFallback: () => buildLocalRiskAnalysis(s),
  });
}

function buildLocalStockAnalysis(s) {
  const signal = getLocalSignal(s);
  const range = getLocalRange(s);
  const inst = getLocalInstTone(s);
  return [
    `本地規則分析：${s.code} ${s.name}（${s.sector || '未分類'}）`,
    '',
    `1. 趨勢判斷：${signal.bias}。目前漲跌幅 ${formatPct(s.chgPct)}，買方力道 ${signal.buy}%、賣方力道 ${signal.sell}%，綜合分數 ${signal.score}。`,
    `2. 籌碼面解讀：${signal.flowText}。法人合計約 ${formatSigned(inst.total, '億')}，${inst.text}`,
    `3. 短線操作建議：${signal.action}`,
    `4. 停損停利：日內支撐約 ${formatPrice(range.support)}，壓力約 ${formatPrice(range.resistance)}；跌破支撐宜先防守，突破壓力再觀察續航。`,
    `5. 風險提示：這是本機根據即時報價、買賣力道與法人資料的規則分析，不等同完整 AI 判讀，也不構成投資建議。`,
  ].join('\n');
}

function buildLocalTechAnalysis(s) {
  const signal = getLocalSignal(s);
  const range = getLocalRange(s);
  const dayRangePct = s.price ? ((range.resistance - range.support) / s.price * 100) : 0;
  const position = range.resistance === range.support
    ? 50
    : Math.round((s.price - range.support) / (range.resistance - range.support) * 100);

  return [
    `本地技術面分析：${s.code} ${s.name}`,
    '',
    `1. 目前型態：${signal.bias}。現價位於日內區間約 ${Math.max(0, Math.min(100, position))}% 的位置，越靠近上緣追價風險越高。`,
    `2. 支撐壓力：支撐 ${formatPrice(range.support)}，壓力 ${formatPrice(range.resistance)}，日內震幅約 ${dayRangePct.toFixed(2)}%。`,
    `3. 量價關係：量比 ${Math.round(Number(s.volRatio || s.vol || 0))}%，買賣力道為 ${signal.buy}% / ${signal.sell}%。若價格上漲但買方力道未同步放大，需防拉回。`,
    `4. 觀察訊號：留意是否站穩 ${formatPrice(range.resistance)}，或跌破 ${formatPrice(range.support)} 後賣壓擴大。`,
  ].join('\n');
}

function buildLocalRiskAnalysis(s) {
  const signal = getLocalSignal(s);
  const range = getLocalRange(s);
  const inst = getLocalInstTone(s);
  const volatility = s.price ? Math.abs(range.resistance - range.support) / s.price * 100 : 0;
  let riskScore = 1;
  if (Math.abs(Number(s.chgPct || 0)) >= 3) riskScore += 1;
  if (volatility >= 4) riskScore += 1;
  if (signal.sell >= 65) riskScore += 1;
  if (inst.total < 0) riskScore += 1;
  const level = riskScore >= 4 ? '高' : riskScore >= 3 ? '中' : '低';

  return [
    `本地風險評估：${s.code} ${s.name}（${s.sector || '未分類'}）`,
    '',
    `1. 籌碼集中度風險：買賣力道 ${signal.buy}% / ${signal.sell}%，${signal.sell >= 65 ? '賣方力道偏高，需避免逆勢硬接。' : '尚未看到明顯單邊賣壓。'}`,
    `2. 法人態度：法人合計 ${formatSigned(inst.total, '億')}，${inst.text}`,
    `3. 類股與波動風險：日內區間 ${formatPrice(range.support)} 到 ${formatPrice(range.resistance)}，估算震幅 ${volatility.toFixed(2)}%。`,
    `4. 風險等級：${level}。${level === '高' ? '建議降低部位或等待回穩。' : level === '中' ? '可小部位觀察，嚴守停損。' : '仍需搭配大盤與成交量確認。'}`,
  ].join('\n');
}

function getLocalSignal(s) {
  const chgPct = Number(s.chgPct || 0);
  const buy = Math.round(Number(s.buyPct || s.buy || 50));
  const sell = Math.round(Number(s.sellPct || s.sell || (100 - buy)));
  const inst = getLocalInstTone(s).total;
  let score = 0;
  if (chgPct > 1) score += 1;
  if (chgPct < -1) score -= 1;
  if (buy >= 60) score += 1;
  if (sell >= 60) score -= 1;
  if (inst > 0) score += 1;
  if (inst < 0) score -= 1;

  const bias = score >= 2 ? '偏多' : score <= -2 ? '偏空' : '中性震盪';
  const flowText = buy > sell
    ? `買方略占優勢（${buy}% 對 ${sell}%）`
    : sell > buy
      ? `賣方略占優勢（${sell}% 對 ${buy}%）`
      : '買賣力道接近平衡';
  const action = score >= 2
    ? '可觀察回測支撐不破後的續強機會，避免直接追高。'
    : score <= -2
      ? '以保守觀望為主，等待賣壓收斂或重新站回壓力區。'
      : '適合等待方向確認，區間內以低接高出或小部位試單為主。';

  return { buy, sell, score, bias, flowText, action };
}

function getLocalRange(s) {
  const price = Number(s.price || 0);
  const high = Number(s.high || price);
  const low = Number(s.low || price);
  const open = Number(s.open || price);
  return {
    support: Math.min(low || price, open || price, price || low || open),
    resistance: Math.max(high || price, open || price, price || high || open),
  };
}

function getLocalInstTone(s) {
  const foreign = Number(s.foreign || 0);
  const trust = Number(s.trust || 0);
  const dealer = Number(s.dealer || 0);
  const total = foreign + trust + dealer;
  const text = total > 0
    ? '法人籌碼偏正向，但仍要確認買超是否集中且能延續。'
    : total < 0
      ? '法人籌碼偏保守，若股價同時轉弱，需提高防守。'
      : '法人資料目前沒有明顯方向，需以價格與量能為主。';
  return { total, text };
}

function formatPrice(value) {
  const n = Number(value || 0);
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPct(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function priceMoveClass(value) {
  return Number(value || 0) >= 0 ? 'up' : 'dn';
}

function formatSigned(value, unit = '') {
  const n = Number(value || 0);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}${unit}`;
}

// ─── 我的持股 ─────────────────────────────
function initPortfolio() {
  loadPortfolio();
  initHoldingCodeLookup();
  const dateInput = document.getElementById('holdingBuyDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
  renderPortfolio();
  refreshPortfolioQuotes({ silent: true });
}

function loadPortfolio() {
  try {
    portfolioHoldings = JSON.parse(localStorage.getItem(PORTFOLIO_STORAGE_KEY) || '[]');
    if (!Array.isArray(portfolioHoldings)) portfolioHoldings = [];
  } catch(e) {
    portfolioHoldings = [];
  }
}

function persistPortfolio() {
  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(portfolioHoldings));
}

function initHoldingCodeLookup() {
  const codeInput = document.getElementById('holdingCode');
  if (!codeInput) return;

  codeInput.addEventListener('input', () => {
    const normalized = codeInput.value.replace(/\D/g, '').slice(0, 6);
    if (codeInput.value !== normalized) codeInput.value = normalized;
    scheduleHoldingNameLookup();
  });
  codeInput.addEventListener('blur', () => lookupHoldingNameByCode());
}

function scheduleHoldingNameLookup() {
  clearTimeout(holdingCodeLookupTimer);
  holdingCodeLookupTimer = setTimeout(lookupHoldingNameByCode, 350);
}

async function lookupHoldingNameByCode() {
  const codeInput = document.getElementById('holdingCode');
  const nameInput = document.getElementById('holdingName');
  if (!codeInput || !nameInput) return;

  const rawCode = codeInput.value.trim();
  if (!/^\d{4,6}$/.test(rawCode)) return;
  const code = rawCode.padStart(4, '0');
  codeInput.value = code;

  const seq = ++holdingCodeLookupSeq;
  const cached = allStocksCache.find(s => String(s.code) === code)
    || portfolioHoldings.find(s => String(s.code) === code)
    || (currentStock && String(currentStock.code) === code ? currentStock : null);
  if (cached?.name) {
    nameInput.value = cached.name;
    nameInput.placeholder = '台積電';
    return;
  }

  nameInput.placeholder = '查詢股票名稱中...';
  try {
    const quote = await TWSE.quoteAuto(code);
    if (seq !== holdingCodeLookupSeq || codeInput.value.trim() !== code) return;
    if (quote.name) {
      nameInput.value = quote.name;
      nameInput.placeholder = '台積電';
    } else {
      nameInput.placeholder = '查無名稱，請手動輸入';
    }
  } catch(e) {
    if (seq === holdingCodeLookupSeq && !nameInput.value.trim()) {
      nameInput.placeholder = '查無名稱，請手動輸入';
    }
  }
}

async function saveHolding(event) {
  event.preventDefault();

  const formId = document.getElementById('holdingId').value;
  const id = formId || createHoldingId();
  const holding = {
    id,
    code: document.getElementById('holdingCode').value.trim(),
    name: document.getElementById('holdingName').value.trim(),
    buyPrice: Number(document.getElementById('holdingBuyPrice').value),
    shares: Number(document.getElementById('holdingShares').value),
    buyDate: document.getElementById('holdingBuyDate').value,
  };

  if (!/^\d{4,6}$/.test(holding.code)) {
    alert('股票代號請輸入 4 到 6 位數字');
    return;
  }
  if (!holding.name || holding.buyPrice <= 0 || holding.shares <= 0 || !holding.buyDate) {
    alert('請完整填寫股票名稱、買進價、股數與買進日期');
    return;
  }

  const normalizedCode = holding.code.padStart(4, '0');
  const duplicateIndex = !formId
    ? portfolioHoldings.findIndex(item => item.code === normalizedCode)
    : -1;
  const existingIndex = formId
    ? portfolioHoldings.findIndex(item => item.id === id)
    : duplicateIndex;
  const previous = existingIndex >= 0 ? portfolioHoldings[existingIndex] : {};
  const next = duplicateIndex >= 0
    ? mergeHoldingPurchase(previous, holding, normalizedCode)
    : {
        ...previous,
        ...holding,
        code: normalizedCode,
        updatedAt: previous.updatedAt || '',
        currentPrice: Number(previous.currentPrice || 0),
      };

  if (existingIndex >= 0) {
    portfolioHoldings[existingIndex] = next;
  } else {
    portfolioHoldings.push(next);
  }

  persistPortfolio();
  resetHoldingForm();
  renderPortfolio();
  await refreshHoldingQuote(next.id);
}

function mergeHoldingPurchase(previous, holding, normalizedCode) {
  const existingShares = Number(previous.shares || 0);
  const addedShares = Number(holding.shares || 0);
  const totalShares = existingShares + addedShares;
  const totalCost = (Number(previous.buyPrice || 0) * existingShares) + (Number(holding.buyPrice || 0) * addedShares);

  return {
    ...previous,
    id: previous.id,
    code: normalizedCode,
    name: holding.name || previous.name,
    buyPrice: Number((totalCost / totalShares).toFixed(2)),
    shares: totalShares,
    buyDate: holding.buyDate || previous.buyDate,
    updatedAt: previous.updatedAt || '',
    currentPrice: Number(previous.currentPrice || 0),
  };
}

function editHolding(id) {
  const holding = portfolioHoldings.find(item => item.id === id);
  if (!holding) return;

  document.getElementById('holdingId').value = holding.id;
  document.getElementById('holdingCode').value = holding.code;
  document.getElementById('holdingName').value = holding.name;
  document.getElementById('holdingBuyPrice').value = holding.buyPrice;
  document.getElementById('holdingShares').value = holding.shares;
  document.getElementById('holdingBuyDate').value = holding.buyDate;
  document.getElementById('holdingFormTitle').textContent = '編輯持股';
  switchToTab('portfolio');
}

function deleteHolding(id) {
  const holding = portfolioHoldings.find(item => item.id === id);
  if (!holding) return;
  if (!confirm(`確定刪除 ${holding.code} ${holding.name}？`)) return;

  portfolioHoldings = portfolioHoldings.filter(item => item.id !== id);
  persistPortfolio();
  renderPortfolio();
}

function resetHoldingForm() {
  document.getElementById('holdingId').value = '';
  document.getElementById('holdingCode').value = '';
  document.getElementById('holdingName').value = '';
  document.getElementById('holdingBuyPrice').value = '';
  document.getElementById('holdingShares').value = '';
  document.getElementById('holdingBuyDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('holdingFormTitle').textContent = '新增持股';
}

function addCurrentStockToPortfolio() {
  if (!currentStock) return;
  resetHoldingForm();
  document.getElementById('holdingCode').value = currentStock.code;
  document.getElementById('holdingName').value = currentStock.name;
  document.getElementById('holdingBuyPrice').value = currentStock.price;
  switchToTab('portfolio');
  document.getElementById('holdingShares').focus();
}

function openCurrentStockChart() {
  if (!currentStock) return;
  openStockChart(currentStock);
}

function renderPortfolio() {
  const tbody = document.getElementById('portfolioBody');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (!portfolioHoldings.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--text-3)">尚未新增持股</td></tr>';
    updatePortfolioSummary();
    return;
  }

  portfolioHoldings.forEach(holding => {
    const currentPrice = Number(holding.currentPrice || 0);
    const cost = holding.buyPrice * holding.shares;
    const value = currentPrice > 0 ? currentPrice * holding.shares : 0;
    const pnl = value - cost;
    const returnPct = cost ? pnl / cost * 100 : 0;
    const hasQuote = currentPrice > 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${holding.code}</td>
      <td><button class="stock-link" type="button" onclick="openStockChartByCode('${holding.code}')">${escHtml(holding.name)}</button></td>
      <td>${formatMoney(holding.buyPrice)}</td>
      <td>${formatNumber(holding.shares)}</td>
      <td>${holding.buyDate}</td>
      <td>${hasQuote ? formatMoney(currentPrice) : '--'}</td>
      <td>${hasQuote ? formatMoney(value) : '--'}</td>
      <td class="${priceMoveClass(pnl)}">${hasQuote ? formatSignedMoney(pnl) : '--'}</td>
      <td class="${priceMoveClass(returnPct)}">${hasQuote ? formatPct(returnPct) : '--'}</td>
      <td style="color:var(--text-3);font-size:12px">${holding.updatedAt || '--'}</td>
      <td>
        <div class="row-actions">
          <button class="btn xs" onclick="editHolding('${holding.id}')">編輯</button>
          <button class="btn xs" onclick="deleteHolding('${holding.id}')">刪除</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updatePortfolioSummary();
}

function updatePortfolioSummary() {
  const totals = portfolioHoldings.reduce((acc, holding) => {
    const cost = Number(holding.buyPrice || 0) * Number(holding.shares || 0);
    const value = Number(holding.currentPrice || 0) > 0
      ? Number(holding.currentPrice) * Number(holding.shares || 0)
      : 0;
    acc.cost += cost;
    acc.value += value;
    return acc;
  }, { cost: 0, value: 0 });

  const pnl = totals.value - totals.cost;
  const returnPct = totals.cost ? pnl / totals.cost * 100 : 0;
  setText('portfolioCost', formatMoney(totals.cost));
  setText('portfolioValue', totals.value ? formatMoney(totals.value) : '--');
  setText('portfolioPnl', totals.value ? formatSignedMoney(pnl) : '--');
  setText('portfolioReturn', totals.value ? formatPct(returnPct) : '--');
  setClass('portfolioPnl', 'summary-value ' + priceMoveClass(pnl));
  setClass('portfolioReturn', 'summary-value ' + priceMoveClass(returnPct));
}

async function refreshPortfolioQuotes({ silent = false } = {}) {
  if (isRefreshingPortfolio || !portfolioHoldings.length) return;
  isRefreshingPortfolio = true;
  try {
    for (const holding of portfolioHoldings) {
      await refreshHoldingQuote(holding.id, { render: false });
    }
    persistPortfolio();
    renderPortfolio();
  } catch(e) {
    if (!silent) console.warn('持股現價更新失敗:', e);
  } finally {
    isRefreshingPortfolio = false;
  }
}

async function refreshHoldingQuote(id, { render = true } = {}) {
  const holding = portfolioHoldings.find(item => item.id === id);
  if (!holding) return;

  try {
    const quote = await TWSE.quoteAuto(holding.code);
    holding.name = holding.name || quote.name;
    holding.currentPrice = quote.price;
    holding.change = quote.change;
    holding.chgPct = quote.chgPct;
    holding.exchange = quote.exchange;
    holding.updatedAt = new Date().toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    persistPortfolio();
    if (render) renderPortfolio();
  } catch(e) {
    console.warn(`持股 ${holding.code} 現價更新失敗:`, e);
  }
}

function exportPortfolioJson() {
  const data = portfolioHoldings.map(getExportHolding);
  downloadTextFile(`portfolio-${getDateStamp()}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
}

function exportPortfolioCsv() {
  const rows = portfolioHoldings.map(getExportHolding);
  const headers = ['股票代號','股票名稱','買進價','股數','買進日期','現價','成本','市值','損益','報酬率','更新時間'];
  const body = rows.map(row => [
    row.code,
    row.name,
    row.buyPrice,
    row.shares,
    row.buyDate,
    row.currentPrice,
    row.cost,
    row.marketValue,
    row.pnl,
    row.returnPct,
    row.updatedAt,
  ]);
  const csv = [headers, ...body].map(cols => cols.map(csvCell).join(',')).join('\n');
  downloadTextFile(`portfolio-${getDateStamp()}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
}

function getExportHolding(holding) {
  const cost = Number(holding.buyPrice || 0) * Number(holding.shares || 0);
  const marketValue = Number(holding.currentPrice || 0) * Number(holding.shares || 0);
  const pnl = marketValue - cost;
  return {
    code: holding.code,
    name: holding.name,
    buyPrice: Number(holding.buyPrice || 0),
    shares: Number(holding.shares || 0),
    buyDate: holding.buyDate,
    currentPrice: Number(holding.currentPrice || 0),
    cost,
    marketValue,
    pnl,
    returnPct: cost ? Number((pnl / cost * 100).toFixed(2)) : 0,
    updatedAt: holding.updatedAt || '',
  };
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function createHoldingId() {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function formatMoney(value) {
  const n = Number(value || 0);
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatVolume(value) {
  const n = Number(value || 0);
  if (n >= 100000000) return `${(n / 100000000).toFixed(2)}億`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}萬`;
  return n.toLocaleString();
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setClass(id, className) {
  const el = document.getElementById(id);
  if (el) el.className = className;
}

// ─── 前100熱門 ────────────────────────────
function loadHot100() { renderHot100(getHot100ViewList()); }

function sortHot100() {
  renderHot100(getHot100ViewList());
}

let hot100Filtered = [];
let hot100SortState = { key: null, direction: null };

function initHot100SortHeaders() {
  document.querySelectorAll('[data-sort-key]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      setHot100Sort(btn.dataset.sortKey);
    });
  });
  updateHot100SortHeaders();
}

function setHot100Sort(key) {
  if (hot100SortState.key !== key) {
    hot100SortState = { key, direction: 'asc' };
  } else if (hot100SortState.direction === 'asc') {
    hot100SortState.direction = 'desc';
  } else if (hot100SortState.direction === 'desc') {
    hot100SortState = { key: null, direction: null };
  }
  renderHot100(getHot100ViewList());
}

function updateHot100SortHeaders() {
  document.querySelectorAll('[data-sort-key]').forEach(btn => {
    const isActive = btn.dataset.sortKey === hot100SortState.key;
    const icon = btn.querySelector('i');
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('asc', isActive && hot100SortState.direction === 'asc');
    btn.classList.toggle('desc', isActive && hot100SortState.direction === 'desc');
    btn.setAttribute('aria-sort', isActive ? (hot100SortState.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    btn.title = !isActive
      ? '點擊升序排序'
      : hot100SortState.direction === 'asc'
        ? '點擊降序排序'
        : '點擊取消排序';
    if (icon) {
      icon.className = isActive
        ? (hot100SortState.direction === 'asc' ? 'ti ti-chevron-up' : 'ti ti-chevron-down')
        : 'ti ti-selector';
    }
  });
}

function filterHot100(btn, filter) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHot100(getHot100ViewList());
}

function refreshStockViews(force = false) {
  const activeTab = getActiveTab();
  if (force || activeTab === 'hot100') renderHot100(getHot100ViewList());
  if (force || activeTab === 'alerts') renderAlerts();
}

function getHot100ViewList() {
  const key = hot100SortState.key || 'vol';
  const direction = hot100SortState.direction || 'desc';
  const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
  const keyword = (document.getElementById('hot100Search')?.value || '').trim().toLowerCase();
  let list = [...allStocksCache];

  if (keyword) {
    list = list.filter(s =>
      String(s.code || '').toLowerCase().includes(keyword) ||
      String(s.name || '').toLowerCase().includes(keyword) ||
      String(s.sector || '').toLowerCase().includes(keyword)
    );
  }

  if (activeFilter === 'buy')  list = list.filter(s => s.buy  >= 65);
  if (activeFilter === 'sell') list = list.filter(s => s.sell >= 65);
  if (activeFilter === 'up')   list = list.filter(s => s.chgPct > 0);
  if (activeFilter === 'dn')   list = list.filter(s => s.chgPct < 0);

  return list.sort((a, b) => compareHot100Rows(a, b, key, direction));
}

function compareHot100Rows(a, b, key, direction) {
  const factor = direction === 'asc' ? 1 : -1;
  let result = 0;
  if (key === 'price') result = Number(a.price || 0) - Number(b.price || 0);
  else if (key === 'chg') result = Number(a.chgPct || 0) - Number(b.chgPct || 0);
  else if (key === 'vol') result = Number(a.volume || 0) - Number(b.volume || 0);
  else if (key === 'buy') result = Number(a.buy || 0) - Number(b.buy || 0);
  else if (key === 'sell') result = Number(a.sell || 0) - Number(b.sell || 0);
  else if (key === 'force') result = Math.max(Number(a.buy || 0), Number(a.sell || 0)) - Math.max(Number(b.buy || 0), Number(b.sell || 0));
  else if (key === 'volRatio') result = Number(a.volRatio || 0) - Number(b.volRatio || 0);
  else result = Number(a.volume || 0) - Number(b.volume || 0);
  if (result === 0) return String(a.code).localeCompare(String(b.code), 'zh-Hant', { numeric: true });
  return result * factor;
}

function renderHot100(list) {
  updateHot100SortHeaders();
  const tbody = document.getElementById('hot100Body');
  tbody.innerHTML = '';
  const top = list.slice(0, 100);
  if (!top.length) { showError('hot100Body', 12, '暫無資料'); return; }

  top.forEach((s, i) => {
    const up       = s.chgPct >= 0;
    const dominant = s.buy > s.sell;
    const pillCls  = s.buy >= 65 ? 'buy' : s.sell >= 65 ? 'sell' : 'neutral';
    const pillText = s.buy >= 65 ? '強買' : s.sell >= 65 ? '強賣' : '均衡';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--text-3);font-size:12px">${i + 1}</td>
      <td style="font-weight:600">${s.code}</td>
      <td><button class="stock-link" type="button" onclick="openStockChartByCode('${s.code}')">${escHtml(s.name)}</button> <small style="color:var(--text-3);font-size:11px">${escHtml(s.sector)}</small></td>
      <td style="font-weight:600">$${(s.price||0).toLocaleString()}</td>
      <td class="move-cell ${priceMoveClass(s.chgPct)}">${up ? '▲ +' : '▼ '}${Math.abs(s.chgPct||0).toFixed(2)}%</td>
      <td>${formatVolume(s.volume)}</td>
      <td class="up" style="font-weight:600">${Math.round(s.buy||50)}%</td>
      <td class="dn" style="font-weight:600">${Math.round(s.sell||50)}%</td>
      <td>
        <div class="bar-mini">
          <div class="bar-mini-track">
            <div class="bar-mini-fill ${dominant?'buy':'sell'}" style="width:${dominant?Math.round(s.buy):Math.round(s.sell)}%"></div>
          </div>
          <span style="font-size:11px;color:var(--text-3)">${dominant?Math.round(s.buy):Math.round(s.sell)}%</span>
        </div>
      </td>
      <td>${Math.round(s.volRatio || 0)}%</td>
      <td><span class="direction-pill ${pillCls}">${pillText}</span></td>
      <td><button class="btn" style="padding:3px 8px;font-size:11px" onclick="event.stopPropagation();quickSearch('${s.code}')">分析</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function aiPickStocks() {
  const top10 = allStocksCache.slice(0, 10).map(s =>
    `${s.code}${s.name} 成交量${formatVolume(s.volume)} 買${Math.round(s.buy)}% 賣${Math.round(s.sell)}% 漲跌${s.chgPct >= 0 ? '+' : ''}${(s.chgPct||0).toFixed(2)}%`
  ).join('\n');
  runAI({
    spinnerId: 'pickSpinner', contentId: 'aiPickContent', resultBoxId: 'aiPickResult',
    prompt: `以下是目前台股成交量前10名（真實資料）：\n${top10}\n\n請用繁體中文選出最值得短線關注的3支，說明理由、進場條件與風險。`,
  });
}

// ─── 買賣提醒 ─────────────────────────────
function loadAlerts() { renderAlerts(); }

function renderAlerts() {
  const buys  = [...allStocksCache].filter(s => s.buy >= 65).sort((a,b) => b.buy  - a.buy).slice(0, 8);
  const sells = [...allStocksCache].filter(s => s.sell>= 65).sort((a,b) => b.sell - a.sell).slice(0, 8);
  renderAlertList('buyAlerts',  buys,  'buy');
  renderAlertList('sellAlerts', sells, 'sell');
}

function renderAlertList(id, list, type) {
  const container = document.getElementById(id);
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<div style="padding:16px;color:var(--text-3);font-size:13px">目前無符合條件個股</div>';
    return;
  }
  list.forEach(s => {
    const pct  = type === 'buy' ? Math.round(s.buy) : Math.round(s.sell);
    const item = document.createElement('div');
    item.className = 'alert-item';
    item.innerHTML = `
      <div class="alert-icon ${type}">
        <i class="ti ti-trending-${type === 'buy' ? 'up' : 'down'}"></i>
      </div>
      <div>
        <div class="alert-stock-name">${s.code} <button class="stock-link" type="button" onclick="openStockChartByCode('${s.code}')">${escHtml(s.name)}</button></div>
        <div class="alert-detail">${escHtml(s.sector)} · <span class="${priceMoveClass(s.chgPct)}">${s.chgPct >= 0 ? '+' : ''}${(s.chgPct||0).toFixed(2)}%</span></div>
      </div>
      <div class="alert-right">
        <div class="alert-pct ${type === 'buy' ? 'up' : 'dn'}">${pct}%</div>
        <div style="font-size:11px;color:var(--text-3)">${type === 'buy' ? '買入' : '賣出'}佔比</div>
      </div>
    `;
    container.appendChild(item);
  });
}

function aiAnalyzeAlerts() {
  const buys  = allStocksCache.filter(s => s.buy  >= 65).slice(0,5).map(s=>`${s.code}${s.name} 買${Math.round(s.buy)}%`).join('、');
  const sells = allStocksCache.filter(s => s.sell >= 65).slice(0,5).map(s=>`${s.code}${s.name} 賣${Math.round(s.sell)}%`).join('、');
  runAI({
    spinnerId: 'alertSpinner', contentId: 'aiAlertContent', resultBoxId: 'aiAlertResult',
    prompt: `台股高買入個股（≥65%）：${buys||'無'}\n台股高賣出個股（≥65%）：${sells||'無'}\n\n請用繁體中文分析：1.高買入哪些有持續上漲潛力 2.高賣出值得放空嗎 3.整體建議`,
  });
}

// ─── 三大法人 ─────────────────────────────
async function loadInstitutional({ silent = false } = {}) {
  if (isLoadingInst) return;
  isLoadingInst = true;
  if (!silent) showLoading('instTableBody', 8, '載入三大法人資料...');
  try {
    const [inst, summary] = await Promise.all([TWSE.institutional(), TWSE.instSummary()]);
    instCache = inst;

    // 更新合計顯示
    const fSign = summary.foreign >= 0;
    const tSign = summary.trust   >= 0;
    const dSign = summary.dealer  >= 0;
    document.getElementById('inst-foreign-total').textContent = (fSign?'+':'') + summary.foreign + '億';
    document.getElementById('inst-foreign-total').className   = 'inst-ov-val ' + (fSign?'up':'dn');
    document.getElementById('inst-trust-total').textContent   = (tSign?'+':'') + summary.trust   + '億';
    document.getElementById('inst-trust-total').className     = 'inst-ov-val ' + (tSign?'up':'dn');
    document.getElementById('inst-dealer-total').textContent  = (dSign?'+':'') + summary.dealer  + '億';
    document.getElementById('inst-dealer-total').className    = 'inst-ov-val ' + (dSign?'up':'dn');

    const total = summary.foreign + summary.trust + summary.dealer;
    document.getElementById('inst-total').textContent = (total>=0?'+':'') + total.toFixed(1) + '億';
    document.getElementById('inst-total').className   = 'market-value ' + (total>=0?'up':'dn');

    // 表格
    const tbody = document.getElementById('instTableBody');
    tbody.innerHTML = '';
    inst.slice(0, 30).forEach(s => {
      const fmt = v => `<span class="${v>=0?'up':'dn'}">${v>=0?'+':''}${v.toFixed(2)}億</span>`;
      const allBuy  = s.foreign > 0 && s.trust > 0 && s.dealer > 0;
      const allSell = s.foreign < 0 && s.trust < 0 && s.dealer < 0;
      const pillCls  = allBuy ? 'buy' : allSell ? 'sell' : 'neutral';
      const pillText = allBuy ? '三買' : allSell ? '三賣' : '混合';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600">${s.code}</td>
        <td><button class="stock-link" type="button" onclick="openStockChartByCode('${s.code}')">${escHtml(s.name)}</button></td>
        <td>${fmt(s.foreign)}</td>
        <td>${fmt(s.trust)}</td>
        <td>${fmt(s.dealer)}</td>
        <td style="font-weight:600">${fmt(s.total)}</td>
        <td style="font-size:12px;color:var(--text-3)">當日</td>
        <td><span class="direction-pill ${pillCls}">${pillText}</span></td>
      `;
      tbody.appendChild(tr);
    });
  } catch(e) {
    if (!silent) showError('instTableBody', 8, '無法取得三大法人資料');
    console.error('法人資料錯誤:', e);
  } finally {
    isLoadingInst = false;
  }
}

function refreshInstitutionalData() {
  loadInstitutional({ silent: true });
}

function aiAnalyzeInst() {
  const top5Buy  = instCache.filter(s => s.total > 0).slice(0,5).map(s=>`${s.code}${s.name} +${s.total.toFixed(1)}億`).join('\n');
  const top5Sell = instCache.filter(s => s.total < 0).slice(0,5).map(s=>`${s.code}${s.name} ${s.total.toFixed(1)}億`).join('\n');
  runAI({
    spinnerId: 'instSpinner', contentId: 'aiInstContent', resultBoxId: 'aiInstResult',
    prompt: `【三大法人當日買超】\n${top5Buy||'無'}\n\n【三大法人當日賣超】\n${top5Sell||'無'}\n\n請用繁體中文分析：1.法人整體態度 2.連續買超個股意義 3.最值得跟隨的個股`,
  });
}

// ─── AI 市場分析 ──────────────────────────
async function refreshAiAnalysis() {
  const spinner  = document.getElementById('aiSpinner');
  const advice   = document.getElementById('aiAdvice');
  const dirTitle = document.getElementById('dirTitle');
  const dirSub   = document.getElementById('dirSub');
  const dirPill  = document.getElementById('dirPill');
  const dirCard  = document.getElementById('dirCard');

  spinner.style.display = 'inline-block';
  advice.innerHTML = '<span class="hint">AI 正在分析市場，請稍候...</span>';

  const upCount = allStocksCache.filter(s => s.chgPct >= 0).length;
  const buyRatio = allStocksCache.length ? Math.round(upCount / allStocksCache.length * 100) : 50;
  const strongBuy  = allStocksCache.filter(s => s.buy >= 70).slice(0, 5).map(s => `${s.code}${s.name}`).join('、');
  const strongSell = allStocksCache.filter(s => s.sell>= 70).slice(0, 5).map(s => `${s.code}${s.name}`).join('、');

  const taiex   = document.getElementById('taiex').textContent;
  const taiexChg = document.getElementById('taiex-chg').textContent;

  try {
    const result = await callClaude(
      `你是資深台股分析師，請根據以下即時市場數據（真實資料），用繁體中文提供完整市場分析：

【加權指數】${taiex} ${taiexChg}
【市場上漲比】${buyRatio}%（共 ${allStocksCache.length} 檔）
【強力買入個股】${strongBuy || '無'}
【強力賣出個股】${strongSell || '無'}

請提供：
1. 【市場方向判斷】做多/做空/中性，並說明理由
2. 【多空力道分析】
3. 【操作策略建議】短中線策略
4. 【重點關注族群】
5. 【主要風險因子】
6. 【今日結論】一句話總結

請條列作答，每點清楚說明。`
    );

    const isLong  = /做多|偏多|多方|看多|上漲/.test(result);
    const isShort = /做空|偏空|空方|看空|下跌/.test(result);
    if (isLong) {
      dirCard.className  = 'direction-card long';
      dirTitle.textContent = '建議方向：做多';
      dirSub.textContent   = '多方主導，強勢股持續';
      dirPill.textContent  = '📈 做多';
      dirPill.className    = 'signal-pill long';
    } else if (isShort) {
      dirCard.className  = 'direction-card short';
      dirTitle.textContent = '建議方向：做空';
      dirSub.textContent   = '空方壓制，注意下行風險';
      dirPill.textContent  = '📉 做空';
      dirPill.className    = 'signal-pill short';
    } else {
      dirCard.className  = 'direction-card';
      dirTitle.textContent = '建議方向：中性觀望';
      dirSub.textContent   = '多空均衡，等待方向確立';
      dirPill.textContent  = '⚖️ 觀望';
      dirPill.className    = 'signal-pill neutral';
    }
    advice.innerHTML = escHtml(result).replace(/\n/g,'<br>');
  } catch(e) {
    advice.innerHTML = `❌ ${e.message}`;
  } finally {
    spinner.style.display = 'none';
  }
}

function askAI(question) {
  runAI({
    spinnerId: 'quickSpinner', contentId: 'aiQuickContent', resultBoxId: 'aiQuickResult',
    prompt: question + '\n請用繁體中文作答，條理清晰。',
  });
}

// ─── 走勢圖 ───────────────────────────────
function openStockChartByCode(code) {
  const target = findStockForChart(code);
  openStockChart(target || { code });
}

function openStockChart(stock, interval = chartInterval) {
  const code = String(stock?.code || '').trim();
  if (!code) return;

  chartStock = {
    code,
    name: String(stock?.name || '').trim(),
    exchange: String(stock?.exchange || ''),
  };
  chartInterval = interval;
  switchToTab('chart');
  setChartSearchValue(chartStock);
  updateChartHeader();
  updateTimeframeButtons();
  renderStockChartPage();
}

function searchChartStock() {
  const input = document.getElementById('chartSearchInput');
  const q = String(input?.value || '').trim();
  if (!q) return;

  const stock = findStockByQuery(q);
  if (stock) {
    openStockChart(stock);
    return;
  }

  const code = q.match(/\d{4,6}/)?.[0];
  if (code) {
    openStockChart({ code });
    return;
  }

  drawChartMessage('找不到符合的股票，請輸入股票代號');
}

function setChartInterval(interval) {
  chartInterval = interval;
  updateTimeframeButtons();
  if (chartStock) renderStockChartPage();
}

function findStockByQuery(query) {
  const q = String(query || '').trim().toLowerCase();
  const sources = [allStocksCache, portfolioHoldings, instCache].flat();
  if (currentStock) sources.unshift(currentStock);
  return sources.find(s => String(s.code || '').toLowerCase() === q)
    || sources.find(s => String(s.name || '').toLowerCase() === q)
    || sources.find(s =>
      String(s.code || '').toLowerCase().includes(q) ||
      String(s.name || '').toLowerCase().includes(q)
    );
}

function findStockForChart(code) {
  const key = String(code || '').trim();
  return allStocksCache.find(s => String(s.code) === key)
    || portfolioHoldings.find(s => String(s.code) === key)
    || instCache.find(s => String(s.code) === key)
    || (currentStock && String(currentStock.code) === key ? currentStock : null);
}

function setChartSearchValue(stock) {
  const input = document.getElementById('chartSearchInput');
  if (!input || !stock) return;
  input.value = stock.name ? `${stock.code} ${stock.name}` : stock.code;
}

function updateChartHeader() {
  const title = document.getElementById('chartStockTitle');
  const meta = document.getElementById('chartStockMeta');
  if (!title || !meta) return;

  if (!chartStock) {
    title.textContent = '股票走勢圖';
    meta.textContent = '請從股票列表選擇一檔股票';
    return;
  }

  title.textContent = `${chartStock.code} ${chartStock.name || ''}`.trim();
  meta.textContent = `${getChartSymbol(chartStock)} · ${getChartIntervalLabel(chartInterval)}`;
}

function updateTimeframeButtons() {
  document.querySelectorAll('[data-interval]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.interval === chartInterval);
  });
}

function initStockChartCanvas() {
  const canvas = document.getElementById('stockChartCanvas');
  const frame = document.querySelector('.chart-frame');
  if (!canvas || !frame) return;

  window.addEventListener('resize', () => {
    if (getActiveTab() === 'chart' && chartData.length) drawStockChart();
  });

  canvas.addEventListener('mousemove', event => {
    if (!chartData.length) return;
    const rect = canvas.getBoundingClientRect();
    const layout = getChartLayout(canvas);
    const x = event.clientX - rect.left;
    const plotW = layout.width - layout.left - layout.right;
    const step = plotW / Math.max(chartData.length, 1);
    chartHoverIndex = Math.max(0, Math.min(chartData.length - 1, Math.floor((x - layout.left) / step)));
    drawStockChart();
  });

  canvas.addEventListener('mouseleave', () => {
    chartHoverIndex = null;
    hideChartTooltip();
    if (chartData.length) drawStockChart();
  });
}

async function renderStockChartPage() {
  const canvas = document.getElementById('stockChartCanvas');
  const loading = document.getElementById('chartLoading');
  const empty = document.getElementById('chartEmpty');
  if (!canvas) return;

  updateChartHeader();
  updateTimeframeButtons();

  if (!chartStock) {
    chartData = [];
    canvas.style.display = 'none';
    hideChartTooltip();
    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (empty) empty.style.display = 'none';
  if (loading) loading.style.display = 'flex';
  canvas.style.display = 'block';
  hideChartTooltip();

  try {
    const result = await TWSE.chart(chartStock.code, chartInterval, chartStock.exchange);
    chartData = result.candles;
    chartStock.yahooSymbol = result.symbol;
    updateChartHeader();
    drawStockChart();
  } catch(e) {
    console.warn('走勢圖載入失敗:', e);
    chartData = [];
    drawChartMessage(`走勢圖載入失敗：${e.message || '請稍後再試'}`);
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

function drawStockChart() {
  const canvas = document.getElementById('stockChartCanvas');
  if (!canvas) return;
  const ctx = setupChartCanvas(canvas);
  const layout = getChartLayout(canvas);

  ctx.clearRect(0, 0, layout.width, layout.height);
  drawChartBackground(ctx, layout);
  if (!chartData.length) {
    drawCenteredChartText(ctx, layout, '無走勢圖資料');
    return;
  }

  const priceMin = Math.min(...chartData.map(row => row.low));
  const priceMax = Math.max(...chartData.map(row => row.high));
  const volumeMax = Math.max(...chartData.map(row => row.volume || 0), 1);
  const pricePad = Math.max((priceMax - priceMin) * 0.08, priceMax * 0.01);
  const min = priceMin - pricePad;
  const max = priceMax + pricePad;

  const plotX = layout.left;
  const plotY = layout.top;
  const plotW = layout.width - layout.left - layout.right;
  const priceH = layout.priceHeight;
  const volumeY = layout.top + layout.priceHeight + layout.gap;
  const volumeH = layout.volumeHeight;
  const step = plotW / Math.max(chartData.length, 1);
  const candleW = Math.max(2, Math.min(12, step * 0.62));
  const yForPrice = value => plotY + (max - value) / (max - min || 1) * priceH;
  const yForVol = value => volumeY + volumeH - (value / volumeMax) * volumeH;

  drawChartGrid(ctx, layout, min, max);

  chartData.forEach((row, i) => {
    const x = plotX + i * step + step / 2;
    const up = row.close >= row.open;
    const color = up ? '#f25c5c' : '#26d07c';
    const openY = yForPrice(row.open);
    const closeY = yForPrice(row.close);
    const highY = yForPrice(row.high);
    const lowY = yForPrice(row.low);
    const bodyTop = Math.min(openY, closeY);
    const bodyH = Math.max(1, Math.abs(closeY - openY));

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);

    ctx.globalAlpha = 0.55;
    ctx.fillRect(x - candleW / 2, yForVol(row.volume || 0), candleW, volumeY + volumeH - yForVol(row.volume || 0));
    ctx.globalAlpha = 1;
  });

  drawChartAxes(ctx, layout, min, max);
  drawChartHover(ctx, layout, min, max, step);
}

function getChartSymbol(stock) {
  const code = String(stock?.code || '').trim();
  const exchange = String(stock?.exchange || '').toLowerCase();
  const suffix = exchange === 'otc' ? 'TWO' : 'TW';
  return stock?.yahooSymbol || `${code}.${suffix}`;
}

function getChartIntervalLabel(interval) {
  if (interval === '60') return '1時';
  if (interval === '240') return '4時';
  return '1日';
}

function setupChartCanvas(canvas) {
  const frame = canvas.parentElement;
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function getChartLayout(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.parentElement.clientWidth || 800;
  const height = rect.height || canvas.parentElement.clientHeight || 520;
  const top = 28;
  const bottom = 28;
  const gap = 18;
  const volumeHeight = Math.max(90, height * 0.22);
  const priceHeight = height - top - bottom - gap - volumeHeight;
  return { width, height, left: 56, right: 72, top, bottom, gap, priceHeight, volumeHeight };
}

function drawChartBackground(ctx, layout) {
  ctx.fillStyle = '#131722';
  ctx.fillRect(0, 0, layout.width, layout.height);
}

function drawChartGrid(ctx, layout, min, max) {
  const plotW = layout.width - layout.left - layout.right;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 5; i++) {
    const y = layout.top + (layout.priceHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(layout.left, y);
    ctx.lineTo(layout.left + plotW, y);
    ctx.stroke();
  }

  for (let i = 0; i <= 6; i++) {
    const x = layout.left + (plotW / 6) * i;
    ctx.beginPath();
    ctx.moveTo(x, layout.top);
    ctx.lineTo(x, layout.height - layout.bottom);
    ctx.stroke();
  }

  const volumeTop = layout.top + layout.priceHeight + layout.gap;
  ctx.beginPath();
  ctx.moveTo(layout.left, volumeTop);
  ctx.lineTo(layout.left + plotW, volumeTop);
  ctx.stroke();

  ctx.fillStyle = '#9da5b4';
  ctx.font = '12px -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const value = max - ((max - min) / 5) * i;
    const y = layout.top + (layout.priceHeight / 5) * i;
    ctx.fillText(formatChartPrice(value), layout.width - layout.right + 10, y);
  }
}

function drawChartAxes(ctx, layout, min, max) {
  const first = chartData[0];
  const last = chartData[chartData.length - 1];
  if (!first || !last) return;
  ctx.fillStyle = '#6b7385';
  ctx.font = '12px -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(formatChartTime(first.time), layout.left, layout.height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(formatChartTime(last.time), layout.width - layout.right, layout.height - 8);

  const latest = chartData[chartData.length - 1];
  const closeY = layout.top + (max - latest.close) / (max - min || 1) * layout.priceHeight;
  ctx.strokeStyle = 'rgba(242,92,92,0.7)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(layout.left, closeY);
  ctx.lineTo(layout.width - layout.right, closeY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawChartHover(ctx, layout, min, max, step) {
  if (chartHoverIndex === null || !chartData[chartHoverIndex]) return;
  const row = chartData[chartHoverIndex];
  const x = layout.left + chartHoverIndex * step + step / 2;
  const y = layout.top + (max - row.close) / (max - min || 1) * layout.priceHeight;

  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, layout.top);
  ctx.lineTo(x, layout.height - layout.bottom);
  ctx.moveTo(layout.left, y);
  ctx.lineTo(layout.width - layout.right, y);
  ctx.stroke();
  ctx.setLineDash([]);

  const tooltip = document.getElementById('chartTooltip');
  if (!tooltip) return;
  tooltip.style.display = 'block';
  tooltip.style.left = `${Math.min(layout.width - 230, x + 12)}px`;
  tooltip.style.top = `${Math.max(12, y - 72)}px`;
  tooltip.innerHTML = `
    <div>${formatChartTime(row.time)}</div>
    <div>開 ${formatChartPrice(row.open)} 高 ${formatChartPrice(row.high)}</div>
    <div>低 ${formatChartPrice(row.low)} 收 ${formatChartPrice(row.close)}</div>
    <div>量 ${formatVolume(row.volume)}</div>
  `;
}

function hideChartTooltip() {
  const tooltip = document.getElementById('chartTooltip');
  if (tooltip) tooltip.style.display = 'none';
}

function drawChartMessage(message) {
  const canvas = document.getElementById('stockChartCanvas');
  if (!canvas) return;
  canvas.style.display = 'block';
  const ctx = setupChartCanvas(canvas);
  const layout = getChartLayout(canvas);
  drawChartBackground(ctx, layout);
  drawCenteredChartText(ctx, layout, message);
}

function drawCenteredChartText(ctx, layout, text) {
  ctx.fillStyle = '#9da5b4';
  ctx.font = '14px -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, layout.width / 2, layout.height / 2);
}

function formatChartPrice(value) {
  const n = Number(value || 0);
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2);
}

function formatChartTime(time) {
  const options = chartInterval === 'D'
    ? { month: '2-digit', day: '2-digit' }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  return new Date(time).toLocaleString('zh-TW', options);
}

// ─── 工具函式 ─────────────────────────────
function switchToTab(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

function getActiveTab() {
  const active = document.querySelector('.tab-content.active');
  return active ? active.id.replace('tab-', '') : 'search';
}

function showLoading(tbodyId, cols, msg) {
  document.getElementById(tbodyId).innerHTML =
    `<tr><td colspan="${cols}" style="text-align:center;padding:20px;color:var(--text-3)">
      <div class="spinner" style="display:inline-block;margin-right:8px"></div>${msg}
    </td></tr>`;
}

function showError(tbodyId, cols, msg) {
  document.getElementById(tbodyId).innerHTML =
    `<tr><td colspan="${cols}" style="text-align:center;padding:20px;color:var(--up)">${msg}</td></tr>`;
}
