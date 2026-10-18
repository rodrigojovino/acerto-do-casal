import { formatDateBR, monthOf } from '@/domain/calendar';
import { formatBRL } from '@/domain/money';
import { expenseDebt, type Cents, type Members, type SettlementExpense } from '@/domain/settlement';
import { splitForViewer } from '@/domain/split';
import type { Expense } from './expenses';

/**
 * Textos de exibição de um gasto, do ponto de vista de quem olha.
 * A divisão vem sempre de `splitForViewer` (src/domain/split.ts).
 */

export type ExpenseTag = 'pending' | 'approve' | 'returned' | null;

/** Avisos extras do gasto, além da etiqueta de status. */
export type ExpenseFlag = 'nfce-diff' | 'nfce-failed' | 'nfce-checking' | 'photo-missing';

export const flagLabel: Record<ExpenseFlag, string> = {
  'nfce-diff': 'Valor diferente da nota',
  'nfce-failed': 'Nota não conferida',
  'nfce-checking': 'Conferindo nota',
  'photo-missing': 'Foto não enviada',
};

/** Avisos sobre o comprovante (nota divergente, falha na conferência, foto pendente). */
export function flagsFor(expense: Pick<Expense, 'receipt' | 'totalCents' | 'status'>): ExpenseFlag[] {
  const r = expense.receipt;
  if (r.type === 'nfce') {
    if (r.nfceStatus === 'ok' && r.nfceData && r.nfceData.totalCents !== expense.totalCents) return ['nfce-diff'];
    if (r.nfceStatus === 'failed') return ['nfce-failed'];
    if (r.nfceStatus === 'pending') return ['nfce-checking'];
  }
  if (r.type === 'photo' && !r.photoUploaded) return ['photo-missing'];
  return [];
}

/** Marca da conferência do QR da versão anterior (approval.byUid 'nfce'). */
export const NFCE_APPROVER = 'nfce';

/**
 * Confirmado sem aprovação de pessoa: pelo comprovante, recorrente fixo ou a
 * conferência do QR da versão anterior. É o único confirmado contestável.
 */
export function isAutoConfirmed(expense: Pick<Expense, 'status' | 'approval'>): boolean {
  return expense.status === 'confirmed' && (!expense.approval || expense.approval.byUid === NFCE_APPROVER);
}

/** O outro membro pode contestar (as regras também exigem mês aberto). */
export function canContest(expense: Pick<Expense, 'status' | 'approval' | 'createdBy'>, viewerUid: string): boolean {
  return expense.createdBy !== viewerUid && isAutoConfirmed(expense);
}

/** Etiqueta da lista: "Pendente" (meu), "Aprovar" (do outro), "Devolvido". */
export function tagFor(expense: Pick<Expense, 'status' | 'createdBy'>, viewerUid: string): ExpenseTag {
  if (expense.status === 'pending_approval') return expense.createdBy === viewerUid ? 'pending' : 'approve';
  if (expense.status === 'returned') return 'returned';
  return null;
}

export const tagLabel: Record<Exclude<ExpenseTag, null>, string> = {
  pending: 'Pendente',
  approve: 'Aprovar',
  returned: 'Devolvido',
};

/** Divisão "minha / do outro", ex.: "50/50" ou "30/70". */
export function splitLabel(expense: Pick<Expense, 'payerSharePct' | 'payerUid'>, viewerUid: string): string {
  const { mine, partner } = splitForViewer(expense.payerSharePct, expense.payerUid, viewerUid);
  return `${mine}/${partner}`;
}

/** Linha de apoio da lista: "Você · 05/10 · R$ 50,00 pessoal · 50/50". */
export function expenseSubtitle(expense: Expense, viewerUid: string, payerName: string): string {
  const parts = [payerName, formatDateBR(expense.date, monthOf(expense.date) !== expense.competence)];
  if (expense.personalCents > 0) parts.push(`${formatBRL(expense.personalCents)} pessoal`);
  parts.push(splitLabel(expense, viewerUid));
  return parts.join(' · ');
}

export interface DebtView {
  /** "Bia te deve por este gasto", "Você deve por este gasto" ou "Ninguém deve nada por este gasto". */
  label: string;
  amountCents: Cents;
}

/**
 * Quem deve quanto por um gasto, do ponto de vista de quem olha. Usado pela
 * prévia do formulário e pelo Detalhe, sempre via `expenseDebt`.
 */
export function debtView(
  expense: Omit<SettlementExpense, 'status'>,
  members: Members,
  viewerUid: string,
  nameOf: (uid: string) => string,
): DebtView {
  const debt = expenseDebt({ ...expense, status: 'pending_approval' }, members);
  if (debt.amountCents === 0) return { label: 'Ninguém deve nada por este gasto', amountCents: 0 };
  return debt.fromUid === viewerUid
    ? { label: 'Você deve por este gasto', amountCents: debt.amountCents }
    : { label: `${nameOf(debt.fromUid)} te deve por este gasto`, amountCents: debt.amountCents };
}
