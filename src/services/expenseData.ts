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
  /** Categoria (`groups/{g}/categories/{id}`); ausente = "Sem categoria". */
  categoryId?: string;
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
  | {
      type: 'nfce';
      nfceKey: string;
      entry: KeyEntry;
      /** Foto da nota anexada à chave (opcional); `replaced`: foto nova escolhida agora. */
      photo?: { replaced: boolean };
    };

/** Como a chave chegou: lida pelo leitor (QR Code ou código de barras) ou digitada. */
export type KeyEntry = 'qr' | 'barcode' | 'typed';

/** Gravado no gasto: os anteriores à v0.8.0 têm só "lida" (`read`), sem o formato. */
export type StoredKeyEntry = KeyEntry | 'read';

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
      entry?: StoredKeyEntry;
      /** URL de consulta da SEFAZ-SP montada da chave (`spConsultUrl`); só NFC-e de SP. */
      nfceUrl?: string;
      /**
       * O app grava 'pending' (SP, a conferir) ou 'unchecked' (outros estados,
       * sem conferência automática). Só a Function grava 'ok' ou 'failed'.
       */
      nfceStatus: 'pending' | 'ok' | 'failed' | 'unchecked';
      nfceData?: NfceData;
      nfceError?: string;
      /** Foto da nota anexada à chave (opcional), no mesmo caminho das fotos de recibo. */
      photoPath?: string;
      photoUploaded?: boolean;
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
    let base: StoredReceipt & { type: 'nfce' };
    if (current?.type === 'nfce' && current.nfceKey === choice.nfceKey) {
      // Mesma chave: mantém a conferência já feita (a foto é tratada abaixo).
      const { photoPath: _path, photoUploaded: _uploaded, ...rest } = current;
      void _path;
      void _uploaded;
      base = rest;
    } else {
      // Chave nova: a Function consulta de novo. QR e código de barras da mesma
      // nota dão o mesmo comprovante (URL montada da chave).
      const nfceUrl = spConsultUrl(choice.nfceKey);
      base = nfceUrl
        ? { type: 'nfce', nfceKey: choice.nfceKey, entry: choice.entry, nfceUrl, nfceStatus: 'pending' }
        : { type: 'nfce', nfceKey: choice.nfceKey, entry: choice.entry, nfceStatus: 'unchecked' };
    }
    if (!choice.photo) return base;
    const keepUpload = !choice.photo.replaced && current?.type === 'nfce' && current.photoUploaded === true;
    return { ...base, photoPath: receiptPhotoPath(ids.groupId, ids.expenseId), photoUploaded: keepUpload };
  }
  return { type: 'none' };
}

/** Observação gravada: sem espaços nas pontas e no limite; vazia sai do documento. */
function noteField<D>(note: string | undefined, removeField?: D) {
  const text = note?.trim().slice(0, MAX_NOTE);
  if (text) return { note: text };
  return removeField === undefined ? {} : { note: removeField };
}

/** Categoria gravada; sem categoria, o campo não existe (na edição, sai do documento). */
function categoryField<D>(categoryId: string | undefined, removeField?: D) {
  if (categoryId) return { categoryId };
  return removeField === undefined ? {} : { categoryId: removeField };
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
export function authorStatus(
  receipt: ReceiptChoice,
  currentStatus?: ExpenseStatus,
  payerSharePct = EVEN_SPLIT_PCT,
): 'pending_approval' | 'confirmed' {
  if (currentStatus === 'confirmed' || currentStatus === 'returned') return 'pending_approval';
  // Divisão diferente de 50/50 vai para aprovação, mesmo com comprovante.
  if (payerSharePct !== EVEN_SPLIT_PCT) return 'pending_approval';
  return receipt.type === 'none' ? 'pending_approval' : 'confirmed';
}

/** Única divisão que confirma automaticamente com comprovante: 50/50 (fixa, não a padrão do grupo). */
export const EVEN_SPLIT_PCT = 50;

/**
 * Marca permanente de "já confirmado uma vez" (as regras nunca deixam tirar):
 * gasto que já foi confirmado só sai pelo pedido de exclusão.
 */
function everConfirmedField(status: ExpenseStatus, already = false) {
  return already || status === 'confirmed' ? { everConfirmed: true as const } : {};
}

/** Gasto novo: pendente sem comprovante; confirmado com foto ou QR. */
export function newExpenseData<T>(input: ExpenseInput, uid: string, competence: Competence, ids: ExpenseIds, now: T) {
  const status = authorStatus(input.receipt, undefined, input.payerSharePct);
  return {
    ...fields(input, competence),
    ...noteField(input.note),
    ...categoryField(input.categoryId),
    receipt: receiptData(input.receipt, ids),
    status,
    ...everConfirmedField(status),
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Edição de quem lançou: confirmado ou devolvido vai para aprovação; pendente
 * continua pendente, ou é confirmado ao receber comprovante. Descarta aprovação
 * ou recusa anteriores. Apaga o pedido de exclusão, se houver (o gasto volta
 * para aprovação, mas, se já foi confirmado, continua exigindo pedido para sair).
 */
export function expenseUpdateData<T, D>(
  input: ExpenseInput,
  competence: Competence,
  ids: ExpenseIds,
  current: { receipt: StoredReceipt; status: ExpenseStatus; everConfirmed?: boolean },
  now: T,
  removeField: D,
) {
  const status = authorStatus(input.receipt, current.status, input.payerSharePct);
  return {
    ...fields(input, competence),
    ...noteField(input.note, removeField),
    ...categoryField(input.categoryId, removeField),
    receipt: receiptData(input.receipt, ids, current.receipt),
    status,
    ...everConfirmedField(status, current.everConfirmed),
    approval: removeField,
    rejection: removeField,
    deletionRequest: removeField,
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
    everConfirmed: true as const,
    approval: { byUid: uid, at: now },
    updatedAt: now,
  };
}

/** Aprovação pelo outro membro: confirma um gasto pendente. */
export function approvalData<T>(uid: string, now: T) {
  return {
    status: 'confirmed' as const,
    everConfirmed: true as const,
    approval: { byUid: uid, at: now },
    updatedAt: now,
  };
}

// ---- Pedido de exclusão (gasto já confirmado) ----

/** Limite do motivo do pedido de exclusão (o mesmo das regras). */
export const MAX_DELETION_REASON = 200;

/**
 * Pode sair direto por quem lançou: pendente ou "a confirmar" que nunca foi
 * confirmado, e devolvido. Os demais só saem pelo pedido de exclusão.
 */
export function directlyDeletable(e: { status: ExpenseStatus; everConfirmed?: boolean }): boolean {
  return e.status === 'returned' || (e.status !== 'confirmed' && !e.everConfirmed);
}

/** Quem lançou pede a exclusão (ou pede de novo depois de uma recusa), motivo opcional. */
export function deletionRequestData<T>(uid: string, reason: string | undefined, now: T) {
  const trimmed = reason?.trim().slice(0, MAX_DELETION_REASON);
  return {
    deletionRequest: { byUid: uid, at: now, status: 'pending' as const, ...(trimmed ? { reason: trimmed } : {}) },
    updatedAt: now,
  };
}

/** Quem pediu cancela o pedido. */
export function deletionCancelData<T, D>(now: T, removeField: D) {
  return { deletionRequest: removeField, updatedAt: now };
}

/** O outro membro recusa: o pedido fica registrado como recusado e o gasto continua. */
export function deletionDenialData<T>(uid: string, now: T) {
  return {
    'deletionRequest.status': 'denied' as const,
    'deletionRequest.answeredBy': uid,
    'deletionRequest.answeredAt': now,
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
  const status = authorStatus(input.receipt, undefined, input.payerSharePct);
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
      ...categoryField(input.categoryId),
      totalCents: p.totalCents,
      personalCents: p.personalCents,
      payerUid: input.payerUid,
      payerSharePct: input.payerSharePct,
      date: p.date,
      competence: p.competence,
      receipt,
      status,
      ...everConfirmedField(status),
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
  /** A categoria é da série: a mesma em todas as parcelas. */
  categoryId?: string;
}

/**
 * Edição de uma parcela da série (o app aplica em todas as de meses abertos):
 * mesma regra de status da edição de um gasto; descarta aprovação ou recusa.
 */
export function installmentUpdateData<T, D>(
  input: SeriesEditInput,
  current: { receipt: StoredReceipt; status: ExpenseStatus; everConfirmed?: boolean },
  ids: { groupId: string; seriesId: string },
  now: T,
  removeField: D,
) {
  const status = authorStatus(input.receipt, current.status, input.payerSharePct);
  return {
    description: input.description.trim(),
    ...noteField(input.note, removeField),
    ...categoryField(input.categoryId, removeField),
    payerUid: input.payerUid,
    payerSharePct: input.payerSharePct,
    receipt: receiptData(input.receipt, { groupId: ids.groupId, expenseId: ids.seriesId }, current.receipt),
    status,
    ...everConfirmedField(status, current.everConfirmed),
    approval: removeField,
    rejection: removeField,
    deletionRequest: removeField,
    updatedAt: now,
  };
}

// ---- Nota fiscal lançada uma vez só ----

/** Chave da nota no comprovante gravado (o que vai para `fiscalKeys`), ou null. */
export function fiscalKeyOf(receipt: StoredReceipt | undefined): string | null {
  return receipt?.type === 'nfce' ? receipt.nfceKey : null;
}

/**
 * Registro da chave (`groups/{g}/fiscalKeys/{chave}`), gravado no mesmo lote
 * que o gasto: aponta para o gasto que usa a nota (numa série, a parcela 1).
 */
export function fiscalKeyData<T>(expenseId: string, uid: string, now: T) {
  return { expenseId, createdBy: uid, createdAt: now };
}

/**
 * O que muda no registro quando o comprovante muda (criar: `before` ausente;
 * excluir: `after` ausente): a chave a soltar e a chave a registrar.
 */
export function fiscalKeyChange(
  before: StoredReceipt | undefined,
  after: StoredReceipt | undefined,
): { release: string | null; register: string | null } {
  const old = fiscalKeyOf(before);
  const next = fiscalKeyOf(after);
  return old === next ? { release: null, register: null } : { release: old, register: next };
}
