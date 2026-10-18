<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="head">
          <h1>Pendências</h1>
          <p class="hint">Um mês só pode ser fechado sem pendências.</p>
        </header>

        <SyncStatus :pending-writes="items.some((e) => e.pendingWrite)" />

        <p v-if="loadError" class="alert-error" role="alert">{{ loadError }}</p>
        <p v-else-if="!loaded" class="hint">Carregando…</p>

        <template v-else>
          <!-- 1. Para você aprovar -->
          <section class="section" aria-labelledby="sec-aprovar">
            <h2 id="sec-aprovar" class="title warn">Para você aprovar · {{ toApprove.length }}</h2>
            <router-link v-for="e in toApprove" :key="e.id" class="item card" :to="{ name: 'gasto', params: { id: e.id } }">
              <span class="item-main">
                <span class="item-name">{{ e.description }}</span>
                <span class="item-sub">{{ subtitle(e) }}</span>
              </span>
              <span class="side">
                <span class="num strong">{{ formatBRL(e.totalCents) }}</span>
                <StatusBadge v-bind="badgeFor(e, myUid)" />
              </span>
              <span aria-hidden="true" class="chev">›</span>
            </router-link>
            <p v-if="toApprove.length === 0" class="empty">Nada para aprovar agora.</p>
          </section>

          <!-- 2. Aguardando o outro aprovar -->
          <section class="section" aria-labelledby="sec-aguardando">
            <h2 id="sec-aguardando" class="title">Aguardando {{ partnerFirstName }} aprovar · {{ waiting.length }}</h2>
            <div v-for="e in waiting" :key="e.id" class="waiting">
              <router-link class="item card" :to="{ name: 'gasto', params: { id: e.id } }">
                <span class="item-main">
                  <span class="item-name">{{ e.description }}</span>
                  <span class="item-sub">{{ subtitle(e) }}</span>
                </span>
                <span class="side">
                  <span class="num strong">{{ formatBRL(e.totalCents) }}</span>
                  <StatusBadge v-bind="badgeFor(e, myUid)" />
                </span>
                <span aria-hidden="true" class="chev">›</span>
              </router-link>
              <router-link v-if="e.receipt.type === 'none'" class="attach" :to="{ name: 'gasto-editar', params: { id: e.id } }">
                Anexar comprovante e dispensar aprovação
              </router-link>
            </div>
            <p v-if="waiting.length === 0" class="empty">Nenhum gasto seu esperando aprovação.</p>
          </section>

          <!-- 3. Devolvidos para você corrigir -->
          <section class="section" aria-labelledby="sec-devolvidos">
            <h2 id="sec-devolvidos" class="title">Devolvidos para você corrigir · {{ returned.length }}</h2>
            <router-link v-for="e in returned" :key="e.id" class="item card" :to="{ name: 'gasto', params: { id: e.id } }">
              <span class="item-main">
                <span class="item-name">{{ e.description }}</span>
                <span class="item-sub danger">
                  {{ e.rejection?.kind === 'contest' ? 'Contestado' : 'Recusado' }}{{ e.rejection?.reason ? `: "${e.rejection.reason}"` : ' sem motivo informado' }}
                </span>
              </span>
              <span class="side">
                <span class="num strong">{{ formatBRL(e.totalCents) }}</span>
                <StatusBadge v-bind="badgeFor(e, myUid)" />
              </span>
              <span aria-hidden="true" class="chev">›</span>
            </router-link>
            <p v-if="returned.length === 0" class="empty">
              Nada devolvido. Quando {{ partnerFirstName }} recusar ou contestar um gasto seu, ele aparece aqui com o motivo.
            </p>
          </section>

          <!-- 4. Recorrentes: valor a confirmar (variáveis) e cadastros a aprovar -->
          <section class="section" aria-labelledby="sec-recorrentes">
            <h2 id="sec-recorrentes" class="title">Recorrentes para confirmar · {{ toConfirm.length + recurringToApprove.length }}</h2>
            <router-link v-for="e in toConfirm" :key="e.id" class="item card" :to="{ name: 'gasto-editar', params: { id: e.id } }">
              <span class="item-main">
                <span class="item-name">{{ e.description }}</span>
                <span class="item-sub">Vence {{ formatDateBR(e.date, false) }} · confirme o valor deste mês</span>
              </span>
              <span class="side">
                <TypeBadge label="Recorrente" />
                <StatusBadge v-bind="badgeFor(e, myUid)" />
              </span>
              <span aria-hidden="true" class="chev">›</span>
            </router-link>
            <router-link
              v-for="r in recurringToApprove"
              :key="r.id"
              class="item card"
              :to="{ name: 'recorrente', params: { id: r.id } }"
            >
              <span class="item-main">
                <span class="item-name">{{ r.description }}</span>
                <span class="item-sub">Conta recorrente nova ou alterada · dia {{ r.dayOfMonth }}</span>
              </span>
              <span class="side">
                <span class="num strong">{{ formatBRL(r.amountCents ?? 0) }}</span>
                <StatusBadge kind="pending" label="Aprovar" />
              </span>
              <span aria-hidden="true" class="chev">›</span>
            </router-link>
            <p v-if="toConfirm.length + recurringToApprove.length === 0" class="empty">
              Contas variáveis aparecem aqui no dia 1 para você confirmar o valor; cadastros fixos de {{ partnerFirstName }}, para aprovar.
            </p>
            <p v-if="recurringWaiting.length > 0" class="hint">
              {{ recurringWaiting.length }} {{ recurringWaiting.length === 1 ? 'cadastro seu aguarda' : 'cadastros seus aguardam' }}
              a aprovação de {{ partnerFirstName }}.
            </p>
          </section>

          <p class="note">Pendentes já contam no saldo, destacados. Aprovar ou recusar funciona offline e sincroniza depois.</p>
        </template>
      </main>
    </ion-content>
    <ion-footer class="ion-no-border">
      <AppTabBar active="pendencias" />
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonFooter, IonPage } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import AppTabBar from '@/components/AppTabBar.vue';
import SyncStatus from '@/components/SyncStatus.vue';
import { formatDateBR, monthName } from '@/domain/calendar';
import TypeBadge from '@/components/TypeBadge.vue';
import { watchRecurring, type RecurringDoc } from '@/services/recurring';
import { formatBRL } from '@/domain/money';
import { watchOpenItems, type Expense } from '@/services/expenses';
import { badgeFor, flagLabel, flagsFor } from '@/services/expenseView';
import StatusBadge from '@/components/StatusBadge.vue';
import { firstNameOf, group, partnerFirstName, user } from '@/services/session';

const myUid = computed(() => user.value?.uid ?? '');

// ---- Pendentes e devolvidos de todos os meses, em tempo real ----
const items = ref<Expense[]>([]);
const loaded = ref(false);
const loadError = ref<string | null>(null);
let stop: (() => void) | null = null;

watch(
  () => group.value?.id,
  (groupId) => {
    stop?.();
    stop = null;
    if (!groupId) return;
    stop = watchOpenItems(
      groupId,
      (list) => {
        items.value = list;
        loaded.value = true;
      },
      () => {
        loadError.value = 'Não foi possível carregar as pendências. Verifique a conexão.';
        loaded.value = true;
      },
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => stop?.());

const toApprove = computed(() =>
  items.value.filter((e) => e.status === 'pending_approval' && e.createdBy !== myUid.value),
);
const waiting = computed(() =>
  items.value.filter((e) => e.status === 'pending_approval' && e.createdBy === myUid.value),
);
const returned = computed(() => items.value.filter((e) => e.status === 'returned' && e.createdBy === myUid.value));
const toConfirm = computed(() =>
  items.value.filter((e) => e.status === 'awaiting_confirmation' && e.createdBy === myUid.value),
);

// Cadastros de contas recorrentes (fixos) aguardando aprovação.
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
const recurringToApprove = computed(() =>
  recurrings.value.filter((r) => r.active && r.status === 'pending_approval' && r.createdBy !== myUid.value),
);
const recurringWaiting = computed(() =>
  recurrings.value.filter((r) => r.active && r.status === 'pending_approval' && r.createdBy === myUid.value),
);

/** "Bia · 15/10 · sem comprovante" (+ mês quando não é o atual, + avisos da nota/foto). */
function subtitle(e: Expense): string {
  const parts = [firstNameOf(e.payerUid), formatDateBR(e.date, false)];
  if (e.receipt.type === 'none') parts.push('sem comprovante');
  else if (e.receipt.type === 'photo') parts.push('com foto');
  else parts.push('com nota fiscal');
  for (const flag of flagsFor(e)) parts.push(flagLabel[flag].toLowerCase());
  parts.push(`acerto de ${monthName(e.competence)}`);
  return parts.join(' · ');
}
</script>

<style scoped>
.head h1 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 800;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  color: #3f3f3b;
}

.title.warn {
  color: #8a3f00;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  color: var(--app-text);
  text-decoration: none;
}

.item:focus-visible,
.attach:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-name {
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sub {
  font-size: 12px;
  color: var(--app-muted);
}

.item-sub.danger {
  color: var(--app-danger);
}

.strong {
  font-weight: 800;
}

.side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.chev {
  color: var(--app-muted);
}

.waiting {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.attach {
  align-self: flex-start;
  min-height: 40px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  font-size: 13px;
  font-weight: 700;
  color: var(--app-accent-dark);
  text-decoration: none;
}

.empty {
  margin: 0;
  padding: 16px;
  border: 1px dashed #a9a8a2;
  border-radius: 16px;
  font-size: 13px;
  color: var(--app-muted);
  text-align: center;
}

.note {
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--app-subtle);
  font-size: 12px;
  line-height: 1.5;
  color: #3f3f3b;
}
</style>
