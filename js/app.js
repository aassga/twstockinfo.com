// js/app.js — 真實 API 版主應用邏輯

let currentStock   = null;
let allStocksCache = [];
let instCache      = [];

// ─── 初始化 ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initClock();
  loadMarket();
  loadAllStocks();   // 先拉全部股票清單
  setInterval(loadMarket, 30000);   // 大盤每30秒更新
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
      if (tab === 'hot100'  && allStocksCache.length) renderHot100(allStocksCache);
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

// ─── 全域刷新 ─────────────────────────────
function refreshAll() {
  const btn = document.getElementById('refreshBtn');
  btn.style.animation = 'spin 0.7s linear infinite';
  loadMarket();
  loadAllStocks();
  setTimeout(() => { btn.style.animation = ''; }, 2000);
}

// ─── 大盤 ─────────────────────────────────
async function loadMarket() {
  try {
    const d = await TWSE.market();
    const sign = d.sign === '+' || parseFloat(d.change) >= 0;
    document.getElementById('taiex').textContent    = parseFloat(d.taiex).toLocaleString();
    document.getElementById('taiex').className      = 'market-value ' + (sign ? 'up' : 'dn');
    document.getElementById('taiex-chg').textContent =
      (sign ? '▲ +' : '▼ ') + Math.abs(parseFloat(d.change)).toFixed(2) +
      ' (' + (sign ? '+' : '') + parseFloat(d.changePct).toFixed(2) + '%)';
    document.getElementById('taiex-chg').className  = 'market-chg ' + (sign ? 'up' : 'dn');
  } catch(e) {
    console.warn('大盤資料錯誤:', e);
  }
}

// ─── 全部股票（STOCK_DAY_ALL） ────────────
async function loadAllStocks() {
  showLoading('hot100Body', 11, '載入股票資料中...');
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

    renderHot100(allStocksCache);
    renderAlerts();
  } catch(e) {
    console.error('股票清單錯誤:', e);
    showError('hot100Body', 11, '無法取得股票資料，請確認伺服器已啟動');
  }
}

// ─── 搜尋 ─────────────────────────────────
function quickSearch(code) {
  document.getElementById('stockInput').value = code;
  searchStock();
  switchToTab('search');
}

async function searchStock() {
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
  document.getElementById('stockAiContent').innerHTML = '<span class="hint">點擊「AI 深度分析」取得個股分析報告</span>';

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
    chgEl.className = 'result-chg ' + (up ? 'up' : 'dn');

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
  });
}
function analyzeStockTech() {
  if (!currentStock) return;
  const s = currentStock;
  runAI({
    spinnerId: 'stockSpinner', contentId: 'stockAiContent',
    prompt: `台股 ${s.code} ${s.name}，股價 $${s.price}（${s.chgPct >= 0?'+':''}${s.chgPct}%），今日振幅 $${s.low}~$${s.high}。請從技術面分析：1.目前型態 2.支撐壓力 3.量價關係 4.建議觀察的技術訊號。請用繁體中文。`,
  });
}
function analyzeStockRisk() {
  if (!currentStock) return;
  const s = currentStock;
  runAI({
    spinnerId: 'stockSpinner', contentId: 'stockAiContent',
    prompt: `評估台股 ${s.code} ${s.name}（${s.sector}）的風險：買${s.buyPct||s.buy}%，賣${s.sellPct||s.sell}%，外資${s.foreign}億，投信${s.trust}億。請分析：1.籌碼集中度風險 2.法人態度 3.類股系統風險 4.風險等級（低/中/高）。請用繁體中文。`,
  });
}

// ─── 前100熱門 ────────────────────────────
function loadHot100() { renderHot100(allStocksCache); }

function sortHot100() {
  const key = document.getElementById('hot100Sort').value;
  const sorted = [...allStocksCache].sort((a, b) => {
    if (key === 'buy')  return b.buy  - a.buy;
    if (key === 'sell') return b.sell - a.sell;
    if (key === 'chg')  return b.chgPct - a.chgPct;
    return b.volume - a.volume;
  });
  renderHot100(sorted);
}

let hot100Filtered = [];
function filterHot100(btn, filter) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  let list = [...allStocksCache];
  if (filter === 'buy')  list = list.filter(s => s.buy  >= 65);
  if (filter === 'sell') list = list.filter(s => s.sell >= 65);
  if (filter === 'up')   list = list.filter(s => s.chgPct > 0);
  if (filter === 'dn')   list = list.filter(s => s.chgPct < 0);
  renderHot100(list);
}

function renderHot100(list) {
  const tbody = document.getElementById('hot100Body');
  tbody.innerHTML = '';
  const top = list.slice(0, 100);
  if (!top.length) { showError('hot100Body', 11, '暫無資料'); return; }

  top.forEach((s, i) => {
    const up       = s.chgPct >= 0;
    const dominant = s.buy > s.sell;
    const pillCls  = s.buy >= 65 ? 'buy' : s.sell >= 65 ? 'sell' : 'neutral';
    const pillText = s.buy >= 65 ? '強買' : s.sell >= 65 ? '強賣' : '均衡';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--text-3);font-size:12px">${i + 1}</td>
      <td style="font-weight:600">${s.code}</td>
      <td>${s.name} <small style="color:var(--text-3);font-size:11px">${s.sector}</small></td>
      <td style="font-weight:600">$${(s.price||0).toLocaleString()}</td>
      <td class="${up ? 'up' : 'dn'}">${up ? '▲ +' : '▼ '}${Math.abs(s.chgPct||0).toFixed(2)}%</td>
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
      <td class="${up ? 'up' : 'dn'}">${(s.chgPct||0) > 0 ? '+' : ''}${(s.chgPct||0).toFixed(2)}%</td>
      <td><span class="direction-pill ${pillCls}">${pillText}</span></td>
      <td><button class="btn" style="padding:3px 8px;font-size:11px" onclick="event.stopPropagation();quickSearch('${s.code}')">分析</button></td>
    `;
    tr.addEventListener('click', () => quickSearch(s.code));
    tbody.appendChild(tr);
  });
}

function aiPickStocks() {
  const top10 = allStocksCache.slice(0, 10).map(s =>
    `${s.code}${s.name} 買${Math.round(s.buy)}% 賣${Math.round(s.sell)}% 漲跌${s.chgPct >= 0 ? '+' : ''}${(s.chgPct||0).toFixed(2)}%`
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
        <div class="alert-stock-name">${s.code} ${s.name}</div>
        <div class="alert-detail">${s.sector} · ${s.chgPct >= 0 ? '+' : ''}${(s.chgPct||0).toFixed(2)}%</div>
      </div>
      <div class="alert-right">
        <div class="alert-pct ${type === 'buy' ? 'up' : 'dn'}">${pct}%</div>
        <div style="font-size:11px;color:var(--text-3)">${type === 'buy' ? '買入' : '賣出'}佔比</div>
      </div>
    `;
    item.addEventListener('click', () => quickSearch(s.code));
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
async function loadInstitutional() {
  showLoading('instTableBody', 8, '載入三大法人資料...');
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
        <td>${s.name}</td>
        <td>${fmt(s.foreign)}</td>
        <td>${fmt(s.trust)}</td>
        <td>${fmt(s.dealer)}</td>
        <td style="font-weight:600">${fmt(s.total)}</td>
        <td style="font-size:12px;color:var(--text-3)">當日</td>
        <td><span class="direction-pill ${pillCls}">${pillText}</span></td>
      `;
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => quickSearch(s.code));
      tbody.appendChild(tr);
    });
  } catch(e) {
    showError('instTableBody', 8, '無法取得三大法人資料');
    console.error('法人資料錯誤:', e);
  }
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

// ─── 工具函式 ─────────────────────────────
function switchToTab(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
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
