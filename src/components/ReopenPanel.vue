<template>
  <section class="card reopen" :class="{ pending: request?.status === 'pending' }" aria-labelledby="reabrir-titulo">
    <!-- Pedido pendente -->
    <template v-if="request?.status === 'pending'">
      <template v-if="request.byUid === viewerUid">
        <h2 id="reabrir-titulo" class="title">Reabertura aguardando {{ partnerName }}</h2>
        <p class="reason">Seu motivo: “{{ request.reason }}”</p>
        <button class="btn outline" type="button" :disabled="busy || !isOnline" @click="run(() => cancelReopen(groupId, month))">
          Cancelar pedido
        </button>
      </template>
      <template v-else>
        <h2 id="reabrir-titulo" class="title">{{ partnerName }} pediu a reabertura de {{ monthName(month) }}</h2>
        <p class="reason">“{{ request.reason }}”</p>
        <p class="hint">Aprovada, o mês volta a aberto: os gastos podem ser corrigidos e o acerto é refeito. Os pagamentos já feitos continuam valendo.</p>
        <div class="grid-2">
          <button class="btn outline" type="button" :disabled="busy || !isOnline" @click="run(() => answerReopen(groupId, month, false))">
            Recusar
          </button>
          <button class="btn primary" type="button" :disabled="busy || !isOnline" @click="run(() => answerReopen(groupId, month, true))">
            Aprovar
          </button>
        </div>
      </template>
    </template>

    <!-- Sem pedido: pedir, com motivo -->
    <template v-else>
      <h2 id="reabrir-titulo" class="title">{{ monthLabel(month) }} está fechado</h2>
      <p v-if="request?.status === 'denied'" class="hint">
        O último pedido de reabertura foi recusado por {{ nameOf(request.answeredBy ?? '') }}.
      </p>
      <button class="btn outline" type="button" :disabled="busy || !isOnline" @click="sendRequest">Pedir reabertura</button>
    </template>

    <p v-if="!isOnline" class="hint warn">Sem conexão: pedir, aprovar e recusar a reabertura exigem internet.</p>
    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { monthLabel, monthName } from '@/domain/calendar';
import type { Competence } from '@/domain/settlement';
import { answerReopen, cancelReopen, closingErrorMessage, requestReopen, type MonthDoc } from '@/services/closing';
import { askReopenReason } from './reopenDialog';
import { firstNameOf, partnerFirstName } from '@/services/session';
import { isOnline } from '@/services/sync';

/**
 * Reabertura de um mês fechado: pedir (com motivo), cancelar o próprio pedido,
 * ou aprovar/recusar o pedido do outro. Usado no Painel e no Histórico.
 * Tudo pelas Functions, só com conexão.
 */
const props = defineProps<{
  groupId: string;
  month: Competence;
  monthDoc: MonthDoc;
  viewerUid: string;
}>();

const request = computed(() => props.monthDoc.reopenRequest);
const partnerName = computed(() => partnerFirstName.value);
const nameOf = (uid: string) => (uid === props.viewerUid ? 'você' : firstNameOf(uid));

const busy = ref(false);
const error = ref<string | null>(null);

async function run(action: () => Promise<unknown>): Promise<boolean> {
  busy.value = true;
  error.value = null;
  try {
    await action();
    return true;
  } catch (err) {
    error.value = closingErrorMessage(err);
    return false;
  } finally {
    busy.value = false;
  }
}

/** Tela do pedido (motivo obrigatório e aviso da aprovação) num diálogo. */
async function sendRequest(): Promise<void> {
  const reason = await askReopenReason(props.month, partnerName.value);
  if (reason) await run(() => requestReopen(props.groupId, props.month, reason));
}
</script>

<style scoped>
.reopen {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}

.reason {
  margin: 0;
  font-size: 14px;
  font-style: italic;
}

.reopen.pending {
  border: 2px solid #c77700;
  background: #fff8ef;
}

.warn {
  color: #7a3700;
}
</style>
