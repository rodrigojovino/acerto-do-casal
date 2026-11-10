import './options.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { NfceError, fetchNfce, parseNfceQr, readNfcePage, type NfceItems, type NfceResult } from './nfce.js';
import { CACHE_TTL_MS, RUNNING_STALE_MS, cacheDecision, waitDeadline, type CacheState, type CachedResult } from './nfceCache.js';
import { retryWindow } from './nfceRetry.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

/**
 * Consulta da NFC-e de SP na SEFAZ. Desde o fim de outubro de 2026 um filtro
 * de segurança da SEFAZ barra a maioria das consultas automáticas; por isso
 * cada nota tem no máximo duas consultas no total (uma no formulário, pelo
 * servidor ou pelo aparelho, e uma aqui, só se o formulário não tentou), e
 * nada se repete sozinho. A nova tentativa manual ("Tentar conferir de novo")
 * é limitada a uma por minuto por nota, contada aqui no servidor.
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

const emulator = () => process.env.FUNCTIONS_EMULATOR === 'true';

/**
 * Página da nota: a da SEFAZ-SP ou, no emulador, uma página fictícia gravada
 * pelos testes em `emulatorFixtures/sefaz_{chave}` (sem rede; sem a página, o
 * emulador falha como "sem resposta" e nunca consulta a SEFAZ de verdade). No
 * emulador, cada consulta é contada em `emulatorFixtures/sefazCalls_{chave}` e
 * a página pode demorar (`delayMs`), para os testes de leituras simultâneas.
 * A conferência e os itens saem da mesma página. Registra no log o tipo de
 * cada falha (sem dados da nota), para diagnóstico.
 */
async function consultSefaz(
  url: string,
  key: string,
  origin: 'resolveNfce' | 'checkNfce' | 'retryNfce',
): Promise<{ result: NfceResult; items: NfceItems | null }> {
  const started = Date.now();
  try {
    let page: { result: NfceResult; items: NfceItems | null };
    // URL inválida ou de fora de SP: recusada antes de qualquer rede (também no emulador).
    if (!parseNfceQr(url).spUrl) throw new NfceError('not_sp', 'A conferência automática é só para notas de SP.');
    if (emulator()) {
      await db.doc(`emulatorFixtures/sefazCalls_${key}`).set({ count: FieldValue.increment(1) }, { merge: true });
      const fixture = await db.doc(`emulatorFixtures/sefaz_${key}`).get();
      const delayMs = Number(fixture.get('delayMs') ?? 0);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      if (fixture.exists) page = readNfcePage(url, fixture.get('html') as string);
      else if (process.env.SEFAZ_EMULATOR_NETWORK === 'true') page = readNfcePage(url, (await fetchNfce(url)).html);
      else throw new NfceError('network', 'Sem página fictícia da nota no emulador.');
    } else {
      page = readNfcePage(url, (await fetchNfce(url)).html);
    }
    if (page.result.key !== key) throw new NfceError('mismatch', 'A chave da nota não confere.');
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

// ---- Uma consulta por nota (`nfceCache/{chave}`, só Functions) ----
// Quem chega primeiro toma o marcador "em consulta" numa transação; quem chega
// durante a consulta espera o resultado dela (até o marcador ficar abandonado,
// 40 s) em vez de consultar. O resultado conferido fica 30 dias.

function cacheRef(key: string): DocumentReference {
  return db.doc(`nfceCache/${key}`);
}

type CacheSnapshot = CacheState & { items?: NfceItems | null };

function toCacheState(data: DocumentData | undefined): CacheSnapshot | null {
  if (!data) return null;
  const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : undefined);
  return {
    state: data.state as CacheState['state'],
    startedAt: ms(data.startedAt),
    expireAt: ms(data.expireAt),
    result: (data.result as CachedResult | undefined) ?? null,
    items: (data.items as NfceItems | null | undefined) ?? null,
  };
}

/** Lê o registro da nota (sem tomar nada). */
async function peekCache(key: string): Promise<CacheSnapshot | null> {
  return toCacheState((await cacheRef(key).get()).data());
}

/**
 * Numa transação: resultado válido ('cached'), outra consulta em andamento
 * ('wait') ou a vez desta chamada ('consult', com o marcador já gravado).
 */
async function takeTurn(key: string): Promise<{ decision: 'cached' | 'wait' | 'consult'; doc: CacheSnapshot | null }> {
  return db.runTransaction(async (tx) => {
    const doc = toCacheState((await tx.get(cacheRef(key))).data());
    const decision = cacheDecision(doc, Date.now());
    if (decision === 'consult') {
      tx.set(cacheRef(key), {
        state: 'running',
        startedAt: Timestamp.now(),
        expireAt: Timestamp.fromMillis(Date.now() + CACHE_TTL_MS),
      });
    }
    return { decision, doc };
  });
}

/** Espera a consulta em andamento terminar (ou o marcador ficar abandonado, ou `maxWaitMs`). */
async function awaitResult(key: string, first: CacheSnapshot, maxWaitMs: number): Promise<CacheSnapshot | null> {
  const until = Math.min(waitDeadline(first, Date.now()), Date.now() + maxWaitMs);
  let doc: CacheSnapshot | null = first;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    doc = await peekCache(key);
    if (cacheDecision(doc, Date.now()) !== 'wait') return doc;
  }
  return doc;
}

/**
 * Grava o resultado da consulta. Conferida: tenta duas vezes e devolve se
 * gravou (a `resolveNfce` só responde "ok" com o resultado guardado, para o
 * gatilho encontrá-lo). Falha: uma vez, sem insistir.
 */
async function storeResult(key: string, page: { result: NfceResult; items: NfceItems | null } | null): Promise<boolean> {
  const data = page
    ? {
        state: 'ok',
        result: { issuerName: page.result.issuerName, totalCents: page.result.totalCents, date: page.result.date },
        items: page.items,
        fetchedAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + CACHE_TTL_MS),
      }
    : { state: 'failed', fetchedAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + CACHE_TTL_MS) };
  for (let attempt = 1; attempt <= (page ? 2 : 1); attempt++) {
    try {
      // Testes: simula a falha ao gravar o resultado.
      if (emulator() && (await db.doc(`emulatorFixtures/sefaz_${key}`).get()).get('failCacheWrites') === true) {
        throw new Error('gravação do resultado recusada (teste)');
      }
      await cacheRef(key).set(data);
      return true;
    } catch (err) {
      logger.warn('Resultado da nota não guardado', { attempt, err: String(err) });
    }
  }
  return false;
}

interface Consulted {
  result: CachedResult;
  items: NfceItems | null;
  /** Veio do registro (sem consulta à SEFAZ). */
  fromCache: boolean;
  /** O resultado ficou guardado para o gatilho. */
  stored: boolean;
}

/**
 * A nota pelo registro ou, na vez desta chamada, uma consulta à SEFAZ (uma
 * por nota, mesmo com chamadas simultâneas). Quem espera outra consulta e ela
 * falha recebe a falha dela, sem consultar de novo.
 */
async function consultOnce(
  url: string,
  key: string,
  origin: 'resolveNfce' | 'checkNfce' | 'retryNfce',
  maxWaitMs: number,
): Promise<Consulted> {
  let turn = await takeTurn(key);
  if (turn.decision === 'wait' && turn.doc) {
    const after = await awaitResult(key, turn.doc, maxWaitMs);
    if (cacheDecision(after, Date.now()) === 'cached' && after?.result) {
      return { result: after.result, items: after.items ?? null, fromCache: true, stored: true };
    }
    if (after?.state === 'failed') throw new NfceError('blocked', 'A consulta desta nota feita agora há pouco não deu certo.');
    // Ainda em andamento (esgotou `maxWaitMs`) ou abandonado no meio da espera.
    turn = await takeTurn(key);
    if (turn.decision !== 'consult') throw new NfceError('network', 'A consulta desta nota ainda está em andamento.');
  }
  if (turn.decision === 'cached' && turn.doc?.result) {
    return { result: turn.doc.result, items: turn.doc.items ?? null, fromCache: true, stored: true };
  }
  let page: { result: NfceResult; items: NfceItems | null };
  try {
    page = await consultSefaz(url, key, origin);
  } catch (err) {
    await storeResult(key, null);
    throw err;
  }
  const stored = await storeResult(key, page);
  const { issuerName, totalCents, date } = page.result;
  return { result: { issuerName, totalCents, date }, items: page.items, fromCache: false, stored };
}

/** `approval.byUid` quando quem confirma é a conferência da nota, não uma pessoa. */
export const NFCE_APPROVER = 'nfce';

/**
 * Pré-preenchimento: o app manda a URL do QR (online) e recebe valor, data e
 * emitente. Nota já conferida (o mesmo QR lido de novo): o resultado guardado,
 * sem consultar. Senão, uma tentativa (ou a espera de outra em andamento para a
 * mesma nota). Só responde "ok" depois de guardar o resultado (com os itens),
 * para o gatilho gravar "conferida" sem consultar de novo; sem conseguir
 * guardar, responde falha (o app segue para a leitura no aparelho ou o plano B).
 * Os itens da resposta são os guardados: o formulário mostra exatamente os que
 * o gatilho vai gravar.
 */
export const resolveNfce = onCall({ timeoutSeconds: 30 }, async (request): Promise<NfceResult & { items: NfceItems | null }> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre com sua conta Google primeiro.');
  const url = typeof request.data?.url === 'string' ? request.data.url : '';
  try {
    const key = parseNfceQr(url).key;
    const answer = (r: CachedResult, items: NfceItems | null | undefined) => ({ key, issuerCnpj: key.slice(6, 20), ...r, items: items ?? null });
    const cached = await peekCache(key);
    if (cacheDecision(cached, Date.now()) === 'cached' && cached?.result) return answer(cached.result, cached.items);
    if (!(await sefazEnabled())) throw new NfceError('blocked', 'A consulta automática da SEFAZ está desligada.');
    const consulted = await consultOnce(url, key, 'resolveNfce', 20_000);
    if (!consulted.stored) throw new NfceError('network', 'A nota foi lida, mas o resultado não ficou guardado.');
    return answer(consulted.result, consulted.items);
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
 * - consulta do formulário ainda em andamento (marcador com menos de 40 s):
 *   espera o resultado dela, sem consultar;
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
    const cached = await peekCache(receipt.nfceKey);
    const decision = cacheDecision(cached, Date.now());
    if (decision === 'cached' && cached?.result) {
      update = { nfceStatus: 'ok', nfceData: cached.result };
      items = cached.items ?? null;
    } else if (decision !== 'wait' && !(await sefazEnabled())) {
      update = { nfceStatus: 'unchecked' };
    } else {
      try {
        if (!receipt.nfceUrl) throw new NfceError('not_sp', 'Nota sem URL de consulta.');
        // Espera a consulta do formulário em andamento até o marcador ficar abandonado (40 s).
        const consulted = await consultOnce(receipt.nfceUrl, receipt.nfceKey, 'checkNfce', RUNNING_STALE_MS);
        items = consulted.items;
        update = { nfceStatus: 'ok', nfceData: consulted.result };
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
 * para uma NFC-e de SP ainda não conferida, no máximo uma por minuto
 * por nota (contada aqui, numa transação: vale para toques rápidos e para
 * outro aparelho). Antes de tudo, o resultado já guardado da nota (lida pelo
 * servidor no formulário): grava `ok` e os itens sem consultar e sem gastar a
 * tentativa. Deu certo: grava `ok`, os dados e os itens oficiais.
 * Falhou: devolve o motivo e quando tentar de novo (no Android, o app oferece
 * abrir a nota no aparelho, uma vez). Nunca em mês fechado.
 */
export const retryNfce = onCall(
  { timeoutSeconds: 60 },
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

    const installment = expense.get('installment') as { seriesId: string } | undefined;
    const owner = installment ? db.doc(`groups/${groupId}/expenses/${installment.seriesId}`) : expense.ref;
    const apply = async (consulted: { result: CachedResult; items: NfceItems | null }) => {
      await applyResult(groupId, owner, receipt.nfceKey, installment?.seriesId ?? null, { nfceStatus: 'ok', nfceData: consulted.result }, false);
      await saveItems(groupId, receipt.nfceKey, consulted.items, 'retryNfce');
    };

    // Resultado já guardado (a nota foi lida pelo servidor no formulário): sem consulta e sem gastar a tentativa.
    const cached = await peekCache(receipt.nfceKey);
    if (cacheDecision(cached, Date.now()) === 'cached' && cached?.result) {
      await apply({ result: cached.result, items: cached.items ?? null });
      return { ok: true, retryAt: 0 };
    }

    // Limite: uma tentativa por minuto por nota, numa transação.
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
    try {
      await apply(await consultOnce(receipt.nfceUrl, receipt.nfceKey, 'retryNfce', 20_000));
      return { ok: true, retryAt: window.retryAt };
    } catch (err) {
      return { ok: false, reason: err instanceof NfceError ? err.reason : 'unknown', retryAt: window.retryAt };
    }
  },
);
