<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen no-tabbar">
        <header class="page-head">
          <button class="icon-btn" type="button" aria-label="Voltar" @click="goBack">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h1>Contas recorrentes</h1>
        </header>

        <p class="hint">
          Geradas no dia 1 de cada mês, com a data do vencimento. Fixas passam pela aprovação de {{ partnerFirstName }} uma vez;
          variáveis pedem a confirmação do valor a cada mês.
        </p>

        <router-link class="btn primary" :to="{ name: 'recorrente-novo' }">Nova conta recorrente</router-link>

        <p v-if="!loaded" class="hint">Carregando…</p>
        <p v-else-if="list.length === 0" class="empty">Nenhuma conta recorrente cadastrada.</p>
        <ul v-else class="list card">
          <li v-for="r in list" :key="r.id">
            <router-link class="item" :to="{ name: 'recorrente', params: { id: r.id } }">
              <span class="item-main">
                <span class="item-name">{{ r.description }}</span>
                <span class="item-sub">{{ subtitle(r) }}</span>
              </span>
              <span class="side">
                <span class="num strong">{{ r.kind === 'fixed' ? formatBRL(r.amountCents ?? 0) : 'variável' }}</span>
                <StatusBadge v-bind="recurringBadge(r, myUid)" />
              </span>
            </router-link>
          </li>
        </ul>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import StatusBadge from '@/components/StatusBadge.vue';
import { monthLabel } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import { recurringBadge } from '@/services/recurringView';
import { hasPendingAdjustment, watchRecurring, type RecurringDoc } from '@/services/recurring';
import { firstNameOf, group, partnerFirstName, user } from '@/services/session';

const router = useRouter();
const myUid = computed(() => user.value?.uid ?? '');

const list = ref<RecurringDoc[]>([]);
const loaded = ref(false);
let stop: (() => void) | null = null;
watch(
  () => group.value?.id,
  (groupId) => {
    stop?.();
    stop = groupId
      ? watchRecurring(
          groupId,
          (l) => {
            list.value = l;
            loaded.value = true;
          },
          () => (loaded.value = true),
        )
      : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => stop?.());

function subtitle(r: RecurringDoc): string {
  const period = r.endMonth ? `até ${monthLabel(r.endMonth).toLowerCase()}` : 'sem prazo';
  const adjustment = hasPendingAdjustment(r) ? ' · reajuste aguardando aprovação' : '';
  return `${firstNameOf(r.payerUid)} paga · dia ${r.dayOfMonth} · ${period}${adjustment}`;
}

function goBack(): void {
  if (window.history.state?.back) router.back();
  else router.replace({ name: 'ajustes' });
}
</script>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--app-subtle);
  color: var(--app-text);
  text-decoration: none;
}

li:last-child .item {
  border-bottom: 0;
}

.item:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: -2px;
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
}

.item-sub {
  font-size: 12px;
  color: var(--app-muted);
}

.side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.strong {
  font-weight: 800;
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
</style>
