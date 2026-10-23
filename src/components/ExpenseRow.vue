<template>
  <span class="expense-row" :class="{ muted }">
    <span class="name">{{ name }}</span>
    <span class="amount num">
      <svg v-if="syncing" class="sync-icon" role="img" aria-label="Sincronizando" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
      {{ amount }}
    </span>
    <span class="sub">{{ sub }}</span>
    <span v-if="badge || types.length > 0" class="badges">
      <TypeBadge v-for="t in types" :key="t" :label="t" />
      <StatusBadge v-if="badge" v-bind="badge" />
    </span>
    <span v-if="$slots.default" class="extra"><slot /></span>
  </span>
</template>

<script setup lang="ts">
import StatusBadge from './StatusBadge.vue';
import TypeBadge from './TypeBadge.vue';
import type { Badge } from '@/services/expenseView';

/**
 * Linha de gasto das listas (Painel, Pendências, Detalhe do mês). À esquerda,
 * a descrição (uma linha, com reticências) e a linha de dados; à direita, o
 * valor e, embaixo, os selos alinhados à direita: o de status na ponta e os de
 * tipo à esquerda dele. Linhas extras (observação, série, avisos) vão no slot,
 * com as classes `line`, `line note`, `line warn` ou `line danger`.
 */
withDefaults(
  defineProps<{
    name: string;
    sub: string;
    amount: string;
    badge?: Badge | null;
    types?: readonly string[];
    /** Previsão (ainda não é gasto): descrição e valor esmaecidos. */
    muted?: boolean;
    /** Gravado no aparelho, ainda não confirmado pelo servidor. */
    syncing?: boolean;
  }>(),
  { badge: null, types: () => [], muted: false, syncing: false },
);
</script>

<style scoped>
.expense-row {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 12px;
  row-gap: 3px;
  align-items: center;
}

.name {
  grid-column: 1;
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amount {
  grid-column: 2;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
}

/* Linha de dados (quem pagou · data · divisão): menor que a descrição. */
.sub {
  grid-column: 1;
  font-size: 9px;
  color: var(--app-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badges {
  grid-column: 2;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 4px;
}

.extra {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.extra :slotted(.line) {
  font-size: 11px;
  color: var(--app-muted);
  overflow-wrap: anywhere;
}

/* Observação: a cor normal do texto. */
.extra :slotted(.line.note) {
  color: var(--app-text);
  font-style: italic;
}

.extra :slotted(.line.warn) {
  color: #7a3700;
  font-weight: 700;
}

.extra :slotted(.line.danger) {
  color: var(--app-danger);
}

.muted .name,
.muted .amount {
  color: var(--app-muted);
}

.sync-icon {
  color: var(--app-muted);
}
</style>
