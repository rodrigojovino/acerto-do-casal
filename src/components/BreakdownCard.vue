<template>
  <section class="card calc" :aria-labelledby="`calc-titulo-${uid}`">
    <h2 :id="`calc-titulo-${uid}`" class="calc-title">Memória de cálculo</h2>
    <dl>
      <div class="row">
        <dt>Total lançado ({{ breakdown.expenseCount }} {{ breakdown.expenseCount === 1 ? 'gasto' : 'gastos' }})</dt>
        <dd class="num">{{ formatBRL(breakdown.totalCents) }}</dd>
      </div>
      <div class="row"><dt>Partes pessoais</dt><dd class="num">− {{ formatBRL(breakdown.personalCents) }}</dd></div>
      <div class="row strong"><dt>Total no rateio</dt><dd class="num">{{ formatBRL(breakdown.sharedCents) }}</dd></div>
    </dl>
    <table class="members">
      <thead>
        <tr><th scope="col"></th><th scope="col">Você</th><th scope="col">{{ partnerFirstName }}</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Parte no rateio</th><td class="num">{{ formatBRL(mine.shareCents) }}</td><td class="num">{{ formatBRL(theirs.shareCents) }}</td></tr>
        <tr><th scope="row">Pagou do rateio</th><td class="num">{{ formatBRL(mine.paidSharedCents) }}</td><td class="num">{{ formatBRL(theirs.paidSharedCents) }}</td></tr>
        <tr class="diff"><th scope="row">Diferença</th><td class="num">{{ signedBRL(mine.diffCents) }}</td><td class="num">{{ signedBRL(theirs.diffCents) }}</td></tr>
      </tbody>
    </table>
    <p class="hint">Diferença positiva: pagou mais que a parte e tem a receber. As partes pessoais ficam com quem pagou.</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MonthBreakdown } from '@/domain/closing';
import { formatBRL } from '@/domain/money';
import { partnerFirstName, partnerUid } from '@/services/session';

/** Memória de cálculo do mês (`monthBreakdown`): na tela de fechamento e no Detalhe do mês do Histórico. */
const props = defineProps<{ breakdown: MonthBreakdown; viewerUid: string }>();

const uid = Math.random().toString(36).slice(2, 8);
const zero = { shareCents: 0, paidSharedCents: 0, diffCents: 0 };
const mine = computed(() => props.breakdown.byMember[props.viewerUid] ?? zero);
const theirs = computed(() => props.breakdown.byMember[partnerUid.value ?? ''] ?? zero);

const signedBRL = (cents: number) => (cents > 0 ? `+ ${formatBRL(cents)}` : cents < 0 ? `− ${formatBRL(-cents)}` : formatBRL(0));
</script>

<style scoped>
.calc {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.calc-title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}

dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}

.row dd {
  margin: 0;
}

.row.strong {
  font-weight: 800;
  border-top: 1px solid var(--app-subtle);
  padding-top: 4px;
}

.members {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.members th,
.members td {
  padding: 4px 0;
  text-align: right;
}

.members th[scope='row'] {
  text-align: left;
  font-weight: 600;
  color: var(--app-muted);
}

.members thead th {
  font-weight: 800;
}

.members .diff td,
.members .diff th {
  border-top: 1px solid var(--app-subtle);
  font-weight: 800;
  color: var(--app-text);
}
</style>
