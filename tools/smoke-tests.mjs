import assert from 'node:assert/strict';
import { parseAllStocks, parseOtcStocks } from '../src/api/stockParsers.js';
import { buildStrategyBacktest } from '../src/utils/backtest.js';
import { getSector } from '../src/utils/stockMeta.js';

const importantCodes = ['2330', '3105', '3289', '00631L', '00830'];

function testSectors() {
  assert.equal(getSector('2330'), '半導體');
  assert.equal(getSector('00631L'), 'ETF');
  assert.equal(getSector('00830'), 'ETF');
  assert.ok(getSector('3105'));
  assert.ok(getSector('3289'));
}

function testTwseParser() {
  const rows = parseAllStocks([
    {
      Code: '2330',
      Name: '台積電',
      ClosingPrice: '2465.00',
      Change: '+25.00',
      TradeVolume: '28136000',
      TradeValue: '69355240000',
      Transaction: '33120',
      OpeningPrice: '2440.00',
      HighestPrice: '2475.00',
      LowestPrice: '2415.00',
      LastBestBidPrice: '2465.00',
      LastBestAskPrice: '2470.00'
    },
    {
      Code: '00631L',
      Name: '元大台灣50正2',
      ClosingPrice: '38.42',
      Change: '-0.56',
      TradeVolume: '1882000',
      TradeValue: '72306440',
      Transaction: '2812'
    },
    {
      Code: '00830',
      Name: '國泰費城半導體',
      ClosingPrice: '99.85',
      Change: '+2.05',
      TradeVolume: '10979000',
      TradeValue: '1096253150',
      Transaction: '9820'
    }
  ]);

  const byCode = new Map(rows.map(row => [row.code, row]));
  assert.equal(byCode.get('2330')?.name, '台積電');
  assert.equal(byCode.get('00631L')?.exchange, 'tse');
  assert.equal(byCode.get('00830')?.price, 99.85);
  assert.equal(Math.round(byCode.get('2330')?.volume), 28136000);
}

function testTpexParser() {
  const rows = parseOtcStocks([
    {
      SecuritiesCompanyCode: '3105',
      CompanyName: '穩懋',
      Close: '408.75',
      Change: '-12.25',
      TradingShares: '5895000',
      TransactionAmount: '2409778125',
      TransactionNumber: '12232',
      Open: '421.00',
      High: '423.00',
      Low: '407.50'
    },
    {
      SecuritiesCompanyCode: '3289',
      CompanyName: '宜特',
      Close: '180.00',
      Change: '+9.50',
      TradingShares: '7757000',
      TransactionAmount: '1396260000',
      TransactionNumber: '8888'
    }
  ]);

  const byCode = new Map(rows.map(row => [row.code, row]));
  assert.equal(byCode.get('3105')?.name, '穩懋');
  assert.equal(byCode.get('3105')?.exchange, 'otc');
  assert.equal(byCode.get('3289')?.price, 180);
  assert.ok(byCode.get('3289')?.chgPct > 0);
}

function testBacktestSignals() {
  const base = Date.parse('2026-01-01T00:00:00+08:00');
  const day = 24 * 60 * 60 * 1000;
  const candles = Array.from({ length: 45 }, (_, index) => {
    const close = index < 24 ? 100 + index * 0.15 : 104 + (index - 24) * 0.9;
    const volume = index === 24 ? 2800 : 1000 + index * 8;
    return {
      time: base + index * day,
      open: close - 0.4,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume
    };
  });
  candles[24] = {
    ...candles[24],
    close: candles[23].close * 1.025,
    open: candles[23].close * 1.01,
    high: candles[23].close * 1.03,
    low: candles[23].close
  };
  candles[30] = {
    ...candles[30],
    close: candles[29].close * 0.985,
    volume: 400
  };

  const results = buildStrategyBacktest({ candles });
  const byKey = new Map(results.map(row => [row.key, row]));
  assert.ok(byKey.get('strongBuy').events.length >= 1);
  assert.ok(byKey.get('downVolumeDry').events.length >= 1);
  assert.equal(byKey.get('strongBuy').windows.find(row => row.days === 1).samples > 0, true);
}

testSectors();
testTwseParser();
testTpexParser();
testBacktestSignals();

console.log(`Smoke tests passed: ${importantCodes.join(', ')}`);
