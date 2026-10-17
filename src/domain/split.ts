/**
 * Conversão entre a divisão gravada no banco e a divisão vista na tela.
 *
 * O banco guarda `payerSharePct`: a parte de QUEM PAGOU. A tela mostra a
 * divisão do ponto de vista de quem está olhando ("eu / outro"). Quando o
 * pagador é o outro membro, a conversão inverte. Prévia, Painel e Detalhe
 * usam só estas funções.
 */

/** Divisão do ponto de vista de quem olha. */
export interface ViewerSplit {
  /** Parte de quem está olhando, em %. */
  mine: number;
  /** Parte da outra pessoa, em %. */
  partner: number;
}

function assertPct(pct: number): void {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new RangeError(`percentual deve ser inteiro entre 0 e 100 (recebido: ${pct})`);
  }
}

/** Banco → tela: `payerSharePct` vira "minha parte / parte do outro". */
export function splitForViewer(payerSharePct: number, payerUid: string, viewerUid: string): ViewerSplit {
  assertPct(payerSharePct);
  const mine = payerUid === viewerUid ? payerSharePct : 100 - payerSharePct;
  return { mine, partner: 100 - mine };
}

/** Tela → banco: "minha parte" vira `payerSharePct` conforme quem pagou. */
export function payerSharePctFromViewer(minePct: number, payerUid: string, viewerUid: string): number {
  assertPct(minePct);
  return payerUid === viewerUid ? minePct : 100 - minePct;
}

/** Passo do seletor de divisão (−/+), limitado a 0..100. */
export const SPLIT_STEP = 5;

export function stepSplit(minePct: number, direction: 1 | -1): number {
  assertPct(minePct);
  return Math.min(100, Math.max(0, minePct + direction * SPLIT_STEP));
}
