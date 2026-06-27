import { getProxyBase } from '../config';

export async function apiFetch(path) {
  const response = await fetch(`${getProxyBase()}${path}`);
  const text = await response.text();

  if (!response.ok) {
    if (path.startsWith('/yahoo/') && response.status === 404) {
      throw new Error('Worker 尚未部署 /yahoo/* 走勢圖代理');
    }
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`回應不是 JSON：${text.slice(0, 120)}`);
  }
}
