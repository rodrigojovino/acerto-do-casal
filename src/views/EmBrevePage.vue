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

      </main>
    </ion-content>
    <ion-footer class="ion-no-border">
      <AppTabBar :active="tab" />
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonFooter, IonPage } from '@ionic/vue';
import { useRoute } from 'vue-router';
import AppTabBar from '@/components/AppTabBar.vue';

type Tab = 'historico';

// O Ionic mantém as telas visitadas vivas; ler a rota de forma reativa faria
// esta tela reagir às rotas das outras. A aba é fixada na criação.
const tab = useRoute().name as Tab;

const texts: Record<Tab, { title: string; description: string }> = {
  historico: {
    title: 'Histórico',
    description: 'Meses fechados, exportação e pedido de reabertura chegam junto com o fechamento do mês.',
  },
};

const { title, description } = texts[tab];
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
