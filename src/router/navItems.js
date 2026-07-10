import {
  IconAdjustmentsHorizontal,
  IconBell,
  IconBrain,
  IconBriefcase,
  IconBuildingBank,
  IconChartLine,
  IconDatabaseSearch,
  IconDots,
  IconFlame,
  IconLayoutDashboard,
  IconReportAnalytics,
  IconSearch,
  IconSettings,
  IconScale,
  IconStar,
  IconTable
} from '@tabler/icons-vue';

export const navItems = [
  { path: '/quote', label: '即時報價', icon: IconChartLine },
  { path: '/hot100', label: '前100熱門', icon: IconFlame },
  { path: '/top-volume', label: '成交量前20', icon: IconTable },
  { path: '/search', label: '股票搜尋', icon: IconSearch },
  { path: '/complete-analysis', label: '完整分析', icon: IconLayoutDashboard },
  { path: '/fundamental', label: '基本面分析', icon: IconReportAnalytics },
  { path: '/institutional', label: '三大法人', icon: IconBuildingBank },
  { path: '/margin', label: '信用籌碼', icon: IconScale },
  { path: '/chart', label: '走勢圖', icon: IconAdjustmentsHorizontal },
  { path: '/portfolio', label: '我的持股', icon: IconBriefcase },
  { path: '/favorites', label: '我的最愛', icon: IconStar },
  { path: '/alerts', label: '買賣提醒', icon: IconBell },
  { path: '/ai', label: 'AI 分析', icon: IconBrain },
  { path: '/more', label: '更多', icon: IconDots, hidden: true },
  { path: '/data-health', label: '資料健康', icon: IconDatabaseSearch, hidden: true },
  { path: '/settings', label: '設定', icon: IconSettings, hidden: true }
];

export const visibleNavItems = navItems.filter(item => !item.hidden);

export const mobileMainNavItems = [
  { path: '/quote', label: '報價', icon: IconChartLine },
  { path: '/search', label: '搜尋', icon: IconSearch },
  { path: '/complete-analysis', label: '分析', icon: IconLayoutDashboard },
  { path: '/portfolio', label: '持股', icon: IconBriefcase },
  { path: '/more', label: '更多', icon: IconDots }
];

export const moreNavItems = [
  { path: '/chart', label: '走勢圖', icon: IconAdjustmentsHorizontal, description: 'K 線、技術指標與量價觀察' },
  { path: '/hot100', label: '前100熱門', icon: IconFlame, description: '依成交量與買賣力道整理熱門台股' },
  { path: '/top-volume', label: '成交量前20', icon: IconTable, description: '每日成交量前二十名證券' },
  { path: '/fundamental', label: '基本面分析', icon: IconReportAnalytics, description: '財報、估值、股利與同業比較' },
  { path: '/institutional', label: '三大法人', icon: IconBuildingBank, description: '法人買賣超與籌碼趨勢' },
  { path: '/margin', label: '信用籌碼', icon: IconScale, description: '融資融券、借券與短線籌碼風險' },
  { path: '/favorites', label: '我的最愛', icon: IconStar, description: '收藏個股快速追蹤' },
  { path: '/alerts', label: '買賣提醒', icon: IconBell, description: '高買入、高賣出與量價訊號' },
  { path: '/ai', label: 'AI 分析', icon: IconBrain, description: '個股摘要與分析輔助' },
  { path: '/data-health', label: '資料健康', icon: IconDatabaseSearch, description: '檢查 Proxy、快取、失敗來源與最近 API 請求' },
  { path: '/settings', label: '設定', icon: IconSettings, description: 'Worker 與系統資訊' }
];
