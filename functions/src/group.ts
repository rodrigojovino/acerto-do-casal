import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentReference,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  INVITE_TTL_MS,
  formatInviteCode,
  generateInviteCode,
  normalizeInviteCode,
} from './invite.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

/** Tentativas erradas de código permitidas por usuário na janela. */
export const MAX_JOIN_FAILURES = 10;
export const JOIN_WINDOW_MS = 60 * 60 * 1000;

export interface InviteResult {
  groupId: string;
  code: string;
  /** Epoch em ms. */
  expiresAt: number;
}

function requireUid(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre com sua conta Google primeiro.');
  return request.auth.uid;
}

function displayName(request: CallableRequest): string {
  const token = request.auth?.token;
  return (token?.name as string | undefined) ?? token?.email ?? 'Sem nome';
}

const membershipRef = (uid: string) => db.doc(`memberships/${uid}`);
const inviteRef = (code: string) => db.doc(`invites/${code}`);
const attemptsRef = (uid: string) => db.doc(`joinAttempts/${uid}`);

/** Reserva um código livre e grava o convite dentro da transação. */
async function issueInvite(
  tx: Transaction,
  groupRef: DocumentReference,
  uid: string,
  now: number,
): Promise<{ code: string; expiresAt: Timestamp }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const existing = await tx.get(inviteRef(code));
    if (existing.exists) continue;
    const expiresAt = Timestamp.fromMillis(now + INVITE_TTL_MS);
    tx.set(inviteRef(code), { groupId: groupRef.id, createdBy: uid, expiresAt });
    return { code, expiresAt };
  }
  throw new HttpsError('internal', 'Não foi possível gerar um código. Tente de novo.');
}

/** Cria o grupo do casal com quem chamou como primeiro membro e gera o convite. */
export const createGroup = onCall(async (request): Promise<InviteResult> => {
  const uid = requireUid(request);
  const name = displayName(request);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const membership = await tx.get(membershipRef(uid));
    if (membership.exists) {
      throw new HttpsError('already-exists', 'Você já faz parte de um grupo.');
    }
    const groupRef = db.collection('groups').doc();
    const { code, expiresAt } = await issueInvite(tx, groupRef, uid, now);
    tx.set(groupRef, {
      members: [uid],
      memberNames: { [uid]: name },
      defaultSplitPct: 50,
      inviteCode: code,
      inviteExpiresAt: expiresAt,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(membershipRef(uid), { groupId: groupRef.id });
    return { groupId: groupRef.id, code: formatInviteCode(code), expiresAt: expiresAt.toMillis() };
  });
});

/** Gera um código novo (o anterior deixa de valer) enquanto o grupo espera o segundo membro. */
export const renewInvite = onCall(async (request): Promise<InviteResult> => {
  const uid = requireUid(request);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const membership = await tx.get(membershipRef(uid));
    if (!membership.exists) {
      throw new HttpsError('failed-precondition', 'Você ainda não tem um grupo.');
    }
    const groupRef = db.doc(`groups/${membership.get('groupId') as string}`);
    const group = await tx.get(groupRef);
    const members = (group.get('members') as string[] | undefined) ?? [];
    if (members.length >= 2) {
      throw new HttpsError('failed-precondition', 'O grupo já está completo.');
    }
    const oldCode = group.get('inviteCode') as string | null | undefined;
    const { code, expiresAt } = await issueInvite(tx, groupRef, uid, now);
    if (oldCode) tx.delete(inviteRef(oldCode));
    tx.update(groupRef, { inviteCode: code, inviteExpiresAt: expiresAt });
    return { groupId: groupRef.id, code: formatInviteCode(code), expiresAt: expiresAt.toMillis() };
  });
});

type JoinOutcome =
  | { ok: true; groupId: string }
  | { ok: false; error: HttpsError };

/**
 * Entra no grupo pelo código. Valida existência, validade, dono do código e o
 * limite de 2 membros, tudo na mesma transação. Códigos errados contam para o
 * limite de tentativas, gravado na mesma transação antes de responder o erro.
 */
export const joinGroup = onCall(async (request): Promise<{ groupId: string }> => {
  const uid = requireUid(request);
  const name = displayName(request);
  const raw = typeof request.data?.code === 'string' ? request.data.code : '';
  const code = normalizeInviteCode(raw);
  const now = Date.now();

  const outcome = await db.runTransaction(async (tx): Promise<JoinOutcome> => {
    const attempts = await tx.get(attemptsRef(uid));
    const windowStart = (attempts.get('windowStart') as Timestamp | undefined)?.toMillis() ?? 0;
    const inWindow = now - windowStart < JOIN_WINDOW_MS;
    const failures = inWindow ? ((attempts.get('failures') as number | undefined) ?? 0) : 0;
    if (failures >= MAX_JOIN_FAILURES) {
      return {
        ok: false,
        error: new HttpsError('resource-exhausted', 'Muitas tentativas. Espere uma hora e tente de novo.'),
      };
    }

    const fail = (error: HttpsError): JoinOutcome => {
      tx.set(attemptsRef(uid), {
        windowStart: inWindow ? Timestamp.fromMillis(windowStart) : Timestamp.fromMillis(now),
        failures: failures + 1,
      });
      return { ok: false, error };
    };

    const membership = await tx.get(membershipRef(uid));
    if (membership.exists) {
      return { ok: false, error: new HttpsError('already-exists', 'Você já faz parte de um grupo.') };
    }
    if (!code) {
      return fail(new HttpsError('invalid-argument', 'Código inválido. Confira e digite de novo.'));
    }

    const invite = await tx.get(inviteRef(code));
    if (!invite.exists) {
      return fail(new HttpsError('not-found', 'Código inválido. Confira e digite de novo.'));
    }
    if ((invite.get('expiresAt') as Timestamp).toMillis() <= now) {
      return fail(new HttpsError('deadline-exceeded', 'Este código expirou. Peça um novo.'));
    }
    if (invite.get('createdBy') === uid) {
      return {
        ok: false,
        error: new HttpsError('failed-precondition', 'Este é o seu próprio código. Envie para a outra pessoa.'),
      };
    }

    const groupRef = db.doc(`groups/${invite.get('groupId') as string}`);
    const group = await tx.get(groupRef);
    const members = (group.get('members') as string[] | undefined) ?? [];
    if (!group.exists || members.length >= 2) {
      return { ok: false, error: new HttpsError('failed-precondition', 'Este grupo já está completo.') };
    }

    tx.update(groupRef, {
      members: [...members, uid],
      [`memberNames.${uid}`]: name,
      inviteCode: null,
      inviteExpiresAt: null,
    });
    tx.delete(inviteRef(code));
    tx.create(membershipRef(uid), { groupId: groupRef.id });
    tx.delete(attemptsRef(uid));
    return { ok: true, groupId: groupRef.id };
  });

  if (!outcome.ok) throw outcome.error;
  return { groupId: outcome.groupId };
});
