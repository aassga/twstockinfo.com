export const config = {
  proxyBase: (import.meta.env.VITE_PROXY_BASE || 'https://twse-proxy.98412060.workers.dev').replace(/\/$/, '')
};

export function getProxyBase() {
  if (!config.proxyBase) {
    throw new Error('尚未設定 Cloudflare Worker proxy');
  }
  return config.proxyBase;
}
