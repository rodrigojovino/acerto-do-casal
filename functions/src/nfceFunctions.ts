import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { NfceError, fetchNfce, type NfceResult } from './nfce.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

/** `approval.byUid` quando quem confirma é a conferência da nota, não uma pessoa. */
export const NFCE_APPROVER = 'nfce';

/**
 * Pré-preenchimento: o app manda a URL do QR (online) e recebe valor, data e
 * emitente. Não grava nada; quem confirma o gasto é o gatilho abaixo.
 */
export const resolveNfce = onCall({ timeoutSeconds: 30 }, async (request): Promise<NfceResult> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre com sua conta Google primeiro.');
  const url = typeof request.data?.url === 'string' ? request.data.url : '';
  try {
    return (await fetchNfce(url)).result;
  } catch (err) {
    if (err instanceof NfceError) {
      const code = err.reason === 'network' || err.reason === 'blocked' ? 'unavailable' : 'failed-precondition';
      throw new HttpsError(code, err.message, { reason: err.reason });
    }
    throw new HttpsError('internal', 'Não foi possível consultar a nota.');
  }
});

interface NfceReceipt {
  type: 'nfce';
  nfceKey: string;
  nfceUrl: string;
  nfceStatus: 'pending' | 'ok' | 'failed';
  nfceData?: { issuerName: string; totalCents: number; date: string };
  nfceError?: string;
}

/**
 * Conferência do QR no servidor. Roda quando o gasto chega ao servidor
 * (inclusive o lançado offline) e a cada alteração:
 * 1. `nfceStatus: 'pending'` → consulta a SEFAZ e grava `ok` (com os dados
 *    da nota) ou `failed` (com o motivo). O QR continua valendo como comprovante.
 * 2. Pendente com nota `ok` e valor lançado igual ao da nota → `confirmed`.
 *    Valor diferente: continua pendente para o outro aprovar.
 * Nunca altera o valor lançado.
 */
export const checkNfce = onDocumentWritten(
  { document: 'groups/{groupId}/expenses/{expenseId}', timeoutSeconds: 60 },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const receipt = after.get('receipt') as NfceReceipt | undefined;
    if (receipt?.type !== 'nfce') return;

    if (receipt.nfceStatus === 'pending') {
      let update: Partial<NfceReceipt>;
      try {
        const { result } = await fetchNfce(receipt.nfceUrl);
        if (result.key !== receipt.nfceKey) throw new NfceError('mismatch', 'A chave da nota não confere.');
        update = {
          nfceStatus: 'ok',
          nfceData: { issuerName: result.issuerName, totalCents: result.totalCents, date: result.date },
        };
      } catch (err) {
        update = { nfceStatus: 'failed', nfceError: err instanceof NfceError ? err.reason : 'unknown' };
      }
      // Só grava se o gasto ainda tiver o mesmo QR pendente (pode ter mudado durante a consulta).
      await db.runTransaction(async (tx) => {
        const current = await tx.get(after.ref);
        const r = current.get('receipt') as NfceReceipt | undefined;
        if (!current.exists || r?.type !== 'nfce' || r.nfceKey !== receipt.nfceKey || r.nfceStatus !== 'pending') return;
        tx.update(after.ref, {
          'receipt.nfceStatus': update.nfceStatus,
          'receipt.nfceData': update.nfceData ?? FieldValue.delete(),
          'receipt.nfceError': update.nfceError ?? FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return; // a gravação acima dispara de novo e cai no passo 2
    }

    if (
      after.get('status') === 'pending_approval' &&
      receipt.nfceStatus === 'ok' &&
      receipt.nfceData?.totalCents === after.get('totalCents')
    ) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(after.ref);
        const r = current.get('receipt') as NfceReceipt | undefined;
        if (
          !current.exists ||
          current.get('status') !== 'pending_approval' ||
          r?.type !== 'nfce' ||
          r.nfceStatus !== 'ok' ||
          r.nfceData?.totalCents !== current.get('totalCents')
        ) {
          return;
        }
        // Mês fechado não muda (não deveria haver pendente em mês fechado).
        const month = await tx.get(db.doc(`groups/${event.params.groupId}/months/${current.get('competence')}`));
        if (month.exists && month.get('status') === 'closed') return;
        tx.update(after.ref, {
          status: 'confirmed',
          approval: { byUid: NFCE_APPROVER, at: FieldValue.serverTimestamp() },
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    }
  },
);
