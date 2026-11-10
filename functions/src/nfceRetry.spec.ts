import { describe, expect, it } from 'vitest';
import { RETRY_COOLDOWN_MS, retryWindow } from './nfceRetry';

const SEC = 1000;
const T0 = Date.UTC(2026, 10, 2, 15, 0, 0);

describe('intervalo do "Tentar conferir de novo" (1 minuto, v0.9.1)', () => {
  it('o intervalo é de 1 minuto', () => {
    expect(RETRY_COOLDOWN_MS).toBe(60 * SEC);
  });

  it('nunca tentou: liberado, e a próxima fica para daqui a 1 minuto', () => {
    expect(retryWindow(null, T0)).toEqual({ allowed: true, retryAt: T0 + 60 * SEC });
  });

  it('dentro do minuto: bloqueado até completar o intervalo', () => {
    expect(retryWindow(T0, T0 + 1)).toEqual({ allowed: false, retryAt: T0 + 60 * SEC });
    expect(retryWindow(T0, T0 + 59_999)).toEqual({ allowed: false, retryAt: T0 + 60 * SEC });
  });

  it('completou o minuto: liberado de novo', () => {
    expect(retryWindow(T0, T0 + 60 * SEC).allowed).toBe(true);
    expect(retryWindow(T0, T0 + 600 * SEC)).toEqual({ allowed: true, retryAt: T0 + 660 * SEC });
  });

  it('toque rápido repetido (mesmo instante) não passa', () => {
    expect(retryWindow(T0, T0).allowed).toBe(false);
  });

  it('última tentativa "no futuro" (relógio adiantado) conta como agora', () => {
    expect(retryWindow(T0 + 600 * SEC, T0)).toEqual({ allowed: false, retryAt: T0 + 60 * SEC });
  });
});
