<template>
  <span class="type">{{ label }}</span>
</template>

<script setup lang="ts">
/** Selo de tipo ("Parcela 3/10", "Recorrente"), ao lado do selo de status. */
defineProps<{ label: string }>();
</script>

<style scoped>
/* Neutro e sem ícone, para não competir com o selo de status; mesmo tamanho dele. */
.type {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: var(--app-subtle);
  color: #3f3f3b;
  font-size: 8.5px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
</style>
