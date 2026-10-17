<template>
  <ion-page>
    <ion-content :fullscreen="true">
      <main class="screen">
        <header class="brand">
          <div class="logo" aria-hidden="true">=</div>
          <h1>Acerto do Casal</h1>
          <p class="lead">Cada um lança o que pagou. No fim do mês, o app diz quem deve quanto a quem.</p>
        </header>

        <button class="google" type="button" :disabled="loading" @click="entrar">
          <svg class="google-mark" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.6 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.1z" />
            <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.8-6.1z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.3 2.3-6.4 0-11.7-4.1-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z" />
          </svg>
          <span>{{ loading ? 'Entrando…' : 'Entrar com Google' }}</span>
        </button>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <p class="footnote">O grupo aceita exatamente 2 pessoas. Os dados ficam no Firebase do casal.</p>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue';
import { ref } from 'vue';
import { SignInError, signInWithGoogle } from '@/services/auth';

const loading = ref(false);
const error = ref<string | null>(null);

// Depois do login, a guarda de rota leva para Vínculo ou Painel.
async function entrar(): Promise<void> {
  error.value = null;
  loading.value = true;
  try {
    await signInWithGoogle();
  } catch (err) {
    error.value = err instanceof SignInError ? err.message : 'Não foi possível entrar. Tente de novo.';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.screen {
  min-height: 100%;
  box-sizing: border-box;
  max-width: 480px;
  margin: 0 auto;
  padding: calc(56px + var(--app-safe-top)) 24px calc(32px + var(--app-safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.brand {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.logo {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--app-text);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 800;
}

h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.5px;
}

.lead {
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  color: var(--app-muted);
}

.google {
  height: 52px;
  border-radius: var(--app-radius-button);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
}

.google:disabled {
  opacity: 0.6;
  cursor: default;
}

.google:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.google-mark {
  width: 20px;
  height: 20px;
}

.error {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--app-radius-control);
  background: var(--app-danger-bg);
  color: var(--app-danger);
  font-size: 14px;
  font-weight: 600;
}

.footnote {
  margin: auto 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--app-muted);
  text-align: center;
}
</style>
