import { describe, expect, it } from 'vitest';
import { closeBlockers, closeReasons, monthBreakdown, remainingTransfer, type Payment } from './closing';
import { monthBalance, type Members, type SettlementExpense } from './settlement';

// UIDs fictícios: nunca usar dados reais do casal.
const A = 'uid-a';
const B = 'uid-b';
const members: Members = [A, B];

function expense(overrides: Partial<SettlementExpense>): SettlementExpense {
  return { totalCents: 0, personalCents: 0, payerUid: A, payerSharePct: 50, status: 'confirmed', ...overrides };
}

/** Exemplo de referência do CLAUDE.md: A paga R$ 100,00 a B. */
const reference = [
  expense({ totalCents: 20000, personalCents: 5000, payerUid: A }), // Mercado
  expense({ totalCents: 30000, payerUid: B }), // Luz
  expense({ totalCents: 12000, payerUid: A }), // Internet
  expense({ totalCents: 21400, payerUid: B }), // Geladeira (parcela)
  expense({ totalCents: 8000, payerUid: A }), // Farmácia
  expense({ totalCents: 3600, payerUid: B }), // Padaria
];

const pay = (fromUid: string, amountCents: number, method: Payment['method'] = 'pix') => ({
  fromUid,
  toUid: fromUid === A ? B : A,
  amountCents,
  method,
});

describe('monthBreakdown', () => {
  it('exemplo de referência: memória de cálculo completa e A paga R$ 100,00 a B', () => {
    const b = monthBreakdown(reference, members);
    expect(b).toMatchObject({ expenseCount: 6, totalCents: 95000, personalCents: 5000, sharedCents: 90000 });
    expect(b.byMember[A]).toEqual({ shareCents: 45000, paidSharedCents: 35000, diffCents: -10000 });
    expect(b.byMember[B]).toEqual({ shareCents: 45000, paidSharedCents: 55000, diffCents: 10000 });
    expect(b.result).toEqual({ fromUid: A, toUid: B, amountCents: 10000 });
  });

  it('arredondamento por gasto: as partes somam o rateio e o resultado é o do saldo', () => {
    const odd = [expense({ totalCents: 101, payerUid: A }), expense({ totalCents: 333, payerUid: B, payerSharePct: 70 })];
    const b = monthBreakdown(odd, members);
    expect(b.byMember[A].shareCents + b.byMember[B].shareCents).toBe(b.sharedCents);
    expect(b.byMember[A].diffCents + b.byMember[B].diffCents).toBe(0);
    expect(b.result).toEqual(monthBalance(odd, members));
  });

  it('bate com monthBalance em meses variados (divisões, pessoais, os dois pagando)', () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let round = 0; round < 200; round++) {
      const list = Array.from({ length: 1 + rnd(12) }, () => {
        const total = 1 + rnd(500000);
        return expense({ totalCents: total, personalCents: rnd(total + 1), payerUid: rnd(2) ? A : B, payerSharePct: rnd(101) });
      });
      const b = monthBreakdown(list, members);
      expect(b.result).toEqual(monthBalance(list, members));
      expect(b.byMember[A].diffCents + b.byMember[B].diffCents).toBe(0);
    }
  });

  it('recorrente aguardando o valor fica fora; mês vazio não deve nada', () => {
    const b = monthBreakdown([expense({ totalCents: 9000, status: 'awaiting_confirmation' })], members);
    expect(b.expenseCount).toBe(0);
    expect(b.result).toBeNull();
    expect(monthBreakdown([], members).result).toBeNull();
  });
});

describe('closeBlockers', () => {
  it('lista pendentes, devolvidos, recorrentes a confirmar e fotos não enviadas', () => {
    const none = { type: 'none' };
    expect(
      closeBlockers([
        { status: 'pending_approval', receipt: none },
        { status: 'pending_approval', receipt: none },
        { status: 'returned', receipt: none },
        { status: 'awaiting_confirmation', receipt: none },
        { status: 'confirmed', receipt: { type: 'photo', photoUploaded: false } },
        { status: 'confirmed', receipt: { type: 'photo', photoUploaded: true } },
        { status: 'confirmed', receipt: { type: 'nfce' } },
      ]),
    ).toEqual([
      { kind: 'pending', count: 2 },
      { kind: 'returned', count: 1 },
      { kind: 'awaiting', count: 1 },
      { kind: 'photo', count: 1 },
    ]);
    expect(closeBlockers([{ status: 'confirmed', receipt: none }])).toEqual([]);
  });
});

describe('remainingTransfer: pagamentos como lista', () => {
  const balance = { fromUid: A, toUid: B, amountCents: 10000 };

  it('sem pagamento falta o saldo; pagando o saldo, acertado', () => {
    expect(remainingTransfer(balance, [], members)).toEqual(balance);
    expect(remainingTransfer(balance, [pay(A, 10000)], members)).toBeNull();
    expect(remainingTransfer(null, [], members)).toBeNull();
  });

  it('fechar, reabrir, incluir gasto, pagar só a diferença, fechar', () => {
    const payments = [pay(A, 10000)];
    // Reaberto: um gasto de R$ 60,00 pago por B entra (A deve mais R$ 30,00).
    const after = monthBalance([...reference, expense({ totalCents: 6000, payerUid: B })], members);
    expect(after).toEqual({ fromUid: A, toUid: B, amountCents: 13000 });
    const remaining = remainingTransfer(after, payments, members);
    expect(remaining).toEqual({ fromUid: A, toUid: B, amountCents: 3000 });
    expect(remainingTransfer(after, [...payments, pay(A, 3000, 'cash')], members)).toBeNull();
  });

  it('saldo diminuiu depois de pago: falta a devolução, no sentido contrário', () => {
    const payments = [pay(A, 10000)];
    // Reaberto: a Padaria de B (R$ 36,00) é excluída; A passa a dever R$ 82,00.
    const after = monthBalance(reference.slice(0, 5), members);
    expect(after).toEqual({ fromUid: A, toUid: B, amountCents: 8200 });
    expect(remainingTransfer(after, payments, members)).toEqual({ fromUid: B, toUid: A, amountCents: 1800 });
    expect(remainingTransfer(after, [...payments, pay(B, 1800)], members)).toBeNull();
  });

  it('saldo zerou depois de pago: devolve tudo; saldo inverteu: devolve e paga a diferença', () => {
    expect(remainingTransfer(null, [pay(A, 10000)], members)).toEqual({ fromUid: B, toUid: A, amountCents: 10000 });
    const inverted = { fromUid: B, toUid: A, amountCents: 2000 };
    expect(remainingTransfer(inverted, [pay(A, 10000)], members)).toEqual({ fromUid: B, toUid: A, amountCents: 12000 });
  });

  it('pagamento com alguém de fora do casal é erro', () => {
    expect(() => remainingTransfer(balance, [{ fromUid: 'uid-c', toUid: B, amountCents: 1 }], members)).toThrow(RangeError);
  });
});

describe('closeReasons', () => {
  const base = { month: '2026-10', currentMonth: '2026-10', closed: false, online: true, blockers: [], remaining: null };

  it('mês atual, online, sem pendências e acertado: pode fechar', () => {
    expect(closeReasons(base)).toEqual([]);
    expect(closeReasons({ ...base, month: '2026-09' })).toEqual([]);
  });

  it('mês futuro nunca fecha; sem conexão não fecha (no app)', () => {
    expect(closeReasons({ ...base, month: '2026-11' })).toEqual(['future']);
    expect(closeReasons({ ...base, online: false })).toEqual(['offline']);
  });

  it('pendências, acerto por pagar e mês já fechado', () => {
    expect(
      closeReasons({
        ...base,
        closed: true,
        blockers: [{ kind: 'pending', count: 1 }],
        remaining: { fromUid: A, toUid: B, amountCents: 1 },
      }),
    ).toEqual(['closed', 'blocked', 'unpaid']);
  });
});
