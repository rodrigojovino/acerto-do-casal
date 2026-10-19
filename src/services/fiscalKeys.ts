import {
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import { computed, shallowRef, watch } from 'vue';
import { fiscalKeyChange, fiscalKeyData, type StoredReceipt } from './expenseData';
import { db } from './firebase';
import { group } from './session';

/**
 * Registro das notas fiscais já lançadas (`groups/{g}/fiscalKeys/{chave}`),
 * um por chave, apontando para o gasto que a usa (numa série, a parcela 1).
 * As regras exigem o registro no mesmo lote que o gasto, então a mesma nota
 * não entra duas vezes. O acompanhamento fica ligado em segundo plano para o
 * aviso de nota repetida funcionar offline.
 */

export interface FiscalKeyEntry {
  expenseId: string;
  createdBy: string;
}

const byKey = shallowRef<ReadonlyMap<string, FiscalKeyEntry>>(new Map());
let stop: Unsubscribe | null = null;

watch(
  () => group.value?.id ?? null,
  (groupId) => {
    stop?.();
    stop = null;
    byKey.value = new Map();
    if (!groupId) return;
    stop = onSnapshot(
      collection(db, 'groups', groupId, 'fiscalKeys'),
      (snap) => (byKey.value = new Map(snap.docs.map((d) => [d.id, d.data() as FiscalKeyEntry]))),
      () => undefined,
    );
  },
  { immediate: true },
);

export const fiscalKeys = computed<ReadonlyMap<string, FiscalKeyEntry>>(() => byKey.value);

const keyRef = (groupId: string, key: string) => doc(db, 'groups', groupId, 'fiscalKeys', key);

/**
 * Gasto que já usa a nota, se for outro que não `ownerId` (o gasto em edição
 * ou a série). Pelo que o aparelho conhece (inclusive offline).
 */
export function usedByOther(key: string | null | undefined, ownerId?: string): FiscalKeyEntry | null {
  if (!key) return null;
  const entry = byKey.value.get(key);
  return entry && entry.expenseId !== ownerId ? entry : null;
}

/** Consulta no servidor: o gasto que tem a nota, se for outro (para explicar uma recusa). */
export async function serverUsedByOther(groupId: string, key: string, ownerId: string): Promise<FiscalKeyEntry | null> {
  const snap = await getDocFromServer(keyRef(groupId, key)).catch(() => null);
  const entry = snap?.exists() ? (snap.data() as FiscalKeyEntry) : null;
  return entry && entry.expenseId !== ownerId ? entry : null;
}

/**
 * Acrescenta ao lote as mudanças do registro quando o comprovante do gasto
 * `ownerId` muda (criar: `before` ausente; excluir: `after` ausente). A chave
 * antiga só sai se o registro for deste gasto (numa duplicata anterior ao
 * registro, ele é de outro). `canChange`: falso numa série com a parcela 1 em
 * mês fechado, em que a chave fica com a série.
 */
export function applyFiscalKeyChange(
  batch: WriteBatch,
  groupId: string,
  ownerId: string,
  uid: string,
  before: StoredReceipt | undefined,
  after: StoredReceipt | undefined,
  canChange = true,
): void {
  if (!canChange) return;
  const { release, register } = fiscalKeyChange(before, after);
  if (release && byKey.value.get(release)?.expenseId === ownerId) batch.delete(keyRef(groupId, release));
  if (register) batch.set(keyRef(groupId, register), fiscalKeyData(ownerId, uid, serverTimestamp()));
}
