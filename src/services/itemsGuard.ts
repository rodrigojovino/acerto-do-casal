import { doc, getDocFromCache, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { createStore, del, entries, set } from 'idb-keyval';
import { computed, shallowRef, watch } from 'vue';
import { launchState } from '@/domain/launches';
import { db } from './firebase';
import { deviceItemsData, type DeviceItemsRead } from './nfceItemsData';
import { group } from './session';
import { isOnline, trackWrite } from './sync';

/**
 * Itens da NFC-e lidos no aparelho, guardados no aparelho (IndexedDB) até o
 * servidor confirmar que estão gravados. Se a gravação for recusada pelas
 * regras ou se perder, o app avisa ("Os itens lidos da nota não foram
 * gravados") e oferece gravar de novo a partir desta cópia, sem consultar a
 * SEFAZ outra vez. Sobrevive a fechar e reabrir o app.
 */

export interface GuardedItems extends DeviceItemsRead {
  groupId: string;
  /** Gasto (ou série) que leva a nota, para o aviso e para não duplicar com o lançamento recusado. */
  expenseId: string;
  /** Descrição curta do gasto, para o aviso. */
  label: string;
  savedAt: number;
}

const store = createStore('acerto-itens-nota', 'aguardando-servidor');
const keyOf = (groupId: string, key: string) => `${groupId}/${key}`;

const rejected = shallowRef<GuardedItems[]>([]);
/** Itens lidos no aparelho que o servidor não tem (recusados ou perdidos). */
export const rejectedItems = computed<readonly GuardedItems[]>(() => rejected.value);

/** Guarda os itens até a confirmação do servidor. */
export function rememberItems(record: Omit<GuardedItems, 'savedAt'>): void {
  void set(keyOf(record.groupId, record.key), { ...record, savedAt: Date.now() } satisfies GuardedItems, store).catch(() => undefined);
}

/** Esquece os itens (confirmados, descartados ou o gasto foi descartado). */
export async function forgetItems(groupId: string, key: string): Promise<void> {
  await del(keyOf(groupId, key), store).catch(() => undefined);
  rejected.value = rejected.value.filter((r) => !(r.groupId === groupId && r.key === key));
}

let checking: Promise<void> | null = null;

/** Confere os itens guardados do grupo atual (só com conexão decide recusa). */
export function checkItems(): Promise<void> {
  if (checking) return checking;
  checking = (async () => {
    try {
      const groupId = group.value?.id;
      if (!groupId) return;
      const all = (await entries<string, GuardedItems>(store).catch(() => [])).map(([, r]) => r).filter((r) => r.groupId === groupId);
      const found: GuardedItems[] = [];
      for (const record of all) {
        const ref = doc(db, 'groups', groupId, 'nfceItems', record.key);
        let onServer: boolean | null = null;
        if (isOnline.value) onServer = await getDocFromServer(ref).then((s) => s.exists(), () => null);
        const cached = await getDocFromCache(ref).catch(() => null);
        const state = launchState({ onServer, pendingInCache: !!cached?.exists() && cached.metadata.hasPendingWrites });
        if (state === 'confirmed') await del(keyOf(groupId, record.key), store).catch(() => undefined);
        else if (state === 'rejected') found.push(record);
      }
      rejected.value = found.sort((a, b) => a.savedAt - b.savedAt);
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** Depois de uma recusa: dá tempo ao cache de descartar a gravação. */
export function checkItemsSoon(): void {
  setTimeout(() => void checkItems(), 1500);
}

/**
 * Grava de novo os itens guardados, sozinhos (sem consultar a SEFAZ). Vale
 * quando o gasto com a nota já está no servidor; recusado de novo, o aviso volta.
 */
export function saveItemsAgain(record: GuardedItems): void {
  saveItemsAlone(record.groupId, record, record.expenseId, record.label);
}

/**
 * Grava itens lidos no aparelho fora do lote de um gasto (nova tentativa no
 * Detalhe, com o gasto já salvo), guardando a cópia até o servidor confirmar.
 */
export function saveItemsAlone(groupId: string, read: DeviceItemsRead, expenseId: string, label: string): void {
  rememberItems({ groupId, key: read.key, items: read.items, page: read.page, expenseId, label });
  rejected.value = rejected.value.filter((r) => !(r.groupId === groupId && r.key === read.key));
  trackWrite(
    setDoc(doc(db, 'groups', groupId, 'nfceItems', read.key), deviceItemsData(read, serverTimestamp())),
    `Os itens lidos da nota de ${label} não foram gravados.`,
    checkItemsSoon,
  );
}

// Ao abrir o app (com o grupo carregado), quando a conexão volta e a cada minuto.
watch(
  () => group.value?.id,
  (groupId) => {
    rejected.value = [];
    if (groupId) void checkItems();
  },
  { immediate: true },
);
watch(isOnline, (online) => {
  if (online) void checkItems();
});
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    if (isOnline.value && group.value) void checkItems();
  }, 60_000);
}
