const COLLECTIONS = {
  portfolioHoldings: {
    domain: 'portfolio',
    name: 'holdings',
    storage: 'local',
    key: 'tw_stock_portfolio_holdings',
    fallback: []
  },
  favorites: {
    domain: 'favorites',
    name: 'stocks',
    storage: 'local',
    key: 'tw_stock_favorites',
    fallback: []
  },
  notifications: {
    domain: 'notifications',
    name: 'items',
    storage: 'local',
    key: 'tw_stock_notifications',
    fallback: []
  },
  activeStockCode: {
    domain: 'stocks',
    name: 'activeCode',
    storage: 'local',
    key: 'twstock.activeCode',
    fallback: ''
  },
  misOutageUntil: {
    domain: 'runtime',
    name: 'misOutageUntil',
    storage: 'session',
    key: 'tw_stock_mis_outage_until',
    fallback: 0
  }
};

export const localDataCollections = Object.freeze(COLLECTIONS);

export function readCollection(collectionKey) {
  const collection = getCollection(collectionKey);
  const storage = getStorage(collection.storage);
  if (!storage) return cloneFallback(collection);

  const raw = storage.getItem(collection.key);
  if (raw === null || raw === undefined || raw === '') return cloneFallback(collection);

  if (typeof collection.fallback === 'string') return String(raw);
  if (typeof collection.fallback === 'number') return Number(raw || collection.fallback);

  try {
    const parsed = JSON.parse(raw);
    return parsed ?? cloneFallback(collection);
  } catch (_error) {
    return cloneFallback(collection);
  }
}

export function writeCollection(collectionKey, value) {
  const collection = getCollection(collectionKey);
  const storage = getStorage(collection.storage);
  if (!storage) return value;

  if (typeof collection.fallback === 'string') {
    storage.setItem(collection.key, String(value || ''));
    return value;
  }

  if (typeof collection.fallback === 'number') {
    storage.setItem(collection.key, String(Number(value || 0)));
    return value;
  }

  storage.setItem(collection.key, JSON.stringify(value ?? collection.fallback));
  return value;
}

export function removeCollection(collectionKey) {
  const collection = getCollection(collectionKey);
  getStorage(collection.storage)?.removeItem(collection.key);
}

export function exportLocalData() {
  const exportedAt = new Date().toISOString();
  const collections = Object.fromEntries(
    Object.entries(COLLECTIONS).map(([key, collection]) => [
      key,
      {
        domain: collection.domain,
        name: collection.name,
        storage: collection.storage,
        legacyKey: collection.key,
        data: readCollection(key)
      }
    ])
  );

  return {
    schema: 'twstockinfo.local-data.v1',
    exportedAt,
    collections
  };
}

export function importLocalData(payload) {
  const collections = payload?.collections || {};
  const written = [];

  for (const [key, value] of Object.entries(collections)) {
    if (!COLLECTIONS[key]) continue;
    writeCollection(key, value?.data ?? value);
    written.push(key);
  }

  return written;
}

function getCollection(collectionKey) {
  const collection = COLLECTIONS[collectionKey];
  if (!collection) throw new Error(`未知的本機資料集合：${collectionKey}`);
  return collection;
}

function getStorage(type) {
  if (typeof window === 'undefined') return null;
  if (type === 'session') return window.sessionStorage || null;
  return window.localStorage || null;
}

function cloneFallback(collection) {
  if (Array.isArray(collection.fallback)) return [...collection.fallback];
  if (collection.fallback && typeof collection.fallback === 'object') return { ...collection.fallback };
  return collection.fallback;
}
