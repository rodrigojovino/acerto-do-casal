import { describe, expect, it } from 'vitest';
import { forecastNotice } from './recurringView';

const A = 'uid-a';
const B = 'uid-b';
const nameOf = (uid: string) => (uid === B ? 'Bia' : 'Você');

describe('forecastNotice (toque numa previsão)', () => {
  it('fixo: quando vence e quando será gerado', () => {
    expect(forecastNotice({ description: 'Internet', kind: 'fixed', date: '2026-11-10', payerUid: A }, A, nameOf)).toBe(
      'Internet · previsto para 10/11/2026. Este gasto será gerado em 1º de novembro de 2026.',
    );
  });

  it('variável: quem paga informa o valor em Pendências (você ou o outro, pelo nome)', () => {
    const luz = { description: 'Luz', kind: 'variable' as const, date: '2027-01-31', payerUid: A };
    expect(forecastNotice(luz, A, nameOf)).toBe(
      'Luz · previsto para 31/01/2027. Este gasto será gerado em 1º de janeiro de 2027. Você poderá informar o valor quando ele aparecer em Pendências.',
    );
    expect(forecastNotice({ ...luz, payerUid: B }, A, nameOf)).toMatch(/Bia poderá informar o valor quando ele aparecer em Pendências\.$/);
  });
});
