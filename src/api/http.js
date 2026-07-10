import { getProxyBase } from '../config';
import {
  recordApiCacheHit,
  recordApiDedupe,
  recordApiResult,
  startApiRequest
} from './apiHealth';

const inflightTextRequests = new Map();
const textCache = new Map();

export async function apiFetch(path, options = {}) {
  const text = await apiTextFetch(path, options);

  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`API 回傳不是有效 JSON：${text.slice(0, 120)}`);
  }
}

export async function apiTextFetch(path, options = {}) {
  const cacheKey = buildRequestKey(path);
  const ttl = Number.isFinite(options.ttlMs) ? options.ttlMs : cacheTtlFor(path);
  const now = Date.now();
  const cached = textCache.get(cacheKey);

  if (ttl > 0 && cached && now - cached.at < ttl) {
    recordApiCacheHit(path);
    return cached.text;
  }

  if (inflightTextRequests.has(cacheKey)) {
    recordApiDedupe(path);
    return inflightTextRequests.get(cacheKey);
  }

  const requestId = startApiRequest(path);
  const startedAt = Date.now();
  const promise = fetchTextWithFallbacks(path)
    .then(text => {
      if (ttl > 0) {
        textCache.set(cacheKey, { at: Date.now(), text });
      }
      recordApiResult(requestId, {
        status: 'success',
        durationMs: Date.now() - startedAt,
        bytes: text.length
      });
      return text;
    })
    .catch(error => {
      recordApiResult(requestId, {
        status: 'error',
        durationMs: Date.now() - startedAt,
        httpStatus: extractStatus(error),
        error: error?.message || String(error)
      });
      throw error;
    })
    .finally(() => {
      inflightTextRequests.delete(cacheKey);
    });

  inflightTextRequests.set(cacheKey, promise);
  return promise;
}

export function clearApiHttpCache() {
  inflightTextRequests.clear();
  textCache.clear();
}

export function getApiHttpCacheStats() {
  return {
    inflight: inflightTextRequests.size,
    cached: textCache.size
  };
}

async function fetchTextWithFallbacks(path) {
  if (path.startsWith('/finmind/')) {
    const directText = await fetchFinMindDirect(path).catch(() => '');
    if (directText) return directText;
  }

  const response = await fetch(`${getProxyBase()}${path}`);
  const text = await response.text();

  if (!response.ok) {
    if (path.startsWith('/finmind/')) {
      const fallbackText = await fetchFinMindDirect(path).catch(() => '');
      if (fallbackText) return fallbackText;
    }

    if (path.startsWith('/tpex/openapi/v1/')) {
      const fallbackText = await fetchTpexReaderFallback(path).catch(() => '');
      if (fallbackText) return fallbackText;
    }

    if (path.startsWith('/yahoo/') && response.status === 404) {
      throw new Error('Worker 尚未部署 /yahoo/* 走勢圖代理');
    }
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
  }

  return text;
}

function extractStatus(error) {
  const match = String(error?.message || '').match(/HTTP\s+(\d{3})/);
  return match ? Number(match[1]) : '';
}

function buildRequestKey(path) {
  try {
    const url = new URL(path, 'https://local.invalid');
    url.searchParams.delete('_');
    url.searchParams.sort();
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch (_error) {
    return String(path || '').replace(/([?&])_=\d+(&|$)/, '$1').replace(/[?&]$/, '');
  }
}

function cacheTtlFor(path) {
  const value = String(path || '');

  if (value.includes('/proxy-status')) return 60_000;
  if (value.includes('/mis/stock/api/getStockInfo.jsp')) return 5_000;
  if (value.includes('/yahoo/v8/finance/chart/')) return 15_000;
  if (value.includes('/histock/stock/rank.aspx')) return 15_000;
  if (value.includes('/histock/stock/chips.aspx')) return 5 * 60_000;
  if (value.includes('/rwd/zh/fund/')) return 3 * 60_000;
  if (value.includes('/rwd/zh/afterTrading/MI_INDEX20')) return 5 * 60_000;
  if (value.includes('/twse/exchangeReport/STOCK_DAY_ALL')) return 10 * 60_000;
  if (value.includes('/twse/exchangeReport/BWIBBU_ALL')) return 10 * 60_000;
  if (value.includes('/twse/exchangeReport/MI_INDEX')) return 15_000;
  if (value.includes('/twse/opendata/') || value.includes('/tpex/openapi/v1/')) return 10 * 60_000;
  if (value.includes('/finmind/')) return 10 * 60_000;

  return 0;
}

async function fetchFinMindDirect(path) {
  const response = await fetch(`https://api.finmindtrade.com${path.replace('/finmind', '')}`);
  const text = await response.text();
  return response.ok ? text : '';
}

async function fetchTpexReaderFallback(path) {
  const upstream = `https://www.tpex.org.tw${path.replace('/tpex', '')}`;
  const readerUrls = [
    `https://r.jina.ai/http://r.jina.ai/http://${upstream}`,
    `https://r.jina.ai/http://${upstream}`
  ];

  for (const url of readerUrls) {
    const response = await fetch(url);
    const text = await response.text();
    const jsonText = extractReaderJson(text);

    if (response.ok && jsonText) return jsonText;
  }

  return '';
}

function extractReaderJson(text) {
  const source = String(text || '');
  const marker = 'Markdown Content:';
  const content = source.includes(marker) ? source.slice(source.indexOf(marker) + marker.length) : source;
  const starts = [content.indexOf('['), content.indexOf('{')].filter(index => index >= 0);

  if (!starts.length) return '';

  let json = content.slice(Math.min(...starts)).trim();
  json = json.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  try {
    JSON.parse(json);
    return json;
  } catch (_error) {
    return '';
  }
}
