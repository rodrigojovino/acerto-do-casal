<template>
  <span class="type">{{ label }}</span>
</template>

<script setup lang="ts">
/** Selo de tipo ("Parcela 3/10", "Recorrente"), ao lado do selo de status. */
defineProps<{ label: string }>();
</script>

<style scoped>
/* Neutro e sem ícone, para não competir com o selo de status; mesmo tamanho
   dele (a fonte da linha de dados e as medidas em em). */
.type {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  height: 1.8em;
  padding: 0 0.65em;
  border-radius: 0.45em;
  border: 1px solid transparent;
  background: var(--app-subtle);
  color: #3f3f3b;
  font-size: var(--app-meta-font);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
</style>
