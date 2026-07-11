import assert from 'node:assert/strict';
import { parseAllStocks, parseOtcStocks } from '../src/api/stockParsers.js';
import { getSector } from '../src/utils/stockMeta.js';

const IMPORTANT_CODES = ['2330', '3105', '3289', '00631L', '00830'];

function byCode(rows) {
  return new Map(rows.map(row => [row.code, row]));
}

function testImportantTwseStocks() {
  const rows = parseAllStocks([
    {
      Code: '2330',
      Name: '台積電',
      ClosingPrice: '2,465.00',
      Change: '＋25.00',
      TradeVolume: '28,136,000',
      TradeValue: '69,355,240,000',
      Transaction: '33,120',
      OpeningPrice: '2,440.00',
      HighestPrice: '2,475.00',
      LowestPrice: '2,415.00',
      LastBestBidPrice: '2,465.00',
      LastBestAskPrice: '2,470.00'
    },
    {
      Code: '00631L',
      Name: '元大台灣50正2',
      ClosingPrice: '38.42',
      Change: '−0.56',
      TradeVolume: '1,882,000',
      TradeValue: '72,306,440',
      Transaction: '2,812'
    },
    {
      Code: '00830',
      Name: '國泰費城半導體',
      ClosingPrice: '99.85',
      Change: '+2.05',
      TradeVolume: '10,979,000',
      TradeValue: '1,096,253,150',
      Transaction: '9,820'
    },
    {
      Code: 'BAD',
      Name: '錯誤資料',
      ClosingPrice: '100',
      Change: '+1',
      TradeVolume: '1'
    }
  ]);

  const stocks = byCode(rows);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].code, '2330', '上市 parser 應依成交量排序');
  assert.equal(stocks.get('2330')?.name, '台積電');
  assert.equal(stocks.get('2330')?.exchange, 'tse');
  assert.equal(stocks.get('2330')?.price, 2465);
  assert.equal(stocks.get('2330')?.change, 25);
  assert.equal(stocks.get('2330')?.volume, 28136000);
  assert.equal(stocks.get('00631L')?.change, -0.56);
  assert.equal(stocks.get('00830')?.amountHundredMillion, 10.96);
}

function testImportantOtcStocks() {
  const rows = parseOtcStocks([
    {
      SecuritiesCompanyCode: '3105',
      CompanyName: '穩懋',
      Close: '408.75',
      Change: '－12.25',
      TradingShares: '5,895,000',
      TransactionAmount: '2,409,778,125',
      TransactionNumber: '12,232',
      Open: '421.00',
      High: '423.00',
      Low: '407.50'
    },
    {
      SecuritiesCompanyCode: '3289',
      CompanyName: '宜特',
      Close: '180.00',
      Change: '+9.50',
      TradingShares: '7,757,000',
      TransactionAmount: '1,396,260,000',
      TransactionNumber: '8,888',
      LatestBidPrice: '179.50',
      LatestAskPrice: '180.00'
    },
    {
      SecuritiesCompanyCode: '7777',
      CompanyName: '',
      Close: '100',
      Change: '+1',
      TradingShares: '10'
    }
  ]);

  const stocks = byCode(rows);
  assert.equal(rows.length, 2);
  assert.equal(stocks.get('3105')?.name, '穩懋');
  assert.equal(stocks.get('3105')?.exchange, 'otc');
  assert.equal(stocks.get('3105')?.change, -12.25);
  assert.equal(stocks.get('3105')?.volume, 5895000);
  assert.equal(stocks.get('3289')?.price, 180);
  assert.equal(stocks.get('3289')?.bid, 179.5);
  assert.ok(stocks.get('3289')?.chgPct > 0);
}

function testImportantMetadata() {
  assert.equal(getSector('2330'), '半導體');
  assert.equal(getSector('00631L'), 'ETF');
  assert.equal(getSector('00830'), 'ETF');
  for (const code of IMPORTANT_CODES) {
    assert.ok(getSector(code), `${code} 應有分類`);
  }
}

testImportantTwseStocks();
testImportantOtcStocks();
testImportantMetadata();

console.log(`API parser tests passed: ${IMPORTANT_CODES.join(', ')}`);
