import { createApp } from 'vue'
import App from './App.vue'
import router from './router';
import { initPush } from './services/push';
// Itens das notas, notas já lançadas, categorias e a foto do cartão no cache local desde a abertura (abrem offline).
import './services/nfceItems';
import './services/fiscalKeys';
import './services/categories';
import './services/cover';

import { IonicVue } from '@ionic/vue';

/* Core CSS required for Ionic components to work properly */
import '@ionic/vue/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';

/* Modo escuro desligado: o visual de referência é só claro. */

/* Fonte Manrope empacotada com o app (funciona offline) */
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';

/* Theme variables */
import './theme/variables.css';
import './theme/app.css';

const app = createApp(App)
  .use(IonicVue)
  .use(router);

router.isReady().then(() => {
  app.mount('#app');
  initPush(router);
});
