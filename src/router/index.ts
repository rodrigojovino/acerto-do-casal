import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { watch, type Component } from 'vue';
import { sessionReady, status } from '@/services/session';
import { SCREENS, guardTarget, type RouteName } from './access';
import EntradaPage from '../views/EntradaPage.vue';
import VinculoPage from '../views/VinculoPage.vue';
import PainelPage from '../views/PainelPage.vue';
import AjustesPage from '../views/AjustesPage.vue';
import RecurringListPage from '../views/RecurringListPage.vue';
import RecurringFormPage from '../views/RecurringFormPage.vue';
import ClosingPage from '../views/ClosingPage.vue';
import HistoryPage from '../views/HistoryPage.vue';
import NotificationsPage from '../views/NotificationsPage.vue';
import CategoriesPage from '../views/CategoriesPage.vue';
import MonthDetailPage from '../views/MonthDetailPage.vue';
import PendenciasPage from '../views/PendenciasPage.vue';
import ExpenseFormPage from '../views/ExpenseFormPage.vue';
import ExpenseDetailPage from '../views/ExpenseDetailPage.vue';

/** Componente de cada tela (a tabela de telas e acessos fica em `access.ts`). */
const views: Record<RouteName, Component> = {
  entrar: EntradaPage,
  vinculo: VinculoPage,
  painel: PainelPage,
  pendencias: PendenciasPage,
  historico: HistoryPage,
  mes: MonthDetailPage,
  fechar: ClosingPage,
  ajustes: AjustesPage,
  recorrentes: RecurringListPage,
  avisos: NotificationsPage,
  categorias: CategoriesPage,
  'recorrente-novo': RecurringFormPage,
  recorrente: RecurringFormPage,
  'gasto-novo': ExpenseFormPage,
  gasto: ExpenseDetailPage,
  'gasto-editar': ExpenseFormPage,
};

const routes: Array<RouteRecordRaw> = [
  { path: '/', redirect: '/painel' },
  ...SCREENS.map((s) => ({ path: s.path, name: s.name, component: views[s.name] })),
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// Guarda de rota: espera saber quem está logado e qual o grupo, e só deixa
// abrir as telas do estado atual (tabela em access.ts).
router.beforeEach(async (to) => {
  await sessionReady();
  const target = guardTarget(status.value, to.name);
  return target ? { name: target, replace: true } : true;
});

// Quando o estado muda com a tela aberta (login, o outro entrou no grupo, sair),
// navega sozinho.
watch(status, async (next) => {
  await sessionReady();
  const target = guardTarget(next, router.currentRoute.value.name);
  if (target) await router.replace({ name: target });
});

export default router;
