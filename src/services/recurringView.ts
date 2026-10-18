import type { Recurring } from '@/domain/recurrence';
import type { Badge } from './expenseView';

/** Selo do cadastro de conta recorrente, do ponto de vista de quem olha. */
export function recurringBadge(rec: Pick<Recurring, 'active' | 'status'> & { createdBy: string }, viewerUid: string): Badge {
  if (!rec.active) return { kind: 'awaiting', label: 'Desativada' };
  if (rec.status === 'pending_approval') {
    return { kind: 'pending', label: rec.createdBy === viewerUid ? 'Pendente' : 'Aprovar' };
  }
  if (rec.status === 'returned') return { kind: 'returned', label: 'Recusada' };
  return { kind: 'validated', label: 'Ativa' };
}
