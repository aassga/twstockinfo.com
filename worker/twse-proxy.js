/**
 * Cloudflare Worker — TWSE CORS Proxy
 *
 * 部署步驟：
 * 1. 前往 https://workers.cloudflare.com/ 免費註冊
 * 2. 建立新 Worker，貼上此程式碼，點 Deploy
 * 3. 複製 Worker 網址（例如 https://twse-proxy.yourname.workers.dev）
 * 4. 填入 js/config.js 的 PROXY_BASE
 *
 * 免費方案：每天 100,000 次請求，足夠個人使用
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

const TWSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer':    'https://mis.twse.com.tw/',
  'Accept':     'application/json, text/plain, */*',
};

const MIS_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer':         'https://mis.twse.com.tw/stock/index.jsp',
  'Origin':          'https://mis.twse.com.tw',
  'Accept':          'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
  'X-Requested-With': 'XMLHttpRequest',
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json, text/plain, */*',
};

const TPEX_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer':         'https://www.tpex.org.tw/',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

const HISTOCK_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer':         'https://histock.tw/',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

const SINOTRADE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer':         'https://www.sinotrade.com.tw/richclub/',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

// 白名單：只允許打這些 domain
const ALLOWED_UPSTREAM = [
  'openapi.twse.com.tw',
  'mis.twse.com.tw',
  'www.twse.com.tw',
  'www.tpex.org.tw',
  'www.sinotrade.com.tw',
  'query1.finance.yahoo.com',
  'histock.tw',
];

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url    = new URL(request.url);
    const route  = url.pathname; // e.g. /twse/exchangeReport/MI_INDEX
    const params = url.search;   // e.g. ?ex_ch=tse_2330.tw

    // ── Route: /claude-status  → safe diagnostics, no secret value exposed ──
    if (route === '/claude-status') {
      const hasWorkerSecret = Boolean(env?.ANTHROPIC_API_KEY);
      return jsonResp({
        ok: true,
        anthropicSecretConfigured: hasWorkerSecret,
        keySource: hasWorkerSecret ? 'worker_secret' : 'request_header_or_missing',
      });
    }

    // ── Route: /proxy-status  → safe feature diagnostics ──
    if (route === '/proxy-status') {
      return jsonResp({
        ok: true,
        features: {
          twseOpenApi: true,
          twseRwd: true,
          twseMis: true,
          yahooChart: true,
          claude: true,
        },
      });
    }

    // ── Route: /twse/*  → openapi.twse.com.tw ──
    if (route.startsWith('/twse/')) {
      const path     = route.replace('/twse/', '/v1/');
      const upstream = `https://openapi.twse.com.tw${path}${params}`;
      return proxyFetch(upstream);
    }

    // ── Route: /mis/*  → mis.twse.com.tw ──
    if (route.startsWith('/mis/')) {
      const path     = route.replace('/mis', '');
      const upstream = `https://mis.twse.com.tw${path}${params}`;
      return proxyFetch(upstream, MIS_HEADERS);
    }

    // ── Route: /rwd/*  → www.twse.com.tw/rwd/* ──
    if (route.startsWith('/rwd/')) {
      const upstream = `https://www.twse.com.tw${route}${params}`;
      return proxyFetch(upstream);
    }

    // ── Route: /yahoo/*  → query1.finance.yahoo.com/* ──
    if (route.startsWith('/yahoo/')) {
      const path = route.replace('/yahoo', '');
      const upstream = `https://query1.finance.yahoo.com${path}${params}`;
      return proxyFetch(upstream, YAHOO_HEADERS);
    }

    // ── Route: /tpex/*  → www.tpex.org.tw/* ──
    if (route.startsWith('/tpex/')) {
      const path = route.replace('/tpex', '');
      const upstream = `https://www.tpex.org.tw${path}${params}`;
      return proxyFetch(upstream, TPEX_HEADERS);
    }

    // ── Route: /histock/*  → histock.tw/* ──
    // Used for per-stock institutional investor chips, matching the Wantgoo-style lot unit.
    if (route.startsWith('/histock/')) {
      const path = route.replace('/histock', '');
      const upstream = `https://histock.tw${path}${params}`;
      return proxyFetch(upstream, HISTOCK_HEADERS, 'text/html; charset=utf-8');
    }

    // ── Route: /sinotrade/*  → www.sinotrade.com.tw/* ──
    if (route.startsWith('/sinotrade/')) {
      const path = route.replace('/sinotrade', '');
      const upstream = `https://www.sinotrade.com.tw${path}${params}`;
      return proxyFetch(upstream, SINOTRADE_HEADERS, 'text/html; charset=utf-8');
    }

    // ── Route: /claude  → Anthropic API ──
    if (route === '/claude' && request.method === 'POST') {
      const apiKey = env?.ANTHROPIC_API_KEY || request.headers.get('X-Api-Key') || '';
      if (!apiKey.startsWith('sk-ant-')) {
        return jsonResp({
          error: {
            type: 'missing_api_key',
            message: 'Anthropic API Key 尚未設定。請在 Cloudflare Worker Secrets 設定 ANTHROPIC_API_KEY。',
          },
        }, 401);
      }
      const body = await request.text();
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'Content-Type':       'application/json',
          'x-api-key':          apiKey,
          'anthropic-version':  '2023-06-01',
        },
        body,
      });
      const data = await resp.text();
      return new Response(data, {
        status:  resp.status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    return jsonResp({ error: 'Not found' }, 404);
  }
};

async function proxyFetch(upstream, headers = TWSE_HEADERS, fallbackContentType = 'application/json; charset=utf-8') {
  try {
    const resp = await fetch(upstream, { headers });
    const body = await resp.text();
    return new Response(body, {
      status:  resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || fallbackContentType,
        ...CORS_HEADERS,
      },
    });
  } catch (e) {
    return jsonResp({ error: e.message }, 502);
  }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
