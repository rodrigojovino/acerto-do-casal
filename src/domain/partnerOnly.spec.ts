import { describe, expect, it } from 'vitest';
import { monthBreakdown } from './closing';
import { payerPartsFromViewer } from './parts';
import { expenseDebt, monthBalance, paidByMember, splitInstallments, type Members, type SettlementExpense } from './settlement';

// Parte só do parceiro (v0.9.2): a conta do acerto numa função só.
// UIDs fictícios: A e B são o casal.
const A = 'uid-a';
const B = 'uid-b';
const members: Members = [A, B];

const e = (o: Partial<SettlementExpense>): SettlementExpense => ({
  totalCents: 0,
  personalCents: 0,
  payerUid: A,
  payerSharePct: 50,
  status: 'confirmed',
  ...o,
});

describe('expenseDebt com a parte do parceiro', () => {
  it('sem parte do parceiro (ausente ou zero), o resultado é idêntico ao de antes', () => {
    const before = e({ totalCents: 20000, personalCents: 5000 });
    expect(expenseDebt(before, members)).toEqual({ fromUid: B, toUid: A, amountCents: 7500 });
    expect(expenseDebt({ ...before, partnerOnlyCents: 0 }, members)).toEqual(expenseDebt(before, members));
  });

  it('o outro deve a parte só dele inteira mais a divisão do restante', () => {
    // R$ 200,00 pago por A: R$ 50,00 só de A, R$ 30,00 só de B; restante R$ 120,00 a 50/50.
    const debt = expenseDebt(e({ totalCents: 20000, personalCents: 5000, partnerOnlyCents: 3000 }), members);
    expect(debt).toEqual({ fromUid: B, toUid: A, amountCents: 3000 + 6000 });
  });

  it('pagador B: a dívida é de A com B, e a parte do parceiro é de A', () => {
    const debt = expenseDebt(e({ totalCents: 10000, payerUid: B, personalCents: 1000, partnerOnlyCents: 2500 }), members);
    expect(debt).toEqual({ fromUid: A, toUid: B, amountCents: 2500 + 3250 });
  });

  it('com divisão diferente de 50/50, só o restante é dividido; arredondamento no gasto', () => {
    // restante 10001 − 0 − 1 = 10000 · 30% = 3000; + 1 do parceiro.
    expect(expenseDebt(e({ totalCents: 10001, partnerOnlyCents: 1, payerSharePct: 70 }), members).amountCents).toBe(3001);
    // restante 101 a 50/50 = 50,5 → 51 (Math.round), + 99 do parceiro.
    expect(expenseDebt(e({ totalCents: 200, partnerOnlyCents: 99 }), members).amountCents).toBe(150);
  });

  it('gasto todo do parceiro: ele deve o total', () => {
    expect(expenseDebt(e({ totalCents: 4590, partnerOnlyCents: 4590 }), members).amountCents).toBe(4590);
  });

  it('recusa partes negativas, fracionadas ou que passem do total', () => {
    expect(() => expenseDebt(e({ totalCents: 100, partnerOnlyCents: -1 }), members)).toThrow(RangeError);
    expect(() => expenseDebt(e({ totalCents: 100, partnerOnlyCents: 1.5 }), members)).toThrow(RangeError);
    expect(() => expenseDebt(e({ totalCents: 100, personalCents: 60, partnerOnlyCents: 41 }), members)).toThrow(RangeError);
    expect(() => expenseDebt(e({ totalCents: 100, personalCents: 60, partnerOnlyCents: 40 }), members)).not.toThrow();
  });
});

describe('exemplos do mês', () => {
  // Exemplo de referência do CLAUDE.md: A paga R$ 100,00 a B (sem partes do parceiro).
  const reference = [
    e({ totalCents: 20000, personalCents: 5000, payerUid: A }),
    e({ totalCents: 30000, payerUid: B }),
    e({ totalCents: 12000, payerUid: A }),
    e({ totalCents: 21400, payerUid: B }),
    e({ totalCents: 8000, payerUid: A }),
    e({ totalCents: 3600, payerUid: B }),
  ];

  it('o exemplo de referência continua dando R$ 100,00 de A para B', () => {
    expect(monthBalance(reference, members)).toEqual({ fromUid: A, toUid: B, amountCents: 10000 });
  });

  it('com partes do parceiro, dos dois pagadores', () => {
    // Mercado de A com R$ 30,00 só de B: B passa a dever 30,00 + 45,00 (em vez de 75,00 → +R$ 15,00 para A).
    // Luz de B com R$ 20,00 só de A: A deve 20,00 + 140,00 (em vez de 150,00 → +R$ 10,00 para B).
    const withParts = reference.map((x, i) =>
      i === 0 ? { ...x, partnerOnlyCents: 3000 } : i === 1 ? { ...x, partnerOnlyCents: 2000 } : x,
    );
    // A devia 100,00 a B; +15,00 a favor de A e +10,00 a favor de B: A deve 95,00.
    expect(monthBalance(withParts, members)).toEqual({ fromUid: A, toUid: B, amountCents: 9500 });
    const breakdown = monthBreakdown(withParts, members);
    expect(breakdown.partnerOnlyCents).toBe(5000);
    // Por pessoa: R$ 30,00 só de B (pago por A) e R$ 20,00 só de A (pago por B).
    expect(breakdown.byMember[A].partnerOnlyCents).toBe(2000);
    expect(breakdown.byMember[B].partnerOnlyCents).toBe(3000);
    expect(breakdown.result).toEqual(monthBalance(withParts, members));
    expect(breakdown.byMember[A].diffCents).toBe(-9500);
    expect(breakdown.byMember[B].diffCents).toBe(9500);
  });

  it('"Só minha" digitada por quem não pagou vira a parte do parceiro no banco', () => {
    // B paga R$ 100,00 e A lança "Só minha" R$ 40,00: no banco, parte do parceiro (de A) = 40,00.
    const parts = payerPartsFromViewer({ mineCents: 4000, partnerCents: 0 }, A, B);
    expect(parts).toEqual({ personalCents: 0, partnerOnlyCents: 4000 });
    const debt = expenseDebt(e({ totalCents: 10000, payerUid: B, ...parts }), members);
    expect(debt).toEqual({ fromUid: A, toUid: B, amountCents: 4000 + 3000 });
  });
});

/** Gerador determinístico (os testes não mudam de uma execução para outra). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('propriedade: os dois lados fecham com o que foi pago', () => {
  it('com valores aleatórios e arredondamento, a diferença de um é o oposto da do outro e bate com o saldo', () => {
    const rand = rng(20261109);
    const int = (max: number) => Math.floor(rand() * (max + 1));
    for (let month = 0; month < 300; month++) {
      const expenses: SettlementExpense[] = [];
      const n = 1 + int(40);
      for (let i = 0; i < n; i++) {
        const total = 1 + int(500_000);
        const personal = rand() < 0.4 ? int(total) : 0;
        const partner = rand() < 0.4 ? int(total - personal) : 0;
        expenses.push(
          e({
            totalCents: total,
            personalCents: personal,
            partnerOnlyCents: partner,
            payerUid: rand() < 0.5 ? A : B,
            payerSharePct: rand() < 0.6 ? 50 : 5 * int(20),
            status: rand() < 0.1 ? 'awaiting_confirmation' : 'confirmed',
          }),
        );
      }
      const b = monthBreakdown(expenses, members);
      // O que um tem a receber é exatamente o que o outro tem a pagar.
      expect(b.byMember[A].diffCents + b.byMember[B].diffCents).toBe(0);
      // A memória de cálculo e o saldo dão o mesmo resultado.
      const net = b.byMember[A].diffCents;
      expect(b.result).toEqual(net === 0 ? null : net > 0 ? { fromUid: B, toUid: A, amountCents: net } : { fromUid: A, toUid: B, amountCents: -net });
      // Cada um paga, do que é dividido, a sua parte: pago − pessoal − parte = diferença; soma das partes = rateio.
      const paid = paidByMember(expenses, members);
      const counted = expenses.filter((x) => x.status !== 'awaiting_confirmation');
      const personalOf = (uid: string) => counted.filter((x) => x.payerUid === uid).reduce((s, x) => s + x.personalCents, 0);
      for (const uid of members) expect(paid[uid] - personalOf(uid)).toBe(b.byMember[uid].paidSharedCents);
      expect(b.byMember[A].shareCents + b.byMember[B].shareCents).toBe(b.sharedCents);
      // Em cada gasto: o outro deve pelo menos a parte só dele e no máximo o rateio.
      for (const x of counted) {
        const debt = expenseDebt(x, members).amountCents;
        expect(debt).toBeGreaterThanOrEqual(x.partnerOnlyCents ?? 0);
        expect(debt).toBeLessThanOrEqual(x.totalCents - x.personalCents);
      }
    }
  });
});

describe('parcelas com as duas partes', () => {
  /** A conta de antes da v0.9.2 (só a parte pessoal), para comparar. */
  function legacyPersonal(total: number, personal: number, count: number): number[] {
    const base = Math.floor(total / count);
    const out: number[] = [];
    let cum = 0;
    let prev = 0;
    for (let i = 0; i < count; i++) {
      cum += i === 0 ? base + (total - base * count) : base;
      const up = total === 0 ? 0 : Math.floor((cum * personal) / total);
      out.push(up - prev);
      prev = up;
    }
    return out;
  }

  it('sem parte do parceiro, a parte pessoal de cada parcela é a mesma de antes', () => {
    for (const [total, personal, count] of [[214000, 0, 10], [10, 9, 10], [480000, 12345, 48], [99999, 33333, 7]]) {
      const parcels = splitInstallments({ totalCents: total, personalCents: personal, count, firstCompetence: '2026-11' });
      expect(parcels.map((p) => p.personalCents)).toEqual(legacyPersonal(total, personal, count));
      expect(parcels.every((p) => p.partnerOnlyCents === 0)).toBe(true);
    }
  });

  it('caso extremo: R$ 0,10 todo dividido entre as duas partes em 10 parcelas', () => {
    const parcels = splitInstallments({ totalCents: 10, personalCents: 5, partnerOnlyCents: 5, count: 10, firstCompetence: '2026-11' });
    expect(parcels.reduce((s, p) => s + p.personalCents, 0)).toBe(5);
    expect(parcels.reduce((s, p) => s + p.partnerOnlyCents, 0)).toBe(5);
    for (const p of parcels) {
      expect(p.personalCents + p.partnerOnlyCents).toBeLessThanOrEqual(p.totalCents);
      expect(p.partnerOnlyCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('com valores aleatórios: somas exatas, nada negativo, partes nunca passam da parcela', () => {
    const rand = rng(48);
    const int = (max: number) => Math.floor(rand() * (max + 1));
    for (let k = 0; k < 2000; k++) {
      const total = 2 + int(1_000_000);
      const count = 2 + int(46);
      const personal = rand() < 0.3 ? 0 : int(total);
      const partner = rand() < 0.3 ? 0 : int(total - personal);
      const parcels = splitInstallments({ totalCents: total, personalCents: personal, partnerOnlyCents: partner, count, firstCompetence: '2026-01' });
      expect(parcels.reduce((s, p) => s + p.totalCents, 0)).toBe(total);
      expect(parcels.reduce((s, p) => s + p.personalCents, 0)).toBe(personal);
      expect(parcels.reduce((s, p) => s + p.partnerOnlyCents, 0)).toBe(partner);
      for (const p of parcels) {
        expect(p.personalCents).toBeGreaterThanOrEqual(0);
        expect(p.partnerOnlyCents).toBeGreaterThanOrEqual(0);
        expect(p.personalCents + p.partnerOnlyCents).toBeLessThanOrEqual(p.totalCents);
      }
    }
  });

  it('recusa partes que passem do total da compra', () => {
    expect(() => splitInstallments({ totalCents: 100, personalCents: 60, partnerOnlyCents: 41, count: 2, firstCompetence: '2026-11' })).toThrow(RangeError);
  });
});
