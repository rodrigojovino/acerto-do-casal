<template>
  <span class="type">{{ label }}</span>
</template>

<script setup lang="ts">
/** Selo de tipo ("Parcela 3/10", "Recorrente"), ao lado do selo de status. */
defineProps<{ label: string }>();
</script>

<style scoped>
/* Neutro e sem ícone, para não competir com o selo de status. */
.type {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--app-subtle);
  color: #3f3f3b;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
}
</style>
