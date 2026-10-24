<template>
  <span class="expense-row" :class="{ muted }">
    <span class="name">{{ name }}</span>
    <span class="amount num">
      <svg v-if="syncing" class="sync-icon" role="img" aria-label="Sincronizando" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
      {{ amount }}
    </span>
    <span class="meta">
      <span class="sub">{{ sub }}</span>
      <RowIcons :icons="icons" />
    </span>
    <span v-if="$slots.default" class="extra"><slot /></span>
  </span>
</template>

<script setup lang="ts">
import RowIcons from './RowIcons.vue';
import type { RowIcons as Icons } from '@/services/rowIcons';

/**
 * Linha de gasto das listas (Painel, Pendências, Detalhe do mês). Primeira
 * linha: a descrição (com reticências) e o valor. Segunda linha, sempre numa
 * linha só: a linha de dados e, à direita, os ícones (`rowIcons`: origem,
 * recorrente, números e o indicador de situação na ponta). Faltando espaço,
 * a linha de dados ganha reticências; os ícones nunca são cortados. Linhas
 * extras (observação, série, avisos) vão no slot, com as classes `line`,
 * `line note`, `line warn` ou `line danger`.
 */
withDefaults(
  defineProps<{
    name: string;
    sub: string;
    amount: string;
    icons: Icons;
    /** Previsão (ainda não é gasto): descrição e valor esmaecidos. */
    muted?: boolean;
    /** Gravado no aparelho, ainda não confirmado pelo servidor. */
    syncing?: boolean;
  }>(),
  { muted: false, syncing: false },
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
  font-size: var(--app-row-title-font);
  font-weight: var(--app-row-title-weight);
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
  font-size: var(--app-row-title-font);
  font-weight: var(--app-row-title-weight);
  white-space: nowrap;
}

/* Segunda linha, na largura toda e sem quebrar: dados à esquerda (encolhem,
   com reticências) e os ícones à direita (tamanho fixo, nunca cortados). */
.meta {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* Linha de dados (quem pagou · data): menor que a descrição. */
.sub {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--app-meta-font);
  color: var(--app-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
