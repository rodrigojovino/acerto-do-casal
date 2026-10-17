import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import { watch } from 'vue';
import { sessionReady, status, type SessionStatus } from '@/services/session';
import EntradaPage from '../views/EntradaPage.vue';
import VinculoPage from '../views/VinculoPage.vue';
import PainelPage from '../views/PainelPage.vue';

const routes: Array<RouteRecordRaw> = [
  { path: '/', redirect: '/painel' },
  { path: '/entrar', name: 'entrar', component: EntradaPage },
  { path: '/vinculo', name: 'vinculo', component: VinculoPage },
  { path: '/painel', name: 'painel', component: PainelPage },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

/** Única tela permitida para cada estado da sessão. */
const routeFor: Record<SessionStatus, string> = {
  signedOut: 'entrar',
  noGroup: 'vinculo',
  waitingPartner: 'vinculo',
  linked: 'painel',
};

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// Guarda de rota: espera saber quem está logado e qual o grupo, e leva
// para a tela do estado atual.
router.beforeEach(async (to) => {
  await sessionReady();
  const target = routeFor[status.value];
  if (to.name !== target) return { name: target, replace: true };
  return true;
});

// Quando o estado muda com a tela aberta (login, o outro entrou no grupo, sair),
// navega sozinho.
watch(status, async (next) => {
  await sessionReady();
  if (router.currentRoute.value.name !== routeFor[next]) {
    await router.replace({ name: routeFor[next] });
  }
});

export default router;
