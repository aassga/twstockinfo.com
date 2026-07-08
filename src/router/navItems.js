import {
  IconAdjustmentsHorizontal,
  IconBell,
  IconBrain,
  IconBriefcase,
  IconBuildingBank,
  IconChartLine,
  IconDots,
  IconFlame,
  IconLayoutDashboard,
  IconReportAnalytics,
  IconSearch,
  IconSettings,
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
  { path: '/chart', label: '走勢圖', icon: IconAdjustmentsHorizontal },
  { path: '/portfolio', label: '我的持股', icon: IconBriefcase },
  { path: '/favorites', label: '我的最愛', icon: IconStar },
  { path: '/alerts', label: '買賣提醒', icon: IconBell },
  { path: '/ai', label: 'AI 分析', icon: IconBrain },
  { path: '/more', label: '更多', icon: IconDots, hidden: true },
  { path: '/settings', label: '設定', icon: IconSettings, hidden: true }
];

export const visibleNavItems = navItems.filter(item => !item.hidden);

export const mobileMainNavItems = [
  { path: '/quote', label: '報價', icon: IconChartLine },
  { path: '/search', label: '搜尋', icon: IconSearch },
  { path: '/portfolio', label: '持股', icon: IconBriefcase },
  { path: '/complete-analysis', label: '分析', icon: IconLayoutDashboard },
  { path: '/more', label: '更多', icon: IconDots }
];

export const moreNavItems = [
  { path: '/hot100', label: '前100熱門', icon: IconFlame, description: '成交量與買賣力道排行' },
  { path: '/top-volume', label: '成交量前20', icon: IconTable, description: '每日成交量前二十名證券' },
  { path: '/chart', label: '走勢圖', icon: IconAdjustmentsHorizontal, description: 'K 線、量價與技術指標' },
  { path: '/institutional', label: '三大法人', icon: IconBuildingBank, description: '法人買賣超與籌碼趨勢' },
  { path: '/fundamental', label: '基本面分析', icon: IconReportAnalytics, description: '財務、估值與同業比較' },
  { path: '/favorites', label: '我的最愛', icon: IconStar, description: '收藏股票快速追蹤' },
  { path: '/alerts', label: '買賣提醒', icon: IconBell, description: '高買入與高賣出訊號' },
  { path: '/ai', label: 'AI 分析', icon: IconBrain, description: '市場摘要與本機規則分析' },
  { path: '/settings', label: '設定', icon: IconSettings, description: 'API 與系統設定' }
];
