<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen painel">
        <header class="month-nav">
          <button class="icon-btn bordered" type="button" aria-label="Mês anterior" :disabled="month <= firstMonth" @click="go(-1)">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div class="month-title">
            <h1>{{ monthLabel(month) }}</h1>
            <p class="month-state" :class="{ closed: isClosed }">● {{ isClosed ? 'Mês fechado' : 'Mês aberto' }}</p>
          </div>
          <button class="icon-btn bordered" type="button" aria-label="Próximo mês" :disabled="month >= lastMonth" @click="go(1)">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </header>

        <SyncStatus :pending-writes="hasPendingWrites" />

        <section class="balance" aria-labelledby="saldo-titulo">
          <p id="saldo-titulo" class="muted small">{{ isClosed ? 'Saldo do acerto' : 'Saldo do acerto até agora' }}</p>
          <div>
            <p class="who">{{ balanceText.who }}</p>
            <p class="amount num">{{ formatBRL(balance?.amountCents ?? 0) }}</p>
          </div>
          <div class="paid">
            <div>
              <span class="muted">Você pagou</span>
              <span class="num strong">{{ formatBRL(paid[myUid] ?? 0) }}</span>
            </div>
            <div>
              <span class="muted">{{ partnerFirstName }} pagou</span>
              <span class="num strong">{{ formatBRL(paid[partnerUid ?? ''] ?? 0) }}</span>
            </div>
          </div>
          <p v-if="forecast.length > 0" class="forecast-line small">
            <span class="muted">Previsto em recorrentes</span>
            <span class="num strong">{{ formatBRL(forecastFixedCents) }}</span>
          </p>
        </section>

        <router-link v-if="pending.open > 0 || pending.awaitingMine > 0" class="pending" :to="{ name: 'pendencias' }">
          <span>{{ pendingText }}</span><span aria-hidden="true">›</span>
        </router-link>

        <div class="list-head">
          <h2>Gastos do mês</h2>
          <span class="hint">{{ countText }}</span>
        </div>

        <p v-if="loadError" class="alert-error" role="alert">{{ loadError }}</p>
        <p v-else-if="!loaded" class="hint center">Carregando…</p>
        <div v-else-if="expenses.length === 0 && forecast.length === 0" class="empty card">
          <p class="strong">Nenhum gasto em {{ monthName(month) }}.</p>
          <p class="hint">Toque em + para lançar o primeiro.</p>
        </div>
        <ul v-else class="list card">
          <li v-for="item in expenses" :key="item.id">
            <router-link class="item" :to="{ name: 'gasto', params: { id: item.id } }">
            <span class="avatar" aria-hidden="true">{{ initials(item.payerUid) }}</span>
            <span class="item-main">
              <span class="item-name">{{ item.description }}</span>
              <span class="item-sub">{{ expenseSubtitle(item, myUid, firstNameOf(item.payerUid)) }}</span>
            </span>
            <span class="item-side">
              <span class="num strong">{{ item.status === 'awaiting_confirmation' ? 'a confirmar' : formatBRL(item.totalCents) }}</span>
              <span class="tags">
                <TypeBadge v-for="t in typeBadges(item)" :key="t" :label="t" />
                <svg v-if="item.pendingWrite" class="sync-icon" role="img" aria-label="Sincronizando" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
                <span v-for="flag in flagsFor(item)" :key="flag" class="tag flag">{{ flagLabel[flag] }}</span>
                <StatusBadge v-bind="badgeFor(item, myUid)" />
              </span>
            </span>
            </router-link>
          </li>
          <!-- Previsão de recorrentes (calculada, não gravada; fora do saldo) -->
          <li v-for="f in forecast" :key="`previsto-${f.recurringId}`">
            <router-link class="item forecast" :to="{ name: 'recorrente', params: { id: f.recurringId } }">
              <span class="avatar" aria-hidden="true">{{ initials(f.payerUid) }}</span>
              <span class="item-main">
                <span class="item-name">{{ f.description }}</span>
                <span class="item-sub">{{ firstNameOf(f.payerUid) }} · {{ formatDateBR(f.date, false) }} · previsto</span>
              </span>
              <span class="item-side">
                <span class="num strong">{{ f.amountCents === null ? 'a definir' : formatBRL(f.amountCents) }}</span>
                <span class="tags">
                  <TypeBadge label="Recorrente" />
                  <StatusBadge v-bind="FORECAST_BADGE" />
                </span>
              </span>
            </router-link>
          </li>
        </ul>
      </main>
    </ion-content>
    <ion-footer class="ion-no-border">
      <AppTabBar active="painel" />
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonFooter, IonPage, onIonViewWillEnter } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabBar from '@/components/AppTabBar.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import SyncStatus from '@/components/SyncStatus.vue';
import { clampMonth, formatDateBR, lastAllowedMonth, monthLabel, monthName, monthOf, todayInSaoPaulo } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import { addMonths, monthBalance, paidByMember, pendingSummary, type Members } from '@/domain/settlement';
import { watchMonthExpenses, type Expense } from '@/services/expenses';
import { FORECAST_BADGE, badgeFor, expenseSubtitle, flagLabel, flagsFor, typeBadges } from '@/services/expenseView';
import TypeBadge from '@/components/TypeBadge.vue';
import { forecastRecurring, forecastTotal } from '@/domain/recurrence';
import { watchRecurring, type RecurringDoc } from '@/services/recurring';
import { closedMonths } from '@/services/months';
import { firstNameOf, group, partnerFirstName, partnerUid, user } from '@/services/session';

const route = useRoute();
const router = useRouter();

const myUid = computed(() => user.value?.uid ?? '');
const members = computed<Members>(() => [myUid.value, partnerUid.value ?? ''] as const);

// ---- Mês exibido: ?mes=YYYY-MM, limitado do mês de criação do grupo ao mês seguinte ----
const today = ref(todayInSaoPaulo());
onIonViewWillEnter(() => (today.value = todayInSaoPaulo()));

const firstMonth = computed(() => {
  const created = group.value?.createdAt?.toDate();
  return created ? monthOf(todayInSaoPaulo(created)) : monthOf(today.value);
});
const lastMonth = computed(() => lastAllowedMonth(today.value));

// ?mes= só vale enquanto o Painel é a tela atual: o Ionic mantém a tela viva
// e a rota global muda quando outras telas abrem.
const requested = ref<string | null>(null);
watch(
  () => [route.name, route.query.mes] as const,
  ([name, mes]) => {
    if (name !== 'painel') return;
    requested.value = typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes) ? mes : null;
  },
  { immediate: true },
);

const month = computed(() => clampMonth(requested.value ?? monthOf(today.value), firstMonth.value, today.value));

function go(delta: 1 | -1): void {
  router.replace({ name: 'painel', query: { mes: addMonths(month.value, delta) } });
}

const isClosed = computed(() => closedMonths.value.has(month.value));

// ---- Gastos do mês em tempo real (inclusive do cache offline) ----
const expenses = ref<Expense[]>([]);
const loaded = ref(false);
const loadError = ref<string | null>(null);
let stop: (() => void) | null = null;

watch(
  [() => group.value?.id, month],
  ([groupId, m]) => {
    stop?.();
    stop = null;
    loaded.value = false;
    loadError.value = null;
    expenses.value = [];
    if (!groupId) return;
    stop = watchMonthExpenses(
      groupId,
      m,
      (snapshot) => {
        expenses.value = snapshot.expenses;
        loaded.value = true;
      },
      () => {
        loadError.value = 'Não foi possível carregar os gastos. Verifique a conexão.';
        loaded.value = true;
      },
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => stop?.());

const hasPendingWrites = computed(() => expenses.value.some((e) => e.pendingWrite));

// ---- Previsão de recorrentes (meses futuros; calculada a partir dos cadastros) ----
const recurrings = ref<RecurringDoc[]>([]);
let stopRecurring: (() => void) | null = null;
watch(
  () => group.value?.id,
  (groupId) => {
    stopRecurring?.();
    stopRecurring = groupId ? watchRecurring(groupId, (l) => (recurrings.value = l), () => undefined) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => stopRecurring?.());

const forecast = computed(() => {
  const generated = new Set(expenses.value.map((e) => e.recurringId).filter((id): id is string => !!id));
  return forecastRecurring(recurrings.value, month.value, today.value, generated);
});
const forecastFixedCents = computed(() => forecastTotal(forecast.value));

// ---- Saldo e resumos: só funções de src/domain ----
const balance = computed(() => (partnerUid.value ? monthBalance(expenses.value, members.value) : null));
const paid = computed(() => (partnerUid.value ? paidByMember(expenses.value, members.value) : {}));
const pending = computed(() => pendingSummary(expenses.value, myUid.value));

const balanceText = computed(() => {
  const b = balance.value;
  if (!b) return { who: 'Ninguém deve nada' };
  return b.fromUid === myUid.value
    ? { who: `Você deve para ${partnerFirstName.value}` }
    : { who: `${partnerFirstName.value} te deve` };
});

const pendingText = computed(() => {
  const { open, awaitingMyApproval, returnedToMe, awaitingMine } = pending.value;
  const parts: string[] = [];
  if (open > 0) parts.push(`${open} ${open === 1 ? 'gasto pendente' : 'gastos pendentes'}`);
  if (awaitingMine > 0) {
    parts.push(`${awaitingMine} ${awaitingMine === 1 ? 'recorrente' : 'recorrentes'} para confirmar o valor`);
  }
  if (awaitingMyApproval > 0) {
    parts.push(`${awaitingMyApproval} ${awaitingMyApproval === 1 ? 'aguarda' : 'aguardam'} sua aprovação`);
  }
  if (returnedToMe > 0) {
    parts.push(`${returnedToMe} ${returnedToMe === 1 ? 'devolvido' : 'devolvidos'} para você corrigir`);
  }
  return parts.join(' · ');
});

const countText = computed(() => {
  const n = expenses.value.length;
  return n === 1 ? '1 lançamento' : `${n} lançamentos`;
});

function initials(uid: string): string {
  if (uid === myUid.value) return 'EU';
  return firstNameOf(uid).slice(0, 3).toUpperCase();
}
</script>

<style scoped>
.painel {
  gap: 12px;
}

.month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.icon-btn.bordered {
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.month-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.month-title h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.month-state {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #1e6b3a;
}

.month-state.closed {
  color: var(--app-muted);
}

.balance {
  background: var(--app-text);
  color: #fff;
  border-radius: 20px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.balance p {
  margin: 0;
}

.muted {
  color: #c9c8c2;
}

.small {
  font-size: 13px;
  font-weight: 600;
}

.who {
  font-size: 15px;
  font-weight: 600;
}

.amount {
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -1px;
}

.paid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  font-size: 13px;
}

.paid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.strong {
  font-weight: 700;
}

.pending {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-decoration: none;
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: #fcebd9;
  color: #8a3f00;
  font-size: 13px;
  font-weight: 700;
}

.list-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-top: 6px;
}

.list-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}

.center {
  text-align: center;
  padding: 24px 0;
}

.empty {
  padding: 20px;
  text-align: center;
}

.empty p {
  margin: 0 0 4px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.item {
  color: inherit;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--app-subtle);
}

li:last-child .item {
  border-bottom: 0;
}

.item:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: -2px;
}

.avatar {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  background: var(--app-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  color: var(--app-muted);
}

.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-name {
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sub {
  font-size: 12px;
  color: var(--app-muted);
}

.item.forecast {
  background: repeating-linear-gradient(135deg, transparent 0 8px, rgba(0, 0, 0, 0.025) 8px 16px);
}

.item.forecast .item-name,
.item.forecast .num {
  color: var(--app-muted);
}

.forecast-line {
  margin: 0;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  display: flex;
  justify-content: space-between;
}

.item-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  font-size: 14px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}

.tag.flag {
  background: var(--app-subtle);
  color: #3f3f3b;
}

.sync-icon {
  color: var(--app-accent);
}

.tag {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}

.tag.pending,
.tag.approve {
  background: #fcebd9;
  color: #8a3f00;
}

.tag.returned {
  background: var(--app-danger-bg);
  color: var(--app-danger);
}
</style>
