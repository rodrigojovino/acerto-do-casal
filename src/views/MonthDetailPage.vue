<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>{{ monthLabel(month) }}</h1>
        </header>

        <p v-if="!loaded" class="hint">Carregando…</p>
        <p v-else-if="loadError" class="alert-error" role="alert">{{ loadError }}</p>

        <!-- Reaberto (ou nunca fechado): o mês vive no Painel -->
        <div v-else-if="monthDoc?.status !== 'closed'" class="card open-month">
          <p class="strong">{{ monthLabel(month) }} está aberto.</p>
          <p class="hint">Os gastos e o acerto deste mês ficam no Painel até ele ser fechado.</p>
          <router-link class="btn outline" :to="{ name: 'painel', query: { mes: month } }">Abrir no Painel</router-link>
        </div>

        <template v-else-if="monthDoc && summary">
          <p class="closed-line small">{{ closedLine }}</p>

          <ReopenPanel v-if="group" :group-id="group.id" :month="month" :month-doc="monthDoc" :viewer-uid="myUid" />

          <section class="result">
            <p class="muted small">Acerto de {{ monthName(month) }}{{ monthDoc.payments.length > 0 ? ' · pago' : '' }}</p>
            <p class="who">{{ resultText }}</p>
            <p v-if="summary.result" class="amount num">{{ formatBRL(summary.result.amountCents) }}</p>
          </section>

          <BreakdownCard :breakdown="summary" :viewer-uid="myUid" />

          <section v-if="monthDoc.payments.length > 0" class="card block" aria-labelledby="pag-titulo">
            <h2 id="pag-titulo" class="title">Pagamentos do acerto</h2>
            <PaymentList :payments="monthDoc.payments" :viewer-uid="myUid" />
          </section>

          <section class="card block" aria-labelledby="gastos-titulo">
            <h2 id="gastos-titulo" class="title">Gastos de {{ monthName(month) }} · {{ expenses.length }}</h2>
            <ul class="expenses">
              <li v-for="e in expenses" :key="e.id">
                <router-link class="expense" :to="{ name: 'gasto', params: { id: e.id } }">
                  <ExpenseRow
                    :name="e.description"
                    :sub="expenseSubtitle(e, firstNameOf(e.payerUid))"
                    :amount="formatBRL(e.totalCents)"
                    :icons="rowIcons(e, myUid, partnerFirstName)"
                  />
                </router-link>
              </li>
            </ul>
            <p v-if="expenses.length === 0" class="hint">Nenhum gasto neste mês.</p>
          </section>
        </template>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BreakdownCard from '@/components/BreakdownCard.vue';
import ExpenseRow from '@/components/ExpenseRow.vue';
import PaymentList from '@/components/PaymentList.vue';
import ReopenPanel from '@/components/ReopenPanel.vue';
import { formatDateBR, monthLabel, monthName, todayInSaoPaulo } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import { watchMonth, type MonthDoc } from '@/services/closing';
import { watchMonthExpenses, type Expense } from '@/services/expenses';
import { expenseSubtitle } from '@/services/expenseView';
import { rowIcons } from '@/services/rowIcons';
import { firstNameOf, group, partnerFirstName, user } from '@/services/session';

const route = useRoute();
const router = useRouter();

// Fixado na criação: o Ionic mantém a tela viva enquanto outras rotas abrem.
const month = String(route.params.mes);
const myUid = computed(() => user.value?.uid ?? '');

const expenses = ref<Expense[]>([]);
const monthDoc = ref<MonthDoc | null>(null);
const loadedMonth = ref(false);
const loadError = ref<string | null>(null);
const loaded = computed(() => loadedMonth.value);
let stops: Array<() => void> = [];

watch(
  () => group.value?.id,
  (groupId) => {
    stops.forEach((s) => s());
    stops = [];
    if (!groupId) return;
    const fail = () => (loadError.value = 'Não foi possível carregar o mês. Verifique a conexão.');
    stops.push(
      watchMonth(groupId, month, (d) => {
        monthDoc.value = d;
        loadedMonth.value = true;
      }, fail),
      watchMonthExpenses(groupId, month, (snap) => (expenses.value = snap.expenses), fail),
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => stops.forEach((s) => s()));

/** Memória de cálculo guardada no fechamento (não é recalculada). */
const summary = computed(() => monthDoc.value?.summary ?? null);

const resultText = computed(() => {
  const r = summary.value?.result;
  if (!r) return 'Ninguém devia nada';
  return r.fromUid === myUid.value ? `Você pagou a ${partnerFirstName.value}` : `${partnerFirstName.value} te pagou`;
});

const closedLine = computed(() => {
  const d = monthDoc.value;
  if (!d?.closedAt) return 'Mês fechado';
  const who = d.closedBy === myUid.value ? 'você' : firstNameOf(d.closedBy ?? '');
  return `Fechado em ${formatDateBR(todayInSaoPaulo(d.closedAt))} por ${who}. Os gastos não podem mais ser alterados.`;
});

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'historico' });
}
</script>

<style scoped>
.closed-line {
  margin: 0;
  color: var(--app-muted);
}

.open-month {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.open-month p {
  margin: 0;
}

.result {
  padding: 18px;
  border-radius: var(--app-radius-card, 16px);
  background: var(--app-accent-dark, #1a3f94);
  color: #ffffff;
}

.result p {
  margin: 0;
}

.result .muted {
  opacity: 0.8;
}

.who {
  font-size: 16px;
  font-weight: 700;
}

.amount {
  font-size: 30px;
  font-weight: 800;
}

.block {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}

.expenses {
  list-style: none;
  margin: 0;
  padding: 0;
}

.expense {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--app-subtle);
  color: var(--app-text);
  text-decoration: none;
}

li:last-child .expense {
  border-bottom: 0;
}

.strong {
  font-weight: 800;
}
</style>
