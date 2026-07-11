import { createRouter, createWebHashHistory } from 'vue-router';
import { navItems } from './navItems';

const titleOf = path => navItems.find(item => item.path === path)?.label || '台股資訊';
const view = name => () => import(`../views/${name}.vue`);

const routes = [
  { path: '/', redirect: '/search' },
  { path: '/search', component: view('SearchView'), meta: { title: titleOf('/search') } },
  { path: '/quote', component: view('QuoteView'), meta: { title: titleOf('/quote') } },
  { path: '/complete-analysis', component: view('CompleteAnalysisView'), meta: { title: titleOf('/complete-analysis') } },
  { path: '/portfolio', component: view('PortfolioView'), meta: { title: titleOf('/portfolio') } },
  { path: '/favorites', component: view('FavoritesView'), meta: { title: titleOf('/favorites') } },
  { path: '/hot100', component: view('Hot100View'), meta: { title: titleOf('/hot100') } },
  { path: '/top-volume', component: view('TopVolumeView'), meta: { title: titleOf('/top-volume') } },
  { path: '/chart', component: view('ChartView'), meta: { title: titleOf('/chart') } },
  { path: '/alerts', component: view('AlertsView'), meta: { title: titleOf('/alerts') } },
  { path: '/backtest', component: view('BacktestView'), meta: { title: titleOf('/backtest') } },
  { path: '/institutional', component: view('InstitutionalView'), meta: { title: titleOf('/institutional') } },
  { path: '/margin', component: view('MarginView'), meta: { title: titleOf('/margin') } },
  { path: '/fundamental', component: view('FundamentalView'), meta: { title: titleOf('/fundamental') } },
  { path: '/ai', component: view('AiView'), meta: { title: titleOf('/ai') } },
  { path: '/more', component: view('MoreView'), meta: { title: titleOf('/more') } },
  { path: '/data-health', component: view('DataHealthView'), meta: { title: titleOf('/data-health') } },
  { path: '/settings', component: view('SettingsView'), meta: { title: titleOf('/settings') } }
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
});
