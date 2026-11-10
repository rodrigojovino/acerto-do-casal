/**
 * Resultado da consulta da NFC-e de SP guardado no servidor (`nfceCache/{chave}`),
 * para que cada nota seja consultada na SEFAZ uma vez só, mesmo com leituras
 * simultâneas (o mesmo QR lido de novo, o gatilho `checkNfce`, a nova
 * tentativa): quem chega primeiro toma o marcador "em consulta" numa
 * transação; os outros esperam o resultado dele em vez de consultar.
 * Lógica pura, com testes.
 */

/** Validade do resultado conferido (o QR lido online pode ser salvo offline dias depois). */
export const CACHE_DAYS = 30;
export const CACHE_TTL_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Marcador "em consulta" mais velho que isso foi abandonado (a Function caiu
 * ou passou do tempo): ninguém espera nele, e quem chega pode consultar.
 * Cobre a consulta da `resolveNfce` (até 30 s) com folga.
 */
export const RUNNING_STALE_MS = 40_000;

export interface CachedResult {
  issuerName: string;
  totalCents: number;
  date: string;
}

/** Documento como está no banco (epoch em ms nos horários). */
export interface CacheState {
  /** 'running': consulta em andamento; 'ok': conferida; 'failed': a última consulta falhou. Ausente nos registros da v0.9.0 (= 'ok'). */
  state?: 'running' | 'ok' | 'failed';
  startedAt?: number;
  result?: CachedResult | null;
  expireAt?: number;
}

/**
 * O que fazer com a nota agora:
 * - 'cached': resultado conferido e válido (usar, sem consultar);
 * - 'wait': outra consulta em andamento há menos de 40 s (esperar o resultado dela);
 * - 'consult': sem registro, falha anterior, vencido ou marcador abandonado (pode consultar).
 */
export function cacheDecision(doc: CacheState | null, now: number): 'cached' | 'wait' | 'consult' {
  if (!doc) return 'consult';
  const state = doc.state ?? (doc.result ? 'ok' : undefined);
  if (state === 'ok' && doc.result && (doc.expireAt === undefined || doc.expireAt >= now)) return 'cached';
  if (state === 'running' && doc.startedAt !== undefined && now - doc.startedAt < RUNNING_STALE_MS) return 'wait';
  return 'consult';
}

/** Até quando vale esperar o marcador (epoch em ms): quando ele fica abandonado. */
export function waitDeadline(doc: CacheState, now: number): number {
  return doc.startedAt !== undefined ? doc.startedAt + RUNNING_STALE_MS : now;
}
