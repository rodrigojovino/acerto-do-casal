import { describe, expect, it } from 'vitest';
import {
  addMonths,
  countsInBalance,
  expenseDebt,
  monthBalance,
  paidByMember,
  pendingSummary,
  splitInstallments,
  type Members,
  type SettlementExpense,
} from './settlement';

// UIDs fictícios: nunca usar dados reais do casal.
const A = 'uid-a';
const B = 'uid-b';
const members: Members = [A, B];

function expense(overrides: Partial<SettlementExpense>): SettlementExpense {
  return {
    totalCents: 0,
    personalCents: 0,
    payerUid: A,
    payerSharePct: 50,
    status: 'confirmed',
    ...overrides,
  };
}

describe('expenseDebt', () => {
  it('desconta a parte pessoal antes de dividir', () => {
    const debt = expenseDebt(expense({ totalCents: 20000, personalCents: 5000 }), members);
    expect(debt).toEqual({ fromUid: B, toUid: A, amountCents: 7500 });
  });

  it('a dívida é sempre do não pagador com o pagador', () => {
    const debt = expenseDebt(expense({ totalCents: 30000, payerUid: B }), members);
    expect(debt).toEqual({ fromUid: A, toUid: B, amountCents: 15000 });
  });

  it('respeita divisão diferente de 50/50', () => {
    // Pagador assume 70%, o outro deve 30%.
    const debt = expenseDebt(expense({ totalCents: 10000, payerSharePct: 70 }), members);
    expect(debt.amountCents).toBe(3000);
  });

  it('arredonda com Math.round no nível do gasto', () => {
    // 101 * 50% = 50,5 → 51
    expect(expenseDebt(expense({ totalCents: 101 }), members).amountCents).toBe(51);
    // 99 * 30% = 29,7 → 30
    expect(expenseDebt(expense({ totalCents: 99, payerSharePct: 70 }), members).amountCents).toBe(30);
  });

  it('pagador com 100% ou gasto todo pessoal não gera dívida', () => {
    expect(expenseDebt(expense({ totalCents: 5000, payerSharePct: 100 }), members).amountCents).toBe(0);
    expect(expenseDebt(expense({ totalCents: 5000, personalCents: 5000 }), members).amountCents).toBe(0);
  });

  it('pagador com 0% faz o outro dever todo o rateio', () => {
    expect(expenseDebt(expense({ totalCents: 5000, payerSharePct: 0 }), members).amountCents).toBe(5000);
  });

  it('rejeita entradas inválidas', () => {
    expect(() => expenseDebt(expense({ totalCents: 10.5 }), members)).toThrow(RangeError);
    expect(() => expenseDebt(expense({ totalCents: -100 }), members)).toThrow(RangeError);
    expect(() => expenseDebt(expense({ totalCents: 100, personalCents: 200 }), members)).toThrow(RangeError);
    expect(() => expenseDebt(expense({ totalCents: 100, payerSharePct: 101 }), members)).toThrow(RangeError);
    expect(() => expenseDebt(expense({ totalCents: 100, payerSharePct: 33.3 }), members)).toThrow(RangeError);
    expect(() => expenseDebt(expense({ totalCents: 100, payerUid: 'uid-x' }), members)).toThrow(RangeError);
    expect(() => expenseDebt(expense({ totalCents: 100 }), [A, A])).toThrow(RangeError);
  });
});

describe('countsInBalance', () => {
  it('só awaiting_confirmation fica fora do saldo', () => {
    expect(countsInBalance('confirmed')).toBe(true);
    expect(countsInBalance('pending_approval')).toBe(true);
    expect(countsInBalance('returned')).toBe(true);
    expect(countsInBalance('awaiting_confirmation')).toBe(false);
  });
});

describe('monthBalance', () => {
  it('exemplo de referência: A paga R$ 100,00 a B', () => {
    const expenses = [
      expense({ totalCents: 20000, personalCents: 5000, payerUid: A }), // Mercado
      expense({ totalCents: 30000, payerUid: B }), // Luz
      expense({ totalCents: 12000, payerUid: A }), // Internet
      expense({ totalCents: 21400, payerUid: B }), // Geladeira (parcela)
      expense({ totalCents: 8000, payerUid: A }), // Farmácia
      expense({ totalCents: 3600, payerUid: B }), // Padaria
    ];
    expect(monthBalance(expenses, members)).toEqual({ fromUid: A, toUid: B, amountCents: 10000 });
  });

  it('o resultado não depende da ordem dos membros', () => {
    const expenses = [expense({ totalCents: 10000, payerUid: A })];
    expect(monthBalance(expenses, [B, A])).toEqual({ fromUid: B, toUid: A, amountCents: 5000 });
  });

  it('conta pending_approval e returned, ignora awaiting_confirmation', () => {
    const expenses = [
      expense({ totalCents: 10000, status: 'pending_approval' }),
      expense({ totalCents: 4000, status: 'returned' }),
      expense({ totalCents: 99900, status: 'awaiting_confirmation' }),
    ];
    expect(monthBalance(expenses, members)).toEqual({ fromUid: B, toUid: A, amountCents: 7000 });
  });

  it('retorna null quando o mês está zerado', () => {
    expect(monthBalance([], members)).toBeNull();
    const expenses = [
      expense({ totalCents: 10000, payerUid: A }),
      expense({ totalCents: 10000, payerUid: B }),
    ];
    expect(monthBalance(expenses, members)).toBeNull();
  });

  it('soma os arredondamentos de cada gasto, não do total', () => {
    // Três gastos de 1 centavo: cada um arredonda 0,5 → 1.
    const expenses = [1, 1, 1].map((c) => expense({ totalCents: c }));
    expect(monthBalance(expenses, members)?.amountCents).toBe(3);
  });
});

describe('addMonths', () => {
  it('avança e recua meses com virada de ano', () => {
    expect(addMonths('2026-11', 0)).toBe('2026-11');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 25)).toBe('2029-01');
  });

  it('rejeita competência mal formatada', () => {
    expect(() => addMonths('2026-13', 1)).toThrow(RangeError);
    expect(() => addMonths('2026-1', 1)).toThrow(RangeError);
  });
});

describe('splitInstallments', () => {
  it('resto dos centavos vai na primeira parcela', () => {
    const parts = splitInstallments({
      totalCents: 100000,
      personalCents: 0,
      count: 3,
      firstCompetence: '2026-11',
    });
    expect(parts.map((p) => p.totalCents)).toEqual([33334, 33333, 33333]);
    expect(parts.map((p) => p.competence)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(parts.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(parts.every((p) => p.count === 3)).toBe(true);
  });

  it('parcela única preserva os valores', () => {
    const [only] = splitInstallments({
      totalCents: 21400,
      personalCents: 400,
      count: 1,
      firstCompetence: '2026-10',
    });
    expect(only).toEqual({
      index: 1,
      count: 1,
      totalCents: 21400,
      personalCents: 400,
      competence: '2026-10',
    });
  });

  it('divide a parte pessoal proporcionalmente e a soma bate', () => {
    const parts = splitInstallments({
      totalCents: 120000,
      personalCents: 30000,
      count: 10,
      firstCompetence: '2026-10',
    });
    expect(parts.every((p) => p.personalCents === 3000)).toBe(true);
  });

  it('parte pessoal nunca passa do valor da parcela, mesmo em casos extremos', () => {
    const cases = [
      { totalCents: 10, personalCents: 9, count: 10 },
      { totalCents: 10, personalCents: 1, count: 10 },
      { totalCents: 1001, personalCents: 1000, count: 7 },
      { totalCents: 99999, personalCents: 33333, count: 12 },
      { totalCents: 5, personalCents: 5, count: 3 },
    ];
    for (const c of cases) {
      const parts = splitInstallments({ ...c, firstCompetence: '2026-01' });
      const sum = (key: 'totalCents' | 'personalCents') => parts.reduce((acc, p) => acc + p[key], 0);
      expect(sum('totalCents')).toBe(c.totalCents);
      expect(sum('personalCents')).toBe(c.personalCents);
      for (const p of parts) {
        expect(p.personalCents).toBeGreaterThanOrEqual(0);
        expect(p.personalCents).toBeLessThanOrEqual(p.totalCents);
      }
    }
  });

  it('rejeita entradas inválidas', () => {
    const valid = { totalCents: 1000, personalCents: 0, count: 2, firstCompetence: '2026-10' };
    expect(() => splitInstallments({ ...valid, count: 0 })).toThrow(RangeError);
    expect(() => splitInstallments({ ...valid, count: 1.5 })).toThrow(RangeError);
    expect(() => splitInstallments({ ...valid, personalCents: 2000 })).toThrow(RangeError);
    expect(() => splitInstallments({ ...valid, totalCents: 10.5 })).toThrow(RangeError);
    expect(() => splitInstallments({ ...valid, firstCompetence: '10/2026' })).toThrow(RangeError);
  });
});

describe('paidByMember', () => {
  it('soma o total pago por cada um, com a parte pessoal', () => {
    const expenses = [
      expense({ totalCents: 20000, personalCents: 5000, payerUid: A }),
      expense({ totalCents: 30000, payerUid: B }),
      expense({ totalCents: 12000, payerUid: A }),
    ];
    expect(paidByMember(expenses, members)).toEqual({ [A]: 32000, [B]: 30000 });
  });

  it('ignora awaiting_confirmation e começa em zero', () => {
    expect(paidByMember([], members)).toEqual({ [A]: 0, [B]: 0 });
    expect(paidByMember([expense({ totalCents: 500, status: 'awaiting_confirmation' })], members)).toEqual({
      [A]: 0,
      [B]: 0,
    });
  });

  it('rejeita pagador de fora do grupo', () => {
    expect(() => paidByMember([expense({ totalCents: 1, payerUid: 'uid-x' })], members)).toThrow(RangeError);
  });
});

describe('pendingSummary', () => {
  it('conta pendências do ponto de vista de quem olha', () => {
    const list = [
      { status: 'pending_approval' as const, createdBy: A },
      { status: 'pending_approval' as const, createdBy: B },
      { status: 'returned' as const, createdBy: A },
      { status: 'confirmed' as const, createdBy: B },
      { status: 'awaiting_confirmation' as const, createdBy: A },
    ];
    expect(pendingSummary(list, A)).toEqual({ open: 3, awaitingMyApproval: 1, returnedToMe: 1 });
    expect(pendingSummary(list, B)).toEqual({ open: 3, awaitingMyApproval: 1, returnedToMe: 0 });
  });
});
