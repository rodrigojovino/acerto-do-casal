import type { RecurringKind, RecurringStatus, RecurringTerms } from '@/domain/recurrence';
import type { Cents, Competence } from '@/domain/settlement';

/**
 * Montagem dos documentos de conta recorrente exatamente como são gravados.
 * Sem dependência do SDK (horário do servidor e exclusão de campo por
 * parâmetro), para os testes de regras usarem as mesmas funções.
 *
 * Fixo novo vai para aprovação do outro membro. Num cadastro já aprovado, os
 * campos de dinheiro são sempre a versão aprovada (a que a geração usa): mudar
 * valor, quem paga, divisão ou tipo, quando envolve fixo, vira um reajuste em
 * `proposal` até o outro aprovar. Variável sem mudança de tipo muda direto.
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

export interface RecurringCurrent extends RecurringTerms {
  status: RecurringStatus;
  proposal?: RecurringTerms;
}

/** Mesmo valor, quem paga, divisão e tipo. */
export function sameTerms(a: RecurringTerms, b: RecurringTerms): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === 'variable' || a.amountCents === b.amountCents) &&
    a.payerUid === b.payerUid &&
    a.payerSharePct === b.payerSharePct
  );
}

/** Mudou algo que altera quanto cada um paga, em relação à versão aprovada. */
export function recurringMaterialChanged(input: RecurringTerms, current: RecurringTerms): boolean {
  return !sameTerms(input, current);
}

/**
 * A edição de um cadastro aprovado vira reajuste (precisa da aprovação do
 * outro): mudou o dinheiro e há fixo de um dos lados. Variável → variável
 * muda direto.
 */
export function needsAdjustmentApproval(input: RecurringTerms, current: RecurringCurrent): boolean {
  return (
    current.status === 'approved' &&
    recurringMaterialChanged(input, current) &&
    (input.kind === 'fixed' || current.kind === 'fixed')
  );
}

/** Status que quem cadastrou grava (as regras exigem exatamente este). */
export function recurringAuthorStatus(input: RecurringInput, current?: RecurringCurrent): RecurringStatus {
  if (current?.status === 'approved') return 'approved';
  return input.kind === 'variable' ? 'approved' : 'pending_approval';
}

function termFields<D>(terms: RecurringTerms, removeField?: D) {
  return {
    kind: terms.kind,
    ...(terms.kind === 'fixed' ? { amountCents: terms.amountCents } : removeField === undefined ? {} : { amountCents: removeField }),
    payerUid: terms.payerUid,
    payerSharePct: terms.payerSharePct,
  };
}

function baseFields<D>(input: RecurringInput, removeField?: D) {
  return {
    description: input.description.trim(),
    dayOfMonth: input.dayOfMonth,
    startMonth: input.startMonth,
    ...(input.endMonth ? { endMonth: input.endMonth } : removeField === undefined ? {} : { endMonth: removeField }),
  };
}

/** Reajuste gravado em `proposal` (só os campos de dinheiro, com o horário). */
function proposalData<T>(terms: RecurringTerms, now: T) {
  return { ...termFields(terms), at: now };
}

export function newRecurringData<T>(input: RecurringInput, uid: string, now: T) {
  return {
    ...baseFields(input),
    ...termFields(input),
    active: true,
    status: recurringAuthorStatus(input),
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Edição de quem cadastrou (inclui reativar). Ainda não aprovado (pendente ou
 * recusado): reescreve tudo e vai para aprovação (fixo). Já aprovado: mantém a
 * aprovação e a versão aprovada; mudança de dinheiro com fixo vira reajuste
 * (ou é cancelado, se voltar à versão aprovada). A recusa anterior é descartada.
 */
export function recurringUpdateData<T, D>(
  input: RecurringInput,
  current: RecurringCurrent,
  active: boolean,
  now: T,
  removeField: D,
) {
  if (current.status !== 'approved') {
    return {
      ...baseFields(input, removeField),
      ...termFields(input, removeField),
      active,
      status: recurringAuthorStatus(input, current),
      approval: removeField,
      rejection: removeField,
      proposal: removeField,
      updatedAt: now,
    };
  }
  const adjustment = needsAdjustmentApproval(input, current);
  return {
    ...baseFields(input, removeField),
    ...termFields(adjustment ? current : input, removeField),
    active,
    status: 'approved' as const,
    proposal: adjustment ? proposalData(input, now) : removeField,
    rejection: removeField,
    updatedAt: now,
  };
}

/**
 * O outro membro aprova: o cadastro novo vira aprovado; um reajuste passa a
 * ser a versão aprovada (vale a partir da próxima geração).
 */
export function recurringApprovalData<T, D>(current: Pick<RecurringCurrent, 'proposal'>, uid: string, now: T, removeField: D) {
  const approval = { byUid: uid, at: now };
  if (current.proposal) {
    return { ...termFields(current.proposal, removeField), proposal: removeField, approval, rejection: removeField, updatedAt: now };
  }
  return { status: 'approved' as const, approval, updatedAt: now };
}

/**
 * O outro membro recusa: o cadastro novo volta para quem cadastrou; um
 * reajuste é descartado e a versão aprovada continua valendo.
 */
export function recurringRejectionData<T, D>(
  current: Pick<RecurringCurrent, 'proposal'>,
  uid: string,
  reason: string | undefined,
  now: T,
  removeField: D,
) {
  const trimmed = reason?.trim().slice(0, 200);
  const rejection = { byUid: uid, at: now, kind: 'reject' as const, ...(trimmed ? { reason: trimmed } : {}) };
  if (current.proposal) return { proposal: removeField, rejection, updatedAt: now };
  return { status: 'returned' as const, rejection, updatedAt: now };
}

/** Qualquer um dos dois membros pode desativar. */
export function recurringDeactivateData<T>(now: T) {
  return { active: false, updatedAt: now };
}
