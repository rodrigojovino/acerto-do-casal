import type { IsoDate } from '@/domain/calendar';
import { receiptPhotoPath } from '@/domain/image';
import { installmentExpenseId, planInstallments } from '@/domain/installments';
import { MAX_NOTE } from '@/domain/notifications';
import { spConsultUrl } from '../../functions/src/nfce';
import type { Cents, Competence, ExpenseStatus } from '@/domain/settlement';

/**
 * Montagem dos documentos de gasto exatamente como são gravados.
 * Sem dependência do SDK: o horário do servidor e o marcador de exclusão de
 * campo entram por parâmetro, o que permite aos testes de regras usar estas
 * mesmas funções.
 *
 * Só a criação com comprovante confirma automaticamente (o outro membro pode
 * contestar até o fechamento do mês). Editar um confirmado (automático ou
 * aprovado) ou um devolvido volta para aprovação explícita; editar um pendente
 * o mantém pendente, exceto ao anexar comprovante, que o confirma. Quem lança
 * nunca grava aprovação nem recusa.
 */

/** O que o formulário informa. Competência, status e autoria são calculados à parte. */
export interface ExpenseInput {
  description: string;
  /** Observação opcional (até MAX_NOTE caracteres); vazia = sem observação. */
  note?: string;
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
  /**
   * Chave de NF-e (modelo 55) ou NFC-e (65), de qualquer estado: lida (QR ou
   * código de barras) ou digitada. NFC-e de SP é conferida na SEFAZ pela
   * Function; as demais valem como comprovante sem conferência.
   */
  | { type: 'nfce'; nfceKey: string; entry: KeyEntry };

/** Como a chave chegou: lida pelo leitor (QR ou código de barras) ou digitada. */
export type KeyEntry = 'read' | 'typed';

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
      /** NF-e ou NFC-e (o modelo está na chave, posições 21–22). */
      type: 'nfce';
      nfceKey: string;
      /** Ausente em gastos anteriores ao bloco D: chave lida pelo QR. */
      entry?: KeyEntry;
      /** URL de consulta da SEFAZ-SP montada da chave (`spConsultUrl`); só NFC-e de SP. */
      nfceUrl?: string;
      /**
       * O app grava 'pending' (SP, a conferir) ou 'unchecked' (outros estados,
       * sem conferência automática). Só a Function grava 'ok' ou 'failed'.
       */
      nfceStatus: 'pending' | 'ok' | 'failed' | 'unchecked';
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
    // Mesma chave: mantém a conferência já feita. Chave nova: a Function consulta de novo.
    if (current?.type === 'nfce' && current.nfceKey === choice.nfceKey) return { ...current };
    // QR e código de barras da mesma nota dão o mesmo comprovante (URL montada da chave).
    const nfceUrl = spConsultUrl(choice.nfceKey);
    return nfceUrl
      ? { type: 'nfce', nfceKey: choice.nfceKey, entry: choice.entry, nfceUrl, nfceStatus: 'pending' }
      : { type: 'nfce', nfceKey: choice.nfceKey, entry: choice.entry, nfceStatus: 'unchecked' };
  }
  return { type: 'none' };
}

/** Observação gravada: sem espaços nas pontas e no limite; vazia sai do documento. */
function noteField<D>(note: string | undefined, removeField?: D) {
  const text = note?.trim().slice(0, MAX_NOTE);
  if (text) return { note: text };
  return removeField === undefined ? {} : { note: removeField };
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

/**
 * Status que quem lança grava (as regras exigem exatamente este).
 * `currentStatus` ausente = criação.
 */
export function authorStatus(receipt: ReceiptChoice, currentStatus?: ExpenseStatus): 'pending_approval' | 'confirmed' {
  if (currentStatus === 'confirmed' || currentStatus === 'returned') return 'pending_approval';
  return receipt.type === 'none' ? 'pending_approval' : 'confirmed';
}

/** Gasto novo: pendente sem comprovante; confirmado com foto ou QR. */
export function newExpenseData<T>(input: ExpenseInput, uid: string, competence: Competence, ids: ExpenseIds, now: T) {
  return {
    ...fields(input, competence),
    ...noteField(input.note),
    receipt: receiptData(input.receipt, ids),
    status: authorStatus(input.receipt),
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Edição de quem lançou: confirmado ou devolvido vai para aprovação; pendente
 * continua pendente, ou é confirmado ao receber comprovante. Descarta aprovação
 * ou recusa anteriores.
 */
export function expenseUpdateData<T, D>(
  input: ExpenseInput,
  competence: Competence,
  ids: ExpenseIds,
  current: { receipt: StoredReceipt; status: ExpenseStatus },
  now: T,
  removeField: D,
) {
  return {
    ...fields(input, competence),
    ...noteField(input.note, removeField),
    receipt: receiptData(input.receipt, ids, current.receipt),
    status: authorStatus(input.receipt, current.status),
    approval: removeField,
    rejection: removeField,
    updatedAt: now,
  };
}

/** Limite do motivo de recusa ou contestação (o mesmo das regras). */
export const MAX_REJECTION_REASON = 200;

/**
 * Validação pelo outro membro de um confirmado automaticamente: grava a própria
 * aprovação sem mudar o status. Daí em diante conta como aprovado manualmente
 * (não é mais contestável; editado, volta para aprovação).
 */
export function validationData<T>(uid: string, now: T) {
  return {
    status: 'confirmed' as const,
    approval: { byUid: uid, at: now },
    updatedAt: now,
  };
}

/** Aprovação pelo outro membro: confirma um gasto pendente. */
export function approvalData<T>(uid: string, now: T) {
  return {
    status: 'confirmed' as const,
    approval: { byUid: uid, at: now },
    updatedAt: now,
  };
}

/** Recusa de um pendente pelo outro membro: devolve para correção, motivo opcional. */
export function rejectionData<T>(uid: string, reason: string | undefined, now: T) {
  const trimmed = reason?.trim().slice(0, MAX_REJECTION_REASON);
  return {
    status: 'returned' as const,
    rejection: { byUid: uid, at: now, kind: 'reject' as const, ...(trimmed ? { reason: trimmed } : {}) },
    updatedAt: now,
  };
}

/**
 * Contestação pelo outro membro de um gasto confirmado automaticamente (por
 * comprovante ou recorrente fixo): devolve para correção. Motivo obrigatório.
 * `removeField` tira a marca de conferência do QR (approval 'nfce'), se houver.
 */
export function contestData<T, D>(uid: string, reason: string, now: T, removeField: D) {
  const trimmed = reason.trim().slice(0, MAX_REJECTION_REASON);
  if (!trimmed) throw new RangeError('a contestação precisa de um motivo');
  return {
    status: 'returned' as const,
    rejection: { byUid: uid, at: now, kind: 'contest' as const, reason: trimmed },
    approval: removeField,
    updatedAt: now,
  };
}

// ---- Compra parcelada ----

/** Parcelamento escolhido no formulário. */
export interface InstallmentChoice {
  count: number;
  /** Mês da primeira parcela. */
  firstMonth: Competence;
}

/**
 * Série nova: um documento por parcela (id da parcela 1 = id da série), com o
 * mesmo comprovante da compra (a foto fica no caminho da série) e o mesmo
 * status pela regra do comprovante. `input.totalCents` e `personalCents` são os
 * da compra inteira.
 */
export function newInstallmentSeriesData<T>(
  input: ExpenseInput,
  choice: InstallmentChoice,
  uid: string,
  ids: { groupId: string; seriesId: string },
  now: T,
) {
  const receipt = receiptData(input.receipt, { groupId: ids.groupId, expenseId: ids.seriesId });
  const status = authorStatus(input.receipt);
  return planInstallments({
    totalCents: input.totalCents,
    personalCents: input.personalCents,
    count: choice.count,
    firstMonth: choice.firstMonth,
    purchaseDate: input.date,
  }).map((p) => ({
    id: installmentExpenseId(ids.seriesId, p.index),
    data: {
      description: input.description.trim(),
      ...noteField(input.note),
      totalCents: p.totalCents,
      personalCents: p.personalCents,
      payerUid: input.payerUid,
      payerSharePct: input.payerSharePct,
      date: p.date,
      competence: p.competence,
      receipt,
      status,
      installment: {
        seriesId: ids.seriesId,
        index: p.index,
        count: p.count,
        firstMonth: choice.firstMonth,
        purchaseCents: input.totalCents,
      },
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    },
  }));
}

/** O que muda na edição de uma série (valor, parcelas e primeiro mês: exclui e lança de novo). */
export interface SeriesEditInput {
  description: string;
  note?: string;
  payerUid: string;
  payerSharePct: number;
  receipt: ReceiptChoice;
}

/**
 * Edição de uma parcela da série (o app aplica em todas as de meses abertos):
 * mesma regra de status da edição de um gasto; descarta aprovação ou recusa.
 */
export function installmentUpdateData<T, D>(
  input: SeriesEditInput,
  current: { receipt: StoredReceipt; status: ExpenseStatus },
  ids: { groupId: string; seriesId: string },
  now: T,
  removeField: D,
) {
  return {
    description: input.description.trim(),
    ...noteField(input.note, removeField),
    payerUid: input.payerUid,
    payerSharePct: input.payerSharePct,
    receipt: receiptData(input.receipt, { groupId: ids.groupId, expenseId: ids.seriesId }, current.receipt),
    status: authorStatus(input.receipt, current.status),
    approval: removeField,
    rejection: removeField,
    updatedAt: now,
  };
}
