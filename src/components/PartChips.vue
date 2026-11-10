<template>
  <span v-if="tags.length > 0" class="part-chips">
    <span
      v-for="t in tags"
      :key="t.ownerUid"
      class="chip"
      :class="t.owner"
      :aria-label="label(t)"
      role="img"
    >
      <span class="circle" aria-hidden="true">{{ initialOf(t.ownerUid) }}</span>
      <span aria-hidden="true">{{ label(t) }}</span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { formatBRL } from '@/domain/money';
import type { PartTag } from '@/domain/parts';

/**
 * Chips das partes só de uma pessoa (modelo A), com centavos: "Só meu R$ X"
 * (preenchido, de quem vê) e "Só [nome] R$ Y" (vazado, do parceiro), cada um
 * com a inicial do dono. Pendências e Detalhe do gasto. `suffix`: " por
 * parcela" numa série resumida.
 */
const props = defineProps<{
  tags: readonly PartTag[];
  partnerName: string;
  initialOf: (uid: string) => string;
  suffix?: string;
}>();

const label = (t: PartTag) =>
  `${t.owner === 'viewer' ? 'Só meu' : `Só ${props.partnerName}`} ${formatBRL(t.cents)}${props.suffix ?? ''}`;
</script>

<style scoped>
.part-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px 2px 2px;
  border-radius: 999px;
  font-size: var(--app-meta-font);
  font-weight: 700;
  font-style: normal;
  border: 1.5px solid var(--app-text);
  white-space: nowrap;
}

.chip.viewer {
  background: var(--app-text);
  color: var(--app-surface);
}

.chip.partner {
  background: transparent;
  color: var(--app-text);
}

.circle {
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  box-sizing: border-box;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
}

.chip.viewer .circle {
  background: var(--app-surface);
  color: var(--app-text);
}

.chip.partner .circle {
  border: 1.5px solid var(--app-text);
}
</style>
