import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  actionCount,
  expenseNotices,
  monthNotices,
  recurringNotices,
  type ExpenseSnapshot,
  type MonthSnapshot,
  type Notice,
  type NoticeContext,
  type RecurringSnapshot,
} from '../../src/domain/notifications.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

/**
 * Avisos por push (FCM): os gatilhos olham o antes e o depois de cada gasto,
 * mês e recorrente e usam as regras de src/domain/notifications.ts. Cada aviso
 * respeita a preferência de quem recebe e vai para todos os aparelhos dele;
 * tokens que o FCM recusa são apagados.
 *
 * No emulador não há FCM: os avisos vão para `notificationOutbox` (para os
 * testes) e tokens começando com "invalid-" simulam a recusa.
 */

export const ANDROID_CHANNEL = 'avisos';
const DEDUPE_TTL_MS = 7 * 24 * 3600 * 1000;
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const inEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;

/** Contexto do grupo: os dois membros e o primeiro nome de cada um. */
async function groupContext(groupId: string): Promise<NoticeContext | null> {
  const group = await db.doc(`groups/${groupId}`).get();
  const members = (group.get('members') as string[] | undefined) ?? [];
  if (members.length !== 2) return null;
  const names = (group.get('memberNames') as Record<string, string> | undefined) ?? {};
  return {
    members: [members[0], members[1]],
    nameOf: (uid) => (names[uid] ?? 'Alguém').trim().split(/\s+/)[0],
  };
}

/** Contador de quem recebe (vai no aviso como o número do ícone do app). */
async function pendingCount(groupId: string, uid: string): Promise<number> {
  const base = db.doc(`groups/${groupId}`);
  const [open, deletions, recurrings, months] = await Promise.all([
    base.collection('expenses').where('status', 'in', ['pending_approval', 'returned', 'awaiting_confirmation']).get(),
    // Pedidos de exclusão abertos (gastos confirmados, fora da consulta acima).
    base.collection('expenses').where('deletionRequest.status', '==', 'pending').get(),
    base.collection('recurring').get(),
    base.collection('months').get(),
  ]);
  const expenses = new Map([...open.docs, ...deletions.docs].map((d) => [d.id, d]));
  return actionCount({
    viewerUid: uid,
    expenses: [...expenses.values()].map((d) => ({
      id: d.id,
      ...(d.data() as { status: never; createdBy: string; installment?: { seriesId: string }; deletionRequest?: { status: string } }),
    })),
    recurrings: recurrings.docs.map((d) => d.data() as { active: boolean; status: string; proposal?: unknown; createdBy: string }),
    months: months.docs.map((d) => d.data() as { status: string; reopenRequest?: { status: string; byUid: string } }),
  });
}

/**
 * Registra a chave de um aviso de lote (série de parcelas). Só a primeira
 * parcela do lote consegue criar o registro e envia o aviso.
 */
async function firstOfBatch(groupId: string, key: string): Promise<boolean> {
  const id = key.replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 300);
  try {
    await db.doc(`groups/${groupId}/notificationLog/${id}`).create({
      expireAt: Timestamp.fromMillis(Date.now() + DEDUPE_TTL_MS),
    });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
}

/**
 * Envia os avisos: confere o lote (série), a preferência de quem recebe e
 * os aparelhos dele. `batchTime`: instante da gravação (o mesmo para todas as
 * parcelas de um lote).
 */
export async function sendNotices(groupId: string, notices: readonly Notice[], batchTime?: string): Promise<void> {
  for (const notice of notices) {
    if (notice.dedupeKey && !(await firstOfBatch(groupId, `${notice.dedupeKey}_${batchTime ?? 'sem-hora'}`))) continue;

    const user = await db.doc(`users/${notice.toUid}`).get();
    const prefs = (user.get('notificationPrefs') as Record<string, boolean> | undefined) ?? {};
    if (prefs[notice.category] === false) continue;

    const devices = await db.collection(`users/${notice.toUid}/devices`).get();
    const tokens = devices.docs.map((d) => ({ ref: d.ref, token: d.get('token') as string })).filter((d) => !!d.token);
    const badge = await pendingCount(groupId, notice.toUid);

    if (inEmulator()) {
      await db.collection('notificationOutbox').add({
        groupId,
        ...notice,
        tokens: tokens.map((t) => t.token),
        badge,
        at: FieldValue.serverTimestamp(),
      });
      await Promise.all(tokens.filter((t) => t.token.startsWith('invalid-')).map((t) => t.ref.delete()));
      continue;
    }
    if (tokens.length === 0) continue;

    const messages: Message[] = tokens.map(({ token }) => ({
      token,
      notification: { title: notice.title, body: notice.body },
      data: { route: notice.route, category: notice.category },
      android: {
        priority: 'high',
        notification: { channelId: ANDROID_CHANNEL, notificationCount: badge },
      },
    }));
    const result = await getMessaging().sendEach(messages);
    await Promise.all(
      result.responses.map((r, i) => {
        if (r.success) return undefined;
        const code = r.error?.code ?? '';
        if (INVALID_TOKEN_CODES.has(code)) return tokens[i].ref.delete();
        logger.warn('Aviso não enviado', { code, category: notice.category });
        return undefined;
      }),
    );
  }
}

const dataOf = <T>(snap: DocumentSnapshot | undefined): T | null => (snap?.exists ? (snap.data() as T) : null);
const batchTimeOf = (snap: DocumentSnapshot | undefined) => snap?.updateTime?.toMillis().toString();

/** Gastos: lançamento, devolução, correção, confirmação e comprovante anexado. */
export const notifyExpense = onDocumentWritten('groups/{groupId}/expenses/{expenseId}', async (event) => {
  const { groupId, expenseId } = event.params;
  const before = dataOf<ExpenseSnapshot>(event.data?.before);
  const after = dataOf<ExpenseSnapshot>(event.data?.after);
  // Excluído: só interessa se havia pedido de exclusão aberto (aprovação).
  if (!after && before?.deletionRequest?.status !== 'pending') return;
  const ctx = await groupContext(groupId);
  if (!ctx) return;
  // Numa série excluída em lote, todas as parcelas têm o mesmo instante do evento.
  const batchTime = after ? batchTimeOf(event.data?.after) : String(Date.parse(event.time));
  await sendNotices(groupId, expenseNotices(before, after, expenseId, ctx), batchTime);
});

/** Meses: pagamento do acerto, fechamento e reabertura. */
export const notifyMonth = onDocumentWritten('groups/{groupId}/months/{month}', async (event) => {
  const { groupId, month } = event.params;
  const ctx = await groupContext(groupId);
  if (!ctx) return;
  await sendNotices(groupId, monthNotices(dataOf<MonthSnapshot>(event.data?.before), dataOf<MonthSnapshot>(event.data?.after), month, ctx));
});

/** Recorrentes: fixo novo ou reajuste para aprovar. */
export const notifyRecurring = onDocumentWritten('groups/{groupId}/recurring/{recurringId}', async (event) => {
  const { groupId, recurringId } = event.params;
  const ctx = await groupContext(groupId);
  if (!ctx) return;
  await sendNotices(
    groupId,
    recurringNotices(dataOf<RecurringSnapshot>(event.data?.before), dataOf<RecurringSnapshot>(event.data?.after), recurringId, ctx),
  );
});
