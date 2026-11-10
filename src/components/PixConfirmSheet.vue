<template>
  <div class="sheet">
    <header class="head">
      <h2>Registrar pagamento de {{ formatBRL(amountCents) }} com este comprovante?</h2>
      <button class="icon-btn" type="button" aria-label="Fechar sem registrar" :disabled="busy" @click="emit('close')">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div class="body">
      <p v-if="changedFrom !== undefined" class="alert-warn" role="alert">
        O valor que falta mudou de {{ formatBRL(changedFrom) }} para {{ formatBRL(amountCents) }}. Confira e registre de novo (a
        mesma foto vale).
      </p>
      <p class="to">Para {{ toName }}</p>
      <img :src="photoUrl" alt="Prévia do comprovante do PIX" class="photo" />
      <p class="hint">Depois de registrado, o pagamento só pode ser cancelado até o fechamento do mês.</p>
      <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
    </div>

    <footer class="actions">
      <button class="btn outline" type="button" :disabled="busy" @click="emit('change')">Trocar foto</button>
      <button class="btn primary" type="button" :disabled="busy" :aria-busy="busy" @click="emit('register')">
        {{ busy ? 'Registrando…' : 'Registrar' }}
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { formatBRL } from '@/domain/money';

/**
 * Confirmação do comprovante do PIX (v0.9.3): a prévia da foto escolhida,
 * ainda só no aparelho, com o valor que falta. Nada é enviado antes de
 * "Registrar". Se o valor mudou, mostra o novo para confirmar de novo.
 */
defineProps<{
  photoUrl: string;
  amountCents: number;
  toName: string;
  /** O valor confirmado antes, quando o que falta mudou. */
  changedFrom?: number;
  busy?: boolean;
  error?: string | null;
}>();
const emit = defineEmits<{ register: []; change: []; close: [] }>();
</script>

<style scoped>
.sheet {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  padding-top: var(--app-safe-top);
  padding-bottom: max(var(--app-safe-bottom), 48px);
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 8px;
}

.head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.to {
  margin: 0;
  color: var(--app-muted);
}

.photo {
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
  border-radius: var(--app-radius-control);
  background: var(--app-surface);
  border: 1px solid var(--app-border);
}

.hint,
.alert-warn,
.alert-error {
  margin: 0;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 12px 16px 0;
}
</style>
