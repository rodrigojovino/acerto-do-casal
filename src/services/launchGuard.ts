import { doc, getDocFromCache, getDocFromServer } from 'firebase/firestore';
import { createStore, del, entries, set } from 'idb-keyval';
import { readonly, ref, watch } from 'vue';
import { launchState } from '@/domain/launches';
import type { ExpenseInput, InstallmentChoice } from './expenseData';
import { db } from './firebase';
import { serverUsedByOther } from './fiscalKeys';
import { group } from './session';
import { isOnline } from './sync';

/**
 * Lançamentos novos guardados no aparelho (IndexedDB) até o servidor
 * confirmar. Se o mês fechou enquanto o gasto estava offline, as regras
 * recusam a gravação: o app mostra o gasto (descrição, valor, data) com
 * "Lançar no mês aberto". Se a recusa foi porque a nota fiscal já tinha sido
 * lançada (pelo outro membro, por exemplo), mostra o gasto que tem a nota e
 * não oferece relançar. Sobrevive a fechar e reabrir o app.
 */

export interface GuardedLaunch {
  groupId: string;
  /** Id do gasto (ou da série, na compra parcelada). */
  expenseId: string;
  kind: 'single' | 'series';
  input: ExpenseInput;
  installment?: InstallmentChoice;
  /** Cópia da foto do comprovante (a fila de fotos descarta a do gasto recusado). */
  photo?: Blob;
  savedAt: number;
}

const store = createStore('acerto-lancamentos', 'aguardando-servidor');
const keyOf = (groupId: string, expenseId: string) => `${groupId}/${expenseId}`;

/** Gasto que já tinha a nota fiscal do lançamento recusado. */
export interface DuplicateOf {
  expenseId: string;
  description: string;
  totalCents: number;
  date: string;
  createdBy: string;
  installment?: { purchaseCents: number };
}

export interface RejectedLaunch extends GuardedLaunch {
  /** Recusado por nota já lançada (sem relançar); ausente: mês fechado. */
  duplicateOf?: DuplicateOf;
}

const rejected = ref<RejectedLaunch[]>([]);
/** Lançamentos recusados pelas regras na sincronização (deste aparelho). */
export const rejectedLaunches = readonly(rejected);

/** Guarda o lançamento até a confirmação do servidor. */
export function rememberLaunch(launch: Omit<GuardedLaunch, 'savedAt'>): void {
  void set(keyOf(launch.groupId, launch.expenseId), { ...launch, savedAt: Date.now() } satisfies GuardedLaunch, store).catch(
    () => undefined,
  );
}

/** Esquece o lançamento (confirmado, excluído por quem lançou, relançado ou descartado). */
export async function forgetLaunch(groupId: string, expenseId: string): Promise<void> {
  await del(keyOf(groupId, expenseId), store).catch(() => undefined);
  rejected.value = rejected.value.filter((l) => !(l.groupId === groupId && l.expenseId === expenseId));
}

let checking: Promise<void> | null = null;

/** Confere os lançamentos guardados do grupo atual (só com conexão decide recusa). */
export function checkLaunches(): Promise<void> {
  if (checking) return checking;
  checking = (async () => {
    try {
      const groupId = group.value?.id;
      if (!groupId) return;
      const all = (await entries<string, GuardedLaunch>(store).catch(() => [])).map(([, l]) => l).filter((l) => l.groupId === groupId);
      const found: RejectedLaunch[] = [];
      for (const launch of all) {
        const ref = doc(db, 'groups', groupId, 'expenses', launch.expenseId);
        let onServer: boolean | null = null;
        if (isOnline.value) onServer = await getDocFromServer(ref).then((s) => s.exists(), () => null);
        const cached = await getDocFromCache(ref).catch(() => null);
        const state = launchState({ onServer, pendingInCache: !!cached?.exists() && cached.metadata.hasPendingWrites });
        if (state === 'confirmed') await del(keyOf(groupId, launch.expenseId), store).catch(() => undefined);
        else if (state === 'rejected') found.push({ ...launch, duplicateOf: await duplicateOf(groupId, launch) });
      }
      rejected.value = found.sort((a, b) => a.savedAt - b.savedAt);
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/**
 * Lançamento recusado com nota fiscal: o gasto que já tem a nota no servidor,
 * se houver (senão a recusa foi pelo mês fechado).
 */
async function duplicateOf(groupId: string, launch: GuardedLaunch): Promise<DuplicateOf | undefined> {
  const receipt = launch.input.receipt;
  if (receipt.type !== 'nfce') return undefined;
  const entry = await serverUsedByOther(groupId, receipt.nfceKey, launch.expenseId);
  if (!entry) return undefined;
  const snap = await getDocFromServer(doc(db, 'groups', groupId, 'expenses', entry.expenseId)).catch(() => null);
  const d = snap?.data();
  // Sem acesso ao gasto (excluído no meio do caminho): só o essencial.
  return {
    expenseId: entry.expenseId,
    description: d?.description ?? 'outro gasto',
    totalCents: d?.totalCents ?? 0,
    date: d?.date ?? '',
    createdBy: entry.createdBy,
    installment: d?.installment,
  };
}

/** Depois de uma recusa na sincronização: dá tempo ao cache de descartar a gravação. */
export function checkLaunchesSoon(): void {
  setTimeout(() => void checkLaunches(), 1500);
}

// Ao abrir o app (com o grupo carregado), quando a conexão volta e a cada minuto.
watch(
  () => group.value?.id,
  (groupId) => {
    rejected.value = [];
    if (groupId) void checkLaunches();
  },
  { immediate: true },
);
watch(isOnline, (online) => {
  if (online) void checkLaunches();
});
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    if (isOnline.value && group.value) void checkLaunches();
  }, 60_000);
}
