import assert from 'node:assert/strict';
import {
  exportLocalData,
  importLocalData,
  readCollection,
  removeCollection,
  writeCollection
} from '../src/repositories/localDataRepository.js';

function createStorage() {
  const data = new Map();
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    clear: () => data.clear()
  };
}

global.window = {
  localStorage: createStorage(),
  sessionStorage: createStorage()
};

writeCollection('portfolioHoldings', [
  { id: 'h1', code: '2330', name: '台積電', buyPrice: 580, shares: 1000 }
]);
writeCollection('favorites', [
  { code: '3105', name: '穩懋' }
]);
writeCollection('notifications', [
  { id: 'n1', code: '3289', title: '測試通知' }
]);
writeCollection('activeStockCode', '00631L');
writeCollection('misOutageUntil', 12345);

assert.equal(readCollection('portfolioHoldings')[0].code, '2330');
assert.equal(readCollection('favorites')[0].code, '3105');
assert.equal(readCollection('notifications')[0].code, '3289');
assert.equal(readCollection('activeStockCode'), '00631L');
assert.equal(readCollection('misOutageUntil'), 12345);

const backup = exportLocalData();
assert.equal(backup.schema, 'twstockinfo.local-data.v1');
assert.equal(backup.collections.portfolioHoldings.data[0].name, '台積電');

removeCollection('portfolioHoldings');
assert.deepEqual(readCollection('portfolioHoldings'), []);

const written = importLocalData(backup);
assert.ok(written.includes('portfolioHoldings'));
assert.equal(readCollection('portfolioHoldings')[0].code, '2330');

console.log('Local data repository tests passed');
