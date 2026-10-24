<template>
  <div class="sheet">
    <header class="sheet-head">
      <h2>Filtros</h2>
      <button class="icon-btn" type="button" aria-label="Fechar" @click="emit('close')">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div class="sheet-body">
      <p class="hint">Valem só para a lista; o saldo continua do mês inteiro. Continuam ao trocar de mês, até você limpar.</p>

      <fieldset>
        <legend>Busca na descrição</legend>
        <input v-model="draft.search" class="input" type="search" placeholder="Ex.: mercado" aria-label="Buscar na descrição" />
      </fieldset>

      <fieldset>
        <legend>Quem pagou</legend>
        <div class="chips">
          <button v-for="p in payers" :key="p.uid" type="button" class="chip" :aria-pressed="has(draft.payers, p.uid)" @click="toggle(draft.payers, p.uid)">
            {{ p.label }}
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Categoria</legend>
        <div class="chips">
          <button
            v-for="c in categoryOptions"
            :key="c.id"
            type="button"
            class="chip"
            :aria-pressed="has(draft.categories, c.id)"
            @click="toggle(draft.categories, c.id)"
          >
            {{ c.label }}
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Situação</legend>
        <div class="chips">
          <button v-for="s in STATUS_FILTERS" :key="s.kind" type="button" class="chip" :aria-pressed="has(draft.statuses, s.kind)" @click="toggle(draft.statuses, s.kind)">
            {{ s.label }}
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Tipo</legend>
        <div class="chips">
          <button v-for="t in TYPE_FILTERS" :key="t.kind" type="button" class="chip" :aria-pressed="has(draft.types, t.kind)" @click="toggle(draft.types, t.kind)">
            {{ t.label }}
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Período (data do gasto)</legend>
        <div class="dates">
          <label class="date">
            <span class="hint">De</span>
            <input v-model="from" class="input" type="date" />
          </label>
          <label class="date">
            <span class="hint">Até</span>
            <input v-model="to" class="input" type="date" />
          </label>
        </div>
        <p v-if="dateError" class="field-error">{{ dateError }}</p>
      </fieldset>

      <details class="legend">
        <summary>Legenda dos ícones</summary>
        <IconLegend />
      </details>
    </div>

    <footer class="sheet-foot">
      <button class="btn outline" type="button" @click="clear">Limpar filtros</button>
      <button class="btn primary" type="button" :disabled="!!dateError" @click="apply">{{ applyLabel }}</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import IconLegend from './IconLegend.vue';
import { NO_CATEGORY_LABEL, categorySections, type Category } from '@/domain/categories';
import type { IsoDate } from '@/domain/calendar';
import {
  NO_CATEGORY_FILTER,
  STATUS_FILTERS,
  TYPE_FILTERS,
  emptyFilters,
  filterExpenses,
  type ExpenseFilters,
  type FilterableExpense,
} from '@/services/expenseFilters';

/**
 * Janela de filtros do Painel: edita uma cópia e só aplica no botão, que
 * mostra quantos gastos do mês aparecem com a escolha.
 */
const props = defineProps<{
  filters: ExpenseFilters;
  expenses: readonly FilterableExpense[];
  categories: readonly Category[];
  viewerUid: string;
  partnerUid: string;
  partnerName: string;
}>();
const emit = defineEmits<{ apply: [filters: ExpenseFilters]; close: [] }>();

const draft = ref<ExpenseFilters>({
  ...props.filters,
  payers: [...props.filters.payers],
  categories: [...props.filters.categories],
  statuses: [...props.filters.statuses],
  types: [...props.filters.types],
});
const from = computed({ get: () => draft.value.from ?? '', set: (v: string) => (draft.value.from = (v || undefined) as IsoDate | undefined) });
const to = computed({ get: () => draft.value.to ?? '', set: (v: string) => (draft.value.to = (v || undefined) as IsoDate | undefined) });

const payers = computed(() => [
  { uid: props.viewerUid, label: 'Eu' },
  { uid: props.partnerUid, label: props.partnerName },
]);

/** Na ordem do casal: ativas, depois desativadas, e "Sem categoria" no fim. */
const categoryOptions = computed(() => {
  const s = categorySections(props.categories);
  return [
    ...s.active.map((c) => ({ id: c.id, label: c.name })),
    ...s.inactive.map((c) => ({ id: c.id, label: `${c.name} (desativada)` })),
    { id: NO_CATEGORY_FILTER, label: NO_CATEGORY_LABEL },
  ];
});

const has = <T,>(list: T[], v: T) => list.includes(v);
function toggle<T>(list: T[], v: T): void {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  else list.push(v);
}

const dateError = computed(() => (draft.value.from && draft.value.to && draft.value.from > draft.value.to ? 'A data inicial é depois da final.' : null));

const shownCount = computed(() => filterExpenses(props.expenses, draft.value, props.viewerUid).length);
const applyLabel = computed(() => `Ver ${shownCount.value} ${shownCount.value === 1 ? 'gasto' : 'gastos'}`);

function clear(): void {
  draft.value = emptyFilters();
}

function apply(): void {
  emit('apply', { ...draft.value, search: draft.value.search.trim() });
}
</script>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--app-bg);
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(var(--app-safe-top) + 12px) 16px 8px;
}

.sheet-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.sheet-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sheet-body > .hint {
  margin: 0;
}

fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

legend {
  padding: 0;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 800;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  border: 1.5px solid #d6d5cf;
  background: var(--app-surface);
  color: var(--app-text);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.chip[aria-pressed='true'] {
  border-color: var(--app-accent);
  background: #e8eefb;
  color: var(--app-accent);
  font-weight: 700;
}

.dates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.date {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.legend {
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--app-surface);
}

.legend summary {
  cursor: pointer;
  font-weight: 700;
  margin-bottom: 4px;
}

.sheet-foot {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 16px calc(max(var(--app-safe-bottom), 48px) + 12px);
  border-top: 1px solid var(--app-subtle);
  background: var(--app-bg);
}
</style>
