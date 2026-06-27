import { createRouter, createWebHashHistory } from 'vue-router';
import AiView from '../views/AiView.vue';
import AlertsView from '../views/AlertsView.vue';
import ChartView from '../views/ChartView.vue';
import Hot100View from '../views/Hot100View.vue';
import InstitutionalView from '../views/InstitutionalView.vue';
import PortfolioView from '../views/PortfolioView.vue';
import SearchView from '../views/SearchView.vue';
import SettingsView from '../views/SettingsView.vue';
import { navItems } from './navItems';

const titleOf = path => navItems.find(item => item.path === path)?.label || '台股資訊';

const routes = [
  { path: '/', redirect: '/search' },
  { path: '/search', component: SearchView, meta: { title: titleOf('/search') } },
  { path: '/portfolio', component: PortfolioView, meta: { title: titleOf('/portfolio') } },
  { path: '/hot100', component: Hot100View, meta: { title: titleOf('/hot100') } },
  { path: '/chart', component: ChartView, meta: { title: titleOf('/chart') } },
  { path: '/alerts', component: AlertsView, meta: { title: titleOf('/alerts') } },
  { path: '/institutional', component: InstitutionalView, meta: { title: titleOf('/institutional') } },
  { path: '/ai', component: AiView, meta: { title: titleOf('/ai') } },
  { path: '/settings', component: SettingsView, meta: { title: titleOf('/settings') } }
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
});
