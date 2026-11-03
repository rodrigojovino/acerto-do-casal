/**
 * Leitura da NFC-e de SP ao ler o QR (v0.9.0). Um filtro de segurança da
 * SEFAZ barra a maioria das consultas automáticas, então cada nota tem no
 * máximo duas tentativas no formulário, cada uma uma vez só:
 * 1. pelo servidor (`resolveNfce`): conferida pela SEFAZ;
 * 2. se falhar, no aparelho (WebView visível, só Android): "lida no aparelho";
 * 3. se falhar também: plano B (valor digitado, emitente pelo CNPJ).
 * As duas dividem o mesmo limite de 10 s do Salvar. Nada se repete sozinho.
 */

import { NFCE_WAIT_MS } from './saveButton.js';

/** Limite das duas tentativas juntas: o mesmo do botão Salvar. */
export const NFCE_BUDGET_MS = NFCE_WAIT_MS;
/** Menos que isso não dá para abrir o WebView e carregar a página: vai direto ao plano B. */
export const DEVICE_MIN_MS = 1_500;

export type AttemptResult = 'ok' | 'failed' | 'skipped';

export interface NfceOutcome {
  server: AttemptResult;
  device: AttemptResult;
}

/** Tempo que sobra do limite (nunca negativo). */
export function remainingMs(deadline: number, now: number): number {
  return Math.max(0, deadline - now);
}

/** Tenta no aparelho: o servidor falhou, há WebView (Android) e sobra tempo para carregar a página. */
export function shouldTryDevice(serverResult: AttemptResult, hasWebView: boolean, remaining: number): boolean {
  return serverResult === 'failed' && hasWebView && remaining >= DEVICE_MIN_MS;
}

/**
 * Estado gravado na NFC-e de SP, que diz ao gatilho do servidor (`checkNfce`)
 * se ainda pode consultar (no máximo duas consultas por nota):
 * - servidor deu certo: 'pending' (o gatilho usa o resultado guardado, sem rede);
 * - servidor falhou e o aparelho tentou (deu certo ou não): 'unchecked' (duas feitas);
 * - servidor falhou sem tentativa no aparelho (versão web): 'pending' (o gatilho faz a segunda);
 * - nenhuma tentativa (offline): 'pending' (o gatilho faz uma).
 */
export function spReceiptStatus(outcome: NfceOutcome): 'pending' | 'unchecked' {
  if (outcome.server === 'ok') return 'pending';
  if (outcome.server === 'failed' && outcome.device !== 'skipped') return 'unchecked';
  return 'pending';
}
