import { describe, expect, it } from 'vitest';
import {
  canGenerate,
  coversMonth,
  dueDate,
  recurringExpenseData,
  recurringExpenseId,
  shouldGenerate,
  forecastRecurring,
  forecastTotal,
  type Recurring,
} from './recurrence';

const A = 'uid-a';

function rec(overrides: Partial<Recurring> = {}): Recurring {
  return {
    id: 'r1',
    description: 'Internet',
    kind: 'fixed',
    amountCents: 12000,
    dayOfMonth: 10,
    payerUid: A,
    payerSharePct: 50,
    startMonth: '2026-01',
    active: true,
    status: 'approved',
    ...overrides,
  };
}

describe('dueDate', () => {
  it('usa o dia configurado', () => {
    expect(dueDate('2026-10', 10)).toBe('2026-10-10');
  });

  it('dia 29 a 31 vira o último dia em meses curtos', () => {
    expect(dueDate('2026-02', 31)).toBe('2026-02-28');
    expect(dueDate('2028-02', 30)).toBe('2028-02-29');
    expect(dueDate('2026-04', 31)).toBe('2026-04-30');
    expect(dueDate('2026-01', 31)).toBe('2026-01-31');
  });

  it('rejeita dia fora de 1 a 31', () => {
    expect(() => dueDate('2026-10', 0)).toThrow(RangeError);
    expect(() => dueDate('2026-10', 32)).toThrow(RangeError);
  });
});

describe('coversMonth e canGenerate', () => {
  it('respeita mês inicial e mês final', () => {
    expect(coversMonth(rec({ startMonth: '2026-10' }), '2026-09')).toBe(false);
    expect(coversMonth(rec({ startMonth: '2026-10' }), '2026-10')).toBe(true);
    expect(coversMonth(rec({ endMonth: '2026-12' }), '2026-12')).toBe(true);
    expect(coversMonth(rec({ endMonth: '2026-12' }), '2027-01')).toBe(false);
    expect(coversMonth(rec({ endMonth: undefined }), '2040-01')).toBe(true);
  });

  it('fixo só gera aprovado; variável gera sem aprovação; desativado não gera', () => {
    expect(canGenerate(rec({ status: 'pending_approval' }))).toBe(false);
    expect(canGenerate(rec({ status: 'returned' }))).toBe(false);
    expect(canGenerate(rec({ kind: 'variable', status: 'approved' }))).toBe(true);
    expect(canGenerate(rec({ active: false }))).toBe(false);
  });
});

describe('shouldGenerate', () => {
  it('gera desde o dia 1 do mês (a data do gasto é o vencimento) e recupera dias perdidos', () => {
    expect(shouldGenerate(rec({ dayOfMonth: 25 }), '2026-10-01')).toBe(true);
    expect(shouldGenerate(rec({ dayOfMonth: 25 }), '2026-10-18')).toBe(true);
  });

  it('nunca gera duas vezes o mesmo mês (nem recria um excluído)', () => {
    expect(shouldGenerate(rec({ lastGeneratedMonth: '2026-10' }), '2026-10-15')).toBe(false);
    expect(shouldGenerate(rec({ lastGeneratedMonth: '2026-09' }), '2026-10-15')).toBe(true);
  });

  it('dia 31 em fevereiro: gera no dia 1 com a data no último dia do mês', () => {
    expect(shouldGenerate(rec({ dayOfMonth: 31 }), '2026-02-01')).toBe(true);
    expect(recurringExpenseData(rec({ dayOfMonth: 31 }), '2026-02-01', new Set(), 'agora').date).toBe('2026-02-28');
  });

  it('respeita mês final, mês inicial, aprovação e ativo', () => {
    expect(shouldGenerate(rec({ endMonth: '2026-09' }), '2026-10-15')).toBe(false);
    expect(shouldGenerate(rec({ startMonth: '2026-11' }), '2026-10-15')).toBe(false);
    expect(shouldGenerate(rec({ status: 'pending_approval' }), '2026-10-15')).toBe(false);
    expect(shouldGenerate(rec({ active: false }), '2026-10-15')).toBe(false);
  });
});

describe('recurringExpenseData', () => {
  it('fixo nasce confirmado, sem aprovação, com quem paga como autor', () => {
    const d = recurringExpenseData(rec(), '2026-10-12', new Set(), 'agora');
    expect(d).toMatchObject({
      description: 'Internet',
      totalCents: 12000,
      date: '2026-10-10',
      competence: '2026-10',
      status: 'confirmed',
      createdBy: A,
      recurringId: 'r1',
      receipt: { type: 'none' },
    });
    expect(d).not.toHaveProperty('approval');
  });

  it('herda a categoria do cadastro; sem ela, o campo não existe', () => {
    expect(recurringExpenseData(rec({ categoryId: 'cat1' }), '2026-10-12', new Set(), 'agora').categoryId).toBe('cat1');
    expect(recurringExpenseData(rec(), '2026-10-12', new Set(), 'agora')).not.toHaveProperty('categoryId');
  });

  it('variável nasce aguardando confirmação do valor', () => {
    const d = recurringExpenseData(rec({ kind: 'variable', amountCents: undefined }), '2026-10-12', new Set(), 'agora');
    expect(d.status).toBe('awaiting_confirmation');
    expect(d.totalCents).toBe(0);
  });

  it('mês fechado: a competência vai para o próximo aberto, mantendo a data', () => {
    const d = recurringExpenseData(rec(), '2026-10-12', new Set(['2026-10']), 'agora');
    expect(d.date).toBe('2026-10-10');
    expect(d.competence).toBe('2026-11');
  });

  it('id fixo por mês', () => {
    expect(recurringExpenseId('r1', '2026-10')).toBe('rec-r1-2026-10');
  });
});

describe('forecastRecurring', () => {
  const today = '2026-10-18';
  const recs = [
    rec({ id: 'internet', dayOfMonth: 10, lastGeneratedMonth: '2026-10' }), // já gerado em outubro
    rec({ id: 'aluguel', description: 'Aluguel', amountCents: 150000, dayOfMonth: 25 }), // vence dia 25: previsto em outubro
    rec({ id: 'luz', kind: 'variable', amountCents: undefined, dayOfMonth: 31 }),
    rec({ id: 'pendente', status: 'pending_approval' }),
    rec({ id: 'off', active: false }),
    rec({ id: 'acaba', endMonth: '2026-10' }),
    rec({ id: 'comeca', startMonth: '2026-11' }),
  ];

  it('mês atual não tem previsão: todos já são gerados no dia 1', () => {
    expect(forecastRecurring(recs, '2026-10', today, new Set())).toEqual([]);
  });

  it('variável aparece com valor a definir', () => {
    const f = forecastRecurring(recs, '2026-11', today, new Set());
    expect(f.find((x) => x.recurringId === 'luz')).toMatchObject({ amountCents: null, date: '2026-11-30' });
  });

  it('mês seguinte: respeita mês inicial e final; já gerado não volta', () => {
    const f = forecastRecurring(recs, '2026-11', today, new Set());
    expect(f.map((x) => x.recurringId)).toEqual(['internet', 'comeca', 'aluguel', 'luz']); // por data
  });

  it('dia 31 vira o último dia em meses curtos', () => {
    const f = forecastRecurring([rec({ id: 'x', dayOfMonth: 31 })], '2027-02', '2027-01-20', new Set());
    expect(f[0].date).toBe('2027-02-28');
  });

  it('inativo e fixo não aprovado não aparecem', () => {
    const f = forecastRecurring(
      [rec({ id: 'off', active: false }), rec({ id: 'p', status: 'pending_approval' }), rec({ id: 'r', status: 'returned' })],
      '2026-11',
      today,
      new Set(),
    );
    expect(f).toEqual([]);
  });

  it('já gerado no mês (gasto existente ou lastGeneratedMonth) não duplica a previsão', () => {
    expect(forecastRecurring([rec({ id: 'aluguel', dayOfMonth: 25 })], '2026-11', today, new Set(['aluguel']))).toEqual([]);
    expect(forecastRecurring([rec({ id: 'aluguel', lastGeneratedMonth: '2026-11' })], '2026-11', today, new Set())).toEqual([]);
  });

  it('mês passado não tem previsão', () => {
    expect(forecastRecurring(recs, '2026-09', today, new Set())).toEqual([]);
  });

  it('reajuste pendente: mostra a versão aprovada com a indicação', () => {
    const r = rec({ id: 'net', proposal: { kind: 'fixed', amountCents: 15000, payerUid: A, payerSharePct: 50 } });
    expect(forecastRecurring([r], '2026-11', today, new Set())[0]).toMatchObject({ amountCents: 12000, adjustmentPending: true });
    expect(forecastRecurring([rec({ id: 'x' })], '2026-11', today, new Set())[0].adjustmentPending).toBe(false);
  });

  it('total previsto soma só os fixos', () => {
    const f = forecastRecurring(recs, '2026-11', today, new Set());
    expect(forecastTotal(f)).toBe(12000 + 150000 + 12000);
  });
});
