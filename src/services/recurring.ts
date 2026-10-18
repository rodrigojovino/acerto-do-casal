import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Recurring, RecurringTerms } from '@/domain/recurrence';
import { db } from './firebase';
import {
  newRecurringData,
  recurringApprovalData,
  recurringDeactivateData,
  recurringRejectionData,
  recurringUpdateData,
  type RecurringInput,
} from './recurringData';
import { trackWrite } from './sync';

export type { RecurringInput } from './recurringData';

export interface RecurringDoc extends Recurring {
  createdBy: string;
  approval?: { byUid: string; at: Date | null };
  rejection?: { byUid: string; reason?: string; at: Date | null };
  proposal?: RecurringTerms & { at: Date | null };
  pendingWrite: boolean;
}

/** Reajuste aguardando aprovação (cadastro ativo e já aprovado). */
export const hasPendingAdjustment = (r: Pick<RecurringDoc, 'active' | 'status' | 'proposal'>): boolean =>
  r.active && r.status === 'approved' && !!r.proposal;

/** Precisa da aprovação do outro membro: fixo novo pendente ou reajuste. */
export const awaitsApproval = (r: Pick<RecurringDoc, 'active' | 'status' | 'proposal'>): boolean =>
  r.active && (r.status === 'pending_approval' || hasPendingAdjustment(r));

const recurringCol = (groupId: string) => collection(db, 'groups', groupId, 'recurring');
const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);

/** Contas recorrentes do grupo, em tempo real (inclusive do cache offline). */
export function watchRecurring(
  groupId: string,
  onChange: (list: RecurringDoc[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    recurringCol(groupId),
    { includeMetadataChanges: true },
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data({ serverTimestamps: 'estimate' });
        return {
          ...(data as Omit<RecurringDoc, 'id' | 'pendingWrite'>),
          id: d.id,
          approval: data.approval ? { byUid: data.approval.byUid, at: toDate(data.approval.at) } : undefined,
          rejection: data.rejection
            ? { byUid: data.rejection.byUid, reason: data.rejection.reason, at: toDate(data.rejection.at) }
            : undefined,
          proposal: data.proposal ? { ...data.proposal, at: toDate(data.proposal.at) } : undefined,
          pendingWrite: d.metadata.hasPendingWrites,
        } as RecurringDoc;
      });
      list.sort((a, b) => Number(b.active) - Number(a.active) || a.dayOfMonth - b.dayOfMonth);
      onChange(list);
    },
    onError,
  );
}

/** Gravações sem esperar o servidor (funcionam offline). */
export function createRecurring(groupId: string, input: RecurringInput, uid: string): string {
  const ref = doc(recurringCol(groupId));
  trackWrite(setDoc(ref, newRecurringData(input, uid, serverTimestamp())), 'Não foi possível salvar a conta recorrente.');
  return ref.id;
}

export function updateRecurring(groupId: string, current: RecurringDoc, input: RecurringInput, active: boolean): void {
  trackWrite(
    updateDoc(doc(recurringCol(groupId), current.id), recurringUpdateData(input, current, active, serverTimestamp(), deleteField())),
    'Não foi possível salvar a conta recorrente.',
  );
}

/** Aprova o cadastro novo ou o reajuste pendente. */
export function approveRecurring(groupId: string, current: RecurringDoc, uid: string): void {
  trackWrite(
    updateDoc(doc(recurringCol(groupId), current.id), recurringApprovalData(current, uid, serverTimestamp(), deleteField())),
    'Não foi possível aprovar.',
  );
}

/** Recusa o cadastro novo ou o reajuste pendente (a versão aprovada continua). */
export function rejectRecurring(groupId: string, current: RecurringDoc, uid: string, reason?: string): void {
  trackWrite(
    updateDoc(doc(recurringCol(groupId), current.id), recurringRejectionData(current, uid, reason, serverTimestamp(), deleteField())),
    'Não foi possível recusar.',
  );
}

export function deactivateRecurring(groupId: string, id: string): void {
  trackWrite(updateDoc(doc(recurringCol(groupId), id), recurringDeactivateData(serverTimestamp())), 'Não foi possível desativar.');
}

/** Excluir o cadastro não apaga os gastos já gerados. */
export function deleteRecurring(groupId: string, id: string): void {
  trackWrite(deleteDoc(doc(recurringCol(groupId), id)), 'Não foi possível excluir a conta recorrente.');
}
