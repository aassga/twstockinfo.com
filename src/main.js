import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { NavBar, Tabbar, TabbarItem } from 'vant';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import router from './router';
import { useSystemStore } from './stores/systemStore';
import 'vant/es/nav-bar/style';
import 'vant/es/tabbar/style';
import 'vant/es/tabbar-item/style';
import '../legacy/css/style.css';
import './styles/app.scss';

const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');

function applyDisplayModeClasses() {
  const isStandalone = Boolean(standaloneQuery?.matches || window.navigator.standalone);
  document.documentElement.classList.toggle('is-standalone', isStandalone);
}

applyDisplayModeClasses();
standaloneQuery?.addEventListener?.('change', applyDisplayModeClasses);

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(NavBar);
app.use(Tabbar);
app.use(TabbarItem);

app.config.errorHandler = (error, _instance, info) => {
  useSystemStore(pinia).recordError(error, `vue:${info || 'component'}`);
  console.error(error);
};

app.mount('#app');

let refreshing = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__twstockApplyUpdate = () => updateSW(true);
    window.dispatchEvent(new CustomEvent('twstock:pwa-update-ready'));
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('twstock:pwa-offline-ready'));
  }
});
