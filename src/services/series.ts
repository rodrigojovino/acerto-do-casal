import type { InstallmentInfo } from '@/domain/installments';
import type { Competence, ExpenseStatus } from '@/domain/settlement';
import { isAutoConfirmed } from './expenseView';

/**
 * Ações sobre uma compra parcelada valem para a série inteira, só nas parcelas
 * de meses abertos (as de mês fechado são imutáveis):
 * - aprovar ou recusar: as pendentes;
 * - validar ou contestar: as confirmadas automaticamente;
 * - editar ou excluir (quem lançou): todas.
 */
export type SeriesAction = 'approve' | 'reject' | 'validate' | 'contest' | 'edit' | 'delete';

export interface SeriesParcel {
  id: string;
  competence: Competence;
  status: ExpenseStatus;
  approval?: { byUid: string };
  createdBy: string;
  installment?: InstallmentInfo;
}

export function seriesTargets<P extends SeriesParcel>(
  parcels: readonly P[],
  action: SeriesAction,
  viewerUid: string,
  closedMonths: ReadonlySet<Competence>,
): P[] {
  return parcels
    .filter((p) => !closedMonths.has(p.competence))
    .filter((p) => {
      const mine = p.createdBy === viewerUid;
      switch (action) {
        case 'approve':
        case 'reject':
          return !mine && p.status === 'pending_approval';
        case 'validate':
        case 'contest':
          return !mine && isAutoConfirmed(p);
        default:
          return mine;
      }
    })
    .sort((a, b) => (a.installment?.index ?? 0) - (b.installment?.index ?? 0));
}

/**
 * Pendências: uma linha por série (a parcela de menor índice), com quantas
 * parcelas da série estão na mesma situação.
 */
export function collapseSeries<E extends { id: string; installment?: InstallmentInfo }>(
  items: readonly E[],
): Array<E & { seriesSize: number }> {
  const out: Array<E & { seriesSize: number }> = [];
  const bySeries = new Map<string, E & { seriesSize: number }>();
  for (const item of items) {
    const seriesId = item.installment?.seriesId;
    if (!seriesId) {
      out.push({ ...item, seriesSize: 1 });
      continue;
    }
    const seen = bySeries.get(seriesId);
    if (!seen) {
      const row = { ...item, seriesSize: 1 };
      bySeries.set(seriesId, row);
      out.push(row);
    } else {
      seen.seriesSize += 1;
      if ((item.installment?.index ?? 0) < (seen.installment?.index ?? 0)) {
        const row = { ...item, seriesSize: seen.seriesSize };
        bySeries.set(seriesId, row);
        out[out.indexOf(seen)] = row;
      }
    }
  }
  return out;
}
