<template>
  <span class="badge" :class="kind">
    <svg v-if="kind === 'pending'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    <svg v-else-if="kind === 'auto'" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
    <svg v-else-if="kind === 'validated'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7" /></svg>
    <svg v-else-if="kind === 'returned'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
    <svg v-else aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
    <span>{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import type { BadgeKind } from '@/services/expenseView';

defineProps<{ kind: BadgeKind; label: string }>();
</script>

<style scoped>
/* Cores também diferentes em claridade (não só no tom), e texto com contraste >= 4,5:1:
   automático = branco tracejado; pendente = claro; devolvido e a confirmar = médio;
   validado = escuro preenchido. */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 6px;
  border-radius: 999px;
  border: 1.5px solid transparent;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
}

.badge svg {
  width: 12px;
  height: 12px;
  flex: none;
}

.pending {
  background: #fcebd9;
  color: #7a3700;
}

.auto {
  background: #ffffff;
  border: 1.5px dashed #2457c5;
  color: #1a3f94;
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
</style>
