/** Valor monetário em centavos inteiros. Nunca usar float de reais. */
export type Cents = number;

/** Mês de competência no formato `YYYY-MM`. */
export type Competence = string;

export type ExpenseStatus =
  | 'confirmed'
  | 'pending_approval'
  | 'returned'
  | 'awaiting_confirmation';

/** Campos do gasto que o cálculo do acerto usa. */
export interface SettlementExpense {
  totalCents: Cents;
  personalCents: Cents;
  payerUid: string;
  payerSharePct: number;
  status: ExpenseStatus;
}

/** Os dois membros do casal. */
export type Members = readonly [string, string];

/** Valor que `fromUid` deve pagar a `toUid`. */
export interface Transfer {
  fromUid: string;
  toUid: string;
  amountCents: Cents;
}

export interface Installment {
  /** Posição da parcela, começando em 1. */
  index: number;
  count: number;
  totalCents: Cents;
  personalCents: Cents;
  competence: Competence;
}

export interface InstallmentInput {
  totalCents: Cents;
  personalCents: Cents;
  count: number;
  firstCompetence: Competence;
}

const COMPETENCE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} deve ser um inteiro de centavos >= 0 (recebido: ${value})`);
  }
}

function assertCompetence(value: string): void {
  if (!COMPETENCE_RE.test(value)) {
    throw new RangeError(`competência inválida: "${value}" (esperado YYYY-MM)`);
  }
}

function otherMember(members: Members, uid: string): string {
  if (members[0] === members[1]) {
    throw new RangeError('os dois membros precisam ser diferentes');
  }
  if (uid === members[0]) return members[1];
  if (uid === members[1]) return members[0];
  throw new RangeError(`pagador ${uid} não é membro do grupo`);
}

/** Gastos aguardando confirmação do valor (recorrentes) ficam fora do saldo. */
export function countsInBalance(status: ExpenseStatus): boolean {
  return status !== 'awaiting_confirmation';
}

/**
 * Dívida que um gasto gera do não pagador com o pagador.
 *
 *   rateio    = total - pessoal            (a parte pessoal é sempre de quem pagou)
 *   outroDeve = round(rateio * (100 - payerSharePct) / 100)
 *
 * Não olha o status: quem decide se o gasto entra no saldo é `monthBalance`.
 */
export function expenseDebt(expense: SettlementExpense, members: Members): Transfer {
  const { totalCents, personalCents, payerUid, payerSharePct } = expense;
  assertCents(totalCents, 'totalCents');
  assertCents(personalCents, 'personalCents');
  if (personalCents > totalCents) {
    throw new RangeError('personalCents não pode ser maior que totalCents');
  }
  if (!Number.isInteger(payerSharePct) || payerSharePct < 0 || payerSharePct > 100) {
    throw new RangeError(`payerSharePct deve ser inteiro entre 0 e 100 (recebido: ${payerSharePct})`);
  }

  const sharedCents = totalCents - personalCents;
  return {
    fromUid: otherMember(members, payerUid),
    toUid: payerUid,
    amountCents: Math.round((sharedCents * (100 - payerSharePct)) / 100),
  };
}

/**
 * Saldo líquido do mês: soma as dívidas por direção e devolve quem paga quanto a quem.
 * Retorna `null` quando o mês está zerado.
 */
export function monthBalance(
  expenses: readonly SettlementExpense[],
  members: Members,
): Transfer | null {
  // Positivo: members[1] deve a members[0]. Negativo: o contrário.
  let net = 0;
  for (const expense of expenses) {
    if (!countsInBalance(expense.status)) continue;
    const debt = expenseDebt(expense, members);
    net += debt.toUid === members[0] ? debt.amountCents : -debt.amountCents;
  }

  if (net === 0) return null;
  return net > 0
    ? { fromUid: members[1], toUid: members[0], amountCents: net }
    : { fromUid: members[0], toUid: members[1], amountCents: -net };
}

/** Soma (ou subtrai) meses a uma competência `YYYY-MM`. */
export function addMonths(competence: Competence, months: number): Competence {
  assertCompetence(competence);
  const [year, month] = competence.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const newYear = Math.floor(index / 12);
  const newMonth = (index % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, '0')}`;
}

/**
 * Divide uma compra parcelada em uma parcela por mês.
 *
 * - Valor por parcela = floor(total / n); o resto dos centavos vai na primeira.
 * - A parte pessoal é proporcional ao valor de cada parcela, por arredondamento
 *   acumulado: a soma bate exatamente com o total pessoal e nenhuma parcela tem
 *   parte pessoal maior que o próprio valor.
 */
export function splitInstallments(input: InstallmentInput): Installment[] {
  const { totalCents, personalCents, count, firstCompetence } = input;
  assertCents(totalCents, 'totalCents');
  assertCents(personalCents, 'personalCents');
  if (personalCents > totalCents) {
    throw new RangeError('personalCents não pode ser maior que totalCents');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count deve ser inteiro >= 1 (recebido: ${count})`);
  }
  assertCompetence(firstCompetence);

  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;

  const installments: Installment[] = [];
  let cumulativeTotal = 0;
  let cumulativePersonal = 0;
  for (let i = 0; i < count; i++) {
    const installmentTotal = i === 0 ? base + remainder : base;
    cumulativeTotal += installmentTotal;
    // BigInt evita perda de precisão no produto para valores grandes.
    const personalUpToHere =
      totalCents === 0
        ? 0
        : Number((BigInt(cumulativeTotal) * BigInt(personalCents)) / BigInt(totalCents));
    installments.push({
      index: i + 1,
      count,
      totalCents: installmentTotal,
      personalCents: personalUpToHere - cumulativePersonal,
      competence: addMonths(firstCompetence, i),
    });
    cumulativePersonal = personalUpToHere;
  }
  return installments;
}

/**
 * Quanto cada membro pagou no mês (total dos gastos, com a parte pessoal).
 * Usa o mesmo filtro do saldo: gastos aguardando confirmação ficam fora.
 */
export function paidByMember(
  expenses: readonly SettlementExpense[],
  members: Members,
): Record<string, Cents> {
  const paid: Record<string, Cents> = { [members[0]]: 0, [members[1]]: 0 };
  for (const expense of expenses) {
    if (!countsInBalance(expense.status)) continue;
    assertCents(expense.totalCents, 'totalCents');
    otherMember(members, expense.payerUid);
    paid[expense.payerUid] += expense.totalCents;
  }
  return paid;
}

export interface PendingSummary {
  /** Gastos pendentes ou devolvidos (contam no saldo, destacados). */
  open: number;
  /** Pendentes lançados pelo outro: aguardam a aprovação de quem olha. */
  awaitingMyApproval: number;
  /** Devolvidos a quem olha para corrigir. */
  returnedToMe: number;
}

/** Contagem do aviso de pendências do Painel, do ponto de vista de quem olha. */
export function pendingSummary(
  expenses: readonly Pick<SettlementExpense & { createdBy: string }, 'status' | 'createdBy'>[],
  viewerUid: string,
): PendingSummary {
  const summary: PendingSummary = { open: 0, awaitingMyApproval: 0, returnedToMe: 0 };
  for (const { status, createdBy } of expenses) {
    if (status === 'pending_approval') {
      summary.open++;
      if (createdBy !== viewerUid) summary.awaitingMyApproval++;
    } else if (status === 'returned') {
      summary.open++;
      if (createdBy === viewerUid) summary.returnedToMe++;
    }
  }
  return summary;
}
