/**
 * "Tentar conferir de novo" (NFC-e de SP ainda não conferida): no máximo uma
 * tentativa por nota a cada minuto, contada no servidor (vale para
 * qualquer aparelho e para toques rápidos). Lógica pura, com testes.
 */

export const RETRY_COOLDOWN_MS = 60 * 1000;

export interface RetryWindow {
  /** Pode tentar agora. */
  allowed: boolean;
  /** Quando a próxima tentativa fica liberada (epoch em ms). */
  retryAt: number;
}

/**
 * `lastAt`: a última tentativa dessa nota (epoch em ms), ou null se nunca
 * houve. Liberada se não houve ou se já passou 1 minuto; o relógio do
 * servidor manda (uma última tentativa "no futuro" conta como agora).
 */
export function retryWindow(lastAt: number | null, now: number, cooldownMs = RETRY_COOLDOWN_MS): RetryWindow {
  if (lastAt === null) return { allowed: true, retryAt: now + cooldownMs };
  const next = Math.min(lastAt, now) + cooldownMs;
  return now >= next ? { allowed: true, retryAt: now + cooldownMs } : { allowed: false, retryAt: next };
}
