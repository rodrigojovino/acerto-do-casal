import { collection, doc, onSnapshot, serverTimestamp, updateDoc, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { readonly, ref, watch } from 'vue';
import { nextCategoryOrder, reorderCategories, type Category } from '@/domain/categories';
import {
  categoryActiveData,
  categoryOrderData,
  categoryRenameData,
  newCategoryData,
  requireCategoryData,
} from './categoryData';
import { db } from './firebase';
import { group, user } from './session';
import { trackWrite } from './sync';

/**
 * Categorias do grupo, acompanhadas em segundo plano enquanto há grupo (do
 * cache offline também), para a janela de escolha abrir na hora. Gravações
 * sem esperar o servidor (`trackWrite`).
 */

const list = ref<Category[]>([]);
export const categories = readonly(list);

const col = (groupId: string) => collection(db, 'groups', groupId, 'categories');

let stop: Unsubscribe | null = null;
watch(
  () => group.value?.id,
  (groupId) => {
    stop?.();
    stop = null;
    list.value = [];
    if (!groupId) return;
    stop = onSnapshot(
      col(groupId),
      (snap) => {
        list.value = snap.docs.map((d) => ({
          id: d.id,
          name: String(d.get('name') ?? ''),
          active: d.get('active') !== false,
          order: typeof d.get('order') === 'number' ? (d.get('order') as number) : 0,
        }));
      },
      () => undefined,
    );
  },
  { immediate: true },
);

function current(): { groupId: string; uid: string } | null {
  const groupId = group.value?.id;
  const uid = user.value?.uid;
  return groupId && uid ? { groupId, uid } : null;
}

/** Cria uma categoria no fim da lista e devolve o id (já usável no gasto, mesmo offline). */
export function createCategory(name: string): string | null {
  const c = current();
  if (!c) return null;
  const ref = doc(col(c.groupId));
  const batch = writeBatch(db).set(ref, newCategoryData(name, nextCategoryOrder(list.value), c.uid, serverTimestamp()));
  trackWrite(batch.commit(), 'Não foi possível criar a categoria.');
  return ref.id;
}

/** Lista sugerida: as escolhidas, no fim da lista e na ordem em que vieram, num lote. */
export function createCategories(names: readonly string[]): void {
  const c = current();
  if (!c || names.length === 0) return;
  const batch = writeBatch(db);
  const start = nextCategoryOrder(list.value);
  names.forEach((name, i) => batch.set(doc(col(c.groupId)), newCategoryData(name, start + i, c.uid, serverTimestamp())));
  trackWrite(batch.commit(), 'Não foi possível criar as categorias.');
}

export function renameCategory(id: string, name: string): void {
  const c = current();
  if (!c) return;
  trackWrite(updateDoc(doc(col(c.groupId), id), categoryRenameData(name, serverTimestamp())), 'Não foi possível renomear a categoria.');
}

export function setCategoryActive(id: string, active: boolean): void {
  const c = current();
  if (!c) return;
  const failure = active ? 'Não foi possível reativar a categoria.' : 'Não foi possível desativar a categoria.';
  // Reativada, volta para o fim das ativas.
  const data = active
    ? { ...categoryActiveData(true, serverTimestamp()), order: nextCategoryOrder(list.value) }
    : categoryActiveData(false, serverTimestamp());
  trackWrite(updateDoc(doc(col(c.groupId), id), data), failure);
}

/** Move uma ativa de `from` para `to` (índices entre as ativas); grava as posições que mudam num lote. */
export function moveCategory(from: number, to: number): void {
  const c = current();
  if (!c) return;
  const changes = reorderCategories(list.value, from, to);
  if (changes.length === 0) return;
  const batch = writeBatch(db);
  for (const ch of changes) batch.update(doc(col(c.groupId), ch.id), categoryOrderData(ch.order, serverTimestamp()));
  // Mostra a nova ordem já (offline, o snapshot local também chega, mas sem piscar).
  list.value = list.value.map((cat) => {
    const ch = changes.find((x) => x.id === cat.id);
    return ch ? { ...cat, order: ch.order } : cat;
  });
  trackWrite(batch.commit(), 'Não foi possível salvar a nova ordem das categorias.');
}

/** "Exigir categoria nos gastos" (vale para os dois). */
export function setRequireCategory(on: boolean): void {
  const c = current();
  if (!c) return;
  trackWrite(updateDoc(doc(db, 'groups', c.groupId), requireCategoryData(on)), 'Não foi possível salvar a exigência de categoria.');
}
