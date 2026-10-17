import { describe, expect, it } from 'vitest';
import type { Expense } from './expenses';
import { expenseSubtitle, splitLabel, tagFor } from './expenseView';

const A = 'uid-a';
const B = 'uid-b';

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'e1',
    description: 'Mercado',
    totalCents: 20000,
    personalCents: 5000,
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

describe('tagFor', () => {
  it('pendente é "Pendente" para quem lançou e "Aprovar" para o outro', () => {
    expect(tagFor(expense({}), A)).toBe('pending');
    expect(tagFor(expense({}), B)).toBe('approve');
  });

  it('devolvido e confirmado', () => {
    expect(tagFor(expense({ status: 'returned' }), A)).toBe('returned');
    expect(tagFor(expense({ status: 'confirmed' }), A)).toBeNull();
  });
});

describe('splitLabel usa a conversão de split.ts', () => {
  it('cada membro vê a divisão do seu lado', () => {
    const e = expense({ payerUid: B, payerSharePct: 70 });
    expect(splitLabel(e, B)).toBe('70/30');
    expect(splitLabel(e, A)).toBe('30/70');
  });
});

describe('expenseSubtitle', () => {
  it('monta a linha da lista', () => {
    expect(expenseSubtitle(expense({}), A, 'Você')).toBe('Você · 05/10 · R$ 50,00 pessoal · 50/50');
  });

  it('omite a parte pessoal zerada e mostra o ano quando a competência é outra', () => {
    const e = expense({ personalCents: 0, date: '2026-09-28', competence: '2026-10' });
    expect(expenseSubtitle(e, A, 'Você')).toBe('Você · 28/09/2026 · 50/50');
  });
});
