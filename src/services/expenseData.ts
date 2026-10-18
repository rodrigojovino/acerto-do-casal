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
  | { type: 'photo'; replaced: boolean }
  /** QR Code da NFC-e lido no aparelho: a conferência é feita pela Function. */
  | { type: 'nfce'; nfceKey: string; nfceUrl: string };

export interface NfceData {
  issuerName: string;
  totalCents: Cents;
  date: IsoDate;
}

/** Comprovante como fica gravado no gasto. */
export type StoredReceipt =
  | { type: 'none' }
  | { type: 'photo'; photoPath: string; photoUploaded: boolean }
  | {
      type: 'nfce';
      nfceKey: string;
      nfceUrl: string;
      /** Gravado como 'pending' pelo app; só a Function grava 'ok' ou 'failed'. */
      nfceStatus: 'pending' | 'ok' | 'failed';
      nfceData?: NfceData;
      nfceError?: string;
    };

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
  if (choice.type === 'nfce') {
    // Mesmo QR: mantém a conferência já feita. QR novo: a Function consulta de novo.
    if (current?.type === 'nfce' && current.nfceKey === choice.nfceKey) return { ...current };
    return { type: 'nfce', nfceKey: choice.nfceKey, nfceUrl: choice.nfceUrl, nfceStatus: 'pending' };
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

/** Limite do motivo de recusa (o mesmo das regras). */
export const MAX_REJECTION_REASON = 200;

/** Aprovação pelo outro membro: confirma o gasto. Só vale para gasto pendente. */
export function approvalData<T>(uid: string, now: T) {
  return {
    status: 'confirmed' as const,
    approval: { byUid: uid, at: now },
    updatedAt: now,
  };
}

/** Recusa pelo outro membro: devolve o gasto para correção, com motivo opcional. */
export function rejectionData<T>(uid: string, reason: string | undefined, now: T) {
  const trimmed = reason?.trim().slice(0, MAX_REJECTION_REASON);
  return {
    status: 'returned' as const,
    rejection: { byUid: uid, at: now, ...(trimmed ? { reason: trimmed } : {}) },
    updatedAt: now,
  };
}
