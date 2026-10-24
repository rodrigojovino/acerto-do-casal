import { describe, expect, it } from 'vitest';
import { formatBRL } from '@/domain/money';
import type { Expense } from './expenses';
import {
  NO_CATEGORY_FILTER,
  activeFilterCount,
  emptyFilters,
  filterExpenses,
  filterSummary,
  matchesFilters,
  periodOutsideMonth,
  searchKey,
  type ExpenseFilters,
} from './expenseFilters';

const A = 'uid-a';
const B = 'uid-b';

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'e1',
    description: 'Mercado',
    totalCents: 20000,
    personalCents: 0,
    payerUid: A,
    payerSharePct: 50,
    date: '2026-10-05',
    competence: '2026-10',
    receipt: { type: 'none' },
    status: 'pending_approval',
    createdBy: A,
    createdAt: null,
    updatedAt: null,
    pendingWrite: false,
    ...overrides,
  };
}

const f = (over: Partial<ExpenseFilters>): ExpenseFilters => ({ ...emptyFilters(), ...over });

const list = [
  expense({ id: 'mercado', description: 'Mercado Pão de Açúcar', categoryId: 'c1' }),
  expense({ id: 'luz', description: 'Luz', payerUid: B, createdBy: B, status: 'confirmed', recurringId: 'r1', date: '2026-10-10' }),
  expense({
    id: 'geladeira',
    description: 'Geladeira',
    status: 'confirmed',
    receipt: { type: 'photo', photoPath: 'p', photoUploaded: true },
    installment: { seriesId: 's', index: 1, count: 10, firstMonth: '2026-10', purchaseCents: 214000 },
    totalCents: 21400,
    categoryId: 'c2',
    date: '2026-10-20',
  }),
  expense({ id: 'farmacia', description: 'Farmácia', status: 'returned', categoryId: 'c2', date: '2026-10-28' }),
];
const ids = (l: readonly Expense[]) => l.map((e) => e.id);

describe('contagem e busca', () => {
  it('cada critério em uso conta um; o período conta um só', () => {
    expect(activeFilterCount(emptyFilters())).toBe(0);
    expect(activeFilterCount(f({ payers: [A, B], from: '2026-10-01', to: '2026-10-15', search: ' ' }))).toBe(2);
    expect(activeFilterCount(f({ categories: ['c1'], statuses: ['pending'], types: ['recurring'], search: 'luz' }))).toBe(4);
  });

  it('busca sem maiúsculas nem acentos', () => {
    expect(searchKey('  Pão  de AÇÚCAR ')).toBe('pao de acucar');
    expect(ids(filterExpenses(list, f({ search: 'acucar' }), A))).toEqual(['mercado']);
    expect(ids(filterExpenses(list, f({ search: 'FARMACIA' }), A))).toEqual(['farmacia']);
  });
});

describe('critérios', () => {
  it('sem filtro, a lista inteira', () => {
    expect(ids(filterExpenses(list, emptyFilters(), A))).toEqual(['mercado', 'luz', 'geladeira', 'farmacia']);
  });

  it('quem pagou', () => {
    expect(ids(filterExpenses(list, f({ payers: [B] }), A))).toEqual(['luz']);
  });

  it('categoria, inclusive "Sem categoria"', () => {
    expect(ids(filterExpenses(list, f({ categories: ['c2'] }), A))).toEqual(['geladeira', 'farmacia']);
    expect(ids(filterExpenses(list, f({ categories: [NO_CATEGORY_FILTER, 'c1'] }), A))).toEqual(['mercado', 'luz']);
  });

  it('situação pelo selo (o mesmo da lista), qualquer uma das marcadas', () => {
    expect(ids(filterExpenses(list, f({ statuses: ['photo', 'returned'] }), A))).toEqual(['geladeira', 'farmacia']);
    expect(ids(filterExpenses(list, f({ statuses: ['recurring'] }), A))).toEqual(['luz']);
    expect(matchesFilters(list[0], f({ statuses: ['pending'] }), B)).toBe(true);
    const deletion = expense({ status: 'confirmed', everConfirmed: true, deletionRequest: { byUid: A, at: null, status: 'pending' } });
    expect(matchesFilters(deletion, f({ statuses: ['deletion'] }), A)).toBe(true);
    expect(matchesFilters(deletion, f({ statuses: ['validated'] }), A)).toBe(false);
  });

  it('tipo: parcelado ou recorrente', () => {
    expect(ids(filterExpenses(list, f({ types: ['installment'] }), A))).toEqual(['geladeira']);
    expect(ids(filterExpenses(list, f({ types: ['installment', 'recurring'] }), A))).toEqual(['luz', 'geladeira']);
  });

  it('período de datas, inclusivo, só início ou só fim', () => {
    expect(ids(filterExpenses(list, f({ from: '2026-10-10', to: '2026-10-20' }), A))).toEqual(['luz', 'geladeira']);
    expect(ids(filterExpenses(list, f({ from: '2026-10-21' }), A))).toEqual(['farmacia']);
    expect(ids(filterExpenses(list, f({ to: '2026-10-05' }), A))).toEqual(['mercado']);
  });

  it('critérios diferentes se somam', () => {
    expect(ids(filterExpenses(list, f({ payers: [A], categories: ['c2'], statuses: ['returned'] }), A))).toEqual(['farmacia']);
  });
});

describe('resumo', () => {
  it('quantos de quantos e a soma dos mostrados', () => {
    const shown = filterExpenses(list, f({ categories: ['c2'] }), A);
    expect(filterSummary(shown, list.length)).toBe(`Mostrando 2 de 4 gastos · ${formatBRL(41400)}`);
  });

  it('período fora do mês', () => {
    expect(periodOutsideMonth(f({ to: '2026-09-30' }), '2026-10')).toBe(true);
    expect(periodOutsideMonth(f({ from: '2026-11-01' }), '2026-10')).toBe(true);
    expect(periodOutsideMonth(f({ from: '2026-10-31' }), '2026-10')).toBe(false);
    expect(periodOutsideMonth(emptyFilters(), '2026-10')).toBe(false);
  });
});
