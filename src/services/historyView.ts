import type { Payment } from '@/domain/closing';
import { formatBRL } from '@/domain/money';
import type { Transfer } from '@/domain/settlement';

/** Situação de um mês na lista do Histórico. */
export type HistoryState = 'closed' | 'open' | 'reopened' | 'current';

export interface HistoryRow {
  state: HistoryState;
  /** "Fechado", "Aberto", "Reaberto", "Em andamento". */
  stateLabel: string;
  /** Resultado do acerto (só mês fechado): "Você pagou R$ 100,00 a Bia". */
  result: string | null;
  /** Forma do pagamento (só mês fechado com acerto): "PIX", "dinheiro", "PIX e dinheiro". */
  method: string | null;
  /** Há pedido de reabertura aguardando resposta. */
  reopenPending: boolean;
}

/**
 * Linha do Histórico, do ponto de vista de quem olha. Mês sem documento é
 * aberto; reaberto é o aberto que já foi fechado (tem pagamentos ou foi
 * reaberto). O resultado vem da memória de cálculo guardada no fechamento.
 */
export function historyRow(
  doc: {
    status: 'open' | 'closed';
    summary?: { result: Transfer | null };
    payments: ReadonlyArray<Pick<Payment, 'method'>>;
    reopenRequest?: { status: string };
  } | null,
  month: string,
  currentMonth: string,
  viewerUid: string,
  nameOf: (uid: string) => string,
): HistoryRow {
  const reopenPending = doc?.reopenRequest?.status === 'pending';
  if (doc?.status !== 'closed') {
    const reopened = !!doc && (doc.payments.length > 0 || doc.reopenRequest?.status === 'approved');
    const state: HistoryState = reopened ? 'reopened' : month === currentMonth ? 'current' : 'open';
    const stateLabel = { reopened: 'Reaberto', current: 'Em andamento', open: 'Aberto', closed: '' }[state];
    return { state, stateLabel, result: null, method: null, reopenPending };
  }

  const r = doc.summary?.result ?? null;
  let result = 'Ninguém devia nada';
  if (r) {
    const from = r.fromUid === viewerUid ? 'Você' : nameOf(r.fromUid);
    const to = r.toUid === viewerUid ? 'você' : nameOf(r.toUid);
    result = `${from} pagou ${formatBRL(r.amountCents)} a ${to}`;
  }
  const methods = new Set(doc.payments.map((p) => p.method));
  const method =
    methods.size === 0 ? null : methods.size === 2 ? 'PIX e dinheiro' : methods.has('pix') ? 'PIX' : 'dinheiro';
  return { state: 'closed', stateLabel: 'Fechado', result, method, reopenPending };
}
