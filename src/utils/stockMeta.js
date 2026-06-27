const SECTOR_MAP = {
  '00': 'ETF',
  '11': '水泥',
  '12': '食品',
  '13': '塑膠',
  '14': '紡織',
  '15': '電機',
  '16': '電器電纜',
  '17': '化學生技',
  '18': '玻璃',
  '19': '造紙',
  '20': '鋼鐵',
  '21': '橡膠',
  '22': '汽車',
  '23': '電子',
  '24': '電子',
  '25': '建材營造',
  '26': '航運',
  '27': '觀光餐旅',
  '28': '金融保險',
  '29': '貿易百貨',
  '30': '電子',
  '31': '電子',
  '32': '電子',
  '33': '電子',
  '34': '電子',
  '35': '電子',
  '36': '電子',
  '37': '電子',
  '38': '電子',
  '39': '資訊服務',
  '23xx': '半導體',
  '2330': '半導體',
  '2317': '其他電子',
  '2454': '半導體',
  '2382': '電腦週邊',
  '3008': '光電',
  '2308': '電子零組件',
  '6669': '半導體',
  '2345': '通信網路',
  '3034': '半導體',
  '3533': '半導體',
  '2379': '半導體'
};

export function getSector(code) {
  const normalized = String(code || '');
  if (SECTOR_MAP[normalized]) return SECTOR_MAP[normalized];
  const prefix = normalized.slice(0, 2);
  if (SECTOR_MAP[prefix]) return SECTOR_MAP[prefix];

  const numeric = Number(normalized);
  if (numeric >= 2300 && numeric < 2500) return '電子';
  if (numeric >= 2800 && numeric < 2900) return '金融保險';
  if (numeric >= 2600 && numeric < 2700) return '航運';
  if (numeric >= 1200 && numeric < 1300) return '食品';
  if (numeric >= 6000) return '上櫃';
  return '其他';
}

export const quickStocks = [
  { code: '2330', name: '台積電' },
  { code: '2454', name: '聯發科' },
  { code: '2317', name: '鴻海' },
  { code: '2382', name: '廣達' },
  { code: '0050', name: '元大台灣50' }
];
