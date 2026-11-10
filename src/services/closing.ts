import { FirebaseError } from 'firebase/app';
import { Timestamp, collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { CANCEL_REFUSAL_TEXT, paymentCancelRefusal, type CancelRefusal, type MonthBreakdown, type Payment } from '@/domain/closing';
import type { Transfer } from '@/domain/settlement';
import { formatBRL } from '@/domain/money';
import type { Competence } from '@/domain/settlement';
import { db, functions, storage } from './firebase';

/**
 * Fechamento, pagamento do acerto e reabertura. Tudo pelas Functions (o app só
 * lê `months`), e só com conexão.
 */

export interface MonthPayment extends Omit<Payment, 'at'> {
  at: Date | null;
}

export interface ReopenRequest {
  byUid: string;
  reason: string;
  at: Date | null;
  status: 'pending' | 'approved' | 'denied';
  answeredBy?: string;
  answeredAt?: Date | null;
}

export interface MonthDoc {
  month: Competence;
  status: 'open' | 'closed';
  payments: MonthPayment[];
  summary?: MonthBreakdown;
  closedAt: Date | null;
  closedBy?: string;
  /** Última reabertura: pagamentos de antes dela pertencem ao fechamento desfeito. */
  reopenedAt: Date | null;
  reopenRequest?: ReopenRequest;
}

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);

function toMonth(id: string, data: Record<string, unknown> | undefined): MonthDoc {
  const d = data ?? {};
  const request = d.reopenRequest as (Omit<ReopenRequest, 'at' | 'answeredAt'> & { at?: unknown; answeredAt?: unknown }) | undefined;
  return {
    month: id,
    status: d.status === 'closed' ? 'closed' : 'open',
    payments: ((d.payments as Array<Payment> | undefined) ?? []).map((p) => ({ ...p, at: toDate(p.at) })),
    summary: d.summary as MonthBreakdown | undefined,
    closedAt: toDate(d.closedAt),
    closedBy: d.closedBy as string | undefined,
    reopenedAt: toDate(d.reopenedAt),
    reopenRequest: request ? { ...request, at: toDate(request.at), answeredAt: toDate(request.answeredAt) } : undefined,
  };
}

/** Um mês em tempo real (sem documento = aberto, sem pagamentos). */
export function watchMonth(
  groupId: string,
  month: Competence,
  onChange: (doc: MonthDoc) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'groups', groupId, 'months', month), (snap) => onChange(toMonth(month, snap.data())), onError);
}

/** Todos os meses com documento (fechados, reabertos ou com pagamento), em tempo real. */
export function watchMonths(
  groupId: string,
  onChange: (docs: MonthDoc[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'groups', groupId, 'months'),
    (snap) => onChange(snap.docs.map((d) => toMonth(d.id, d.data()))),
    onError,
  );
}

/** Mensagem pronta para a tela a partir do erro da Function. */
export function closingErrorMessage(err: unknown): string {
  if (!navigator.onLine) return 'Sem conexão: fechar, pagar e reabrir exigem internet.';
  if (err instanceof FirebaseError && err.code.startsWith('functions/') && err.code !== 'functions/internal') {
    return err.message;
  }
  return 'Não foi possível concluir agora. Tente de novo.';
}

async function call<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const fn = httpsCallable<Record<string, unknown>, T>(functions, name, { timeout: 30_000 });
  return (await fn(data)).data;
}

/** Id do pagamento (também o nome da foto do PIX). */
export function newPaymentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export const settlementPhotoPath = (groupId: string, month: Competence, paymentId: string) =>
  `groups/${groupId}/settlements/${month}/${paymentId}.jpg`;

/** Envia a foto do comprovante PIX (só depois da confirmação na tela). */
export async function uploadPixPhoto(groupId: string, month: Competence, paymentId: string, photo: Blob): Promise<void> {
  await uploadBytes(storageRef(storage, settlementPhotoPath(groupId, month, paymentId)), photo, { contentType: 'image/jpeg' });
}

/** O valor que falta mudou entre a confirmação e o registro: o novo valor, para confirmar de novo. */
export class AmountChangedError extends Error {
  constructor(readonly remaining: Transfer) {
    super(`O valor que falta mudou para ${formatBRL(remaining.amountCents)}. Confira e registre de novo.`);
  }
}

/**
 * Registra o pagamento do que falta (quem paga), com o valor que a tela mostrou
 * (`expectedCents`): se mudou, a Function recusa e devolve o novo valor
 * (`AmountChangedError`). PIX: a foto já precisa estar no Storage
 * (`uploadPixPhoto`, com o mesmo `paymentId`).
 */
export async function registerPayment(
  groupId: string,
  month: Competence,
  method: 'pix' | 'cash',
  options: { paymentId?: string; expectedCents?: number } = {},
): Promise<void> {
  const paymentId = options.paymentId ?? newPaymentId();
  try {
    await call('registerPayment', {
      groupId,
      month,
      method,
      paymentId,
      ...(options.expectedCents !== undefined ? { expectedCents: options.expectedCents } : {}),
    });
  } catch (err) {
    const details = (err as FirebaseError & { details?: { reason?: string; remaining?: Transfer } }).details;
    if (details?.reason === 'amount_changed' && details.remaining) throw new AmountChangedError(details.remaining);
    throw err;
  }
}

/** Recusa do cancelamento com o motivo claro (mês fechado, fechamento anterior…). */
export class CancelRefusedError extends Error {
  constructor(readonly refusal: CancelRefusal) {
    super(CANCEL_REFUSAL_TEXT[refusal]);
  }
}

/** O pagamento pode ser cancelado por quem vê (a mesma regra da Function). */
export function canCancelPayment(month: Pick<MonthDoc, 'status' | 'reopenedAt'>, payment: MonthPayment, uid: string): boolean {
  return (
    paymentCancelRefusal(
      { status: month.status, reopenedAtMs: month.reopenedAt ? month.reopenedAt.getTime() : null },
      { byUid: payment.byUid, atMs: payment.at ? payment.at.getTime() : null },
      uid,
    ) === null
  );
}

/** Cancela um pagamento (só quem registrou, antes do fechamento). Recusado: `CancelRefusedError` com o motivo. */
export async function cancelPayment(groupId: string, month: Competence, paymentId: string, reason?: string): Promise<void> {
  try {
    await call('cancelPayment', { groupId, month, paymentId, ...(reason?.trim() ? { reason: reason.trim() } : {}) });
  } catch (err) {
    const refusal = (err as FirebaseError & { details?: { reason?: CancelRefusal } }).details?.reason;
    if (refusal && refusal in CANCEL_REFUSAL_TEXT) throw new CancelRefusedError(refusal);
    throw err;
  }
}

export const closeMonth = (groupId: string, month: Competence) => call('closeMonth', { groupId, month });
export const requestReopen = (groupId: string, month: Competence, reason: string) =>
  call('requestReopen', { groupId, month, reason });
export const answerReopen = (groupId: string, month: Competence, approve: boolean) =>
  call('answerReopen', { groupId, month, approve });
export const cancelReopen = (groupId: string, month: Competence) => call('cancelReopen', { groupId, month });

/** Endereço da foto do comprovante PIX (precisa de conexão). */
export function paymentPhotoUrl(receiptPath: string): Promise<string | null> {
  return getDownloadURL(storageRef(storage, receiptPath)).catch(() => null);
}
