<template>
  <div class="sheet">
    <header class="head">
      <div>
        <h2>Itens da nota</h2>
        <p v-if="issuer" class="hint">{{ issuer }}</p>
      </div>
      <button class="icon-btn" type="button" aria-label="Fechar" @click="emit('close')">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div class="body">
      <p v-if="!items.consistent" class="alert-warn" role="status">
        A soma dos itens ({{ formatBRL(items.itemsSumCents) }}) não bate com o total da nota ({{ formatBRL(items.totalCents) }}).
        Os itens são os lidos da SEFAZ; confira na nota.
      </p>

      <ol class="items">
        <li v-for="(item, i) in items.items" :key="i">
          <span class="name">{{ item.description }}</span>
          <span class="line num">{{ itemLine(item) }}</span>
        </li>
      </ol>

      <dl class="totals">
        <div v-if="items.discountCents > 0 || items.grossCents !== undefined" class="row">
          <dt>Soma dos itens</dt><dd class="num">{{ formatBRL(items.grossCents ?? items.itemsSumCents) }}</dd>
        </div>
        <div v-if="items.discountCents > 0" class="row">
          <dt>Descontos</dt><dd class="num">− {{ formatBRL(items.discountCents) }}</dd>
        </div>
        <div class="row strong">
          <dt>Total da nota</dt><dd class="num">{{ formatBRL(items.totalCents) }}</dd>
        </div>
        <div v-for="(p, i) in items.payments" :key="`p${i}`" class="row">
          <dt>{{ p.method }}</dt><dd class="num">{{ formatBRL(p.amountCents) }}</dd>
        </div>
        <div v-if="items.changeCents" class="row">
          <dt>Troco</dt><dd class="num">{{ formatBRL(items.changeCents) }}</dd>
        </div>
      </dl>
      <p class="hint">{{ items.items.length }} {{ items.items.length === 1 ? 'item' : 'itens' }}, lidos da consulta à SEFAZ-SP.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatBRL } from '@/domain/money';
import { itemLine } from '@/services/nfceItems';
import type { NfceItems } from '../../functions/src/nfce';

/** Lista dos itens de uma NFC-e de SP conferida (funciona offline, do cache). */
defineProps<{ items: NfceItems; issuer?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<style scoped>
.sheet {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--app-bg, #f6f5f1);
  padding-top: var(--app-safe-top);
  padding-bottom: var(--app-safe-bottom);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--app-border);
}

.head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.head p {
  margin: 2px 0 0;
}

.body {
  flex: 1;
  overflow: auto;
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.items {
  margin: 0;
  padding: 0 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.items li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font-size: 14px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.line {
  font-size: 13px;
  color: var(--app-muted);
}

.totals {
  margin: 0;
  padding-top: 8px;
  border-top: 1px solid var(--app-border);
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
}

.alert-warn {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--app-radius-control);
  background: #fcebd9;
  color: #7a3700;
  font-size: 14px;
}
</style>
