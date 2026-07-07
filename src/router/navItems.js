import {
  IconAdjustmentsHorizontal,
  IconBell,
  IconBrain,
  IconBriefcase,
  IconBuildingBank,
  IconChartLine,
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
  { path: '/settings', label: '設定', icon: IconSettings, hidden: true }
];

export const visibleNavItems = navItems.filter(item => !item.hidden);
