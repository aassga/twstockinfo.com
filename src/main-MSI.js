import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Vant from 'vant';
import ElementPlus from 'element-plus';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import router from './router';
import 'vant/lib/index.css';
import 'element-plus/dist/index.css';
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

app.use(createPinia());
app.use(router);
app.use(Vant);
app.use(ElementPlus);
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
    updateSW(true);
  }
});
