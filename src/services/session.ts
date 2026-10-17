import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot, type Timestamp, type Unsubscribe } from 'firebase/firestore';
import { computed, readonly, ref } from 'vue';
import { auth, db } from './firebase';

export interface Group {
  id: string;
  members: string[];
  memberNames: Record<string, string>;
  defaultSplitPct: number;
  /** Código sem hífen (`K7Q4M2`) enquanto o grupo espera o segundo membro. */
  inviteCode: string | null;
  inviteExpiresAt: Timestamp | null;
}

/**
 * - `signedOut`: sem login → Entrada
 * - `noGroup`: logado, sem grupo → Vínculo
 * - `waitingPartner`: grupo criado, esperando o outro entrar → Vínculo (mostra o código)
 * - `linked`: casal vinculado → Painel
 */
export type SessionStatus = 'signedOut' | 'noGroup' | 'waitingPartner' | 'linked';

const currentUser = ref<User | null>(null);
const currentGroup = ref<Group | null>(null);
const loaded = ref(false);

let stopMembership: Unsubscribe | null = null;
let stopGroup: Unsubscribe | null = null;
let readyWaiters: Array<() => void> = [];

function markLoaded(): void {
  loaded.value = true;
  readyWaiters.forEach((resolve) => resolve());
  readyWaiters = [];
}

function stopListeners(): void {
  stopMembership?.();
  stopGroup?.();
  stopMembership = null;
  stopGroup = null;
  currentGroup.value = null;
}

function watchGroup(groupId: string): void {
  stopGroup?.();
  stopGroup = onSnapshot(
    doc(db, 'groups', groupId),
    (snap) => {
      currentGroup.value = snap.exists() ? ({ id: snap.id, ...snap.data() } as Group) : null;
      markLoaded();
    },
    () => {
      // Sem permissão: o vínculo mudou e ainda não chegou aqui.
      currentGroup.value = null;
      markLoaded();
    },
  );
}

// O Firebase restaura a sessão salva de forma assíncrona. Com alguém logado,
// segue o vínculo (memberships/{uid}) e, a partir dele, o documento do grupo.
// Os dois vêm do cache offline quando não há conexão.
onAuthStateChanged(auth, (user) => {
  stopListeners();
  currentUser.value = user;
  if (!user) {
    markLoaded();
    return;
  }
  loaded.value = false;
  stopMembership = onSnapshot(
    doc(db, 'memberships', user.uid),
    (snap) => {
      const groupId = snap.exists() ? (snap.get('groupId') as string) : null;
      if (groupId && groupId !== currentGroup.value?.id) {
        watchGroup(groupId);
      } else if (!groupId) {
        stopGroup?.();
        stopGroup = null;
        currentGroup.value = null;
        markLoaded();
      }
    },
    () => markLoaded(),
  );
});

export const user = readonly(currentUser);
export const group = readonly(currentGroup);

export const status = computed<SessionStatus>(() => {
  if (!currentUser.value) return 'signedOut';
  const g = currentGroup.value;
  if (!g) return 'noGroup';
  return g.members.length >= 2 ? 'linked' : 'waitingPartner';
});

/** Nome da outra pessoa do casal, quando vinculado. */
export const partnerName = computed(() => {
  const g = currentGroup.value;
  const uid = currentUser.value?.uid;
  if (!g || !uid) return null;
  const other = g.members.find((m) => m !== uid);
  return other ? (g.memberNames[other] ?? null) : null;
});

/** Resolve quando login e grupo já são conhecidos (para a guarda de rota). */
export function sessionReady(): Promise<void> {
  if (loaded.value) return Promise.resolve();
  return new Promise((resolve) => readyWaiters.push(resolve));
}
