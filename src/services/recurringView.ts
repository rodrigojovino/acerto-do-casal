import type { Recurring, RecurringTerms } from '@/domain/recurrence';
import { formatBRL } from '@/domain/money';
import type { Badge } from './expenseView';

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
