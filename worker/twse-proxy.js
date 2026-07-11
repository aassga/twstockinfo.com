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
  'Accept':          'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
  'X-Requested-With': 'XMLHttpRequest',
};

const MIS_RETRY_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer':         'https://mis.twse.com.tw/stock/index.jsp',
  'Accept':          'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json, text/plain, */*',
};

const FINMIND_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json, text/plain, */*',
};

const TPEX_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer':         'https://www.tpex.org.tw/openapi/',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
};

const TPEX_RETRY_HEADERS = {
  'User-Agent':      'curl/8.0',
  'Accept':          'application/json',
  'Accept-Language': 'zh-TW,zh;q=0.9',
};

const TPEX_READER_CACHE_SECONDS = 10 * 60;

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
  'api.finmindtrade.com',
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
        version: '2026-07-11-health-v1',
        updatedAt: '2026-07-11',
        features: {
          twseOpenApi: true,
          twseRwd: true,
          twseMis: true,
          tpex: true,
          tpexReaderFallback: true,
          finmind: true,
          histock: true,
          sinotrade: true,
          yahooChart: true,
          claude: true,
        },
      });
    }

    // ── Route: /tpex-test → diagnostics for Cloudflare Worker to TPEX fetch ──
    if (route === '/tpex-test') {
      const upstream = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis';
      const startedAt = Date.now();
      try {
        const resp = await fetch(upstream, {
          headers: TPEX_HEADERS,
          redirect: 'manual',
          cf: { cacheTtl: 0, cacheEverything: false },
        });
        const body = await resp.text();
        return jsonResp({
          ok: resp.ok,
          upstream,
          status: resp.status,
          statusText: resp.statusText,
          location: resp.headers.get('Location'),
          contentType: resp.headers.get('Content-Type'),
          contentLength: body.length,
          sample: body.slice(0, 160),
          elapsedMs: Date.now() - startedAt,
        }, resp.ok ? 200 : 502);
      } catch (e) {
        return jsonResp({
          ok: false,
          upstream,
          errorName: e?.name || '',
          errorMessage: e?.message || String(e),
          elapsedMs: Date.now() - startedAt,
        }, 502);
      }
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
      return proxyFetch(upstream, MIS_HEADERS, 'application/json; charset=utf-8', [MIS_RETRY_HEADERS]);
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

    // ── Route: /finmind/*  → api.finmindtrade.com/* ──
    if (route.startsWith('/finmind/')) {
      const path = route.replace('/finmind', '');
      const upstream = `https://api.finmindtrade.com${path}${params}`;
      return proxyFetch(upstream, FINMIND_HEADERS);
    }

    // ── Route: /tpex/*  → www.tpex.org.tw/* ──
    if (route.startsWith('/tpex/openapi/v1/')) {
      const upstream = `https://www.tpex.org.tw${route.replace('/tpex', '')}`;
      try {
        const resp = await fetch(upstream, {
          headers: TPEX_HEADERS,
          redirect: 'manual',
          cf: { cacheTtl: 0, cacheEverything: false },
        });
        const body = await resp.text();

        if (resp.ok) {
          return new Response(body, {
            status: resp.status,
            headers: {
              'Content-Type': resp.headers.get('Content-Type') || 'application/json; charset=utf-8',
              ...CORS_HEADERS,
            },
          });
        }

        return proxyTpexReaderFetch(upstream, {
          status: resp.status,
          statusText: resp.statusText,
          location: resp.headers.get('Location') || '',
          body: body.slice(0, 300),
        });
      } catch (e) {
        return proxyTpexReaderFetch(upstream, {
          error: e?.message || String(e),
          errorName: e?.name || '',
        });
      }
    }

    if (route.startsWith('/tpex/')) {
      const path = route.replace('/tpex', '');
      const upstream = `https://www.tpex.org.tw${path}${params}`;
      return proxyTpexFetch(upstream);
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

async function proxyFetch(
  upstream,
  headers = TWSE_HEADERS,
  fallbackContentType = 'application/json; charset=utf-8',
  retryHeaders = [],
  redirect = 'manual'
) {
  try {
    const attempts = [headers, ...retryHeaders];
    let lastResp = null;
    let lastBody = '';

    for (const attemptHeaders of attempts) {
      const resp = await fetch(upstream, {
        headers: attemptHeaders,
        redirect,
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      const body = await resp.text();
      lastResp = resp;
      lastBody = body;
      if (resp.status < 500) break;
    }

    return new Response(lastBody, {
      status:  lastResp.status,
      headers: {
        'Content-Type': lastResp.headers.get('Content-Type') || fallbackContentType,
        ...CORS_HEADERS,
      },
    });
  } catch (e) {
    return jsonResp({
      error: e?.message || String(e),
      errorName: e?.name || '',
      upstream,
    }, 502);
  }
}

async function proxyTpexFetch(upstream) {
  const attempts = [TPEX_HEADERS, TPEX_RETRY_HEADERS];
  let lastStatus = 502;
  let lastStatusText = '';
  let lastLocation = '';
  let lastBody = '';
  let lastContentType = 'application/json; charset=utf-8';

  for (const headers of attempts) {
    try {
      const resp = await fetch(upstream, {
        headers,
        redirect: 'manual',
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      const body = await resp.text();
      lastStatus = resp.status;
      lastStatusText = resp.statusText;
      lastLocation = resp.headers.get('Location') || '';
      lastBody = body;
      lastContentType = resp.headers.get('Content-Type') || lastContentType;

      if (resp.ok) {
        return new Response(body, {
          status: resp.status,
          headers: { 'Content-Type': lastContentType, ...CORS_HEADERS },
        });
      }
    } catch (e) {
      lastBody = JSON.stringify({
        error: e?.message || String(e),
        errorName: e?.name || '',
        upstream,
      });
      lastStatusText = e?.name || '';
    }
  }

  return jsonResp({
    error: 'TPEX upstream request failed',
    upstream,
    status: lastStatus,
    statusText: lastStatusText,
    location: lastLocation,
    body: lastBody.slice(0, 300),
  }, 502);
}

async function proxyTpexReaderFetch(upstream, directFailure = {}) {
  const cache = caches.default;
  const cacheKey = new Request(`https://worker-cache.local/tpex-reader/${encodeURIComponent(upstream)}`);
  const cached = await cache.match(cacheKey);

  if (cached) return cached;

  const readerUrls = [
    `https://r.jina.ai/http://r.jina.ai/http://${upstream}`,
    `https://r.jina.ai/http://${upstream}`,
  ];
  let lastReaderFailure = null;

  for (const readerUrl of readerUrls) {
    try {
    const resp = await fetch(readerUrl, {
      headers: {
        'User-Agent': TPEX_HEADERS['User-Agent'],
        'Accept': 'text/plain, */*',
      },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    const text = await resp.text();
    const jsonText = extractReaderJson(text);

    if (resp.ok && jsonText) {
      const response = new Response(jsonText, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${TPEX_READER_CACHE_SECONDS}`,
          'X-TPEX-Source': 'jina-reader-fallback',
          ...CORS_HEADERS,
        },
      });
      await cache.put(cacheKey, response.clone());
      return response;
    }

      lastReaderFailure = {
      readerStatus: resp.status,
      readerStatusText: resp.statusText,
      readerSample: text.slice(0, 300),
      readerUrl,
      };
    } catch (e) {
      lastReaderFailure = {
        error: e?.message || String(e),
        errorName: e?.name || '',
        readerUrl,
      };
    }
  }

  return jsonResp({
    error: 'TPEX reader fallback failed',
    upstream,
    directFailure,
    readerFailure: lastReaderFailure,
  }, 502);
}

function extractReaderJson(text) {
  const source = String(text || '');
  const marker = 'Markdown Content:';
  const markerIndex = source.indexOf(marker);
  const content = markerIndex >= 0 ? source.slice(markerIndex + marker.length) : source;
  const arrayIndex = content.indexOf('[');
  const objectIndex = content.indexOf('{');
  const candidates = [arrayIndex, objectIndex].filter(index => index >= 0);

  if (!candidates.length) return '';

  const start = Math.min(...candidates);
  let json = content.slice(start).trim();
  json = json.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  try {
    JSON.parse(json);
    return json;
  } catch (_e) {
    return '';
  }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
