import { FirebaseError } from 'firebase/app';
import { Timestamp, collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import type { MonthBreakdown, Payment } from '@/domain/closing';
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
function newPaymentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export const settlementPhotoPath = (groupId: string, month: Competence, paymentId: string) =>
  `groups/${groupId}/settlements/${month}/${paymentId}.jpg`;

/**
 * Registra o pagamento do que falta (quem paga). PIX: envia a foto primeiro;
 * a Function só registra com a foto já no Storage.
 */
export async function registerPayment(
  groupId: string,
  month: Competence,
  method: 'pix' | 'cash',
  photo?: Blob,
): Promise<void> {
  const paymentId = newPaymentId();
  if (method === 'pix') {
    if (!photo) throw new Error('Escolha a foto do comprovante PIX.');
    await uploadBytes(storageRef(storage, settlementPhotoPath(groupId, month, paymentId)), photo, { contentType: 'image/jpeg' });
  }
  await call('registerPayment', { groupId, month, method, paymentId });
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
