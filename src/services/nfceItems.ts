import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { computed, shallowRef, watch } from 'vue';
import { formatBRL } from '@/domain/money';
import type { NfceItem, NfceItems } from '../../functions/src/nfce';
import { db } from './firebase';
import { group } from './session';

/**
 * Itens das NFC-e de SP conferidas (`groups/{g}/nfceItems/{chave}`), em tempo
 * real. O acompanhamento fica ligado em segundo plano para os itens estarem
 * no cache local: a lista abre offline mesmo sem ter sido aberta antes.
 */

const byKey = shallowRef<ReadonlyMap<string, NfceItems>>(new Map());
let stop: Unsubscribe | null = null;

watch(
  () => group.value?.id ?? null,
  (groupId) => {
    stop?.();
    stop = null;
    byKey.value = new Map();
    if (!groupId) return;
    stop = onSnapshot(
      collection(db, 'groups', groupId, 'nfceItems'),
      (snap) => (byKey.value = new Map(snap.docs.map((d) => [d.id, d.data() as NfceItems]))),
      () => undefined,
    );
  },
  { immediate: true },
);

/** Itens por chave da nota (só das notas com itens lidos). */
export const nfceItemsByKey = computed<ReadonlyMap<string, NfceItems>>(() => byKey.value);

const quantityFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

/** "2 UN × R$ 25,90 = R$ 51,80"; quantidade fracionada com vírgula ("1,535 KG"). */
export function itemLine(item: Pick<NfceItem, 'quantity' | 'unit' | 'unitPrice' | 'totalCents'>): string {
  return `${quantityFormat.format(item.quantity)} ${item.unit} × R$ ${item.unitPrice} = ${formatBRL(item.totalCents)}`;
}
