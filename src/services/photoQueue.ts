import {
  collection,
  doc,
  getDocFromCache,
  getDocFromServer,
  getDocsFromServer,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { createStore, del, entries, set } from 'idb-keyval';
import { readonly, ref, watch } from 'vue';
import { receiptPhotoPath } from '@/domain/image';
import { db, storage } from './firebase';
import { group } from './session';
import { isOnline } from './sync';

/**
 * Fila de fotos de comprovante a enviar. A foto fica no IndexedDB do aparelho
 * até subir para o Storage; funciona offline e sobrevive ao app ser fechado.
 *
 * Ordem: a foto só sobe depois que o gasto existe no servidor (as regras do
 * Storage conferem quem lançou). Depois do envio, o gasto ganha
 * `receipt.photoUploaded: true` e a foto sai da fila.
 */

interface QueuedPhoto {
  groupId: string;
  expenseId: string;
  data: Blob;
  queuedAt: number;
}

const store = createStore('acerto-do-casal', 'fotos-pendentes');
const keyOf = (groupId: string, expenseId: string) => `${groupId}/${expenseId}`;

/** IDs dos gastos com foto ainda no aparelho (para "foto pendente de envio"). */
const pending = ref<ReadonlySet<string>>(new Set());
export const pendingPhotoIds = readonly(pending);

async function refreshPending(): Promise<void> {
  const all = await entries<string, QueuedPhoto>(store);
  pending.value = new Set(all.map(([, item]) => item.expenseId));
}

/** Guarda a foto no aparelho e tenta enviar em seguida. */
export async function queuePhoto(groupId: string, expenseId: string, data: Blob): Promise<void> {
  await set(keyOf(groupId, expenseId), { groupId, expenseId, data, queuedAt: Date.now() } satisfies QueuedPhoto, store);
  await refreshPending();
  void flushPhotoQueue();
}

/** Tira uma foto da fila sem enviar (gasto excluído ou foto trocada). */
export async function discardQueuedPhoto(groupId: string, expenseId: string): Promise<void> {
  await del(keyOf(groupId, expenseId), store);
  await refreshPending();
}

/** URL local da foto ainda não enviada, para pré-visualização. */
export async function queuedPhotoUrl(groupId: string, expenseId: string): Promise<string | null> {
  const all = await entries<string, QueuedPhoto>(store);
  const item = all.find(([key]) => key === keyOf(groupId, expenseId))?.[1];
  return item ? URL.createObjectURL(item.data) : null;
}

type Outcome = 'uploaded' | 'waiting' | 'dropped';

async function uploadOne(item: QueuedPhoto): Promise<Outcome> {
  const expenseRef = doc(db, 'groups', item.groupId, 'expenses', item.expenseId);

  let onServer;
  try {
    onServer = await getDocFromServer(expenseRef);
  } catch {
    return 'waiting'; // sem conexão
  }
  if (!onServer.exists()) {
    // Ainda não sincronizou, ou foi excluído. Se nem o cache local tem, foi excluído.
    const local = await getDocFromCache(expenseRef).catch(() => null);
    return local?.exists() ? 'waiting' : 'dropped';
  }
  const receipt = onServer.get('receipt') as { type?: string; photoPath?: string; photoUploaded?: boolean } | undefined;
  const path = receiptPhotoPath(item.groupId, item.expenseId);
  if (receipt?.type !== 'photo' || receipt.photoPath !== path) return 'dropped'; // foto trocada ou removida

  await uploadBytes(storageRef(storage, path), item.data, { contentType: 'image/jpeg' });
  if (!receipt.photoUploaded) {
    await updateDoc(expenseRef, { 'receipt.photoUploaded': true, updatedAt: serverTimestamp() });
  }
  await markSeriesUploaded(item.groupId, item.expenseId, path);
  return 'uploaded';
}

/**
 * Compra parcelada: a foto é da série (id da parcela 1) e vale para todas as
 * parcelas; marca as outras como enviadas, uma a uma (parcela de mês fechado
 * recusa e fica como está).
 */
async function markSeriesUploaded(groupId: string, seriesId: string, path: string): Promise<void> {
  const parcels = await getDocsFromServer(
    query(collection(db, 'groups', groupId, 'expenses'), where('installment.seriesId', '==', seriesId)),
  );
  await Promise.all(
    parcels.docs
      .filter((d) => {
        const r = d.get('receipt') as { type?: string; photoPath?: string; photoUploaded?: boolean } | undefined;
        return d.id !== seriesId && r?.type === 'photo' && r.photoPath === path && !r.photoUploaded;
      })
      .map((d) => updateDoc(d.ref, { 'receipt.photoUploaded': true, updatedAt: serverTimestamp() }).catch(() => undefined)),
  );
}

let flushing: Promise<void> | null = null;

/** Envia o que estiver na fila. Seguro chamar várias vezes. */
export function flushPhotoQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const all = await entries<string, QueuedPhoto>(store);
      for (const [key, item] of all) {
        try {
          const outcome = await uploadOne(item);
          if (outcome !== 'waiting') await del(key, store);
        } catch {
          // Falha pontual (rede caiu no meio, regra recusou): tenta na próxima rodada.
        }
      }
    } finally {
      await refreshPending();
      flushing = null;
    }
  })();
  return flushing;
}

// Tenta ao abrir o app (com o grupo carregado), quando a conexão volta e a
// cada minuto enquanto houver foto pendente.
watch(
  () => group.value?.id,
  (groupId) => {
    if (groupId) void refreshPending().then(flushPhotoQueue);
  },
  { immediate: true },
);
watch(isOnline, (online) => {
  if (online) void flushPhotoQueue();
});
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    if (pending.value.size > 0 && isOnline.value) void flushPhotoQueue();
  }, 60_000);
}
