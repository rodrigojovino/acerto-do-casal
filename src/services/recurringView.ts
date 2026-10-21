import type { Forecast, Recurring, RecurringTerms } from '@/domain/recurrence';
import { formatDateBR, monthName } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import type { Badge } from './expenseView';

/**
 * Painel do toque numa previsão (ainda não é gasto): "Internet · previsto para
 * 10/11/2026. Este gasto será gerado em 1º de novembro de 2026." No variável,
 * diz quem informa o valor e onde.
 */
export function forecastNotice(
  f: Pick<Forecast, 'description' | 'kind' | 'date' | 'payerUid'>,
  viewerUid: string,
  nameOf: (uid: string) => string,
): string {
  const [year, month] = f.date.split('-');
  const text = `${f.description} · previsto para ${formatDateBR(f.date)}. Este gasto será gerado em 1º de ${monthName(`${year}-${month}`)} de ${year}.`;
  if (f.kind !== 'variable') return text;
  const who = f.payerUid === viewerUid ? 'Você' : nameOf(f.payerUid);
  return `${text} ${who} poderá informar o valor quando ele aparecer em Pendências.`;
}

/** Selo do cadastro de conta recorrente, do ponto de vista de quem olha. */
export function recurringBadge(
  rec: Pick<Recurring, 'active' | 'status' | 'proposal'> & { createdBy: string },
  viewerUid: string,
): Badge {
  if (!rec.active) return { kind: 'awaiting', label: 'Desativada' };
  if (rec.status === 'pending_approval') {
    return { kind: 'pending', label: rec.createdBy === viewerUid ? 'Pendente' : 'Aprovar' };
  }
  if (rec.status === 'approved' && rec.proposal) {
    return { kind: 'pending', label: rec.createdBy === viewerUid ? 'Reajuste pendente' : 'Aprovar reajuste' };
  }
  if (rec.status === 'returned') return { kind: 'returned', label: 'Recusada' };
  return { kind: 'validated', label: 'Ativa' };
}

/** Resumo dos campos de dinheiro: "Fixo · R$ 120,00" ou "Variável". */
export function termsAmountLabel(terms: Pick<RecurringTerms, 'kind' | 'amountCents'>): string {
  return terms.kind === 'fixed' ? `Fixo · ${formatBRL(terms.amountCents ?? 0)}` : 'Variável';
}
