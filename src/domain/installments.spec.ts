import { describe, expect, it } from 'vitest';
import { clampMonth } from './calendar';
import {
  firstMonthRange,
  installmentExpenseId,
  installmentPreview,
  installmentSummary,
  lastInstallmentMonth,
  navigationLastMonth,
  planInstallments,
} from './installments';

describe('planInstallments', () => {
  it('10x de R$ 1.000,05: resto na primeira, uma por mês, no dia da compra', () => {
    const p = planInstallments({ totalCents: 100005, personalCents: 0, count: 10, firstMonth: '2026-10', purchaseDate: '2026-10-18' });
    expect(p).toHaveLength(10);
    expect(p[0]).toMatchObject({ index: 1, count: 10, totalCents: 10005, competence: '2026-10', date: '2026-10-18' });
    expect(p[9]).toMatchObject({ index: 10, totalCents: 10000, competence: '2027-07', date: '2027-07-18' });
    expect(p.reduce((s, x) => s + x.totalCents, 0)).toBe(100005);
  });

  it('parte pessoal proporcional, somando exatamente o informado', () => {
    const p = planInstallments({ totalCents: 30000, personalCents: 10000, count: 3, firstMonth: '2026-10', purchaseDate: '2026-10-05' });
    expect(p.map((x) => x.personalCents)).toEqual([3333, 3333, 3334]);
    expect(p.every((x) => x.personalCents <= x.totalCents)).toBe(true);
  });

  it('dia 31 vira o último dia nos meses curtos; primeira parcela no mês seguinte à compra', () => {
    const p = planInstallments({ totalCents: 9000, personalCents: 0, count: 3, firstMonth: '2026-11', purchaseDate: '2026-10-31' });
    expect(p.map((x) => x.date)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
  });

  it('aceita de 2 a 48 parcelas', () => {
    const base = { totalCents: 4800, personalCents: 0, firstMonth: '2026-10', purchaseDate: '2026-10-01' };
    expect(planInstallments({ ...base, count: 48 })).toHaveLength(48);
    expect(() => planInstallments({ ...base, count: 1 })).toThrow(RangeError);
    expect(() => planInstallments({ ...base, count: 49 })).toThrow(RangeError);
    expect(() => planInstallments({ ...base, count: 2.5 })).toThrow(RangeError);
  });
});

describe('ids, prévia e meses', () => {
  it('parcela 1 tem o id da série; as outras, série-índice', () => {
    expect(installmentExpenseId('abc', 1)).toBe('abc');
    expect(installmentExpenseId('abc', 7)).toBe('abc-7');
  });

  it('prévia: primeira com o resto, demais iguais', () => {
    expect(installmentPreview(100005, 10)).toEqual({ firstCents: 10005, otherCents: 10000 });
    expect(installmentPreview(9000, 3)).toEqual({ firstCents: 3000, otherCents: 3000 });
  });

  it('resumo da série: valores e meses', () => {
    const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
    expect(installmentSummary({ count: 10, firstMonth: '2026-10', purchaseCents: 214000 }, brl)).toEqual({
      values: '10x de R$ 214.00',
      firstMonth: '2026-10',
      lastMonth: '2027-07',
    });
    expect(installmentSummary({ count: 10, firstMonth: '2026-10', purchaseCents: 100005 }, brl).values).toBe(
      '1ª de R$ 100.05 + 9x de R$ 100.00',
    );
  });

  it('mês da última parcela', () => {
    expect(lastInstallmentMonth({ count: 12, firstMonth: '2026-10' })).toBe('2027-09');
  });

  it('primeiro mês: do mês da compra (no máximo 6 meses atrás) até o mês seguinte ao atual', () => {
    expect(firstMonthRange('2026-08-20', '2026-10-18')).toEqual({ min: '2026-08', max: '2026-11' });
    expect(firstMonthRange('2025-12-20', '2026-10-18')).toEqual({ min: '2026-04', max: '2026-11' });
  });
});

describe('limite de navegação', () => {
  it('sem parcelas futuras: até o mês seguinte ao atual', () => {
    expect(navigationLastMonth('2026-10-18', null)).toBe('2026-11');
    expect(navigationLastMonth('2026-10-18', '2026-09')).toBe('2026-11');
  });

  it('parcelas estendem até o mês da última parcela existente', () => {
    const last = navigationLastMonth('2026-10-18', '2027-09');
    expect(last).toBe('2027-09');
    expect(clampMonth('2027-12', '2026-01', '2026-10-18', last)).toBe('2027-09');
    expect(clampMonth('2027-03', '2026-01', '2026-10-18', last)).toBe('2027-03');
    expect(clampMonth('2027-03', '2026-01', '2026-10-18')).toBe('2026-11');
  });
});
