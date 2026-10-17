import type { IsoDate } from '@/domain/calendar';
import type { Cents, Competence, ExpenseStatus } from '@/domain/settlement';

/**
 * Montagem dos documentos de gasto exatamente como são gravados.
 * Sem dependência do SDK: o horário do servidor entra por parâmetro, o que
 * permite aos testes de regras usar estas mesmas funções.
 */

/** O que o formulário informa. Competência, status e autoria são calculados à parte. */
export interface ExpenseInput {
  description: string;
  totalCents: Cents;
  personalCents: Cents;
  payerUid: string;
  payerSharePct: number;
  date: IsoDate;
}

function fields(input: ExpenseInput, competence: Competence) {
  return {
    description: input.description.trim(),
    totalCents: input.totalCents,
    personalCents: input.personalCents,
    payerUid: input.payerUid,
    payerSharePct: input.payerSharePct,
    date: input.date,
    competence,
  };
}

/** Gasto novo: sem comprovante nesta fase, nasce pendente de aprovação. */
export function newExpenseData<T>(input: ExpenseInput, uid: string, competence: Competence, now: T) {
  return {
    ...fields(input, competence),
    receipt: { type: 'none' as const },
    status: 'pending_approval' as ExpenseStatus,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

/** Edição de quem lançou: devolvido volta a pendente ao ser corrigido. */
export function expenseUpdateData<T>(
  input: ExpenseInput,
  currentStatus: ExpenseStatus,
  competence: Competence,
  now: T,
) {
  return {
    ...fields(input, competence),
    status: (currentStatus === 'returned' ? 'pending_approval' : currentStatus) as ExpenseStatus,
    updatedAt: now,
  };
}
