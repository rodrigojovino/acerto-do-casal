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
