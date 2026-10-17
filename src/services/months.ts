import { collection, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { readonly, ref, shallowRef, watch } from 'vue';
import type { Competence } from '@/domain/settlement';
import { db } from './firebase';
import { group } from './session';

/**
 * Meses fechados do grupo, em tempo real e do cache offline.
 * Mês sem documento = aberto.
 */
const closed = shallowRef<ReadonlySet<Competence>>(new Set());
const loaded = ref(false);
let stop: Unsubscribe | null = null;

watch(
  () => group.value?.id ?? null,
  (groupId) => {
    stop?.();
    stop = null;
    closed.value = new Set();
    loaded.value = false;
    if (!groupId) return;
    const q = query(collection(db, 'groups', groupId, 'months'), where('status', '==', 'closed'));
    stop = onSnapshot(
      q,
      (snap) => {
        closed.value = new Set(snap.docs.map((d) => d.id));
        loaded.value = true;
      },
      () => (loaded.value = true),
    );
  },
  { immediate: true },
);

export const closedMonths = readonly(closed);
export const closedMonthsLoaded = readonly(loaded);
