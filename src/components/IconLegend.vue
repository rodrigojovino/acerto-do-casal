<template>
  <div class="legend">
    <p class="group">Situação (na ponta direita)</p>
    <ul>
      <li v-for="item in INDICATOR_LEGEND" :key="item.kind">
        <RowIcons :icons="{ indicator: { kind: item.kind, label: item.label, dot: false }, origins: [], recurring: false }" />
        <span>{{ item.label }}</span>
      </li>
      <li>
        <RowIcons :icons="{ indicator: { kind: 'pending', label: 'Ponto azul: a próxima ação é sua', dot: true }, origins: [], recurring: false }" />
        <span>Ponto azul: a próxima ação é sua (aprovar, corrigir, informar o valor ou responder a um pedido de exclusão)</span>
      </li>
    </ul>

    <p class="group">Origem e tipo (em cinza, antes da situação)</p>
    <ul>
      <li v-for="o in ORIGINS" :key="o.kind">
        <span class="ico" aria-hidden="true"><IconGlyph :name="o.kind" /></span>
        <span>{{ o.label }}</span>
      </li>
      <li>
        <span class="ico" aria-hidden="true"><IconGlyph name="recurring" /></span>
        <span>Recorrente</span>
      </li>
      <li>
        <span class="num" aria-hidden="true">1/12</span>
        <span>Parcela (numa série resumida em Pendências, "12x": compra em 12 vezes)</span>
      </li>
      <li>
        <span class="num" aria-hidden="true">70/30</span>
        <span>Divisão diferente de 50/50, com a sua parte primeiro</span>
      </li>
    </ul>
    <p class="hint">Toque e segure um ícone na lista para ver o nome.</p>
  </div>
</template>

<script setup lang="ts">
import IconGlyph from './IconGlyph.vue';
import RowIcons from './RowIcons.vue';
import { INDICATOR_LEGEND, ORIGIN_LABEL, type OriginKind } from '@/services/rowIcons';

/** Legenda dos ícones das listas (Ajustes e janela de filtros). */
const ORIGINS = (['qr', 'barcode', 'typed', 'photo', 'none'] as OriginKind[]).map((kind) => ({
  kind,
  label: ((t: string) => t[0].toUpperCase() + t.slice(1))(ORIGIN_LABEL[kind].replace('Origem: ', '')),
}));
</script>

<style scoped>
.legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 800;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

li {
  display: grid;
  grid-template-columns: 44px 1fr;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

li > :first-child {
  justify-self: center;
}

.ico {
  display: inline-flex;
  width: var(--app-row-icon);
  height: var(--app-row-icon);
  color: #6f6e69;
}

.num {
  font-size: var(--app-row-number-font);
  font-weight: 700;
  color: #5f5f5a;
}

.hint {
  margin: 0;
}
</style>
