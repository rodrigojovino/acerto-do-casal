import { describe, expect, it } from 'vitest';
import { resolveCompetence } from './calendar';
import { launchState } from './launches';

describe('launchState', () => {
  it('no servidor: confirmado (o registro local pode sair)', () => {
    expect(launchState({ onServer: true, pendingInCache: false })).toBe('confirmed');
    expect(launchState({ onServer: true, pendingInCache: true })).toBe('confirmed');
  });

  it('sem conexão ou ainda pendente no cache: esperando', () => {
    expect(launchState({ onServer: null, pendingInCache: false })).toBe('waiting');
    expect(launchState({ onServer: false, pendingInCache: true })).toBe('waiting');
  });

  it('servidor sem o gasto e cache sem a gravação: recusado pelas regras', () => {
    expect(launchState({ onServer: false, pendingInCache: false })).toBe('rejected');
  });
});

describe('relançar no mês aberto', () => {
  it('a data fica; a competência vai para o mês aberto (o da data fechou)', () => {
    const closed = new Set(['2026-10']);
    expect(resolveCompetence('2026-10-18', new Set(), '2026-11-02')).toBe('2026-10');
    expect(resolveCompetence('2026-10-18', closed, '2026-11-02')).toBe('2026-11');
  });
});
