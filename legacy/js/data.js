// js/data.js — 真實 API 版：只放靜態對照表，不再有 MOCK 資料

// 產業別對照（TWSE 沒有直接提供，用代號前綴推斷）
const SECTOR_MAP = {
  '00': 'ETF',
  '11': '水泥', '12': '食品', '13': '塑膠', '14': '紡織',
  '15': '電機', '16': '電纜', '17': '化學', '18': '玻璃',
  '19': '造紙', '20': '鋼鐵', '21': '橡膠', '22': '汽車',
  '23': '電子', '24': '建材', '25': '航運', '26': '觀光',
  '27': '金融', '28': '貿易', '29': '綜合',
  '2330': '半導體', '2317': '電子', '2454': 'IC設計',
  '2382': '電腦', '3008': '光學', '2308': '電源',
  '6669': '伺服器', '2345': '網路', '3034': 'IC設計',
  '3533': '連接器', '2379': 'IC設計',
};

function getSector(code) {
  if (SECTOR_MAP[code]) return SECTOR_MAP[code];
  const prefix2 = code.slice(0, 2);
  if (SECTOR_MAP[prefix2]) return SECTOR_MAP[prefix2];
  const n = parseInt(code);
  if (n >= 2300 && n < 2500) return '電子';
  if (n >= 2800 && n < 2900) return '金融';
  if (n >= 1200 && n < 1300) return '食品';
  if (n >= 1300 && n < 1400) return '石化';
  if (n >= 2600 && n < 2700) return '航運';
  if (n >= 6000)              return '科技';
  return '其他';
}
