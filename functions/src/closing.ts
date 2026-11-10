import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { monthOf, todayInSaoPaulo } from '../../src/domain/calendar.js';
import {
  CANCEL_REFUSAL_TEXT,
  MAX_CANCEL_REASON,
  closeBlockers,
  monthBreakdown,
  paymentCancelRefusal,
  remainingTransfer,
  type Blocker,
  type Payment,
} from '../../src/domain/closing.js';
import { paymentCancelledNotice } from '../../src/domain/notifications.js';
import { sendNotices } from './notify.js';
import type { ExpenseStatus, Members } from '../../src/domain/settlement.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

/**
 * Fechamento, pagamento do acerto e reabertura do mês. Só por estas Functions
 * (o app não grava em `months`): cada uma confere tudo numa transação, com as
 * mesmas funções de src/domain da tela. Todas exigem conexão.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[A-Za-z0-9]{8,40}$/;
export const MAX_REOPEN_REASON = 200;

interface MonthArgs {
  groupId: string;
  month: string;
}

function requireUid(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre com sua conta Google primeiro.');
  return request.auth.uid;
}

function monthArgs(data: unknown): MonthArgs {
  const { groupId, month } = (data ?? {}) as Partial<MonthArgs>;
  if (typeof groupId !== 'string' || !ID_RE.test(groupId)) throw new HttpsError('invalid-argument', 'Grupo inválido.');
  if (typeof month !== 'string' || !MONTH_RE.test(month)) throw new HttpsError('invalid-argument', 'Mês inválido.');
  return { groupId, month };
}

const monthRef = (groupId: string, month: string) => db.doc(`groups/${groupId}/months/${month}`);

/** Os dois membros do grupo; quem chamou precisa ser um deles (e o casal, completo). */
async function membersOf(tx: Transaction, groupId: string, uid: string): Promise<Members> {
  const group = await tx.get(db.doc(`groups/${groupId}`));
  const members = (group.get('members') as string[] | undefined) ?? [];
  if (!members.includes(uid)) throw new HttpsError('permission-denied', 'Você não faz parte deste grupo.');
  if (members.length !== 2) throw new HttpsError('failed-precondition', 'O casal ainda não está completo.');
  return [members[0], members[1]] as const;
}

interface ExpenseRow {
  totalCents: number;
  personalCents: number;
  /** Parte só do outro membro (v0.9.2); ausente = 0. Entra na conta por monthBreakdown. */
  partnerOnlyCents?: number;
  payerUid: string;
  payerSharePct: number;
  status: ExpenseStatus;
  receipt: { type: string; photoUploaded?: boolean };
}

async function monthExpenses(tx: Transaction, groupId: string, month: string): Promise<ExpenseRow[]> {
  const snap = await tx.get(db.collection(`groups/${groupId}/expenses`).where('competence', '==', month));
  return snap.docs.map((d) => d.data() as ExpenseRow);
}

const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const BLOCKER_TEXT: Record<Blocker['kind'], [string, string]> = {
  pending: ['gasto pendente de aprovação', 'gastos pendentes de aprovação'],
  returned: ['gasto devolvido', 'gastos devolvidos'],
  awaiting: ['recorrente a confirmar', 'recorrentes a confirmar'],
  deletion: ['pedido de exclusão aguardando resposta', 'pedidos de exclusão aguardando resposta'],
  photo: ['foto de comprovante não enviada', 'fotos de comprovante não enviadas'],
};

function blockersText(blockers: Blocker[]): string {
  return blockers.map((b) => `${b.count} ${BLOCKER_TEXT[b.kind][b.count === 1 ? 0 : 1]}`).join(', ');
}

export function settlementPhotoPath(groupId: string, month: string, paymentId: string): string {
  return `groups/${groupId}/settlements/${month}/${paymentId}.jpg`;
}

/**
 * Registra um pagamento do acerto: só quem deve pagar o que falta (o saldo
 * menos os pagamentos já feitos; depois de uma reabertura, o complemento ou a
 * devolução), sempre o valor exato que falta. PIX exige a foto já enviada ao
 * Storage; dinheiro, não.
 */
export const registerPayment = onCall(async (request): Promise<Payment> => {
  const uid = requireUid(request);
  const { groupId, month } = monthArgs(request.data);
  const { method, paymentId, expectedCents } = (request.data ?? {}) as { method?: unknown; paymentId?: unknown; expectedCents?: unknown };
  if (method !== 'pix' && method !== 'cash') throw new HttpsError('invalid-argument', 'Forma de pagamento inválida.');
  if (expectedCents !== undefined && (typeof expectedCents !== 'number' || !Number.isSafeInteger(expectedCents) || expectedCents <= 0)) {
    throw new HttpsError('invalid-argument', 'Valor esperado inválido.');
  }
  if (typeof paymentId !== 'string' || !ID_RE.test(paymentId)) throw new HttpsError('invalid-argument', 'Pagamento inválido.');

  const receiptPath = method === 'pix' ? settlementPhotoPath(groupId, month, paymentId) : undefined;
  if (receiptPath) {
    const [exists] = await getStorage().bucket().file(receiptPath).exists();
    if (!exists) throw new HttpsError('failed-precondition', 'A foto do comprovante PIX ainda não foi enviada.');
  }

  return db.runTransaction(async (tx) => {
    const members = await membersOf(tx, groupId, uid);
    const ref = monthRef(groupId, month);
    const current = await tx.get(ref);
    if (current.get('status') === 'closed') throw new HttpsError('failed-precondition', 'Este mês já está fechado.');
    const payments = (current.get('payments') as Payment[] | undefined) ?? [];
    if (payments.some((p) => p.id === paymentId)) throw new HttpsError('already-exists', 'Este pagamento já foi registrado.');

    const breakdown = monthBreakdown(await monthExpenses(tx, groupId, month), members);
    const remaining = remainingTransfer(breakdown.result, payments, members);
    if (!remaining) throw new HttpsError('failed-precondition', 'Não há nada a pagar neste mês.');
    if (remaining.fromUid !== uid) {
      throw new HttpsError('permission-denied', 'Quem registra o pagamento é quem paga.');
    }
    // A tela confirmou um valor (v0.9.3): se o que falta mudou desde então, recusa
    // e devolve o valor novo, para confirmar de novo (o app reaproveita a foto).
    if (expectedCents !== undefined && expectedCents !== remaining.amountCents) {
      throw new HttpsError('failed-precondition', `O valor que falta mudou para ${brl(remaining.amountCents)}.`, {
        reason: 'amount_changed',
        remaining,
      });
    }

    const payment: Payment = {
      id: paymentId,
      fromUid: remaining.fromUid,
      toUid: remaining.toUid,
      amountCents: remaining.amountCents,
      method,
      ...(receiptPath ? { receiptPath } : {}),
      byUid: uid,
      at: Timestamp.now(),
    };
    tx.set(ref, { status: 'open', payments: [...payments, payment] }, { merge: true });
    return { ...payment, at: (payment.at as Timestamp).toMillis() };
  });
});

/**
 * Fecha o mês: atual ou passado, sem pendências, devolvidos, recorrentes a
 * confirmar ou fotos não enviadas, e com o acerto pago (soma líquida dos
 * pagamentos = saldo). Guarda a memória de cálculo no mês.
 */
export const closeMonth = onCall(async (request): Promise<{ closed: true }> => {
  const uid = requireUid(request);
  const { groupId, month } = monthArgs(request.data);
  if (month > monthOf(todayInSaoPaulo())) throw new HttpsError('failed-precondition', 'Mês futuro não pode ser fechado.');

  return db.runTransaction(async (tx) => {
    const members = await membersOf(tx, groupId, uid);
    const ref = monthRef(groupId, month);
    const current = await tx.get(ref);
    if (current.get('status') === 'closed') throw new HttpsError('failed-precondition', 'Este mês já está fechado.');

    const expenses = await monthExpenses(tx, groupId, month);
    const blockers = closeBlockers(expenses);
    if (blockers.length > 0) {
      throw new HttpsError('failed-precondition', `Antes de fechar, resolva: ${blockersText(blockers)}.`, { blockers });
    }
    const payments = (current.get('payments') as Payment[] | undefined) ?? [];
    const breakdown = monthBreakdown(expenses, members);
    const remaining = remainingTransfer(breakdown.result, payments, members);
    if (remaining) {
      throw new HttpsError('failed-precondition', `Falta registrar o pagamento de ${brl(remaining.amountCents)}.`, { remaining });
    }

    tx.set(
      ref,
      {
        status: 'closed',
        summary: breakdown,
        closedAt: FieldValue.serverTimestamp(),
        closedBy: uid,
        reopenRequest: FieldValue.delete(),
      },
      { merge: true },
    );
    return { closed: true as const };
  });
});

/**
 * Cancela um pagamento do acerto (v0.9.3): só quem registrou, só enquanto o
 * pagamento não entrou num fechamento (mês aberto e registrado depois da última
 * reabertura). Numa transação que lê o mês, como closeMonth e registerPayment
 * (as três disputam o mesmo documento: só uma vence). Remove o pagamento da
 * lista (o valor que falta volta ao saldo) e grava o cancelamento em
 * months/{mês}/log, sem a foto (a foto vira órfã e sai na varredura semanal).
 * Sem aprovação do outro membro, que recebe um aviso.
 */
export const cancelPayment = onCall(async (request): Promise<{ cancelled: true }> => {
  const uid = requireUid(request);
  const { groupId, month } = monthArgs(request.data);
  const { paymentId, reason: rawReason } = (request.data ?? {}) as { paymentId?: unknown; reason?: unknown };
  if (typeof paymentId !== 'string' || !ID_RE.test(paymentId)) throw new HttpsError('invalid-argument', 'Pagamento inválido.');
  if (rawReason !== undefined && typeof rawReason !== 'string') throw new HttpsError('invalid-argument', 'Motivo inválido.');
  const reason = (rawReason ?? '').trim();
  if (reason.length > MAX_CANCEL_REASON) throw new HttpsError('invalid-argument', `Motivo com mais de ${MAX_CANCEL_REASON} caracteres.`);

  const result = await db.runTransaction(async (tx) => {
    const members = await membersOf(tx, groupId, uid);
    const ref = monthRef(groupId, month);
    const current = await tx.get(ref);
    const payments = (current.get('payments') as Payment[] | undefined) ?? [];
    const payment = payments.find((p) => p.id === paymentId);
    const atMs = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : null);
    const refusal = paymentCancelRefusal(
      { status: current.get('status') as string | undefined, reopenedAtMs: atMs(current.get('reopenedAt')) },
      payment ? { byUid: payment.byUid, atMs: atMs(payment.at) } : undefined,
      uid,
    );
    if (refusal) {
      const code = refusal === 'not_yours' ? 'permission-denied' : refusal === 'not_found' ? 'not-found' : 'failed-precondition';
      throw new HttpsError(code, CANCEL_REFUSAL_TEXT[refusal], { reason: refusal });
    }
    const p = payment!;
    tx.update(ref, { payments: payments.filter((x) => x.id !== paymentId) });
    tx.create(ref.collection('log').doc(`cancel-${paymentId}`), {
      type: 'payment_cancelled',
      by: 'member',
      byUid: uid,
      at: FieldValue.serverTimestamp(),
      paymentId,
      amountCents: p.amountCents,
      method: p.method,
      fromUid: p.fromUid,
      toUid: p.toUid,
      registeredBy: p.byUid,
      registeredAt: p.at,
      ...(reason ? { reason } : {}),
    });
    return { members, payment: { amountCents: p.amountCents, byUid: p.byUid, atMs: atMs(p.at) } };
  });

  // Aviso para o outro membro (fora da transação: a transação pode ser repetida).
  const group = await db.doc(`groups/${groupId}`).get();
  const names = (group.get('memberNames') as Record<string, string> | undefined) ?? {};
  const nameOf = (u: string) => (names[u] ?? '').trim().split(/\s+/)[0] || 'A outra pessoa';
  await sendNotices(groupId, [paymentCancelledNotice(result.payment, month, { members: result.members, nameOf })]).catch(() => undefined);
  return { cancelled: true as const };
});

/** Pede a reabertura de um mês fechado, com motivo; o outro membro aprova ou recusa. */
export const requestReopen = onCall(async (request): Promise<{ requested: true }> => {
  const uid = requireUid(request);
  const { groupId, month } = monthArgs(request.data);
  const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, MAX_REOPEN_REASON) : '';
  if (!reason) throw new HttpsError('invalid-argument', 'Informe o motivo da reabertura.');

  return db.runTransaction(async (tx) => {
    await membersOf(tx, groupId, uid);
    const ref = monthRef(groupId, month);
    const current = await tx.get(ref);
    if (current.get('status') !== 'closed') throw new HttpsError('failed-precondition', 'Este mês não está fechado.');
    if (current.get('reopenRequest.status') === 'pending') {
      throw new HttpsError('already-exists', 'Já existe um pedido de reabertura aguardando resposta.');
    }
    tx.update(ref, { reopenRequest: { byUid: uid, reason, at: FieldValue.serverTimestamp(), status: 'pending' } });
    return { requested: true as const };
  });
});

/**
 * Responde ao pedido de reabertura (só o outro membro). Aprovado, o mês volta
 * a aberto; os pagamentos já registrados continuam valendo e a memória de
 * cálculo guardada sai (será refeita ao fechar de novo).
 */
export const answerReopen = onCall(async (request): Promise<{ status: 'approved' | 'denied' }> => {
  const uid = requireUid(request);
  const { groupId, month } = monthArgs(request.data);
  const approve = request.data?.approve;
  if (typeof approve !== 'boolean') throw new HttpsError('invalid-argument', 'Resposta inválida.');

  return db.runTransaction(async (tx) => {
    await membersOf(tx, groupId, uid);
    const ref = monthRef(groupId, month);
    const current = await tx.get(ref);
    if (current.get('status') !== 'closed' || current.get('reopenRequest.status') !== 'pending') {
      throw new HttpsError('failed-precondition', 'Não há pedido de reabertura aguardando resposta.');
    }
    if (current.get('reopenRequest.byUid') === uid) {
      throw new HttpsError('permission-denied', 'Quem pediu a reabertura não pode aprovar o próprio pedido.');
    }
    const answer = {
      'reopenRequest.status': approve ? 'approved' : 'denied',
      'reopenRequest.answeredBy': uid,
      'reopenRequest.answeredAt': FieldValue.serverTimestamp(),
    };
    tx.update(
      ref,
      approve
        ? { ...answer, status: 'open', summary: FieldValue.delete(), reopenedAt: FieldValue.serverTimestamp() }
        : answer,
    );
    return { status: approve ? ('approved' as const) : ('denied' as const) };
  });
});

/** Quem pediu a reabertura desiste do pedido ainda sem resposta. */
export const cancelReopen = onCall(async (request): Promise<{ cancelled: true }> => {
  const uid = requireUid(request);
  const { groupId, month } = monthArgs(request.data);

  return db.runTransaction(async (tx) => {
    await membersOf(tx, groupId, uid);
    const ref = monthRef(groupId, month);
    const current = await tx.get(ref);
    if (current.get('reopenRequest.status') !== 'pending' || current.get('reopenRequest.byUid') !== uid) {
      throw new HttpsError('failed-precondition', 'Não há pedido seu aguardando resposta.');
    }
    tx.update(ref, { reopenRequest: FieldValue.delete() });
    return { cancelled: true as const };
  });
});
