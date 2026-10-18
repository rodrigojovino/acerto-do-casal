import { describe, expect, it } from 'vitest';
import type { Expense } from './expenses';
import { debtView, expenseSubtitle, flagsFor, splitLabel, tagFor } from './expenseView';

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

describe('debtView', () => {
  const nameOf = (uid: string) => (uid === A ? 'Ana' : 'Bia');

  it('mostra a dívida do lado de cada um', () => {
    const e = { totalCents: 20000, personalCents: 5000, payerUid: A, payerSharePct: 50 };
    expect(debtView(e, [A, B], A, nameOf)).toEqual({ label: 'Bia te deve por este gasto', amountCents: 7500 });
    expect(debtView(e, [A, B], B, nameOf)).toEqual({ label: 'Você deve por este gasto', amountCents: 7500 });
  });

  it('respeita divisão diferente de 50/50 e pagador outro', () => {
    // B pagou 100,00 e fica com 70%: A deve 30,00.
    const e = { totalCents: 10000, personalCents: 0, payerUid: B, payerSharePct: 70 };
    expect(debtView(e, [A, B], A, nameOf)).toEqual({ label: 'Você deve por este gasto', amountCents: 3000 });
  });

  it('gasto todo pessoal não gera dívida', () => {
    const e = { totalCents: 5000, personalCents: 5000, payerUid: A, payerSharePct: 50 };
    expect(debtView(e, [A, B], A, nameOf)).toEqual({ label: 'Ninguém deve nada por este gasto', amountCents: 0 });
  });
});

describe('flagsFor', () => {
  const nfce = (status: 'pending' | 'ok' | 'failed', notaCents?: number) => ({
    type: 'nfce' as const,
    nfceKey: '3'.repeat(44),
    nfceUrl: 'https://www.nfce.fazenda.sp.gov.br/x',
    nfceStatus: status,
    ...(notaCents === undefined ? {} : { nfceData: { issuerName: 'LOJA', totalCents: notaCents, date: '2026-10-05' } }),
  });

  it('valor diferente da nota só quando a nota foi conferida e o valor diverge', () => {
    expect(flagsFor(expense({ totalCents: 20000, receipt: nfce('ok', 19900) }))).toEqual(['nfce-diff']);
    expect(flagsFor(expense({ totalCents: 20000, receipt: nfce('ok', 20000) }))).toEqual([]);
  });

  it('nota em conferência, nota não conferida e foto não enviada', () => {
    expect(flagsFor(expense({ receipt: nfce('pending') }))).toEqual(['nfce-checking']);
    expect(flagsFor(expense({ receipt: nfce('failed') }))).toEqual(['nfce-failed']);
    expect(flagsFor(expense({ receipt: { type: 'photo', photoPath: 'p', photoUploaded: false } }))).toEqual(['photo-missing']);
    expect(flagsFor(expense({ receipt: { type: 'photo', photoPath: 'p', photoUploaded: true } }))).toEqual([]);
    expect(flagsFor(expense({}))).toEqual([]);
  });
});
