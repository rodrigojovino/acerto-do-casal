import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore';
import { readonly, ref, watch } from 'vue';
import type { NoticeCategory } from '@/domain/notifications';
import { db } from './firebase';
import { user } from './session';
import { trackWrite } from './sync';

/** Preferências de aviso de quem está logado (ausente = ligado). Funciona offline. */

export type NotificationPrefs = Partial<Record<NoticeCategory, boolean>>;

const prefs = ref<NotificationPrefs>({});
export const notificationPrefs = readonly(prefs);

let stop: Unsubscribe | null = null;
watch(
  () => user.value?.uid ?? null,
  (uid) => {
    stop?.();
    stop = null;
    prefs.value = {};
    if (!uid) return;
    stop = onSnapshot(
      doc(db, 'users', uid),
      (snap) => (prefs.value = (snap.get('notificationPrefs') as NotificationPrefs | undefined) ?? {}),
      () => undefined,
    );
  },
  { immediate: true },
);

export const isCategoryOn = (category: NoticeCategory) => prefs.value[category] !== false;

export function setCategory(category: NoticeCategory, on: boolean): void {
  const uid = user.value?.uid;
  if (!uid) return;
  trackWrite(
    setDoc(doc(db, 'users', uid), { notificationPrefs: { [category]: on } }, { merge: true }),
    'Não foi possível salvar a preferência de aviso.',
  );
}
