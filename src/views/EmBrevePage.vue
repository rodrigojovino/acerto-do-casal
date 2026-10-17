<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="page-head">
          <h1>{{ title }}</h1>
        </header>

        <div class="soon card">
          <p class="soon-title">Em breve</p>
          <p class="hint">{{ description }}</p>
        </div>

        <template v-if="tab === 'ajustes'">
          <p class="hint">Conectado como {{ user?.email }}</p>
          <button class="btn outline" type="button" @click="signOut">Sair</button>
        </template>
      </main>
    </ion-content>
    <ion-footer class="ion-no-border">
      <AppTabBar :active="tab" />
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonFooter, IonPage } from '@ionic/vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppTabBar from '@/components/AppTabBar.vue';
import { signOut } from '@/services/auth';
import { user } from '@/services/session';

type Tab = 'pendencias' | 'historico' | 'ajustes';

const route = useRoute();
const tab = computed(() => route.name as Tab);

const texts: Record<Tab, { title: string; description: string }> = {
  pendencias: {
    title: 'Pendências',
    description: 'Gastos para aprovar, devolvidos e recorrentes a confirmar chegam com os comprovantes.',
  },
  historico: {
    title: 'Histórico',
    description: 'Meses fechados, exportação e pedido de reabertura chegam junto com o fechamento do mês.',
  },
  ajustes: {
    title: 'Ajustes',
    description: 'Perfis, divisão padrão e notificações chegam nas próximas fases.',
  },
};

const title = computed(() => texts[tab.value].title);
const description = computed(() => texts[tab.value].description);
</script>

<style scoped>
.soon {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.soon-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}
</style>
