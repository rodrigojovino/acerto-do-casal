import { describe, expect, it } from 'vitest';
import { expenseDebt } from './settlement';
import { payerSharePctFromViewer, splitForViewer, stepSplit } from './split';

const A = 'uid-a';
const B = 'uid-b';

describe('splitForViewer', () => {
  it('quando eu paguei, minha parte é a do pagador', () => {
    expect(splitForViewer(70, A, A)).toEqual({ mine: 70, partner: 30 });
  });

  it('quando o outro pagou, inverte', () => {
    expect(splitForViewer(70, B, A)).toEqual({ mine: 30, partner: 70 });
  });

  it('50/50 é igual para os dois', () => {
    expect(splitForViewer(50, A, A)).toEqual({ mine: 50, partner: 50 });
    expect(splitForViewer(50, B, A)).toEqual({ mine: 50, partner: 50 });
  });

  it('os dois membros veem a mesma divisão, cada um do seu lado', () => {
    // Gasto pago por B com 70% para B: B vê 70/30, A vê 30/70.
    expect(splitForViewer(70, B, B)).toEqual({ mine: 70, partner: 30 });
    expect(splitForViewer(70, B, A)).toEqual({ mine: 30, partner: 70 });
  });
});

describe('payerSharePctFromViewer', () => {
  it('quando eu pago, minha parte vai direto para payerSharePct', () => {
    expect(payerSharePctFromViewer(60, A, A)).toBe(60);
  });

  it('quando o outro paga, minha parte é invertida', () => {
    // Eu fico com 60% de um gasto que o outro pagou: o pagador fica com 40%.
    expect(payerSharePctFromViewer(60, B, A)).toBe(40);
  });

  it('ida e volta preserva a divisão, para os dois pagadores', () => {
    for (const payer of [A, B]) {
      for (const mine of [0, 25, 50, 65, 100]) {
        const stored = payerSharePctFromViewer(mine, payer, A);
        expect(splitForViewer(stored, payer, A).mine).toBe(mine);
      }
    }
  });

  it('a dívida calculada bate com a divisão vista na tela', () => {
    // A lança 100,00 pago por B e diz "eu fico com 60%": A deve 60,00 a B.
    const payerSharePct = payerSharePctFromViewer(60, B, A);
    const debt = expenseDebt(
      { totalCents: 10000, personalCents: 0, payerUid: B, payerSharePct, status: 'pending_approval' },
      [A, B],
    );
    expect(debt).toEqual({ fromUid: A, toUid: B, amountCents: 6000 });
  });

  it('rejeita percentual inválido', () => {
    expect(() => payerSharePctFromViewer(101, A, A)).toThrow(RangeError);
    expect(() => splitForViewer(12.5, A, A)).toThrow(RangeError);
  });
});

describe('stepSplit', () => {
  it('anda de 5 em 5 e para nos limites', () => {
    expect(stepSplit(50, 1)).toBe(55);
    expect(stepSplit(50, -1)).toBe(45);
    expect(stepSplit(100, 1)).toBe(100);
    expect(stepSplit(0, -1)).toBe(0);
    expect(stepSplit(98, 1)).toBe(100);
  });
});
