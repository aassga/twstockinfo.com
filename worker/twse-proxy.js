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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

const TWSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer':    'https://mis.twse.com.tw/',
  'Accept':     'application/json, text/plain, */*',
};

// 白名單：只允許打這些 domain
const ALLOWED_UPSTREAM = [
  'openapi.twse.com.tw',
  'mis.twse.com.tw',
  'www.twse.com.tw',
];

export default {
  async fetch(request) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url    = new URL(request.url);
    const route  = url.pathname; // e.g. /twse/exchangeReport/MI_INDEX
    const params = url.search;   // e.g. ?ex_ch=tse_2330.tw

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
      return proxyFetch(upstream);
    }

    // ── Route: /claude  → Anthropic API ──
    if (route === '/claude' && request.method === 'POST') {
      const apiKey = request.headers.get('X-Api-Key') || '';
      if (!apiKey.startsWith('sk-ant-')) {
        return jsonResp({ error: 'Invalid API key' }, 401);
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

async function proxyFetch(upstream) {
  try {
    const resp = await fetch(upstream, { headers: TWSE_HEADERS });
    const body = await resp.text();
    return new Response(body, {
      status:  resp.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
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
