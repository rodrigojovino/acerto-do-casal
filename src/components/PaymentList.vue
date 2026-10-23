<template>
  <ul class="payments">
    <li v-for="p in payments" :key="p.id" class="payment">
      <button
        v-if="p.method === 'pix'"
        type="button"
        class="thumb-btn"
        :disabled="!urls[p.id]"
        :aria-label="urls[p.id] ? 'Ampliar comprovante do PIX' : 'Carregando comprovante'"
        @click="zoomUrl = urls[p.id] ?? null"
      >
        <img v-if="urls[p.id]" :src="urls[p.id]!" alt="" class="thumb" />
        <span v-else class="thumb placeholder">{{ urls[p.id] === null ? 'Sem conexão' : 'Carregando…' }}</span>
      </button>
      <span v-else class="thumb placeholder cash" aria-hidden="true">R$</span>

      <span class="info">
        <span class="amount num">{{ formatBRL(p.amountCents) }}</span>
        <span class="direction">{{ name(p.fromUid) }} → {{ name(p.toUid, true) }}</span>
        <span class="meta">{{ p.method === 'pix' ? 'PIX' : 'Dinheiro' }} · registrado por {{ name(p.byUid, true) }}{{ p.at ? ` em ${dateTime(p.at)}` : '' }}</span>
      </span>
    </li>

    <!-- Pagamento deste aparelho cuja foto ainda está subindo (ainda não registrado) -->
    <li v-if="uploading" class="payment">
      <span class="thumb placeholder" aria-hidden="true">PIX</span>
      <span class="info">
        <span class="amount num">{{ formatBRL(uploading.amountCents) }}</span>
        <span class="direction">{{ name(uploading.fromUid) }} → {{ name(uploading.toUid, true) }}</span>
        <span class="meta sending" role="status">Comprovante sendo enviado…</span>
      </span>
    </li>
  </ul>

  <!-- Foto ampliada, com pinça, toque duplo e arraste até as bordas (como no Detalhe do gasto) -->
  <PhotoViewer :url="zoomUrl" title="Comprovante do PIX" alt="Comprovante do PIX ampliado" @close="zoomUrl = null" />
</template>

<script setup lang="ts">
import PhotoViewer from './PhotoViewer.vue';
import { reactive, ref, watch } from 'vue';
import type { Transfer } from '@/domain/settlement';
import { formatBRL } from '@/domain/money';
import { paymentPhotoUrl, type MonthPayment } from '@/services/closing';
import { firstNameOf } from '@/services/session';

/**
 * Pagamentos do acerto de um mês: valor, sentido, forma, quem registrou e
 * quando. No PIX, a miniatura do comprovante abre a foto ampliável. Usado na
 * tela de fechamento e no Detalhe do mês do Histórico (os dois membros veem).
 */
const props = defineProps<{
  payments: readonly MonthPayment[];
  viewerUid: string;
  /** Pagamento PIX deste aparelho cuja foto ainda está subindo. */
  uploading?: Pick<Transfer, 'fromUid' | 'toUid' | 'amountCents'> | null;
}>();

/** URL da miniatura por pagamento: `undefined` carregando, `null` indisponível. */
const urls = reactive<Record<string, string | null | undefined>>({});

watch(
  () => props.payments.map((p) => p.receiptPath ?? '').join('|'),
  () => {
    for (const p of props.payments) {
      if (!p.receiptPath || p.id in urls) continue;
      urls[p.id] = undefined;
      void paymentPhotoUrl(p.receiptPath).then((url) => (urls[p.id] = url));
    }
  },
  { immediate: true },
);

const zoomUrl = ref<string | null>(null);

const name = (uid: string, lower = false) => {
  if (uid === props.viewerUid) return lower ? 'você' : 'Você';
  return firstNameOf(uid);
};

const fmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const dateTime = (d: Date) => fmt.format(d).replace(', ', ' às ');
</script>

<style scoped>
.payments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.payment {
  display: flex;
  align-items: center;
  gap: 12px;
}

.thumb-btn {
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
  flex: none;
}

.thumb-btn:disabled {
  cursor: default;
}

.thumb {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--app-border);
  display: block;
  flex: none;
}

.thumb.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--app-muted);
  background: var(--app-subtle);
}

.thumb.cash {
  font-size: 15px;
  color: #1e6b3a;
  background: #e2f1e6;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.amount {
  font-size: 16px;
  font-weight: 800;
}

.direction {
  font-size: 14px;
  font-weight: 600;
}

.meta {
  font-size: 12px;
  color: var(--app-muted);
}

.meta.sending {
  color: #7a3700;
  font-weight: 700;
}

.icon-btn.light {
  color: #fff;
}

</style>
