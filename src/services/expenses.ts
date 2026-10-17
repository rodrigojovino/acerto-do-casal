import {
  Timestamp,
  collection,
  deleteDoc,
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
import { expenseUpdateData, newExpenseData, type ExpenseInput } from './expenseData';
import { db } from './firebase';
import { trackWrite } from './sync';

export type { ExpenseInput } from './expenseData';

export interface Receipt {
  type: 'photo' | 'nfce' | 'none';
  photoPath?: string;
  nfceKey?: string;
  nfceStatus?: 'pending' | 'ok' | 'failed';
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
 * `trackWrite` avisa.
 */
export function createExpense(
  groupId: string,
  input: ExpenseInput,
  uid: string,
  closedMonths: ReadonlySet<Competence>,
  today: IsoDate,
): WriteResult {
  const ref = doc(expensesCol(groupId));
  const competence = resolveCompetence(input.date, closedMonths, today);
  trackWrite(
    setDoc(ref, newExpenseData(input, uid, competence, serverTimestamp())),
    'Não foi possível salvar o gasto.',
  );
  return { id: ref.id, competence };
}

/** Edita um gasto de quem lançou. Devolvido volta a pendente ao ser corrigido. */
export function updateExpense(
  groupId: string,
  current: Pick<Expense, 'id' | 'status'>,
  input: ExpenseInput,
  closedMonths: ReadonlySet<Competence>,
  today: IsoDate,
): WriteResult {
  const competence = resolveCompetence(input.date, closedMonths, today);
  trackWrite(
    updateDoc(
      doc(expensesCol(groupId), current.id),
      expenseUpdateData(input, current.status, competence, serverTimestamp()),
    ),
    'Não foi possível salvar a alteração.',
  );
  return { id: current.id, competence };
}

export function deleteExpense(groupId: string, id: string): void {
  trackWrite(deleteDoc(doc(expensesCol(groupId), id)), 'Não foi possível excluir o gasto.');
}
