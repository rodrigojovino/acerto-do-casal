<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="top">
          <h1>Acerto do Casal</h1>
          <button class="link" type="button" @click="sair">Sair</button>
        </header>

        <section class="hero">
          <p class="label">Casal vinculado</p>
          <p class="names">{{ myName }} e {{ partnerName ?? 'a outra pessoa' }}</p>
        </section>

        <p class="placeholder">O painel do mês, com saldo e gastos, chega na próxima fase.</p>
      </main>
    </ion-content>
    <ion-footer class="ion-no-border">
      <AppTabBar active="painel" />
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonFooter, IonPage } from '@ionic/vue';
import AppTabBar from '@/components/AppTabBar.vue';
import { computed } from 'vue';
import { signOut } from '@/services/auth';
import { group, partnerName, user } from '@/services/session';

const myName = computed(() => {
  const uid = user.value?.uid;
  return (uid && group.value?.memberNames[uid]) || 'Você';
});

async function sair(): Promise<void> {
  await signOut();
}
</script>

<style scoped>
.screen {
  min-height: 100%;
  box-sizing: border-box;
  max-width: 480px;
  margin: 0 auto;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 20px calc(28px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.hero {
  background: var(--app-text);
  color: #fff;
  border-radius: 20px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #c9c8c2;
}

.names {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.4px;
}

.placeholder {
  margin: 0;
  padding: 16px;
  border: 1px dashed var(--app-border);
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--app-muted);
  text-align: center;
}

.link {
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  color: var(--app-accent);
  cursor: pointer;
}

.link:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}
</style>
