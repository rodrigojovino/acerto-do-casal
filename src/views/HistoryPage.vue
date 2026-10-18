<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="page-head">
          <h1>Histórico</h1>
        </header>

        <p v-if="loadError" class="alert-error" role="alert">{{ loadError }}</p>
        <p v-else-if="!loaded" class="hint">Carregando…</p>
        <ul v-else class="list card">
          <li v-for="row in rows" :key="row.month">
            <router-link class="item" :to="row.to">
              <span class="item-main">
                <span class="item-name">{{ monthLabel(row.month) }}</span>
                <span v-if="row.result" class="item-sub">{{ row.result }}{{ row.method ? ` · ${row.method}` : '' }}</span>
                <span v-else class="item-sub">Abrir no Painel</span>
              </span>
              <span class="side">
                <span class="state" :class="row.state">{{ row.stateLabel }}</span>
                <span v-if="row.reopenPending" class="state pending">Reabertura pedida</span>
              </span>
              <span aria-hidden="true" class="chev">›</span>
            </router-link>
          </li>
        </ul>
        <p class="hint">A exportação para Excel e PDF chega numa próxima versão.</p>
      </main>
    </ion-content>
    <ion-footer class="ion-no-border">
      <AppTabBar active="historico" />
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonFooter, IonPage, onIonViewWillEnter } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import AppTabBar from '@/components/AppTabBar.vue';
import { monthLabel, monthOf, monthsDesc, todayInSaoPaulo } from '@/domain/calendar';
import { watchMonths, type MonthDoc } from '@/services/closing';
import { historyRow } from '@/services/historyView';
import { firstNameOf, group, user } from '@/services/session';

const myUid = computed(() => user.value?.uid ?? '');
const today = ref(todayInSaoPaulo());
onIonViewWillEnter(() => (today.value = todayInSaoPaulo()));

const firstMonth = computed(() => {
  const created = group.value?.createdAt?.toDate();
  return created ? monthOf(todayInSaoPaulo(created)) : monthOf(today.value);
});

// ---- Meses com documento (fechados, reabertos, com pagamento), em tempo real ----
const docs = ref<Map<string, MonthDoc>>(new Map());
const loaded = ref(false);
const loadError = ref<string | null>(null);
let stop: (() => void) | null = null;
watch(
  () => group.value?.id,
  (groupId) => {
    stop?.();
    stop = null;
    if (!groupId) return;
    stop = watchMonths(
      groupId,
      (list) => {
        docs.value = new Map(list.map((d) => [d.month, d]));
        loaded.value = true;
      },
      () => {
        loadError.value = 'Não foi possível carregar o histórico. Verifique a conexão.';
        loaded.value = true;
      },
    );
  },
  { immediate: true },
);
onBeforeUnmount(() => stop?.());

/** Do mês atual ao de criação do grupo. Fechado abre o Detalhe do mês; aberto, o Painel. */
const rows = computed(() => {
  const current = monthOf(today.value);
  return monthsDesc(firstMonth.value, current).map((month) => {
    const doc = docs.value.get(month) ?? null;
    const row = historyRow(doc, month, current, myUid.value, firstNameOf);
    const to = row.state === 'closed' ? { name: 'mes', params: { mes: month } } : { name: 'painel', query: { mes: month } };
    return { month, to, ...row };
  });
});
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

.state {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.state.closed {
  background: #1e6b3a;
  color: #ffffff;
}

.state.open,
.state.current {
  background: #e3eafa;
  color: #1a3f94;
}

.state.reopened {
  background: #fcebd9;
  color: #7a3700;
}

.state.pending {
  background: #ffffff;
  border: 1.5px dashed #c77700;
  color: #7a3700;
}

.chev {
  color: var(--app-muted);
}
</style>
