<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="page-head">
          <h1>Ajustes</h1>
        </header>

        <router-link class="card row" :to="{ name: 'recorrentes' }">
          <span class="row-main">
            <span class="row-title">Contas recorrentes</span>
            <span class="hint">{{ recurringSummary }}</span>
          </span>
          <span aria-hidden="true" class="chev">›</span>
        </router-link>

        <div class="card soon">
          <p class="strong">Em breve</p>
          <p class="hint">Perfis, divisão padrão e notificações chegam nas próximas fases.</p>
        </div>

        <p class="hint">Conectado como {{ user?.email }}</p>
        <button class="btn outline" type="button" @click="signOut">Sair</button>
      </main>
    </ion-content>
    <ion-footer class="ion-no-border">
      <AppTabBar active="ajustes" />
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonFooter, IonPage } from '@ionic/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import AppTabBar from '@/components/AppTabBar.vue';
import { signOut } from '@/services/auth';
import { watchRecurring, type RecurringDoc } from '@/services/recurring';
import { group, user } from '@/services/session';

const list = ref<RecurringDoc[]>([]);
let stop: (() => void) | null = null;
watch(
  () => group.value?.id,
  (groupId) => {
    stop?.();
    stop = groupId ? watchRecurring(groupId, (l) => (list.value = l), () => undefined) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => stop?.());

const recurringSummary = computed(() => {
  const active = list.value.filter((r) => r.active).length;
  const waiting = list.value.filter((r) => r.active && r.status === 'pending_approval').length;
  if (list.value.length === 0) return 'Nenhuma cadastrada';
  const parts = [`${active} ${active === 1 ? 'ativa' : 'ativas'}`];
  if (waiting > 0) parts.push(`${waiting} aguardando aprovação`);
  return parts.join(' · ');
});
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  color: var(--app-text);
  text-decoration: none;
}

.row:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-title {
  font-size: 15px;
  font-weight: 700;
}

.chev {
  color: var(--app-muted);
}

.soon {
  padding: 16px;
}

.soon p {
  margin: 0 0 4px;
}

.strong {
  font-weight: 700;
}
</style>
