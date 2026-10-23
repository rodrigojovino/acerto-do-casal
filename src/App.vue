<template>
  <ion-app>
    <ion-router-outlet />
    <!-- Faixa da barra de status: o conteúdo rolado não aparece por baixo dela -->
    <div class="status-scrim" aria-hidden="true" />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
</script>

<style>
/* Fundo da cor da página atrás da barra de status (edge-to-edge): fica acima
   das telas e abaixo dos diálogos e modais do Ionic, sem capturar toques. */
.status-scrim {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--app-safe-top);
  background: var(--app-bg);
  z-index: 1000;
  pointer-events: none;
}
</style>
