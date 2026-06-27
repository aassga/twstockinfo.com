import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Vant from 'vant';
import ElementPlus from 'element-plus';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import router from './router';
import 'vant/lib/index.css';
import 'element-plus/dist/index.css';
import './styles/app.scss';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(Vant);
app.use(ElementPlus);
app.mount('#app');

registerSW({ immediate: true });
