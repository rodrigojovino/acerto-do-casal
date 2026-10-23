<template>
  <span class="badge" :class="kind">
    <svg v-if="kind === 'pending'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    <svg v-else-if="kind === 'auto'" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
    <svg v-else-if="kind === 'photo'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
    <svg v-else-if="kind === 'recurring'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="m9 15 2 2 4-4" /></svg>
    <svg v-else-if="kind === 'validated'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7" /></svg>
    <svg v-else-if="kind === 'returned'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
    <svg v-else-if="kind === 'forecast'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-dasharray="3 3" /><path d="M12 8v4l2.5 1.5" /></svg>
    <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
    <span>{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import type { BadgeKind } from '@/services/expenseView';

defineProps<{ kind: BadgeKind; label: string }>();
</script>

<style scoped>
/* Cores também diferentes em claridade (não só no tom), e texto com contraste >= 4,5:1.
   Confirmados, do mais claro ao mais escuro: automático (branco, tracejado azul) →
   foto do recibo (lilás claro, tracejado roxo) → recorrente aprovado (verde-azulado
   médio, contorno contínuo) → validado (verde escuro preenchido).
   Demais: pendente = âmbar claro; devolvido e a confirmar = médio. */
/* Tamanho padronizado: a fonte da linha de dados (--app-meta-font) e as
   medidas em em, para manter a proporção se ela mudar. A mesma altura para
   todos, inclusive os sem contorno (borda transparente), e a do selo de tipo. */
.badge {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  height: 1.8em;
  padding: 0 0.65em 0 0.45em;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: var(--app-meta-font);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.badge svg {
  width: 1.05em;
  height: 1.05em;
  flex: none;
}

.pending {
  background: #fcebd9;
  color: #7a3700;
}

.auto {
  background: #ffffff;
  border: 1px dashed #2457c5;
  color: #1a3f94;
}

.photo {
  background: #ece4fa;
  border: 1px dashed #6a3fb5;
  color: #45207f;
}

.recurring {
  background: #7cc4ba;
  border: 1px solid #17695f;
  color: #062b27;
}

.validated {
  background: #1e6b3a;
  color: #ffffff;
}

.returned {
  background: #f4c2bc;
  color: #7a1a12;
}

.awaiting {
  background: #d9d8d3;
  color: #2e2e2b;
}

/* Previsto: cinza com contorno tracejado (ainda não é um gasto). */
.forecast {
  background: #ffffff;
  border: 1px dashed #6b6a65;
  color: #3f3f3b;
}
</style>
