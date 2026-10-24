import type { IsoDate } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import { badgeFor, type BadgeKind, type BadgeSource } from './expenseView';

/**
 * Filtros da lista de gastos do Painel. Afetam só a lista (o saldo continua
 * do mês inteiro). Critérios diferentes se somam (E); dentro de um critério,
 * as opções marcadas valem qualquer uma (OU). Lista vazia = critério desligado.
 */

/** Situações filtráveis: as dos selos de status dos gastos (sem "Previsto", que não é gasto). */
export type StatusFilter = Exclude<BadgeKind, 'forecast'>;

export const STATUS_FILTERS: ReadonlyArray<{ kind: StatusFilter; label: string }> = [
  { kind: 'pending', label: 'Pendente / Aprovar' },
  { kind: 'auto', label: 'Automático' },
  { kind: 'photo', label: 'Foto do recibo' },
  { kind: 'recurring', label: 'Recorrente aprovado' },
  { kind: 'validated', label: 'Validado' },
  { kind: 'returned', label: 'Devolvido' },
  { kind: 'awaiting', label: 'A confirmar' },
  { kind: 'deletion', label: 'Exclusão pedida' },
];

export type TypeFilter = 'installment' | 'recurring';

export const TYPE_FILTERS: ReadonlyArray<{ kind: TypeFilter; label: string }> = [
  { kind: 'installment', label: 'Parcelado' },
  { kind: 'recurring', label: 'Recorrente' },
];

/** Id usado no filtro de categoria para "Sem categoria". */
export const NO_CATEGORY_FILTER = '';

export interface ExpenseFilters {
  payers: string[];
  /** Ids de categoria; `NO_CATEGORY_FILTER` = sem categoria. */
  categories: string[];
  statuses: StatusFilter[];
  types: TypeFilter[];
  /** Período de datas (do gasto, não da competência), inclusivo. */
  from?: IsoDate;
  to?: IsoDate;
  /** Busca na descrição, sem diferenciar maiúsculas nem acentos. */
  search: string;
}

export const emptyFilters = (): ExpenseFilters => ({ payers: [], categories: [], statuses: [], types: [], search: '' });

export type FilterableExpense = BadgeSource & {
  description: string;
  date: IsoDate;
  payerUid: string;
  totalCents: number;
  categoryId?: string;
  recurringId?: string;
  installment?: unknown;
};

/** Sem acentos, minúsculas e espaços simples, para a busca. */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quantos critérios estão em uso ("Filtros · 2"); o período conta como um. */
export function activeFilterCount(f: ExpenseFilters): number {
  return (
    (f.payers.length > 0 ? 1 : 0) +
    (f.categories.length > 0 ? 1 : 0) +
    (f.statuses.length > 0 ? 1 : 0) +
    (f.types.length > 0 ? 1 : 0) +
    (f.from || f.to ? 1 : 0) +
    (searchKey(f.search) ? 1 : 0)
  );
}

export function matchesFilters(e: FilterableExpense, f: ExpenseFilters, viewerUid: string): boolean {
  if (f.payers.length > 0 && !f.payers.includes(e.payerUid)) return false;
  if (f.categories.length > 0 && !f.categories.includes(e.categoryId ?? NO_CATEGORY_FILTER)) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(badgeFor(e, viewerUid).kind as StatusFilter)) return false;
  if (f.types.length > 0) {
    const ok = (f.types.includes('installment') && !!e.installment) || (f.types.includes('recurring') && !!e.recurringId);
    if (!ok) return false;
  }
  if (f.from && e.date < f.from) return false;
  if (f.to && e.date > f.to) return false;
  const q = searchKey(f.search);
  return !q || searchKey(e.description).includes(q);
}

export function filterExpenses<E extends FilterableExpense>(list: readonly E[], f: ExpenseFilters, viewerUid: string): E[] {
  return activeFilterCount(f) === 0 ? [...list] : list.filter((e) => matchesFilters(e, f, viewerUid));
}

/** "Mostrando 4 de 23 gastos · R$ 532,00" (soma dos valores mostrados). */
export function filterSummary(shown: readonly FilterableExpense[], total: number): string {
  const sum = shown.reduce((s, e) => s + e.totalCents, 0);
  return `Mostrando ${shown.length} de ${total} ${total === 1 ? 'gasto' : 'gastos'} · ${formatBRL(sum)}`;
}

/** O período dos filtros não toca o mês (`YYYY-MM`): a lista fica vazia por isso. */
export function periodOutsideMonth(f: ExpenseFilters, month: string): boolean {
  const first = `${month}-01`;
  const last = `${month}-31`;
  return (!!f.to && f.to < first) || (!!f.from && f.from > last);
}
