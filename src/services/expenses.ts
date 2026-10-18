import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { resolveCompetence, type IsoDate } from '@/domain/calendar';
import type { InstallmentInfo } from '@/domain/installments';
import type { Competence, ExpenseStatus, SettlementExpense } from '@/domain/settlement';
import { deleteObject, getDownloadURL, ref as storageRef } from 'firebase/storage';
import { receiptPhotoPath } from '@/domain/image';
import {
  approvalData,
  contestData,
  expenseUpdateData,
  installmentUpdateData,
  newExpenseData,
  newInstallmentSeriesData,
  rejectionData,
  validationData,
  type ExpenseInput,
  type InstallmentChoice,
  type SeriesEditInput,
  type StoredReceipt,
} from './expenseData';
import { db, storage } from './firebase';
import { discardQueuedPhoto, queuePhoto, queuedPhotoUrl } from './photoQueue';
import { trackWrite } from './sync';

export type { ExpenseInput, InstallmentChoice, ReceiptChoice, SeriesEditInput } from './expenseData';

export type Receipt = StoredReceipt;

export interface Approval {
  byUid: string;
  at: Date | null;
}

export interface Rejection {
  byUid: string;
  reason?: string;
  at: Date | null;
  /** 'reject': recusa de um pendente; 'contest': contestação de um confirmado. Ausente em dados antigos. */
  kind?: 'reject' | 'contest';
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
  /** Gasto gerado de uma conta recorrente (gravado só pela Function). */
  recurringId?: string;
  /** Parcela de uma compra parcelada. */
  installment?: InstallmentInfo;
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
      ? { byUid: data.rejection.byUid, reason: data.rejection.reason, at: toDate(data.rejection.at), kind: data.rejection.kind }
      : undefined,
    recurringId: data.recurringId,
    installment: data.installment,
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

/** Edita um gasto de quem lançou. Status pelo comprovante; descarta aprovação ou recusa anteriores. */
export function updateExpense(
  groupId: string,
  current: Pick<Expense, 'id' | 'receipt' | 'status'>,
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
      expenseUpdateData(input, competence, ids, current, serverTimestamp(), deleteField()),
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

/**
 * Mesma alteração em vários gastos num lote (as parcelas de uma série: todas ou
 * nenhuma). Funciona offline; um único gasto vira um lote de um.
 */
function updateMany(groupId: string, ids: readonly string[], data: Record<string, unknown>, failure: string): void {
  if (ids.length === 0) return;
  const batch = writeBatch(db);
  for (const id of ids) batch.update(doc(expensesCol(groupId), id), data);
  trackWrite(batch.commit(), failure);
}

/** Aprovação pelo outro membro (numa série, as parcelas pendentes de meses abertos). */
export function approveExpense(groupId: string, ids: readonly string[], uid: string): void {
  updateMany(groupId, ids, approvalData(uid, serverTimestamp()), 'Não foi possível aprovar o gasto.');
}

/** Recusa pelo outro membro, com motivo opcional. */
export function rejectExpense(groupId: string, ids: readonly string[], uid: string, reason?: string): void {
  updateMany(groupId, ids, rejectionData(uid, reason, serverTimestamp()), 'Não foi possível recusar o gasto.');
}

/**
 * Gastos pendentes, devolvidos ou aguardando confirmação de todos os meses (aba
 * Pendências), em tempo real e do cache offline.
 */
export function watchOpenItems(
  groupId: string,
  onChange: (expenses: Expense[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(expensesCol(groupId), where('status', 'in', ['pending_approval', 'returned', 'awaiting_confirmation']));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => onChange(snap.docs.map(toExpense).sort(byDateDesc)),
    onError,
  );
}

/** Pede à Function para consultar a nota de novo (depois de uma falha). */
export function retryNfceCheck(groupId: string, expense: Pick<Expense, 'id' | 'receipt' | 'installment'>): void {
  // Só notas de SP (com URL) têm conferência automática, e só depois de uma falha.
  // Numa série, a consulta é da parcela 1, que repassa o resultado às outras.
  if (expense.receipt.type !== 'nfce' || !expense.receipt.nfceUrl || expense.receipt.nfceStatus !== 'failed') return;
  trackWrite(
    updateDoc(doc(expensesCol(groupId), receiptOwnerId(expense)), {
      'receipt.nfceStatus': 'pending',
      'receipt.nfceError': deleteField(),
      'receipt.nfceData': deleteField(),
      updatedAt: serverTimestamp(),
    }),
    'Não foi possível pedir uma nova consulta da nota.',
  );
}

/**
 * Endereço da foto do comprovante: a cópia local enquanto ainda está na fila
 * deste aparelho; senão, a do Storage (precisa de conexão).
 */
export async function receiptPhotoUrl(
  groupId: string,
  expense: Pick<Expense, 'id' | 'receipt' | 'installment'>,
): Promise<string | null> {
  if (expense.receipt.type !== 'photo') return null;
  const owner = receiptOwnerId(expense);
  const local = await queuedPhotoUrl(groupId, owner);
  if (local) return local;
  if (!expense.receipt.photoUploaded) return null;
  return getDownloadURL(storageRef(storage, receiptPhotoPath(groupId, owner))).catch(() => null);
}

/** Contestação de um confirmado automaticamente, com motivo (numa série, todas as parcelas abertas). */
export function contestExpense(groupId: string, ids: readonly string[], uid: string, reason: string): void {
  updateMany(groupId, ids, contestData(uid, reason, serverTimestamp(), deleteField()), 'Não foi possível contestar o gasto.');
}

/** Validação de um confirmado automaticamente pelo outro membro (numa série, todas as parcelas abertas). */
export function validateExpense(groupId: string, ids: readonly string[], uid: string): void {
  updateMany(groupId, ids, validationData(uid, serverTimestamp()), 'Não foi possível validar o gasto.');
}

// ---- Compra parcelada ----

/** Dono da foto e da consulta da nota: a série (parcela 1) ou o próprio gasto. */
export const receiptOwnerId = (expense: Pick<Expense, 'id' | 'installment'>): string => expense.installment?.seriesId ?? expense.id;

/**
 * Lança a compra parcelada: todas as parcelas num lote (offline, sincroniza
 * junto). A foto da compra vai para a fila uma vez, no caminho da série.
 */
export function createInstallmentSeries(
  groupId: string,
  input: ExpenseInput,
  choice: InstallmentChoice,
  uid: string,
  photo?: Blob,
): WriteResult {
  const seriesId = doc(expensesCol(groupId)).id;
  const parcels = newInstallmentSeriesData(input, choice, uid, { groupId, seriesId }, serverTimestamp());
  const batch = writeBatch(db);
  for (const p of parcels) batch.set(doc(expensesCol(groupId), p.id), p.data);
  trackWrite(batch.commit(), 'Não foi possível salvar a compra parcelada.');
  if (input.receipt.type === 'photo' && photo) void queuePhoto(groupId, seriesId, photo);
  return { id: seriesId, competence: choice.firstMonth };
}

/** Parcelas de uma série em tempo real (inclusive do cache offline), pela ordem. */
export function watchSeries(
  groupId: string,
  seriesId: string,
  onChange: (parcels: Expense[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(expensesCol(groupId), where('installment.seriesId', '==', seriesId)),
    { includeMetadataChanges: true },
    (snap) => onChange(snap.docs.map(toExpense).sort((a, b) => (a.installment?.index ?? 0) - (b.installment?.index ?? 0))),
    onError,
  );
}

/**
 * Edita a série (descrição, quem pagou, divisão e comprovante) nas parcelas
 * informadas (as de meses abertos), num lote; cada uma segue a regra de status
 * da edição.
 */
export function updateSeries(
  groupId: string,
  seriesId: string,
  parcels: ReadonlyArray<Pick<Expense, 'id' | 'receipt' | 'status'>>,
  input: SeriesEditInput,
  photo?: Blob,
): void {
  if (parcels.length === 0) return;
  const batch = writeBatch(db);
  for (const p of parcels) {
    batch.update(
      doc(expensesCol(groupId), p.id),
      installmentUpdateData(input, p, { groupId, seriesId }, serverTimestamp(), deleteField()),
    );
  }
  trackWrite(batch.commit(), 'Não foi possível salvar a alteração da série.');
  if (input.receipt.type === 'photo' && photo) void queuePhoto(groupId, seriesId, photo);
  else if (input.receipt.type !== 'photo') void discardQueuedPhoto(groupId, seriesId);
}

/**
 * Exclui as parcelas informadas (as de meses abertos) num lote. A foto da
 * série sai antes, enquanto a parcela 1 existe (a regra do Storage confere nela).
 */
export async function deleteSeries(
  groupId: string,
  seriesId: string,
  parcels: ReadonlyArray<Pick<Expense, 'id' | 'receipt'>>,
): Promise<void> {
  if (parcels.length === 0) return;
  void discardQueuedPhoto(groupId, seriesId);
  const receipt = parcels[0].receipt;
  if (receipt.type === 'photo' && receipt.photoUploaded && navigator.onLine) {
    const photo = deleteObject(storageRef(storage, receiptPhotoPath(groupId, seriesId))).catch(() => undefined);
    const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
    await Promise.race([photo, timeout]);
  }
  const batch = writeBatch(db);
  for (const p of parcels) batch.delete(doc(expensesCol(groupId), p.id));
  trackWrite(batch.commit(), 'Não foi possível excluir a compra parcelada.');
}

/**
 * Mês da parcela mais distante além do limite normal de navegação (só parcelas
 * passam dele), em tempo real; `null` se não houver.
 */
export function watchLatestInstallmentMonth(
  groupId: string,
  afterMonth: Competence,
  onChange: (month: Competence | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const q = query(expensesCol(groupId), where('competence', '>', afterMonth), orderBy('competence', 'desc'), limit(1));
  return onSnapshot(q, (snap) => onChange(snap.empty ? null : (snap.docs[0].get('competence') as Competence)), onError);
}
