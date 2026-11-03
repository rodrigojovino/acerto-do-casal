import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { NfceError, fetchNfce, parseNfceQr, readNfcePage, type NfceItems, type NfceResult } from './nfce.js';
import { retryWindow } from './nfceRetry.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

/**
 * Consulta da NFC-e de SP na SEFAZ. Desde o fim de outubro de 2026 um filtro
 * de segurança da SEFAZ barra a maioria das consultas automáticas; por isso
 * cada nota tem no máximo duas consultas no total (uma no formulário, pelo
 * servidor ou pelo aparelho, e uma aqui, só se o formulário não tentou), e
 * nada se repete sozinho. A nova tentativa manual ("Tentar conferir de novo")
 * é limitada a uma a cada 15 minutos por nota, contada aqui no servidor.
 */

// ---- Chave de configuração: `config/nfce.sefazEnabled` (sem o documento: ligada) ----
let enabledCache: { value: boolean; at: number } | null = null;

/** A consulta automática à SEFAZ está ligada? Lida do Firestore, com cache de 1 minuto. */
async function sefazEnabled(): Promise<boolean> {
  // No emulador, sem cache: os testes ligam e desligam a chave entre um caso e outro.
  const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
  if (!emulator && enabledCache && Date.now() - enabledCache.at < 60_000) return enabledCache.value;
  const doc = await db.doc('config/nfce').get();
  const value = doc.get('sefazEnabled') !== false;
  enabledCache = { value, at: Date.now() };
  return value;
}

/**
 * Página da nota: a da SEFAZ-SP ou, no emulador, uma página fictícia gravada
 * pelos testes em `emulatorFixtures/sefaz_{chave}` (sem rede). A conferência e
 * os itens saem da mesma página. Registra no log o tipo de cada falha (sem
 * dados da nota), para diagnóstico.
 */
async function consultSefaz(
  url: string,
  key: string,
  origin: 'resolveNfce' | 'checkNfce' | 'retryNfce',
): Promise<{ result: NfceResult; items: NfceItems | null }> {
  const started = Date.now();
  try {
    let page: { result: NfceResult; items: NfceItems | null };
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      const fixture = await db.doc(`emulatorFixtures/sefaz_${key}`).get();
      page = fixture.exists ? readNfcePage(url, fixture.get('html') as string) : readNfcePage(url, (await fetchNfce(url)).html);
    } else {
      page = readNfcePage(url, (await fetchNfce(url)).html);
    }
    logger.info('consulta da SEFAZ', { origin, ok: true, ms: Date.now() - started });
    return page;
  } catch (err) {
    logger.info('consulta da SEFAZ', {
      origin,
      ok: false,
      reason: err instanceof NfceError ? err.reason : 'unknown',
      message: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    });
    throw err;
  }
}

// ---- Resultado conferido pelo servidor no formulário (`nfceCache/{chave}`, só Functions) ----
const CACHE_DAYS = 7;

function cacheRef(key: string): DocumentReference {
  return db.doc(`nfceCache/${key}`);
}

/** Guarda o que o servidor conferiu no formulário, para o gatilho não consultar de novo (apagado por TTL). */
async function saveCache(key: string, result: NfceResult, items: NfceItems | null): Promise<void> {
  await cacheRef(key)
    .set({
      result: { issuerName: result.issuerName, totalCents: result.totalCents, date: result.date },
      items,
      fetchedAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000),
    })
    .catch((err) => logger.warn('Resultado da nota não guardado', { err: String(err) }));
}

async function readCache(key: string): Promise<{ result: NfceReceipt['nfceData']; items: NfceItems | null } | null> {
  const doc = await cacheRef(key).get();
  if (!doc.exists) return null;
  const expireAt = doc.get('expireAt') as Timestamp | undefined;
  if (expireAt && expireAt.toMillis() < Date.now()) return null;
  return { result: doc.get('result') as NfceReceipt['nfceData'], items: (doc.get('items') as NfceItems | null) ?? null };
}

/** `approval.byUid` quando quem confirma é a conferência da nota, não uma pessoa. */
export const NFCE_APPROVER = 'nfce';

/**
 * Pré-preenchimento: o app manda a URL do QR (online) e recebe valor, data e
 * emitente; uma tentativa. Deu certo: guarda o resultado conferido (com os
 * itens) para o gatilho gravar "conferida" sem consultar de novo.
 */
export const resolveNfce = onCall({ timeoutSeconds: 30 }, async (request): Promise<NfceResult> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre com sua conta Google primeiro.');
  const url = typeof request.data?.url === 'string' ? request.data.url : '';
  try {
    if (!(await sefazEnabled())) throw new NfceError('blocked', 'A consulta automática da SEFAZ está desligada.');
    const key = parseNfceQr(url).key;
    const { result, items } = await consultSefaz(url, key, 'resolveNfce');
    await saveCache(key, result, items);
    return result;
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
  /**
   * 'pending': a consultar aqui (lançado offline, ou conferido pelo servidor no
   * formulário). 'unchecked': sem conferência automática (NF-e, outros estados,
   * ou NFC-e de SP cujas duas tentativas do formulário já foram feitas).
   */
  nfceStatus: 'pending' | 'ok' | 'failed' | 'unchecked';
  nfceData?: { issuerName: string; totalCents: number; date: string };
  nfceError?: string;
}

type NfceUpdate = Pick<NfceReceipt, 'nfceStatus' | 'nfceData' | 'nfceError'>;

/**
 * Grava o resultado no gasto (numa série, em todas as parcelas com a mesma
 * nota ainda não conferida, fora de mês fechado). `onlyIfPending`: o gasto do
 * gatilho só muda se ainda estiver pendente (pode ter mudado durante a consulta).
 */
async function applyResult(
  groupId: string,
  owner: DocumentReference,
  key: string,
  seriesId: string | null,
  update: NfceUpdate,
  onlyIfPending: boolean,
): Promise<number> {
  const refs = seriesId
    ? (await owner.parent.where('installment.seriesId', '==', seriesId).get()).docs.map((d) => d.ref)
    : [owner];
  return db.runTransaction(async (tx) => {
    const docs = await Promise.all(refs.map((ref) => tx.get(ref)));
    const months = new Map<string, boolean>();
    for (const d of docs) {
      const c = d.get('competence') as string | undefined;
      if (c && !months.has(c)) months.set(c, (await tx.get(db.doc(`groups/${groupId}/months/${c}`))).get('status') === 'closed');
    }
    let written = 0;
    for (const current of docs) {
      const r = current.get('receipt') as NfceReceipt | undefined;
      if (!current.exists || r?.type !== 'nfce' || r.nfceKey !== key || r.nfceStatus === 'ok') continue;
      if (onlyIfPending && current.ref.isEqual(owner) && r.nfceStatus !== 'pending') continue;
      if (months.get(current.get('competence') as string)) continue; // mês fechado: imutável
      tx.update(current.ref, {
        'receipt.nfceStatus': update.nfceStatus,
        'receipt.nfceData': update.nfceData ?? FieldValue.delete(),
        'receipt.nfceError': update.nfceError ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      written++;
    }
    return written;
  });
}

/** Itens oficiais (lidos pelo servidor): substituem os lidos no aparelho, se houver. */
async function saveItems(groupId: string, key: string, items: NfceItems | null, source: 'checkNfce' | 'retryNfce'): Promise<void> {
  if (!items) return;
  await db
    .doc(`groups/${groupId}/nfceItems/${key}`)
    .set({ ...items, fetchedAt: FieldValue.serverTimestamp(), source })
    .catch((err) => logger.warn('Itens da nota não gravados', { err: String(err) }));
}

/**
 * Conferência da NFC-e de SP no servidor, quando o gasto chega com
 * `nfceStatus: 'pending'` (a parcela 1, numa série):
 * - resultado já conferido pelo servidor no formulário (`nfceCache`): grava
 *   `ok`, os dados e os itens, sem consultar de novo;
 * - senão (lançado offline, ou versão web sem a leitura pelo aparelho): uma
 *   consulta; grava `ok` ou `failed`. Nunca repete sozinho;
 * - consulta desligada (`config/nfce.sefazEnabled: false`): `unchecked`, sem rede.
 * Só registra o resultado: nunca muda o status nem o valor lançado.
 */
export const checkNfce = onDocumentWritten(
  { document: 'groups/{groupId}/expenses/{expenseId}', timeoutSeconds: 60 },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const receipt = after.get('receipt') as NfceReceipt | undefined;
    if (receipt?.type !== 'nfce' || receipt.nfceStatus !== 'pending') return;
    // Compra parcelada: a nota é da compra; só a parcela 1 consulta e repassa o resultado.
    const installment = after.get('installment') as { seriesId: string; index: number } | undefined;
    if (installment && installment.index !== 1) return;
    const { groupId } = event.params;
    const seriesId = installment?.seriesId ?? null;

    let update: NfceUpdate;
    let items: NfceItems | null = null;
    const cached = await readCache(receipt.nfceKey);
    if (cached?.result) {
      update = { nfceStatus: 'ok', nfceData: cached.result };
      items = cached.items;
    } else if (!(await sefazEnabled())) {
      update = { nfceStatus: 'unchecked' };
    } else {
      try {
        if (!receipt.nfceUrl) throw new NfceError('not_sp', 'Nota sem URL de consulta.');
        const { result, items: read } = await consultSefaz(receipt.nfceUrl, receipt.nfceKey, 'checkNfce');
        if (result.key !== receipt.nfceKey) throw new NfceError('mismatch', 'A chave da nota não confere.');
        items = read;
        update = { nfceStatus: 'ok', nfceData: { issuerName: result.issuerName, totalCents: result.totalCents, date: result.date } };
      } catch (err) {
        update = { nfceStatus: 'failed', nfceError: err instanceof NfceError ? err.reason : 'unknown' };
      }
    }
    await applyResult(groupId, after.ref, receipt.nfceKey, seriesId, update, true);
    // Itens da nota: um documento por chave, fora do gasto (numa série, vale para todas as parcelas).
    if (update.nfceStatus === 'ok') await saveItems(groupId, receipt.nfceKey, items, 'checkNfce');
  },
);

/**
 * "Tentar conferir de novo" (Detalhe, quem lançou): uma consulta pelo servidor
 * para uma NFC-e de SP ainda não conferida, no máximo uma a cada 15 minutos
 * por nota (contada aqui, numa transação: vale para toques rápidos e para
 * outro aparelho). Deu certo: grava `ok`, os dados e os itens oficiais.
 * Falhou: devolve o motivo e quando tentar de novo (no Android, o app oferece
 * abrir a nota no aparelho, uma vez). Nunca em mês fechado.
 */
export const retryNfce = onCall(
  { timeoutSeconds: 30 },
  async (request): Promise<{ ok: boolean; reason?: string; retryAt: number }> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Entre com sua conta Google primeiro.');
    const groupId = typeof request.data?.groupId === 'string' ? request.data.groupId : '';
    const expenseId = typeof request.data?.expenseId === 'string' ? request.data.expenseId : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(groupId) || !/^[A-Za-z0-9_-]{1,80}$/.test(expenseId)) {
      throw new HttpsError('invalid-argument', 'Gasto inválido.');
    }
    const group = await db.doc(`groups/${groupId}`).get();
    if (!((group.get('members') as string[] | undefined) ?? []).includes(uid)) {
      throw new HttpsError('permission-denied', 'Você não faz parte deste grupo.');
    }
    const expense = await db.doc(`groups/${groupId}/expenses/${expenseId}`).get();
    if (!expense.exists) throw new HttpsError('not-found', 'Este gasto não existe mais.');
    if (expense.get('createdBy') !== uid) throw new HttpsError('permission-denied', 'Só quem lançou pode pedir a conferência.');
    const receipt = expense.get('receipt') as NfceReceipt | undefined;
    if (receipt?.type !== 'nfce' || !receipt.nfceUrl) throw new HttpsError('failed-precondition', 'Só NFC-e de SP tem conferência.');
    if (receipt.nfceStatus === 'ok') throw new HttpsError('failed-precondition', 'Esta nota já foi conferida.');
    const competence = expense.get('competence') as string;
    if ((await db.doc(`groups/${groupId}/months/${competence}`).get()).get('status') === 'closed') {
      throw new HttpsError('failed-precondition', 'Este gasto é de um mês fechado.');
    }

    // Limite: uma tentativa a cada 15 minutos por nota, numa transação.
    const limitRef = db.doc(`groups/${groupId}/nfceRetry/${receipt.nfceKey}`);
    const window = await db.runTransaction(async (tx) => {
      const last = (await tx.get(limitRef)).get('lastAt') as Timestamp | undefined;
      const w = retryWindow(last ? last.toMillis() : null, Date.now());
      if (w.allowed) tx.set(limitRef, { lastAt: FieldValue.serverTimestamp(), byUid: uid });
      return w;
    });
    if (!window.allowed) {
      throw new HttpsError('resource-exhausted', 'Tente de novo mais tarde.', { retryAt: window.retryAt });
    }

    if (!(await sefazEnabled())) return { ok: false, reason: 'disabled', retryAt: window.retryAt };
    const installment = expense.get('installment') as { seriesId: string } | undefined;
    const owner = installment ? db.doc(`groups/${groupId}/expenses/${installment.seriesId}`) : expense.ref;
    try {
      const { result, items } = await consultSefaz(receipt.nfceUrl, receipt.nfceKey, 'retryNfce');
      if (result.key !== receipt.nfceKey) throw new NfceError('mismatch', 'A chave da nota não confere.');
      const update: NfceUpdate = { nfceStatus: 'ok', nfceData: { issuerName: result.issuerName, totalCents: result.totalCents, date: result.date } };
      await applyResult(groupId, owner, receipt.nfceKey, installment?.seriesId ?? null, update, false);
      await saveItems(groupId, receipt.nfceKey, items, 'retryNfce');
      return { ok: true, retryAt: window.retryAt };
    } catch (err) {
      return { ok: false, reason: err instanceof NfceError ? err.reason : 'unknown', retryAt: window.retryAt };
    }
  },
);
