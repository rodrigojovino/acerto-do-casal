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
  /** URL canônica da SEFAZ-SP; ausente em notas de outros estados. */
  nfceUrl?: string;
  /** 'unchecked': nota de outro estado, sem conferência automática (vai para aprovação). */
  nfceStatus: 'pending' | 'ok' | 'failed' | 'unchecked';
  nfceData?: { issuerName: string; totalCents: number; date: string };
  nfceError?: string;
}

/**
 * Conferência do QR no servidor (só notas de SP; as de outros estados ficam
 * 'unchecked' e vão para aprovação). Roda quando o gasto chega ao servidor
 * (inclusive o lançado offline) e a cada alteração:
 * 1. `nfceStatus: 'pending'` → consulta a SEFAZ e grava `ok` (com os dados
 *    da nota) ou `failed` (com o motivo). O QR continua valendo como comprovante.
 * Só registra o resultado (ok, falha ou valor da nota para comparação): nunca
 * muda o status nem o valor lançado. Gasto com QR já nasce confirmado; um valor
 * divergente vira aviso, e o outro membro pode contestar.
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
        if (!receipt.nfceUrl) throw new NfceError('not_sp', 'Nota sem URL de consulta.');
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
    }
  },
);
