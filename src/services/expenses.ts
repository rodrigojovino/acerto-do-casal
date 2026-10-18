import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { resolveCompetence, type IsoDate } from '@/domain/calendar';
import type { Competence, ExpenseStatus, SettlementExpense } from '@/domain/settlement';
import { deleteObject, ref as storageRef } from 'firebase/storage';
import { receiptPhotoPath } from '@/domain/image';
import {
  approvalData,
  expenseUpdateData,
  newExpenseData,
  rejectionData,
  type ExpenseInput,
  type StoredReceipt,
} from './expenseData';
import { db, storage } from './firebase';
import { discardQueuedPhoto, queuePhoto } from './photoQueue';
import { trackWrite } from './sync';

export type { ExpenseInput, ReceiptChoice } from './expenseData';

export type Receipt = StoredReceipt;

export interface Approval {
  byUid: string;
  at: Date | null;
}

export interface Rejection {
  byUid: string;
  reason?: string;
  at: Date | null;
}

export interface Expense extends SettlementExpense {
  id: string;
  description: string;
  date: IsoDate;
  competence: Competence;
  receipt: Receipt;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  approval?: Approval;
  rejection?: Rejection;
  /** Gravado no aparelho e ainda não confirmado pelo servidor. */
  pendingWrite: boolean;
}

export interface WriteResult {
  id: string;
  competence: Competence;
}

const expensesCol = (groupId: string) => collection(db, 'groups', groupId, 'expenses');

function toExpense(snap: DocumentSnapshot): Expense {
  // 'estimate': enquanto offline, o horário do servidor vira o horário local.
  const data = snap.data({ serverTimestamps: 'estimate' }) ?? {};
  const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);
  return {
    id: snap.id,
    description: data.description,
    totalCents: data.totalCents,
    personalCents: data.personalCents,
    payerUid: data.payerUid,
    payerSharePct: data.payerSharePct,
    date: data.date,
    competence: data.competence,
    receipt: data.receipt ?? { type: 'none' },
    status: data.status as ExpenseStatus,
    createdBy: data.createdBy,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    approval: data.approval ? { byUid: data.approval.byUid, at: toDate(data.approval.at) } : undefined,
    rejection: data.rejection
      ? { byUid: data.rejection.byUid, reason: data.rejection.reason, at: toDate(data.rejection.at) }
      : undefined,
    pendingWrite: snap.metadata.hasPendingWrites,
  };
}

/** Mais recentes primeiro; empate pela hora do lançamento. */
function byDateDesc(a: Expense, b: Expense): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
}

export interface MonthSnapshot {
  expenses: Expense[];
  /** Dados vieram do cache local (sem confirmação do servidor ainda). */
  fromCache: boolean;
}

/**
 * Gastos de uma competência em tempo real, inclusive offline (cache local).
 * A ordenação é feita aqui para não exigir índice composto.
 */
export function watchMonthExpenses(
  groupId: string,
  month: Competence,
  onChange: (snapshot: MonthSnapshot) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(expensesCol(groupId), where('competence', '==', month));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      onChange({
        expenses: snap.docs.map(toExpense).sort(byDateDesc),
        fromCache: snap.metadata.fromCache,
      });
    },
    onError,
  );
}

/** Um gasto em tempo real; `null` se não existir (ou foi excluído). */
export function watchExpense(
  groupId: string,
  id: string,
  onChange: (expense: Expense | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(expensesCol(groupId), id),
    { includeMetadataChanges: true },
    (snap) => onChange(snap.exists() ? toExpense(snap) : null),
    onError,
  );
}

/**
 * Lança um gasto. Sem transação e sem esperar o servidor: offline, a gravação
 * fica no cache e sincroniza depois. Se a regra recusar na sincronização,
 * `trackWrite` avisa. A foto (se houver) vai para a fila e sobe quando der.
 */
export function createExpense(
  groupId: string,
  input: ExpenseInput,
  uid: string,
  closedMonths: ReadonlySet<Competence>,
  today: IsoDate,
  photo?: Blob,
): WriteResult {
  const ref = doc(expensesCol(groupId));
  const ids = { groupId, expenseId: ref.id };
  const competence = resolveCompetence(input.date, closedMonths, today);
  trackWrite(
    setDoc(ref, newExpenseData(input, uid, competence, ids, serverTimestamp())),
    'Não foi possível salvar o gasto.',
  );
  if (input.receipt.type === 'photo' && photo) void queuePhoto(groupId, ref.id, photo);
  return { id: ref.id, competence };
}

/** Edita um gasto de quem lançou. Volta a pendente e descarta aprovação ou recusa anteriores. */
export function updateExpense(
  groupId: string,
  current: Pick<Expense, 'id' | 'receipt'>,
  input: ExpenseInput,
  closedMonths: ReadonlySet<Competence>,
  today: IsoDate,
  photo?: Blob,
): WriteResult {
  const ids = { groupId, expenseId: current.id };
  const competence = resolveCompetence(input.date, closedMonths, today);
  trackWrite(
    updateDoc(
      doc(expensesCol(groupId), current.id),
      expenseUpdateData(input, competence, ids, current.receipt, serverTimestamp(), deleteField()),
    ),
    'Não foi possível salvar a alteração.',
  );
  if (input.receipt.type === 'photo' && photo) void queuePhoto(groupId, current.id, photo);
  else if (input.receipt.type !== 'photo') void discardQueuedPhoto(groupId, current.id);
  return { id: current.id, competence };
}

/**
 * Exclui o gasto. Com foto enviada e conexão, apaga a foto antes do documento
 * (a regra do Storage confere o autor no gasto). Offline, a foto fica órfã no
 * Storage: é pequena e nunca é exibida sem o gasto.
 */
export async function deleteExpense(groupId: string, expense: Pick<Expense, 'id' | 'receipt'>): Promise<void> {
  void discardQueuedPhoto(groupId, expense.id);
  if (expense.receipt.type === 'photo' && expense.receipt.photoUploaded && navigator.onLine) {
    const photo = deleteObject(storageRef(storage, receiptPhotoPath(groupId, expense.id))).catch(() => undefined);
    const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
    await Promise.race([photo, timeout]);
  }
  trackWrite(deleteDoc(doc(expensesCol(groupId), expense.id)), 'Não foi possível excluir o gasto.');
}

/** Aprovação pelo outro membro. Funciona offline (sincroniza depois). */
export function approveExpense(groupId: string, id: string, uid: string): void {
  trackWrite(
    updateDoc(doc(expensesCol(groupId), id), approvalData(uid, serverTimestamp())),
    'Não foi possível aprovar o gasto.',
  );
}

/** Recusa pelo outro membro, com motivo opcional. Funciona offline. */
export function rejectExpense(groupId: string, id: string, uid: string, reason?: string): void {
  trackWrite(
    updateDoc(doc(expensesCol(groupId), id), rejectionData(uid, reason, serverTimestamp())),
    'Não foi possível recusar o gasto.',
  );
}
