<template>
  <div class="sheet">
    <header class="head">
      <div>
        <h2>Itens da nota</h2>
        <p v-if="issuer" class="hint">{{ issuer }}</p>
        <p v-if="device" class="hint device">Lidos no aparelho, sem conferência da SEFAZ.</p>
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

      <p v-if="marksWarning" class="alert-warn" role="status">{{ marksWarning }}</p>
      <p v-if="editable" class="hint">
        Marque o que é só de um de vocês; o resto é dividido. A soma preenche "Só minha" e "Só de {{ partnerName }}".
      </p>
      <p v-if="editable && marked" class="hint strong-hint" role="status" aria-live="polite">{{ marksSummary }}</p>

      <ol class="items">
        <li v-for="(item, i) in items.items" :key="i" :class="{ marked: markOf(i) !== 'shared' }">
          <div class="item-head">
            <span class="name">{{ item.description }}</span>
            <!-- Detalhe: a inicial do dono no item marcado (preenchida = de quem vê; vazada = do parceiro). -->
            <span
              v-if="!editable && markOf(i) !== 'shared'"
              class="owner"
              :class="markOf(i)"
              :aria-label="markOf(i) === 'mine' ? 'Só seu' : `Só de ${partnerName}`"
              :title="markOf(i) === 'mine' ? 'Só seu' : `Só de ${partnerName}`"
            >{{ markOf(i) === 'mine' ? initials?.mine : initials?.partner }}</span>
          </div>
          <span class="line num">{{ itemLine(item) }}</span>
          <div v-if="editable" class="marks" role="radiogroup" :aria-label="`Dono de ${item.description}`">
            <button
              v-for="opt in options"
              :key="opt.value"
              type="button"
              role="radio"
              :aria-checked="markOf(i) === opt.value"
              :class="['mark-btn', opt.value, { on: markOf(i) === opt.value }]"
              @click="setMark(i, opt.value)"
            >
              <span v-if="markOf(i) === opt.value" aria-hidden="true">✓ </span>{{ opt.label }}
            </button>
          </div>
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
import { computed } from 'vue';
import { hasMarks, sumsFromMarks, type ViewerMark } from '@/domain/itemMarks';
import { formatBRL } from '@/domain/money';
import { itemLine } from '@/services/nfceItems';
import type { NfceItems } from '../../functions/src/nfce';

/**
 * Lista dos itens de uma NFC-e de SP conferida (funciona offline, do cache).
 * `device`: itens lidos no aparelho (o servidor não conseguiu consultar), sem conferência da SEFAZ.
 * Marcações (v0.9.2, relativas a quem vê): no formulário (`editable`), cada item
 * é dividido, só meu ou só do parceiro; no Detalhe, a inicial do dono aparece
 * em cada item marcado. `marksWarning`: as marcações não correspondem a estes itens.
 */
const props = defineProps<{
  items: NfceItems;
  issuer?: string;
  device?: boolean;
  marks?: readonly ViewerMark[] | null;
  editable?: boolean;
  partnerName?: string;
  initials?: { mine: string; partner: string };
  marksWarning?: string | null;
}>();
const emit = defineEmits<{ close: []; 'update:marks': [marks: ViewerMark[]] }>();

const options = computed<Array<{ value: ViewerMark; label: string }>>(() => [
  { value: 'shared', label: 'Dividido' },
  { value: 'mine', label: 'Só meu' },
  { value: 'partner', label: `Só de ${props.partnerName ?? 'parceiro'}` },
]);

const markOf = (i: number): ViewerMark => props.marks?.[i] ?? 'shared';
const marked = computed(() => hasMarks(props.marks));

function setMark(i: number, value: ViewerMark): void {
  const next = props.items.items.map((_, k) => (k === i ? value : markOf(k)));
  emit('update:marks', next);
}

const marksSummary = computed(() => {
  const s = sumsFromMarks(props.items, props.marks ?? []);
  const discount = props.items.discountCents > 0 ? ' (com o desconto da nota distribuído)' : '';
  return `Só minha: ${formatBRL(s.mineCents)} · Só de ${props.partnerName}: ${formatBRL(s.partnerCents)}${discount}`;
});
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

.item-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.owner {
  flex: none;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  border: 1.5px solid var(--app-text);
}

.owner.mine {
  background: var(--app-text);
  color: var(--app-surface);
}

.owner.partner {
  background: transparent;
  color: var(--app-text);
}

.marks {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.mark-btn {
  min-height: 34px;
  padding: 4px 6px;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mark-btn.on {
  background: var(--app-text);
  color: var(--app-surface);
  border-color: var(--app-text);
}

.mark-btn.partner.on {
  background: var(--app-surface);
  color: var(--app-text);
  border: 2px solid var(--app-text);
}

.strong-hint {
  font-weight: 700;
  color: var(--app-text);
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
