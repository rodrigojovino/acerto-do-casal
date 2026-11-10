import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { computed, shallowRef, watch } from 'vue';
import { formatBRL } from '@/domain/money';
import { RETRY_COOLDOWN_MS } from '../../functions/src/nfceRetry';
import type { NfceItem, NfceItems } from '../../functions/src/nfce';
import { db } from './firebase';
import { group } from './session';

/**
 * Itens das NFC-e de SP conferidas (`groups/{g}/nfceItems/{chave}`), em tempo
 * real. O acompanhamento fica ligado em segundo plano para os itens estarem
 * no cache local: a lista abre offline mesmo sem ter sido aberta antes.
 */

/**
 * Itens gravados: oficiais (`source` 'checkNfce', 'retryNfce' ou 'backfill',
 * lidos pelo servidor) ou lidos no aparelho ('device', quando o servidor
 * falhou e a página da nota abriu no app), com o emitente e a data da página.
 */
export type StoredNfceItems = NfceItems & { source?: string; issuerName?: string; date?: string };

/** Itens lidos no aparelho: sem conferência da SEFAZ (a tela sempre avisa). */
export const isDeviceItems = (items: Pick<StoredNfceItems, 'source'> | null | undefined): boolean => items?.source === 'device';

const byKey = shallowRef<ReadonlyMap<string, StoredNfceItems>>(new Map());
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
      (snap) => (byKey.value = new Map(snap.docs.map((d) => [d.id, d.data() as StoredNfceItems]))),
      () => undefined,
    );
  },
  { immediate: true },
);

/** Itens por chave da nota (só das notas com itens lidos). */
export const nfceItemsByKey = computed<ReadonlyMap<string, StoredNfceItems>>(() => byKey.value);

const quantityFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

/** "2 UN × R$ 25,90 = R$ 51,80"; quantidade fracionada com vírgula ("1,535 KG"). */
export function itemLine(item: Pick<NfceItem, 'quantity' | 'unit' | 'unitPrice' | 'totalCents'>): string {
  return `${quantityFormat.format(item.quantity)} ${item.unit} × R$ ${item.unitPrice} = ${formatBRL(item.totalCents)}`;
}

/**
 * Quando a próxima "Tentar conferir de novo" fica liberada para a nota (epoch
 * em ms; 0 = já liberada), pelo registro do limite que o servidor grava
 * (`groups/{g}/nfceRetry/{chave}`): vale para os dois aparelhos.
 */
export function watchNfceRetry(groupId: string, key: string, onChange: (retryAt: number) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'groups', groupId, 'nfceRetry', key),
    (snap) => {
      const last = snap.get('lastAt') as { toMillis(): number } | undefined;
      onChange(last ? last.toMillis() + RETRY_COOLDOWN_MS : 0);
    },
    () => onChange(0),
  );
}
