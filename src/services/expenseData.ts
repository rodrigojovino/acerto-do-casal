import type { IsoDate } from '@/domain/calendar';
import { receiptPhotoPath } from '@/domain/image';
import type { Cents, Competence } from '@/domain/settlement';

/**
 * Montagem dos documentos de gasto exatamente como são gravados.
 * Sem dependência do SDK: o horário do servidor e o marcador de exclusão de
 * campo entram por parâmetro, o que permite aos testes de regras usar estas
 * mesmas funções.
 *
 * Quem lança nunca grava `confirmed`: todo gasto nasce e volta a
 * `pending_approval` ao ser editado. Só a aprovação do outro membro ou a
 * conferência do QR pela Function confirmam.
 */

/** O que o formulário informa. Competência, status e autoria são calculados à parte. */
export interface ExpenseInput {
  description: string;
  totalCents: Cents;
  personalCents: Cents;
  payerUid: string;
  payerSharePct: number;
  date: IsoDate;
  receipt: ReceiptChoice;
}

/** Comprovante escolhido no formulário. */
export type ReceiptChoice =
  | { type: 'none' }
  /** `replaced`: foto nova escolhida agora (precisa ser enviada de novo). */
  | { type: 'photo'; replaced: boolean };

/** Comprovante como fica gravado no gasto. */
export type StoredReceipt =
  | { type: 'none' }
  | { type: 'photo'; photoPath: string; photoUploaded: boolean };

export interface ExpenseIds {
  groupId: string;
  expenseId: string;
}

export function receiptData(choice: ReceiptChoice, ids: ExpenseIds, current?: StoredReceipt): StoredReceipt {
  if (choice.type === 'photo') {
    const keepUpload = !choice.replaced && current?.type === 'photo' && current.photoUploaded;
    return {
      type: 'photo',
      photoPath: receiptPhotoPath(ids.groupId, ids.expenseId),
      photoUploaded: keepUpload,
    };
  }
  return { type: 'none' };
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

/** Gasto novo: sempre pendente de aprovação. */
export function newExpenseData<T>(input: ExpenseInput, uid: string, competence: Competence, ids: ExpenseIds, now: T) {
  return {
    ...fields(input, competence),
    receipt: receiptData(input.receipt, ids),
    status: 'pending_approval' as const,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Edição de quem lançou: volta a pendente (inclusive devolvido corrigido e
 * confirmado editado) e descarta aprovação ou recusa anteriores.
 */
export function expenseUpdateData<T, D>(
  input: ExpenseInput,
  competence: Competence,
  ids: ExpenseIds,
  current: StoredReceipt,
  now: T,
  removeField: D,
) {
  return {
    ...fields(input, competence),
    receipt: receiptData(input.receipt, ids, current),
    status: 'pending_approval' as const,
    approval: removeField,
    rejection: removeField,
    updatedAt: now,
  };
}
