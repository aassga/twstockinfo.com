import { reactive } from 'vue';

const MAX_CALLS = 120;

export const apiHealthState = reactive({
  calls: [],
  groups: {},
  counters: {
    started: 0,
    success: 0,
    error: 0,
    cache: 0,
    deduped: 0
  },
  lastUpdatedAt: ''
});

let requestSeq = 0;

export function startApiRequest(path, options = {}) {
  const meta = endpointMeta(path);
  const id = `${Date.now()}-${++requestSeq}`;
  const startedAt = Date.now();
  const group = ensureGroup(meta);

  apiHealthState.counters.started += 1;
  apiHealthState.lastUpdatedAt = new Date(startedAt).toISOString();
  group.total += 1;
  group.inflight += 1;
  group.lastPath = normalizePath(path);
  group.lastStatus = 'loading';
  group.lastUpdatedAt = apiHealthState.lastUpdatedAt;

  pushCall({
    id,
    path: normalizePath(path),
    label: meta.label,
    source: meta.source,
    type: meta.type,
    method: options.method || 'GET',
    status: 'loading',
    startedAt,
    startedAtText: apiHealthState.lastUpdatedAt,
    durationMs: 0,
    httpStatus: '',
    bytes: 0,
    error: ''
  });

  return id;
}

export function recordApiResult(id, result = {}) {
  const call = apiHealthState.calls.find(item => item.id === id);
  if (!call) return;

  const finishedAt = Date.now();
  const group = ensureGroup({
    label: call.label,
    source: call.source,
    type: call.type
  });
  const isError = result.status === 'error';

  call.status = isError ? 'error' : 'success';
  call.durationMs = result.durationMs ?? Math.max(0, finishedAt - call.startedAt);
  call.httpStatus = result.httpStatus || (isError ? '' : 200);
  call.bytes = Number(result.bytes || 0);
  call.error = result.error || '';
  call.finishedAtText = new Date(finishedAt).toISOString();

  group.inflight = Math.max(0, group.inflight - 1);
  group.lastStatus = call.status;
  group.lastDurationMs = call.durationMs;
  group.lastHttpStatus = call.httpStatus;
  group.lastError = call.error;
  group.lastUpdatedAt = call.finishedAtText;
  if (isError) {
    group.error += 1;
    group.lastErrorAt = call.finishedAtText;
    apiHealthState.counters.error += 1;
  } else {
    group.success += 1;
    group.lastSuccessAt = call.finishedAtText;
    apiHealthState.counters.success += 1;
  }
  apiHealthState.lastUpdatedAt = call.finishedAtText;
}

export function recordApiCacheHit(path) {
  const meta = endpointMeta(path);
  const group = ensureGroup(meta);
  const now = new Date().toISOString();

  apiHealthState.counters.cache += 1;
  apiHealthState.lastUpdatedAt = now;
  group.cache += 1;
  group.lastStatus = 'cache';
  group.lastPath = normalizePath(path);
  group.lastUpdatedAt = now;

  pushCall({
    id: `cache-${Date.now()}-${++requestSeq}`,
    path: normalizePath(path),
    label: meta.label,
    source: meta.source,
    type: meta.type,
    method: 'GET',
    status: 'cache',
    startedAt: Date.now(),
    startedAtText: now,
    finishedAtText: now,
    durationMs: 0,
    httpStatus: 'cache',
    bytes: 0,
    error: ''
  });
}

export function recordApiDedupe(path) {
  const meta = endpointMeta(path);
  const group = ensureGroup(meta);
  const now = new Date().toISOString();

  apiHealthState.counters.deduped += 1;
  apiHealthState.lastUpdatedAt = now;
  group.deduped += 1;
  group.lastStatus = 'deduped';
  group.lastPath = normalizePath(path);
  group.lastUpdatedAt = now;
}

export function clearApiHealth() {
  apiHealthState.calls.splice(0);
  Object.keys(apiHealthState.groups).forEach(key => {
    delete apiHealthState.groups[key];
  });
  apiHealthState.counters.started = 0;
  apiHealthState.counters.success = 0;
  apiHealthState.counters.error = 0;
  apiHealthState.counters.cache = 0;
  apiHealthState.counters.deduped = 0;
  apiHealthState.lastUpdatedAt = '';
}

export function endpointMeta(path) {
  const value = String(path || '');

  if (value.includes('/proxy-status')) return meta('proxy', 'Cloudflare Worker', 'Proxy', 'official');
  if (value.includes('/mis/stock/api/getStockInfo.jsp')) return meta('twse-mis', 'TWSE MIS 即時報價', 'TWSE MIS', 'realtime');
  if (value.includes('/yahoo/v8/finance/chart/')) return meta('yahoo-chart', 'Yahoo 走勢圖', 'Yahoo Chart', 'chart');
  if (value.includes('/histock/stock/rank.aspx')) return meta('histock-rank', 'HiStock 排行輔助', 'HiStock', 'supplemental');
  if (value.includes('/histock/stock/chips.aspx')) return meta('histock-chips', 'HiStock 籌碼輔助', 'HiStock', 'supplemental');
  if (value.includes('/finmind/')) return meta('finmind', 'FinMind 財務/籌碼', 'FinMind', 'financial');
  if (value.includes('/tpex/openapi/v1/')) return meta('tpex-openapi', 'TPEX OpenAPI', 'TPEX', 'official');
  if (value.includes('/twse/opendata/') || value.includes('/twse/exchangeReport/')) return meta('twse-openapi', 'TWSE OpenAPI', 'TWSE', 'official');
  if (value.includes('/rwd/zh/fund/')) return meta('twse-institutional', 'TWSE 三大法人', 'TWSE', 'official');
  if (value.includes('/rwd/zh/afterTrading/')) return meta('twse-after-trading', 'TWSE 盤後排行', 'TWSE', 'official');
  if (value.includes('/mops/')) return meta('mops', '公開資訊觀測站', 'MOPS', 'official');

  return meta('other', '其他 API', 'Unknown', 'unknown');
}

function meta(key, label, source, type) {
  return { key, label, source, type };
}

function ensureGroup(meta) {
  if (!apiHealthState.groups[meta.key]) {
    apiHealthState.groups[meta.key] = {
      key: meta.key,
      label: meta.label,
      source: meta.source,
      type: meta.type,
      total: 0,
      success: 0,
      error: 0,
      cache: 0,
      deduped: 0,
      inflight: 0,
      lastStatus: 'idle',
      lastHttpStatus: '',
      lastDurationMs: 0,
      lastError: '',
      lastSuccessAt: '',
      lastErrorAt: '',
      lastPath: '',
      lastUpdatedAt: ''
    };
  }
  return apiHealthState.groups[meta.key];
}

function pushCall(call) {
  apiHealthState.calls.unshift(call);
  if (apiHealthState.calls.length > MAX_CALLS) {
    apiHealthState.calls.splice(MAX_CALLS);
  }
}

function normalizePath(path) {
  try {
    const url = new URL(String(path || ''), 'https://local.invalid');
    url.searchParams.delete('_');
    return `${url.pathname}${url.search}`;
  } catch (_error) {
    return String(path || '').replace(/([?&])_=\d+(&|$)/, '$1').replace(/[?&]$/, '');
  }
}
