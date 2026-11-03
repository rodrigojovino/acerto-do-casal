import { describe, expect, it } from 'vitest';
import { RETRY_COOLDOWN_MS, retryWindow } from './nfceRetry';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 2, 15, 0, 0);

describe('intervalo do "Tentar conferir de novo"', () => {
  it('nunca tentou: liberado, e a próxima fica para daqui a 15 minutos', () => {
    expect(retryWindow(null, T0)).toEqual({ allowed: true, retryAt: T0 + RETRY_COOLDOWN_MS });
  });

  it('dentro dos 15 minutos: bloqueado até completar o intervalo', () => {
    expect(retryWindow(T0, T0 + 1)).toEqual({ allowed: false, retryAt: T0 + 15 * MIN });
    expect(retryWindow(T0, T0 + 14 * MIN + 59_999)).toEqual({ allowed: false, retryAt: T0 + 15 * MIN });
  });

  it('completou os 15 minutos: liberado de novo', () => {
    expect(retryWindow(T0, T0 + 15 * MIN).allowed).toBe(true);
    expect(retryWindow(T0, T0 + 60 * MIN)).toEqual({ allowed: true, retryAt: T0 + 75 * MIN });
  });

  it('toque rápido repetido (mesmo instante) não passa', () => {
    expect(retryWindow(T0, T0).allowed).toBe(false);
  });

  it('última tentativa "no futuro" (relógio adiantado) conta como agora', () => {
    expect(retryWindow(T0 + 60 * MIN, T0)).toEqual({ allowed: false, retryAt: T0 + 15 * MIN });
  });
});
