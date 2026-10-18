import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import { watch } from 'vue';
import { sessionReady, status, type SessionStatus } from '@/services/session';
import EntradaPage from '../views/EntradaPage.vue';
import VinculoPage from '../views/VinculoPage.vue';
import PainelPage from '../views/PainelPage.vue';
import EmBrevePage from '../views/EmBrevePage.vue';
import PendenciasPage from '../views/PendenciasPage.vue';
import ExpenseFormPage from '../views/ExpenseFormPage.vue';
import ExpenseDetailPage from '../views/ExpenseDetailPage.vue';

const routes: Array<RouteRecordRaw> = [
  { path: '/', redirect: '/painel' },
  { path: '/entrar', name: 'entrar', component: EntradaPage },
  { path: '/vinculo', name: 'vinculo', component: VinculoPage },
  { path: '/painel', name: 'painel', component: PainelPage },
  { path: '/pendencias', name: 'pendencias', component: PendenciasPage },
  { path: '/historico', name: 'historico', component: EmBrevePage },
  { path: '/ajustes', name: 'ajustes', component: EmBrevePage },
  { path: '/gasto/novo', name: 'gasto-novo', component: ExpenseFormPage },
  { path: '/gasto/:id', name: 'gasto', component: ExpenseDetailPage },
  { path: '/gasto/:id/editar', name: 'gasto-editar', component: ExpenseFormPage },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

/** Tela inicial de cada estado da sessão. */
const homeFor: Record<SessionStatus, string> = {
  signedOut: 'entrar',
  noGroup: 'vinculo',
  waitingPartner: 'vinculo',
  linked: 'painel',
};

/** Telas permitidas em cada estado; o app inteiro só para o casal vinculado. */
const allowed: Record<SessionStatus, ReadonlySet<string>> = {
  signedOut: new Set(['entrar']),
  noGroup: new Set(['vinculo']),
  waitingPartner: new Set(['vinculo']),
  linked: new Set(['painel', 'pendencias', 'historico', 'ajustes', 'gasto-novo', 'gasto', 'gasto-editar']),
};

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// Guarda de rota: espera saber quem está logado e qual o grupo, e só deixa
// abrir as telas do estado atual.
router.beforeEach(async (to) => {
  await sessionReady();
  if (!allowed[status.value].has(String(to.name))) {
    return { name: homeFor[status.value], replace: true };
  }
  return true;
});

// Quando o estado muda com a tela aberta (login, o outro entrou no grupo, sair),
// navega sozinho.
watch(status, async (next) => {
  await sessionReady();
  if (!allowed[next].has(String(router.currentRoute.value.name))) {
    await router.replace({ name: homeFor[next] });
  }
});

export default router;
