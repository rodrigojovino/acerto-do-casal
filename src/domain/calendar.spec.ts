import { describe, expect, it } from 'vitest';
import {
  clampMonth,
  formatDateBR,
  isIsoDate,
  lastAllowedDate,
  lastAllowedMonth,
  monthLabel,
  monthsDesc,
  resolveCompetence,
  todayInSaoPaulo,
} from './calendar';

describe('todayInSaoPaulo', () => {
  it('usa o fuso de São Paulo, não UTC', () => {
    // 01/11 às 02:00 UTC ainda é 31/10 às 23:00 em São Paulo.
    expect(todayInSaoPaulo(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-31');
    expect(todayInSaoPaulo(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11-01');
  });
});

describe('isIsoDate', () => {
  it('aceita datas reais e recusa inexistentes', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-04-31')).toBe(false);
    expect(isIsoDate('05/10/2026')).toBe(false);
  });
});

describe('limites de data', () => {
  it('vai até o fim do mês seguinte ao atual', () => {
    expect(lastAllowedMonth('2026-10-17')).toBe('2026-11');
    expect(lastAllowedDate('2026-10-17')).toBe('2026-11-30');
    expect(lastAllowedDate('2026-12-05')).toBe('2027-01-31');
    expect(lastAllowedDate('2027-01-10')).toBe('2027-02-28');
  });

  it('a navegação fica entre o mês de criação e o mês seguinte', () => {
    expect(clampMonth('2026-08', '2026-10', '2026-10-17')).toBe('2026-10');
    expect(clampMonth('2027-01', '2026-10', '2026-10-17')).toBe('2026-11');
    expect(clampMonth('2026-11', '2026-10', '2026-10-17')).toBe('2026-11');
  });
});

describe('resolveCompetence', () => {
  const today = '2026-10-17';

  it('mês aberto: a competência é o mês da data', () => {
    expect(resolveCompetence('2026-09-20', new Set(), today)).toBe('2026-09');
    expect(resolveCompetence('2026-11-05', new Set(), today)).toBe('2026-11');
  });

  it('mês da data fechado: entra no mês aberto atual, mantendo a data', () => {
    expect(resolveCompetence('2026-08-10', new Set(['2026-08', '2026-09']), today)).toBe('2026-10');
  });

  it('se o mês atual também estiver fechado, vai para o próximo aberto', () => {
    expect(resolveCompetence('2026-09-10', new Set(['2026-09', '2026-10']), today)).toBe('2026-11');
  });

  it('nunca devolve um mês anterior ao da data', () => {
    // Data no mês atual fechado: o próximo aberto, nunca um mês passado.
    expect(resolveCompetence('2026-10-02', new Set(['2026-10']), today)).toBe('2026-11');
  });

  it('rejeita data inválida', () => {
    expect(() => resolveCompetence('2026-02-30', new Set(), today)).toThrow(RangeError);
  });
});

describe('formatação', () => {
  it('formata mês e data em pt-BR', () => {
    expect(monthLabel('2026-03')).toBe('Março 2026');
    expect(formatDateBR('2026-10-05')).toBe('05/10/2026');
    expect(formatDateBR('2026-10-05', false)).toBe('05/10');
  });
});

describe('monthsDesc', () => {
  it('do mais recente ao mais antigo, atravessando o ano', () => {
    expect(monthsDesc('2026-11', '2027-02')).toEqual(['2027-02', '2027-01', '2026-12', '2026-11']);
    expect(monthsDesc('2026-10', '2026-10')).toEqual(['2026-10']);
    expect(monthsDesc('2026-11', '2026-10')).toEqual([]);
  });
});
