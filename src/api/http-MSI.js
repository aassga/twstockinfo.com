import { getProxyBase } from '../config';

export async function apiFetch(path) {
  const text = await apiTextFetch(path);

  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`回應不是 JSON：${text.slice(0, 120)}`);
  }
}

export async function apiTextFetch(path) {
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

async function fetchFinMindDirect(path) {
  const response = await fetch(`https://api.finmindtrade.com${path.replace('/finmind', '')}`);
  const text = await response.text();
  return response.ok ? text : '';
}

async function fetchTpexReaderFallback(path) {
  const upstream = `https://www.tpex.org.tw${path.replace('/tpex', '')}`;
  const readerUrls = [
    `https://r.jina.ai/http://r.jina.ai/http://${upstream}`,
    `https://r.jina.ai/http://${upstream}`,
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
