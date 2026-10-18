import type { RecurringKind, RecurringStatus } from '@/domain/recurrence';
import type { Cents, Competence } from '@/domain/settlement';

/**
 * Montagem dos documentos de conta recorrente exatamente como são gravados.
 * Sem dependência do SDK (horário do servidor e exclusão de campo por
 * parâmetro), para os testes de regras usarem as mesmas funções.
 *
 * Fixo vai para aprovação do outro membro; mudar valor, quem paga, divisão ou
 * tipo exige nova aprovação. Variável não precisa de aprovação.
 */

export interface RecurringInput {
  description: string;
  kind: RecurringKind;
  /** Só no fixo. */
  amountCents?: Cents;
  dayOfMonth: number;
  payerUid: string;
  payerSharePct: number;
  startMonth: Competence;
  /** Sem mês final = sem prazo. */
  endMonth?: Competence;
}

export interface RecurringCurrent {
  kind: RecurringKind;
  amountCents?: Cents;
  payerUid: string;
  payerSharePct: number;
  status: RecurringStatus;
}

/** Mudou algo que altera quanto cada um paga (exige nova aprovação no fixo). */
export function recurringMaterialChanged(input: RecurringInput, current: RecurringCurrent): boolean {
  return (
    input.kind !== current.kind ||
    (input.kind === 'fixed' && input.amountCents !== current.amountCents) ||
    input.payerUid !== current.payerUid ||
    input.payerSharePct !== current.payerSharePct
  );
}

/** Status que quem cadastrou grava (as regras exigem exatamente este). */
export function recurringAuthorStatus(input: RecurringInput, current?: RecurringCurrent): RecurringStatus {
  if (input.kind === 'variable') return 'approved';
  if (!current || current.status === 'returned' || recurringMaterialChanged(input, current)) return 'pending_approval';
  return current.status;
}

function fields<D>(input: RecurringInput, removeField?: D) {
  return {
    description: input.description.trim(),
    kind: input.kind,
    ...(input.kind === 'fixed' ? { amountCents: input.amountCents } : removeField === undefined ? {} : { amountCents: removeField }),
    dayOfMonth: input.dayOfMonth,
    payerUid: input.payerUid,
    payerSharePct: input.payerSharePct,
    startMonth: input.startMonth,
    ...(input.endMonth ? { endMonth: input.endMonth } : removeField === undefined ? {} : { endMonth: removeField }),
  };
}

export function newRecurringData<T>(input: RecurringInput, uid: string, now: T) {
  return {
    ...fields(input),
    active: true,
    status: recurringAuthorStatus(input),
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Edição de quem cadastrou (inclui reativar). A aprovação só é mantida num fixo
 * que continua aprovado; a recusa anterior é descartada.
 */
export function recurringUpdateData<T, D>(
  input: RecurringInput,
  current: RecurringCurrent,
  active: boolean,
  now: T,
  removeField: D,
) {
  const status = recurringAuthorStatus(input, current);
  const keepApproval = input.kind === 'fixed' && status === 'approved';
  return {
    ...fields(input, removeField),
    active,
    status,
    ...(keepApproval ? {} : { approval: removeField }),
    rejection: removeField,
    updatedAt: now,
  };
}

export function recurringApprovalData<T>(uid: string, now: T) {
  return { status: 'approved' as const, approval: { byUid: uid, at: now }, updatedAt: now };
}

export function recurringRejectionData<T>(uid: string, reason: string | undefined, now: T) {
  const trimmed = reason?.trim().slice(0, 200);
  return {
    status: 'returned' as const,
    rejection: { byUid: uid, at: now, kind: 'reject' as const, ...(trimmed ? { reason: trimmed } : {}) },
    updatedAt: now,
  };
}

/** Qualquer um dos dois membros pode desativar. */
export function recurringDeactivateData<T>(now: T) {
  return { active: false, updatedAt: now };
}
