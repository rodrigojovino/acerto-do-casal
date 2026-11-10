import { describe, expect, it } from 'vitest';
import { RUNNING_STALE_MS, cacheDecision, waitDeadline } from './nfceCache';

const NOW = 1_800_000_000_000;
const result = { issuerName: 'LOJA', totalCents: 100, date: '2026-11-08' };

describe('cacheDecision', () => {
  it('sem registro: pode consultar', () => {
    expect(cacheDecision(null, NOW)).toBe('consult');
  });

  it('conferida e válida: usa o resultado, sem consultar', () => {
    expect(cacheDecision({ state: 'ok', result, expireAt: NOW + 1 }, NOW)).toBe('cached');
  });

  it('registro da v0.9.0 (sem estado, com resultado) conta como conferida', () => {
    expect(cacheDecision({ result, expireAt: NOW + 1 }, NOW)).toBe('cached');
  });

  it('conferida mas vencida: pode consultar', () => {
    expect(cacheDecision({ state: 'ok', result, expireAt: NOW - 1 }, NOW)).toBe('consult');
  });

  it('falha anterior: pode consultar (cada leitura é uma tentativa)', () => {
    expect(cacheDecision({ state: 'failed', expireAt: NOW + 1 }, NOW)).toBe('consult');
  });

  it('em consulta há menos de 40 s: espera o resultado', () => {
    expect(cacheDecision({ state: 'running', startedAt: NOW - RUNNING_STALE_MS + 1 }, NOW)).toBe('wait');
  });

  it('marcador com 40 s ou mais: abandonado, ninguém espera nele', () => {
    expect(cacheDecision({ state: 'running', startedAt: NOW - RUNNING_STALE_MS }, NOW)).toBe('consult');
    expect(cacheDecision({ state: 'running' }, NOW)).toBe('consult');
  });

  it('espera no máximo até o marcador ficar abandonado', () => {
    expect(waitDeadline({ state: 'running', startedAt: NOW - 10_000 }, NOW)).toBe(NOW - 10_000 + RUNNING_STALE_MS);
  });
});
