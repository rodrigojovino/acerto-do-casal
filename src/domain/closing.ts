import {
  countsInBalance,
  expenseDebt,
  monthBalance,
  type Cents,
  type Competence,
  type ExpenseStatus,
  type Members,
  type SettlementExpense,
  type Transfer,
} from './settlement.js';

/**
 * Fechamento do mês: memória de cálculo, o que impede fechar e os pagamentos
 * do acerto. Usado pela tela de fechamento e pela Function que fecha (a
 * mesma conta nos dois lados).
 */

/** Parte de cada membro no mês. */
export interface MemberBreakdown {
  /** Quanto do rateio é dele (soma da parte de cada gasto). */
  shareCents: Cents;
  /** Quanto do rateio ele pagou (rateio dos gastos que pagou). */
  paidSharedCents: Cents;
  /** Pagou − parte: positivo, tem a receber; negativo, tem a pagar. */
  diffCents: Cents;
}

export interface MonthBreakdown {
  /** Gastos que contam no saldo. */
  expenseCount: number;
  /** Total lançado (com as partes pessoais). */
  totalCents: Cents;
  /** Partes pessoais (sempre de quem pagou). */
  personalCents: Cents;
  /** Total no rateio = total − partes pessoais. */
  sharedCents: Cents;
  byMember: Record<string, MemberBreakdown>;
  /** Quem paga quanto a quem; `null` = ninguém deve nada. Igual a `monthBalance`. */
  result: Transfer | null;
}

/**
 * Memória de cálculo do mês, com o mesmo arredondamento do saldo (por gasto):
 * em cada gasto, o não pagador fica com `outroDeve` do rateio e quem pagou com
 * o resto. A diferença de cada um (pagou − parte) dá o acerto.
 */
export function monthBreakdown(expenses: readonly SettlementExpense[], members: Members): MonthBreakdown {
  const byMember: Record<string, MemberBreakdown> = {
    [members[0]]: { shareCents: 0, paidSharedCents: 0, diffCents: 0 },
    [members[1]]: { shareCents: 0, paidSharedCents: 0, diffCents: 0 },
  };
  let expenseCount = 0;
  let totalCents = 0;
  let personalCents = 0;
  for (const expense of expenses) {
    if (!countsInBalance(expense.status)) continue;
    const debt = expenseDebt(expense, members);
    const shared = expense.totalCents - expense.personalCents;
    expenseCount++;
    totalCents += expense.totalCents;
    personalCents += expense.personalCents;
    byMember[debt.fromUid].shareCents += debt.amountCents;
    byMember[debt.toUid].shareCents += shared - debt.amountCents;
    byMember[debt.toUid].paidSharedCents += shared;
  }
  for (const uid of members) byMember[uid].diffCents = byMember[uid].paidSharedCents - byMember[uid].shareCents;
  return {
    expenseCount,
    totalCents,
    personalCents,
    sharedCents: totalCents - personalCents,
    byMember,
    result: monthBalance(expenses, members),
  };
}

// ---- O que impede fechar ----

export type BlockerKind = 'pending' | 'returned' | 'awaiting' | 'photo';

export interface Blocker {
  kind: BlockerKind;
  count: number;
}

/**
 * Gastos que impedem o fechamento: pendentes de aprovação, devolvidos,
 * recorrentes aguardando o valor e fotos de comprovante ainda não enviadas.
 * Uma série de parcelas conta cada parcela do mês (só a do mês está aqui).
 */
export function closeBlockers(
  expenses: ReadonlyArray<{ status: ExpenseStatus; receipt: { type: string; photoUploaded?: boolean } }>,
): Blocker[] {
  const counts: Record<BlockerKind, number> = { pending: 0, returned: 0, awaiting: 0, photo: 0 };
  for (const e of expenses) {
    if (e.status === 'pending_approval') counts.pending++;
    else if (e.status === 'returned') counts.returned++;
    else if (e.status === 'awaiting_confirmation') counts.awaiting++;
    if (e.receipt.type === 'photo' && !e.receipt.photoUploaded) counts.photo++;
  }
  return (['pending', 'returned', 'awaiting', 'photo'] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => ({ kind, count: counts[kind] }));
}

// ---- Pagamentos do acerto ----

/** Um pagamento registrado: quem pagou quanto a quem, por PIX (com foto) ou dinheiro. */
export interface Payment {
  id: string;
  fromUid: string;
  toUid: string;
  amountCents: Cents;
  method: 'pix' | 'cash';
  /** Foto do comprovante PIX no Storage. */
  receiptPath?: string;
  /** Quem registrou (sempre quem pagou). */
  byUid: string;
  at: unknown;
}

/** Valor com sinal: positivo quando vai de members[0] para members[1]. */
function signed(t: Pick<Transfer, 'fromUid' | 'toUid' | 'amountCents'>, members: Members): number {
  if (t.fromUid === members[0] && t.toUid === members[1]) return t.amountCents;
  if (t.fromUid === members[1] && t.toUid === members[0]) return -t.amountCents;
  throw new RangeError('pagamento entre quem não é do casal');
}

function fromSigned(value: number, members: Members): Transfer | null {
  if (value === 0) return null;
  return value > 0
    ? { fromUid: members[0], toUid: members[1], amountCents: value }
    : { fromUid: members[1], toUid: members[0], amountCents: -value };
}

/**
 * O que ainda falta acertar: saldo do mês menos os pagamentos já feitos (soma
 * líquida, nos dois sentidos). `null` = acertado, pode fechar. Depois de uma
 * reabertura, os pagamentos anteriores continuam valendo: falta só o
 * complemento, ou a devolução (sentido contrário) se o saldo diminuiu.
 */
export function remainingTransfer(
  balance: Transfer | null,
  payments: ReadonlyArray<Pick<Payment, 'fromUid' | 'toUid' | 'amountCents'>>,
  members: Members,
): Transfer | null {
  const owed = balance ? signed(balance, members) : 0;
  const paid = payments.reduce((sum, p) => sum + signed(p, members), 0);
  return fromSigned(owed - paid, members);
}

/** Por que o mês não pode ser fechado agora (lista vazia = pode). */
export type CloseReason = 'closed' | 'future' | 'offline' | 'blocked' | 'unpaid';

/**
 * Pode fechar? Mês já fechado ou futuro nunca; sem conexão não (fechar é
 * online); com pendências ou com acerto por pagar, também não.
 */
export function closeReasons(input: {
  month: Competence;
  currentMonth: Competence;
  closed: boolean;
  online: boolean;
  blockers: readonly Blocker[];
  remaining: Transfer | null;
}): CloseReason[] {
  const reasons: CloseReason[] = [];
  if (input.closed) reasons.push('closed');
  if (input.month > input.currentMonth) reasons.push('future');
  if (!input.online) reasons.push('offline');
  if (input.blockers.length > 0) reasons.push('blocked');
  if (input.remaining) reasons.push('unpaid');
  return reasons;
}
